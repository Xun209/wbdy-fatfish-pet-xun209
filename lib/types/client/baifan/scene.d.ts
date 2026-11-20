import { type Geometry } from './geometry.ts';
/** 场上的一份饭。 */
export interface RiceItem {
    /** 元素。 */
    el: HTMLImageElement;
    /** 视口中心 x。 */
    x: number;
    /** 底边 y。 */
    y: number;
    /** 渲染宽。 */
    w: number;
    /** 渲染高。 */
    h: number;
    /** 碗饭还是饭团。 */
    type: 'bowl' | 'ball';
    /** 下落速度（像素/秒）。 */
    vy: number;
    /** 当前旋转角（度）。 */
    rot: number;
    /** 旋转速度（度/秒）。 */
    spin: number;
    /** 状态：还在落 / 已落地。 */
    state: 'falling' | 'ground';
}
/**
 * 造米饭层。
 *
 * @param layer - 覆盖层根节点（本层所有元素都挂它下面）。
 * @param toastEl - 提示条节点；`toast()` 直接写它。
 * @returns 生成、落体、飞行、计分与清理的方法。
 */
export declare function createScene(layer: HTMLDivElement, toastEl: HTMLDivElement): {
    clear: () => void;
    detach: (item: RiceItem) => void;
    dropEmptyBowl: (x: number, fromY: number, scale: number) => void;
    flyToMouth: (item: RiceItem, mouthX: number, mouthY: number, durationMs: number) => void;
    kick: () => void;
    nearest: (petPx: number, facing: "left" | "right") => RiceItem | null;
    popScore: (value: number, type: "bowl" | "ball", geom: Geometry) => void;
    /** 场上还有几份（调用方据此决定要不要继续掉）。 */
    count: () => number;
    /** 精灵缩放到米饭尺寸用：按基准宽换算（大宠物配大盘饭，不夹到 1）。 */
    scaleOf: (spriteW: number) => number;
    spawn: (scale: number) => RiceItem | null;
    toast: (text: string) => void;
};
/** 米饭层的公开面。 */
export type Scene = ReturnType<typeof createScene>;
