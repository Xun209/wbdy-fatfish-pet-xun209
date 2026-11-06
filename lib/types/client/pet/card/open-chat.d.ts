/** 注册来源。 */
export interface OpenChatInput {
    /** 宠物舞台节点；拖拽只在它上面生效，其它区域的 drop 留给页面自己。 */
    readonly stage: HTMLElement | null;
    /** 调用方持有的悬停标记：为 true 时才响应快捷键。 */
    readonly isHovered: () => boolean;
    /** 打开对话；带图时直接进入待发送状态。 */
    readonly openChat: (image?: File) => void;
}
/**
 * 注册拖拽、快捷键与粘贴。
 *
 * @param input - 舞台节点、悬停判定与打开动作。
 * @returns 解绑函数，交给调用方的 effect 清理。
 */
export declare function bindOpenChat(input: OpenChatInput): () => void;
