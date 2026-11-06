/**
 * 待办的展示格式化：到期时间、相对剩余与紧迫度。
 *
 * 纯函数，当前时刻由调用方传入；面板渲染、排序后的副标题与测试共用这一份口径。
 * 不负责取数与时区换算：`datetime-local` 的读写都按浏览器本地时区，与用户看到的一致。
 * @module dsh-pet/src/shared/todo/format
 */
import type { TodoItem } from './types.ts';
/** 紧迫度：面板据此染色，overdue 最红、undated 最淡。 */
export type TodoUrgency = 'overdue' | 'soon' | 'today' | 'later' | 'undated';
/**
 * 把毫秒差写成人话。
 *
 * @param ms - 时长（非负；负数先取绝对值），不足一分钟按一分钟算。
 * @returns 例如「25分钟」「3小时」「2天」。
 */
export declare function spanText(ms: number): string;
/**
 * 到期时刻的绝对说法（不含「还剩多久」）。
 *
 * @param dueAt - 到期时刻；null 表示没有期限。
 * @param now - 当前时刻。
 * @returns 「今天 18:00」「明天 09:00」「周五 20:00」「11月3日 09:00」「无期限」。
 */
export declare function dueLabel(dueAt: number | null, now: number): string;
/**
 * 相对说法：还剩多久 / 已逾期多久。
 *
 * @param dueAt - 到期时刻；null（无期限）时返回空串。
 * @param now - 当前时刻。
 * @returns 「还剩2小时」「已逾期3天」或 `''`。
 */
export declare function remainingLabel(dueAt: number | null, now: number): string;
/**
 * 紧迫度：只有「未完成」的待办才有意义。
 *
 * @param dueAt - 到期时刻；null = 无期限。
 * @param now - 当前时刻。
 * @returns 6 小时内为 soon，24 小时内为 today，更远为 later。
 */
export declare function todoUrgency(dueAt: number | null, now: number): TodoUrgency;
/**
 * 一条待办在列表里的副标题。
 *
 * @param todo - 待办本体。
 * @param now - 当前时刻。
 * @returns 已完成 → 「已完成」/「已完成 · 今天 18:00」；未完成 → 「今天 18:00 · 还剩2小时」。
 */
export declare function metaLabel(todo: TodoItem, now: number): string;
/**
 * 把时间戳写成 `datetime-local` 输入框认的本地字符串。
 *
 * @param ms - epoch 毫秒。
 * @returns `YYYY-MM-DDTHH:mm`（本地时区）。
 */
export declare function formatDateTimeLocal(ms: number): string;
/**
 * 读 `datetime-local` 的值；空串表示「没有期限」。
 *
 * @param value - 输入框的值，形如 `YYYY-MM-DDTHH:mm`。
 * @returns epoch 毫秒；空串、格式非法或日期不存在（如 2 月 30 日）时返回 null。
 */
export declare function parseDateTimeLocal(value: string): number | null;
