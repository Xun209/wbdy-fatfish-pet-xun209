/**
 * 路由分发器：按固定顺序串行尝试各领域处理器，第一个给出应答的生效。
 *
 * 顺序即语义——素材路由是末端兜底（任何未知路径都会落到它并回 400），必须排在最后；
 * 其余领域按 `rest` 精确匹配，彼此不重叠，顺序只影响可读性。
 * 不解析 URL、不判断业务：`rest` 由调用方切好，处理器各自定义匹配条件。
 * @module dsh-pet/src/host/routes/index
 */
import type { RouteResult } from '../http.ts';
import type { PetRouteDeps } from './types.ts';
/**
 * 由依赖表构造路由分发器（`apply` 只调一次）。
 * @param deps - 路由层依赖（store、路径、动作函数）。
 * @returns 接收 URL/rest/方法/请求体/断开信号并给出应答的函数。
 */
export declare function createPetRouter(deps: PetRouteDeps): (url: URL, rest: string, method: string, body?: string, signal?: AbortSignal) => Promise<RouteResult>;
