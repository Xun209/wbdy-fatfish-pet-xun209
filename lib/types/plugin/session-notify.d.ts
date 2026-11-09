/**
 * 会话事件到系统通知的判定：完成提醒、终止清理与活动去抖。
 *
 * 不订阅事件（订阅在装配层），不渲染气泡；只做纯判定与定时器。
 * 依赖由 apply 显式传入（见输入类型），模块内不读全局、不建单例。
 * @module dsh-pet/src/host/plugin/session-notify
 */
import { type HostNotifyFrame } from '../notify-events.ts';
import { type WorkStatusTurnContext } from '../work-status.ts';
import type { WorkStatusBridge } from './work-status-bridge.ts';
import type { HostSetup } from './setup.ts';
import type { HostContext } from './context.ts';
/** 在途调用的键：宿主给的 `callId`；没有标识时用临时 `Symbol` 占位。 */
export type ToolCallKey = string | symbol;
/** 每会话在途调用的记账表：会话标识 → （调用键 → 气泡文案）。 */
export type ToolCallLedger = Map<string, Map<ToolCallKey, string>>;
/** 会话通知的输入：装配期对象与更早的工厂。 */
export type SessionNotifyInput = {
    /** 宿主上下文（apply 收到的那一个）。 */
    ctx: HostContext;
} & Pick<WorkStatusBridge, 'publishWorkStatus'> & Pick<HostSetup, 'state'> & Pick<HostSetup, 'workStatus'>;
/**
 * 创建会话通知。
 */
export declare function createSessionNotify(deps: SessionNotifyInput): {
    pushNotifyFrame: (frame: HostNotifyFrame) => void;
    turnFlags: Map<string, WorkStatusTurnContext>;
    terminalTimers: Map<string, NodeJS.Timeout>;
    lastTodoText: Map<string, string | null>;
    lastReplyText: Map<string, string>;
    toolsInFlight: ToolCallLedger;
    cancelTerminalCleanup: (sessionId: string) => void;
    scheduleTerminalCleanup: (sessionId: string) => void;
    notifyActivityTimers: Map<string, NodeJS.Timeout>;
    scheduleCompletionNotify: (sessionId: string, event: unknown) => void;
};
/** 会话通知的产出（供下游工厂按需 Pick）。 */
export type SessionNotify = ReturnType<typeof createSessionNotify>;
