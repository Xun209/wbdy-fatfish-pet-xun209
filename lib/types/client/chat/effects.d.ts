import type { ChatPanelRuntime } from './runtime.ts';
import type { PanelData } from './types.ts';
/** 副作用需要的状态与句柄。 */
export interface ChatEffectsInput {
    readonly data: PanelData;
    readonly patch: (next: Partial<PanelData>) => void;
    readonly fail: (error: unknown) => void;
    readonly reload: (petId: string) => Promise<void>;
    readonly listRef: {
        current: HTMLDivElement | null;
    };
    readonly draftRef: {
        current: HTMLTextAreaElement | null;
    };
    /** 已贴到底的那条消息 `ts`：只有它变化时才自动滚底。 */
    readonly newestTs: {
        current: number;
    };
}
/**
 * 造副作用 hook。
 *
 * @param rt - 注入的 react 能力。
 * @returns 接收状态与句柄的 hook；没有返回值。
 */
export declare function createChatEffects(rt: ChatPanelRuntime): (input: ChatEffectsInput) => void;
