/**
 * 端侧语音输入：录一段话，拼成宿主认可的 WAV，`POST /voice/hear` 换回文字。
 *
 * 格式口径（16kHz / 单声道 / PCM16）与宿主 provider 的校验是同一份事实——这里只按它产出，
 * 不再各自校验一遍；真对不上时宿主会回一条可读的失败说明。
 * 只负责「麦克风 → WAV → 文字」，不碰界面：按钮状态、文字落点都归调用方（chat/dom）。
 * @module dsh-pet/src/shared/hear
 */
/** 采样率：宿主 provider 只收 16kHz。 */
export declare const HEAR_SAMPLE_RATE = 16000;
/**
 * 单次录音上限（ms）。
 *
 * 24 秒 × 32000 B/s ≈ 750KB，base64 后仍落在宿主 1MiB 的请求体里（上限 768KiB 音频）；
 * 再长就必须先想办法分片，那是另一件事。
 */
export declare const MAX_RECORD_MS = 24000;
/** 判静音的峰值阈值（0..1）：低于它视为没听到声音，不白送一次识别。 */
export declare const SILENCE_PEAK = 0.002;
/**
 * 短于它的录音按误触处理。
 *
 * 快捷键按住说话时，一次误碰只会录到几十毫秒；这种片段既不值得送去识别，
 * 也不该报「没听到声音」——它跟麦克风有没有声毫无关系。
 */
export declare const MIN_RECORD_MS = 300;
/** 识别结果：成功给文字（空串 = 这段里没人说话），失败给分类与可直接展示的说明。 */
export type HearOutcome = {
    readonly ok: true;
    readonly text: string;
} | {
    readonly ok: false;
    readonly reason: 'silent' | 'unsupported' | 'bad-request' | 'generate-error' | 'network';
    readonly message: string;
};
/** 一段录好的音频：WAV 字节与峰值一起交出去，静音判定不必再解一遍字节。 */
export interface RecordedClip {
    /** 完整的 WAV 字节（16kHz / 单声道 / PCM16）。 */
    readonly wave: Uint8Array;
    /** 峰值（0..1）；低于 {@link SILENCE_PEAK} 就是没听到声音。 */
    readonly peak: number;
}
/** 一次录音的句柄；用完必须 `stop` 或 `cancel`，否则麦克风一直被占着。 */
export interface HearRecorder {
    /** 已录时长（ms）：到 {@link MAX_RECORD_MS} 后不再增长。 */
    elapsedMs(): number;
    /** 停止并交出音频；一个采样都没有时给 null。 */
    stop(): Promise<RecordedClip | null>;
    /** 丢弃录音并释放麦克风；可重复调用。 */
    cancel(): void;
}
/** 浏览器能不能录音；非安全上下文（http 且非 localhost）下 `mediaDevices` 根本不存在。 */
export declare function canRecord(): boolean;
/**
 * 浮点采样转 16 位整型：超范围先夹紧，负半轴按 32768 缩放，免得 -1 溢出成正数。
 *
 * @param samples - Web Audio 给的 [-1,1] 浮点采样。
 * @returns 可直接写进 WAV 的 16 位采样。
 */
export declare function floatToPcm16(samples: Float32Array): Int16Array;
/**
 * 量峰值：静音判定只关心「有没有声音进来」，不关心它有多响。
 *
 * @param pcm - 16 位采样。
 * @returns 峰值归一到 0..1；空数组给 0。
 */
export declare function peakOf(pcm: Int16Array): number;
/**
 * 拼一个裸 PCM 的 WAV：44 字节头 + 采样数据。
 *
 * 头里每个字段宿主都会校验（`fmt ` 长度 16、PCM=1、单声道、16bit、byteRate 自洽），
 * 所以这里按固定偏移逐字节写，不做「挑一个能用的模板」那种取巧。
 *
 * @param pcm - 16 位采样。
 * @param sampleRate - 采样率；缺省 16kHz。
 * @returns 完整 WAV 字节。
 */
export declare function encodeWave(pcm: Int16Array, sampleRate?: number): Uint8Array;
/**
 * 字节转 base64（不带 data: 前缀）。
 *
 * 分段转换：一次性展开几十万字节会撑爆参数栈，而这里是允许 750KB 的量级。
 *
 * @param bytes - 原始字节。
 * @returns 规范 base64。
 */
export declare function toBase64(bytes: Uint8Array): string;
/**
 * 把一段 WAV（base64）交给宿主识别。
 *
 * @param url - 已含挂载前缀的识别地址。
 * @param audio - 规范 base64（不带 data: 前缀）。
 * @returns 文字或失败分类；网络异常也收敛成 outcome，不向上抛。
 */
export declare function hearAudio(url: string, audio: string, signal?: AbortSignal): Promise<HearOutcome>;
/**
 * 开一次录音。
 *
 * 用 `AudioContext({ sampleRate: 16000 })` 让浏览器自己做重采样（硬件通常是 48k），
 * 拿到的就已是目标采样率的单声道浮点；`ScriptProcessor` 虽已标记废弃，但它不需要
 * 额外的 worklet 模块文件——`file://` 页面加载 worklet 会被源头限制卡住。
 *
 * @returns 录音句柄。
 * @throws {Error} 拿不到麦克风时（没权限、设备被占、非安全上下文）——原文交给调用方展示。
 */
export declare function startRecording(): Promise<HearRecorder>;
