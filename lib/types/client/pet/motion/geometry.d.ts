import type { CSSProperties } from 'react';
/** 视口尺寸。 */
export interface Viewport {
    width: number;
    height: number;
}
/** 宠物盒的半宽与半高（高度按 16:9 由宽度推出）。 */
export interface HalfSize {
    w: number;
    h: number;
}
/** 归一化中心（0..1，相对视口）。 */
export interface Center {
    rx: number;
    ry: number;
}
/** 包围盒左上角像素坐标。 */
export interface BoxPoint {
    x: number;
    y: number;
}
/** 宠物盒的派生度量（px），全部由宽度按固定画布基准推出。 */
export interface PetMetrics {
    /** 盒半宽。 */
    halfW: number;
    /** 盒半高，按 16:9 由宽度推出。 */
    halfH: number;
    /** 舞台脚底垫高：命中框与碰撞 body 框都按它上移。 */
    bottomPad: number;
    /** 左右透明边余量：漫游夹取按身体贴边，宠物能走到屏幕边缘而身体不越界。 */
    sideAllow: number;
}
/**
 * 按宠物宽度算出盒子度量。
 *
 * @param size - 宠物宽度 px。
 * @returns 四个派生量，随宽度线性缩放。
 */
export declare function derivePetMetrics(size: number): PetMetrics;
/**
 * 归一化中心 → 包围盒左上角像素。
 *
 * @param center - 宠物中心相对视口的比例。
 * @param viewport - 视口尺寸。
 * @param half - 盒的半宽半高。
 * @returns 根节点 `left`/`top` 该写的像素值。
 */
export declare function centerToBox(center: Center, viewport: Viewport, half: HalfSize): BoxPoint;
/**
 * 包围盒左上角像素 → 归一化中心；{@link centerToBox} 的逆运算。
 *
 * @param box - 根节点当前的 `left`/`top`（px）。
 * @param viewport - 视口尺寸。
 * @param half - 盒的半宽半高。
 * @returns 可提交给 `customPos` 的归一化中心。
 */
export declare function boxToRatio(box: BoxPoint, viewport: Viewport, half: HalfSize): Center;
/** 越界摆放的可见下限（px）：命中区留在视口内至少这么多，右键才点得到。 */
export declare const MIN_REACHABLE_PX = 24;
/**
 * 把越界摆放的盒子收到「命中区至少还可见 {@link MIN_REACHABLE_PX}」。
 *
 * 只压单轴的一侧，不要求完整可见：宠物仍能挂在边缘，只是不会整只消失。
 *
 * @param box - 待提交的盒左上角（px）。
 * @param viewport - 视口尺寸。
 * @param body - 命中区的两个输入：宠物宽度与舞台脚垫。
 * @returns 夹取后的盒左上角；本来就在范围内时原值返回。
 */
export declare function clampReachableBox(box: BoxPoint, viewport: Viewport, body: {
    size: number;
    bottomPad: number;
}): BoxPoint;
/** 舞台内联样式：拖拽中取消脚垫位移，让视频贴着指针走。 */
export declare function petStageStyle(dragging: boolean, bottomPad: number): CSSProperties;
/**
 * 根节点的定位内联样式。
 *
 * 有 customPos 时按归一化中心换算成 px 定位；没有时返回空对象，交给角落与边距的 CSS 变量定位。
 * 此处只做换算，不夹取：落点保留「挂在边缘」的自由，可见下限在提交位置时由 {@link clampReachableBox} 保证。
 *
 * @param customPos - 用户拖拽后的归一化中心；null 表示仍按角落定位。
 * @param viewport - 视口尺寸。
 * @param half - 盒的半宽半高。
 * @returns 可直接并入根节点 style 的定位字段；未定位时为空对象。
 */
export declare function petRootStyle(customPos: Center | null, viewport: Viewport, half: HalfSize): CSSProperties;
/** 命中区样式：把 640×360 画布上的命中框换算成相对宠物盒的百分比。 */
export declare const PET_HIT_STYLE: CSSProperties;
