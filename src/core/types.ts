/** 一周中的第几天，周一 = 1，周日 = 7 */
export type Workday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type Decimals = 0 | 1 | 2 | 3;

export interface Settings {
  /** 月薪（税后到手口径，由用户自行决定） */
  salary: number;
  /** 手动指定当月计薪天数；null 表示自动计算 */
  paydaysOverride: number | null;
  /** 上班时间 HH:mm */
  workStart: string;
  /** 下班时间 HH:mm */
  workEnd: string;
  /** 是否扣除午休 */
  lunchEnabled: boolean;
  lunchStart: string;
  lunchEnd: string;
  /** 每周哪些天上班 */
  workdays: Workday[];
  /** 金额小数位 */
  decimals: Decimals;
  /** 卡片不透明度 0.55 ~ 1 */
  opacity: number;
  /** 窗口置顶 */
  alwaysOnTop: boolean;
  /** 开机自启 */
  autostart: boolean;
  /** 里程碑特效 */
  effects: boolean;
  /** 是否显示底部「时薪 / 每秒 / 本月已赚」统计栏 */
  showStats: boolean;
}

export interface WindowPos {
  x: number;
  y: number;
}

export interface AppConfig {
  settings: Settings;
  window?: WindowPos;
}

export const DEFAULT_SETTINGS: Settings = {
  salary: 10000,
  paydaysOverride: null,
  workStart: "09:00",
  workEnd: "18:00",
  lunchEnabled: true,
  lunchStart: "12:00",
  lunchEnd: "13:00",
  workdays: [1, 2, 3, 4, 5],
  decimals: 2,
  opacity: 0.94,
  alwaysOnTop: true,
  autostart: false,
  effects: true,
  showStats: false,
};

export const WORKDAY_LABELS: Record<Workday, string> = {
  1: "一",
  2: "二",
  3: "三",
  4: "四",
  5: "五",
  6: "六",
  7: "日",
};
