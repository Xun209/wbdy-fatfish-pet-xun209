import type { Show } from './show.ts';
import type { Transport } from './transport.ts';
/** 菜单与点播的依赖。 */
export interface MenuDeps {
    /** 取页面内 Cordis 服务（服务名 → 实例）；缺失返回 undefined。 */
    get: (name: string) => unknown;
    /** 传输层；调接口走它的 `call`，带超时与信号转发。 */
    transport: Transport;
    /** 演出；找到归属条目后开演。 */
    show: Show;
    /** 挂载级取消信号：菜单注册不该被单场演出收场取消。 */
    signal: AbortSignal;
    /** 补注册间隔（毫秒）：owner 不在快照里时按它重试。 */
    retryMs: number;
}
/**
 * 造菜单控制器。
 *
 * @param deps - 见 {@link MenuDeps}。
 * @returns 一拍入口、首次注册与卸载钩子。
 */
export declare function createMenu(deps: MenuDeps): {
    /** 一拍：读点击、必要时补注册。 */
    tick: () => void;
    /** 首次注册菜单项；配置里没有这个玩法时什么都不做。 */
    ensureMenu: () => Promise<void>;
    /** 停掉后续拍；已发出的请求由 `signal` 收尾。 */
    dispose: () => void;
};
