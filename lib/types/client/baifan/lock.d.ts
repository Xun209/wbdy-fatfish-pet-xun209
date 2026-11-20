import type { Transport } from './transport.ts';
/** 锁被撤掉的原因：用户拖走 / 过期 / 被别的插件抢。 */
export type LockLoss = 'lock-lost' | 'lock-required' | null;
/** 「被用户打断」用这个异常跳出去，避免走「出错」那条路。 */
export declare class Halted extends Error {
}
/**
 * 造锁管理器。
 *
 * @param transport - 接口调用。
 * @param petId - 要占住哪只宠物。
 * @param alive - 本场演出是否还该继续（收场后重试循环要立刻退出）。
 * @param toast - 提示条。
 * @returns 取锁、续期、放锁与状态读取。
 */
export declare function createLock(transport: Transport, petId: string, alive: () => boolean, toast: (text: string) => void): {
    acquire: () => Promise<void>;
    /** 当前锁号；null = 没锁。 */
    id: () => string | null;
    /** 心跳发现锁丢了。 */
    isLost: () => boolean;
    noteFailure: (reason: unknown) => void;
    release: () => Promise<void>;
    releaseOnPageHide: () => void;
    startRenew: () => void;
    stopRenew: () => void;
};
/** 锁管理器的公开面。 */
export type Lock = ReturnType<typeof createLock>;
