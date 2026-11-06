/**
 * 碰撞触觉反馈：把撞击速度换成一个单脉冲振动。
 *
 * 只做浏览器半侧——Vibration API 在 iOS 与桌面端都不存在，调用方不必为此分支。
 * 一次碰撞只震一下：贴地弹跳会连续多帧回报同一次落地，靠「同类撞击冷却窗口」吞掉。
 * @module dsh-pet/src/client/pet/haptics
 */
/** 同类撞击的冷却窗口（ms）：窗口内重复命中只震一次。 */
export declare const HAPTIC_COOLDOWN_MS = 120;
/** 低于这个撞击速度不震（px/s）：轻碰与静止都不该有反馈。 */
export declare const HAPTIC_MIN_SPEED = 150;
/** 撞击种类，取值与物理侧的边名一致，另加宠物互撞。 */
export type ImpactKind = 'left' | 'right' | 'ceiling' | 'floor' | 'pet';
/**
 * 撞击速度 → 单次振动时长。
 *
 * @param speed - 撞击前的法向速度（px/s）。
 * @returns 时长（ms）；不该震时返回 `null`。
 */
export declare function pulseMsFor(speed: number): number | null;
/** 触觉反馈入口：一次撞击调一次。 */
export interface Haptics {
    /** 按撞击种类与速度决定要不要震、震多久。 */
    hit(kind: ImpactKind, speed: number): void;
}
/** 造触觉反馈；依赖可注入，便于在 Node 里断言而不碰真实硬件。 */
export declare function createHaptics(deps?: {
    vibrate?: (ms: number) => void;
    now?: () => number;
    enabled?: () => boolean;
}): Haptics;
