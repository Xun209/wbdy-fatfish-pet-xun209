/** 点播回执的终态。 */
export interface PlaybackEnd {
    /** 终态：正常播完 / 播放失败 / 被顶掉。 */
    status: 'ended' | 'failed' | 'cancelled' | 'timeout' | 'gone';
    /** 失败原因（status 为 failed 时）。 */
    reason?: string;
}
/**
 * 造传输层。
 *
 * @param ctx - 客户端上下文；只用来取 `petApi7340` 这个只读服务。
 * @returns 接口调用与读数方法；`attach` 用来把本场演出的取消信号挂上去。
 */
export declare function createTransport(ctx: {
    get: (name: string) => unknown;
}): {
    /** 换本场演出的取消信号；传 null 表示收场（并 abort 旧的那一个）。 */
    attach: (next: AbortController | null) => void;
    call: (method: string, path: string, body?: unknown, signal?: AbortSignal) => Promise<Record<string, unknown>>;
    pose: (petId: string) => {
        x: number;
        y: number;
        facing: "left" | "right";
    } | null;
    progress: (petId: string) => {
        playbackId: string | null;
        currentTime: number;
        duration: number;
        paused: boolean;
        anim?: string;
    } | null;
    waitPlayback: (id: string | null) => Promise<PlaybackEnd>;
};
/** 传输层的公开面。 */
export type Transport = ReturnType<typeof createTransport>;
