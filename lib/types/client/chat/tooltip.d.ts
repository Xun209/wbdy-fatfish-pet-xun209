/** 气泡 class（外观见 ./panel-css）。 */
export declare const TIP_CLASS = "pet-chat-tip";
/**
 * 触发元素的悬停属性：光标进入时在光标处出气泡，离开即收起。
 *
 * 不接 focus：点击按钮也会让它获得焦点，于是点图/点播放之后气泡会一直挂在屏幕上，
 * 键盘用户的可读名靠元素上的 `aria-label`。
 *
 * @param text - 气泡正文（已翻译）。
 */
export declare function tipAttrs(text: string): {
    onMouseEnter: (event: {
        clientX: number;
        clientY: number;
    }) => void;
    onMouseLeave: () => void;
};
/** 卸载面板时回收气泡与全局监听；样式标签由 ./styles 释放。 */
export declare function disposeTip(): void;
