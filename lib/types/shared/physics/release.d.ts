/**
 * 甩抛初速估算：把一串指针采样折成起手速度，并给出弹弓拉距对应的力度。
 *
 * 不做积分、不改位置；输出只作为 throwStep 的初值。
 * 必须始终成立：采样间隔超出窗口即视为松手，不得跨窗口拼接速度。
 * @module dsh-pet/src/shared/physics/release
 */ import { type PhysicsParams } from '../types.ts';
import type { DragSample } from './throw.ts';
/** 剔除保留窗口外的旧采样；采样按时间追加，所以只需从头裁。 */
export declare const trimTrail: (trail: DragSample[], now: number) => DragSample[];
/** 抛掷指令（POST /throw 的 angle + power）→ 初速度 (vx, vy)，px/s。
 *  angle 单位度，0 = 正右、逆时针为正——屏幕 y 向下，所以 vy 取负（往上抛写 90，不是 270）。
 *  初速 = power × THROW_SPEED_ANCHOR 再过既有软上限，任意 power 都单调可区分且不超过 MAX_THROW_SPEED。
 *  两端共用本函数，保证接口抛掷的初速换算严格一致。 */
export declare const throwVelocity: (angleDeg: number, power: number) => {
    vx: number;
    vy: number;
};
/** 「一倍力度」的参考拉距（px），随宠物尺寸缩放——小宠物不必拖同样远才炸。 */
export declare const slingshotRefDist: (size: number) => number;
/** 拉距 → 力度倍率（px / 参考拉距）：线性、单调、不夹取；0 拉距 = 0 力度。 */
export declare const slingshotPower: (dist: number, size: number) => number;
/** 拉向量（起点 → 松手点，屏幕坐标，y 向下）→ 弹射角度（度）：弹的是拉的反方向，角度约定同 throwVelocity。 */
export declare const pullAngle: (pullX: number, pullY: number) => number;
/** 弹弓初速：角度约定与力度锚点同 throwVelocity，但没有软上限（任意 power 都单调可区分）。 */
export declare const slingshotVelocity: (angleDeg: number, power: number, throwPower?: number) => {
    vx: number;
    vy: number;
};
/** 由拖拽轨迹估算松手初速 (vx, vy)，px/s。
 *  方向取窗口首末端点的位移（抗抖）；大小 = 端点平均与窗口峰值按 PEAK_WEIGHT 加权，
 *  末段仍在加速时按 ACCEL_REF 给增益（最多 ACCEL_GAIN_MAX），再过软钳速。
 *  软钳速之后整体乘 physics.throwPower，让初速与死区判定一起线性缩放。
 *  返回 null = 温柔放下（轨迹为空 / 停留过久 / 窗口太短 / 峰值低于死区），调用方不抛。 */
export declare const estimateReleaseVelocity: (trail: DragSample[], now: number, physics?: PhysicsParams) => {
    vx: number;
    vy: number;
} | null;
