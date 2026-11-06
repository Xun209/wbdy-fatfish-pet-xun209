/**
 * 睡觉状态机：把宿主写定的一套三段名翻译成动画链上的动作，并在睡着时替随机链把关。
 *
 * 只管「播哪一段、到哪一步」；播完判定由 animation-flow 转交本模块的 consumeEnded()，
 * 醒来后回随机链由调用方传入的 pickNext 决定。不依赖 React。
 * 不变量：进入必须先播 start（once）再切 loop（无限播）；入睡过渡里退出时不播 end。
 * 循环段没有 ended——收到就说明前台已被别的动画顶掉，必须重新点名 loop，而不是重播前台。
 * @module dsh-pet/src/client/pet/card/sleep-machine
 */
import type { SleepState } from '../../../shared/state.ts';
import type { CardHub } from './hub.ts';
/** 睡觉阶段：`start` 入睡过渡、`loop` 睡眠循环、`end` 醒来过渡。 */
export type SleepPhase = 'start' | 'loop' | 'end';
/** 状态机对外面：进睡 / 收尾 / 查询。 */
export interface SleepMachine {
    /** 应用宿主写的叶子：进入播 start，退出播 end（入睡过渡中退出则直接作废、不播 end）。 */
    apply(state: SleepState): void;
    /** 播完判定：返回 true = 这次 ended 归睡觉管，调用方直接 return；false = 按常规处理。 */
    consumeEnded(): boolean;
    /** 此刻是否在睡（含入睡与醒来两段过渡）。 */
    sleeping(): boolean;
    /** 当前阶段；醒着为 null。 */
    phase(): SleepPhase | null;
}
/**
 * 造睡觉状态机。
 *
 * @param hub - 卡片共享运行时（取动画写入口与气泡槽）。
 * @param pickNext - 醒来后回到随机链的动作（由动画流提供，避免本模块反向 import）。
 * @param log - 一行日志出口（格式与动画流一致）。
 */
export declare function createSleepMachine(hub: CardHub, pickNext: () => void, log: (petId: string, message: string) => void): SleepMachine;
