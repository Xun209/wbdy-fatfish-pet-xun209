/**
 * 当前 provider/model 是否声明支持 reasoning effort（含 "off"）。
 * 能力缺失或查询失败一律保守返回 false（= 不传，等价于模型默认行为，避免请求失败）。
 */
export declare function supportsReasoningOff(ctx: {
    llm?: unknown;
}, provider: string, model: string): Promise<boolean>;
