//! 线程约定：所有 `#[tauri::command]` 一律写成 `async fn`。
//!
//! 同步命令是在 WebView2 的 WebMessageReceived 回调里、主线程上直接执行的。命令体里只要做了
//! 需要主线程消息泵继续运转的事（创建窗口/webview、弹系统对话框、等待别的窗口），主线程就会
//! 被自己堵死：命令永不返回，后续所有 IPC 都排队卡住，界面上表现成「按钮点了没反应」。
//! 这正是 v0.1.0 里「右上角只有置顶按钮有反应」的根因 —— 置顶只改前端状态，其余按钮全卡在
//! 打开设置窗口时被冻结的 IPC 上。async 命令由 async runtime 的线程池执行，窗口创建再交回
//! 事件循环，就不会自锁。

use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde_json::Value;
use tauri::menu::MenuBuilder;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{
    Emitter, Manager, PhysicalPosition, RunEvent, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};

/// 内存里记住的窗口位置，退出时落盘
#[derive(Default)]
struct AppState {
    last_pos: Mutex<Option<(i32, i32)>>,
    /// 托盘点了「检查更新」：设置页挂载后取走，避免事件早于页面加载而丢失
    pending_update_check: AtomicBool,
}

fn config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("config.json"))
}

fn read_config(app: &tauri::AppHandle) -> Value {
    config_path(app)
        .ok()
        .filter(|p| p.exists())
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .unwrap_or_else(|| Value::Object(Default::default()))
}

fn write_config(app: &tauri::AppHandle, value: &Value) -> Result<(), String> {
    let path = config_path(app)?;
    let text = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    std::fs::write(&path, text).map_err(|err| {
        // 写不进去时给出一次可见的日志：前端只 console.warn，排障时没人看得到真实原因
        eprintln!("[reborn-work] 写入配置失败（{}）：{err}", path.display());
        err.to_string()
    })
}

fn persist_position(app: &tauri::AppHandle) {
    let state = app.state::<AppState>();
    let pos = match state.last_pos.lock() {
        Ok(guard) => *guard,
        Err(_) => None,
    };
    if let Some((x, y)) = pos {
        let mut cfg = read_config(app);
        cfg["window"] = serde_json::json!({ "x": x, "y": y });
        let _ = write_config(app, &cfg);
    }
}

/// 读取完整配置：{ settings, window }
#[tauri::command]
async fn load_config(app: tauri::AppHandle) -> Result<Option<Value>, String> {
    let path = config_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    let text = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str::<Value>(&text)
        .map(Some)
        .map_err(|e| format!("配置文件损坏: {e}"))
}

/// 只覆盖 settings 字段，保留 window 位置
#[tauri::command]
async fn save_settings(app: tauri::AppHandle, settings: Value) -> Result<(), String> {
    let mut cfg = read_config(&app);
    if !cfg.is_object() {
        cfg = Value::Object(Default::default());
    }
    cfg["settings"] = settings;
    write_config(&app, &cfg)
}

/// 按需创建/取出设置窗口。
///
/// settings 窗口刻意不写进 tauri.conf.json：Windows 下 wry 会为每个 webview
/// 单独创建一次 WebView2 环境，两个窗口共用同一个 user data folder 时，
/// 第二次 CreateCoreWebView2EnvironmentWithOptions 会返回
/// 0x800700AA（ERROR_BUSY），整个进程在启动阶段直接 panic。
/// 给 settings 指定独立的 data_directory 即可避开（tauri#8196 的官方绕法）。
fn ensure_settings_window(app: &tauri::AppHandle) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window("settings") {
        return Ok(window);
    }

    let data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("settings-webview");

    WebviewWindowBuilder::new(
        app,
        "settings",
        tauri::WebviewUrl::App("settings.html".into()),
    )
    .title("设置 · 重生之我挂机上班")
    .inner_size(820.0, 760.0)
    .min_inner_size(720.0, 560.0)
    .resizable(true)
    .center()
    .visible(false)
    .data_directory(data_dir)
    .build()
    .map_err(|e| e.to_string())
}

/// 显示（必要时先创建）设置窗口
fn show_settings_window(app: &tauri::AppHandle) -> Result<(), String> {
    let window = ensure_settings_window(app)?;
    // 创建时是 visible(false)，先显形再聚焦，避免首帧白屏/闪烁
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}

/// 打开设置窗口（前端不直接操作其它窗口，避免多开权限）
///
/// 必须保持 async：同步命令跑在主线程的 IPC 回调里，在回调栈上创建窗口会把主线程锁死，
/// 连带之后所有按钮的 IPC 都失效（v0.1.0 的 BUG 根因，见文件开头）。
#[tauri::command]
async fn open_settings(app: tauri::AppHandle) -> Result<(), String> {
    show_settings_window(&app)
}

