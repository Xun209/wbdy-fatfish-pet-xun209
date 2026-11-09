import type { EncodedImage } from './encode.ts';
/** 对话弹窗挂载句柄。 */
export interface ChatDialogMount {
    /** 根元素（document.body 下） */
    el: HTMLElement;
    /** 关闭并清理（幂等） */
    close: () => void;
    /** 开录：快捷键「按住说话」按下时用（麦克风已在录、环境不支持时无动作）。 */
    startHear: () => void;
    /** 收尾：快捷键松开时用（没在录时无动作）。 */
    stopHear: () => void;
    /** 此刻是否真的在采集。 */
    isHearing: () => boolean;
    /** 放进一张已编码的图（截图快捷键在弹窗已开时走这条）；返回是否收下。 */
    setEncoded: (encoded: EncodedImage) => boolean;
    /** 放进一张图片文件（粘贴、拖拽在弹窗已开时走这条）；类型不接受或编码失败时返回 false。 */
    setImageFile: (file: File) => Promise<boolean>;
    /** 在弹窗里显示一条临时提示（截图失败这类原因，超时自动收起）。 */
    flash: (text: string) => void;
}
/** 挂载对话弹窗的入参。 */
export interface ChatDialogOptions {
    petId: string;
    /** 端点基址：浏览器默认相对路径，桌面传绝对 URL（file:// 页面需要绝对）。 */
    baseUrl?: string;
    /** 这个弹窗开在哪一端：POST /chat 的 ?surface= 是必填的，宿主据此提前拒掉不可能的组合。 */
    surface: 'web' | 'desktop';
    x: number;
    y: number;
    /** 发送成功后调用（弹窗此时已关闭）：回复本身不从这里回传，数据只有 /state 一个出口。 */
    onSent?: () => void;
    onClose?: () => void;
    /** 弹窗允许占用的矩形（视口局部坐标）；缺省 = 整个视口。 */
    clamp?: {
        x: number;
        y: number;
        w: number;
        h: number;
    };
    /** 打开时就带着的图片（拖拽落到宠物身上走的这条）；缺省 = 空弹窗。 */
    initialImage?: File;
    /** 打开时就带着的已编码图片（截图快捷键走的这条：截屏没有 File，只有 base64）。 */
    initialEncoded?: EncodedImage;
    /** 截屏实现：浏览器传 getDisplayMedia 抓帧，桌面传 preload 的 IPC 调用；缺省 = 不支持。 */
    capture?: () => Promise<EncodedImage>;
    /**
     * 识别地址；缺省按 `baseUrl` 去掉尾部 `/chat` 推导（两端传进来的都是 `.../chat`）。
     * 给了也用不上时（环境不能录音）按钮不出现，见 createChatDom。
     */
    hearUrl?: string;
}
/** 挂载一个对话输入弹窗（两端共用；位置为视口坐标，超出 clamp 矩形自动夹回）。
 *  输入框 + 上传/截屏两枚图标按钮 + 图片预览（本轮只有界面与本地预览，编码与发送待接入）。
 *  回车即发送：发送成功后弹窗关闭并调 onSent。Esc 或点弹窗外关闭；生成失败留在弹窗内显式提示。
 *  clamp 由调用方给：桌面传「窗口 ∩ 工作区」，宠物贴边时弹窗照样完整显示、窗口零移动。 */
export declare function mountChatDialog(opts: ChatDialogOptions): ChatDialogMount;
