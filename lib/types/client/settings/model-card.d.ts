/**
 * 「AI 模型与对话上下文」卡：碎碎念 / 对话各自的模型（条目级），对话历史条数与配图张数上限（全局默认），
 * 以及三个与对话相关的开关（碎碎念配图 / 对话配图 / 对话动作联动）。
 * 都与全局开关同语义：只改本地状态，随「保存」整包写入；宿主生成时优先用模型，失败自动回落。
 * 候选清单拉取失败只在这里提示一行，不阻塞已有配置值的显示与保存。
 * @module dsh-pet/src/client/settings/model-card
 */
import type { FunctionComponent } from 'react';
import type { ModelSelection } from '../../shared/types.ts';
import type { ModelCatalogGroup } from './picker/index.ts';
import type { ModelPickerProps } from './picker/index.ts';
import type { SettingsRuntime } from './runtime.ts';
/** 两个模型字段的键名。 */
export type ModelFieldKey = 'whisperModel' | 'chatModel';
/** 三个对话开关的键名，与成品配置的字段名一致。 */
export type ChatFlagKey = 'whisperImageEnabled' | 'chatImageEnabled' | 'chatAnimationEnabled';
/** 三个对话开关的当前值。 */
export type ChatFlagValues = Record<ChatFlagKey, boolean>;
/** 模型卡的输入。 */
export interface ModelCardProps {
    /** 保存中或配置未就绪时禁用全部控件。 */
    busy: boolean;
    /** 候选清单；`null` 表示还在拉取。 */
    catalog: readonly ModelCatalogGroup[] | null;
    /** 候选清单拉取失败。 */
    failed: boolean;
    /** 碎碎念用的模型。 */
    whisperModel: ModelSelection;
    /** 对话用的模型。 */
    chatModel: ModelSelection;
    /** 某个模型字段被改。 */
    onModelChange: (key: ModelFieldKey, value: ModelSelection) => void;
    /** 对话历史条数。 */
    chatMemory: number;
    /** 对话配图张数上限。 */
    chatImageLimit: number;
    /** 改对话历史条数。 */
    onChatMemoryChange: (value: number) => void;
    /** 改对话配图张数上限。 */
    onChatImageLimitChange: (value: number) => void;
    /** 三个对话开关的当前值。 */
    values: ChatFlagValues;
    /** 某个对话开关被切换。 */
    onFlagChange: (key: ChatFlagKey, value: boolean) => void;
}
/**
 * 造模型卡。
 *
 * @param rt - 注入的 react 能力与翻译函数。
 * @param picker - 模型选择器组件（由外壳用同一份运行时造好，跨渲染稳定）。
 * @returns 卡片组件。
 */
export declare function makeModelCard(rt: SettingsRuntime, picker: FunctionComponent<ModelPickerProps>): FunctionComponent<ModelCardProps>;
