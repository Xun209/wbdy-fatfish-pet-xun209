/**
 * 桌面端生命周期：/reload 重新解析配置并重启 Helper，/quit 关闭宿主应用。
 *
 * 不负责 Helper 进程本身的拉活与重启（归 ./helper-process）。
 * 依赖（PetRouteDeps）显式传入，模块内不读全局、不建状态。
 * @module dsh-pet/src/host/routes/desktop
 */
import type { PetRouteDeps, RouteInput } from './types.ts';
import type { RouteResult } from '../http.ts';
/** 桌面端生命周期领域：未命中返回 undefined，命中返回应答。 */
export declare function handleDesktopRoutes(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult | undefined>;
