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
  openSettingsWindow: vi.fn(),
  closeCurrentWindow: vi.fn(),
}));

import WidgetApp from "../../src/widget/WidgetApp.vue";

afterEach(() => {
  vi.clearAllMocks();
});

describe("WidgetApp", () => {
  it("渲染金额、状态和三列统计", async () => {
    const wrapper = mount(WidgetApp);
    await flushPromises();

    expect(wrapper.find(".card").exists()).toBe(true);
    expect(wrapper.text()).toContain("今日已赚");
    expect(wrapper.text()).toContain("时薪");
    expect(wrapper.text()).toContain("每秒");
    expect(wrapper.text()).toContain("本月已赚");
    expect(wrapper.find(".track").exists()).toBe(true);

    wrapper.unmount();
  });
});
