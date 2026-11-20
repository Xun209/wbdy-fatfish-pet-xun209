/** 时间行里附带的环境事实（城市与天气）。 */
export interface TimeContextEnv {
    /** 省 / 州（如“江西省”）；缺省 = 不知道省份，地点只写城市。 */
    readonly region?: string;
    /** 市（如“南昌市”）；缺省 = 不知道在哪，连“你在……”一起省掉。 */
    readonly city?: string;
    /** 此刻天气；缺省 = 没有可用天气，只写一句“这次没查到”的交代，防止模型自己编。 */
    readonly weather?: WeatherFacts;
}
/** 天气事实：只用于拼一句口语，不承诺展示格式。 */
export interface WeatherFacts {
    /** 天气短语（如“阴”）。 */
    readonly summary: string;
    /** 气温（°C）。 */
    readonly temperatureC: number;
    /** 体感温度（°C）。 */
    readonly apparentC: number;
    /** 相对湿度（%）。 */
    readonly humidityPercent: number;
    /** 风速（km/h）。 */
    readonly windKph: number;
}
/**
 * 生成注入 system 末尾的时间背景（一行）。
 * @param date - 当前时刻（生产调用方传 new Date()；测试传固定日期）。
 * @param env - 可选的环境事实：传了就多写地点与天气，不传则与加入环境前逐字一致。
 * @returns 形如
 *   `【当下】你在江西省南昌市（按网络粗估，不一定准），现在是2026年10月8日星期四 21:32，晚上，工作日，外面阴，气温 13.1°C，体感 12.9°C，湿度 84%，风速 2 km/h。这只是背景，……`
 *   无节日时中间那一段省略；非法 Date → 空串（调用方据此不加这一行）。
 */
export declare function timeContextOf(date: Date, env?: TimeContextEnv): string;
/**
 * 历史消息的时间前缀（对话历史专用）：`10月31日 22:53`，跨年时带年份。
 *
 * 不带方括号，由调用方决定怎么包；是否加前缀（阈值）也归调用方判断。
 *
 * @param ts - 那条消息的发送时刻（毫秒时间戳，`memory.json` 里每条都带）。
 * @param now - 当前时刻；与发送时刻不同年时前缀带年份，消掉“哪一年”的歧义。
 * @returns `ts` 或 `now` 非法时返回空串（调用方据此不加前缀，原样发送）。
 */
export declare function historyStampOf(ts: number, now: Date): string;
