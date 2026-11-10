/**
 * 桌面 Helper 的下载进度上报：把下载片段写进轮询快照，超时后自动清空。
 *
 * 不发起下载，只转发进度。
 * 依赖由 apply 显式传入（见输入类型），模块内不读全局、不建单例。
 * @module dsh-pet/src/host/plugin/download-report
 */
import { type HostWorkStatusState } from '../work-status.ts';
import type { WorkStatusBridge } from './work-status-bridge.ts';
import type { HostSetup } from './setup.ts';
/** 下载进度上报的输入：装配期对象与更早的工厂。 */
export type DownloadReportInput = {} & Pick<HostSetup, 'EXTERNAL_WORK_SESSION'> & Pick<HostSetup, 'nextExternalWorkSeq'> & Pick<WorkStatusBridge, 'publishWorkStatus'> & Pick<HostSetup, 'workStatus'>;
/**
 * 创建下载进度上报。
 */
export declare function createDownloadReport(deps: DownloadReportInput): {
    reportDownload: (text: string, state: HostWorkStatusState, terminal?: boolean) => void;
    stopDownloadSlotTimer: () => void;
};
/** 下载进度上报的产出（供下游工厂按需 Pick）。 */
export type DownloadReport = ReturnType<typeof createDownloadReport>;
