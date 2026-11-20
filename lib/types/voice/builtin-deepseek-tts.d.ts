import { type VoiceProvider } from './types.ts';
/** 内置实现的 id；配置里的音色写作 `deepseek/<音色>`。 */
export declare const DEEPSEEK_TTS_PROVIDER_ID = "deepseek";
/** 取 DEEPSEEK_API_KEY 的回调；没配置时返回 undefined。 */
type ResolveKey = () => Promise<string | undefined>;
/**
 * 造 DeepSeek TTS 实现。
 *
 * @param deps.resolveKey - 惰性取 API key；每次合成现取，改配置不必重建实现。
 * @returns 注册表认得的内置实现。
 */
export declare function createDeepseekTtsProvider(deps: {
    resolveKey: ResolveKey;
}): VoiceProvider;
/**
 * 确保 DeepSeek TTS 实现在注册表里；重复调用无副作用（多次装配、热重载都会经过这里）。
 *
 * @param deps.resolveKey - 惰性取 API key。
 */
export declare function ensureDeepseekTtsProvider(deps: {
    resolveKey: ResolveKey;
}): void;
export {};
