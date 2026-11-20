/** 头像长边上限（px）：聊天面板按 28px 显示，512 足够清晰，再大只是白占请求体。 */
export declare const AVATAR_MAX_SIDE_PX = 512;
/** 上传结果：成功，或可直接展示给用户的失败文案。 */
export type AvatarUpload = {
    ok: true;
} | {
    ok: false;
    message: string;
};
/**
 * 把图片文件压进长边上限并转成规范 base64。
 *
 * 已在范围内就原样上传（不重编码：透明、动图、高 DPI 都不掉）；超限才缩边并统一编成 PNG——
 * 用 JPEG 会把透明区域填成黑底。动图超限时只剩第一帧，这是缩放的固有代价。
 *
 * @param file - 用户选中的图片文件。
 * @returns 规范 base64 与媒体类型。
 * @throws 解不出图片，或浏览器拿不到 2D 画布时。
 */
export declare function encodeAvatarFile(file: File): Promise<{
    base64: string;
    mediaType: string;
}>;
/**
 * 把编码后的头像发给宿主（覆盖旧图）。
 *
 * @param assetRoot - 宠物所属素材根；文件宠物用目录前缀，内置用 `main`（宿主会拒）。
 * @param base64 - 规范 base64（不带 `data:` 前缀）。
 * @param fetchImpl - 注入的 fetch，测试用替身；生产不传，取全局 fetch。
 * @returns 成功，或宿主 / 网络给出的失败文案。
 */
export declare function postAvatar(assetRoot: string, base64: string, fetchImpl?: typeof fetch): Promise<AvatarUpload>;
/**
 * 上传一只宠物的头像（编码 + 提交）。
 *
 * @param assetRoot - 宠物所属素材根。
 * @param file - 用户选中的图片文件。
 * @returns 成功，或编码 / 宿主 / 网络给出的失败文案。
 */
export declare function uploadPetAvatar(assetRoot: string, file: File): Promise<AvatarUpload>;
