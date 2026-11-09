import { type RouteResult } from '../../http.ts';
import type { PetRouteDeps, RouteInput } from '../types.ts';
/**
 * 写端点分发：PUT 保存用户层，POST 同步内置默认，其余方法 405。
 * @param deps - 路由层依赖（路径、日志、重启意图）。
 * @param input - 已解析的请求（方法、请求体、查询串）。
 */
export declare function saveConfigRoute(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult>;
