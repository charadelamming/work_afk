import { invoke } from "@tauri-apps/api/core";

import { DEFAULT_SETTINGS, type AppConfig, type Settings, type Workday } from "../core/types";

/** 是否跑在 Tauri WebView 里（浏览器预览时为 false，走 localStorage 兜底） */
export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const LS_KEY = "reborn-work.settings";

/** 把外部数据洗成合法设置，防止旧版本配置或手改文件把界面搞崩 */
export function normalizeSettings(raw: unknown): Settings {
  const input = (raw ?? {}) as Partial<Settings>;
  const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
  const str = (v: unknown, fallback: string) => (typeof v === "string" && v.trim() ? v : fallback);
  const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);

  const workdays = Array.isArray(input.workdays)
    ? (input.workdays.filter((d) => Number.isInteger(d) && d >= 1 && d <= 7) as Workday[])
    : DEFAULT_SETTINGS.workdays;

  const decimals = Math.min(3, Math.max(0, Math.round(num(input.decimals, DEFAULT_SETTINGS.decimals)))) as 0 | 1 | 2 | 3;

  return {
    salary: Math.max(0, num(input.salary, DEFAULT_SETTINGS.salary)),
    paydaysOverride:
      input.paydaysOverride == null || Number(input.paydaysOverride) <= 0
        ? null
        : Math.round(num(input.paydaysOverride, 0)),
    workStart: str(input.workStart, DEFAULT_SETTINGS.workStart),
    workEnd: str(input.workEnd, DEFAULT_SETTINGS.workEnd),
    lunchEnabled: bool(input.lunchEnabled, DEFAULT_SETTINGS.lunchEnabled),
    lunchStart: str(input.lunchStart, DEFAULT_SETTINGS.lunchStart),
    lunchEnd: str(input.lunchEnd, DEFAULT_SETTINGS.lunchEnd),
    workdays: workdays.length ? [...new Set(workdays)].sort((a, b) => a - b) : DEFAULT_SETTINGS.workdays,
    decimals,
    opacity: Math.min(1, Math.max(0.5, num(input.opacity, DEFAULT_SETTINGS.opacity))),
    alwaysOnTop: bool(input.alwaysOnTop, DEFAULT_SETTINGS.alwaysOnTop),
    autostart: bool(input.autostart, DEFAULT_SETTINGS.autostart),
    effects: bool(input.effects, DEFAULT_SETTINGS.effects),
  };
}

export async function loadConfig(): Promise<AppConfig> {
  if (isTauri) {
    try {
      const cfg = await invoke<AppConfig | null>("load_config");
      if (cfg) return { settings: normalizeSettings(cfg.settings), window: cfg.window };
    } catch (err) {
      console.warn("[reborn-work] 读取配置失败，使用默认值", err);
    }
  }
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return { settings: normalizeSettings(JSON.parse(raw)) };
  } catch {
    /* 忽略损坏的本地缓存 */
  }
  return { settings: { ...DEFAULT_SETTINGS } };
}

export async function saveSettings(settings: Settings): Promise<void> {
  if (isTauri) {
    try {
      await invoke("save_settings", { settings });
    } catch (err) {
      console.warn("[reborn-work] 保存配置失败", err);
    }
  }
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(settings));
  } catch {
    /* 忽略 */
  }
}
