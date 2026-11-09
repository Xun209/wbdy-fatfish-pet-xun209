import type { BoxPoint } from './geometry.ts';
import type { MovesConfig } from '../../../shared/types.ts';
/** 走位需要的当帧几何（px）。 */
export interface WalkMetrics {
    /** 宠物宽度。 */
    size: number;
    /** 盒半宽。 */
    halfW: number;
    /** 盒半高。 */
    halfH: number;
    /** 身体相对视频盒左右各留的透明边。 */
    sideAllow: number;
}
/** 走位驱动的依赖：全部用取值函数，避免捕获渲染期的快照。 */
export interface WalkDeps {
    /** 宠物根节点；`null` 表示还没挂载。 */
    root(): HTMLDivElement | null;
    /** 当前宠物中心的视口坐标。 */
    center(): {
        x: number;
        y: number;
    };
    /** 当帧几何。 */
    metrics(): WalkMetrics;
    /** 该宠物的走位池。 */
    moves(): MovesConfig;
    /** 当前朝向，决定走位方向。 */
    facing(): 'left' | 'right';
    /** 当前视口尺寸。 */
    viewport(): {
        width: number;
        height: number;
    };
    /** 抛掷是否在飞：飞行中不发起新的走位。 */
    isFlying(): boolean;
    /** 换成走路动作并播一次。 */
    play(anim: string): void;
    /** 每帧回写包围盒：抛掷起点与宠物互撞都优先读它。 */
    setBox(box: BoxPoint): void;
    /** 走位结束提交归一化中心，交给 React 重排。 */
    commit(center: {
        rx: number;
        ry: number;
    }): void;
}
/** 走位驱动：一个宠物一个实例。 */
export interface Walk {
    /** 是否有排队的动作；视频就绪时据此决定要不要开跑。 */
    hasPending(): boolean;
    /** 视频就绪后开跑；没有排队的动作时立即返回。 */
    start(el: HTMLVideoElement): void;
    /** 尝试发起一次走位：占用中返回 `true`，无法移动返回 `false`，成功返回动作名。 */
    tryMove(preferredName?: string): boolean | string;
    /** 停走：作废已排队的动作并取消在跑的帧。 */
    stop(): void;
}
/**
 * 造走位驱动。
 *
 * @param deps - 取位置、几何与回写位置的回调。
 * @returns 可反复调用的驱动。
 */
export declare function createWalk(deps: WalkDeps): Walk;
