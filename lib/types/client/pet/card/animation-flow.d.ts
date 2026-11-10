import type { SleepState } from '../../../shared/state.ts';
import type { CardHub } from './hub.ts';
import type { EndedCue } from '../animation/cues.ts';
import type { WorkStatusSnapshot } from '../../../shared/work-status.ts';
import type * as ReactNS from 'react';
/** 动画流对外的动作面。 */
export interface AnimationFlow {
    /** 按播完判定改状态；回执与门禁已在动画链里处理过。 */
    applyEndedCue(cue: EndedCue): void;
    /** 按权重掷骰选下一段自播动画。 */
    pickNext(): void;
    /** 非终态工作状态回到档位循环；没有可恢复状态时返回 false。 */
    resumeWorkStatusAnim(): boolean;
    /** 说一句：抽碎碎念动画并弹气泡，动画与气泡时长互相独立。 */
    speak(text: string, image?: string, url?: string, duration?: number, anim?: boolean): void;
    /** 应用宿主写的睡觉状态：进入 → 播开始；退出 → 播起来。 */
    applySleep(state: SleepState): void;
    /** 此刻是否在睡（含入睡与醒来两段过渡）。 */
    sleeping(): boolean;
    /** 当前睡觉阶段；醒着为 null。点击路径要区分「入睡过渡」与「真睡着」。 */
    sleepPhase(): 'start' | 'loop' | 'end' | null;
}
/** 注入的 react 能力。 */
export interface AnimationFlowRuntime {
    /** 引用；工作状态的镜像。 */
    useRef: <T>(initial: T) => ReactNS.MutableRefObject<T>;
}
/**
 * 制造动画流的 hook。
 *
 * @param rt - 注入的 react 能力。
 * @returns 接收运行时与工作状态的 hook；回调里读 ref，不会读到旧值。
 */
export declare function createAnimationFlow(rt: AnimationFlowRuntime): (hub: CardHub, workStatus: WorkStatusSnapshot | null) => AnimationFlow;
