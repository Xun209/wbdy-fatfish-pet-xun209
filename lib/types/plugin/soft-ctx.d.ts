/**
 * 宿主服务的软取与有界等待。
 *
 * 为什么不能靠 `inject` 声明依赖：DSH 启动时要等整棵插件树 settle
 * （app-boot 的 `await loader.await()`），插件行若因为等不到某个服务而一直 pending，
 * 整个启动流程就被挂死——表现是桌面端「desktop welcome: Web RPC failed」、
 * 窗口根本打不开。所以本插件不声明硬依赖（inject 留空），服务一律在这里软取：
 * 有就用，没有就少一块功能，绝不拖累宿主启动。
 *
 * 软取必须走 `ctx.get(name, false)`：DSH 的 ctx 是严格 getter，
 * 直接读未 inject 的属性会抛异常（不是返回 undefined）。
 * @module dsh-pet/src/host/plugin/soft-ctx
 */
import type { HostContext } from './context.ts';
/** 宿主里某个服务的最小形状：只要判断「在不在、能不能用」。 */
export interface ServiceLike {
    /** 服务对象上的方法（按需断言具体形状）。 */
    [key: string]: unknown;
}
/**
 * 软取一个宿主服务：拿不到返回 undefined，绝不抛。
 *
 * 优先用 `ctx.get(name, false)`（DSH 真实语义）；测试假 ctx 与独立模式的 ctx 没有 `get`，
 * 回落成属性直读。
 * @param ctx - 宿主上下文。
 * @param name - 服务名（如 webServer / commands / llm）。
 * @returns 服务对象；不在场时为 undefined。
 */
export declare function serviceOf<T = ServiceLike>(ctx: HostContext, name: string): T | undefined;
/**
 * 把宿主上下文包一层：读不到的服务返回 undefined，而不是抛异常。
 *
 * 这是最后一道防线——代码里残留的 `ctx.llm` 之类直读在新版宿主上抛错时，
 * 这里把它变成 undefined，让功能降级而不是让插件行失败。
 * @param ctx - 宿主上下文。
 * @returns 软化后的上下文（同一类型）。
 */
export declare function softCtx<T extends object>(ctx: T): T;
/** 有界等待的结果。 */
export interface WaitOutcome {
    /** 服务是否在期限内出现。 */
    readonly ready: boolean;
    /** 实际等了多久（ms）。 */
    readonly waitedMs: number;
}
/**
 * 有界等待某个宿主服务出现。
 *
 * 只用于「服务晚一点才就绪」的情况（例如插件行排在 webServer 之前）：
 * 轮询到服务出现为止，最多等 `timeoutMs`；超时就放弃并回调 onTimeout。
 * 绝不无限等——无限等待等于把启动挂死。
 * @param ctx - 宿主上下文。
 * @param name - 服务名。
 * @param onReady - 服务出现时的回调（只调用一次）。
 * @param options - 超时与轮询间隔；onTimeout 在超时时调用。
 * @returns 一个可调用的取消函数（提前取消等待）。
 */
export declare function whenService(ctx: HostContext, name: string, onReady: (service: ServiceLike) => void, options?: {
    timeoutMs?: number;
    intervalMs?: number;
    onTimeout?: () => void;
}): () => void;
