/**
 * 模型选择器浮层的 DOM 树：搜索框、按服务商分组的行清单、加载/失败/空结果三态提示。
 * 只由视图数据构造节点，不持有状态、不读写 DOM——打开与关闭、定位与键盘都在 `model-picker.ts`。
 * 无障碍语义对齐 DSH 自带的选择器：浮层 `menu`、行 `menuitemradio`、高亮行走 `is-active` 类。
 * @module dsh-pet/src/client/settings/picker/model-picker-panel
 */
import type * as ReactNS from 'react';
import type { jsx } from 'react/jsx-runtime';
import type { ModelSelection } from '../../../shared/types.ts';
import type { ModelCatalogGroup, ModelRow } from './model-rows.ts';
import type { PanelPosition } from '../panel/placement.ts';
/** 浮层渲染所需的一切；每次渲染现算一份，不跨渲染保存。 */
export interface ModelPanelView {
    h: typeof jsx;
    t: (key: string) => string;
    /** 触发器上方的字段标签，给浮层当无障碍名。 */
    label: string;
    /** 浮层内输入框与行是否禁用（跟着触发器走）。 */
    disabled: boolean;
    /** 候选清单；`null` 表示还在拉取。 */
    catalog: readonly ModelCatalogGroup[] | null;
    /** 拉取失败：清单仍为 null 时显示失败文案而不是「加载中」。 */
    failed: boolean;
    /** 已算好的行清单，见 `model-rows.ts`。 */
    rows: readonly ModelRow[];
    /** 当前高亮行下标。 */
    active: number;
    /** 当前搜索词。 */
    query: string;
    /** 当前选中值，用于行的 `aria-checked`。 */
    value: ModelSelection;
    /** 浮层的 fixed 定位。 */
    pos: PanelPosition;
    /** 浮层根节点，键盘走动要靠它查询行节点并滚动。 */
    panelRef: ReactNS.MutableRefObject<HTMLDivElement | null>;
    onQueryChange: (value: string) => void;
    onPick: (row: ModelRow | undefined) => void;
    onHover: (index: number) => void;
    onKeyDown: (event: ReactNS.KeyboardEvent<HTMLInputElement>) => void;
}
/**
 * 造浮层：搜索框 + 行清单或三态提示。
 *
 * @param view - 浮层视图数据。
 * @returns 浮层根节点。
 */
export declare function buildModelPanel(view: ModelPanelView): ReturnType<typeof jsx>;
