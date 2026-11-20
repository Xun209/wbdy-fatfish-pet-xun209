import { type SpeechCatalog } from './speech-types.ts';
/** 单次识别的音频上限（字节）：base64 后仍落在 10 MiB 请求体内，约合 200 秒 16kHz 单声道。 */
export declare const MAX_AUDIO_BYTES: number;
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
/** 语音识别服务：路由层只依赖这两个方法。 */
export interface HearService {
    /** 识别一段音频；`signal` 中止时停止等待（调用方已断开）。 */
    hear(raw: unknown, signal?: AbortSignal): Promise<HearResult>;
    /** 当前可用的实现目录（由注册表提供）。 */
    list(): SpeechCatalog;
}
/**
 * 造识别服务。
 *
 * @param options.configuredProvider - 请求没带 provider 时用的 id；缺省视为没有配置。
 * @param options.timeoutMs - 单次识别超时；缺省 {@link DEFAULT_SPEECH_TIMEOUT_MS}，测试用小值。
 * @returns 只暴露 `hear` 与 `list` 的服务。
 */
export declare function createHearService(options: {
    configuredProvider?: () => string | undefined;
    timeoutMs?: number;
}): HearService;
