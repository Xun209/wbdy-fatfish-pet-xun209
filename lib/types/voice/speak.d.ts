import { type VoiceCatalog } from './types.ts';
/** 单次请求允许的最大文本长度（字符，按 UTF-16 计）。 */
export declare const MAX_TEXT_CHARS = 500;
/** 同时排队的合成上限（含正在跑的那个）；超出直接拒绝，不无限堆积。 */
export declare const MAX_QUEUE = 3;
/** 失败原因；路由层原样映射成 `result.ts` 的 reason。 */
export type SpeakFailure = 'bad-request' | 'voice-busy' | 'generate-error';
/** 合成结果：成功时给出最终音频的绝对路径与应答 MIME。 */
export type SpeakResult = {
    ok: true;
    file: string;
    contentType: string;
} | {
    ok: false;
    reason: SpeakFailure;
    message: string;
};
/** 语音服务：路由层只依赖这两个方法。 */
export interface VoiceService {
    /** 合成一段文本；同一输入命中缓存时不再调用实现。 */
    speak(raw: unknown): Promise<SpeakResult>;
    /** 当前音色目录（由注册表提供）。 */
    list(): VoiceCatalog;
}
/**
 * 这一条排队等得太久了吗。
 *
 * 等得比客户端愿意等的还久，那边早已超时放弃：再合成只是白烧上游，
 * 而且声音出来时说的已经是上一件事。
 *
 * @param queuedMs - 入队时刻。
 * @param nowMs - 轮到自己时的时刻。
 * @param waitMs - 容许的最长排队时间；缺省用 {@link STALE_WAIT_MS}，测试注入更短的值。
 * @returns 应该丢弃时为 true。
 * @internal
 */
export declare function isQueueStale(queuedMs: number, nowMs: number, waitMs?: number): boolean;
/** 造语音服务。 */
export declare function createVoiceService(options: {
    /** 用户数据根；缓存落在 `<userRoot>/voice-cache/`。 */
    userRoot: string;
    /** 留痕用；不传则静默。只记字数与结果，不记正文（用户内容不进日志）。 */
    log?: {
        info?(message: string): void;
        warn?(message: string): void;
    };
    /** 请求没带 `voice` 时用的音色；缺省视为没有配置。 */
    configuredVoice?: () => string | undefined;
    /** 容许的最长排队时间（ms）；缺省 {@link STALE_WAIT_MS}，测试用它把丢弃分支逼出来。 */
    staleWaitMs?: number;
}): VoiceService;
