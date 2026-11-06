import { emitTo, listen } from "@tauri-apps/api/event";

import type { Settings } from "../core/types";
import { isTauri, normalizeSettings } from "./config";

const CHANNEL = "reborn-work-settings";

/** 设置窗口 → 主窗口广播 */
export function broadcastSettings(settings: Settings): void {
  if (isTauri) {
    emitTo("main", "settings-updated", settings).catch((err) => console.warn(err));
  }
  try {
    const ch = new BroadcastChannel(CHANNEL);
    ch.postMessage(settings);
    ch.close();
  } catch {
    /* 浏览器不支持时忽略 */
  }
}

/** 主窗口订阅设置变更；返回取消订阅函数 */
export function subscribeSettings(cb: (settings: Settings) => void): () => void {
  let unlisten: (() => void) | null = null;
  if (isTauri) {
    listen<Settings>("settings-updated", (event) => cb(normalizeSettings(event.payload)))
      .then((fn) => {
        unlisten = fn;
      })
      .catch((err) => console.warn(err));
  }

  let channel: BroadcastChannel | null = null;
  try {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (event) => cb(normalizeSettings(event.data));
  } catch {
    channel = null;
  }

  return () => {
    unlisten?.();
    channel?.close();
  };
}
