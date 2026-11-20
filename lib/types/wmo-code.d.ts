/** WMO 天气码 → 中文短语；表里没有的码返回“未知天气”，不猜。 */
/**
 * 天气码换中文。
 * @param code - WMO 4677 天气码。
 * @returns 对应说法；未收录的码返回“未知天气”。
 */
export declare function wmoText(code: number): string;
