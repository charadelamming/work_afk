use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;

use serde_json::Value;
use tauri::menu::MenuBuilder;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, PhysicalPosition, RunEvent, WindowEvent};

/// 内存里记住的窗口位置，退出时落盘
#[derive(Default)]
struct AppState {
    last_pos: Mutex<Option<(i32, i32)>>,
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
    std::fs::write(path, text).map_err(|e| e.to_string())
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
fn load_config(app: tauri::AppHandle) -> Result<Option<Value>, String> {
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
fn save_settings(app: tauri::AppHandle, settings: Value) -> Result<(), String> {
    let mut cfg = read_config(&app);
    if !cfg.is_object() {
        cfg = Value::Object(Default::default());
    }
    cfg["settings"] = settings;
    write_config(&app, &cfg)
}

/// 打开设置窗口（前端不直接操作其它窗口，避免多开权限）
#[tauri::command]
fn open_settings(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("settings") {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 开机自启：写 HKCU 的 Run 项，不需要管理员权限
#[tauri::command]
fn set_autostart(enabled: bool) -> Result<(), String> {
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
    let hide = tauri::menu::MenuItem::with_id(app, "hide", "收进托盘", true, None::<&str>)?;
    let quit = tauri::menu::MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;

    let menu = MenuBuilder::new(app)
        .item(&show)
        .item(&settings)
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
            "settings" => {
                if let Some(window) = app.get_webview_window("settings") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
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
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            load_config,
            save_settings,
            open_settings,
            set_autostart
        ])
        .setup(|app| {
            // 托盘创建失败不该拖垮整个程序：某些环境（如没有 shell/资源管理器的会话）
            // 会返回 os error 5，此时至少让小组件窗口还能用。
            if let Err(err) = build_tray(&app.handle()) {
                eprintln!("[reborn-work] 托盘初始化失败（继续运行）：{err}");
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
                if let Some(window) = app.get_webview_window("settings") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
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
