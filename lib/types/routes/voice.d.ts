/**
 * 语音领域：`/voice/speak` 合成、`/voice/hear` 识别与 `/voice/voices` 音色列表。
 *
 * 校验、排队与缓存都在语音服务里；这里只判定方法与 JSON，并把结论映射成路由应答。
 * 契约见 openapi.yaml，本模块不重复描述字段。
 * @module dsh-pet/src/host/routes/voice
 */
import type { RouteResult } from '../http.ts';
import type { PetRouteDeps, RouteInput } from './types.ts';
/** 语音领域：未命中返回 undefined，命中返回应答。 */
export declare function handleVoiceRoutes(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult | undefined>;
