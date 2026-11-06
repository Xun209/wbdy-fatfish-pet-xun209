import type { HotkeyEvent } from './hotkey.ts';
/** 快捷键的显示文案（菜单项右侧灰字）。与 {@link isSleepHotkey} 的按键保持同一份事实。 */
export declare const SLEEP_HOTKEY_HINT = "Z \u952E";
/**
 * 这次按键该不该切换睡觉状态。
 *
 * @param e - 键盘事件。
 * @returns 裸按 `Z`（含大写）时为 true，输入框里打字则为 false。
 */
export declare function isSleepHotkey(e: HotkeyEvent): boolean;
