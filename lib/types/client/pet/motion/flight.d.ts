/**
 * 抛掷飞行：重力积分、边缘反弹、落地摩擦与宠物互撞，飞行中只改 DOM 位置，落定后才提交归一化中心。
 * 不负责起点与初速（拖拽松手、抛掷指令、被撞起飞各自决定），也不负责落地挤压的动画本身。
 * 依赖注入的取值函数；rAF 句柄与运动状态由本模块持有，跨渲染存活。
 * 不变量：每帧先积分、再结算互撞、最后写 DOM；互撞只写结算后的绝对速度，落定那一帧才调 commitFinal。
 * @module dsh-pet/src/client/pet/motion/flight
 */
import { type GravityVector, type PetCollisionSlot } from '../../../shared/physics.ts';
import type { BoxPoint, Center, Viewport } from './geometry.ts';
import type { PhysicsParams } from '../../../shared/types.ts';
/** 飞行需要的当帧几何（px）。 */
export interface FlightMetrics {
    /** 宠物宽度。 */
    size: number;
    /** 盒半宽。 */
    halfW: number;
    /** 盒半高。 */
    halfH: number;
    /** 身体相对视频盒左右各留的透明边。 */
    sideAllow: number;
    /** 舞台脚底垫高：互撞用的身体框按它上移。 */
    bottomPad: number;
}
/** 本帧撞击：撞的是哪条边（或宠物）与撞前速度。 */
export interface FlightImpact {
    /** 撞击对象；`pet` = 撞到另一只宠物。 */
    kind: 'left' | 'right' | 'ceiling' | 'floor' | 'pet';
    /** 撞击前的法向速度绝对值（px/s）。 */
    speed: number;
}
/** 飞行驱动的依赖：全部用取值函数，避免捕获渲染期的快照。 */
export interface FlightDeps {
    /** 宠物根节点；`null` 表示还没挂载。 */
    root(): HTMLDivElement | null;
    /** 当帧几何。 */
    metrics(): FlightMetrics;
    /** 当前视口尺寸。 */
    viewport(): Viewport;
    /** 该宠物的物理参数。 */
    physics(): PhysicsParams;
    /** 宠物间碰撞站场。 */
    arena(): {
        slots: Record<string, PetCollisionSlot>;
    };
    /** 本宠物 id：碰撞时用来跳过自己。 */
    petId: string;
    /** 当前包围盒位置。 */
    box(): BoxPoint | null;
    /** 写回包围盒位置（每帧调用）。 */
    setBox(box: BoxPoint): void;
    /** 每帧写回归一化中心：刷新或重渲染时按它重排位置，不能用 React 状态（会慢一拍）。 */
    commitLive(center: Center): void;
    /** 落定后提交归一化中心，交给 React 收尾。 */
    commitFinal(center: Center): void;
    /** 落地挤压：入参是本帧落地前的竖直速度（冲击速度）。 */
    onLanding(impactVy: number): void;
    /** 本帧发生撞击（撞边或撞宠）：触觉反馈用；一帧最多回调一次，取本帧最重的那次。 */
    onImpact?(impact: FlightImpact): void;
    /** 体感模式下的重力向量；缺省用 physics.gravity 竖直向下。只在常驻模式里读。 */
    gravity?(): GravityVector;
}
/** 飞行驱动：一个宠物一个实例。 */
export interface Flight {
    /**
     * 从给定左上角与初速起飞（抛掷模式：重力恒竖直向下，贴地低速即落定）。
     *
     * @param px - 包围盒左边缘（px）。
     * @param py - 包围盒上边缘（px）。
     * @param vx - 水平初速（px/s）。
     * @param vy - 竖直初速（px/s）。
     */
    start(px: number, py: number, vx: number, vy: number): void;
    /** 体感常驻模式：从当前位置起步、初速为零，重力逐帧取 {@link FlightDeps.gravity}；已在常驻时无副作用。 */
    startHeld(): void;
    /**
     * 改写当前速度：碰撞结算给的是绝对速度，不是增量。
     *
     * @param vx - 水平速度（px/s）。
     * @param vy - 竖直速度（px/s）。
     */
    setVelocity(vx: number, vy: number): void;
    /**
     * 叠加一个冲量（摇一摇）；没在跑时忽略——起不起飞、以什么模式起飞由调用方决定。
     *
     * @param dvx - 横向冲量（px/s）。
     * @param dvy - 纵向冲量（px/s）。
     */
    impulse(dvx: number, dvy: number): void;
    /** 停飞：取消在跑的帧并清空运动状态。 */
    stop(): void;
    /** 是否在跑（抛掷与常驻都算）。 */
    isFlying(): boolean;
    /** 是否处于体感常驻模式。 */
    isHeld(): boolean;
    /** 最近一帧的速度；没在跑时为 0。 */
    velocity(): {
        vx: number;
        vy: number;
    };
}
/**
 * 造飞行驱动。
 *
 * @param deps - 取几何、写位置与落地回调。
 * @returns 可反复调用的驱动。
 */
export declare function createFlight(deps: FlightDeps): Flight;
