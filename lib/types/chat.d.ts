/**
 * 对话生成（host 半侧）：用 DSH 的 LLM 统一抽象层（ctx.llm）生成一句回复。
 *
 * 负责把历史记忆、用户输入与人设拼成一次生成请求，并解析可选的配图标记。
 * 不负责记忆读写与落盘，也不负责写气泡——那些在路由层与两端消费侧。
 * 依赖 ctx.llm、agentDefaultModel（与碎碎念同源）与调用方给的表情包池。
 * 始终成立：候选模型失败要显式回落并留痕；生成失败返回结构化原因，不伪造文案。
 * 契约见 API.md 与 openapi.yaml。
 *
 * @module dsh-pet/src/host/chat
 */
import type { PetImageRef } from './image-attachment.ts';
import { type MemeEntry } from './memes.ts';
import { type ModelRef } from './model-selection.ts';
/** 生成失败原因（与 shared/whisper.ts 的 WhisperState 失败分支同构）。 */
export type ChatGenerateResult = {
    ok: true;
    text: string;
    image?: string;
    action?: string;
} | {
    ok: false;
    reason: 'provider-missing' | 'generate-error';
    message?: string;
};
/** 记忆中的一条消息：GET /chat 返回的窗口条目就是它。 */
export interface ChatMemoryMessage {
    role: 'user' | 'assistant';
    content: string;
    ts: number;
    /** 该轮用户上传的图片（附件引用，不含图片本体）；只存不送——历史回放不带图。 */
    image?: PetImageRef;
    /** 该轮 AI 配的表情包名称（不是条目对象）；只存不送——不进上下文。 */
    meme?: string;
    /** 该轮 AI 表演的动作名（animations.categories 内的名字）；只存不送——不进上下文。 */
    action?: string;
}
/** 动作指令与动作标记的解析都在 ./chat-action：它们只服务对话这条路径，与 /anim 的决策层分开。 */
/** 一次对话生成的输入。 */
export interface ChatGenerateInput {
    /** 宿主上下文（注入 agentDefaultModel / llm）。 */
    readonly ctx: {
        agentDefaultModel: {
            currentSelection(): {
                provider: string;
                model: string;
            };
        };
        llm?: unknown;
    };
    /** 人设提示词（whisperPrompt，与碎碎念共用同一人设）。 */
    readonly system: string;
    /** 最近记忆（按时间正序，user / assistant 交替）。 */
    readonly history: readonly ChatMemoryMessage[];
    /** 用户刚输入的话；图片不带任何文字描述，语境全靠它。 */
    readonly userText: string;
    /** 表情包候选池；空 / 缺省 = 纯文本（指令与解析都不介入）。 */
    readonly pool?: readonly MemeEntry[];
    /** 可表演的动作名单（对话联动开关开启时传，来自 animations.categories）；空 / 缺省 = 不注入也不解析。 */
    readonly actions?: readonly string[];
    /** 条目单独指定的模型（chatModel）；缺省 / 留空 = 只用当前对话的模型。 */
    readonly preferred?: ModelRef;
    /** 本轮附带的图片；缺省 = 纯文本请求，数据路径与加入图片前一致。 */
    readonly image?: PetImageRef;
}
/**
 * 生成一句对话回复。
 *
 * @param input - 上下文、人设、历史、用户输入，以及可选的配图池 / 指定模型 / 图片。
 * @returns 回复文本（+ 命中池内的配图名），或结构化失败（provider 缺失 / 生成错误）。
 */
export declare function generateChat(input: ChatGenerateInput): Promise<ChatGenerateResult>;
