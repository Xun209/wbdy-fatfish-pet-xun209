/**
 * 对话图片的压缩与编码：把一张文件或一块画布压进宿主可接受的预算，产出可发送的 base64。
 * 纯计算（尺寸换算、字节反推）与 DOM（解码、canvas）分开，前者可单测。
 * 预算依据：宿主按 1 MiB 请求体拒绝，base64 膨胀 4/3，所以解码后上限取 640 KiB。
 * @module dsh-pet/src/shared/chat/encode
 */
import { type PetImageMediaType } from './image-pick.ts';
/** 单张图片的字节上限（解码后）。 */
export declare const IMAGE_MAX_BYTES: number;
/** 长边上限：再大对"看清报错文字"没有收益，只会挤占请求体。 */
export declare const IMAGE_MAX_SIDE = 2048;
/** 质量阶梯：从高到低，第一档进预算就停。 */
export declare const IMAGE_QUALITIES: readonly [0.85, 0.75, 0.65, 0.55];
/** 按 base64 长度反推字节数（不重新解码）。 */
export declare function attachmentBytes(base64: string): number;
/** 缩到长边上限后的目标尺寸；不放大。 */
export declare function targetSize(width: number, height: number, maxSide?: number): {
    width: number;
    height: number;
};
/** 编码结果：`base64` 是要发出去的载荷，`previewUrl` 只给缩略图用。 */
export interface EncodedImage {
    readonly base64: string;
    readonly mediaType: PetImageMediaType;
    readonly bytes: number;
    readonly width: number;
    readonly height: number;
    /** 是否重新编码过（原图超限，或来源本来就是画布）。 */
    readonly resized: boolean;
    /** 小尺寸预览（几十 KB 以内），避免把整张图的 data URL 挂在 DOM 上。 */
    readonly previewUrl: string;
}
/**
 * 把一块画布压进预算：按质量阶梯转 JPEG，第一档进预算就停。
 *
 * @param canvas - 已按目标尺寸画好的画布（文件与截屏共用这条）。
 * @returns 载荷与预览；压不进预算时抛错。
 */
export declare function encodeCanvas(canvas: HTMLCanvasElement): EncodedImage;
/**
 * 把一张图片文件编码成可发送的附件。
 *
 * 原图够小就原样发送（不重编码：JPEG 再压一次会掉画质，动图也能保住）；
 * 超限才缩到长边上限、按质量阶梯逐档压到预算内。
 *
 * @param file - 已通过 `isImageFile` 的文件。
 * @returns 载荷与预览；压不进预算时抛错（调用方提示用户换图）。
 */
export declare function encodeImageFile(file: File): Promise<EncodedImage>;
