/**
 * 宠物互撞结算：每帧把自己和站场里撞上的那一只做一次弹性分离。
 *
 * 不负责积分、重力与 DOM 写入，只回答「结算之后我该在哪、速度多少」。
 * 不变量：速度一次算定、双方都写绝对速度，绝不按增量叠加——重叠会持续好几帧，
 * 叠加会让同一对碰撞每帧重复注入动量，速度按帧指数增长。
 * @module dsh-pet/src/client/pet/motion/pet-collision
 */
import { type PetCollisionSlot, type ThrowState } from '../../../shared/physics.ts';
/** 结算需要的当帧几何。 */
export interface CollisionMetrics {
    /** 宠物宽度（px，质量 ∝ size²）。 */
    size: number;
    /** 舞台脚底垫高：身体框按它上移。 */
    bottomPad: number;
}
/** 结算依赖。 */
export interface PetCollisionDeps {
    /** 碰撞站场。 */
    arena(): {
        slots: Record<string, PetCollisionSlot>;
    };
    /** 本宠物 id：跳过自己。 */
    petId: string;
    /** 撞到别的宠物：入参是法向相对速度（px/s），供触觉反馈换算强度。 */
    onPetImpact(speed: number): void;
}
/** 结算函数：入参是本帧积分后的状态，返回结算后的状态。 */
export type PetCollisionResolver = (state: ThrowState, metrics: CollisionMetrics) => ThrowState;
/**
 * 造互撞结算器。
 *
 * @param deps - 站场、自身 id 与撞击回调。
 * @returns 一帧最多结算一对的结算函数；没撞上时原样返回入参。
 */
export declare function createPetCollision(deps: PetCollisionDeps): PetCollisionResolver;
