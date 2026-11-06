import { HOLIDAYS } from "./holidays";
import { dateKey, daysInMonth, isoWeekday, parseHM, secondsOfDay } from "./date";
import type { Settings, Workday } from "./types";

/** 一周默认工作日（周一~周五），用于判断「休息日」该叫周末还是休息日 */
const DEFAULT_WORKDAYS: Workday[] = [1, 2, 3, 4, 5];

export type DayKind = "workday" | "holiday" | "rest";

export type Phase = "before" | "working" | "lunch" | "after" | "holiday" | "rest";

export interface MonthInfo {
  year: number;
  /** 0 起 */
  month: number;
  totalDays: number;
  /** 计薪天数（工作日 ∪ 法定节假日） */
  payDays: number;
  /** 不参与计薪的休息日 */
  restDays: number;
  /** 本月法定节假日名称（去重前按天记录） */
  holidays: { day: number; name: string }[];
  /** 本月有几个法定节假日落在休息日（因此额外计入计薪天数） */
  holidayOnRestDays: number;
  /** 用户是否手动覆盖了计薪天数 */
  manual: boolean;
}

export interface DayPlan {
  kind: DayKind;
  phase: Phase;
  holidayName?: string;
  month: MonthInfo;
  /** 日薪 */
  dailyWage: number;
  /** 时薪 = 日薪 ÷ 有效工作小时 */
  hourlyWage: number;
  /** 每秒入账 */
  perSecond: number;
  /** 今日已赚 */
  earned: number;
  /** 今日进度 0 ~ 1 */
  progress: number;
  workedSeconds: number;
  workSecondsTotal: number;
  /** 距离下班剩余秒数 */
  remainingSeconds: number;
  /** 距离上班剩余秒数（仅 before 阶段） */
  untilStartSeconds: number;
  /** 上班 / 下班 / 午休的秒数刻度，用于时间轴 */
  startSecond: number;
  endSecond: number;
  lunchStartSecond: number | null;
  lunchEndSecond: number | null;
}

interface Segment {
  start: number;
  end: number;
}

/**
 * 手动计薪天数只在「1 ~ 31 的整数」时才生效；其余情况一律回退自动计算，
 * 避免 0 / 32 / NaN / 小数把日薪算成 0 或变成 NaN。
 */
export function manualPaydays(settings: Settings): number | null {
  const raw = settings.paydaysOverride;
  if (raw == null || !Number.isFinite(raw)) return null;
  if (!Number.isInteger(raw)) return null;
  if (raw < 1 || raw > 31) return null;
  return raw;
}

/** 当月计薪天数：工作日 + 落在休息日的法定节假日 */
export function getMonthInfo(date: Date, settings: Settings): MonthInfo {
  const year = date.getFullYear();
  const month = date.getMonth();
  const totalDays = daysInMonth(date);
  const holidays: { day: number; name: string }[] = [];
  let autoPayDays = 0;
  let restDays = 0;
  let holidayOnRestDays = 0;

  for (let day = 1; day <= totalDays; day++) {
    const d = new Date(year, month, day);
    const isWorkday = settings.workdays.includes(isoWeekday(d) as Workday);
    const holidayName = HOLIDAYS[dateKey(d)];
    if (holidayName) holidays.push({ day, name: holidayName });
    if (isWorkday) {
      autoPayDays++;
    } else {
      restDays++;
      if (holidayName) {
        // 法定节假日落在周末：仍然计薪（"法定节假日计算在内"）
        autoPayDays++;
        holidayOnRestDays++;
      }
    }
  }

  const manualDays = manualPaydays(settings);
  return {
    year,
    month,
    totalDays,
    payDays: manualDays ?? autoPayDays,
    restDays,
    holidays,
    holidayOnRestDays,
    manual: manualDays != null,
  };
}

/**
 * 设置页「本月计薪说明」的文案（F-32）。
 * 例：2026 年 11 月共 30 天，周末 9 天，法定节假日 0 天（照发）
 */
