/**
 * 日历格的纯计算：某年某月排成 7 列几行、哪些格子属于前后月。
 *
 * 不碰 DOM 与当前时间；周一起算的列偏移与补位规则由测试钉住。
 * @module dsh-pet/src/shared/todo/calendar
 */
/** 日历格：某年某月的 7 列网格，含前后月补位。 */
export interface MonthCell {
    /** 该格对应的日期；可能属于上/下月。 */
    readonly date: Date;
    /** 是否不属于本月（渲染成浅色）。 */
    readonly out: boolean;
}
/**
 * 某个月的日历格：从周一起算，补满最后一整周。
 *
 * @param year - 四位年份。
 * @param month - 0 起的月份。
 * @returns 行优先的格子，长度是 7 的倍数（通常是 5 行，跨 6 周的月份 6 行）。
 */
export declare function monthCells(year: number, month: number): MonthCell[];
