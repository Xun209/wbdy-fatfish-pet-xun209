/**
 * 页面打开时一次性拉取的宿主数据：落盘位置清单（`/config/meta`）与候选模型清单（`/models`）。
 * 两个请求互不依赖、失败都不阻塞表单：缺 meta 只影响两张路径卡，缺候选清单只影响下拉框。
 * 顺带把「组件已卸载」的判断留在 hook 里，避免请求回来往死掉的组件上写状态。
 * @module dsh-pet/src/client/settings/use-remote-data
 */
import { type ConfigMeta } from './config/index.ts';
import type { ModelCatalogGroup } from './picker/index.ts';
import type { SettingsRuntime } from './runtime.ts';
/** 一次性拉取的结果。 */
export interface RemoteData {
    /** 路径与存储清单；`null` = 还没拿到或读取失败。 */
    paths: ConfigMeta | null;
    /** 候选模型清单；`null` = 还没拉到或拉取失败。 */
    catalog: ModelCatalogGroup[] | null;
    /** 候选清单拉取失败（下拉框要显示一行提示）。 */
    catalogFailed: boolean;
}
/**
 * 拉取元信息与候选清单。
 *
 * @param rt - 只用到 `useState` 与 `useEffect`。
 * @returns 三个只读结果。
 */
export declare function useRemoteData(rt: Pick<SettingsRuntime, 'useState' | 'useEffect'>): RemoteData;
