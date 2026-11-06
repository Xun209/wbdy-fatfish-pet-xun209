/**
 * 两张「落盘位置」展示卡：高级配置（配置文件、表情包、日志路径）与卸载与存储（清单 + 卸载命令）。
 * 数据同源于 `GET /config/meta`，读不到时两张卡都整块不出现——缺路径提示比给错路径更安全。
 * 只读展示，没有可编辑控件，因此不需要 busy。
 * 两张卡都是「标题行 + 折叠正文」，默认收起：页尾这两块不是每次都要看，收起后整页少滚一屏。
 * 开合状态只活在组件里，关掉设置页再打开还是收起——不写盘，也不与配置里的任何字段相关。
 * @module dsh-pet/src/client/settings/paths-cards
 */
import type { FunctionComponent } from 'react';
import type { ConfigMeta } from './config/index.ts';
import type { SettingsRuntime } from './runtime.ts';
/** 两张卡的共同输入。 */
export interface PathsCardProps {
    /** 宿主给出的路径与存储清单。 */
    paths: ConfigMeta;
}
/** 一对落盘位置卡。 */
export interface PathsCards {
    /** 高级配置：默认配置、用户配置、动画目录、表情包目录与日志文件路径。 */
    ConfigMetaCard: FunctionComponent<PathsCardProps>;
    /** 卸载与存储：插件落盘的全部位置 + 卸载步骤与命令。 */
    StorageCard: FunctionComponent<PathsCardProps>;
}
/**
 * 造两张落盘位置卡。
 *
 * @param rt - 注入的 react 能力与翻译函数。
 * @returns 两个卡片组件。
 */
export declare function makePathsCards(rt: SettingsRuntime): PathsCards;
