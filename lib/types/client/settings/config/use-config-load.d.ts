import type { MergedConfig } from './read.ts';
import type { SettingsRuntime } from '../runtime.ts';
/** 加载状态：`error` 时表单整体禁用并显示重试。 */
export type LoadState = 'loading' | 'ready' | 'error';
/** 加载与重试入口。 */
export interface ConfigLoad {
    /** 当前加载状态。 */
    loadState: LoadState;
    /** 重新拉一次（按钮用）；会先回到 `loading`。 */
    retry: () => void;
}
/**
 * 拉取成品配置。
 *
 * @param rt - 只用到 `useState`、`useEffect`。
 * @param onMerged - 拿到聚合后的处理函数；必须是稳定引用（`useCallback`），否则会反复重拉。
 * @returns 加载状态与重试入口。
 */
export declare function useConfigLoad(rt: Pick<SettingsRuntime, 'useState' | 'useEffect'>, onMerged: (merged: MergedConfig) => void): ConfigLoad;
