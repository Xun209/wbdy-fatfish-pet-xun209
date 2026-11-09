import type { FunctionComponent } from 'react';
import type { ModelSelection } from '../../../shared/types.ts';
import type { SettingsRuntime } from '../runtime.ts';
import { type ModelCatalogGroup } from './model-rows.ts';
/** 选择器的对外契约：一个字段一个实例。 */
export interface ModelPickerProps {
    /** 字段标签，作为浮层的无障碍名。 */
    label: string;
    /** 当前选择；两者都空 = 跟随当前对话。 */
    value: ModelSelection;
    /** 禁用原因（保存中 / 配置未加载）。 */
    disabled: boolean;
    /** 候选清单；`null` 表示还在拉取。 */
    catalog: readonly ModelCatalogGroup[] | null;
    /** 候选清单拉取失败。 */
    failed: boolean;
    /** 选中一项时回填整对值。 */
    onChange: (value: ModelSelection) => void;
}
/**
 * 造模型选择器。
 * 依赖只在调用时注入一次：组件类型必须跨渲染稳定，否则浮层状态（打开 / 搜索词 / 高亮）每次渲染都会丢。
 *
 * @param rt - 注入的 react 能力与翻译函数。
 * @returns 选择器组件。
 */
export declare function makeModelPicker(rt: Pick<SettingsRuntime, 'h' | 'useState' | 'useEffect' | 'useRef' | 't'>): FunctionComponent<ModelPickerProps>;
