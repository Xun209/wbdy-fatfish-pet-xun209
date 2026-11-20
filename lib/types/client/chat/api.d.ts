/**
 * 桌宠对话窗口的数据访问：宠物清单、历史窗口、发一句话、删轮。
 *
 * 只做 HTTP 与响应整形，不碰 DOM、不持状态；失败抛错或回判别联合，
 * 由调用方决定怎么展示——不把异常静默兜底成空列表。
 * @module dsh-pet/src/client/chat/api
 */
import { type ChatAttachment } from '../../shared/chat/send.ts';
import type { Pet } from '../../shared/types.ts';
/** 消息里带的图片引用（与宿主 `PetImageRef` 同形，只取显示用到的字段）。 */
export interface ChatImageRef {
    readonly attachmentId: string;
    readonly mediaType: string;
    readonly bytes: number;
    readonly width: number;
    readonly height: number;
}
/** 历史里的一条消息（窗口只显示这几项）。 */
export interface ChatMessageView {
    readonly role: 'user' | 'assistant';
    readonly text: string;
    readonly ts: number;
    /** 该轮用户上传的图（`/attachment` 取回）；缺省 = 纯文字。 */
    readonly image?: ChatImageRef;
    /** 该轮 AI 配的表情包名（`/pic/memes` 取回）；缺省 = 没配图。 */
    readonly meme?: string;
    /** 该轮 AI 表演的动作名（重播按钮的入参）；缺省 = 没演动作。 */
    readonly action?: string;
}
/** 一轮对话：一问一答共享同一个 ts，缺一侧（例如删过）也只占一轮。 */
export interface ChatRound {
    readonly ts: number;
    readonly user?: ChatMessageView;
    readonly assistant?: ChatMessageView;
}
/** 删除回执。 */
export type DeleteResult = {
    ok: true;
    removed: number;
} | {
    ok: false;
    message: string;
};
/**
 * `GET /chat` 的响应体 → 消息列表。
 *
 * @param body - 响应 JSON（未校验）。
 * @returns 角色与正文都合法的消息；坏条目直接丢弃，一条坏数据不该让整段历史报错。
 */
export declare function toChatMessages(body: unknown): ChatMessageView[];
/**
 * 按轮分组：同一 `ts` 的问与答合成一轮——显示按轮、删除也按轮。
 *
 * `ts` 为 0（历史里没有时间戳）时每条各自成轮：否则所有无时间戳的消息会被并进一轮。
 *
 * @param messages - 按时间正序的消息。
 * @returns 按出现顺序排列的轮。
 */
export declare function groupRounds(messages: readonly ChatMessageView[]): ChatRound[];
/** 插件 logo 地址与按宠物的头像地址：拼装规则在 shared/avatar.ts，面板只做再导出。 */
export { avatarUrl, LOGO_URL } from '../../shared/avatar.ts';
/**
 * 让宠物重演一次记忆里记下的动作（聊天窗口「播放动作」按钮）。
 *
 * 走 `/anim` 而不是直接改 state：白名单校验、占用锁与显示端门禁、播放回执都由宿主那一条链路负责。
 *
 * @param petId - 宠物 id。
 * @param name - 记忆里记下的动作名（来自 `animations.categories`）。
 * @returns 是否受理成功；失败只留日志，不弹错误条——它只是重播，不影响对话主流程。
 */
export declare function playAction(petId: string, name: string): Promise<boolean>;
/** 附件引用 → 取图地址（宿主按内容哈希回字节）。 */
export declare function attachmentUrl(ref: ChatImageRef): string;
/**
 * 表情包名 → 图片地址。
 *
 * @param name - 记忆里记下的名称。
 * @param assetRoot - 宠物所属条目（素材根）；空串时退回两段形式（取不到 pet 包独占的图）。
 */
export declare function memeUrl(name: string, assetRoot: string): string;
/** 面板需要的配置：宠物列表 + 每个条目保留的对话轮数 + 每只宠物的人设正文。 */
export interface ChatConfig {
    readonly pets: Pet[];
    /** 条目（素材根）→ 该条目配置的 `chatMemoryRounds`；缺失的条目不出现在表里。 */
    readonly roundsByEntry: Readonly<Record<string, number>>;
    /** 宠物 id → 实际在用的人设正文；取值口径见 {@link personaText}。 */
    readonly personaByPet: Readonly<Record<string, string>>;
}
/**
 * 一只宠物实际在用的人设正文。
 *
 * 两级：实例级非空白优先（**替换**所属条目那份，不是拼接），否则用条目顶层那份
 * ——main 条目的条目顶层就是内置默认那句，所以正常配置下不会是空串。
 *
 * @param own - `pets[].whisperPrompt`；缺省或纯空白视为没写。
 * @param entry - 所属条目顶层 `whisperPrompt`；非字符串按没写处理。
 * @returns 实例级原文（保留排版，不 trim）或条目那份；两处都没有时是空串。
 */
