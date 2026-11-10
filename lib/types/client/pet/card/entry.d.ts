import type { MenuMoreItem } from '../../../shared/menu.ts';
import type { CardLive } from './live.ts';
import type { CardMotion } from './motion.ts';
import type { CardStateApi } from './state.ts';
import type { Drag } from '../motion/drag.ts';
import type { MenuActions } from '../menu-actions.ts';
import type { RuntimePet } from '../types.ts';
import type * as ReactNS from 'react';
/** 注入的 react 能力。 */
export interface CardEntryRuntime {
    /** 副作用；卸载时关闭浮层。 */
    useEffect: (effect: ReactNS.EffectCallback, deps?: ReactNS.DependencyList) => void;
    /** 引用；浮层句柄与提示节点。 */
    useRef: <T>(initial: T) => ReactNS.MutableRefObject<T>;
}
/** 浮层入口的输入。 */
export interface CardEntryInput {
    /** 卡状态：提示显隐与写入口。 */
    card: CardStateApi;
    /** 成品配置的最新值。 */
    cfgRef: ReactNS.MutableRefObject<RuntimePet>;
    /** 装配根迟绑槽。 */
    live: ReactNS.MutableRefObject<CardLive>;
    /** 运动面：开菜单前要停飞与停走。 */
    motion: CardMotion;
    /** 拖拽驱动：拖拽中或刚拖完不弹菜单。 */
    drag: Drag;
    /** 第三方菜单项快照；只在右键那一刻读。 */
    menuItemsRef: ReactNS.MutableRefObject<MenuMoreItem[]>;
    /** 菜单动作派发。 */
    runMenuAction: MenuActions['run'];
    /** 打开待办面板：面板占气泡槽，显隐归气泡单槽管。 */
    showTodo: () => void;
    /** 开关待办面板：D 键用，已开则收起。 */
    toggleTodo: () => void;
    /** 悬浮提示节点：位置由本模块直接写 style。 */
    tipRef: ReactNS.MutableRefObject<HTMLDivElement | null>;
    /** 舞台节点：对话弹窗贴命中区右上角。 */
    stage: () => HTMLDivElement | null;
}
/** 浮层入口对外的读写面。 */
export interface CardEntry {
    /** 把提示框摆到光标右下，放不下时翻边并夹回视口。 */
    placeTip: (clientX: number, clientY: number) => void;
    /** 打开右键菜单。 */
    handleContextMenu: (e: ReactNS.MouseEvent<HTMLDivElement>) => void;
    /** 打开对话弹窗：菜单里「对话」那一项走这里；带图时直接进入待发送状态（拖拽用）。 */
    openChat: (image?: File) => void;
    /** 打开待办面板（右键菜单入口）。 */
    openTodo: () => void;
    /** 指针进入：先摆位再显示。 */
    onPointerEnter: (e: ReactNS.PointerEvent<HTMLDivElement>) => void;
    /** 指针离开：收起提示。 */
    onPointerLeave: () => void;
}
/**
 * 造浮层入口的 hook。
 *
 * @param rt - 注入的 react 能力。
 * @returns 接收装配输入的 hook，返回菜单、对话与提示的入口。
 */
export declare function createCardEntry(rt: CardEntryRuntime): (input: CardEntryInput) => CardEntry;
