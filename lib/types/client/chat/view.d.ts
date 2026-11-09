import type { ChatPanelRuntime } from './runtime.ts';
import type { ChatPanelState } from './types.ts';
/**
 * 造面板根元素。
 *
 * @param rt - 注入的 react 能力。
 * @param state - 当前状态与动作。
 * @returns 面板根元素。
 */
export declare function buildPanel(rt: ChatPanelRuntime, state: ChatPanelState): unknown;
