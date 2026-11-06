import type { DesktopHelperDeps } from './desktop/types.ts';
export type { DesktopHelperDeps };
/**
 * 创建桌面 Helper 的全部能力。
 * @param deps - 装配期对象与桌面侧需要的动作函数。
 * @returns 启动、停止、请求重启与素材根解析。
 */
export declare function createDesktopHelper(deps: DesktopHelperDeps): {
    startHelper: () => void;
    stopHelper: (reason?: string) => void;
    requestRestart: () => Promise<void>;
    assetRootFor: (ext: string) => string;
    userRootFor: (ext: string) => string;
    markDisposed: () => void;
};
/** 桌面 Helper 生命周期的产出（供下游工厂按需 Pick）。 */
export type DesktopHelper = ReturnType<typeof createDesktopHelper>;
