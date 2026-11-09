import type { PetRuntime } from './pet/types.ts';
import type { ReactNode } from 'react';
export type { RuntimePet } from './pet/types.ts';
/**
 * 制造宠物页面组件（工厂），返回多开容器 PetMulti。
 *
 * @param rt - 注入的 react 能力。
 * @returns 多开容器组件；容器内部渲染多个 PetCard。
 */
export declare function makePetUI(rt: PetRuntime): () => ReactNode;
