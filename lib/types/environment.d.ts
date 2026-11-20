import { type WeatherSnapshot } from './weather.ts';
/** 可注入的依赖（测试用）。 */
export interface EnvironmentDeps {
    /** 注入的 fetch；缺省用全局 fetch。 */
    readonly fetchImpl?: typeof fetch;
    /** 注入的等待（重试间隔）；缺省用 setTimeout。 */
    readonly sleep?: (ms: number) => Promise<void>;
    /** 注入的时钟（ms）；缺省 `Date.now`。 */
    readonly now?: () => number;
    /** 跳过缓存读取强制重查。 */
    readonly force?: boolean;
    /** 覆盖配置里的城市（测试用）；生产走 {@link setCityProvider}。 */
    readonly city?: string;
}
/**
 * 注入「配置里的天气城市」读取口。
 *
 * 只注入一次、所有调用方共享：/environment 路由与 system 时间行调的是同一个函数，
 * 各自再去读配置就会出现两边说法不一致。
 *
 * @param provider - 返回配置的城市名；空串或 undefined 表示跟随 IP 自动定位。
 */
export declare function setCityProvider(provider: () => string | undefined): void;
/** 环境事实：省市两段分开给，拼成一句话是消费方的事。 */
export interface EnvironmentFacts {
    /** 省 / 州，如“江西省”；上游没给时缺省。 */
    readonly region?: string;
    /** 市，如“南昌市”；两条链路都定位不到时整条结果为空。 */
    readonly city?: string;
    /** 可用的当前天气；查不到时缺省。 */
    readonly weather?: WeatherSnapshot;
}
/**
 * 查一次此刻的环境。
 *
 * @param deps - 注入的 fetch、等待、时钟与 force。
 * @returns 城市与天气；都没有时是空对象（调用方据此少写几段）。
 */
export declare function currentEnvironment(deps?: EnvironmentDeps): Promise<EnvironmentFacts>;
