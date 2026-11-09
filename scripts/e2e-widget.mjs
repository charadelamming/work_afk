/* 真实窗口按钮回归测试
 *
 * v0.1.0 的 BUG：`pnpm tauri dev` 之后右上角三个按钮里只有「置顶」有反应，
 * 「设置」「收进托盘」点了没动静。根因是同步命令 open_settings 在 WebView2 的
 * IPC 回调里、主线程上创建窗口，把主线程锁死，之后所有 IPC 排队不执行
 * （置顶只改前端状态，所以看起来是好的）。这个脚本就是那个场景的自动化版本：
 * 启动真实的 debug 版 app，用 CDP 点三个按钮，验证：
 *   1. 置顶按钮会翻转窗口的 alwaysOnTop，并把状态写进配置；
 *   2. 点「设置」能弹出设置窗口，且之后 IPC 仍然活着（锁死回归点）；
 *   3. 点「收进托盘」主窗口真的隐藏。
 *
 * 前置：`pnpm dev` 已在 127.0.0.1:1420 跑着；`cargo build`（或
 * `pnpm tauri build --debug`）产出 src-tauri/target/debug/reborn-work.exe。
 * 用法：node scripts/e2e-widget.mjs [--exe <路径>] [--keep]
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const root = resolve(import.meta.dirname, "..");
const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const keep = argv.includes("--keep");
const exe = resolve(root, argOf("--exe", "src-tauri/target/debug/reborn-work.exe"));
const devUrl = argOf("--url", "http://127.0.0.1:1420/");
const port = 9411 + Math.floor(Math.random() * 400);
const cdp = `http://127.0.0.1:${port}`;
const userDataDir = resolve(root, ".check/wv2-e2e");
const configPath = resolve(process.env.APPDATA ?? "", "com.rebornwork.app/config.json");

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};
const skip = (name, detail = "") => {
  results.push({ name, ok: true, skipped: true, detail });
  console.log(`SKIP  ${name}${detail ? `  (${detail})` : ""}`);
};

/** 判断 save_settings 的失败是不是「本机不让写用户目录」这类环境问题 */
const isWriteDenied = (msg) =>
  typeof msg === "string" && /拒绝访问|PermissionDenied|os error 5/i.test(msg);

async function waitFor(label, fn, timeoutMs = 10000, stepMs = 150) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const value = await fn();
      if (value) return value;
    } catch {
      /* 继续等 */
    }
    if (Date.now() > deadline) throw new Error(`等待超时：${label}`);
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

/** 页面内调用 Tauri 插件命令；带超时兜底，避免一个永远不返回的 IPC 把 CDP 会话拖死 */
const invoke = (page, cmd, payload = {}, timeoutMs = 3000) =>
  page.evaluate(
    async ({ cmd, payload, timeoutMs }) => {
      const inv = window.__TAURI_INTERNALS__?.invoke;
      if (!inv) return { ok: false, error: "no __TAURI_INTERNALS__" };
      return Promise.race([
        inv(cmd, payload).then(
          (v) => ({ ok: true, value: v }),
          (e) => ({ ok: false, error: String(e).slice(0, 200) }),
        ),
        new Promise((r) => setTimeout(() => r({ ok: false, error: "TIMEOUT" }), timeoutMs)),
      ]);
    },
    { cmd, payload, timeoutMs },
  );

const windowState = async (page, label) => {
  const [visible, onTop] = await Promise.all([
    invoke(page, "plugin:window|is_visible", { label }),
    invoke(page, "plugin:window|is_always_on_top", { label }),
  ]);
  return { visible: visible.ok ? visible.value : visible.error, onTop: onTop.ok ? onTop.value : onTop.error };
};

