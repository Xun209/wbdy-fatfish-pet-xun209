/**
 * edge 在线语音的封装：按需加载 @andresaya/edge-tts 拿 mp3，把任何失败收敛成一个错误类型。
 *
 * 依赖在真正合成时才 import：语音是可选能力，包缺失只能让这一次合成失败，不能把整个插件
 * 卡在启动阶段（插件加载期缺一个可选依赖 → 宿主判定必需插件未激活 → 整个 DSH 启动失败）。
 * 用动态 import 而不是 createRequire：应用产物把依赖内联进单文件（tsdown 的 noExternal），
 * 打包器只跟踪静态可见的 import；放在 try 里，缺包时照样只失败这一次。
 * SSML 拼装、XML 转义、WebSocket 与 DRM 令牌都由依赖负责——它**已经做了转义**，本模块传
 * 原文即可，再转一次会把 `&` 念成「amp」。协议变动时只需升级依赖，这里不改代码。
 * @module dsh-pet/src/host/voice/edge
 */
import type { SynthInput } from './types.ts';
/** 合成失败：上层据此回 `generate-error`，不区分上游细节。 */
export declare class VoiceSynthError extends Error {
    constructor(message: string);
}
/**
 * 把一段文本合成为 mp3 字节。
 *
 * @param input - 文本、音色、语速与中止信号；音色必须是 edge 服务端的 short name。
 * @returns mp3 字节；落盘由调用方负责。
 * @throws {VoiceSynthError} 依赖缺失、上游失败或超时时。
 */
export declare function synthesize({ signal, text, voice, rate }: SynthInput): Promise<Uint8Array>;
