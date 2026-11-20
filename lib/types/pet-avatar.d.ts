/** 一只宠物的自定义头像：文件绝对路径与它的 Content-Type。 */
export interface PetAvatarFile {
    readonly file: string;
    readonly contentType: string;
}
/**
 * 找一只宠物的自定义头像。
 *
 * 多份并存时取修改时间最新的一份：换过格式但旧文件没删掉时，用户刚传的那张才是要显示的。
 *
 * @param avatarDir - `pet/` 目录（`ConfigPaths` 里的文件宠物目录）。
 * @param petId - 素材根；调用方须先用 isValidPetId 挡住非法字符。
 * @returns 头像文件；没上传过时 undefined，调用方回退包内默认 logo。
 */
export declare function petAvatarFile(avatarDir: string, petId: string): PetAvatarFile | undefined;
/** 保存结论：成功，或按原因分档——文案与状态码由路由层翻成 HTTP 结论。 */
export type PetAvatarSave = {
    ok: true;
} | {
    ok: false;
    reason: 'not-image' | 'write-failed';
};
/**
 * 覆盖写入一只宠物的头像。
 *
 * @param avatarDir - `pet/` 目录。
 * @param petId - 素材根；调用方须先用 isValidPetId 挡住非法字符。
 * @param bytes - 已通过体积校验的图片字节。
 * @returns 保存结论；文件头不像支持的图片或写盘失败时给出原因。
 */
export declare function savePetAvatar(avatarDir: string, petId: string, bytes: Buffer): PetAvatarSave;
