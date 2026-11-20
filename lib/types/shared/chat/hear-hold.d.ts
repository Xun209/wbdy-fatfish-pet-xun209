import type { HotkeyEvent } from '../hotkey.ts';
/** 快捷键的显示文案（设置页用）。与 {@link isHearHotkey} 的按键保持同一份事实。 */
export declare const HEAR_HOTKEY_HINT = "M \u952E";
/**
 * 这次按下该不该被「按住说话」接走：与其他悬停键共用同一条判据。
 *
 * @param e - 键盘事件。
 * @returns 裸按 `M`（含大写）、且焦点不在可编辑元素上时为 true。
 */
export declare function isHearHotkey(e: HotkeyEvent): boolean;
/** 状态机的前置判据与两个动作。 */
export interface HearHoldHooks {
    /**
     * 现在该不该响应按下：鼠标停在这只宠物身上，或焦点在宠物自己的弹窗里。
     *
     * 后一条留的是「焦点在麦克风按钮这类非可编辑元素上」这条路；在输入框里打字由
     * {@link isHearHotkey} 挡在前面。
     */
    isArmed: () => boolean;
    /** 按下：打开对话弹窗并开始录音。 */
    onPress: () => void;
    /** 松开：结束录音，等识别结果。 */
    onRelease: () => void;
}
/** 按住状态机：两端各持一个，键盘事件原样转进来。 */
export interface HearHold {
    /** 处理 keydown；返回 true 表示这次事件已被吃掉，调用方必须 `preventDefault`。 */
    onKeyDown: (e: HotkeyEvent & {
        readonly repeat?: boolean;
    }) => boolean;
    /** 处理 keyup；只认开录那个键的松开，其余不管。 */
    onKeyUp: (e: Pick<HotkeyEvent, 'key'>) => void;
    /** 强制收尾（窗口失焦、宠物卸载这类收不到 keyup 的场合）；没按着时什么都不做。 */
    release: () => void;
}
/**
 * 造一个按住状态机。
 *
 * @param hooks - 前置判据与按下/松开动作。
 * @returns 供调用方接线的三个处理器。
 */
export declare function createHearHold(hooks: HearHoldHooks): HearHold;
