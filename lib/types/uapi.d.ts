import type { WeatherSnapshot } from './weather.ts';
/** 一次 UAPI 查询的结果：城市与快照；城市来自上游（IP 定位或城市名回显）。 */
export interface UapiEnvironment {
    /** 省 / 州，如“江西省”。 */
    readonly region: string;
    /** 市，如“南昌市”。 */
    readonly city: string;
    /** 已换算成现有快照形状的当前天气。 */
    readonly weather: WeatherSnapshot;
}
/** 清空缓存与进行中的请求。 @internal 仅测试使用。 */
export declare function resetUapiCache(): void;
/** 可注入的依赖（测试用）。 */
export interface UapiDeps {
    /** 注入的 fetch；缺省用全局 fetch。 */
    readonly fetchImpl?: typeof fetch;
    /** 注入的等待（重试间隔）；缺省用 setTimeout。 */
    readonly sleep?: (ms: number) => Promise<void>;
    /** 注入的时钟（ms）；缺省 `Date.now`，用于缓存与相对时间换算。 */
    readonly now?: () => number;
    /** 跳过缓存强制重查（右键「查询天气」走这条）。 */
    readonly force?: boolean;
    /** 用户配置的城市；非空则按它查，不再由上游按 IP 定位。 */
    readonly city?: string;
}
/**
 * 查一次自动定位的城市与天气。
 *
 * @param deps - 注入的 fetch、等待、时钟与 force。
 * @returns 城市与快照；上游不可用或字段不全时为 null（调用方回落）。
 */
export declare function fetchUapiWeather(deps?: UapiDeps): Promise<UapiEnvironment | null>;
