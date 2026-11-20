import type { PetRouteDeps, RouteInput } from './types.ts';
import type { RouteResult } from '../http.ts';
/**
 * 角色图领域：未命中返回 undefined，命中返回应答。
 *
 * 不校验方法，与 `/logo`、`/thumb`、`/pic` 一族保持一致：素材端点只看路径。要做方法校验就整族一起加。
 * 写成 `rest === 'character'` 的正向分支而不是反向守卫：scripts/check-openapi.mjs 按这个
 * 字面量收集宿主实现的路由，反向写法会让文档里的路径被误报成「实现里不存在」。
 */
export declare function handleCharacterRoutes(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult | undefined>;
