import type { Animations } from '../../../shared/types.ts';
/** 播完之后该做什么。 */
export type EndedCue = {
    kind: 'ignore';
} | {
    kind: 'work-rotate';
    anim: string;
} | {
    kind: 'work-replay';
} | {
    kind: 'event-done';
} | {
    kind: 'turn';
} | {
    kind: 'interaction-done';
} | {
    kind: 'random';
};
/** 冻结状态翻转。 */
export type FreezeCue = {
    kind: 'frozen';
} | {
    kind: 'resumed';
};
/** 播完判定的输入。 */
export interface EndedInput {
    /** 该宠物的动画池。 */
    animations: Animations;
    /** 刚播完的动画名。 */
    current: string;
    /** 当前工作状态；`undefined` 表示还没收到过。 */
    workState: string | null | undefined;
}
/**
 * 决定播完之后进哪条分支。
 *
 * @param input - 动画池、刚播完的动画与当前工作状态。
 * @returns 分支判定；拖拽中与冻结由调用方在更前面拦掉。
 */
export declare function decideEndedCue(input: EndedInput): EndedCue;
