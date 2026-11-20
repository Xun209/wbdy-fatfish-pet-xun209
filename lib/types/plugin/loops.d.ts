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
/**
 * 这只宠物这一刻该不该说梦话。
 *
 * 两道判定与碎碎念同口径：宠物自己关掉碎碎念就不再有任何后台生成；配置上不显示的
 * 宠物也不生成——用户选「都不显示」就是不用了，后台继续调模型纯属白烧额度（#237）。
 *
 * @param pet - 成品配置拍平后的宠物条目。
 * @returns 两道判定都通过时为 true。
 * @internal
 */
export declare function shouldSleepTalk(pet: Record<string, unknown>): boolean;