export function describeMonth(month: MonthInfo, settings: Settings): string {
  const isDefaultWeek = DEFAULT_WORKDAYS.every((d) => settings.workdays.includes(d))
    && settings.workdays.length === DEFAULT_WORKDAYS.length;
  const restLabel = isDefaultWeek ? "周末" : "休息日";
  return `${month.year} 年 ${month.month + 1} 月共 ${month.totalDays} 天，${restLabel} ${month.restDays} 天，法定节假日 ${month.holidays.length} 天（照发）`;
}

/** 当天的计薪日类型（扣除调休影响前的简单口径） */
export function getDayKind(date: Date, settings: Settings): { kind: DayKind; holidayName?: string } {
  const holidayName = HOLIDAYS[dateKey(date)];
  const isWorkday = settings.workdays.includes(isoWeekday(date) as Workday);
  if (holidayName) return { kind: "holiday", holidayName };
  return { kind: isWorkday ? "workday" : "rest" };
}

/** 把上下班 + 午休切成若干「真正在挣钱」的区间（单位：当天秒数） */
function buildSegments(settings: Settings): { segments: Segment[]; start: number; end: number; lunchStart: number | null; lunchEnd: number | null } {
  const startMin = parseHM(settings.workStart) ?? 9 * 60;
  const endMin = parseHM(settings.workEnd) ?? 18 * 60;
  const start = startMin * 60;
  const end = Math.max(start, endMin * 60);

  let lunchStart: number | null = null;
  let lunchEnd: number | null = null;
  let segments: Segment[] = [{ start, end }];

  if (settings.lunchEnabled) {
    const lsMin = parseHM(settings.lunchStart);
    const leMin = parseHM(settings.lunchEnd);
    if (lsMin != null && leMin != null && leMin > lsMin) {
      const ls = Math.max(start, lsMin * 60);
      const le = Math.min(end, leMin * 60);
      if (le > ls) {
        lunchStart = ls;
        lunchEnd = le;
        segments = [
          { start, end: ls },
          { start: le, end },
        ].filter((s) => s.end > s.start);
      }
    }
  }

  return { segments, start, end, lunchStart, lunchEnd };
}

/** 当天到此刻为止，已经"在挣钱"的秒数 */
function workedSecondsAt(nowSecond: number, segments: Segment[]): number {
  let sum = 0;
  for (const seg of segments) {
    const from = Math.max(seg.start, 0);
    const to = Math.min(nowSecond, seg.end);
    if (to > from) sum += to - from;
  }
  return sum;
}

/** 根据当前时刻算出小组件需要的一切 */
export function getDayPlan(now: Date, settings: Settings): DayPlan {
  const month = getMonthInfo(now, settings);
  const dailyWage = month.payDays > 0 ? Math.max(0, settings.salary) / month.payDays : 0;
  const { segments, start, end, lunchStart, lunchEnd } = buildSegments(settings);
  const totalSeconds = segments.reduce((acc, s) => acc + (s.end - s.start), 0);
  const perSecond = totalSeconds > 0 ? dailyWage / totalSeconds : 0;
  const hourlyWage = totalSeconds > 0 ? dailyWage / (totalSeconds / 3600) : 0;
  const nowSecond = secondsOfDay(now);
  const { kind, holidayName } = getDayKind(now, settings);

  const base = {
    month,
    dailyWage,
    hourlyWage,
    perSecond,
    workSecondsTotal: totalSeconds,
    startSecond: start,
    endSecond: end,
    lunchStartSecond: lunchStart,
    lunchEndSecond: lunchEnd,
  };

  if (kind === "holiday") {
    return {
      ...base,
      kind,
      holidayName,
      phase: "holiday",
      earned: dailyWage,
      progress: 1,
      workedSeconds: totalSeconds,
      remainingSeconds: 0,
      untilStartSeconds: 0,
    };
  }

  if (kind === "rest") {
    return {
      ...base,
      kind,
      phase: "rest",
      earned: 0,
      progress: 0,
      workedSeconds: 0,
      remainingSeconds: 0,
      untilStartSeconds: 0,
    };
  }

  const worked = workedSecondsAt(nowSecond, segments);
  const clampedWorked = Math.min(worked, totalSeconds);
  const earned = Math.min(dailyWage, clampedWorked * perSecond);

  if (nowSecond < start) {
    return {
      ...base,
      kind,
      phase: "before",
      earned: 0,
      progress: 0,
      workedSeconds: 0,
      remainingSeconds: totalSeconds,
      untilStartSeconds: start - nowSecond,
    };
  }

  if (nowSecond >= end) {
    return {
      ...base,
      kind,
      phase: "after",
      earned: dailyWage,
      progress: 1,
      workedSeconds: totalSeconds,
      remainingSeconds: 0,
      untilStartSeconds: 0,
    };
  }

  const inLunch = lunchStart != null && lunchEnd != null && nowSecond >= lunchStart && nowSecond < lunchEnd;
  const remaining = Math.max(0, totalSeconds - clampedWorked);

  return {
    ...base,
    kind,
    phase: inLunch ? "lunch" : "working",
    earned,
    progress: totalSeconds > 0 ? clampedWorked / totalSeconds : 0,
    workedSeconds: clampedWorked,
    remainingSeconds: remaining,
    untilStartSeconds: 0,
  };
}

