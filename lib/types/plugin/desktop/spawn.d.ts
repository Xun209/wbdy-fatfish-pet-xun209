import type { DesktopHelperDeps } from './types.ts';
import type { DesktopPets } from './pets.ts';
/** DesktopSpawn的输入。 */
export type DesktopSpawnInput = Pick<DesktopHelperDeps, 'ctx' | 'getHandlePetRoute' | 'log' | 'reportDownload' | 'thumbUserRoot'> & Pick<DesktopPets, 'getHasDesktopPet' | 'desktopPetList' | 'getTrayOn'>;
/** 菜单首项去向：desktop 唤起桌面应用，standalone 打开本机 AI 设置页，web 打开 DSH 站点。 */
export type OpenTarget = 'desktop' | 'standalone' | 'web';
/**
 * 由宿主形态与已鉴权地址判定菜单首项去向。
 *
 * 独立模式与 web 宿主都不在 Electron 里，只能靠地址形状区分：独立模式的已鉴权地址固定落在本机
 * 设置页，web 宿主指向站点根。判错会让菜单文案与实际打开的目标对不上。
 * @param siteUrl - 交给浏览器的已鉴权地址（独立模式含本机设置页路径）。
 * @param desktopHost - 宿主是否为 DSH 桌面应用。
 * @returns 注入给 Helper 的形态值。
 */
export declare function resolveOpenTarget(siteUrl: string, desktopHost: boolean): OpenTarget;
/**
 * 创建 Helper 进程的拉起与停止句柄：进程内宿主直接跳过，其余按需下载 Electron 后 spawn 并退避重试。
 */
export declare function createDesktopSpawn(deps: DesktopSpawnInput): {
    startHelper: () => void;
    stopHelper: (reason?: string) => void;
    stopHelperAndWait: (reason: string) => Promise<void>;
    markDisposed: () => void;
    assetRootFor: (ext: string) => string;
    userRootFor: (ext: string) => string;
};
/** DesktopSpawn的产出。 */
export type DesktopSpawn = ReturnType<typeof createDesktopSpawn>;
