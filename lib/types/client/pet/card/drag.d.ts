/**
 * 指针拖拽的装配：把当帧能力束成 DragCard，再交给驱动长期持有。
 * 依赖 motion 的运动面与迟绑槽里的动画流、锁与提示——它们创建得更晚，只在回调里读。
 * 只建一次：驱动自带指针状态机与捕获，重建会让按下中的手势丢失。
 * @module dsh-pet/src/client/pet/card/drag
 */
import { type Drag } from '../motion/drag.ts';
import type { CardLive } from './live.ts';
import type { CardMotion } from './motion.ts';
import type { CardStateApi } from './state.ts';
import type { RuntimePet } from '../types.ts';
import type * as ReactNS from 'react';
/** 注入的 react 能力。 */
export interface CardDragRuntime {
    /** 副作用；卸载时摘掉驱动的鼠标松开兜底监听。 */
    useEffect: (effect: ReactNS.EffectCallback, deps?: ReactNS.DependencyList) => void;
    /** 引用；拖拽驱动只造一次。 */
    useRef: <T>(initial: T) => ReactNS.MutableRefObject<T>;
}
/** 拖拽装配的输入。 */
export interface CardDragInput {
    /** 卡状态：动画名与几何的最新值。 */
    card: CardStateApi;
    /** 成品配置的最新值。 */
    cfgRef: ReactNS.MutableRefObject<RuntimePet>;
    /** 装配根迟绑槽。 */
    live: ReactNS.MutableRefObject<CardLive>;
    /** 运动面：飞行、走位、包围盒都经它。 */
    motion: CardMotion;
    /** 宠物根节点。 */
    root: () => HTMLDivElement | null;
    /** 舞台节点：提示与命中的定位基准。 */
    stage: () => HTMLDivElement | null;
    /** 等新首帧就位后再压 Q 弹。 */
    pendingSquash: ReactNS.MutableRefObject<boolean>;
    /** 归一化中心写入口。 */
    setCustomPos: CardStateApi['actions']['setCustomPos'];
    /** 换源播一次。 */
    setOnce: (on: boolean) => void;
    /** 换成指定动画。 */
    setAnim: (anim: string) => void;
    /** 递增换源序号，强制重播。 */
    bumpSeq: () => void;
    /** 拖拽态。 */
    setDragging: (on: boolean) => void;
    /** 悬浮提示显隐。 */
    setTipOn: (on: boolean) => void;
}
/**
 * 造拖拽装配的 hook。
 *
 * @param rt - 注入的 react 能力。
 * @returns 接收装配输入的 hook，返回本卡的拖拽驱动。
 */
export declare function createCardDrag(rt: CardDragRuntime): (input: CardDragInput) => Drag;
