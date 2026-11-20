/**
 * 语音识别注册表：多槽，每个 provider id 一份，互不覆盖。
 *
 * 插入顺序即注册顺序，目录按它输出；注销只删自己那条，迟到的注销不会顶掉后来者。
 * 只登记与查找：不识别、不排队、不设超时（那些归 hear.ts）。
 * @module dsh-pet/src/host/voice/speech-registry
 */
import { type SpeechCatalog, type SpeechProvider } from './speech-types.ts';
/**
 * 注册一个语音识别实现。
 *
 * @param def - 实现定义；`id` 已被占用时拒绝，不做覆盖。
 * @returns 注销函数；只在「当前仍是这一份」时才清空自己那条。
 * @throws {TypeError} 定义不合法或 `id` 已被注册时。
 */
export declare function registerSpeechProvider(def: SpeechProvider): () => void;
/**
 * 按 id 查找实现。
 * @param id - 注册时声明的 provider id。
 * @returns 命中时给出定义；没注册过返回 `undefined`。
 */
export declare function resolveSpeechProvider(id: string): SpeechProvider | undefined;
/**
 * 当前可用的实现目录；Cordis `list()` 与 `GET /voice/hear-providers` 共用这一份。
 * @returns 按注册顺序排列；没有注册时 `providers` 为空数组。
 */
export declare function listSpeechCatalog(): SpeechCatalog;
/**
 * 清空注册，供测试隔离用例。
 * @internal
 */
export declare function resetSpeechProviders(): void;
