import type { FunctionComponent } from 'react';
import type { SettingsRuntime } from '../runtime.ts';
/** 一项候选；`id` 回传给 `onChange`，`label` 是已翻译的展示文案。 */
export interface SelectOption {
    id: string;
    label: string;
}
/** 下拉的对外契约：一个字段一个实例。 */
export interface SelectProps {
    /** 字段标签（已翻译），作触发器的无障碍名。 */
    label: string;
    /** 当前值；不在 `options` 里时触发器留空，绝不显示成别的选项。 */
    value: string;
    options: readonly SelectOption[];
    disabled: boolean;
    /** 选定回调；只在值真正变化时触发，与原生 `<select>` 的 `change` 同语义。 */
    onChange: (id: string) => void;
}
/**
 * 造单选下拉。
 * 依赖只在调用时注入一次：组件类型必须跨渲染稳定，否则浮层状态（打开 / 高亮）每次渲染都会丢。
 *
 * @param rt - 注入的 react 能力；不需要翻译，文案由调用方传入。
 * @returns 下拉组件。
 */
export declare function makeSelect(rt: Pick<SettingsRuntime, 'h' | 'useState' | 'useEffect' | 'useRef'>): FunctionComponent<SelectProps>;
