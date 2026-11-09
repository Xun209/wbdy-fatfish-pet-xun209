import { type RouteResult } from '../../http.ts';
import type { PetRouteDeps, RouteInput } from '../types.ts';
/**
 * 改一只宠物的 display 并返回改动后的成品聚合。
 *
 * 失败一律 200 + 失败实体：缺 id / display 非法 / 宠物不存在 / 写盘失败都是业务结论；
 * 方法不对与 JSON 坏了发生在业务之前，由协议构造器给真实状态码。
 */
export declare function setPetDisplay(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult>;
