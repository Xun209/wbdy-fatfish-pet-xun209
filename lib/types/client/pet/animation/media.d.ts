/**
 * 是否优先要 mov：macOS 与 iOS 的 WebKit 才要；其余按 Chromium/Firefox 处理。
 *
 * @returns 需要 HEVC-alpha 时返回 true。
 */
export declare function prefersMov(): boolean;
/**
 * 取本次会话使用的动画扩展名（含点）。显式常量优先，否则按渲染端判断。
 * 宿主对缺失的 `.mov` 会退回同名 `.webm`，所以这里只管「要哪一种」。
 *
 * @returns `.mov` 或 `.webm`。
 */
export declare function thumbExt(): string;
