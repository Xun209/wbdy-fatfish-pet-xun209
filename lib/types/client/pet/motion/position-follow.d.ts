import type { PositionMode } from '../../../shared/state.ts';
import { type BoxPoint, type Center, type HalfSize, type Viewport } from './geometry.ts';
/** 位置跟随的依赖：全部用取值函数，避免捕获渲染期的快照。 */
export interface PositionFollowDeps {
    /** 宠物根节点；`null` 表示还没挂载。 */
    root: () => HTMLDivElement | null;
    /** 当前包围盒位置（px）；`null` = 还没落过位。 */
    box: () => BoxPoint | null;
    /** 写回包围盒位置（每帧调用）。 */
    setBox: (box: BoxPoint) => void;
    /** 落位后提交归一化中心，交给 React 重排。 */
    commit: (center: Center) => void;
    /** 当前视口尺寸。 */
    viewport: () => Viewport;
    /** 盒的半宽半高。 */
    half: () => HalfSize;
    /** 弹簧刚度（取成品配置的 `physics.throwPower`）。 */
    spring: () => number;
    /** 用户是否正按着宠物：按着时整拍丢弃。 */
    isDragging: () => boolean;
    /** 接管前先停掉飞行与走位。 */
    takeOver: () => void;
}
/** 位置跟随驱动：一个宠物一个实例。 */
export interface PositionFollow {
    /**
     * 执行一次位置指令。
     *
     * @param rx - 目标中心相对视口的横向比例。
     * @param ry - 目标中心相对视口的纵向比例。
     * @param mode - 落位方式。
     * @param duration - `line` 模式的时长（ms）；`<= 0` 视同 instant。
     */
    apply: (rx: number, ry: number, mode: PositionMode, duration: number) => void;
    /** 放弃进行中的跟随（走位或新的接管会用到）。 */
    stop: () => void;
}
/**
 * 造位置跟随驱动。
 *
 * @param deps - 取位置、写位置与接管回调。
 * @returns 可反复调用的驱动。
 */
export declare function createPositionFollow(deps: PositionFollowDeps): PositionFollow;