/// 托盘菜单 / 首次启动这类非 IPC 场景：同样不在主线程上直接建窗口，统一丢给 async runtime
fn spawn_settings_window(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        if let Err(err) = show_settings_window(&app) {
            eprintln!("[reborn-work] 打开设置失败：{err}");
        }
    });
}

/// 托盘「检查更新」的待办标记：读一次就清空
#[tauri::command]
async fn take_pending_update_check(app: tauri::AppHandle) -> bool {
    app.state::<AppState>()
        .pending_update_check
        .swap(false, Ordering::SeqCst)
}

/// 开机自启：写 HKCU 的 Run 项，不需要管理员权限
#[tauri::command]
async fn set_autostart(enabled: bool) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe = exe.to_string_lossy().to_string();
    let run_key = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
    let status = if enabled {
        Command::new("reg")
            .args([
                "add",
                run_key,
                "/v",
                "RebornWork",
                "/t",
                "REG_SZ",
                "/d",
                &format!("\"{exe}\""),
                "/f",
            ])
            .status()
    } else {
        Command::new("reg")
            .args(["delete", run_key, "/v", "RebornWork", "/f"])
            .status()
    }
    .map_err(|e| e.to_string())?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("注册表操作失败（{status}）"))
    }
}

fn build_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let show = tauri::menu::MenuItem::with_id(app, "show", "显示小组件", true, None::<&str>)?;
    let settings = tauri::menu::MenuItem::with_id(app, "settings", "打开设置", true, None::<&str>)?;
    let check_update =
        tauri::menu::MenuItem::with_id(app, "check_update", "检查更新", true, None::<&str>)?;
    let hide = tauri::menu::MenuItem::with_id(app, "hide", "收进托盘", true, None::<&str>)?;
    let quit = tauri::menu::MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;

    let menu = MenuBuilder::new(app)
        .item(&show)
        .item(&settings)
        .item(&check_update)
        .item(&hide)
        .separator()
        .item(&quit)
        .build()?;

    let mut builder = TrayIconBuilder::with_id("reborn-tray")
        .tooltip("重生之我挂机上班")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "settings" => spawn_settings_window(app.clone()),
            "check_update" => {
                // 先置标记再建窗口：新建的设置页页面加载晚于 emit，事件会丢；
                // 设置页挂载时用 take_pending_update_check 把这个标记取走。
                app.state::<AppState>()
                    .pending_update_check
                    .store(true, Ordering::SeqCst);
                spawn_settings_window(app.clone());
                let _ = app.emit("check-update", ());
            }
            "hide" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
            "quit" => {
                persist_position(app);
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let visible = window.is_visible().unwrap_or(false);
                    if visible {
                        let _ = window.hide();
                    } else {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            load_config,
            save_settings,
            open_settings,
            take_pending_update_check,
            set_autostart
        ])
        .setup(|app| {
            // 托盘创建失败不该拖垮整个程序：某些环境（如没有 shell/资源管理器的会话）
            // 会返回 os error 5，此时至少让小组件窗口还能用。
            if let Err(err) = build_tray(&app.handle()) {
                eprintln!("[reborn-work] 托盘初始化失败（继续运行）：{err}");
            }

            // 配置里的主窗口默认隐藏，等前端设置加载完再显示；这里先兜底显示，
            // 避免前端加载失败时整个程序只剩托盘。
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
            }

            // 恢复上次的窗口位置（物理像素）
            let cfg = read_config(&app.handle());
            if let Some(pos) = cfg.get("window") {
                if let (Some(x), Some(y)) = (
                    pos.get("x").and_then(|v| v.as_i64()),
                    pos.get("y").and_then(|v| v.as_i64()),
                ) {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.set_position(PhysicalPosition::new(x as i32, y as i32));
                    }
                }
            }

            // 第一次运行：直接弹设置，先让用户填月薪
            if cfg.get("settings").is_none() {
                spawn_settings_window(app.handle().clone());
            }
            Ok(())
        })
        .on_window_event(|window, event| match event {
            WindowEvent::Moved(pos) => {
                if window.label() == "main" {
                    let state = window.state::<AppState>();
                    let mut last = state.last_pos.lock().unwrap_or_else(|err| err.into_inner());
                    *last = Some((pos.x, pos.y));
                }
            }
            WindowEvent::CloseRequested { api, .. } => {
                if window.label() == "main" || window.label() == "settings" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
            _ => {}
        })
        .build(tauri::generate_context!())
        .expect("启动失败：无法创建应用")
        .run(|app, event| {
            if let RunEvent::ExitRequested { .. } = event {
                persist_position(app);
            }
        });
}
