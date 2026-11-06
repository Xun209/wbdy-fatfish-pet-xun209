/**
 * 浮动对话的三条应用级快捷键：开关弹窗、开关录音、截图。
 *
 * 都作用于「主配置第一只」宠物（见 card/registry），不看鼠标在哪——这正是「全局」的意思。
 * 弹窗那条是开关：同一个键再按一次必须关掉，不能只是把焦点塞回输入框。
 * 录音只能做成开关：DSH 快捷键只派发 keydown，没有抬手事件，做不了按住说话。
 * @module dsh-pet/src/client/pet/card/shortcut
 */
import { type ShortcutHost } from '../../app-shortcut.ts';
/** 打开浮动对话弹窗的命令 id。 */
export declare const PET_FLOAT_COMMAND_ID = "pet-chat.float";
/** 开关录音的命令 id。 */
export declare const PET_HEAR_COMMAND_ID = "pet-chat.hear";
/** 截图并塞进对话的命令 id。 */
export declare const PET_CAPTURE_COMMAND_ID = "pet-chat.capture";
/** 设置页要列出的三条命令。 */
export type PetShortcutKey = 'chat' | 'hear' | 'capture';
/**
 * 设置页显示的键帽：跟着用户改绑走。
 *
 * @param ctx - 客户端上下文。
 * @param key - 要显示哪一条。
 * @returns 键帽文案；还没登记、或宿主没有快捷键服务时退回默认组合。
 */
export declare function petShortcutKeycap(ctx: ShortcutHost, key: PetShortcutKey): string;
/** 取标题的键；调用方传 `t` 的薄封装即可。 */
export type ShortcutLabel = (key: 'shortcut.capture' | 'shortcut.chat' | 'shortcut.hear') => string;
/**
 * 注册浮动对话的两条快捷键。
 *
 * @param ctx - 客户端上下文（只用到软取）。
 * @param label - 取标题；惰性求值，切语言后重算。
 * @returns 注销函数：两条一起摘。
 */
export declare function registerPetCardShortcuts(ctx: ShortcutHost, label: ShortcutLabel): {
    dispose: () => void;
};
