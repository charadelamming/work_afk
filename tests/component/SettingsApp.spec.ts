import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/platform/config", async () => {
  const { DEFAULT_SETTINGS } = await import("../../src/core/types");
  return {
    isTauri: false,
    loadConfig: async () => ({ settings: { ...DEFAULT_SETTINGS } }),
    saveSettings: vi.fn(async () => {}),
    normalizeSettings: (raw: unknown) => raw,
  };
});

vi.mock("../../src/platform/events", () => ({
  broadcastSettings: vi.fn(),
  subscribeSettings: vi.fn(() => () => {}),
}));

vi.mock("../../src/platform/window", () => ({
  showCurrentWindow: vi.fn(),
  hideCurrentWindow: vi.fn(),
  setCurrentWindowAlwaysOnTop: vi.fn(),
  resizeCurrentWindow: vi.fn(),
  openSettingsWindow: vi.fn(),
  closeCurrentWindow: vi.fn(),
}));

vi.mock("../../src/platform/autostart", () => ({
  applyAutostart: vi.fn(),
}));

import SettingsApp from "../../src/settings/SettingsApp.vue";

afterEach(() => {
  vi.clearAllMocks();
});

describe("SettingsApp", () => {
  it("渲染三张设置卡片和底部操作条", async () => {
    const wrapper = mount(SettingsApp);
    await flushPromises();

    expect(wrapper.text()).toContain("薪资待遇");
    expect(wrapper.text()).toContain("工作时间");
    expect(wrapper.text()).toContain("显示与行为");
    expect(wrapper.text()).toContain("底部统计栏");
    expect(wrapper.text()).toContain("恢复默认");
    expect(wrapper.text()).toContain("完成");
    expect(wrapper.find(".set-foot").exists()).toBe(true);

    wrapper.unmount();
  });
});
