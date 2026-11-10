/**
 * 一张宠物卡的动画链装配：构造 OwnAnimation、跟随状态换源，并登记挂载期的只读服务。
 * 不负责运动与浮层：走位、拖拽、挤压经装配根的迟绑槽取值，本模块只决定「何时读」。
 * 卸载顺序固定：摘监听 → 注销 pose/progress → dispose 动画链 → 停三套运动。
 * @module dsh-pet/src/client/pet/card/animation
 */
import { type OwnAnimation, type OwnAnimationDeps } from '../animation/animation.ts';
import type { CardLive } from './live.ts';
import type { CardStateApi } from './state.ts';
import type { RuntimePet } from '../types.ts';
import type { LockState } from '../../../shared/state.ts';
import type { WorkStatusSnapshot } from '../../../shared/work-status.ts';
import type * as ReactNS from 'react';
/** 注入的 react 能力。 */
export interface CardAnimationRuntime {
    /** 副作用。 */
    useEffect: (effect: ReactNS.EffectCallback, deps?: ReactNS.DependencyList) => void;
    /** 引用；动画链只造一次。 */
    useRef: <T>(initial: T) => ReactNS.MutableRefObject<T>;
}
/** 动画链装配的输入；全部是取值函数或稳定引用。 */
export interface CardAnimationInput {
    /** 卡状态：动画名、序号与朝向都从它取。 */
    card: CardStateApi;
    /** 成品配置的最新值。 */
    cfgRef: ReactNS.MutableRefObject<RuntimePet>;
    /** 工作状态的最新值：播完判定要读，回调晚于状态更新。 */
    workStatusRef: ReactNS.MutableRefObject<WorkStatusSnapshot | null>;
    /** 装配根迟绑槽。 */
    live: ReactNS.MutableRefObject<CardLive>;
    /** 新首帧就位后是否补一次 Q 弹（点击互动置位）。 */
    pendingSquash: ReactNS.MutableRefObject<boolean>;
    /** 双缓冲的前台元素。 */
    videoA: () => HTMLVideoElement | null;
    /** 双缓冲的后台元素。 */
    videoB: () => HTMLVideoElement | null;
    /** 点播回执：真实播放结果只有浏览器侧知道。 */
    report: OwnAnimationDeps['report'];
    /** 挂载瞬间的锁叶子：只用于决定动画链初始是否冻结。 */
    lock?: LockState;
    /** 消费掉点播编号，避免 effect 再跑一趟。 */
    setCuePlayback: (id: string | null) => void;
    /** 本宠物 id：挂载期注册只读服务用它。 */
    petId: string;
}
/**
 * 造动画链接配的 hook。
 *
 * @param rt - 注入的 react 能力。
 * @returns 接收装配输入的 hook，返回本卡的动画链实例。
 */
export declare function createCardAnimation(rt: CardAnimationRuntime): (input: CardAnimationInput) => OwnAnimation;
