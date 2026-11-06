/**
 * 种类标签条：横向列出全部种类（内置 + 各 pet pack），点一下切换当前种类。
 *
 * 只负责「切到哪个种类」；实例的增删与字段编辑由宠物标签条和设置页外壳处理。
 * @module dsh-pet/src/client/settings/kind-tabs
 */
import type { FunctionComponent } from 'react';
import type { PetKind } from './use-pet-list.ts';
import type { SettingsRuntime } from './runtime.ts';
/** 种类标签条的输入。 */
export interface KindTabsProps {
    /** 全部种类（顺序即成品里的条目顺序）。 */
    kinds: readonly PetKind[];
    /** 当前种类（条目名）。 */
    kind: string;
    /** 保存中或配置未就绪时禁用切换。 */
    busy: boolean;
    /** 切到另一个种类。 */
    onSelect: (entry: string) => void;
}
/**
 * 造种类标签条。
 *
 * @param rt - 注入的 react 能力与翻译函数。
 * @returns 种类标签条组件。
 */
export declare function makeKindTabs(rt: Pick<SettingsRuntime, 'h' | 't'>): FunctionComponent<KindTabsProps>;
