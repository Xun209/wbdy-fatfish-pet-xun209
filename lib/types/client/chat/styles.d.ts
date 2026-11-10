/**
 * 注入面板样式（幂等，按引用计数释放）。
 *
 * @returns 释放函数：最后一次释放时才移除 style 标签；重复调用安全。
 */
export declare function injectPanelCss(): () => void;
