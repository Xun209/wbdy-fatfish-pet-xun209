/**
 * 对话弹窗的 DOM 装配：输入框、上传/截屏/按住说话三枚按钮、待发送图片缩略图、提示行与错误行。
 * 只建元素并把能力接上，不发送、不定位、不管关闭；录音的状态机在 chat/hear-control。
 * @module dsh-pet/src/shared/chat/dom
 */
import { type EncodedImage } from './encode.ts';
import type { ChatAttachment } from './send.ts';
/** 弹窗用到的元素与行为；挂载函数只按需接线，不重新造 DOM。 */
export interface ChatDom {
    readonly root: HTMLDivElement;
    readonly input: HTMLTextAreaElement;
    readonly err: HTMLDivElement;
    readonly shotBtn: HTMLButtonElement;
    /** 输入框与根宽度随文本自适应；挂到文档后调用一次，输入时自动重算。 */
    readonly resizeInput: () => void;
    /** 清掉待发送图片（含 file input 的值）。 */
    readonly clearAttach: () => void;
    /** 放进一张待发送图片（上传、拖拽、粘贴共用）；类型不接受或编码失败时提示并返回 false。 */
    readonly setImageFile: (file: File) => Promise<boolean>;
    /** 放进一张已编码好的图（截屏走这条：没有 File，只有 base64）。 */
    readonly setEncoded: (encoded: EncodedImage) => boolean;
    /** 当前待发送的图片；没有时 undefined。 */
    readonly getAttachment: () => ChatAttachment | undefined;
    /** 是否正在编码：发送前要等它结束，否则这条消息会漏掉图片。 */
    readonly isEncoding: () => boolean;
    /** 临时提示（不是错误），超时自动收起。 */
    readonly flash: (text: string) => void;
    /** 从外部开录（快捷键「按住说话」用）；录不了时给一句原因，已在录时什么都不做。 */
    readonly startHear: () => void;
    /** 从外部收尾（快捷键松手用）；没在录时什么都不做。 */
    readonly stopHear: () => void;
    /** 此刻是否真的在采集；全局快捷键据此把「开/关」合成一个动作。 */
    readonly isHearing: () => boolean;
    /** 收起提示、停掉正在进行的录音并清计时器；关闭弹窗时调用。 */
    readonly dispose: () => void;
}
/**
 * 建好弹窗的全部元素并挂到 `document.body` 下。
 *
 * @param opts - 可选的截屏实现（不传时按钮只给"当前环境不支持"的提示）与识别地址
 *   （录不了时按住说话的按钮照样在，点它给一句原因）。
 * @returns 元素引用与行为（清理附件、临时提示、自适应、释放计时器）。
 */
export declare function createChatDom(opts?: {
    capture?: () => Promise<EncodedImage>;
    hearUrl?: string;
}): ChatDom;
