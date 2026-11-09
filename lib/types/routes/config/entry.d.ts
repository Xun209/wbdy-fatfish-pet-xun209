import { type RouteResult } from '../../http.ts';
import type { PetRouteDeps, RouteInput } from '../types.ts';
/**
 * 写回一个种类层的全部实例，并返回写后的成品聚合。
 *
 * 失败一律 200 + 失败实体：缺 entry / main 条目 / 实例非法 / id 冲突 / 种类不存在都是业务结论；
 * 方法不对与 JSON 坏了发生在业务之前，由协议构造器给真实状态码。
 *
 * @param deps - 路由层依赖（路径、轮询快照、重启意图、占用锁）。
 * @param input - 已解析的请求（方法、请求体）。
 * @returns 写后的成品聚合（与 GET /config 同一份），或失败实体。
 */
export declare function savePetLayer(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult>;
