/**
 * 待办提醒的节奏与文案（宿主半侧纯逻辑）。
 *
 * 只回答「什么时候该提醒」与「提醒说什么」：不读文件、不碰计时器与 HTTP，时间由调用方注入。
 * 到期越近提醒越密是这份模块的核心契约：调整档位只改下面的两张表，`nextReminderAt` 自动跟随。
 * @module dsh-pet/src/host/todo/policy
 */
import type { TodoRecord } from './types.ts';
/**
 * 按「距到期还有多久」取提醒间隔。
 *
 * @param remainingMs - 到期时刻减当前时刻；≤0 表示已逾期。
 * @returns 间隔毫秒；`Infinity` 表示这个阶段不该再提醒。
 */
export declare function reminderIntervalMs(remainingMs: number): number;
/**
 * 这一条待办下一次该在什么时候提醒。
 *
 * 以「上次提醒（没提醒过就用创建时刻）+ 当前阶段间隔」为下一次时刻：时间越接近到期，
 * 间隔越短，于是下一次提醒自动提前；改期限或重新打开会把 `lastRemindedAt` 清空，重新排期。
 * 剩余时间短于档位间隔时取剩余时间；已经逾期但从未提醒过时返回排期起点（即「现在就该提醒」），
 * 否则巡检错过第一次提醒后，逾期档位会把它推到 30 分钟之后。
 *
 * @param todo - 单条待办。
 * @param now - 当前时刻（epoch ms）。
 * @returns 下一次提醒时刻；已完成、无期限或已过提醒阶段时为 null。
 */
export declare function nextReminderAt(todo: TodoRecord, now: number): number | null;
/** 一条到点的提醒：待办本体与它该被提醒的时刻。 */
export interface DueReminder {
    todo: TodoRecord;
    at: number;
}
/**
 * 从清单里挑出「最该现在提醒」的一条。
 *
 * 一拍最多提醒一条：多条同时到期时按提醒时刻先后，再按到期先后（更急的优先）。
 *
 * @param todos - 全部待办。
 * @param now - 当前时刻（epoch ms）。
 * @returns 命中的待办；没有到点的返回 null。
 */
export declare function pickReminder(todos: readonly TodoRecord[], now: number): DueReminder | null;
/**
 * 把毫秒差写成人话。
 *
 * @param ms - 时长（非负；负数先取绝对值）。
 * @returns 例如「25分钟」「3小时」「2天」。
 */
export declare function spanText(ms: number): string;
/** 正文超长时按码点截断并补省略号。 */
export declare function truncateTodoText(text: string, max: number): string;
/**
 * 一条提醒的气泡文案。
 *
 * @param todo - 有期限且未完成的待办。
 * @param now - 当前时刻（epoch ms），用于判断还剩多久。
 * @returns 一句可以直接说出口的提醒。
 */
export declare function reminderText(todo: TodoRecord, now: number): string;
