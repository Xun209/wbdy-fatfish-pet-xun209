import type { PetCardProps } from './props.ts';
import type { PetRuntime } from '../types.ts';
import type { FunctionComponent } from 'react';
/**
 * 造宠物卡组件。
 *
 * @param rt - 注入的 react 能力。
 * @returns 接收容器 props 的组件。
 */
export declare function createPetCard(rt: PetRuntime): FunctionComponent<PetCardProps>;
