import type { ConfirmKind, PanelData } from './types.ts';
/** 动作需要的最小端口。 */
export interface ActionPorts {
    /** 读写当前状态快照（每次渲染重建，取到的就是最新值）。 */
    readonly read: () => PanelData;
    /** 合并一次状态补丁。 */
    readonly patch: (next: Partial<PanelData>) => void;
    /** 把任何异常归一成可展示文案。 */
    readonly fail: (error: unknown) => void;
    /** 重新拉取某只宠物的历史。 */
    readonly reload: (petId: string) => Promise<void>;
}
/** 记忆动作：按轮删除与清空整只。 */
export declare function createHistoryActions(ports: ActionPorts): {
    deleteSelected: () => void;
    clearAll: () => void;
};
/** 发送动作：附图压缩、发送、成功后重读。 */
export declare function createSendActions(ports: ActionPorts): {
    send: () => void;
    pickFile: (file: File) => void;
};
/** 外壳动作需要的额外句柄。 */
export interface ShellDeps {
    readonly ports: ActionPorts;
    /** 记忆删除动作（确认后要分发到它们）。 */
    readonly history: {
        deleteSelected: () => void;
        clearAll: () => void;
    };
    /** 消息列表容器：展开更早的轮时要按高度差补偿滚动。 */
    readonly listRef: {
        current: HTMLDivElement | null;
    };
    /** 每次「加载更早」放出的轮数。 */
    readonly pageRounds: number;
}
/** 外壳动作：孤儿清理、确认条分发、「加载更早」。 */
export declare function createShellActions(deps: ShellDeps): {
    clearOrphans: () => void;
    ask: (kind: ConfirmKind) => void;
    cancelAsk: () => void;
    confirmAsk: () => void;
    showOlder: () => void;
};
