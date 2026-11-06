import {
  hideCurrentWindow,
  openSettingsWindow,
  setCurrentWindowAlwaysOnTop,
  showCurrentWindow,
} from "../platform/window";

/** 当前窗口的显示 / 隐藏 / 置顶 / 打开设置 */
export function useWindowChrome() {
  return {
    show: showCurrentWindow,
    hide: hideCurrentWindow,
    setAlwaysOnTop: setCurrentWindowAlwaysOnTop,
    openSettings: openSettingsWindow,
  };
}
