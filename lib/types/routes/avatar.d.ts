import type { PetRouteDeps, RouteInput } from './types.ts';
import type { RouteResult } from '../http.ts';
/**
 * 头像上传领域：未命中返回 undefined，命中返回应答。
 *
 * 写成 `rest === 'pet-avatar'` 的正向分支而不是反向守卫：scripts/check-openapi.mjs 按这个
 * 字面量收集宿主实现的路由，反向写法会让文档里的路径被误报成「实现里不存在」。
 */
export declare function handleAvatarRoutes(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult | undefined>;
