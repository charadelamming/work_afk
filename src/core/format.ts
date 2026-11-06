/** 金额展示：向下取整，避免"还没赚到就先显示" */

export function floorTo(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.floor(value * factor + 1e-6) / factor;
}

export function withComma(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export interface MoneyParts {
  int: string;
  dec: string;
}

export function splitMoney(value: number, decimals: number): MoneyParts {
  const fixed = floorTo(Math.max(0, value), decimals).toFixed(decimals);
  const [intRaw, decRaw = ""] = fixed.split(".");
  return { int: withComma(intRaw), dec: decRaw };
}

export function formatMoney(value: number, decimals: number): string {
  const { int, dec } = splitMoney(value, decimals);
  return decimals > 0 ? `¥${int}.${dec}` : `¥${int}`;
}

/** 每秒/时薪这类小数字，按数量级自动加精度 */
export function formatRate(value: number): string {
  if (!Number.isFinite(value)) return "¥0";
  if (value >= 100) return `¥${value.toFixed(1)}`;
  if (value >= 1) return `¥${value.toFixed(2)}`;
  if (value >= 0.01) return `¥${value.toFixed(3)}`;
  return `¥${value.toFixed(4)}`;
}

export function formatPercent(ratio: number): string {
  return `${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%`;
}
