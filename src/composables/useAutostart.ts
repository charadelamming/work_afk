import { applyAutostart } from "../platform/autostart";

/** 开机自启开关 */
export function useAutostart() {
  return { apply: applyAutostart };
}
