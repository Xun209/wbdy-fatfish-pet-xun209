/**
 * 对话弹窗里的三枚内联 SVG 图标。
 * 不用 emoji：同一个符号在不同字体回退链下会被渲染成异体字形（上传用的 🖼 在 Windows 上就是如此）。
 * @module dsh-pet/src/shared/chat/icons
 */
/** 图片图标：外框 + 太阳 + 山脊。 */
export declare function pictureIcon(size?: number): SVGElement;
/** 话筒图标：话筒胶囊 + 拾音弧 + 支架。 */
export declare function micIcon(size?: number): SVGElement;
/** 相机图标：机身 + 镜头。 */
export declare function cameraIcon(size?: number): SVGElement;
