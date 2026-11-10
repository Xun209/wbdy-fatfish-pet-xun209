/**
 * 对话动作联动的纯逻辑：可表演的动作名单、注入提示词的指令、回复里动作标记的解析。
 *
 * 不做生成与落盘（归 ./chat 与 ./plugin/chat-memory），也不写 S；名单与 animations.categories 同源。
 * 与 ./anim 分开：那边回答「/anim 该不该播、播哪个」，这边只服务对话这一条触发路径。
 * @module dsh-pet/src/host/chat-action
 */
/**
 * 对话联动可用的动作：`animations.categories` 下全部动作（去重，保持配置顺序）。
 *
 * 与 animationNames 分开：待机 / 转向 / 拖拽 / 点击 / 移动 / 事件动画不参与对话联动。
 *
 * @param animations - 成品配置的 animations 段（形状非法 → 空名单）。
 * @returns 按配置顺序排列的动作名；没配 categories 时是空数组。
 */
export declare function chatActionNames(animations: unknown): string[];
/**
 * 动作指令：与配图指令并列附在 user 正文之后。
 *
 * 句式照配图那句写（省略主语、说「做」而不是「让宠物表演」）：模型自己就是宠物，旁白口吻它不会照做。
 *
 * @param names - 可表演的动作名（{@link chatActionNames} 的结果）；空名单由调用方直接跳过。
 */
export declare function actionInstruction(names: readonly string[]): string;
/**
 * 从模型回复里取动作（对话联动的解析半侧）。
 *
 * 所有动作标记都会被剥掉（无效名称也剥——标记不属于用户可见文本），只在命中白名单时采纳第一个。
 * 剥完没有正文时返回空串，由调用方决定不弹气泡。
 *
 * @param text - 模型回复原文。
 * @param names - 白名单（{@link chatActionNames}）；空名单 = 开关关闭，标记照剥但不采纳。
 * @returns 剥掉标记后的正文，以及命中白名单的第一个动作名。
 */
export declare function extractChatAction(text: string, names: readonly string[]): {
    text: string;
    action?: string;
};
