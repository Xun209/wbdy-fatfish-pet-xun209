/** 一次按下的现场：到点时要派发合成事件，得留着元素、指针与坐标。 */
export interface TouchPressTarget {
    /** 按下时被捕获的元素。 */
    el: HTMLElement;
    /** 指针 id，释放捕获用。 */
    pointerId: number;
    /** 指针类型；鼠标与笔直接忽略。 */
    pointerType: string;
    /** 按下的视口横坐标（px）。 */
    x: number;
    /** 按下的视口纵坐标（px）。 */
    y: number;
}
/** 长按驱动的依赖。 */
export interface TouchPressDeps {
    /** 到点时按压是否仍然有效：已松手或已进入拖拽都返回 false。 */
    stillHolding(): boolean;
    /** 到点：把这次按压当右键，由调用方派发。 */
    onMenu(target: TouchPressTarget): void;
}
/** 长按驱动：一个宠物一个实例。 */
export interface TouchPress {
    /** 起表；重复调用先取消旧的。鼠标与笔不起表。 */
    arm(target: TouchPressTarget): void;
    /** 手指移动的累计距离（px）；超过容差即取消。 */
    move(distancePx: number): void;
    /** 松手或取消按压：清计时器。 */
    cancel(): void;
    /** 是否正在等触发。 */
    isArmed(): boolean;
}
/**
 * 造长按驱动。
 *
 * @param deps - 到点时的有效性与回调。
 * @returns 可反复起表的驱动；计时器由本模块清理。
 */
export declare function createTouchPress(deps: TouchPressDeps): TouchPress;
