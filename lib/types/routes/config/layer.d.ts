import type { PetRouteDeps } from '../types.ts';
/** 要写的那一层：文件路径、所在目录，以及该文件在磁盘上的原对象（透传递归用）。 */
export interface ConfigLayer {
    readonly path: string;
    readonly dir: string;
    readonly existing: Record<string, unknown> | undefined;
}
/** 定位结果：命中给出该层；未命中只说明「文件不存在」，具体 reason 由调用方按端点语义决定。 */
export type ConfigLayerLookup = {
    readonly ok: true;
    readonly layer: ConfigLayer;
} | {
    readonly ok: false;
};
/**
 * 定位目标层：`main` → 用户主配置，其余 → 文件宠物自己的配置。
 *
 * @param deps - 路由层依赖（路径集）。
 * @param entry - 宠物所属条目名（合并后由宿主反查得出，不接受调用方指定）。
 * @returns 命中给出该层；条目配置文件不存在时给出 `ok: false`。
 */
export declare function resolveConfigLayer(deps: PetRouteDeps, entry: string): ConfigLayerLookup;
