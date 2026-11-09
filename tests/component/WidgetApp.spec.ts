import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

const mockSettings = vi.hoisted(() => ({ showStats: false }));

vi.mock("../../src/platform/config", async () => {
  const { DEFAULT_SETTINGS } = await import("../../src/core/types");
  return {
    isTauri: false,
    loadConfig: async () => ({ settings: { ...DEFAULT_SETTINGS, showStats: mockSettings.showStats } }),
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

import WidgetApp from "../../src/widget/WidgetApp.vue";
import * as windowApi from "../../src/platform/window";

afterEach(() => {
  vi.clearAllMocks();
});

describe("WidgetApp", () => {
  it("默认隐藏底部统计栏，只保留今日已赚", async () => {
    const wrapper = mount(WidgetApp);
    await flushPromises();

    expect(wrapper.find(".card").exists()).toBe(true);
    expect(wrapper.text()).toContain("今日已赚");
    expect(wrapper.find(".stats").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("时薪");
    expect(wrapper.find(".track").exists()).toBe(true);

    wrapper.unmount();
  });

  it("打开底部统计栏后渲染时薪 / 每秒 / 本月已赚三列", async () => {
    vi.resetModules();
    mockSettings.showStats = true;
    const { default: WidgetAppWithStats } = await import("../../src/widget/WidgetApp.vue");
    const wrapper = mount(WidgetAppWithStats);
    await flushPromises();

    expect(wrapper.find(".stats").exists()).toBe(true);
    expect(wrapper.text()).toContain("时薪");
    expect(wrapper.text()).toContain("每秒");
    expect(wrapper.text()).toContain("本月已赚");

    wrapper.unmount();
    mockSettings.showStats = false;
  });

  // 回归：v0.1.0 里右上角三个按钮只有置顶「看起来」有效，另外两个点了没反应。
  // 前端这条链路的契约是：点击必须真的调到窗口 API，一个都不能漏。
  it("标题栏三个按钮分别触发 置顶 / 打开设置 / 收进托盘", async () => {
    const wrapper = mount(WidgetApp);
    await flushPromises();

    const buttons = wrapper.findAll(".bar__actions button");
    expect(buttons).toHaveLength(3);

    await buttons[1].trigger("click");
    await flushPromises();
    expect(windowApi.openSettingsWindow).toHaveBeenCalledTimes(1);

    await buttons[2].trigger("click");
    await flushPromises();
    expect(windowApi.hideCurrentWindow).toHaveBeenCalledTimes(1);

    // 置顶是本地状态 + 窗口调用双写：点一下标题要翻转，同时把新值发给窗口
    const pin = () => wrapper.findAll(".bar__actions button")[0];
    const pinnedBefore = pin().attributes("title") === "取消置顶";

    await pin().trigger("click");
    await flushPromises();
    expect(windowApi.setCurrentWindowAlwaysOnTop).toHaveBeenCalledWith(!pinnedBefore);
    expect(pin().attributes("title")).toBe(pinnedBefore ? "窗口置顶" : "取消置顶");

    wrapper.unmount();
  });
});