export declare function personaText(own: unknown, entry: unknown): string;
/**
 * 拉成品配置：拍平宠物列表，同时把每个条目的对话记忆轮数与每只宠物的人设带出来。
 *
 * 设置页读的是同一份 `/config`（`merged.main.chatMemoryRounds`），这里按条目取，
 * 面板才能知道「最近几轮才算桌宠的记忆」——不额外发请求，也不在客户端抄一份默认值。
 *
 * @returns 宠物列表、条目轮数表与宠物人设表。
 * @throws 配置请求失败或响应不是成品聚合时。
 */
export declare function fetchChatConfig(): Promise<ChatConfig>;
/**
 * 记忆边界：最后 `memoryRounds` 轮才算桌宠记得的内容，线要画在它们之前。
 *
 * @param totalRounds - 当前展示的轮数。
 * @param memoryRounds - 该条目配置的保留轮数；`undefined` 表示配置里没有这个值。
 * @returns 分界下标（线插在该下标之前）；全部都在记忆里、或没有记忆时返回 `null`（不画线）。
 */
export declare function memoryBoundaryIndex(totalRounds: number, memoryRounds: number | undefined): number | null;
/** 分界线节点的定位标记：工具栏的「记忆线」按它找元素，不依赖 class 名。 */
export declare const MEMORY_LINE_ATTR = "data-pet-chat-memory";
/**
 * 让记忆分界线进入可视窗口所需的最少展示轮数。
 *
 * 线插在倒数第 `memoryRounds` 轮之前，窗口里至少要有它上面那一轮，线才画得出来。
 *
 * @param memoryRounds - 该条目保留的轮数。
 * @returns 需要的展示轮数；`memoryRounds` 非法（`<= 0`）时返回 0（没有线，无需放轮）。
 */
export declare function roundsToRevealMemory(memoryRounds: number): number;
/** 一次取满接口允许的轮数（宿主上限 200）：面板在本地按需展示，不做分页取数。 */
export declare const HISTORY_ROUNDS = 200;
/**
 * 读某只宠物的对话历史。
 *
 * 一次请求取满 200 轮，展示层自己控制「先显示多少」；不传 `rounds` 只会拿到配置的默认轮数。
 *
 * @param petId - 宠物 id。
 * @returns 按时间正序的消息；没有历史时是空列表。
 * @throws 请求失败时。
 */
export declare function fetchHistory(petId: string): Promise<ChatMessageView[]>;
/**
 * 发一句给某只宠物。
 *
 * @param petId - 宠物 id。
 * @param text - 用户输入（宿主 trim 并校验 2000 字上限）。
 * @param attachment - 可选的一张图（已压缩的规范 base64）。
 * @returns 成功回执，或可直接展示的失败文案。
 * @throws 网络中断或响应不是 JSON 时。
 */
export declare function sendMessage(petId: string, text: string, attachment?: ChatAttachment): Promise<{
    ok: true;
} | {
    ok: false;
    message: string;
}>;
/**
 * 删除若干轮（按 `ts`，一问一答一起走）。
 *
 * @param petId - 宠物 id。
 * @param ts - 要删除的轮；空数组表示没有选中。
 * @returns 实际删除的条数，或失败文案。
 * @throws 网络中断时。
 */
export declare function deleteRounds(petId: string, ts: readonly number[]): Promise<DeleteResult>;
/**
 * 清空某只宠物的全部历史。
 *
 * @param petId - 宠物 id。
 * @returns 实际删除的条数，或失败文案。
 * @throws 网络中断时。
 */
export declare function clearHistory(petId: string): Promise<DeleteResult>;
/** 已删宠物残留的一段历史（只给条数与最后时间，不含正文）。 */
export interface OrphanHistory {
    readonly entry: string;
    readonly petId: string;
    readonly messages: number;
    readonly lastTs: number;
}
/**
 * 读出已删宠物的残留历史。
 *
 * 这些宠物已不在配置里，`GET /chat` 一律 `unknown-pet`——不靠这个接口就既看不到也清不掉。
 *
 * @returns 每个残留分桶一条；没有残留时是空列表。
 * @throws 请求失败时。
 */
export declare function fetchOrphans(): Promise<OrphanHistory[]>;
/**
 * 清掉所有已删宠物的历史。
 *
 * @returns 删掉的宠物数与消息条数，或失败文案。
 * @throws 网络中断时。
 */
export declare function clearOrphans(): Promise<{
    ok: true;
    pets: number;
    messages: number;
} | {
    ok: false;
    message: string;
}>;
