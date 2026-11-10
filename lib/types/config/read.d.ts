import type { ConfigPaths } from './constants.ts';
/**
 * 老用户一次性迁移：main-config.json → main-config.jsonc（重命名，内容一字不动）。
 * 为什么改扩展名：用户层从「同步」起就是带 // 注释的 JSONC 原文，挂在 .json 名下名不副实。
 * 新文件已存在 → 什么都不做（绝不用旧文件覆盖新文件）；重命名失败静默放过，读取侧有回落。
 */
export declare function migrateUserConfig(paths: ConfigPaths, log?: (message: string) => void): boolean;
/**
 * 按条目 key（= 文件名前缀 = 素材根）定位文件宠物的实际文件与磁盘原对象。
 * 写路径（POST /pet-display）改文件宠物的 display 时，既要写回它自己的配置文件，也要拿该文件的
 * existing 做透传保留，否则手改的 whisperPrompt / animations / memes 会被白名单重建抹掉。
 * 扩展名不写死（.json 或 .jsonc），写错就会新建一个空配置；前缀不存在 → undefined。
 */
export declare function readPetConfigEntry(paths: ConfigPaths, entry: string): {
    path: string;
    raw: Record<string, unknown> | undefined;
} | undefined;
/**
 * 唯一读取函数：内置默认 + 用户主配置 + 文件宠物逐字段合并后的成品聚合。
 * 每个条目都是原文件结构且字段已填满，消费端直接读；每次调用重新读文件，改配置即刻生效。
 */
export declare function readAllConfig(paths: ConfigPaths): Record<string, Record<string, unknown>>;
/** 拍平全部条目的 pets 为单列表（host 消费端用：桌面宠物列表 / 命令 / 当前桌宠解析） */
export declare function flattenPetList(merged: Record<string, Record<string, unknown>>): Record<string, unknown>[];
/** 在完成品聚合里按实例 id 定位宠物及其所属条目（host 内部消费索引）：
 *  条目 key 即素材根（assetRoot）；条目级字段（whisperPrompt/chatMemoryRounds/animations）随条目取
 *  （唯一例外：whisperPrompt 可被实例覆盖——调用方要生效值请走 ./persona 的 petPersona，别直接读 conf）。 */
export declare function findPetInstance(merged: Record<string, Record<string, unknown>>, petId: string): {
    entry: string;
    conf: Record<string, unknown>;
    pet: Record<string, unknown>;
} | undefined;
