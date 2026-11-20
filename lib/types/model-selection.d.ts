/** 一处「服务商 + 模型」选择（与 shared/types.ts 的 ModelSelection 同构） */
export interface ModelRef {
    provider: string;
    model: string;
}
/** 读条目配置里的 whisperModel / chatModel：
 *  两个字段都非空 → 该选择；都为空（内置默认）→ undefined（= 跟随当前对话）；
 *  结构不对 / 只填一半（合并器已挡下，这里再防御一次）→ undefined。 */
export declare function configuredModel(conf: Record<string, unknown> | undefined, key: 'whisperModel' | 'chatModel'): ModelRef | undefined;
/** 当前对话的模型（agentDefaultModel.currentSelection）；未配置 / 抛错 → undefined */
export declare function currentModel(ctx: {
    agentDefaultModel?: {
        currentSelection(): ModelRef;
    };
}): ModelRef | undefined;
/** 候选链：配置的模型优先，其次当前对话的模型；同一个选择只留一次。
 *  返回空数组 = 两个来源都拿不到（生成侧据此回「当前对话未配置模型」）。 */
export declare function modelCandidates(ctx: {
    agentDefaultModel?: {
        currentSelection(): ModelRef;
    };
}, preferred?: ModelRef): ModelRef[];
/** 报错/日志用的选择标签：provider/model */
export declare function modelLabel(m: ModelRef): string;
