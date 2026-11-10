import type { HotkeyEvent } from '../hotkey.ts';
export { isTypingTarget } from '../hotkey.ts';
export type { HotkeyEvent } from '../hotkey.ts';
/** 快捷键的显示文案（菜单项右侧灰字）。与 {@link isChatHotkey} 的按键保持同一份事实。 */
export declare const CHAT_HOTKEY_HINT = "L \u952E";
/** 截图的显示文案；没有菜单项，只给设置页那张卡用。 */
export declare const CAPTURE_HOTKEY_HINT = "S \u952E";
/**
 * 这次按键该不该打开对话。
 *
 * @param e - 键盘事件。
 * @returns 裸按 `L`（含大写）时为 true，输入框里打字则为 false。
 */
export declare function isChatHotkey(e: HotkeyEvent): boolean;
/**
 * 这次按键该不该截图。
 *
 * @param e - 键盘事件。
 * @returns 裸按 `S`（含大写）时为 true，输入框里打字则为 false。
 */
export declare function isCaptureHotkey(e: HotkeyEvent): boolean;
