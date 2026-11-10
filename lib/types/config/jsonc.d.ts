import type { ConfigPaths } from './constants.ts';
/** 读取并解析 JSONC 文件；不存在/解析失败 → undefined（调用方决定处理） */
export declare function readJsonc(path: string): Record<string, unknown> | undefined;
/**
 * 读磁盘上的用户层原对象（JSONC 容忍，与读取路径共用同一份解析器）。
 * 写路径必须用它：PUT /config 的透传保留要把用户手改的高级字段原样带回，而用户层可能是带 // 注释
 * 的 config.jsonc 原文；若用严格 JSON.parse，解析抛错被吞 → existing 变 undefined → 白名单重建
 * → 高级字段全部丢失。文件不存在 / 损坏 → undefined。
 */
export declare function readUserConfig(paths: ConfigPaths): Record<string, unknown> | undefined;
/**
 * 用户层存在但解析不了（真损坏：连 JSONC 剥注释都救不回来）。
 * 用途：PUT /config 的损坏预检——保存是白名单重建，existing 读不出来会让原有内容被整份静默丢掉，
 * 所以先不写盘、回 200 + `reason=user-config-unparsable` 让设置页弹窗确认。文件不存在 → false。
 */
export declare function userConfigUnparsable(paths: ConfigPaths): boolean;
export declare function effectiveUserFile(paths: ConfigPaths): string | undefined;
