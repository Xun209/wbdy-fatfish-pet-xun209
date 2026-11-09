/** 合成失败：上层据此回 `generate-error`，不区分上游细节。 */
export declare class VoiceSynthError extends Error {
    constructor(message: string);
}
/** 合成一次需要的参数。 */
export interface SynthInput {
    /** 已通过长度与空白校验的文本，原样交给依赖（转义由它负责）。 */
    readonly text: string;
    /** 白名单内的音色 id。 */
    readonly voice: string;
    /** prosody rate 表达式，如 `+0%`。 */
    readonly rate: string;
    /** 目标 mp3 的最终路径；父目录必须已存在。 */
    readonly target: string;
}
/**
 * 把一段文本合成到目标 mp3。
 *
 * 先写 `<target>.part` 再改名：`target` 一旦出现就是完整文件，中途失败不会留下半截 mp3
 * 被缓存命中逻辑当成有效音频。
 *
 * @param input - 文本、音色、语速与目标路径。
 * @throws {VoiceSynthError} 上游失败、超时或写盘失败时。
 */
export declare function synthesize({ text, voice, rate, target }: SynthInput): Promise<void>;
