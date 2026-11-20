/**
 * WMO 天气码 → 图标几何：24×24 描边图形，供环境气泡按码取图。
 *
 * 只描述形状，不产出节点——网页端映射成 React 元素、桌面端映射成 SVG DOM，形状本身可离线单测。
 * 27 个码各自独立（同组用线条数量/长度表示强度）；表外的码回落成「阴」的那朵云。
 * @module dsh-pet/src/shared/env-icon
 */
/** 一个描边图元；线与圆用数值，路径用 SVG 的 d。 */
export type EnvIconShape = {
    readonly kind: 'path';
    readonly d: string;
} | {
    readonly kind: 'line';
    readonly x1: number;
    readonly y1: number;
    readonly x2: number;
    readonly y2: number;
} | {
    readonly kind: 'circle';
    readonly cx: number;
    readonly cy: number;
    readonly r: number;
};
/**
 * 取某个天气码的图标形状。
 *
 * @param code - WMO 天气码；未知码（上游新增或数据异常）回落到云。
 * @returns 可直接映射成 SVG 子节点的形状列表。
 */
export declare function envIconShapes(code: number): readonly EnvIconShape[];
