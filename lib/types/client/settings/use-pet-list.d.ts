/**
 * 设置页的宠物列表状态：种类标签、当前种类的实例列表与选中项。
 *
 * 两级视图：种类条决定「看哪个种类」，宠物条只渲染该种类的实例。每只实例靠 `assetRoot`
 * 记住自己属于哪个种类，保存时据此决定写回哪个文件。
 * 列表初值来自容器拍平的成品，加载完成前先显示它；删除要确认，所以只发「请求删除」。
 * @module dsh-pet/src/client/settings/use-pet-list
 */
import type { Pet } from '../../shared/types.ts';
import type { ConfigEntry, PackWrite } from './config/index.ts';
import type { DialogState } from './dialog.ts';
import type { PetPatch } from './pet-card-parts.ts';
import type { SettingsRuntime } from './runtime.ts';
/** 种类条的一项。 */
export interface PetKind {
    /** 条目名：`main` 或 pet/<前缀>-config.json 的前缀。 */
    readonly entry: string;
    /** `main` 显示为「内置」，其余直接显示前缀。 */
    readonly kind: 'main' | 'pack';
    /** 该种类的实例数（标签上括注）。 */
    readonly count: number;
}
/**
 * 把拍平的实例列表按 `assetRoot` 归纳成种类列表（顺序即首次出现顺序）。
 *
 * @param pets - 全条目的实例列表。
 * @returns 种类列表；没有 `assetRoot` 的实例归到 main。
 */
export declare function petKinds(pets: readonly Pet[]): PetKind[];
/**
 * 只属于 main 层的实例。
 *
 * `PUT /config` 写的是用户主配置（`main-config.jsonc`），只能收 main 层的实例：带上其它种类
 * 会把它们复制进 main 层，读回时与该种类自己的文件撞 id，合并器随后跳过种类实例并回落默认宠物。
 *
 * @param pets - 全条目的实例列表。
 * @returns main 层的实例（没有 `assetRoot` 的也算 main）。
 */
export declare function mainPetsOf(pets: readonly Pet[]): Pet[];
/** 宠物列表状态与操作。 */
export interface PetList {
    /** 可编辑的宠物列表（全条目，保存时按条目分组）。 */
    pets: Pet[];
    /** 只属于 main 层的实例：`PUT /config` 的提交内容。 */
    mainPets: Pet[];
    /** 种类条的数据源。 */
    kinds: PetKind[];
    /** 当前选中的种类（条目名）。 */
    kind: string;
    /** 当前种类的实例（宠物标签条的数据源）。 */
    visiblePets: Pet[];
    /** 当前选中的宠物 id。 */
    selId: string;
    /** 当前宠物所属条目的人设正文，作为实例人设「留空时跟随什么」的预览。 */
    entryPrompt: string;
    /** 切到另一只宠物。 */
    select: (id: string) => void;
    /** 切到另一个种类，并选中它的第一只。 */
    selectKind: (entry: string) => void;
    /** 改选中宠物的字段。 */
    update: (patch: PetPatch) => void;
    /** 往当前种类加一只并选中它。 */
    add: () => void;
    /** 请求删除当前宠物（交给弹窗确认）。 */
    requestRemove: () => void;
    /** 确认后真的删除；该种类只剩一只时由调用方拦住。 */
    remove: () => void;
    /** 用成品里的条目列表整体替换（加载 / 同步后），尽量保持当前种类与选中项。 */
    replace: (entries: readonly ConfigEntry[]) => void;
    /** 与加载快照比较，算出本次要写回的种类层（main 不在其中）。 */
    packWrites: () => PackWrite[];
}
/**
 * 管理宠物列表状态。
 *
 * @param rt - 只用到 `useState`、`useCallback` 与 `useRef`。
 * @param requestDialog - 打开确认弹窗（`lastOne` / `lastOfKind` / `remove`）。
 * @returns 列表状态与全部操作。
 */
export declare function usePetList(rt: Pick<SettingsRuntime, 'useState' | 'useCallback' | 'useRef'>, requestDialog: (dialog: DialogState) => void): PetList;
