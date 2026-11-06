/**
 * 工作状态联动：把 store 里的活动状态按 5s 间隔压扁后写进轮询快照。
 *
 * 不监听会话事件（归会话监听器），不渲染气泡。
 * 依赖由 apply 显式传入（见输入类型），模块内不读全局、不建单例。
 * @module dsh-pet/src/host/plugin/work-status-bridge
 */
import type { HostSetup } from './setup.ts';
/** 工作状态桥的输入：装配期对象与更早的工厂。 */
export type WorkStatusBridgeInput = {} & Pick<HostSetup, 'state'> & Pick<HostSetup, 'workStatus'>;
/**
 * 创建工作状态桥。
 */
export declare function createWorkStatusBridge(deps: WorkStatusBridgeInput): {
    publishWorkStatus: () => void;
    stopWorkStatusFlush: () => void;
};
/** 工作状态桥的产出（供下游工厂按需 Pick）。 */
export type WorkStatusBridge = ReturnType<typeof createWorkStatusBridge>;
