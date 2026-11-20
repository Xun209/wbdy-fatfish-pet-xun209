/** 插件 logo 地址：没上传过头像时宿主回发的默认图。 */
export declare const LOGO_URL: string;
/**
 * 宠物头像地址：按素材根取，没上传过的由宿主回退默认 logo。
 *
 * 参数名刻意用 `root` 而不是 `pet`：它和其它端点的 `pet`（宠物实例 id，如 `main`）不是一回事，
 * 这里是素材根（目录前缀，如 `baimao`）。同名不同义会让第三方按 `pet` 的既有语义调用后静默拿到默认图。
 *
 * `v` 只用于破缓存——换过头像后同一 URL 会被浏览器记住，带上本次渲染的版本号才会重新取图。
 *
 * @param assetRoot - 宠物所属条目（素材根）；空串按「只有默认 logo」处理。
 * @param version - 本次渲染的版本号，打开面板 / 刷新 / 上传成功时换一个。
 */
export declare function avatarUrl(assetRoot: string, version: number): string;
