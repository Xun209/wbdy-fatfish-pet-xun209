/** 提示行的三种用法：常驻显示、收起、显示后自动收起。 */
export interface HearHint {
    /** 常驻显示，直到 hide。 */
    show: (text: string) => void;
    hide: () => void;
    /** 显示并在一小段时间后自动收起。 */
    flash: (text: string) => void;
}
/** 控件需要的元素与回调。 */
export interface HearControlOptions {
    /** 话筒按钮：状态画在它的 `data-hear` 上，pointer 事件也由本模块绑定。 */
    readonly micBtn: HTMLButtonElement;
    /** 识别结果的落点：文字插在光标处。 */
    readonly input: HTMLTextAreaElement;
    /** 进度与失败提示都走这一行。 */
    readonly hint: HearHint;
    /** 插入文字后重算输入框尺寸。 */
    readonly resizeInput: () => void;
    /** 识别地址；空串表示这个入口没接识别。 */
    readonly hearUrl: string;
}
/** 控件对外只暴露四个动作。 */
export interface HearControl {
    /** 开录；录不了时给一句原因，已在录时什么都不做。 */
    start: () => void;
    /** 收尾；没在录时什么都不做。 */
    stop: () => void;
    /** 此刻是否真的在采集：快捷键要按它决定这一下是开还是关。 */
    isHearing: () => boolean;
    /** 停掉正在进行的录音并清计时器；关闭弹窗时调用。 */
    dispose: () => void;
}
/**
 * 造一个按住说话控件。
 *
 * @param opts - 话筒按钮、输入框、提示行、尺寸重算与识别地址。
 * @returns 开始、收尾与释放三个动作。
 */
export declare function createHearControl(opts: HearControlOptions): HearControl;
