/**
 * 面板的尺寸常量：CSS 与 JS 共用的唯一来源。
 *
 * 尺寸不写字面量（规范要求走共享常量）；输入框的最大高度还要被自动长高的脚本读到，
 * 所以放在这里而不是 CSS 字符串里各写一份。
 * @module dsh-pet/src/client/chat/metrics
 */
/** 面板尺寸与间距（px）。 */
export declare const SIZE: {
    readonly pad: 12;
    readonly padBottom: 10;
    readonly gap: 8;
    readonly gapTight: 6;
    readonly gapWide: 10;
    readonly listGap: 20;
    readonly avatar: 28;
    readonly imgMaxW: 220;
    readonly imgMaxH: 180;
    readonly preview: 48;
    readonly hairline: 2;
    /** 播报按钮生成中的转圈直径；与 11px 的时间文字同高，不压过文字。 */
    readonly spinner: 12;
    readonly tabPadY: 3;
    readonly tabPadX: 12;
    readonly toolPadY: 2;
    readonly toolPadX: 10;
    readonly bubblePadY: 8;
    readonly bubblePadX: 12;
    readonly composerPad: 10;
    readonly composerPadBottom: 6;
    readonly inputMinH: 44;
    readonly inputMaxH: 140;
    readonly send: 34;
    readonly pillPadY: 4;
    readonly pill: 999;
    /** 悬浮提示气泡的内边距（纵、横）；与设置页的 data-tip 气泡一致。 */
    readonly tipPadY: 6;
    readonly tipPadX: 10;
    /** 悬浮提示气泡的最大宽度：一行放不下就省略，不做换行（换行会让宽度随位置跳变）。 */
    readonly tipMaxW: 260;
    /** 人设卷帘里正文的最大高度：人设没有长度上限，超过就在这块内部滚动。 */
    readonly personaMaxH: 200;
};
/** 输入框自动长高的上限（px）；超过就内部滚动。 */
export declare const INPUT_MAX_HEIGHT: 140;
/** 数值 → px 字符串。 */
export declare const px: (value: number) => string;
