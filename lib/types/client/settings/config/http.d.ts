import type { FontConfig, ModelSelection, Pet, PhysicsParams } from '../../../shared/types.ts';
import type { ModelCatalogGroup } from '../picker/index.ts';
import type { MergedConfig } from './read.ts';
/** 配置文件路径与存储位置清单；宿主按平台推导，反推不出 `profile` 时为空串。 */
export interface ConfigMeta {
    user: string;
    default: string;
    animations: string;
    /** 用户表情包目录（加图不必改包）。 */
    memes?: string;
    /** 待办数据文件（一份用户级数据，不分宠物）。 */
    todos?: string;
    /** 统一日志文件；桌面版没控制台，排障只看它。 */
    logs?: string;
    /** 插件落盘的全部位置（路径与是否已存在）。 */
    storage?: Array<{
        key: string;
        path: string;
        exists?: boolean;
    }>;
    /** 当前 profile 名（拼卸载命令用）。 */
    profile?: string;
}
/** 保存要提交的全部字段；键名即宿主 `PUT /config` 的字段名。 */
export interface SaveFields {
    pets: readonly Pet[];
    notificationsEnabled: boolean;
    clickSoundEnabled: boolean;
    whisperImageEnabled: boolean;
    chatImageEnabled: boolean;
    /** 对话动作联动开关。 */
    chatAnimationEnabled: boolean;
    confineToScreen: boolean;
    trayEnabled: boolean;
    /** 语音播报总开关。 */
    voiceEnabled: boolean;
    /** 语音音色 id（白名单内的四个之一）。 */
    voiceName: string;
    /** 播放音量系数：0–1 的小数，1 = 最大音量，0 = 静音。 */
    voiceVolume: number;
    /** 周期碎碎念要不要念出来。 */
    voiceWhisperEnabled: boolean;
    /** 待办提醒要不要念出来。 */
    voiceTodoEnabled: boolean;
    physics: PhysicsParams;
    whisperModel: ModelSelection;
    chatModel: ModelSelection;
    chatMemoryRounds: number;
    chatImageLimit: number;
    font: FontConfig;
}
/** 保存结果：调用方按 `kind` 分支，不再猜 HTTP 细节。 */
export type SaveOutcome = {
    kind: 'ok';
    merged: MergedConfig;
} | {
    kind: 'corrupt';
    userFile: string | null;
} | {
    kind: 'invalid';
} | {
    kind: 'error';
};
/**
 * 把表单状态压成请求体。
 *
 * @param fields - 表单当前值。
 * @returns 直接可 `JSON.stringify` 的对象；字段名必须与宿主校验的键一一对应。
 */
export declare function buildSaveBody(fields: SaveFields): Record<string, unknown>;
/**
 * 读成品配置。
 *
 * @param signal - 卸载或重试时中断请求。
 * @returns 成品聚合；非 2xx、网络错误或被中断时返回 `null`。
 */
export declare function loadConfig(signal?: AbortSignal): Promise<MergedConfig | null>;
/**
 * 读配置文件的路径与存储清单。
 *
 * @returns 元信息；读不到时返回 `null`，调用方据此隐藏「高级配置」与「卸载与存储」两张卡。
 */
export declare function loadMeta(): Promise<ConfigMeta | null>;
/**
 * 读候选模型清单。
 *
 * @returns 服务商分组；响应缺 `providers` 或请求失败时返回 `null`（选择器显示「拉取失败」）。
 */
export declare function loadModelCatalog(): Promise<ModelCatalogGroup[] | null>;
/**
 * 全量写用户层配置。
 *
 * @param body - {@link buildSaveBody} 的输出。
 * @param force - 严格 `true` 才允许按白名单重建损坏文件（用户在损坏弹窗里确认过）。
 * @returns 保存结果；409 带出宿主给出的真实写入路径，供弹窗显示。
 */
export declare function saveConfig(body: Record<string, unknown>, force: boolean): Promise<SaveOutcome>;
/**
 * 把内置默认配置整份写入用户层（设置页的「同步」）。
 *
 * @returns 写入后的成品聚合；失败返回 `null`。
 */
export declare function syncConfig(): Promise<MergedConfig | null>;
/** 写单个种类层的结果；没有「损坏需确认」分支——那条只属于用户主配置。 */
export type PetLayerOutcome = {
    readonly kind: 'ok';
    readonly merged: MergedConfig;
} | {
    readonly kind: 'invalid';
    readonly message: string;
} | {
    readonly kind: 'error';
};
/**
 * 把某个种类的全部实例写回它自己的配置文件。
 *
 * @param entry - 条目名（= 素材根）。
 * @param pets - 该条目的全部实例；漏传一只等于删除它。
 * @returns 写后的成品聚合，或失败分类；`invalid` 带出宿主给的就地文案（如 id 冲突）。
 */
export declare function savePetLayer(entry: string, pets: readonly Pet[]): Promise<PetLayerOutcome>;
