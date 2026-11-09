import { type RouteResult } from '../http.ts';
import type { PetRouteDeps, RouteInput } from './types.ts';
/** 播放回执领域：未命中返回 undefined，命中返回应答。 */
export declare function handlePlaybackRoutes(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult | undefined>;
