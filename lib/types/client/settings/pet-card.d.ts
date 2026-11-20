/**
 * 选中宠物的配置卡：头像、名字 / 大小 / 显示位置、角落与偏移、四个功能开关、实例级人设。
 * 只编辑 main 条目的实例字段：条目级字段由成品配置回落，卡里不出现也不回写；文件宠物永不进这张卡。
 * 纯展示 + 回调，状态全在设置页外壳；`onChange` 的补丁形状即提交形状的预览。
 * 头像格与两组字段在 ./pet-card-parts，本文件只做编排。
 * @module dsh-pet/src/client/settings/pet-card
 */
import type { FunctionComponent } from 'react';
import type { Pet } from '../../shared/types.ts';
import type { SettingsRuntime } from './runtime.ts';
import { type PetPatch } from './pet-card-parts.ts';
/** 宠物卡的全部输入。 */
export interface PetCardProps {
    /** 当前选中的宠物；`null` 表示列表为空。 */
    pet: Pet | null;
    /** 表单是否禁用（保存中或配置还没加载好）。 */
    busy: boolean;
    /** 保存 / 同步的最近一次反馈，就近显示在卡片右上角。 */
    msg: {
        kind: 'ok' | 'err' | '';
        text: string;
    };
    /** 条目级人设正文，作为实例人设输入框的 placeholder。 */
    entryPrompt: string;
    /** 头像预览地址（已带破缓存版本号）；没上传过时宿主回的就是默认 logo。 */
    avatarSrc: string;
    /** 头像正在上传：遮罩常显且文件框禁用。 */
    avatarBusy: boolean;
    /** 选中一张新头像；内置条目没有这个能力，传 undefined 时只显示预览、不可点。 */
    onAvatar?: (file: File) => void;
    /** 改选中宠物的字段。 */
    onChange: (patch: PetPatch) => void;
    /** 就近保存。 */
    onSave: () => void;
    /** 删除当前宠物（先弹确认）。 */
    onRemove: () => void;
}
/**
 * 造宠物配置卡。
 *
 * @param rt - 注入的 react 能力与翻译函数。
 * @returns 卡片组件。
 */
export declare function makePetCard(rt: SettingsRuntime): FunctionComponent<PetCardProps>;
