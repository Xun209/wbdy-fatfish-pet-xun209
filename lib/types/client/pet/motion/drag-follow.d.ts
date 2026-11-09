import type { BoxPoint } from './geometry.ts';
/** 跟随驱动每次起跑取的当帧能力：起跑时取一次快照，一次拖拽内盒与弹簧参数不变。 */
export interface DragFollowDeps {
    /** 当帧能力快照。 */
    card(): {
        /** 当前包围盒位置。 */
        box(): BoxPoint | null;
        /** 写回包围盒位置（每帧调用）。 */
        setBox(box: BoxPoint): void;
        /** 该宠物的物理参数，只取弹簧刚度。 */
        physics: {
            throwPower: number;
        };
    };
}
/** 弹簧跟随驱动：一个宠物一个实例。 */
export interface DragFollow {
    /** 设定这一拍的目标（包围盒左上角）。 */
    aim(target: BoxPoint): void;
    /** 起跑；已经在跑时立即返回。 */
    start(rootEl: HTMLDivElement): void;
    /** 停跟随并清掉目标与残余速度。 */
    stop(): void;
}
/**
 * 造跟随驱动。
 *
 * @param deps - 读写包围盒与取弹簧刚度。
 * @returns 可反复瞄准的驱动。
 */
export declare function createDragFollow(deps: DragFollowDeps): DragFollow;
