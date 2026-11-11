import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";

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
  subscribeCheckUpdate: vi.fn(() => () => {}),
}));

vi.mock("../../src/platform/updater", () => ({
  currentVersion: vi.fn(async () => "0.1.0"),
  checkUpdate: vi.fn(async () => ({ kind: "none" as const })),
  checkForUpdate: vi.fn(async () => null),
  downloadUpdate: vi.fn(async () => true),
  installAndRelaunch: vi.fn(async () => {}),
  takePendingUpdateCheck: vi.fn(async () => false),
  startAutoUpdateCheck: vi.fn(() => () => {}),
  shouldCheckNow: vi.fn(() => true),
  markChecked: vi.fn(),
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

  it("关于区显示版本号，检查无更新时提示已是最新", async () => {
    const wrapper = mount(SettingsApp);
    await flushPromises();

    expect(wrapper.text()).toContain("关于");
    expect(wrapper.text()).toContain("版本 0.1.0");

    const button = findButton(wrapper, "检查更新");
    expect(button).toBeTruthy();
    await button!.trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("已是最新版本");
    wrapper.unmount();
  });

  it("发现新版本时自动下载并提示重启", async () => {
    const updater = await import("../../src/platform/updater");
    (updater.checkUpdate as unknown as Mock).mockResolvedValueOnce({
      kind: "available",
      version: "0.1.1",
      notes: "",
    });

    const wrapper = mount(SettingsApp);
    await flushPromises();

    await findButton(wrapper, "检查更新")!.trigger("click");
    await flushPromises();

    expect(updater.downloadUpdate).toHaveBeenCalled();
    expect(wrapper.text()).toContain("已就绪");
    expect(findButton(wrapper, "立即重启")).toBeTruthy();
    wrapper.unmount();
  });
});

function findButton(wrapper: VueWrapper, label: string) {
  return wrapper.findAll("button").find((item) => item.text() === label);
}
