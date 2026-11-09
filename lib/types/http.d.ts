import type { IncomingMessage, ServerResponse } from 'node:http';
/** 不同扩展名对应的 Content-Type 映射 */
export declare const MIME: Record<string, string>;
/**
 * 规范化并校验请求路径，确保它在 assets 根目录内（防路径穿越）。
 * @returns 规范化后的绝对文件路径；非法（穿越）时返回 undefined。
 */
export declare function resolveAsset(root: string, rel: string): string | undefined;
/** 在 root 下解析并确认实体存在；非法（穿越）或不存在时返回 undefined */
export declare function resolveExisting(root: string, rel: string): string | undefined;
/** 单段字节区间（闭区间）。 */
export type ByteRange = {
    readonly start: number;
    readonly end: number;
};
/** Range 判定：命中区间、越界（回 416）、忽略（回整份 200）。 */
export type RangeDecision = ByteRange | 'unsatisfiable' | null;
/**
 * 解析单段 `Range` 头。
 *
 * 只接受 `bytes=<start>-<end>`、`bytes=<start>-`、`bytes=-<suffix>` 三种单段形式。多段、单位不符、
 * 语法非法返回 null（回整份）；起点越界或 start > end 返回 'unsatisfiable'（回 416）。
 * @param header - 请求头原值，可能为 undefined。
 * @param totalBytes - 文件总字节数；非正数时一律忽略 Range。
 * @returns 闭区间、'unsatisfiable' 或 null。
 */
export declare function parseRange(header: string | undefined, totalBytes: number): RangeDecision;
/**
 * 流式返回一个文件（带 Content-Type / 长度 / 缓存头）。
 *
 * Content-Length 必须取自正在读的那个 fd（open 事件里 fstat）：先 stat 再另开流，会在素材被覆盖/
 * 截断时声明长度大于实际字节，响应永远不结束也不报错（浏览器 stalled、视频 loadeddata 永不触发）。
 * 同一个 fd 的 fstat 拿到的大小与随后读出的字节天然一致。
 *
 * 支持单段 Range：视频会中途按 `Range: bytes=N-` 补数据，回整份会让播放器把整份当后半段拼，
 * 解到错位处提前 ended（动作被截断）。
 */
export declare function sendFile(req: IncomingMessage, res: ServerResponse, file: string, contentType: string): void;
/** 发送 JSON 响应（headers 可选：如 no-cache 触发计数） */
export declare function sendJson(res: ServerResponse, status: number, obj: unknown, headers?: Record<string, string>): void;
/** 发送纯文本响应（素材 404/400 等显式错误文案） */
export declare function sendText(res: ServerResponse, status: number, body: string): void;
/** 单次业务路由的应答（WebServer 注册与桌面 Helper 管道共用的同一契约；消费方各自落盘） */
export type RouteResult = {
    kind: 'json';
    status: number;
    obj: unknown;
    headers?: Record<string, string>;
} | {
    kind: 'text';
    status: number;
    body: string;
} | {
    kind: 'file';
    file: string;
    contentType: string;
}
/** 无需应答：调用方在挂起等待期间已断开（见 /playback 的等待分支）——消费方直接收尾，不写 */
 | {
    kind: 'none';
};
/** 请求体上限（字节）：写端点只收 JSON 配置与指令，1MiB 足够，超限直接 413。 */
export declare const MAX_BODY_BYTES: number;
/**
 * 收集请求体（文本）。
 *
 * 带上限与断连处理：客户端半途断开时必须让 Promise 落地，否则处理器永远挂着、内存只增不减。
 *
 * @param req - 请求对象。
 * @returns 请求体文本。
 * @throws {Error} 超过 {@link MAX_BODY_BYTES} 时带 `code: 'body-too-large'`；连接提前断开时带 `code: 'client-aborted'`。
 */
export declare function readBody(req: IncomingMessage): Promise<string>;
