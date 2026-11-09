/**
 * 斜杠命令 /balance：刷新余额并把结果回给命令面板。
 * @module dsh-pet/src/host/plugin/command-balance
 */
import type { BalancePoll } from './balance-poll.ts';
import type { PetLookup } from './pet-lookup.ts';
import type { HostContext } from './context.ts';
/** 余额命令的输入。 */
export type CommandBalanceInput = {
    /** 宿主上下文（apply 收到的那一个）。 */
    ctx: HostContext;
} & Pick<BalancePoll, 'refreshBalance'> & Pick<BalancePoll, 'effectivePetList'> & Pick<PetLookup, 'sleep'> & Pick<PetLookup, 'sleepRefusalText'>;
/** 注册余额命令；返回的清理函数由 ctx.effect 收集。 */
export declare function registerBalanceCommand(deps: CommandBalanceInput): void;
