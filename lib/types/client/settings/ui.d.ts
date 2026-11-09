import type * as ReactNS from 'react';
import type { jsx } from 'react/jsx-runtime';
import type { SettingsRuntime } from './runtime.ts';
/** 输入框与下拉框共用的类名。 */
export declare const INPUT_CLASS = "dsh-pet-cfg__inp";
/**
 * 数字输入的统一属性：非受控 + 失焦提交。
 *
 * 受控写法（`value={String(n)}` + `Number(e.target.value)`）在删空时必然把空串变成 0，
 * 用户想「删干净再输」时会被打断；这里让空框是合法中间态，失焦才解析并提交。
 * `key` 跟随值变化：外部改了配置就重挂载刷新，编辑期间 state 不动，所以不会打断输入。
 *
 * @param value - 当前生效值。
 * @param onCommit - 提交新值；只有真的变化时才回调。
 * @param extra - 该输入自己的属性（step / min / max / disabled 等）。
 * @returns 可直接摊给 `<input>` 的属性。
 */
export declare function numberInputProps(value: number, onCommit: (value: number) => void, extra?: ReactNS.JSX.IntrinsicElements['input']): ReactNS.JSX.IntrinsicElements['input'];
/** 等宽字体栈（路径与命令展示用），走系统栈以免多拉一份资源。 */
export declare const MONO_STACK = "ui-monospace, SFMono-Regular, Menlo, Consolas, \"Courier New\", monospace";
/** 折叠卡的输入：标题行常驻，正文收进裁剪层。 */
export interface FoldCardOptions {
    /** 正文 id，同时是标题按钮的 `aria-controls` 目标。 */
    readonly id: string;
    readonly title: string;
    /** 问号气泡里的说明。 */
    readonly hint: string;
    /** 展开后的若干行；`null` 表示该条不存在，整项跳过。 */
    readonly body: ReadonlyArray<ReturnType<typeof jsx> | null>;
    /** 当前是否展开；开合状态由调用方用 `useState` 持有，钩子顺序才稳定。 */
    readonly open: boolean;
    readonly onToggle: () => void;
}
/** 设置页的共用小件；由 {@link makeUiKit} 一次造好，各卡片共享同一套翻译与节点工厂。 */
export interface SettingsUiKit {
    /** 悬浮说明的展开属性：带 `data-tip` 即悬浮出气泡。 */
    tip: (text: string) => Record<string, string>;
    /** 问号说明入口：气泡的圆形触发元素。 */
    q: (text: string) => ReturnType<typeof jsx>;
    /** 卡片头：标题与问号说明；右侧动作由调用方自行追加。 */
    cardHead: (title: string, hint?: string) => ReturnType<typeof jsx>;
    /** 一个字段：标签（可带问号）在上、控件在下。 */
    field: (label: string, control: ReturnType<typeof jsx>, hint?: string) => ReturnType<typeof jsx>;
    /** 开关的一格：勾选框、标题与问号；说明挂在问号上，点标题只切开关。 */
    toggleCell: (label: string, value: boolean, disabled: boolean, onToggle: (value: boolean) => void) => ReturnType<typeof jsx>;
    /**
     * 折叠卡骨架：标题行常驻且整行可点，正文收进裁剪层。
     *
     * 高度过渡走 `grid-template-rows` 的 0fr→1fr，不猜 max-height——正文多长都能收干净。
     */
    foldCard: (options: FoldCardOptions) => ReturnType<typeof jsx>;
}
/**
 * 造设置页的共用小件。
 *
 * @param rt - 只用到节点工厂 `h` 与翻译 `t`。
 * @returns 各卡片共享的小件集合。
 */
export declare function makeUiKit(rt: Pick<SettingsRuntime, 'h' | 't'>): SettingsUiKit;
