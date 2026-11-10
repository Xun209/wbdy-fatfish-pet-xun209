import { type SynthInput } from './edge.ts';
import { type VoiceInfo } from './voices.ts';
/** 单次请求允许的最大文本长度（字符，按 UTF-16 计）。 */
export declare const MAX_TEXT_CHARS = 500;
/** 同时排队的合成上限（含正在跑的那个）；超出直接拒绝，不无限堆积。 */
export declare const MAX_QUEUE = 3;
/** 失败原因；路由层原样映射成 `result.ts` 的 reason。 */
export type SpeakFailure = 'bad-request' | 'voice-busy' | 'generate-error';
/** 合成结果：成功时给出最终 mp3 的绝对路径。 */
export type SpeakResult = {
    ok: true;
    file: string;
} | {
    ok: false;
    reason: SpeakFailure;
    message: string;
};
/** 语音服务：路由层只依赖这两个方法。 */
export interface VoiceService {
    /** 合成一段文本；同一输入命中缓存时不再联网。 */
    speak(raw: unknown): Promise<SpeakResult>;
    /** 可选音色列表（与白名单同源）。 */
    listVoices(): readonly VoiceInfo[];
}
/** 造语音服务。 */
export declare function createVoiceService(options: {
    /** 用户数据根；缓存落在 `<userRoot>/voice-cache/`。 */
    userRoot: string;
    /** 留痕用；不传则静默。只记字数与结果，不记正文（用户内容不进日志）。 */
    log?: {
        info?(message: string): void;
        warn?(message: string): void;
    };
    /** 合成实现；测试注入替身，缺省走 edge 的真实实现。 */
    synthesize?: (input: SynthInput) => Promise<void>;
}): VoiceService;
