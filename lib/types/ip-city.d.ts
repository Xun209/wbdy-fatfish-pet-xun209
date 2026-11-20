/** 一次定位可注入的依赖（测试用）。 */
export interface LocateCityDeps {
    /** 注入的 fetch；缺省用全局 fetch。 */
    readonly fetchImpl?: typeof fetch;
    /** 注入的等待（重试间隔）；缺省用 setTimeout。 */
    readonly sleep?: (ms: number) => Promise<void>;
    /** 注入的时钟（ms）；缺省 `Date.now`，用于缓存判定。 */
    readonly now?: () => number;
    /** 跳过缓存读取强制重查；成功后照旧覆盖缓存，失败不动旧值。 */
    readonly force?: boolean;
}
/** 定位结果：只有 IP 库给出的大致位置。 */
export interface CityLocation {
    /** 城市名；ip-api 给中文，ipwho.is 给英文。 */
    readonly city: string;
    /** 一级行政区（省 / 州）；两家都可能给空串。 */
    readonly region: string;
    /** 国家名。 */
    readonly country: string;
}
/** 清空缓存与进行中的请求。 @internal 仅测试使用。 */
export declare function resetCityCache(): void;
/**
 * 定位当前出口 IP 所在城市。
 *
 * @param deps - 可注入的 fetch、等待与时钟。
 * @returns 城市信息；两个端点都失败或返回不可用时为 null。
 */
export declare function locateCity(deps?: LocateCityDeps): Promise<CityLocation | null>;
