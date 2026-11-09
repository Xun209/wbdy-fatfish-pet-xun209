/**
 * 待办的 wire 形状与解析：面板只消费宿主 /todos 返回的数据。
 *
 * 不做取数与渲染；字段口径与 host/todo/types 同名（宿主不 import 共享层，两份各自维护）。
 * 宿主已校验并排序，这里再收窄一次类型：脏数据跳过而不是让整张清单渲染失败。
 * @module dsh-pet/src/shared/todo/types
 */
/** 一条待办（面板展示所需的最小字段）。 */
export interface TodoItem {
    /** 宿主生成的实例内标识；PATCH / DELETE 的路径段。 */
    id: string;
    text: string;
    /** 到期时刻（epoch ms）；null = 无期限。 */
    dueAt: number | null;
    done: boolean;
    createdAt: number;
    updatedAt: number;
    /** 完成时刻；未完成为 null。 */
    completedAt: number | null;
}
/**
 * 收窄一条待办。
 *
 * @param raw - 响应体里的单条。
 * @returns 合法时返回记录；id / 正文缺失或 dueAt 类型不对时返回 null。
 */
export declare function parseTodoItem(raw: unknown): TodoItem | null;
/**
 * 收窄整张清单：不是数组按空清单处理，坏条目逐条跳过。
 *
 * @param raw - 响应体里的 `todos` 字段。
 * @returns 已校验的清单（保持原顺序）。
 */
export declare function parseTodoList(raw: unknown): TodoItem[];
/**
 * 展示顺序：未完成在前（到期越近越靠前，无期限垫底），已完成在后（最近完成的在上）。
 *
 * 宿主也排过一次；这里再排一次是为了「单条 PATCH 的响应直接插进列表」时顺序不歪。
 *
 * @param list - 任意顺序的清单。
 * @returns 排好序的新数组。
 */
export declare function sortTodoItems(list: readonly TodoItem[]): TodoItem[];
