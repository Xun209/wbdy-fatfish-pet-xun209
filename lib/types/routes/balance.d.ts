/**
 * 余额查询入口：/balance 主动刷新并返回成品快照。
 *
 * 不实现各服务商的取数协议（归 ./balance/providers）。
 * 依赖（PetRouteDeps）显式传入，模块内不读全局、不建状态。
 * @module dsh-pet/src/host/routes/balance
 */
import type { PetRouteDeps, RouteInput } from './types.ts';
import type { RouteResult } from '../http.ts';
/** 余额领域：未命中返回 undefined，命中返回应答。 */
export declare function handleBalanceRoutes(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult | undefined>;
