import type { PlaybackStatus } from './status.ts';
/**
 * 路径解析：`playback/<id>`（查询）与 `playback/<id>/report`（上报）。
 *
 * 正则两端锚定，只认这两种形状：其余（`playback/`、`playback/a/b`、`playbackx/a`）一律返回
 * undefined，交给下游分支按各自口径报错，绝不在这里「尽力猜一个 id」。
 */
export declare function parsePlaybackPath(rest: string): {
    playbackId: string;
    isReport: boolean;
} | undefined;
/** `?wait=&timeout=` 的解析结论。 */
export type WaitParse = 
/** 两者都没传 → 立刻返回（兜底 / 调试 / 只想知道当下状态）。 */
{
    kind: 'none';
}
/** 挂起等待。 */
 | {
    kind: 'ok';
    wait: PlaybackStatus[];
    timeoutMs: number;
}
/** 参数非法 → 路由回 400（附明确原因，不静默兜底）。 */
 | {
    kind: 'error';
    error: string;
};
/**
 * 解析 `?wait=<状态[,状态]>` 与 `?timeout=<ms>`（成对必填，规则见 openapi.yaml）。
 *
 * wait 支持逗号列表：终态有三个，只等 ended 会在失败时白等一整个 timeout，所以让调用方自己
 * 说清在等哪些。timeout 只接受 0..MAX_PLAYBACK_WAIT_MS 的非负整数，`0` 合法（下一拍立刻返回）。
 */
export declare function parseWaitQuery(waitRaw: string | null, timeoutRaw: string | null): WaitParse;
