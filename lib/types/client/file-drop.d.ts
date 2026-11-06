/** 落点自己的高亮类名；具体样式由各落点自己写。 */
export declare const DROP_TARGET_CLASS = "is-drop-target";
/** 拖拽事件的结构子集：原生 DragEvent 与注入 react 的合成事件都满足。 */
export interface DragLike {
    /** 拖拽携带的数据；非 HTML 拖拽来源可能为空。 */
    readonly dataTransfer: DataTransfer | null;
    /** 拦掉默认行为：否则浏览器会把拖进去的文件当导航打开，页面直接被换掉。 */
    preventDefault: () => void;
    /** 阻断冒泡：DSH 的拖拽监听就在同一棵树的祖先上，不拦会被它再处理一遍。 */
    stopPropagation: () => void;
}
/** 落点事件额外带的信息。 */
export interface DropTargetLike extends DragLike {
    /** 监听器当前绑定的元素；原生事件里可能为空。 */
    readonly currentTarget: EventTarget | null;
    /** 离开时指针进入的目标；用来区分「离开落点」与「在落点子元素之间移动」。 */
    readonly relatedTarget: EventTarget | null;
}
/**
 * 认领「指针刚进入落点」：阻断冒泡，并收起宿主的整页遮罩。
 *
 * 宿主的遮罩由 document 上的 dragenter 驱动，指针进到我们的区域后它不该再压着整个页面；
 * 它的计数早在指针进入我们区域前就加上去了，所以这里要连带替它收一次尾。
 *
 * @param event - 落点收到的 dragenter。
 * @returns 带文件时为 true 且已阻断冒泡；其它拖拽返回 false 且不碰事件与遮罩。
 */
export declare function claimFileDragEnter(event: DragLike): boolean;
/**
 * 认领「有文件经过」的拖拽。
 *
 * @param event - 我们的界面收到的 dragover。
 * @returns 带文件时为 true，且已拦默认行为与冒泡；纯文本等其它拖拽返回 false 且不碰事件。
 */
export declare function claimFileDragOver(event: DragLike): boolean;
/**
 * 认领落在我们界面上的文件拖放。
 *
 * @param event - 我们的界面收到的 drop。
 * @returns 第一张可发送的图片；不是文件拖放时一律不碰事件，是文件但认不出图片时吞下并返回 undefined。
 */
export declare function claimFileDrop(event: DragLike): File | undefined;
/**
 * 把落点标记成可放置状态。
 *
 * @param event - 落点上的 dragenter。
 */
export declare function markDropTarget(event: DropTargetLike): void;
/**
 * 撤掉落点的高亮。
 *
 * 指针在落点的子元素之间移动也会触发 dragleave，此时 relatedTarget 仍在区域内，不算离开；
 * 不区分的话，高亮会随着指针在输入框、按钮之间移动而闪。
 *
 * @param event - 落点上的 dragleave，或落点上的 drop。
 */
export declare function unmarkDropTarget(event: DropTargetLike): void;
