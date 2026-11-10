/** 挤压驱动：一个宠物一个实例。 */
export interface SquashDriver {
    /** 挤压一次；`depth` 缺省为共享常量（落地冲击会按落速给更深的值）。 */
    start: (el: HTMLVideoElement, depth?: number) => void;
    /** 立刻复位并放弃进行中的一次。 */
    stop: () => void;
}
/**
 * 造挤压驱动。
 *
 * @param o - 取值函数集合：`facing` 给当前朝向，镜像要保留，所以挤压后按它复原 `transform`。
 * @returns 可反复调用的挤压驱动。
 */
export declare function createSquashDriver(o: {
    facing: () => 'left' | 'right';
}): SquashDriver;
