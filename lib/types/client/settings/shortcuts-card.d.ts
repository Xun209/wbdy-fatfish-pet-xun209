/**
 * 快捷键卡：把键分成两组——宠物自己的悬停键，与 DSH 分发的全局快捷键。
 *
 * 悬停键是插件自己的监听，直接读各模块常量；全局快捷键的键位可以被用户改绑，
 * 必须问 DSH 要当前值——否则改完绑，这张卡还在念默认组合。
 * 分组不是排版偏好：两组键由不同代码派发、生效条件也不同（悬停 vs 页面任意位置），
 * 混在一张表里读者分不清按了没反应是哪种原因。
 * 与页尾其它参考卡一样默认收起；纯展示，开合态只活在组件里。
 * @module dsh-pet/src/client/settings/shortcuts-card
 */
import type { FunctionComponent } from 'react';
import { type ShortcutHost } from '../app-shortcut.ts';
import type { SettingsRuntime } from './runtime.ts';
/**
 * 造快捷键卡。
 *
 * @param rt - 注入的 react 能力与翻译函数。
 * @param ctx - 客户端上下文：读改绑后的键位。
 * @returns 卡片组件。
 */
export declare function makeShortcutsCard(rt: SettingsRuntime, ctx: ShortcutHost): FunctionComponent;
