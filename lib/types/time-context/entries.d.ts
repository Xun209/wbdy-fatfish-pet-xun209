/** 节日/假期条目的公共字段。 */
interface EntryBase {
    /** 正式名：节前/节中/节后措辞用它（「快要过春节了」「还在春节假期里」） */
    name: string;
    /** 当天的口语名：用于「今天是…」；缺省 = 用 name */
    spoken?: string;
    ahead?: number;
    span?: number;
    after?: number;
}
/** 节日/假期条目（判别联合：公历日 / 农历日 / 除夕 / 假期区间）。 */
export type Entry = EntryBase & ({
    kind: 'solar';
    key: string;
} | {
    kind: 'lunar';
    key: string;
} | {
    kind: 'lunarEve';
} | {
    kind: 'season';
    from: string;
    to: string;
});
/** 带优先级的条目（priority = 在 PRIORITY 里的下标，越小越优先）。 */
export interface RankedEntry {
    entry: Entry;
    priority: number;
}
/** 公历 / 农历 / 除夕 / 假期区间的索引（模块加载时按 PRIORITY 建一次）。 */
export declare const SOLAR_INDEX: Map<string, RankedEntry>;
export declare const LUNAR_INDEX: Map<string, RankedEntry>;
export declare const SEASON_ENTRIES: Array<RankedEntry & {
    from: string;
    to: string;
}>;
export declare let LUNAR_EVE: RankedEntry | undefined;
/** 候选从句（连同优先级） */
export interface Candidate {
    clause: string;
    priority: number;
}
/** 农历月日（ICU 换算结果） */
export interface LunarParts {
    /** 农历月：1–12；闰月取负（闰六月 = -6），与平月区分开 */
    month: number;
    /** 农历日：1–30 */
    day: number;
}
export declare const MAX_AHEAD: number;
export declare const MAX_LOOKBACK: number;
export {};
