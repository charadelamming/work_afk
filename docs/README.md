<div align="center">

# 重生之我挂机上班

**把工资一秒一秒数给你看的 Windows 桌面小组件。**

![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-0078D6?logo=windows&logoColor=white)
![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white)
![Vue](https://img.shields.io/badge/Vue-3.5-42B883?logo=vuedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)

[功能](#功能) · [计薪规则](#计薪规则) · [快速开始](#快速开始) · [技术架构](技术架构.md) · [运行与打包手册](运行与打包手册.md) · [已知限制](#已知限制)

</div>

![悬浮窗 · 工作中](../shots/widget-working.png)

| 未开工 · 距开工 | 午休 · 工资暂停 | 已下班 · 已落袋 |
| --- | --- | --- |
| ![未开工](../shots/widget-before.png) | ![午休](../shots/widget-lunch.png) | ![已下班](../shots/widget-after.png) |

| 法定节假日 · 躺赚 | 休息日 · 不打工 |
| --- | --- |
| ![节假日](../shots/widget-holiday.png) | ![休息日](../shots/widget-rest.png) |

设置页（820×760 真实窗口）：

![设置](../shots/settings.png)

<details>
<summary>设置页整页（820×1240）</summary>

![设置 · 整页](../shots/settings-full.png)

</details>

> **状态**：`v0.1.0` · 计薪引擎与前端已通过自动化验收（94 条断言 / 5 组变异 / 96 项 Vitest）；托盘、开机自启、窗口位置记忆等系统集成已实现，真机交互验收仍在进行中。

---

## 功能

- **实时金额**：每秒更新一次目标值，画面 60fps 缓动追上，数字连续滚动而不是生硬跳变；金额向下取整，不会「没赚到先显示」。
- **六种状态自动切换**：未开工 / 搬砖中 / 干饭中（午休冻结）/ 已下班 / 休息日 / 法定节假日（躺赚）。
- **一屏看完今天**：今日进度条、距离下班倒计时、时薪、每秒收入、本月累计已赚。
- **桌面悬浮窗**：无边框圆角、浅色半透明卡片、默认置顶、拖到哪记到哪、可收进托盘；左键点托盘图标显示/隐藏，右键有菜单（显示 / 设置 / 收起 / 退出）。
- **设置即改即生效**：月薪、计薪天数（自动或手动）、上下班时间、午休开关与时段、每周工作日、小数位、卡片透明度、里程碑特效、置顶、开机自启。
- **里程碑特效**：今日收入每跨过 ¥100 弹一次「+¥100 达成」。
- **完全离线**：不联网、不登录、不上报，配置只存在本机。

## 计薪规则

```text
计薪天数 = 当月「工作日」天数 + 落在休息日的法定节假日天数
日薪     = 月薪 ÷ 计薪天数
每秒收入 = 日薪 ÷ 当日有效工作秒数
今日已赚 = 已工作的有效秒数 × 每秒收入
```

- **周末不计薪**，`法定节假日`照发：节假日当天一整天都显示整日工资（躺赚）。
- **午休不计入工作时长**，午休期间金额冻结。
- **下班后**定格为整日工资；**休息日**为 0。
- 有效工作秒数 = （下班 − 上班）− 午休时长。
- 计薪天数可在设置里手动覆盖（比如按 21.75 或当月实际出勤天数算）。

举例：月薪 10000 元，2026 年 11 月共 30 天、9 个周末日 → 计薪 21 天，日薪 ¥476.19，时薪 ¥59.52，每秒约 ¥0.0165。

## 快速开始

```bash
pnpm install
pnpm dev
# 悬浮窗  http://127.0.0.1:1420/index.html
# 设置页  http://127.0.0.1:1420/settings.html
```

浏览器里会自动铺一层桌面背景方便预览，数据走 `localStorage`，和一个真实窗口的行为一致。

桌面版需要 Rust 与 VS 生成工具：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1   # 一键装环境
pnpm tauri dev                                               # 开发运行
pnpm tauri build                                             # 打包
```

安装包产物在 `src-tauri\target\release\bundle\nsis\`（约 1.2 MB，当前用户安装，免管理员）；也可以直接用 `src-tauri\target\release\reborn-work.exe`（约 3.4 MB，双击即跑）。

> 完整的环境安装、打包、安装卸载验收与故障排查，见 **[运行与打包手册](运行与打包手册.md)**。

## 技术栈

**Tauri 2 + Vue 3.5（Composition API + `<script setup>`）+ TypeScript 5.9 + Vite 6。**

- 计薪引擎是 `src/core` 里的零依赖纯 TypeScript，不依赖 Vue / Tauri / DOM，可以直接单测。
- `src/platform` 是唯一直接调用 Tauri 的地方，浏览器预览自动降级到 `localStorage` / `BroadcastChannel`。
- 两个 HTML 入口对应两个独立窗口，没有 Vue Router，也没有 Pinia。
- Rust 外壳只做 WebView 做不到的事：窗口、托盘、配置落盘、注册表自启。

分层、依赖规则、数据流、ADR 全部写在 **[技术架构](技术架构.md)**。

## 目录结构

```text
work_afk/
├─ index.html              悬浮窗入口
├─ settings.html           设置页入口
├─ src/
│  ├─ core/                领域层：纯 TS，无 Vue / 无 Tauri / 无 DOM
│  │  ├─ pay.ts            计薪引擎（纯函数，可单测）
│  │  ├─ date.ts           本地日期时间工具
│  │  ├─ holidays.ts       2025–2026 法定节假日
│  │  ├─ format.ts         金额 / 百分比 / 时长格式化
│  │  └─ types.ts          Settings / AppConfig / DayPlan
│  ├─ platform/            平台适配层：唯一直接调用 Tauri 的地方
│  │  ├─ config.ts         配置读写（Tauri / localStorage 双实现）
│  │  ├─ events.ts         跨窗口设置同步
│  │  ├─ window.ts         当前窗口显示 / 隐藏 / 置顶 / 打开设置
│  │  └─ autostart.ts      开机自启命令封装
│  ├─ composables/         响应式编排（设置、时间、金额滚动、窗口、自启）
│  ├─ widget/              悬浮窗 Vue SFC 与子组件
│  ├─ settings/            设置页 Vue SFC 与子组件
│  └─ styles/              设计 token 与页面样式
├─ tests/
│  ├─ unit/pay.spec.ts     94 条计薪断言（与 scripts 共用同一套用例）
│  └─ component/           WidgetApp / SettingsApp 组件测试
├─ src-tauri/
│  ├─ src/lib.rs           托盘、窗口、配置持久化、开机自启
│  ├─ tauri.conf.json      窗口与打包配置
│  ├─ capabilities/        最小权限声明
│  └─ icons/               应用图标
├─ scripts/
│  ├─ setup.ps1            一键安装编译环境（Node / VS / Rust / pnpm）
│  ├─ check-env.ps1        环境自检（只读，报告缺哪项）
│  ├─ lib/checks.cjs       计薪断言集（94 项，变异测试 / Vitest 共用）
│  ├─ check-calc.cjs       计薪引擎自检
│  ├─ check-mutation.cjs   变异测试（证明断言不是恒真）
│  ├─ shot.mjs             Playwright 截图（视觉回归）
│  ├─ measure.mjs          380×212 布局尺寸测量
│  ├─ layout-audit.mjs     设置页 820×760 布局断言
│  └─ make-icons.py        生成图标
└─ docs/                   项目文档（本文件、技术架构、运行手册、项目描述）
```

截图在 `shots/`，构建产物会生成 `dist/` 与 `src-tauri/target/`，两者都已在 `.gitignore` 里。

## 测试与质量

```bash
pnpm check        # 全量：vue-tsc + 94 断言 + 5 变异测试 + 96 项 Vitest
pnpm typecheck    # 只跑 vue-tsc 类型检查
pnpm test         # Vitest：94 条计薪用例 + 2 个 Vue 组件测试
pnpm check:calc   # 只跑计薪引擎自检
pnpm check:mutate # 只跑变异测试（故意改坏引擎，要求自检必须变红）
pnpm check:env    # 编译环境自检（Node / Rust / MSVC / SDK / WebView2）
pnpm shot         # 用系统 Edge 渲染 6 种状态 + 设置页截图（需先 pnpm preview）
pnpm icons        # 重新生成图标（需要 Python + Pillow）
```

布局核查：`pnpm preview` 起本地预览后跑 `pnpm check:layout`，检查设置页 820×760 下底部操作条是否遮挡内容、有无横向滚动，以及小组件 380×212 是否溢出。

## 数据与隐私

- 配置路径：`%APPDATA%\com.rebornwork.app\config.json`（含 `settings` 与窗口位置 `window`）。
- 程序不发起任何网络请求，不包含统计/更新检查。
- 开机自启写的是 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`，不需要管理员权限，设置里可随时关闭。

## 已知限制（下一版再做）

- **调休**：法定节假日按「法定当天」识别，调休上班的周末不会单独算成工作日。
- **节假日数据**只覆盖 2025–2026，跨年后需要补 `src/core/holidays.ts`（或在设置里手动改计薪天数）。
- **跨夜班次**（22:00–06:00）暂不支持，下班时间必须晚于上班时间。
- **单实例**未做：重复启动会开第二个托盘图标。
- 主题切换、历史 7 天/本月统计、加班倍率、发薪日倒计时都还没做。

## 常见问题

**`pnpm` 在 PowerShell 里报「禁止运行脚本」**：Windows 上 npm 会生成 `pnpm.ps1` 垫片，执行策略为 Restricted 时被拦。执行一次 `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned -Force` 即可（写入 HKCU，不需要管理员）；或者改用 `pnpm.cmd`。

**安装包双击没反应**：先复制到普通目录（下载目录 / `C:\Temp`）再运行，某些环境会拦住从深层工作区路径直接启动的安装器。

**桌面版起不来 / 白屏**：多半是 WebView2 建窗失败，处理办法见 [运行与打包手册](运行与打包手册.md) 第 7 节。

## 贡献

欢迎 issue 和 PR。提交前请跑一遍 `pnpm check`；改动计薪规则时，必须同步更新 `scripts/lib/checks.cjs` 与 `tests/unit/pay.spec.ts` 里的断言。

## 许可

本项目未采用开源许可证，保留所有权利。
