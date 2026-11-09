import type { FontConfig, ModelSelection, Pet, PhysicsParams } from '../../../shared/types.ts';
/** 校验失败时返回的文案键。 */
export type InvalidKey = 'invalid' | 'invalidPhysics' | 'invalidModel' | 'invalidChatMemory' | 'invalidChatImageLimit' | 'invalidFont';
/** 保存前要校验的全部表单值。 */
export interface FormValues {
    pets: readonly Pet[];
    physics: PhysicsParams;
    whisperModel: ModelSelection;
    chatModel: ModelSelection;
    chatMemory: number;
    chatImageLimit: number;
    font: FontConfig;
}
/** 一处「服务商 + 模型」是否合法：要么都留空（跟随当前对话），要么都非空。 */
export declare const modelPairValid: (model: ModelSelection) => boolean;
/**
 * 校验整张表单。
 *
 * @param values - 保存前要提交的全部值。
 * @returns 第一个不合格项的文案键；全部合格返回 `null`。
 */
export declare function validateForm(values: FormValues): InvalidKey | null;
