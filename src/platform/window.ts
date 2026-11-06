import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { isTauri } from "./config";

/** 显示当前窗口（悬浮窗首帧渲染后调用，避免白屏） */
export function showCurrentWindow(): void {
  if (!isTauri) return;
  getCurrentWindow().show().catch(() => {});
}

/** 隐藏当前窗口到托盘 */
export function hideCurrentWindow(): void {
  if (!isTauri) return;
  getCurrentWindow().hide().catch(() => {});
}

/** 设置当前窗口置顶 */
export function setCurrentWindowAlwaysOnTop(enabled: boolean): void {
  if (!isTauri) return;
  getCurrentWindow().setAlwaysOnTop(enabled).catch(() => {});
}

/** 打开设置窗口；浏览器预览时用新标签页代替 */
export function openSettingsWindow(): void {
  if (!isTauri) {
    window.open("/settings.html", "reborn-settings", "width=860,height=720");
    return;
  }
  invoke("open_settings").catch((err) => console.warn("[reborn-work] 打开设置失败", err));
}

/** 关闭当前窗口：Tauri 下隐藏，浏览器预览下直接关闭 */
export function closeCurrentWindow(): void {
  if (isTauri) {
    hideCurrentWindow();
    return;
  }
  window.close();
}
