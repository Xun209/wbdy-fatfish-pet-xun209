import type { ReportableStatus } from '../../shared/playback.ts';
/** 点播状态：渲染端只报这四种之一，词汇表在 `shared/playback.ts`。 */
/** 一次回执的请求形状。 */
export interface PlaybackReportRequest {
    url: string;
    body: Record<string, unknown>;
}
/**
 * 拼回执请求。
 *
 * @param playbackId - host 分配的播放编号。
 * @param status - 终态或 `playing`。
 * @param reason - 终态原因（`superseded` / `decode-error` / `asset-load` 等），不影响 URL。
 * @returns 可直接交给 `postAction` 的地址与请求体。
 */
export declare function playbackReportRequest(playbackId: string, status: ReportableStatus, reason?: string): PlaybackReportRequest;
/**
 * 造回执函数。
 *
 * @param o - 回执上下文：`petId` 只用于失败日志，不参与地址。
 * @returns 上报一次点播状态；自播动画不要调。
 */
export declare function makePlaybackReporter(o: {
    petId: string;
}): (playbackId: string, status: ReportableStatus, reason?: string) => void;
