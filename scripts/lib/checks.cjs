"use strict";

/**
 * 计薪引擎断言集。
 *
 * 覆盖：需求文档附录 B 的全部 17 条 + 第 4 章的边界条件 + 健壮性。
 * 只依赖传入的引擎模块，因此同一套断言既能跑真实引擎，也能跑变异引擎。
 *
 * engine = { pay, types, format, holidays }
 */

function buildCases(engine) {
  const {
    getMonthInfo,
    getDayKind,
    getDayPlan,
    getMonthEarned,
    validateSettings,
    describeMonth,
    manualPaydays,
  } = engine.pay;
  const { DEFAULT_SETTINGS } = engine.types;
  const { floorTo, splitMoney, formatMoney, formatRate, formatPercent } = engine.format;
  const { HOLIDAYS } = engine.holidays;

  const cases = [];
  const check = (name, fn) => {
    cases.push({ name, fn });
  };

  // ── 小工具 ────────────────────────────────────────────────
  const at = (y, m, d, hh = 0, mi = 0, ss = 0) => new Date(y, m - 1, d, hh, mi, ss);
  const S = (patch) => ({ ...DEFAULT_SETTINGS, salary: 10000, paydaysOverride: null, ...(patch || {}) });
  const base = S();

  const eq = (actual, expected, label) => {
    if (actual !== expected) throw new Error(`${label}：期望 ${String(expected)}，实际 ${String(actual)}`);
  };
  const near = (actual, expected, label, tol = 0.005) => {
    if (typeof actual !== "number" || !Number.isFinite(actual) || Math.abs(actual - expected) > tol) {
      throw new Error(`${label}：期望 ${expected} ±${tol}，实际 ${String(actual)}`);
    }
  };
  const ok = (cond, label) => {
    if (!cond) throw new Error(label);
  };
  const planAt = (y, m, d, hh, mi, ss, settings) => getDayPlan(at(y, m, d, hh, mi, ss), settings || base);
  const hasErr = (patch, keyword) =>
    validateSettings(S(patch)).some((e) => e.includes(keyword));

  const DAILY = 10000 / 21; // 2026-11 日薪
  const PER_SEC = DAILY / 28800; // 有效工作 8 小时

  // ══ A. 2026-11 月度（附录 B 第 1–3 条）══════════════════
  const nov = getMonthInfo(at(2026, 11, 3, 10, 30), base);

  check("A1 2026-11 计薪天数 = 21", () => eq(nov.payDays, 21, "payDays"));
  check("A2 2026-11 休息日 = 9", () => eq(nov.restDays, 9, "restDays"));
  check("A3 2026-11 自然日 = 30", () => eq(nov.totalDays, 30, "totalDays"));
  check("A4 2026-11 无法定节假日", () => eq(nov.holidays.length, 0, "holidays.length"));
  check("A5 2026-11 日薪 = 476.19", () => near(planAt(2026, 11, 3, 10, 30).dailyWage, 476.19, "dailyWage"));
  check("A6 时薪 ≈ 59.52（日薪 ÷ 8h）", () => near(planAt(2026, 11, 3, 10, 30).hourlyWage, 59.52, "hourlyWage"));
  check("A7 每秒 ≈ 0.0165344", () => near(planAt(2026, 11, 3, 10, 30).perSecond, PER_SEC, "perSecond", 1e-9));
  check("A8 有效工作秒数 = 28800（8h）", () => eq(planAt(2026, 11, 3, 10, 30).workSecondsTotal, 28800, "workSecondsTotal"));

  // ══ B. 2026-11-03 全天时间轴（附录 B 第 4–11 条）════════
  const p1030 = planAt(2026, 11, 3, 10, 30);
  check("B1 10:30 状态 = working", () => eq(p1030.phase, "working", "phase"));
  check("B2 10:30 已赚 = 89.29", () => near(p1030.earned, 89.29, "earned"));
  check("B3 10:30 进度 = 18.75%", () => near(p1030.progress * 100, 18.75, "progress"));
  check("B4 10:30 距下班 = 6.5h", () => eq(p1030.remainingSeconds, 23400, "remainingSeconds"));
  check("B5 10:30 已工作 = 5400s", () => eq(p1030.workedSeconds, 5400, "workedSeconds"));

  const p0800 = planAt(2026, 11, 3, 8, 0);
  check("B6 08:00 状态 = before", () => eq(p0800.phase, "before", "phase"));
  check("B7 08:00 已赚 0", () => eq(p0800.earned, 0, "earned"));
  check("B8 08:00 距开工 = 1h", () => eq(p0800.untilStartSeconds, 3600, "untilStartSeconds"));

  check("B9 08:59:59 仍未开工", () => eq(planAt(2026, 11, 3, 8, 59, 59).phase, "before", "phase"));
  check("B10 09:00:00 整点开工，已赚 0", () => {
    const p = planAt(2026, 11, 3, 9, 0, 0);
    eq(p.phase, "working", "phase");
    eq(p.earned, 0, "earned");
    near(p.progress, 0, "progress", 1e-12);
  });
  check("B11 11:59:59 仍在 working", () => eq(planAt(2026, 11, 3, 11, 59, 59).phase, "working", "phase"));

  const p1200 = planAt(2026, 11, 3, 12, 0, 0);
  check("B12 12:00:00 进入午休", () => eq(p1200.phase, "lunch", "phase"));
  check("B13 12:00 冻结在 3h = 178.57", () => near(p1200.earned, 178.57, "earned"));

  const p1230 = planAt(2026, 11, 3, 12, 30);
  check("B14 12:30 状态 = lunch（附录 B 第 8 条）", () => eq(p1230.phase, "lunch", "phase"));
  check("B15 12:30 金额冻结 178.57（附录 B 第 9 条）", () => near(p1230.earned, 178.57, "earned"));
  check("B16 12:30 进度 37.5%", () => near(p1230.progress * 100, 37.5, "progress"));
  check("B17 12:59:59 仍在午休", () => eq(planAt(2026, 11, 3, 12, 59, 59).phase, "lunch", "phase"));

  const p1300 = planAt(2026, 11, 3, 13, 0, 0);
  check("B18 13:00:00 午休结束，回到 working", () => eq(p1300.phase, "working", "phase"));
  check("B19 13:00 金额未跳变", () => near(p1300.earned, 178.57, "earned"));
  check("B20 17:59:59 仍在 working", () => eq(planAt(2026, 11, 3, 17, 59, 59).phase, "working", "phase"));

  const p1800 = planAt(2026, 11, 3, 18, 0, 0);
  check("B21 18:00:00 整点下班", () => eq(p1800.phase, "after", "phase"));
  check("B22 18:00 拿到完整日薪", () => near(p1800.earned, 476.19, "earned"));
  check("B23 18:00 进度 100%", () => near(p1800.progress, 1, "progress", 1e-12));

  const p1900 = planAt(2026, 11, 3, 19, 0);
  check("B24 19:00 状态 = after（附录 B 第 11 条）", () => eq(p1900.phase, "after", "phase"));
  check("B25 19:00 已赚 = 日薪（不用乘法）", () => {
    near(p1900.earned, 476.19, "earned");
    eq(p1900.earned, p1900.dailyWage, "earned 必须严格等于 dailyWage");
  });
  check("B26 23:59 仍是 after", () => eq(planAt(2026, 11, 3, 23, 59, 59).phase, "after", "phase"));

  // ══ C. 休息日 / 节假日（附录 B 第 12–14 条）════════════
  const sunday = planAt(2026, 11, 8, 10, 0);
  check("C1 11-08 周日 → rest，已赚 0（附录 B 第 12 条）", () => {
    eq(sunday.kind, "rest", "kind");
    eq(sunday.phase, "rest", "phase");
    eq(sunday.earned, 0, "earned");
    near(sunday.progress, 0, "progress", 1e-12);
  });
  check("C2 11-07 周六 → rest", () => eq(planAt(2026, 11, 7, 10, 0).kind, "rest", "kind"));

  const nat = planAt(2026, 10, 1, 8, 0);
  check("C3 10-01 国庆 → holiday（附录 B 第 13 条）", () => {
    eq(nat.kind, "holiday", "kind");
    eq(nat.phase, "holiday", "phase");
    eq(nat.holidayName, "国庆节", "holidayName");
  });
  check("C4 节假日一早即拿满日薪 434.78", () => near(nat.earned, 434.78, "earned"));
  check("C5 节假日 earned 严格等于 dailyWage", () => eq(nat.earned, nat.dailyWage, "earned"));

  const oct = getMonthInfo(at(2026, 10, 1, 8, 0), base);
  check("C6 2026-10 计薪 23 天（10/3 周六国庆）", () => {
    eq(oct.payDays, 23, "payDays");
    eq(oct.holidayOnRestDays, 1, "holidayOnRestDays");
  });
  check("C7 2026-10 日薪 434.78", () => near(planAt(2026, 10, 1, 8, 0).dailyWage, 434.78, "dailyWage"));
  check("C8 10-03 周六仍是 holiday（优先级高于 rest）", () => {
    const p = planAt(2026, 10, 3, 12, 0);
    eq(p.kind, "holiday", "kind");
    near(p.earned, 434.78, "earned");
  });

  const may = getMonthInfo(at(2025, 5, 10, 0, 0), base);
  check("C9 2025-05 计薪 23 天（5/31 周六端午，附录 B 第 14 条）", () => {
    eq(may.payDays, 23, "payDays");
    eq(may.restDays, 9, "restDays");
    eq(may.holidayOnRestDays, 1, "holidayOnRestDays");
  });
  const sep = getMonthInfo(at(2026, 9, 10, 0, 0), base);
  check("C10 2026-09 中秋落在周五，不额外计薪 = 22", () => {
    eq(sep.payDays, 22, "payDays");
    eq(sep.holidayOnRestDays, 0, "holidayOnRestDays");
    eq(sep.holidays.length, 1, "holidays.length");
  });
  const feb = getMonthInfo(at(2026, 2, 10, 0, 0), base);
  check("C11 2026-02 春节 4 天全在工作日，计薪仍 20", () => {
    eq(feb.payDays, 20, "payDays");
    eq(feb.holidays.length, 4, "holidays.length");
    eq(feb.holidayOnRestDays, 0, "holidayOnRestDays");
  });

  // ══ D. 本月累计（4.5 / 附录 B 第 15 条）════════════════
  check("D1 11-03 10:30 本月累计 = 565.48（附录 B 第 15 条）", () => {
    near(getMonthEarned(at(2026, 11, 3, 10, 30), base, p1030.earned), 565.48, "monthEarned");
  });
  check("D2 11-01 周日本月累计 = 0", () => {
    eq(getMonthEarned(at(2026, 11, 1, 12, 0), base, 0), 0, "monthEarned");
  });
  check("D3 11-02 08:00 本月累计 = 0", () => {
    eq(getMonthEarned(at(2026, 11, 2, 8, 0), base, 0), 0, "monthEarned");
  });
  check("D4 11-02 19:00 本月累计 = 一个整日", () => {
    near(getMonthEarned(at(2026, 11, 2, 19, 0), base, planAt(2026, 11, 2, 19, 0).earned), 476.19, "monthEarned");
  });
  check("D5 节假日当天本月累计 = 日薪", () => {
    near(getMonthEarned(at(2026, 10, 1, 8, 0), base, nat.earned), 434.78, "monthEarned");
  });
  check("D6 10-02 19:00 本月累计 = 2 天", () => {
    const today = planAt(2026, 10, 2, 19, 0).earned;
    near(getMonthEarned(at(2026, 10, 2, 19, 0), base, today), 869.57, "monthEarned");
  });
  check("D7 10-03 19:00 本月累计 = 3 天（含周六国庆）", () => {
    const today = planAt(2026, 10, 3, 19, 0).earned;
    near(getMonthEarned(at(2026, 10, 3, 19, 0), base, today), 1304.35, "monthEarned");
  });
  check("D8 11-30 19:00 本月累计正好等于月薪", () => {
    const today = planAt(2026, 11, 30, 19, 0).earned;
    near(getMonthEarned(at(2026, 11, 30, 19, 0), base, today), 10000, "monthEarned", 0.01);
  });

  // ══ E. 手动计薪天数（F-21 / 附录 B 第 17 条）════════════
  const custom = planAt(2026, 11, 3, 10, 30, 0, S({ paydaysOverride: 22 }));
  check("E1 手动计薪 22 天 → 日薪 454.55（附录 B 第 17 条）", () => near(custom.dailyWage, 454.55, "dailyWage"));
  check("E2 手动计薪 22 天 → 时薪 56.82", () => near(custom.hourlyWage, 56.82, "hourlyWage"));
  check("E3 手动计薪 31 天 → 日薪 322.58", () => {
    near(planAt(2026, 11, 3, 10, 30, 0, S({ paydaysOverride: 31 })).dailyWage, 322.58, "dailyWage");
  });
  check("E4 非法手动手数回退自动（0 / 32 / 3.5 / NaN）", () => {
    for (const v of [0, 32, 3.5, NaN, -5]) {
      const info = getMonthInfo(at(2026, 11, 3), S({ paydaysOverride: v }));
      eq(info.payDays, 21, `override=${String(v)} 的 payDays`);
      eq(info.manual, false, `override=${String(v)} 的 manual`);
    }
  });
  check("E5 manualPaydays 只接受 1~31 的整数", () => {
    eq(manualPaydays(S({ paydaysOverride: 1 })), 1, "1");
    eq(manualPaydays(S({ paydaysOverride: 31 })), 31, "31");
    eq(manualPaydays(S({ paydaysOverride: null })), null, "null");
    eq(manualPaydays(S({ paydaysOverride: 0 })), null, "0");
    eq(manualPaydays(S({ paydaysOverride: 22.5 })), null, "22.5");
  });

  // ══ F. 参数校验（4.3 / 附录 B 第 16 条）════════════════
  check("F1 默认设置零错误", () => eq(validateSettings(base).length, 0, "errors"));
  check("F2 下班早于上班报错（附录 B 第 16 条）", () => ok(hasErr({ workStart: "18:00", workEnd: "09:00" }, "下班"), "未报错"));
  check("F3 上班 = 下班报错", () => ok(hasErr({ workStart: "09:00", workEnd: "09:00" }, "下班"), "未报错"));
  check("F4 时间格式非法报错", () => ok(hasErr({ workStart: "9点", workEnd: "18:00" }, "上班"), "未报错"));
  check("F5 月薪 0 / 负数 / NaN 报错", () => {
    for (const v of [0, -1, NaN]) ok(hasErr({ salary: v }, "月薪"), `月薪 ${String(v)} 未报错`);
  });
  check("F6 月薪超过 1 亿报错", () => ok(hasErr({ salary: 100000001 }, "月薪"), "未报错"));
  check("F7 午休结束早于开始报错", () => ok(hasErr({ lunchStart: "13:00", lunchEnd: "12:00" }, "午休"), "未报错"));
  check("F8 午休超出下班时间报错", () => ok(hasErr({ lunchStart: "12:00", lunchEnd: "19:00" }, "午休"), "未报错"));
  check("F9 午休早于上班时间报错", () => ok(hasErr({ lunchStart: "08:00", lunchEnd: "09:30" }, "午休"), "未报错"));
  check("F10 关闭午休后不再校验午休时间", () => {
    eq(validateSettings(S({ lunchEnabled: false, lunchStart: "xx", lunchEnd: "yy" })).length, 0, "errors");
  });
  check("F11 未选工作日报错", () => ok(hasErr({ workdays: [] }, "工作日"), "未报错"));
  check("F12 工作日取值越界报错", () => ok(hasErr({ workdays: [0] }, "工作日"), "未报错"));
  check("F13 工作日重复报错", () => ok(hasErr({ workdays: [1, 1, 2] }, "重复"), "未报错"));
  check("F14 计薪天数 0 / 32 报错", () => {
    ok(hasErr({ paydaysOverride: 0 }, "计薪天数"), "0 未报错");
    ok(hasErr({ paydaysOverride: 32 }, "计薪天数"), "32 未报错");
  });
  check("F15 计薪天数小数报错", () => ok(hasErr({ paydaysOverride: 22.5 }, "整数"), "未报错"));
  check("F16 小数位越界报错", () => ok(hasErr({ decimals: 4 }, "小数位"), "未报错"));
  check("F17 透明度越界报错", () => ok(hasErr({ opacity: 0.4 }, "透明度"), "未报错"));
  check("F18 紧贴上下班边界的午休合法", () => {
    eq(validateSettings(S({ lunchStart: "09:00", lunchEnd: "10:00" })).length, 0, "errors");
  });

  // ══ G. 显示精度（4.6）══════════════════════════════════
  check("G1 金额向下取整，不四舍五入", () => eq(floorTo(89.299, 2), 89.29, "floorTo"));
  check("G2 向下取整不受浮点噪声影响", () => eq(floorTo(0.1 + 0.2, 2), 0.3, "floorTo"));
  check("G3 0 位小数向下取整", () => eq(floorTo(0.999, 0), 0, "floorTo"));
  check("G4 拆分金额：整数部分带千分位", () => {
    const m = splitMoney(1842.96, 0);
    eq(m.int, "1,842", "int");
    eq(m.dec, "", "dec");
  });
  check("G5 金额格式化", () => {
    eq(formatMoney(476.190476, 2), "¥476.19", "2 位");
    eq(formatMoney(10000, 3), "¥10,000.000", "3 位");
    eq(formatMoney(0.5, 2), "¥0.50", "0.5");
    eq(formatMoney(1234.5, 0), "¥1,234", "0 位");
  });
  check("G6 小数字自适应精度", () => {
    eq(formatRate(120), "¥120.0", "≥100");
    eq(formatRate(59.5238), "¥59.52", "≥1");
    eq(formatRate(0.0165344), "¥0.017", "≥0.01");
    eq(formatRate(0.0012345), "¥0.0012", "<0.01");
  });
  check("G7 百分比", () => {
    eq(formatPercent(0.1875), "19%", "18.75%");
    eq(formatPercent(1.5), "100%", "越界封顶");
    eq(formatPercent(-1), "0%", "越界清零");
  });

  // ══ H. 健壮性与边界（F-52 / 第 7 章）══════════════════
  check("H1 非法时间字符串不崩溃、不产生 NaN", () => {
    const p = getDayPlan(at(2026, 11, 3, 10, 30), S({ workStart: "abc", workEnd: "??" }));
    ok(Number.isFinite(p.earned), `earned = ${p.earned}`);
    ok(Number.isFinite(p.perSecond), `perSecond = ${p.perSecond}`);
  });
  check("H2 未选工作日时不会除零", () => {
    const p = getDayPlan(at(2026, 11, 3, 10, 30), S({ workdays: [] }));
    eq(p.dailyWage, 0, "dailyWage");
    eq(p.perSecond, 0, "perSecond");
    eq(p.earned, 0, "earned");
    ok(Number.isFinite(p.progress), `progress = ${p.progress}`);
  });
  check("H3 月薪 0 时金额全为 0", () => {
    const p = getDayPlan(at(2026, 11, 3, 10, 30), S({ salary: 0 }));
    eq(p.earned, 0, "earned");
    eq(p.dailyWage, 0, "dailyWage");
  });
  check("H4 极端月薪 1 亿不溢出", () => {
    const p = getDayPlan(at(2026, 11, 3, 10, 30), S({ salary: 100000000 }));
    ok(Number.isFinite(p.perSecond) && p.perSecond > 0, `perSecond = ${p.perSecond}`);
    near(p.dailyWage, 100000000 / 21, "dailyWage", 0.01);
  });
  check("H5 午休恰好占满全天不会除零", () => {
    const p = getDayPlan(at(2026, 11, 3, 10, 30), S({ lunchStart: "09:00", lunchEnd: "18:00" }));
    eq(p.workSecondsTotal, 0, "workSecondsTotal");
    ok(Number.isFinite(p.earned), `earned = ${p.earned}`);
  });
  check("H6 跨年边界 2026-12-31 19:00 正常", () => {
    const p = planAt(2026, 12, 31, 19, 0);
    eq(p.phase, "after", "phase");
    ok(p.dailyWage > 0, "dailyWage 应大于 0");
  });
  check("H7 无节假日数据的年份按普通工作周计算", () => {
    const p = planAt(2027, 3, 10, 10, 30);
    eq(p.kind, "workday", "kind");
    ok(Number.isFinite(p.earned), "earned 应为数字");
  });
  check("H8 非整点秒级连续（同一秒内幂等）", () => {
    const a = planAt(2026, 11, 3, 10, 30, 0);
    const b = planAt(2026, 11, 3, 10, 30, 0);
    eq(a.earned, b.earned, "两次调用必须相等");
  });

  // ══ I. 月度结构自洽（2025-01 ~ 2026-12 全扫）══════════
  check("I1 每月 payDays + 非节假日休息日 = 自然日", () => {
    for (let y = 2025; y <= 2026; y++) {
      for (let m = 0; m < 12; m++) {
        const info = getMonthInfo(new Date(y, m, 15), base);
        const restWithoutHoliday = info.restDays - info.holidayOnRestDays;
        if (info.payDays + restWithoutHoliday !== info.totalDays) {
          throw new Error(`${y}-${m + 1}: ${info.payDays} + ${restWithoutHoliday} ≠ ${info.totalDays}`);
        }
        if (info.payDays < 1 || info.payDays > 31) throw new Error(`${y}-${m + 1}: payDays 越界 ${info.payDays}`);
        if (info.holidayOnRestDays > info.holidays.length) throw new Error(`${y}-${m + 1}: 休息日节假日数超过节假日总数`);
        ok(info.restDays > 0, `${y}-${m + 1}: 休息日应大于 0`);
      }
    }
  });
  check("I2 节假日表每一条都能被识别", () => {
    const keys = Object.keys(HOLIDAYS);
    ok(keys.length >= 20, `节假日条目过少：${keys.length}`);
    for (const key of keys) {
      const [y, m, d] = key.split("-").map(Number);
      const date = new Date(y, m - 1, d);
      ok(date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d, `${key} 不是合法日期`);
      const got = getDayKind(date, base);
      eq(got.kind, "holiday", `${key} 的 kind`);
      eq(got.holidayName, HOLIDAYS[key], `${key} 的名称`);
    }
  });
  check("I3 本月说明文案（F-32）", () => {
    eq(describeMonth(nov, base), "2026 年 11 月共 30 天，周末 9 天，法定节假日 0 天（照发）");
    eq(
      describeMonth(oct, base),
      "2026 年 10 月共 31 天，周末 9 天，法定节假日 3 天（照发）",
    );
  });

  return cases;
}

/**
 * 依次执行断言，返回 { name, ok, message } 列表。
 * 变异测试用这个函数，Vitest 用 buildCases() 逐条跑。
 */
function run(engine) {
  const results = [];
  for (const item of buildCases(engine)) {
    try {
      item.fn();
      results.push({ name: item.name, ok: true });
    } catch (err) {
      results.push({ name: item.name, ok: false, message: err && err.message ? err.message : String(err) });
    }
  }
  return results;
}

module.exports = { run, buildCases };
