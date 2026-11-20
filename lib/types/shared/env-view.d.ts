/**
 * 环境气泡的视图模型：把 `sections.env` 的读数折成两端都能直接渲染的行。
 *
 * 只做格式化与取舍（标题、图标、大字温度、三行键值、脚注），不碰 DOM、不读时钟；
 * 网页端映射成 React 节点、桌面端映射成 DOM 节点，两份渲染共用这里，文案不会漂。
 * @module dsh-pet/src/shared/env-view
 */
import { type EnvIconShape } from './env-icon.ts';
import type { EnvState } from './state.ts';
/** 一行键值：左标签右数值。 */
export interface EnvBubbleRow {
    /** 左侧标签（体感 / 湿度 / 风速）。 */
    readonly label: string;
    /** 右侧数值，已带单位。 */
    readonly value: string;
}
/** 环境气泡要画的东西；查不到时只有 `emptyText`。 */
export interface EnvBubbleView {
    /** 标题：省 + 市；都没有时是「天气」。 */
    readonly title: string;
    /** 天气图标几何；查不到时缺省。 */
    readonly icon?: readonly EnvIconShape[];
    /** 大字气温（带 °C）；查不到时缺省。 */
    readonly temperature?: string;
    /** 中文天气短语（阴 / 晴 / 雷阵雨）；查不到时缺省。 */
    readonly summary?: string;
    /** 键值行；查不到时为空数组。 */
    readonly rows: readonly EnvBubbleRow[];
    /** 脚注：观测时刻；缺省表示上游没给时间。 */
    readonly footer?: string;
    /** 查不到时的一句话；有天气数据时缺省。 */
    readonly emptyText?: string;
}
/**
 * 折出环境气泡的视图。
 *
 * @param state - `sections.env` 的读数。
 * @returns 标题、图标、温度、短语、三行键值与脚注；没有天气时退化成一句「暂时查不到天气」。
 */
export declare function envBubbleView(state: EnvState): EnvBubbleView;
