import { type SpeechProvider } from './speech-types.ts';
/** 内置实现的 id；配置里的 `speechProvider` 写的就是它。 */
export declare const DSH_SPEECH_PROVIDER_ID = "dsh";
/**
 * 造内置识别实现。
 *
 * @param deps.speechToText - 惰性取 DSH 的识别服务；没装语音输入插件时返回 undefined。
 * @returns 注册表认得的内置实现。
 */
export declare function createDshSpeechProvider(deps: {
    speechToText: () => unknown;
}): SpeechProvider;
/**
 * 确保内置识别实现在注册表里；重复调用无副作用（多次装配、热重载都会经过这里）。
 *
 * 已经注册过时直接返回，不去覆盖同 id 的另一份。
 *
 * @param deps.speechToText - 惰性取 DSH 的识别服务。
 */
export declare function ensureDshSpeechProvider(deps: {
    speechToText: () => unknown;
}): void;
