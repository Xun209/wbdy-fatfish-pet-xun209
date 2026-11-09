import type { RankedEntry } from './entries.ts';
/** 年内日序号（0 起，按 UTC 计算，闰年自然正确）——假期区间比较用它。 */
export declare function dayOfYear(date: Date): number;
/** '月-日' → 该年内的日序号（0 起）。 */
export declare function dayOfYearOf(year: number, monthDay: string): number;
/** 某一天命中的全部条目（公历、农历、除夕三类；假期区间不按天查，另行处理）。 */
export declare function entriesAt(date: Date): RankedEntry[];
