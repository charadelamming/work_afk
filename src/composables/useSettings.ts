import { computed, onUnmounted, reactive } from "vue";

import { DEFAULT_SETTINGS, type Settings } from "../core/types";
import { loadConfig, saveSettings as persistSettings } from "../platform/config";
import { subscribeSettings } from "../platform/events";

interface SettingsState {
  settings: Settings | null;
  loading: boolean;
}

/**
 * 当前窗口内的共享设置状态。
 *
 * 两个 Tauri 窗口是两个独立运行时，模块级单例只在各自窗口内有效；
 * 跨窗口仍然通过 Tauri event / BroadcastChannel 同步。
 */
const state = reactive<SettingsState>({
  settings: null,
  loading: true,
});

let loadPromise: Promise<void> | null = null;

function ensureLoaded(): Promise<void> {
  if (!loadPromise) {
    loadPromise = loadConfig()
      .then((cfg) => {
        state.settings = cfg.settings;
      })
      .finally(() => {
        state.loading = false;
      });
  }
  return loadPromise;
}

export function useSettings(options: { subscribe?: boolean } = {}) {
  if (options.subscribe) {
    const stop = subscribeSettings((next) => {
      state.settings = next;
    });
    onUnmounted(stop);
  }

  void ensureLoaded();

  const settings = computed(() => state.settings);
  const loading = computed(() => state.loading);

  function patch<K extends keyof Settings>(key: K, value: Settings[K]): void {
    if (!state.settings) return;
    state.settings = { ...state.settings, [key]: value };
  }

  async function save(): Promise<void> {
    if (!state.settings) return;
    await persistSettings(state.settings);
  }

  function reset(): void {
    state.settings = { ...DEFAULT_SETTINGS };
  }

  return { settings, loading, patch, save, reset };
}