/** 按 title 找按钮，用真实鼠标点它（和用户点击走同一条链路） */
async function clickByTitle(page, title) {
  const button = page.locator(`button[title="${title}"]`).first();
  await button.waitFor({ state: "visible", timeout: 5000 });
  const box = await button.boundingBox();
  if (!box) throw new Error(`按钮没有可点区域：${title}`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

const readConfig = () => {
  try {
    return JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    return null;
  }
};

// 已存在的实例会抢设置窗口的 WebView2 目录，先收掉
const killExisting = () => {
  spawnSync("taskkill", ["/IM", "reborn-work.exe", "/T", "/F"], { stdio: "ignore" });
};

if (!existsSync(exe)) {
  console.error(`找不到可执行文件：${exe}\n先跑一次 \`pnpm tauri build --debug\` 或 \`cargo build\`。`);
  process.exit(2);
}

// 页面是 devUrl 来的：vite 没起就没有可测的东西
if (!(await fetch(devUrl).then((r) => r.ok, () => false))) {
  console.error(`连不上 ${devUrl}\n先另开一个终端跑 \`pnpm dev\`（或 \`pnpm tauri dev\`）。`);
  process.exit(2);
}

killExisting();
rmSync(userDataDir, { recursive: true, force: true });
mkdirSync(userDataDir, { recursive: true });

console.log(`启动：${exe}\nCDP：${cdp}\n配置：${configPath}\n`);

const app = spawn(exe, [], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    WEBVIEW2_USER_DATA_FOLDER: userDataDir,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
  },
});
let appLog = "";
app.stdout.on("data", (d) => (appLog += d));
app.stderr.on("data", (d) => (appLog += d));

let browser;
let exited = false;
app.on("exit", () => (exited = true));

