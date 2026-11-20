/**
 * 桌面侧重启：同一时刻只允许一次「停旧 → 起新」，连续请求排队而非交错。
 *
 * 两种形态走同一条入口：双进程（插件 / 独立模式）重启子进程；单进程（打包应用）没有
 * 子进程可重启，改让内嵌 helper 按新配置重建窗口。
 * 不自己停拉进程（归 ./spawn），不重算配置（归 ./pets）。
 * 依赖显式传入（见输入类型），模块内只读一个进程级事实：DSH_PET_IN_PROCESS。
 * @module dsh-pet/src/host/plugin/desktop/sync
 */
import type { DesktopHelperDeps } from './types.ts';
import type { DesktopPets } from './pets.ts';
import type { DesktopSpawn } from './spawn.ts';
/** DesktopSync的输入。 */
export type DesktopSyncInput = Pick<DesktopHelperDeps, 'log'> & Pick<DesktopPets, 'logDesktopDecision' | 'desktopPetList'> & Pick<DesktopSpawn, 'startHelper' | 'stopHelperAndWait'>;
/**
 * 创建DesktopSync。
 */
export declare function createDesktopSync(deps: DesktopSyncInput): {
    requestRestart: () => Promise<void>;
};
/** DesktopSync的产出。 */
export type DesktopSync = ReturnType<typeof createDesktopSync>;
