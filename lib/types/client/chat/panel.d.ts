import type { ChatPanelRuntime } from './runtime.ts';
export type { ChatPanelRuntime } from './runtime.ts';
/**
 * 造面板组件。
 *
 * @param rt - 注入的 react 能力。
 * @returns 无参组件：状态与动作都从 ./state 取，本身不持逻辑。
 */
export declare function makePetChatPanel(rt: ChatPanelRuntime): () => unknown;
