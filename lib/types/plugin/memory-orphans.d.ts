/**
 * 已删宠物残留历史的查询与清理。
 *
 * 宠物从配置里删掉后，`memory.json` 里的分桶仍在，而 `GET /chat` 要求宠物存在——
 * 这类历史只能从这里看到与清掉。读写锁与文件句柄仍归 ./chat-memory（它持有串行队列）。
 * @module dsh-pet/src/host/plugin/memory-orphans
 */
import type { ChatMemoryMessage } from '../chat.ts';
import { type ConfigPaths } from '../config.ts';
/** 记忆文件的形状（与 chat-memory 的读写一致）。 */
type MemoryFile = Record<string, Record<string, {
    messages: ChatMemoryMessage[];
}>>;
/** 一个残留分桶的摘要（不含正文）。 */
export interface OrphanBucket {
    readonly entry: string;
    readonly petId: string;
    readonly messages: number;
    readonly lastTs: number;
}
/** 依赖：配置路径、记忆读写、串行队列与日志出口。 */
export interface OrphanDeps {
    readonly configPaths: ConfigPaths;
    readonly readMemory: () => Promise<MemoryFile>;
    readonly writeMemory: (mem: MemoryFile) => Promise<void>;
    readonly withLock: <T>(fn: () => Promise<T>) => Promise<T>;
    /** 只记数量，不记正文。 */
    readonly log: {
        info(message: string): void;
    };
}
/**
 * 造残留历史的查询与清理。
 *
 * @param deps - 配置路径、记忆读写与串行队列。
 * @returns 查询（只读）与清理（锁内读改写）。
 */
export declare function createMemoryOrphans(deps: OrphanDeps): {
    orphanHistory: () => Promise<OrphanBucket[]>;
    deleteOrphans: () => Promise<{
        ok: true;
        pets: number;
        messages: number;
    }>;
};
export {};
