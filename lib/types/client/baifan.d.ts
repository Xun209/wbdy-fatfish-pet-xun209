/** 本模块用到的客户端上下文子集。 */
export interface BaifanContext {
    /** 取页面内 Cordis 服务（服务名 → 实例）；缺失返回 undefined。 */
    get: (name: string) => unknown;
}
/**
 * 挂载「吃白饭」：建覆盖层、注册菜单、按拍读取页面内的点击。
 *
 * @param ctx - 客户端上下文；只用来取 `petApi7340` 这个只读服务。
 * @param host - 覆盖层容器，由 shell.overlay 槽提供；不能传 `document.body`。
 * @returns 卸载钩子：撤菜单、停轮询、清覆盖层。
 */
export declare function mountBaifan(ctx: BaifanContext, host: HTMLElement): () => void;
