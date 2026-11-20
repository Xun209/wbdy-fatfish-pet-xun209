import { type SpeechProvider } from './speech-types.ts';
/** 内置实现的 id；配置里的 `speechProvider` 写的就是它。 */
export declare const DEEPSEEK_ASR_PROVIDER_ID = "deepseek";
/** 取 DEEPSEEK_API_KEY 的回调；没配置时返回 undefined。 */
type ResolveKey = () => Promise<string | undefined>;
/**
 * 造 DeepSeek ASR 实现。
 *
 * @param deps.resolveKey - 惰性取 API key；每次识别现取，改配置不必重建实现。
 * @returns 注册表认得的内置实现。
 */
export declare function createDeepseekAsrProvider(deps: {
    resolveKey: ResolveKey;
}): SpeechProvider;
/**
 * 确保 DeepSeek ASR 实现在注册表里；重复调用无副作用（多次装配、热重载都会经过这里）。
 *
 * @param deps.resolveKey - 惰性取 API key。
 */
export declare function ensureDeepseekAsrProvider(deps: {
    resolveKey: ResolveKey;
}): void;
export {};
