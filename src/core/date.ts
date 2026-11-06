/** 纯日期 / 时间小工具，全部按本地时区处理（不碰 UTC，避免跨时区偏移） */

const pad2 = (n: number) => String(n).padStart(2, "0");

/** 本地日期键：YYYY-MM-DD */
export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** ISO 周几：周一 = 1 … 周日 = 7 */
export function isoWeekday(d: Date): number {
  return ((d.getDay() + 6) % 7) + 1;
}

/** "HH:mm" -> 从 0 点开始的分钟数；非法输入返回 null */
export function parseHM(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** 从 0 点开始的秒数 */
export function secondsOfDay(d: Date): number {
  return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
}

/** 秒数 -> HH:MM:SS */
export function formatHMS(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${pad2(h)}:${pad2(m)}:${pad2(sec)}`;
}

/** 秒数 -> "HH:mm"（用于时间轴标签） */
export function formatHMFromSeconds(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${pad2(Math.floor(s / 3600) % 24)}:${pad2(Math.floor((s % 3600) / 60))}`;
}

export function daysInMonth(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

/** 本月第几天（1 起） */
export function dayOfMonth(d: Date): number {
  return d.getDate();
}

export const MONTH_NAMES = [
  "一月", "二月", "三月", "四月", "五月", "六月",
  "七月", "八月", "九月", "十月", "十一月", "十二月",
];

export function monthLabel(d: Date): string {
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月`;
}
