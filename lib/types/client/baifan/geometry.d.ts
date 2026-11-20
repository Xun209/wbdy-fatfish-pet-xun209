/** 量距缓存：上一次在 DOM 里量到的精灵盒子。 */
export interface SpriteBox {
    /** 精灵渲染宽（像素）。 */
    w: number;
    /** 精灵渲染高（像素）。 */
    h: number;
}
/** 由实况算出的这一帧几何量（全部视口像素）。 */
export interface Geometry {
    /** 中心点视口 x。 */
    cx: number;
    /** 中心点视口 y。 */
    cy: number;
    /** 精灵盒宽。 */
    w: number;
    /** 真正画出来的内容高（按 16:9 从盒子里裁出来）。 */
    h: number;
    /** 内容区顶边。 */
    top: number;
    /** 脚底 y。 */
    feet: number;
    /** 嘴 y。 */
    mouthY: number;
    /** 相对基准宽的缩放。 */
    scale: number;
}
/** 实况：归一化中心点与朝向。 */
export interface Pose {
    /** 归一化中心 x（0–1）。 */
    x: number;
    /** 归一化中心 y（0–1）。 */
    y: number;
    /** 朝向。 */
    facing: 'left' | 'right';
}
/** 归一化坐标夹到 0–1（窗口极小时算出来的值会越界）。 */
export declare const clamp01: (v: number) => number;
/**
 * 量精灵盒子。
 *
 * 优先找**正压在实况中心点上的那段 `<video>`**（渲染端把宠物画成 video），它的 rect
 * 就是角色真实占位——这样不必猜 size 是宽还是高。找不到就退回上次量到的值，再不行按 16:9 兜底。
 *
 * @param cx - 中心点视口 x。
 * @param cy - 中心点视口 y。
 * @param last - 上一次量到的盒子（可能还没量过）。
 * @returns 本次量到的盒子。
 */
export declare function spriteBox(cx: number, cy: number, last: SpriteBox): SpriteBox;
/**
 * 由实况算出这一帧的几何量。
 *
 * 素材是 16:9，但渲染端容器不一定也是 16:9（可能正方形、也可能带内边距），那时角色在容器里
 * 是**带黑边的**。所以先按 16:9 裁出真正画出来的那块，再算脚底和嘴——否则脚底会算低，角色被下沿切掉半截。
 *
 * @param pose - 实况。
 * @param box - 精灵盒子。
 * @returns 这一帧的几何量。
 */
export declare function geometry(pose: Pose, box: SpriteBox): Geometry;
/** 地面线（视口像素，米饭底边落在这儿）。 */
export declare const groundLine: () => number;
/**
 * 让脚底落在地面线时，中心点该在哪个归一化 y。
 *
 * @param geom - 当前几何量。
 * @returns 归一化 y。
 */
export declare function bottomNormY(geom: Geometry): number;
