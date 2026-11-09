/** 素材地址的输入。 */
export interface AssetSource {
    /** 第三方点播给的完整地址（已由宿主限 http/https）；给了就优先用它。 */
    cueUrl?: string | null;
    /** 素材根（= 配置文件前缀）；多实例共享同一素材目录。 */
    assetRoot: string;
    /** 宠物 id，素材根缺失时的兜底。 */
    id: string;
    /** 动画名。 */
    anim: string;
    /** 扩展名（含点，如 `.webm`）。 */
    ext: string;
}
/**
 * 拼一次动画的素材地址。
 *
 * @param source - 地址来源与标识。
 * @returns 可直接 fetch 的地址；`cueUrl` 优先。
 */
export declare function animationAssetUrl(source: AssetSource): string;
