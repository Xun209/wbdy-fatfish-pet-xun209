/**
 * 浏览器侧截屏：抓一帧桌面，立刻停流，再交给同一套预算编码。
 *
 * 只抓一帧、不保留流；用户取消选择或页面策略禁止 display-capture 时抛错，
 * 由弹窗把原因显示出来（浏览器不允许时只能改用上传）。
 * @module dsh-pet/src/shared/chat/capture
 */
import { type EncodedImage } from './encode.ts';
/**
 * 截取当前屏幕的一帧。
 *
 * @returns 已压进预算的图片。
 * @throws 环境不支持、用户取消或页面策略禁止 display-capture 时。
 */
export declare function captureDisplayFrame(): Promise<EncodedImage>;