try {
  await waitFor(
    "调试端口",
    async () => (await fetch(`${cdp}/json/version`)).ok,
    20000,
  );

  browser = await chromium.connectOverCDP(cdp);
  const context = browser.contexts()[0];
  const pages = () => context.pages();
  const findPage = (needle) => pages().find((p) => p.url().includes(needle));

  const main = await waitFor("小组件页面", () => findPage(devUrl), 20000);
  const mainText = await waitFor(
    "小组件渲染",
    async () => {
      const text = await main.evaluate(() => document.body.innerText);
      return text.includes("今日已赚") ? text : null;
    },
    20000,
  ).catch(() => null);
  check(
    "小组件窗口渲染出内容",
    Boolean(mainText),
    (mainText ?? "页面 20s 内没有渲染").replace(/\s+/g, " ").slice(0, 40),
  );

  // 首帧时前端还在 loadConfig，窗口状态与按钮标题会短暂不一致；等到一致了再动手
  await waitFor(
    "界面就绪（按钮标题与真实置顶状态一致）",
    async () => {
      const title = await main.evaluate(
        () => document.querySelector(".bar__actions button")?.getAttribute("title"),
      );
      const state = await windowState(main, "main");
      if (typeof state.onTop !== "boolean") return null;
      return title === (state.onTop ? "取消置顶" : "窗口置顶") ? true : null;
    },
    15000,
  ).catch(() => {});

  // ---- 1. 置顶 ----
  const before = await windowState(main, "main");
  const pinnedBefore = before.onTop === true;
  const configBefore = readConfig()?.settings?.alwaysOnTop;

  await clickByTitle(main, pinnedBefore ? "取消置顶" : "窗口置顶");
  const flipped = await waitFor(
    "置顶状态翻转",
    async () => {
      const s = await windowState(main, "main");
      return s.onTop === !pinnedBefore ? s : null;
    },
    4000,
  ).catch(() => null);
  check("点「置顶」会真的改变窗口置顶", Boolean(flipped), `onTop: ${before.onTop} → ${flipped?.onTop}`);

  const saved = await waitFor(
    "置顶写入配置",
    async () => {
      const value = readConfig()?.settings?.alwaysOnTop;
      return value === !pinnedBefore ? value : null;
    },
    4000,
  ).catch(() => null);
  if (saved === !pinnedBefore) {
    check("置顶状态被 save_settings 持久化", true, `${configBefore} → ${saved}`);
  } else {
    // 没写进去：先确认是应用没写，还是这台机器根本不允许写用户目录
    const disk = readConfig()?.settings;
    const probe = disk
      ? await invoke(main, "save_settings", { settings: disk }, 5000)
      : { ok: false, error: "磁盘上没有可复写的配置" };
    if (!probe.ok && isWriteDenied(probe.error)) {
      skip("置顶状态被 save_settings 持久化", `本机拦截写入，跳过：${probe.error}`);
    } else {
      check("置顶状态被 save_settings 持久化", false, `${configBefore} → ${saved}；save_settings: ${probe.error ?? "ok"}`);
    }
  }

  // ---- 2. 设置窗口：BUG 的核心 ----
  await clickByTitle(main, "设置");
  const settingsPage = await waitFor("设置窗口页面", () => findPage("settings.html"), 12000).catch(() => null);
  check("点「设置」能弹出设置窗口", Boolean(settingsPage), settingsPage?.url() ?? appLog.slice(-300));

  if (settingsPage) {
    const settingsText = await settingsPage.evaluate(() => document.body.innerText);
    check("设置窗口内容正常渲染", settingsText.includes("薪资待遇"), `${settingsText.replace(/\s+/g, " ").slice(0, 30)}…`);
    const sState = await windowState(main, "settings");
    check("设置窗口处于可见状态", sState.visible === true, String(sState.visible));

    // 锁死回归点：打开设置之后，主窗口的 IPC 必须还能在 3 秒内答复
    const alive = await invoke(main, "plugin:window|is_visible", { label: "main" }, 3000);
    check("打开设置后 IPC 没有卡死（主线程未锁）", alive.ok && alive.value === true, alive.error ?? "ok");
  }

  // ---- 3. 收进托盘 ----
  await clickByTitle(main, "收进托盘");
  const hidden = await waitFor(
    "主窗口隐藏",
    async () => {
      const s = await windowState(settingsPage ?? main, "main");
      return s.visible === false ? s : null;
    },
    5000,
  ).catch(() => null);
  check("点「收进托盘」主窗口真的隐藏", Boolean(hidden), String(hidden?.visible));

  // ---- 复原：把窗口叫回来、置顶恢复原样，别给用户留个残局 ----
  const restorePage = settingsPage ?? main;
  const shown = await invoke(restorePage, "plugin:window|show", { label: "main" }, 4000);
  const visibleAgain = await waitFor(
    "主窗口重新显示",
    async () => {
      const s = await windowState(restorePage, "main");
      return s.visible === true ? s : null;
    },
    5000,
  ).catch(() => null);
  check("能把小组件重新叫回来", shown.ok && Boolean(visibleAgain), shown.error ?? "ok");

  if ((await windowState(main, "main")).onTop !== pinnedBefore) {
    await clickByTitle(main, pinnedBefore ? "窗口置顶" : "取消置顶").catch(() => {});
    await waitFor(
      "置顶复原",
      async () => (await windowState(main, "main")).onTop === pinnedBefore,
      4000,
    ).catch(() => {});
  }
} catch (err) {
  check("脚本执行", false, String(err).slice(0, 300));
} finally {
  await browser?.close().catch(() => {});
  if (!keep && !exited) {
    spawnSync("taskkill", ["/PID", String(app.pid), "/T", "/F"], { stdio: "ignore" });
  }
}

const failed = results.filter((r) => !r.ok);
const skipped = results.filter((r) => r.skipped);
const lines = results.map(
  (r) =>
    `  ${r.skipped ? "SKIP" : r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? `  (${r.detail})` : ""}`,
);
const passed = results.length - failed.length - skipped.length;
console.log(
  `\n${lines.join("\n")}\n\n${passed}/${results.length - skipped.length} 通过` +
    (skipped.length ? `（${skipped.length} 项因本机环境跳过）` : ""),
);

if (failed.length) {
  if (appLog.trim()) console.log(`\n应用日志：\n${appLog.trim().slice(-2000)}`);
  process.exit(1);
}
process.exit(0);
