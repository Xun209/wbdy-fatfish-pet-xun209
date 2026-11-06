import type { TodoStore } from '../todo/store.ts';
import type { LockStore } from '../lock.ts';
import type { PollStateStore } from '../state.ts';
import type { HostSetup } from './setup.ts';
import type { PetLookup } from './pet-lookup.ts';
import type { HostContext } from './context.ts';
/** 一拍所需的最小能力（与完整输入同形，便于测试替身）。 */
export interface TodoReminderTickDeps {
    /** 待办存储：读清单、记提醒时刻。 */
    todos: Pick<TodoStore, 'list' | 'markReminded'>;
    /** 当前生效的宠物列表（成品配置拍平）。 */
    effectivePetList: () => Record<string, unknown>[];
    /** 占用锁：被第三方占用的宠物这一拍不打扰。 */
    lock: Pick<LockStore, 'locked'>;
    /** 睡着的宠物不打扰：提醒是「跟它说话」，睡着时说了它也听不见，换一只醒着的。
     *  缺省视为都不睡（老调用方与测试替身不必改）。 */
    isSleeping?: (petId: string) => boolean;
    /** 轮询状态：提醒写进 `pets.<id>.say`。 */
    state: Pick<PollStateStore, 'writePet'>;
    /** 日志出口。 */
    log: Pick<HostSetup['log'], 'info' | 'warn'>;
    /** 时间源；测试注入固定时钟。 */
    now?: () => number;
    /** 是否有端在线（长轮询在挂）。没有就不提醒：写进 S 也没人看见，还白白推进了排期。 */
    hasListener?: () => boolean;
    /** 待办播报开关（成品配置的 `main.voiceTodoEnabled`）：关着就不写 `voiceTo`，只弹气泡。 */
    isVoiceTodoEnabled: () => boolean;
}
/** 提醒循环的输入。 */
export type TodoReminderInput = {
    /** 宿主上下文（apply 收到的那一个）。 */
    ctx: HostContext;
    /** 当前挂着长轮询的端数量：>0 表示有人能看到这次提醒。 */
    waiterCount: () => number;
} & Pick<PetLookup, 'lock'> & Pick<PetLookup, 'sleep'> & Pick<TodoReminderTickDeps, 'todos' | 'effectivePetList' | 'state' | 'log' | 'isVoiceTodoEnabled'>;
/**
 * 挑一个承担这次提醒的宠物：优先网页端可见的，其次桌面端；被第三方占用的跳过。
 *
 * @param pets - 成品配置拍平后的宠物列表。
 * @param isLocked - 该宠物是否正被占用。
 * @returns 宠物 id；没有可用的返回 null。
 * @internal
 */
export declare function pickReminderSpeaker(pets: readonly Record<string, unknown>[], isLocked: (petId: string) => boolean, isSleeping?: (petId: string) => boolean): string | null;
/**
 * 跑一拍：最多提醒一条，成功后记下提醒时刻。
 *
 * @param deps - 存储、宠物列表、锁与状态写入。
 * @returns 无返回值；没有到点或没有可开口的宠物时静默返回。
 */
export declare function tickTodoReminders(deps: TodoReminderTickDeps): Promise<void>;
/**
 * 注册提醒循环；返回的清理函数由 ctx.effect 收集。
 *
 * @param deps - 宿主上下文与一拍所需的能力。
 */
export declare function registerTodoReminders(deps: TodoReminderInput): void;
