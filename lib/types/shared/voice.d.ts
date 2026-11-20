import type { VoiceTarget } from './state.ts';
/** 语音播报对外的四种状态；只用于展示，不接受外部驱动。`failed` = 这次合成没成功。 */
export type VoiceState = 'idle' | 'loading' | 'ready' | 'failed';
/**
 * 一句播报的开始与结束事件。
 *
 * `text` 是气泡上的原文，不是送合成的截断文本——气泡要按它认句：同一页面上的多只宠物
 * 共用这份模块单例状态，不认句就会把别人那一句算到自己头上。
 */
export type VoiceUtteranceEvent = {
    readonly kind: 'start';
    readonly seq: number;
    readonly text: string;
} | {
    readonly kind: 'end';
    readonly seq: number;
    readonly text: string;
};
/**
 * 等一句播完的上限（ms）。
 *
 * 比气泡自身的挂起上限（50s）再宽一点：正常单句远小于它，到点还没收尾说明播放这条线
 * 已经断了，此时按收尾处理，气泡不至于跟着永久挂住。
 */
export declare const PLAYBACK_WAIT_MAX_MS = 60000;
/**
 * 读当前播报状态；桌面端在重绘气泡时直接取（它没有 react 的订阅机制）。
 * @returns `idle` / `loading` / `ready`。
 */
export declare function getVoiceState(): VoiceState;
/**
 * 订阅播报状态；订阅时会立刻收到当前值。
 * @param listener - 状态变化回调。
 * @returns 取消订阅；组件卸载/气泡关闭时必须调用。
 */
export declare function subscribeVoiceState(listener: (state: VoiceState) => void): () => void;
/**
 * 订阅每句播报的开始与结束；不补发历史状态，只报后续事件。
 *
 * @param listener - 事件回调：`start` 表示已经决定要念这一句（合成开始），
 *   `end` 表示播完、合成失败或超时——三种结局都会报一次，气泡不必自己判超时。
 * @returns 取消订阅；卡片卸载或气泡关闭时必须调用。
 */
export declare function subscribeVoiceUtterance(listener: (event: VoiceUtteranceEvent) => void): () => void;
/**
 * 换掉接口基址；桌面端在模块加载时调一次（`file://` 页面不能用相对路径）。
 * @param base - 已含前缀的地址，如 `dsh-pet-bridge://dsh-pet/dsh-pet-7340`。
 */
export declare function setVoiceBase(base: unknown): void;
/**
 * 声明本端是网页端还是桌面端；两端各自在启动时调一次。
 * 没声明时不按 `say` 叶子播放——宁可没声音，也不替另一端出声。
 * @param next - `web` / `desktop`；其余值忽略。
 */
export declare function setSurface(next: unknown): void;
/**
 * 记录成品配置里的音色与音量；网页端在读到 `/config` 时调一次。
 * 调用即视为配置已就绪，后续播放不再自己去拉。
 *
 * @param name - 音色 id（非字符串按未指定处理）。
 * @param volume - 音量系数（0–1）；缺省或非数值按最大音量播放。
 */
export declare function setVoiceConfig(name: unknown, volume?: unknown): void;
/**
 * 记录工作状态播报开关；网页端在读到 `/config` 时调一次。
 *
 * @param on - 成品配置的 `main.voiceNotifyEnabled`；只有严格 `true` 才算开启。
 */
export declare function setVoiceNotifyEnabled(on: unknown): void;
/** 工作状态播报是否开启。 */
export declare function isVoiceNotifyEnabled(): boolean;
/**
 * 按 `say` 叶子播放：叶子点名了本端就念。
 *
 * 两道门：叶子有没有点名本端 → 网页端页面是否可见。念不念由宿主在写叶子时决定。
 *
 * @param say - 要念的那一句：`text` 正文，`voiceTo` 该由哪一端念。
 */
export declare function playSayVoice(say: {
    readonly text: string;
    readonly voiceTo?: VoiceTarget;
}): void;
/**
 * 念一句与气泡无关的系统提示（工作状态播报）。
 *
 * 念不念由调用方判定。与其它自动播报共用同一个单槽——后一句掐掉前一句。
 *
 * @param text - 要念的整句；空串直接跳过。
 */
export declare function speakNotice(text: string): void;
/** 手动点播对外暴露的阶段；`idle` = 没在放（含被打断），`failed` = 合成没成功。 */
export type SpeakPhase = 'idle' | 'loading' | 'playing' | 'failed';
/**
 * 手动播报一句（对话面板的喇叭按钮用）。
 *
 * 用户明确点播，拿到正文就合成播放；音色与音量取配置值。
 *
 * @param text - 要念的正文。
 * @param onPhase - 阶段回调：请求合成时 `loading`、音频就绪开始播时 `playing`、播完 `idle`、失败或超时 `failed`。
 */
export declare function speakText(text: string, onPhase?: (phase: SpeakPhase) => void): void;
