/** 缓存总量上限（字节）：超过后从最旧的开始删。 */
export declare const CACHE_MAX_BYTES: number;
/** 缓存文件条数上限。 */
export declare const CACHE_MAX_FILES = 200;
/** 缓存文件的完整路径：`<userRoot>/voice-cache/<key>.mp3`。 */
export declare function cachePath(userRoot: string, key: string): string;
/**
 * 计算缓存键。
 *
 * 四个输入都影响音频内容。`source` 是合成来源——内置实现的 id 或第三方 provider 的 id：
 * 不含它的话，切换实现后会命中上一家的旧音频，听起来像「注册了没生效」。
 * `text` 不做归一化——同一句话多一个空格就是另一份音频，宁可多存也不冒「听起来不对」的风险。
 * @param source - 合成来源。
 * @param voice - 音色 id；第三方实现没有音色概念，传空串。
 * @param rate - 语速表达式（如 `+0%`）。
 * @param text - 待合成文本。
 * @returns 十六进制 sha1。
 */
export declare function cacheKey(source: string, voice: string, rate: string, text: string): string;
/**
 * 确保缓存目录存在。
 * @param userRoot - 用户数据根。
 * @returns 缓存目录绝对路径。
 */
export declare function ensureCacheDir(userRoot: string): Promise<string>;
/**
 * 按「总量 + 条数」淘汰最旧的文件；两个上限都满足时立刻停手。
 * @param dir - 缓存目录。
 * @param limits - 上限，缺省用模块常量。
 * @returns 实际删除的文件数。
 */
export declare function pruneCache(dir: string, limits?: {
    maxBytes?: number;
    maxFiles?: number;
}): Promise<number>;
