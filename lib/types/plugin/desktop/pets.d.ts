import type { DesktopHelperDeps } from './types.ts';
/** DesktopPets的输入。 */
export type DesktopPetsInput = Pick<DesktopHelperDeps, 'configPaths' | 'effectivePetList' | 'log'>;
/**
 * 造桌面判定：三个取值函数 + 一行判定日志，都不持有状态。
 *
 * @param deps - 配置路径、桌面窗用的宠物列表来源与日志。
 * @returns 取值函数与诊断日志入口。
 */
export declare function createDesktopPets(deps: DesktopPetsInput): {
    getHasDesktopPet: () => boolean;
    getTrayOn: () => boolean;
    desktopPetList: () => Array<{
        id: string;
        size: number;
    }>;
    logDesktopDecision: () => void;
};
/** DesktopPets的产出。 */
export type DesktopPets = ReturnType<typeof createDesktopPets>;
