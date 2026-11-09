/**
 * 语音卡：播报总开关、两个细分开关与音色选择。
 *
 * 切换只改本地状态、随「保存」整包写入——即时写盘会重启桌面 Helper、重建全部桌面宠物窗口。
 * 音色选择器由外壳注入（与模型卡注入 picker 同构），卡片本身不硬编码任何音色 id。
 * @module dsh-pet/src/client/settings/voice-card
 */
import type { FunctionComponent } from 'react';
import type { VoiceOption, VoicePickerProps } from './picker/voice-picker.ts';
import type { SettingsRuntime } from './runtime.ts';
export type { VoiceOption } from './picker/voice-picker.ts';
/** 语音卡的输入。 */
export interface VoiceCardProps {
    /** 保存中或配置未就绪时禁用全部控件。 */
    readonly busy: boolean;
    /** 播报总开关的当前值。 */
    readonly enabled: boolean;
    /** 当前音色 id。 */
    readonly voiceName: string;
    /** 播放音量系数：0–1 的小数，1 = 最大音量。 */
    readonly volume: number;
    /** 可选音色；为空时选择器只显示当前值（列表还没拉回来或拉取失败）。 */
    readonly voices: readonly VoiceOption[];
    /** 周期碎碎念要不要念出来（受总开关约束）。 */
    readonly whisperEnabled: boolean;
    /** 待办提醒要不要念出来（受总开关约束）。 */
    readonly todoEnabled: boolean;
    /** 切换播报开关。 */
    readonly onToggle: (value: boolean) => void;
    /** 选择音色。 */
    readonly onVoiceChange: (voiceName: string) => void;
    /** 调整播放音量。 */
    readonly onVolumeChange: (volume: number) => void;
    /** 切换周期碎碎念的播报。 */
    readonly onWhisperToggle: (value: boolean) => void;
    /** 切换待办提醒的播报。 */
    readonly onTodoToggle: (value: boolean) => void;
}
/**
 * 造语音卡。
 *
 * @param rt - 注入的 react 能力与翻译函数。
 * @param picker - 音色选择器组件；与模型卡一样由装配根造一次后注入，保证组件类型跨渲染稳定。
 * @returns 卡片组件。
 */
export declare function makeVoiceCard(rt: SettingsRuntime, picker: FunctionComponent<VoicePickerProps>): FunctionComponent<VoiceCardProps>;