/** 本月累计已赚（含今天） */
export function getMonthEarned(now: Date, settings: Settings, todayEarned: number): number {
  const month = getMonthInfo(now, settings);
  const dailyWage = month.payDays > 0 ? Math.max(0, settings.salary) / month.payDays : 0;
  const today = now.getDate();
  let sum = 0;
  for (let day = 1; day < today; day++) {
    const { kind } = getDayKind(new Date(now.getFullYear(), now.getMonth(), day), settings);
    if (kind === "workday" || kind === "holiday") sum += dailyWage;
  }
  return sum + todayEarned;
}

/** 校验设置，返回错误信息列表（空数组 = 可以保存） */
export function validateSettings(settings: Settings): string[] {
  const errors: string[] = [];

  // 月薪：> 0 且 ≤ 1 亿（F-20）
  if (!Number.isFinite(settings.salary) || settings.salary <= 0) {
    errors.push("月薪需要大于 0");
  } else if (settings.salary > 100_000_000) {
    errors.push("月薪不能超过 1 亿元");
  }

  // 手动计薪天数：1 ~ 31 的整数，或 null 表示自动（F-21）
  const od = settings.paydaysOverride;
  if (od != null) {
    if (!Number.isFinite(od)) errors.push("计薪天数需要是数字");
    else if (!Number.isInteger(od)) errors.push("计薪天数需要是整数");
    else if (od < 1 || od > 31) errors.push("计薪天数需要在 1 ~ 31 之间");
  }

  // 上下班：格式合法且上班严格早于下班（F-22 / F-23）
  const start = parseHM(settings.workStart);
  const end = parseHM(settings.workEnd);
  if (start == null) errors.push("上班时间格式不正确");
  if (end == null) errors.push("下班时间格式不正确");
  if (start != null && end != null && end <= start) errors.push("下班时间需要晚于上班时间");

  // 午休：必须完整落在 [上班, 下班] 区间内（F-25 / 4.3）
  if (settings.lunchEnabled) {
    const ls = parseHM(settings.lunchStart);
    const le = parseHM(settings.lunchEnd);
    if (ls == null || le == null) errors.push("午休时间格式不正确");
    else if (le <= ls) errors.push("午休结束时间需要晚于开始时间");
    else if (start != null && end != null && (ls < start || le > end)) {
      errors.push("午休时间需要完整落在上下班时间内");
    }
  }

  // 工作日：至少一天、取值 1~7、不重复（F-26）
  if (settings.workdays.length === 0) {
    errors.push("至少选择一个工作日");
  } else {
    if (settings.workdays.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) {
      errors.push("工作日取值不合法");
    }
    if (new Set(settings.workdays).size !== settings.workdays.length) {
      errors.push("工作日不能重复");
    }
  }

  // 显示相关
  if (![0, 1, 2, 3].includes(settings.decimals)) errors.push("小数位只能是 0 / 1 / 2 / 3");
  if (!Number.isFinite(settings.opacity) || settings.opacity < 0.5 || settings.opacity > 1) {
    errors.push("透明度需要在 50% ~ 100% 之间");
  }

  return errors;
}
