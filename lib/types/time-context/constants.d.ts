/**
 * 时段与星期：把小时数翻成中文时段，把星期几翻成工作日/周末。
 *
 * 纯换算，不含节日表；时间一律取 Date 的本地字段（跟用户时区走）。
 * 必须始终成立：时段区间首尾相接且全覆盖 0–23 点。
 * @module dsh-pet/src/host/time-context/constants
 */
/** 时段文案：一天分 9 档（划分见 SLOTS）。 */
export type TimeSlot = '凌晨' | '清晨' | '早上' | '上午' | '中午' | '下午' | '傍晚' | '晚上' | '深夜';
/** 星期文案：索引 = Date.getDay()（0 = 周日）。 */
export declare const WEEKDAYS: readonly ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
/** 一天毫秒数（日期算术用 UTC 毫秒，避开本地时区）。 */
export declare const DAY_MS = 86400000;
/** 缺省窗口：提前 3 天预热、本身 1 天、过后 3 天回味。 */
export declare const DEFAULT_AHEAD = 3;
export declare const DEFAULT_SPAN = 1;
export declare const DEFAULT_AFTER = 3;
/** 假期区间的窗口：提前 3 天预热、末尾 3 天说「快结束了」、结束后 3 天回味。 */
export declare const SEASON_AHEAD = 3;
export declare const SEASON_ENDING_AHEAD = 3;
export declare const SEASON_AFTER = 3;
/** 两位补零（只用于时分；月/日刻意不补零——中文写「2月17日」比「02月17日」自然）。 */
export declare function pad2(n: number): string;
/**
 * 小时 → 时段。
 * @param hour - 小时数（来自 Date.getHours()，正常为 0–23）。
 * @returns 对应时段；越界或 NaN（异常输入）按「凌晨」兜底、绝不抛错——提示词路径不能因为时间格式问题失败。
 */
export declare function timeSlotOf(hour: number): TimeSlot;
/**
 * 星期几 → 工作日 / 周末（周六周日算周末；与余额低谷判定同一口径，见 balance/deepseek-common.ts）。
 * @param day - Date.getDay()（0 = 周日）。
 * @returns 「周末」（周六/周日）或「工作日」。
 */
export declare function dayKindOf(day: number): '工作日' | '周末';
