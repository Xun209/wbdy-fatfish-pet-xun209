/**
 * 重启串行化：同一时刻只允许一次「停旧 → 起新」，连续请求排队而非交错。
 *
 * 不自己停拉进程（归 ./spawn），不重算配置（归 ./pets）。
 * 依赖显式传入（见输入类型），模块内不读全局。
 * @module dsh-pet/src/host/plugin/desktop/sync
 */
import type { DesktopHelperDeps } from './types.ts';
import type { DesktopPets } from './pets.ts';
import type { DesktopSpawn } from './spawn.ts';
/** DesktopSync的输入。 */
export type DesktopSyncInput = Pick<DesktopHelperDeps, 'log'> & Pick<DesktopPets, 'logDesktopDecision'> & Pick<DesktopSpawn, 'startHelper' | 'stopHelperAndWait'>;
/**
 * 创建DesktopSync。
 */
export declare function createDesktopSync(deps: DesktopSyncInput): {
    requestRestart: () => Promise<void>;
};
/** DesktopSync的产出。 */
export type DesktopSync = ReturnType<typeof createDesktopSync>;
