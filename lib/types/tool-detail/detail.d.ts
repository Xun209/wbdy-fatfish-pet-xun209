/**
 * `tool/call` 事件 → 气泡详情；跳过、无法解析、无信息量 → null。
 *
 * 返回值可以直接写进 `sections.workStatus.data.task`（长度 ≤ TASK_TEXT_MAX + 1）。
 */
export declare function toolDetailFromEvent(event: {
    data?: {
        name?: unknown;
        arguments?: unknown;
    };
} | null | undefined): string | null;
