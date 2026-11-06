/**
 * 确认 / 提示弹窗（仿官方视觉：遮罩 + 居中卡片 + 按钮）。
 * 五种场景各有自己的按钮组合：删除要确认、只剩一只（main / 某个种类）只能「知道了」、
 * 同步要确认、配置损坏要确认强行重建。
 * 确认后的动作由设置页外壳执行（它才知道怎么删、怎么带 force 存盘），这里只负责问与答。
 * @module dsh-pet/src/client/settings/dialog
 */
import type { FunctionComponent } from 'react';
import type { SettingsRuntime } from './runtime.ts';
/** 弹窗场景；`corrupt` 带出宿主给的真实写入路径，`lastOfKind` 带出删不掉的种类名。 */
export type DialogState = null | {
    kind: 'remove';
} | {
    kind: 'lastOne';
} | {
    kind: 'lastOfKind';
    entry: string;
} | {
    kind: 'sync';
} | {
    kind: 'corrupt';
    path: string;
};
/** 弹窗的输入。 */
export interface DialogProps {
    /** 当前场景；`null` 表示不显示。 */
    dialog: Exclude<DialogState, null>;
    /** 当前选中的宠物 id，用于「删除宠物 X」的确认文案。 */
    selId: string;
    /** 取消：点遮罩、取消按钮或「知道了」。 */
    onDismiss: () => void;
    /** 确认：由外壳按场景派发到删除 / 强行重建 / 同步。 */
    onConfirm: () => void;
}
/**
 * 造确认弹窗。
 *
 * @param rt - 注入的 react 能力与翻译函数。
 * @returns 弹窗组件。
 */
export declare function makeDialog(rt: SettingsRuntime): FunctionComponent<DialogProps>;
