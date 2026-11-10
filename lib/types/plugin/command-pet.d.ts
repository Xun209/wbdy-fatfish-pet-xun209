/**
 * 斜杠命令 /pet：按 id 或名字切换当前桌宠。
 * @module dsh-pet/src/host/plugin/command-pet
 */
import type { BalancePoll } from './balance-poll.ts';
import type { ChatMemory } from './chat-memory.ts';
import type { HostContext } from './context.ts';
/** 桌宠选择命令的输入。 */
export type CommandPetInput = {
    /** 宿主上下文（apply 收到的那一个）。 */
    ctx: HostContext;
} & Pick<BalancePoll, 'effectivePetList'> & Pick<BalancePoll, 'petDisplayName'> & Pick<BalancePoll, 'resolveActivePetId'> & Pick<ChatMemory, 'setActivePetId'>;
/** 注册桌宠选择命令；返回的清理函数由 ctx.effect 收集。 */
export declare function registerPetCommand(deps: CommandPetInput): void;
