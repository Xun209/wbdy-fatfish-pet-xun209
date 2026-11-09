/**
 * 管道应答的形状转换：把一次路由结果（{@link RouteResult}）翻译成 Helper 的应答体。
 *
 * 只做形状转换，不算业务、不读写盘；两处消费（素材走文件路径、其余走 body）的口径都收在这里，
 * 因此可以脱离 Electron 与 HTTP 断言。素材分支恒 200——404/400 已由 text 分支表达。
 * @module dsh-pet/src/host/plugin/desktop/bridge-response
 */
import type { BridgeResponse } from '../../helper/bridge.ts';
import type { RouteResult } from '../../http.ts';
/**
 * 把路由结果翻译成管道应答。
 *
 * @param id - 本次请求的编号，应答必须原样带回（管道上并存的请求靠它配对）。
 * @param result - 业务处理结果。
 * @returns 应答体；`none` 落成空的 204。
 */
export declare function toBridgeResponse(id: number, result: RouteResult): BridgeResponse;
