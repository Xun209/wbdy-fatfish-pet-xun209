/**
 * 一条消息与一轮对话的节点：头像、气泡（文字 + 图片）、轮（问 + 答 + 时间）。
 *
 * 纯映射，不做取数与状态；时间的位置是唯一的约定：贴着这一轮最后一条消息。
 * @module dsh-pet/src/client/chat/view-message
 */
import { type ChatMessageView } from './api.ts';
import type { ChatPanelRuntime } from './runtime.ts';
import type { ChatPanelState } from './types.ts';
/**
 * 头像：宠物用插件 logo，我是一只 Q 版小脸（圆脸 + 呆毛 + 腮红 + 星星）。
 *
 * 画成内联 SVG 而不是图片：能直接用主题 token（深浅色自动跟随），也不用多一个资源请求。
 * 造型对齐桌宠的二次元调性，不与插件 logo 抢风格。
 */
export declare function avatarNode(h: ChatPanelRuntime['h'], isMe: boolean): unknown;
/**
 * 一条消息：头像 + 气泡；图片排在文字之后，点一下放大。
 *
 * `onOpenImage` 由轮节点传入，本模块不直接碰面板状态。
 */
export declare function messageNode(h: ChatPanelRuntime['h'], message: ChatMessageView, isMe: boolean, assetRoot: string, onOpenImage: (url: string) => void): unknown;
/** 一轮：问 + 答 + 时间；勾选框只在多选模式下出现。 */
export declare function roundNode(rt: ChatPanelRuntime, state: ChatPanelState, round: ChatPanelState['rounds'][number]): unknown;
