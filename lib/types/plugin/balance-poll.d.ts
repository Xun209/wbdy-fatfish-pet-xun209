import type { ChatMemory } from './chat-memory.ts';
import type { HostSetup } from './setup.ts';
import type { HostContext } from './context.ts';
/** 余额与周期的输入：装配期对象与更早的工厂。 */
export type BalancePollInput = {
    /** 宿主上下文（apply 收到的那一个）。 */
    ctx: HostContext;
} & Pick<HostSetup, 'configPaths'> & Pick<ChatMemory, 'getActivePetId'> & Pick<HostSetup, 'log'> & Pick<HostSetup, 'state'>;
/**
 * 创建余额与周期。
 */
export declare function createBalancePoll(deps: BalancePollInput): {
    effectivePetList: () => Record<string, unknown>[];
    balancePeriodSec: (cfg: Record<string, Record<string, unknown>>) => number;
    whisperPeriodSec: (conf: Record<string, unknown>) => number;
    refreshBalance: (manual?: boolean) => Promise<void>;
    resolveActivePetId: () => string;
    petDisplayName: (pet: Record<string, unknown>) => string;
};
/** 余额与周期的产出（供下游工厂按需 Pick）。 */
export type BalancePoll = ReturnType<typeof createBalancePoll>;
