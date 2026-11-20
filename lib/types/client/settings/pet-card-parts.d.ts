import type { Pet } from '../../shared/types.ts';
import type { SettingsRuntime } from './runtime.ts';
/** 宠物字段补丁：`position` 只带要改的子字段，其余字段走顶层。 */
export type PetPatch = Partial<Omit<Pet, 'position'>> & {
    position?: Partial<Pet['position']>;
};
/** 字段类部件的输入。 */
export interface PetFieldsProps {
    /** 当前选中的宠物（字段值的唯一来源）。 */
    readonly pet: Pet;
    /** 保存中或配置未就绪：全部控件禁用。 */
    readonly busy: boolean;
    /** 回传字段补丁。 */
    readonly onChange: (patch: PetPatch) => void;
}
/** 头像格的输入。 */
export interface PetAvatarCellProps {
    /** 预览地址（已带破缓存版本号）。 */
    readonly avatarSrc: string;
    /** 头像正在上传：遮罩常显且文件框禁用。 */
    readonly avatarBusy: boolean;
    /** 表单整体忙：同样禁用文件框。 */
    readonly busy: boolean;
    /** 选中新头像；`undefined` = 内置条目，只显示图、不可点。 */
    readonly onAvatar: ((file: File) => void) | undefined;
}
/**
 * 造头像格：可换时整块就是按钮（悬浮出遮罩、点它开文件框），内置条目只有图。
 *
 * @param rt - 注入的节点工厂与翻译。
 * @returns 头像格组件。
 */
export declare function makePetAvatarCell(rt: Pick<SettingsRuntime, 'h' | 't'>): (props: PetAvatarCellProps) => import("react").ReactElement<any, string | import("react").JSXElementConstructor<any>>;
/**
 * 造「名字 / 大小 / 屏幕宽度上限 / 显示位置」四格（2×2）。
 *
 * @param rt - 注入的 react 能力与翻译。
 * @returns 身份字段组件。
 */
export declare function makePetIdentityFields(rt: SettingsRuntime): (props: PetFieldsProps) => import("react").ReactElement<any, string | import("react").JSXElementConstructor<any>>;
/**
 * 造「角落 / 水平偏移 / 垂直偏移」三格。
 *
 * @param rt - 注入的 react 能力与翻译。
 * @returns 位置字段组件。
 */
export declare function makePetPositionFields(rt: SettingsRuntime): (props: PetFieldsProps) => import("react").ReactElement<any, string | import("react").JSXElementConstructor<any>>;
