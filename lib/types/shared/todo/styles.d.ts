import type { FontConfig } from '../types.ts';
/** 面板根字号相对气泡字号的比例：默认配置（气泡 21.02px）下取整为 13px。 */
export declare const TODO_FONT_SCALE = 0.618;
/** 面板竖向预算（em，基准 = 面板根字号）：头部 + 表单 + 下半区，默认配置下约 329px。 */
export declare const TODO_PANEL_METRICS: {
    /** 头部：上下内边距 + 标题行（行高 1.5 × 字号 1.077）。 */
    readonly head: number;
    /** 表单：正文框 + 间距 + 时间行 + 下内边距。 */
    readonly form: number;
    /** 清单态：上下内边距 + 两行条目（每行 = 内边距 + 正文 + 行距 + 时间标签）。 */
    readonly list: number;
    /** 底部提示。 */
    readonly hint: number;
    /** 日历态：内边距 + 标题行 + 星期行 + 六行日期 + 底部操作行 + 行间空隙。 */
    readonly calendar: number;
};
/** 面板样式：头部 + 添加行 + 可滚动的清单 + 底部提示。 */
export declare const TODO_CSS: string;
/** 把面板样式注入文档一次；重复挂载不会重复插入。 */
export declare function injectTodoCss(): void;
/** 面板占用的窗口上边距（px）：桌面窗口余量必须容得下整块面板，否则面板顶端被窗口上沿切掉。
 *  算法与 {@link bubbleTopMarginPx} 同口径：面板底边同样落在宠物盒顶边下方 0.108 × 尺寸处。
 *  面板高度是常量（下半区固定），所以展开日历或出现错误行都不会改变窗口尺寸。
 *  @param font - 该宠物的 font 配置，缺失按默认口径。
 *  @param size - 该宠物的宽度 px。 */
export declare function todoPanelTopMarginPx(font: FontConfig | undefined, size: number): number;
