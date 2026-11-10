/**
 * 设置页的写回计划：比较「加载时的快照」与「当前编辑列表」，算出哪些种类层需要写回。
 *
 * 纯函数，不发请求也不碰状态；main 不在计划里——它连同全局字段每次保存都整包写 PUT /config。
 * @module dsh-pet/src/client/settings/config/pack-writes
 */
import type { Pet } from '../../../shared/types.ts';
import type { ConfigEntry } from './read.ts';
/** 一次要写回的种类层。 */
export interface PackWrite {
    /** 条目名（= 素材根）。 */
    readonly entry: string;
    /** 该条目的全部实例；漏传一只等于删除它。 */
    readonly pets: readonly Pet[];
}
/**
 * 算出要写回的种类层。
 *
 * @param loaded - 加载时的条目快照。
 * @param current - 当前编辑列表（全条目拍平，每只带 `assetRoot`）。
 * @returns 有改动的种类层，顺序即条目在编辑列表里首次出现的顺序；没有改动时为空数组。
 */
export declare function diffPackWrites(loaded: readonly ConfigEntry[], current: readonly Pet[]): PackWrite[];
