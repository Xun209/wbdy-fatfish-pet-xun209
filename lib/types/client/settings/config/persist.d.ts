import { type SaveFields } from './http.ts';
import type { MergedConfig } from './read.ts';
import type { PackWrite } from './pack-writes.ts';
/** 保存结果；`corrupt` 带出真实写入路径，`partial` 列出没写成功的种类。 */
export type SaveResult = {
    kind: 'ok';
} | {
    kind: 'invalid';
} | {
    kind: 'error';
} | {
    kind: 'corrupt';
    path: string;
} | {
    kind: 'partial';
    failed: readonly string[];
};
/**
 * 保存表单。
 *
 * @param fields - 要提交的全部字段（main 实例 + 全局字段）。
 * @param packWrites - 本次有改动的种类层；串行写，main 失败时一条都不写。
 * @param force - 用户在损坏弹窗里确认过才为 `true`。
 * @param fallbackUserFile - 宿主没回写入路径时的兜底（meta 里读到的用户配置路径）。
 * @returns 保存结果；成功或部分成功时已完成容器重载与通知重读。
 */
export declare function persistSettings(fields: SaveFields, packWrites: readonly PackWrite[], force: boolean, fallbackUserFile: string): Promise<SaveResult>;
/**
 * 把内置默认配置整份同步到用户层。
 *
 * @returns 写入后的成品聚合（调用方还要用它刷新表单）；失败返回 `null`。
 */
export declare function syncSettings(): Promise<MergedConfig | null>;
