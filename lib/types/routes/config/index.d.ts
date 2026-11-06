import { type RouteResult } from '../../http.ts';
import type { PetRouteDeps, RouteInput } from '../types.ts';
/** 内容配置领域：未命中返回 undefined，命中返回应答。 */
export declare function handleConfigRoutes(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult | undefined>;
