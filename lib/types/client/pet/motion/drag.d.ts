import type { BoxPoint } from './geometry.ts';
import type { PhysicsParams } from '../../../shared/types.ts';
import type * as ReactNS from 'react';
/** 拖拽驱动每次处理事件时取的当帧能力。 */
export interface DragCard {
    /** 本宠物 id，用于日志。 */
    petId: string;
    /** 宠物宽度（px）。 */
    size: number;
    /** 盒半宽（px）。 */
    halfW: number;
    /** 盒半高（px）。 */
    halfH: number;
    /** 舞台脚底垫高（px）。 */
    bottomPad: number;
    /** 该宠物的物理参数。 */
    physics: PhysicsParams;
    /** 拖拽动画池。 */
    dragAnims: string[];
    /** 点击动画池。 */
    clickAnims: string[];
    /** 待机动画池。 */
    idleAnims: string[];
    /** 当前动画名，抽待机时用来避开自己。 */
    currentAnim: string;
    /** 换源播一次。 */
    setOnce: (on: boolean) => void;
    /** 换成指定动画。 */
    playAnim: (anim: string) => void;
    /** 递增换源序号，强制 switchTo 走一遍。 */
    bumpSeq: () => void;
    /** 标记「等新首帧就位后压 Q 弹」。 */
    markSquash: () => void;
    /** 拖拽态：控制舞台位移与指针样式。 */
    setDragging: (on: boolean) => void;
    /** 恢复非终态工作循环；返回 false 表示没有可恢复的状态。 */
    resumeWork: () => boolean;
    /** 停走位与位置跟随。 */
    stopAutonomy: () => void;
    /** 停飞。 */
    stopFlight: () => void;
    /** 起飞。 */
    startFlight: (px: number, py: number, vx: number, vy: number) => void;
    /** 本卡是否被占用锁冻结。 */
    isFrozen: () => boolean;
    /** 本地解冻并释放宿主锁。 */
    releaseLock: () => void;
    /** 抓取瞬间的飞行速度；没在飞时为 null。 */
    grabVelocity: () => {
        vx: number;
        vy: number;
    } | null;
    /** 点击音效。 */
    playClickSound: () => void;
    /** 悬浮提示是否点亮。 */
    tipOn: () => boolean;
    /** 把提示摆到光标旁。 */
    placeTip: (x: number, y: number) => void;
    /** 切换提示显隐。 */
    setTipOn: (on: boolean) => void;
    /** 舞台元素。 */
    stage: () => HTMLDivElement | null;
    /** 根元素。 */
    root: () => HTMLDivElement | null;
    /** 当前包围盒位置。 */
    box: () => BoxPoint | null;
    /** 写回包围盒位置。 */
    setBox: (box: BoxPoint) => void;
    /** 原地放下：提交夹取后的归一化中心。 */
    commitPlace: (box: BoxPoint) => void;
}
/** 拖拽驱动对外的读写面。 */
export interface Drag {
    /** 按下：处理积分、拖拽与弹弓，并开启指针捕获。 */
    onPointerDown(e: ReactNS.PointerEvent<HTMLDivElement>): void;
    /** 移动：更新悬浮提示、拖拽阈值与弹簧目标。 */
    onPointerMove(e: ReactNS.PointerEvent<HTMLDivElement>): void;
    /** 松开与取消：结算拖拽或抛掷，并复位悬浮提示。 */
    onPointerUp(e: ReactNS.PointerEvent<HTMLDivElement>): void;
    /** 点击：播放点击动画并触发 Q 弹。 */
    onClick(): void;
    /** 停弹簧跟随，不碰指针捕获状态。 */
    stopFollow(): void;
    /** 摘掉鼠标松开兜底监听；卸载时调用，之后这个驱动不可再用。 */
    dispose(): void;
    /** 指针是否按着（含未超过拖动阈值）。 */
    isActive(): boolean;
    /** 是否刚拖完：松手后的短窗口内为真，右键菜单要忽略这段时间。 */
    justDragged(): boolean;
}
/**
 * 造拖拽驱动。
 *
 * @param card - 取当帧能力的 getter；每次事件处理时调用一次。
 * @returns 可反复调用的驱动；指针状态在实例内跨渲染保留。
 */
export declare function createDrag(card: () => DragCard): Drag;
