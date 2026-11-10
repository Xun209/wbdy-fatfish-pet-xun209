/**
 * 待办面板的 DOM 骨架与清单渲染：只拼元素、绑事件，不取数、不定位、不关弹窗。
 *
 * 删除做成两步（先变成「确认」，2.5 秒后自动复原）：清单没有撤销，误点一次就没了太容易。
 * @module dsh-pet/src/shared/todo/render
 */
import { type DuePicker } from './due-picker.ts';
import type { TodoItem } from './types.ts';
/** 面板里需要被面板逻辑持有的元素。 */
export interface TodoPanelParts {
    /** 根：面板内容的外框，节点由调用方塞进容器。 */
    root: HTMLElement;
    /** 添加表单：回车提交。 */
    form: HTMLFormElement;
    /** 正文输入框。 */
    input: HTMLInputElement;
    /** 到期时间选择器：按钮在表单行，日历挂在根节点里。 */
    duePicker: DuePicker;
    /** 添加按钮。 */
    addButton: HTMLButtonElement;
    /** 清单容器。 */
    list: HTMLUListElement;
    /** 空态提示。 */
    empty: HTMLDivElement;
    /** 顶部的未完成计数。 */
    count: HTMLSpanElement;
    /** 右上角关闭按钮；桌面端窗口余量是穿透的，点空白收不起来，只能靠它。 */
    closeButton: HTMLButtonElement;
    /** 错误行（隐藏时为 `hidden`）。 */
    error: HTMLDivElement;
}
/** 清单条目上的交互回调。 */
export interface TodoListHandlers {
    /** 勾选 / 取消勾选。 */
    onToggle: (todo: TodoItem, done: boolean) => void;
    /** 删除（调用方已确认过一次）。 */
    onDelete: (todo: TodoItem) => void;
}
/**
 * 造面板骨架（尚未挂进文档）。
 *
 * @returns 面板需要的全部元素引用。
 */
export declare function createTodoPanelParts(): TodoPanelParts;
/**
 * 渲染一整张清单。
 *
 * @param parts - 面板元素。
 * @param todos - 已排序的待办。
 * @param handlers - 勾选与删除的回调。
 * @param now - 当前时刻，用来生成「还剩多久」。
 */
export declare function renderTodoList(parts: TodoPanelParts, todos: readonly TodoItem[], handlers: TodoListHandlers, now: number): void;
/**
 * 显示 / 清除错误行。
 *
 * @param parts - 面板元素。
 * @param message - 错误文案；null 表示清除。
 */
export declare function setTodoError(parts: TodoPanelParts, message: string | null): void;
/**
 * 切换忙碌态：请求在途时禁掉输入与按钮，避免连点建出两条。
 *
 * @param parts - 面板元素。
 * @param busy - 是否请求在途。
 */
export declare function setTodoBusy(parts: TodoPanelParts, busy: boolean): void;
