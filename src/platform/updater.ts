import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";

import { isTauri } from "./config";

/** 设置页「关于」区域的状态机；文案由 UI 层根据 kind 渲染 */
export type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "none" }
  | { kind: "available"; version: string }
  | { kind: "downloading"; percent: number }
  | { kind: "ready"; version: string }
  | { kind: "error"; message: string };

/** 检查结果：区分「没有新版本」和「检查失败」，UI 才能给出准确反馈 */
export type CheckOutcome =
  | { kind: "none" }
  | { kind: "available"; version: string; notes: string }
  | { kind: "error"; message: string };

/** 单次检查的超时：GitHub 在国内可能连不上，不能让设置页一直转圈 */
const CHECK_TIMEOUT_MS = 15_000;
/** 启动后延迟多久做静默检查，避开首帧渲染和配置加载 */
const START_DELAY_MS = 10_000;
/** 静默检查间隔：小组件常驻托盘，可能几天不重启 */
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const LAST_CHECK_KEY = "reborn-work:lastUpdateCheckAt";

/** 模块级单例：重复点「检查更新」复用同一个 Update，避免重复下载 */
let pending: Update | null = null;

/** 把插件抛出的英文/原始错误翻成一句人话 */
function humanize(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/timed?\s*out|timeout/i.test(raw)) return "检查超时，请检查网络后重试";
  if (/404|not\s*found/i.test(raw)) return "没找到更新地址，可能还没发布新版本";
  if (/network|fetch|dns|connect|proxy|tls|certificate/i.test(raw)) return "网络连接失败，请检查网络或代理";
  return raw || "未知错误";
}

/** 当前安装的版本号；浏览器预览下没有 Tauri 环境，给个占位 */
export async function currentVersion(): Promise<string> {
  if (!isTauri) return "预览";
  try {
    return await getVersion();
  } catch (err) {
    console.warn("[updater] 读取版本号失败", err);
    return "未知";
  }
}

/** 检查更新（带失败原因）。浏览器预览环境直接返回 error，不抛错。 */
export async function checkUpdate(): Promise<CheckOutcome> {
  if (!isTauri) return { kind: "error", message: "浏览器预览模式不支持检查更新" };
  if (pending) {
    await pending.close().catch(() => {});
    pending = null;
  }
  try {
    const update = await check({ timeout: CHECK_TIMEOUT_MS });
    pending = update;
    markChecked();
    if (!update) return { kind: "none" };
    return { kind: "available", version: update.version, notes: update.body ?? "" };
  } catch (err) {
    // 网络断了/被墙/JSON 404 都走这里；失败不记时间戳，下次启动还会重试
    console.warn("[updater] 检查失败", err);
    return { kind: "error", message: humanize(err) };
  }
}

/** 检查更新。浏览器预览环境返回 null，不抛错。静默检查用这个。 */
export async function checkForUpdate(): Promise<Update | null> {
  const outcome = await checkUpdate();
  return outcome.kind === "available" ? pending : null;
}

/** 后台下载，返回是否成功。进度回调只在能算总量时给百分比。 */
export async function downloadUpdate(onPercent: (p: number) => void): Promise<boolean> {
  if (!pending) return false;
  let total = 0;
  let got = 0;
  try {
    await pending.download((event) => {
      if (event.event === "Started") total = event.data.contentLength ?? 0;
      if (event.event === "Progress") {
        got += event.data.chunkLength;
        onPercent(total ? Math.round((got / total) * 100) : 0);
      }
    });
    return true;
  } catch (err) {
    console.warn("[updater] 下载失败", err);
    return false;
  }
}

/** 安装并重启。必须在用户明确确认后调用。 */
export async function installAndRelaunch(): Promise<void> {
  if (!pending) return;
  await pending.install();
  // Windows 上 install() 内部会自行退出进程，这一行是其他平台的兜底
  await relaunch();
}

/**
 * 托盘「检查更新」的待办标记：设置窗口刚创建时事件可能早于页面挂载，
 * 所以托盘先置标记，页面挂载后再来取一次。
 */
export async function takePendingUpdateCheck(): Promise<boolean> {
  if (!isTauri) return false;
  try {
    return await invoke<boolean>("take_pending_update_check");
  } catch (err) {
    console.warn("[updater] 读取待办检查标记失败", err);
    return false;
  }
}

/** 距上次成功检查是否已超过 24 小时 */
export function shouldCheckNow(now: number = Date.now()): boolean {
  try {
    const last = Number(localStorage.getItem(LAST_CHECK_KEY) ?? "0");
    return !Number.isFinite(last) || now - last >= CHECK_INTERVAL_MS;
  } catch {
    return true;
  }
}

/** 记录本次检查时间，用于节流 */
export function markChecked(now: number = Date.now()): void {
  try {
    localStorage.setItem(LAST_CHECK_KEY, String(now));
  } catch {
    // 隐私模式/localStorage 不可用时忽略，最多是检查得勤一点
  }
}

/**
 * 启动静默检查：10 秒后检查一次，之后每 24 小时一次。
 * 不弹窗、不阻塞启动，失败只写日志；返回取消函数。
 */
export function startAutoUpdateCheck(): () => void {
  if (!isTauri) return () => {};
  const silentCheck = (): void => {
    if (!shouldCheckNow()) return;
    void checkForUpdate().then((update) => {
      if (update) {
        console.info(`[updater] 发现新版本 v${update.version}，可在设置页「检查更新」查看`);
      }
    });
  };
  const timer = window.setTimeout(silentCheck, START_DELAY_MS);
  const interval = window.setInterval(silentCheck, CHECK_INTERVAL_MS);
  return () => {
    window.clearTimeout(timer);
    window.clearInterval(interval);
  };
}
