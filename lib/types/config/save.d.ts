import type { ConfigPaths } from './constants.ts';
/**
 * 保存用户层（PUT /config）：接受 pets + 全局开关 + physics / font / 两个模型 / 对话参数。
 * 非白名单顶层字段（whisperPrompt、eventsRefreshSec、memes 等）从 existing 原样透传保留——
 * 用户手动编辑的精调配置不会被设置页保存抹掉；白名单字段也只在请求体真的传了时才算白名单。
 * 非法 → 返回 null，由路由回 200 + 失败实体。与读取分离：文件宠物永不回写。
 */
export declare function saveUserConfig(raw: unknown, existing?: Record<string, unknown>): {
    pets: unknown[];
    [key: string]: unknown;
} | null;
/**
 * 同步用户层（POST /config，设置页「同步」）：把内置默认配置原文写入用户主配置文件。
 * 复制原文而不是删除用户层：既等价于恢复默认（合并结果 = 内置默认），又让用户拿到一份含全部
 * 注释、开箱可编辑的完整配置。读取侧统一走 stripJsonc，带注释写入照样能读。
 * 注意：文件一旦生成即成为显式覆盖层，插件升级改了内置默认后，文件里的旧值仍会继续生效。
 * 默认文件缺失 / 目录不可写 → 直接抛，由路由回 200 + 失败实体（`generate-error`），绝不静默留下半个配置文件。
 */
export declare function syncUserConfigFromDefault(paths: ConfigPaths): void;
/**
 * 对话记忆截取：取尾部 rounds 轮（1 轮 = 1 问 1 答 → 2 条）。
 * 不能写 messages.slice(-rounds * 2)：rounds = 0 时 -0 === 0，slice(-0) 返回整个数组，
 * 「关掉历史」反而变成「带全部历史」。这里显式分支：0 → 空列表，> 0 → 截尾部。
 */
export declare function sliceMemoryRounds<T>(messages: T[], rounds: number): T[];
/**
 * 对话记忆按轮删除：`ts` 落在集合里的消息整轮移除（一轮两条共享同一个 `ts`，所以天然成对）。
 *
 * 不用「空集合 = 全删」表达清空：那会让调用方在漏传参数时静默抹掉全部历史。清空是调用方
 * 的另一条显式分支（传空数组 = 一条都不删）。
 *
 * @param messages - 记忆数组。
 * @param ts - 要删除的轮时间戳集合。
 * @returns 保留下来的消息，以及被移除的条数。
 */
export declare function removeRoundsByTs<T extends {
    ts: number;
}>(messages: readonly T[], ts: readonly number[]): {
    messages: T[];
    removed: number;
};
