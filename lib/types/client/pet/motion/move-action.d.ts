/**
 * 一次自主走位的规划：选动作、算方向与距离、交给共享层的 `planMove` 判可达性。
 * 距离按宠物尺寸等比缩放（`minDist`/`maxDist` 是基准宽度下的像素），越界就返回 `null` 让调用方退回原地动作。
 * 纯规划：占用判定（rAF 是否在跑）留在调用方，因为那是 ref 状态。
 * @module dsh-pet/src/client/pet/motion/move-action
 */
import { type MovePlan } from '../../../shared/motion.ts';
import type { MovesConfig } from '../../../shared/types.ts';
/** 一次待执行的走位：几何比例 + 方向与首尾留白（秒）。 */
export interface PendingMove extends MovePlan {
    /** 1 = 向右，-1 = 向左。 */
    dir: 1 | -1;
    /** 动作开头多少秒内不位移（起脚）。 */
    leadSec: number;
    /** 动作结尾多少秒前就到位（收脚）。 */
    tailSec: number;
}
/** 规划输入。 */
export interface MoveActionInput {
    /** 该宠物的走位池。 */
    moves: MovesConfig;
    /** 菜单点播指定的动作名；缺省随机。 */
    preferredName?: string;
    /** 当前朝向，决定走位方向。 */
    facing: 'left' | 'right';
    /** 宠物宽度（px）。 */
    size: number;
    /** 当前宠物中心（px）。 */
    center: {
        x: number;
        y: number;
    };
    /** 视口尺寸（px）。 */
    viewport: {
        width: number;
        height: number;
    };
    /** 盒的半宽。 */
    halfW: number;
    /** 身体相对视频盒左右各留的像素（透明边）。 */
    sideAllow: number;
    /** 随机源，默认 `Math.random`；注入以便测试。 */
    random?: () => number;
}
/** 规划结果：`null` = 没有可用动作或落点越界。 */
export interface MoveAction {
    /** 要播的走位动作名。 */
    anim: string;
    /** 待执行的走位（rAF 驱动时才消费）。 */
    pending: PendingMove;
}
/**
 * 规划一次自主走位。
 *
 * @param input - 走位池、朝向、尺寸与视口。
 * @returns 动作名与待执行走位；无法移动时返回 `null`。
 */
export declare function planMoveAction(input: MoveActionInput): MoveAction | null;
