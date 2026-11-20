/** 一次查询可注入的依赖（测试用）。 */
export interface QueryWeatherDeps {
    /** 注入的 fetch；缺省用全局 fetch。 */
    readonly fetchImpl?: typeof fetch;
    /** 注入的等待（重试间隔）；缺省用 setTimeout。 */
    readonly sleep?: (ms: number) => Promise<void>;
    /** 注入的时钟（ms）；缺省 `Date.now`，用于缓存判定。 */
    readonly now?: () => number;
    /** 跳过坐标与天气两级缓存的读取强制重查；成功后照旧覆盖缓存，失败不动旧值。 */
    readonly force?: boolean;
}
/** 当前天气快照，字段全部来自 Open-Meteo 的 `current` 段。 */
export interface WeatherSnapshot {
    /** 城市名，取地名搜索返回的中文名（与用户输入可能不同）。 */
    readonly city: string;
    /** 气温（°C）。 */
    readonly temperatureC: number;
    /** 体感温度（°C）。 */
    readonly apparentC: number;
    /** 相对湿度（%）。 */
    readonly humidityPercent: number;
    /** 风速（km/h）。 */
    readonly windKph: number;
    /** WMO 天气码，原样保留。 */
    readonly code: number;
    /** 天气码的中文短语。 */
    readonly summary: string;
    /** 观测时刻，站点当地时间（ISO 字符串，不带时区后缀）。 */
    readonly observedAt: string;
}
/** 清空两级缓存。 @internal 仅测试使用。 */
export declare function resetWeatherCache(): void;
/**
 * 查一座城市此刻的天气。
 *
 * @param city - 城市名（中文或英文皆可，交给地名搜索解析）；纯空白视作没给城市。
 * @param deps - 可注入的 fetch、等待与时钟。
 * @returns 天气快照；城市解析不到或上游字段非法时为 null。
 */
export declare function queryWeather(city: string, deps?: QueryWeatherDeps): Promise<WeatherSnapshot | null>;
