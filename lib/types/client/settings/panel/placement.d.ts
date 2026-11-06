/**
 * 设置页浮层的定位计算：把触发器的实测矩形与视口尺寸换算成浮层的 fixed 坐标。
 * 下方放不下且上方更宽裕时翻到上方，左右钳制在视口内，并给出高度上限——浮层自身不进文档流。
 * 纯函数，不读 `window`：矩形与视口由调用方传入，便于单测与将来的视口外定位。
 * 模型选择器与通用单选下拉共用这一份算术，差异只经 {@link PlacementOptions} 传入，不在调用方各自复制。
 * @module dsh-pet/src/client/settings/panel/placement
 */
/** 触发器的实测矩形，语义同 `DOMRect` 的这几个字段。 */
export interface AnchorRect {
    left: number;
    top: number;
    bottom: number;
    width: number;
}
/** 视口尺寸，通常直接取 `window.innerWidth` / `innerHeight`。 */
export interface Viewport {
    width: number;
    height: number;
}
/** 浮层的 fixed 定位与尺寸；`top` 与 `bottom` 只有一个有值。 */
export interface PanelPosition {
    left: number;
    top?: number;
    bottom?: number;
    width: number;
    maxHeight: number;
}
/** 按浮层内容覆盖的默认值；缺省即模型选择器的取值。 */
export interface PlacementOptions {
    /** 浮层宽度下限（px）：模型清单要装下「服务商 + 模型」两段文字，故默认 240；单行下拉传 0 以跟触发器等宽。 */
    minWidthPx?: number;
    /** 浮层宽度上限（px），默认 420：再宽会横跨整个设置页。 */
    maxWidthPx?: number;
    /** 浮层高度上限（px），默认 360：超出后清单自己滚动。 */
    maxHeightPx?: number;
    /** 下方可用空间小于它（px）才考虑翻到上方，默认 240：否则即使靠近底部也优先向下展开。 */
    flipThresholdPx?: number;
}
/**
 * 算出浮层该贴在哪。
 *
 * @param anchor - 触发器的实测矩形。
 * @param viewport - 视口尺寸。
 * @param options - 宽度与翻面的阈值覆盖，见 {@link PlacementOptions}。
 * @returns 浮层定位；上方空间更宽裕时给出 `bottom`，否则给出 `top`。
 */
export declare function computePanelPlacement(anchor: AnchorRect, viewport: Viewport, options?: PlacementOptions): PanelPosition;
