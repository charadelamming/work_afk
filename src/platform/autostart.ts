import { invoke } from "@tauri-apps/api/core";

import { isTauri } from "./config";

/** 开机自启（Rust 侧写 HKCU Run） */
export function applyAutostart(enabled: boolean): void {
  if (!isTauri) return;
  invoke("set_autostart", { enabled }).catch((err) => console.warn("[reborn-work] 设置开机自启失败", err));
}
