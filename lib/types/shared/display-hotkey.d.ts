import type { HotkeyEvent } from './hotkey.ts';
import type { PetDisplay } from './types.ts';
/** 数字键对应的显示位置，下标从 1 起；改顺序等于改快捷键，必须同步菜单。 */
export declare const DISPLAY_ORDER: readonly ["web", "desktop", "both", "none"];
/** 菜单项右侧的键帽文案；下标与 {@link DISPLAY_ORDER} 对齐。 */
export declare const DISPLAY_HOTKEY_HINTS: readonly string[];
/**
 * 这次按键该切到哪个显示位置。
 *
 * @param e - 键盘事件。
 * @returns `1`-`4` 对应的显示位置；不是这四个裸键（或在输入框里打字）时 undefined。
 */
export declare function displayOfHotkey(e: HotkeyEvent): PetDisplay | undefined;
