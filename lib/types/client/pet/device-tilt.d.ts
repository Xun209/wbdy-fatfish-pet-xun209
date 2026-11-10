/**
 * 手机体感输入：陀螺仪倾斜与摇一摇，换算成物理世界里的重力向量与初速度。
 *
 * 换算与订阅分开：换算纯函数可单测，订阅只碰浏览器 API。
 * 传感器只在安全上下文（HTTPS / localhost）可用——HTTP 下两个事件类型根本不存在，订阅直接空转。
 * @module dsh-pet/src/client/pet/device-tilt
 */
import type { GravityVector } from '../../shared/physics.ts';
/** 倾斜死区（度）：小于它视为没倾斜，免得手机本来就歪着时宠物一直滑。 */
export declare const TILT_DEAD_ZONE_DEG = 2;
/** 摇一摇触发阈值（m/s²，不含重力）：低于它不算摇。 */
export declare const SHAKE_THRESHOLD = 18;
/** 摇一摇去重窗口（ms）：一次甩动只给一个冲量。 */
export declare const SHAKE_COOLDOWN_MS = 300;
/** 一次姿态采样的平面分量（度）。 */
export interface TiltSample {
    /** 前后倾：平放为 0，向自己倾斜为正。 */
    readonly beta: number;
    /** 左右倾：平放为 0，向右倾为正。 */
    readonly gamma: number;
}
/** 摇一摇冲量（px/s）。 */
export interface ShakeVector {
    readonly vx: number;
    readonly vy: number;
}
/**
 * 倾斜 → 重力向量：按三角函数投影，倾角 θ 的分量是 `gravity × sin(θ)`。
 *
 * @param sample - 当前姿态。
 * @param baseline - 开启体感时记下的中性姿态。
 * @param gravity - 配置里的重力，作为倾斜到竖直时的满值（px/s²）。
 * @param screenAngle - 屏幕方向角（度）；横屏时把设备轴旋到屏幕轴。
 * @returns 屏幕坐标系里的重力分量；处于死区内时为 0。
 */
export declare function tiltGravity(sample: TiltSample, baseline: TiltSample, gravity: number, screenAngle?: number): GravityVector;
/**
 * 摇一摇 → 初速度：方向取甩动方向（屏幕坐标的横向/纵向加速度），力度按基准 × `throwPower`。
 *
 * @param ax - 横向加速度（m/s²）；可能含重力，那正是 {@link SHAKE_THRESHOLD} 的判定口径。
 * @param ay - 纵向加速度（m/s²）。
 * @param az - 垂直加速度（m/s²）：参与阈值判定——只有它能让"纯前后抖"也够得上一次甩动。
 * @param throwPower - 配置里的总力度倍率；`1` 即基准力度。
 * @returns 初速度；加速度不足阈值或横向/纵向都为 0（方向不可用）时返回 `null`。
 */
export declare function shakeImpulse(ax: number, ay: number, az: number, throwPower: number): ShakeVector | null;
/** 环境是否具备传感器 API：HTTP 下这两个全局类型不存在，不能靠事件是否到达来判断。 */
export declare function canReadMotionSensors(): boolean;
/** 本次要申请授权的传感器种类：只问真正要用的那一个事件。 */
export interface MotionSensorKinds {
    /** 倾斜（deviceorientation）。 */
    readonly tilt: boolean;
    /** 摇一摇（devicemotion）。 */
    readonly shake: boolean;
}
/**
 * 请求传感器权限（iOS 13+ 必需，且必须在用户手势里调用）；只申请本次要用的种类。
 *
 * @param kinds - 需要授权的种类；两个都关时什么都不问，直接 resolve `true`。
 * @returns 全部申请成功（或环境本来就不需要授权）时为 `true`；任一种被拒、或该事件类型在此上下文里不存在
 *  （非安全上下文，HTTP 下两个全局类型都没有）时为 `false`。
 */
export declare function requestMotionPermission(kinds: MotionSensorKinds): Promise<boolean>;
/**
 * 订阅姿态采样。
 *
 * @param onSample - 每帧回调；事件里缺 beta/gamma（部分设备）时跳过。
 * @returns 取消订阅。
 */
export declare function subscribeTilt(onSample: (sample: TiltSample) => void): () => void;
/**
 * 订阅摇一摇：只在这个模块做阈值与去重，调用方拿到的是"真正算一次甩动"的加速度。
 *
 * 部分机型不给 `acceleration`（只有含重力的那份），所以按 `accelerationIncludingGravity` 兜底；
 * 两种来源共用同一个阈值，含重力时静止约 9.8 m/s²，仍低于阈值。
 *
 * @param onShake - 触发时回调三轴加速度（m/s²）。
 * @param now - 时钟；测试注入。
 * @returns 取消订阅。
 */
export declare function subscribeShake(onShake: (ax: number, ay: number, az: number) => void, now?: () => number): () => void;
