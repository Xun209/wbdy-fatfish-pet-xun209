/**
 * 斜杠命令 /chat：把一句话转给宠物并回帖。
 * @module dsh-pet/src/host/plugin/command-chat
 */
import type { ChatMemory } from './chat-memory.ts';
import type { BalancePoll } from './balance-poll.ts';
import type { PetLookup } from './pet-lookup.ts';
import type { HostSetup } from './setup.ts';
import type { HostContext } from './context.ts';
/** 对话命令的输入。 */
export type CommandChatInput = {
    /** 宿主上下文（apply 收到的那一个）。 */
    ctx: HostContext;
} & Pick<ChatMemory, 'chatWithPet'> & Pick<HostSetup, 'log'> & Pick<ChatMemory, 'publishWhisper'> & Pick<PetLookup, 'sleep'> & Pick<PetLookup, 'sleepRefusalText'> & Pick<BalancePoll, 'resolveActivePetId'>;
/** 注册对话命令；返回的清理函数由 ctx.effect 收集。 */
export declare function registerChatCommand(deps: CommandChatInput): void;
