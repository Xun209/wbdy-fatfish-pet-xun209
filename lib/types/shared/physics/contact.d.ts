/**
 * 接触面求解：把撞击后的速度按接触面法向与切向分解，法向反弹、切向摩擦。
 *
 * 法向统一约定为「指向离开接触面的一侧」，四条边因此共用同一套公式；
 * 只算速度，位置夹回仍由 throw.ts 负责。
 */
import type { PhysicsParams } from '../types.ts';
/** 轴对齐接触面。 */
export type ContactEdge = 'left' | 'right' | 'ceiling' | 'floor';
/** 每个接触面的单位法向（nx, ny），朝向可通行的一侧。 */
export declare const CONTACT_NORMALS: Readonly<Record<ContactEdge, {
    readonly nx: number;
    readonly ny: number;
}>>;
/** 一次接触求解的结果：出射速度（px/s）与法向 / 切向分量，后两者供调用方判静止。 */
export interface ContactResult {
    readonly vx: number;
    readonly vy: number;
    /** 出射法向速度（px/s，≥ 0，沿法向外）。 */
    readonly normalSpeed: number;
    /** 出射切向速度（px/s，带符号，沿切向）。 */
    readonly tangentSpeed: number;
}
/**
 * 求一次接触后的速度：法向按恢复系数反弹，低于阈值即贴住归零；切向只按摩擦衰减。
 *
 * @param speed - 撞击后的速度（px/s），法向分量由接触面决定，不要求是竖直或水平。
 * @param edge - 撞到的边。
 * @param physics - 恢复系数与切向摩擦。
 * @param dt - 本步时长（s），摩擦按它换算衰减量。
 * @returns 出射速度；法向 / 切向分量供 {@link isRestingOnContacts} 判静止。
 */
export declare const resolveContact: (speed: {
    readonly vx: number;
    readonly vy: number;
}, edge: ContactEdge, physics: PhysicsParams, dt: number) => ContactResult;
/**
 * 本步接触是否都已静止：每个接触面的法向速度≈0 且切向速度低于阈值。
 *
 * @param edges - 本步接触到的边；空数组表示没碰到任何面。
 * @param speed - 求完接触后的速度（px/s）。
 * @returns 全部接触面都贴住且切向低速时为 `true`。
 */
export declare const isRestingOnContacts: (edges: readonly ContactEdge[], speed: {
    readonly vx: number;
    readonly vy: number;
}) => boolean;
