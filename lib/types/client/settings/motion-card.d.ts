/**
 * 动作频率卡（main 条目）：待机 / 转向 / 移动三个权重可改，随机动作只读自动算。
 * 只改本地状态，随「保存」整包写入；合计锁在 100%，改一项时其余不动、随机动作吸收差额。
 * 写的是 main 条目，作为所有宠物的全局默认；pet pack 可在自己种类文件里覆盖。
 * @module dsh-pet/src/client/settings/motion-card
 */
import type { FunctionComponent } from 'react';
import type { Weights } from '../../shared/types.ts';
import type { SettingsRuntime } from './runtime.ts';
/** 动作频率卡的输入。 */
export interface MotionCardProps {
    /** 保存中或配置未就绪时禁用全部输入。 */
    busy: boolean;
    /** 当前三项权重（随机动作是余量，不在这里）。 */
    weights: Weights;
    /** 改其中一项后的完整权重。 */
    onChange: (weights: Weights) => void;
}
/**
 * 造动作频率卡。
 *
 * @param rt - 注入的 react 能力与翻译函数。
 * @returns 卡片组件。
 */
export declare function makeMotionCard(rt: SettingsRuntime): FunctionComponent<MotionCardProps>;
