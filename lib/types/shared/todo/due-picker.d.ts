/** 选择器句柄。 */
export interface DuePicker {
    /** 表单行里的触发按钮。 */
    readonly el: HTMLButtonElement;
    /** 日历容器；由面板插进根节点，默认收起。 */
    readonly calendar: HTMLElement;
    /** 当前值，`YYYY-MM-DDTHH:mm`；未选为 `''`。 */
    value(): string;
    /** 收起日历，已选的值保持不变。 */
    close(): void;
    /** 回到「无期限」并收起。 */
    reset(): void;
    /** 摘掉文档监听。 */
    dispose(): void;
}
/** 选择器的创建参数。 */
export interface DuePickerOptions {
    /** 展开或收起时回调，面板据此收起清单腾出高度。 */
    onOpenChange?: (open: boolean) => void;
}
/**
 * 造一个到期时间选择器。
 *
 * @param options - 展开与收起的回调。
 * @returns 触发按钮、日历容器与读写句柄。
 */
export declare function createDuePicker(options?: DuePickerOptions): DuePicker;
