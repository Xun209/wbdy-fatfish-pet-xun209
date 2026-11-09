import type { CardViewProps } from './view.ts';
import type { PetCardProps } from './props.ts';
import type { PetRuntime } from '../types.ts';
/**
 * 造卡片装配根的工厂：组件级单例（气泡、状态、指令、动画流）都在这里建一次。
 *
 * @param rt - 注入的 react 能力。
 * @returns 接收容器 props 的 hook，返回交给 card-view 的渲染输入。
 */
export declare function createCardRuntime(rt: PetRuntime): (props: PetCardProps) => CardViewProps;
