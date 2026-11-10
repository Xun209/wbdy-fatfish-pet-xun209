/**
 * 面板落点几何：决定级联子菜单摆在父面板的哪一侧，保证不与任何已展开面板重叠。
 * 纯函数，不碰 DOM；调用方只负责读矩形与写样式。
 * @module dsh-pet/src/shared/menu/position
 */
/** 面板矩形（只需定位用到的边）。 */
export interface PanelBox {
    left: number;
    top: number;
    right: number;
    bottom: number;
}
/** {@link pickPanelPosition} 的入参。 */
export interface PanelPositionInput {
    /** 待摆放面板的尺寸。 */
    panel: {
        w: number;
        h: number;
    };
    /** 触发它的菜单项。 */
    item: {
        left: number;
        right: number;
        top: number;
    };
    /** 它所属的那一层面板：子面板平级挂载，只有 DOM 父节点能给出正确的层。 */
    parent: {
        left: number;
        right: number;
        top: number;
    };
    /** 其它已展开面板的矩形：新面板不得与其中任何一个相交。 */
    others: PanelBox[];
    /** 允许显示的范围（窗口 ∩ 工作区，视口坐标）。 */
    clamp: {
        x: number;
        y: number;
        w: number;
        h: number;
    };
}
/**
 * 决定子面板的落点：优先不与任何已展开面板重叠，其次贴边。
 *
 * @param input - 面板尺寸、触发项/父面板矩形、其它面板矩形与 clamp 范围。
 * @returns 面板左上角在视口坐标里的落点。
 */
export declare function pickPanelPosition(input: PanelPositionInput): {
    left: number;
    top: number;
};
