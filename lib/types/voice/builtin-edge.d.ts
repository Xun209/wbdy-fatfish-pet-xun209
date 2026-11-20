import { type VoiceProvider } from './types.ts';
/** 内置实现的 id；配置里的音色写作 `edge/<音色>`。 */
export declare const EDGE_PROVIDER_ID = "edge";
/** 内置实现：四个中文音色，其余字段全走契约缺省（mp3、无额外元数据）。 */
export declare const EDGE_PROVIDER: VoiceProvider;
/**
 * 确保内置实现在注册表里；重复调用无副作用（多次装配、热重载都会经过这里）。
 *
 * 已经注册过时直接返回，不去覆盖同 id 的另一份——那会让配置里已选的音色在背后换实现。
 */
export declare function ensureEdgeProvider(): void;
