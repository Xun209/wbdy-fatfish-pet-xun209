import type { ChatPanelRuntime } from './runtime.ts';
import type { ChatPanelState } from './types.ts';
/**
 * 造状态 hook。
 *
 * @param rt - 注入的 react 能力。
 * @returns 无参 hook：每次渲染返回当前状态、派生值与动作。
 */
export declare function createPetChatState(rt: ChatPanelRuntime): () => ChatPanelState;
