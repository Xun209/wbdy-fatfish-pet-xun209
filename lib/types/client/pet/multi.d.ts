/**
 * 多开容器：拉一次成品配置、长轮询 /state 叶子，再把指令分发给对应的宠物卡。
 * 只做「配置 → 渲染列表」与「叶子 → 每只宠物」的分发，不解释叶子语义、不画 DOM。
 * 必须始终成立：首拉只记基线，之后 counter 变化才分发；配置形状异常时显式报错，绝不用空列表清空。
 * @module dsh-pet/src/client/pet/multi
 */
import type { FunctionComponent, ReactNode } from 'react';
import type { PetCardProps } from './card/props.ts';
import type { PetRuntime } from './types.ts';
/**
 * 造多开容器。
 *
 * @param rt - 注入的 react 能力。
 * @param Card - 单只宠物的卡片组件。
 * @returns 容器组件。
 */
export declare function createPetMulti(rt: Pick<PetRuntime, 'h' | 'useState' | 'useEffect' | 'useRef'>, Card: FunctionComponent<PetCardProps>): () => ReactNode;
