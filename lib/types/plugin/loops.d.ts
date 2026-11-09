import type { BalancePoll } from './balance-poll.ts';
import type { ChatMemory } from './chat-memory.ts';
import type { PetLookup } from './pet-lookup.ts';
import type { HostSetup } from './setup.ts';
import type { HostContext } from './context.ts';
/** 轮询循环的输入。 */
export type LoopsInput = {
    /** 宿主上下文（apply 收到的那一个）。 */
    ctx: HostContext;
} & Pick<BalancePoll, 'balancePeriodSec'> & Pick<HostSetup, 'configPaths'> & Pick<ChatMemory, 'lastWhisperAt'> & Pick<PetLookup, 'lock'> & Pick<PetLookup, 'sleep'> & Pick<HostSetup, 'log'> & Pick<ChatMemory, 'publishWhisper'> & Pick<ChatMemory, 'publishSleepTalk'> & Pick<BalancePoll, 'refreshBalance'> & Pick<HostSetup, 'standaloneAiPolicy'> & Pick<BalancePoll, 'whisperPeriodSec'>;
/** 注册轮询循环；返回的清理函数由 ctx.effect 收集。 */
export declare function registerLoops(deps: LoopsInput): void;
