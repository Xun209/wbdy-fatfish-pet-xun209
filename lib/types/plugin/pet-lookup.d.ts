/**
 * 宠物定位与访问守卫：按 ?pet= 找实例、按 surface 判占用锁，并给出可直接返回的失败应答。
 *
 * 不读配置以外的介质，只经 onChange 同步锁状态到 S。
 * 依赖由 apply 显式传入（见输入类型），模块内不读全局、不建单例。
 * @module dsh-pet/src/host/plugin/pet-lookup
 */
import { LockStore } from '../lock.ts';
import { PoseStore } from '../pose.ts';
import { type RouteResult } from '../http.ts';
import { SleepStore } from '../sleep.ts';
import type { HostSetup } from './setup.ts';
/** 宠物定位与访问守卫的输入：装配期对象与更早的工厂。 */
export type PetLookupInput = {} & Pick<HostSetup, 'state' | 'configPaths'>;
/**
 * 创建宠物定位与访问守卫。
 */
export declare function createPetLookup(deps: PetLookupInput): {
    lock: LockStore;
    pose: PoseStore;
    sleep: SleepStore;
    sleepBlocked: (petId: string) => RouteResult | null;
    sleepRefusalText: (petId: string) => string | undefined;
    surfaceBlocked: (cfg: Record<string, Record<string, unknown>>, petId: string, params: URLSearchParams) => RouteResult | null;
    requirePet: (params: URLSearchParams, cfg: () => Record<string, Record<string, unknown>>, opts?: {
        surface?: boolean;
    }) => {
        ok: true;
        petId: string;
        entry: string;
        conf: Record<string, unknown>;
        pet: Record<string, unknown>;
    } | {
        ok: false;
        res: RouteResult;
    };
    lockBlocked: (petId: string, params: URLSearchParams) => RouteResult | null;
};
/** 宠物定位与访问守卫的产出（供下游工厂按需 Pick）。 */
export type PetLookup = ReturnType<typeof createPetLookup>;
