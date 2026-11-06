import { type RouteResult } from '../http.ts';
import type { PetRouteDeps } from '../routes/types.ts';
import type { HostContext } from './context.ts';
/** 单次业务请求的处理函数：URL 已解析、方法已归一。 */
export type HttpRouteHandler = (url: string, method: string, body?: string, signal?: AbortSignal) => Promise<RouteResult>;
/**
 * 由依赖表构造 HTTP 处理函数。
 * @param deps - 路由层依赖（store、路径、动作函数）。
 * @returns 按前缀分发到领域路由的处理函数。
 */
export declare function createHttpRoute(deps: PetRouteDeps): {
    handlePetRoute: HttpRouteHandler;
};
/**
 * 把前缀路由挂到宿主 webServer，随插件卸载自动摘除。
 * @param ctx - 宿主上下文。
 * @param handlePetRoute - 业务处理函数（桌面 Helper 管道复用同一个）。
 */
export declare function registerHttpRoute(ctx: HostContext, handlePetRoute: HttpRouteHandler): void;
