/**
 * 卸载清理：摘监听、停定时器、结束挂起等待，顺序不可调换。
 *
 * 不做启动（装配末尾单独 startHelper），不持有资源句柄。
 * @module dsh-pet/src/host/plugin/lifecycle
 */
import type { PetLookup } from './pet-lookup.ts';
import type { DesktopHelper } from './desktop-helper.ts';
import type { DownloadReport } from './download-report.ts';
import type { WorkStatusBridge } from './work-status-bridge.ts';
import type { HostSetup } from './setup.ts';
import type { HostContext } from './context.ts';
/** 卸载清理的输入。 */
export type LifecycleInput = {
    /** 宿主上下文（apply 收到的那一个）。 */
    ctx: HostContext;
} & Pick<PetLookup, 'lock'> & Pick<DesktopHelper, 'markDisposed'> & Pick<HostSetup, 'playback'> & Pick<HostSetup, 'state'> & Pick<DownloadReport, 'stopDownloadSlotTimer'> & Pick<DesktopHelper, 'stopHelper'> & Pick<WorkStatusBridge, 'stopWorkStatusFlush'>;
/** 注册卸载清理；返回的清理函数由 ctx.effect 收集。 */
export declare function registerLifecycle(deps: LifecycleInput): void;
