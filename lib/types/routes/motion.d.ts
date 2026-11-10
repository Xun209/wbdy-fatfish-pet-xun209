import type { PetRouteDeps, RouteInput } from './types.ts';
import type { RouteResult } from '../http.ts';
/** 动作与位置领域：未命中返回 undefined，命中返回应答。 */
export declare function handleMotionRoutes(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult | undefined>;
