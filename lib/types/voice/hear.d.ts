/** 单次识别的音频上限（字节）：音频经 base64 塞进 1MiB 请求体，解码后约 786KiB。 */
export declare const MAX_AUDIO_BYTES: number;
/** 识别超时（毫秒）：本地 CPU 推理，一句话远低于此；超出即放弃，不无限等。 */
export declare const TRANSCRIBE_TIMEOUT_MS = 30000;
/** 失败原因；路由层原样映射成 result.ts 的 reason。 */
export type HearFailure = 'bad-request' | 'unsupported' | 'generate-error';
/** 识别结果：成功给文字，失败给分类与可直接回给调用方的说明。 */
export type HearResult = {
    ok: true;
    text: string;
} | {
    ok: false;
    reason: HearFailure;
    message: string;
};
/** 语音识别服务：路由层只依赖这个方法。 */
export interface HearService {
    /** 识别一段音频；`signal` 中止时停止等待（调用方已断开）。 */
    hear(raw: unknown, signal?: AbortSignal): Promise<HearResult>;
}
/**
 * 造识别服务。
 *
 * @param options.speechToText - 惰性取宿主服务；没启用语音输入插件时它返回 undefined。
 * @param options.timeoutMs - 单次识别超时；缺省 {@link TRANSCRIBE_TIMEOUT_MS}，测试用小值。
 * @returns 只暴露 `hear` 的服务。
 */
export declare function createHearService(options: {
    speechToText: () => unknown;
    timeoutMs?: number;
}): HearService;
