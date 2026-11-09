/** 百分比下限（%）：小于它等于没写。不设上限——填 150 就是「人物比屏还宽」，由 `size` 决定画框最终多大。 */
export declare const SIZE_PERCENT_MIN = 1;
/** 默认值：人物占屏宽的 20%——小屏不糊脸，宽屏下实际仍被 `size` 这个画框上限夹住。 */
export declare const SIZE_PERCENT_DEFAULT = 20;
/**
 * 百分比是否可用：必须是有限数字，且不小于下限。
 *
 * @param value - 配置里的原始值，可能未定义。
 * @returns 可用时 true 并把类型收窄为 number；`undefined`、字符串、`NaN`、`< 1` 均为 false。
 */
export declare function isValidSizePercent(value: unknown): value is number;
/**
 * 取本次挂载使用的宽度。
 *
 * @param sizePx - 配置里的画框宽度，同时是百分比的上限（百分比算出的画框超过它就取它）。
 * @param sizePercent - 人物占屏宽的百分比；缺省按 {@link SIZE_PERCENT_DEFAULT} 处理。
 * @param viewportWidthPx - 调用时刻的视口宽（CSS 像素）；非正数表示拿不到，直接回落到 `sizePx`。
 * @returns 实际渲染的画框宽度，单位 px。
 */
export declare function resolvePetSizePx(sizePx: number, sizePercent: number | undefined, viewportWidthPx: number): number;
