import type { CSSProperties, ReactNode } from 'react';
import type * as ReactNS from 'react';
import type { jsx } from 'react/jsx-runtime';
import type { Corner } from '../../../shared/types.ts';
/** 宠物卡视图的渲染输入：全部是当帧的值、ref 与事件回调。 */
export interface CardViewProps {
    /** 根节点：定位与尺寸变量的宿主。 */
    rootRef: ReactNS.MutableRefObject<HTMLDivElement | null>;
    /** 舞台：拖拽时在这里取消脚垫位移。 */
    stageRef: ReactNS.MutableRefObject<HTMLDivElement | null>;
    /** 前台视频（A/B 双缓冲之一）。 */
    videoARef: ReactNS.MutableRefObject<HTMLVideoElement | null>;
    /** 后台视频。 */
    videoBRef: ReactNS.MutableRefObject<HTMLVideoElement | null>;
    /** 悬浮提示：位置由 placeTip 直接写 style。 */
    tipRef: ReactNS.MutableRefObject<HTMLDivElement | null>;
    /** 角落定位，写进 data-corner 由 CSS 取值。 */
    corner: Corner;
    /** 朝向，写进 data-facing 由 CSS 镜像。 */
    facing: 'left' | 'right';
    /** 宠物宽度 px，注入 --dsh-pet-size。 */
    size: number;
    /** 水平边距 px。 */
    marginX: number;
    /** 垂直边距 px。 */
    marginY: number;
    /** 气泡正文字号 px。 */
    fontBubblePx: number;
    /** 悬浮提示字号 px。 */
    fontTipPx: number;
    /** 根节点定位样式；未拖拽时为空对象，位置交给角落与边距的 CSS 变量。 */
    rootStyle: CSSProperties;
    /** 舞台位移样式；拖拽中取消脚垫位移。 */
    stageStyle: CSSProperties;
    /** 当前该挂的气泡；null 表示无气泡。 */
    bubble: ReactNode;
    /** 悬浮提示是否点亮。 */
    tipOn: boolean;
    /** 宠物名：悬浮提示内容，同时作为命中区的无障碍名称。 */
    name: string;
    /** 点击命中区。 */
    onClick(e: ReactNS.MouseEvent<HTMLDivElement>): void;
    /** 按下：开启指针捕获与拖拽。 */
    onPointerDown(e: ReactNS.PointerEvent<HTMLDivElement>): void;
    /** 指针移动：拖拽跟随。 */
    onPointerMove(e: ReactNS.PointerEvent<HTMLDivElement>): void;
    /** 抬起与取消共用一条路径。 */
    onPointerUp(e: ReactNS.PointerEvent<HTMLDivElement>): void;
    /** 指针进入命中区。 */
    onPointerEnter(e: ReactNS.PointerEvent<HTMLDivElement>): void;
    /** 指针离开命中区。 */
    onPointerLeave(): void;
    /** 右键菜单。 */
    onContextMenu(e: ReactNS.MouseEvent<HTMLDivElement>): void;
}
/**
 * 制造宠物卡视图。
 *
 * @param rt - 注入的 react 能力。
 * @returns 只做拼装的纯展示组件。
 */
export declare function makeCardView(rt: {
    h: typeof jsx;
}): (props: CardViewProps) => ReactNS.ReactElement<any, string | ReactNS.JSXElementConstructor<any>>;
