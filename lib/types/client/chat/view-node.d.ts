import type { ChatPanelRuntime } from './runtime.ts';
import type { ChatPanelState } from './types.ts';
/**
 * 已删宠物残留历史的提示条：显示数量并给一个「清理」。
 *
 * 这类宠物已不在配置里，面板列表里根本看不到它——不在这里提示，用户就没有任何入口清掉。
 */
export declare function orphansNode(h: ChatPanelRuntime['h'], t: ChatPanelRuntime['t'], state: ChatPanelState): unknown;
/**
 * 人设卷帘：当前这只宠物实际在用的那段正文。
 *
 * 在正常流里展开，把消息列表顶下去——人设可以很长，浮在对话上会挡住内容。
 * 收起时保留 DOM 只把高度归零，否则没有展开过渡可播。
 */
export declare function personaNode(h: ChatPanelRuntime['h'], state: ChatPanelState): unknown;
/** 工具栏：多选开关、删除选中（带数量）、记忆线定位、刷新与清空历史；删除都先走面板内确认条。 */
export declare function toolsNode(h: ChatPanelRuntime['h'], t: ChatPanelRuntime['t'], state: ChatPanelState): unknown;
/**
 * 面板内的确认条：代替浏览器原生 `confirm`，样子跟面板一致。
 *
 * @returns 没有待确认操作时是 null。
 */
export declare function confirmNode(rt: ChatPanelRuntime, state: ChatPanelState): unknown;
/**
 * 输入区：一体化圆角容器 —— 上面输入框，下面工具行（附图 / 发送）。
 *
 * 造型对齐 DSH 自己的输入框；`focus-within` 让整个容器而不是内层框变色，
 * 因为内层 textarea 已经没有边框了。
 */
export declare function composerNode(h: ChatPanelRuntime['h'], t: ChatPanelRuntime['t'], state: ChatPanelState): unknown;
