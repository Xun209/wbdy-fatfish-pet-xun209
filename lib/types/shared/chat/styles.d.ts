/**
 * 对话弹窗的样式与尺寸参数：两端注入同一份 CSS。
 * 只放静态字符串与常量，不建 DOM、不读运行时状态。
 * @module dsh-pet/src/shared/chat/styles
 */
/** 弹窗样式。
 *  一条自适应输入框（无标题）+ 一行图标按钮（上传 / 截屏 / 按住说话）+ 可选的图片预览；
 *  初始 160px，随输入增宽、封顶 340px 后折行增高；回车发送，Esc 或点外关闭。
 *  宽度由 JS 按文本测量覆盖根元素宽度。 */
export declare const CHAT_CSS: string;
/** 输入框宽度自适应参数：初始小宽，随文本增宽，封顶后折行增高。 */
export declare const CHAT_MIN_W = 160;
export declare const CHAT_MAX_W = 340;
/** 输入框水平 padding 补偿（11×2） */
export declare const CHAT_H_PAD = 22;
/** 把弹窗样式注入文档一次；重复挂载不会重复插入。 */
export declare function injectChatCss(): void;
