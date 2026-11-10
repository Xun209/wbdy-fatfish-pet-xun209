/**
 * 右键菜单挂载：创建 DOM、定位、点击外关闭与回调派发。
 *
 * 不决定菜单内容（归 ./tree），只负责呈现与事件。
 * 必须始终成立：卸载时必须摘掉全部监听，不留悬挂元素。
 * @module dsh-pet/src/shared/menu/mount
 */
import type { ContextMenuMount, MenuLeaf, MenuNode } from './types.ts';
/** 挂载一个系统风格右键菜单（级联子菜单）到 document.body，位置为视口坐标。
 *  结构：根容器零尺寸，每级面板平级挂载、按触发项屏幕位置贴边定位（优先父面板右侧，
 *  放不下翻到父面板左侧，且不与任何已展开面板重叠）。
 *  级联：指针在菜单树内绝不自动收起，整体离开（root mouseleave，软 200ms）才关闭整棵菜单。
 *  clamp：允许占用的矩形（视口局部坐标）；桌面传「窗口 ∩ 工作区」——宠物贴边时窗口外扩的部分
 *  会被 OS 裁掉，约束进去即可完整显示，窗口与宠物零移动。 */
export declare function mountContextMenu(opts: {
    tree: MenuNode[];
    x: number;
    y: number;
    onAction: (leaf: MenuLeaf) => void;
    /** 菜单被关闭（点项/点外/Esc）后的通知：挂载方据此复位自身状态（如桌面可交互标记） */
    onClose?: () => void;
    /** 菜单允许占用的矩形（视口局部坐标）；缺省 = 整个视口 */
    clamp?: {
        x: number;
        y: number;
        w: number;
        h: number;
    };
}): ContextMenuMount;
