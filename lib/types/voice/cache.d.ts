import type { VoiceFormat } from './types.ts';
/** 缓存总量上限（字节）：超过后从最旧的开始删。 */
export declare const CACHE_MAX_BYTES: number;
/** 缓存文件条数上限。 */
export declare const CACHE_MAX_FILES = 200;
/** 各格式的落盘扩展名与应答 MIME；缓存路径、淘汰白名单与路由应答都读这一份。 */
export declare const FORMAT_INFO: Record<VoiceFormat, {
    readonly ext: string;
    readonly mime: string;
}>;
/**
 * 缓存文件的完整路径：`<userRoot>/voice-cache/<key><ext>`。
 * @param userRoot - 用户数据根。
 * @param key - {@link cacheKey} 的结果。
 * @param format - 音频格式；决定扩展名。
 */
export declare function cachePath(userRoot: string, key: string, format: VoiceFormat): string;
/**
 * 计算缓存键。
 *
 * 三个输入都影响音频内容。`voiceId` 是限定 id（含 provider 前缀），所以换实现、换音色、
 * 换语速、换文本里的任何一项都不会命中旧音频；`text` 不做归一化——同一句话多一个空格
 * 就是另一份音频，宁可多存也不冒「听起来不对」的风险。
 *
 * @param voiceId - 限定音色 id，如 `edge/zh-CN-XiaoyiNeural`。
 * @param rate - 语速偏移百分比，由入口解析成数字后传入。
 * @param text - 待合成文本。
 * @returns 十六进制 sha1。
 */
export declare function cacheKey(voiceId: string, rate: number, text: string): string;
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
