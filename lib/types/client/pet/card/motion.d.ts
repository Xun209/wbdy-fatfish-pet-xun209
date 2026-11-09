/**
 * 一张宠物卡的运动装配：包围盒、几何、自主走位、抛掷飞行、位置跟随与碰撞站场。
 * 不负责指针与菜单：拖拽驱动经迟绑槽回读，避免与运动驱动形成构造期环。
 * 三套驱动都只建一次，rAF 句柄与世代号在驱动内部，跨渲染存活。
 * @module dsh-pet/src/client/pet/card/motion
 */
import { type Flight, type FlightMetrics } from '../motion/flight.ts';
import { type PositionFollow } from '../motion/position-follow.ts';
import { type SquashDriver } from '../motion/squash.ts';
import { type Walk } from '../motion/walk.ts';
import type { CardLive } from './live.ts';
import type { CardStateApi } from './state.ts';
import type { MovesConfig } from '../../../shared/types.ts';
import type { PetCollisionSlot } from '../../../shared/physics.ts';
import type { RuntimePet } from '../types.ts';
import type * as ReactNS from 'react';
/** 注入的 react 能力。 */
export interface CardMotionRuntime {
    /** 副作用；碰撞站场注册与注销。 */
    useEffect: (effect: ReactNS.EffectCallback, deps?: ReactNS.DependencyList) => void;
    /** 引用；三套驱动只造一次。 */
    useRef: <T>(initial: T) => ReactNS.MutableRefObject<T>;
}
/** 运动装配的输入。 */
export interface CardMotionInput {
    /** 卡状态：自定义位置、朝向与动画名的最新值。 */
    card: CardStateApi;
    /** 成品配置的最新值。 */
    cfgRef: ReactNS.MutableRefObject<RuntimePet>;
    /** 宠物间碰撞站场。 */
    arena: ReactNS.MutableRefObject<{
        slots: Record<string, PetCollisionSlot>;
    }>;
    /** 装配根迟绑槽。 */
    live: ReactNS.MutableRefObject<CardLive>;
    /** 当帧几何（配置尺寸推出来）。 */
    metrics: FlightMetrics;
    /** 该宠物的走位池。 */
    moves: MovesConfig;
    /** 本宠物 id：碰撞槽键与飞行排除自己都用它。 */
    petId: string;
    /** 宠物根节点。 */
    root: () => HTMLDivElement | null;
    /** 落位后提交归一化中心，交给 React 重排。 */
    setCustomPos: CardStateApi['actions']['setCustomPos'];
    /** 换成走路动作并播一次。 */
    setOnce: (on: boolean) => void;
    /** 换成指定动画。 */
    setAnim: (anim: string) => void;
}
/** 运动装配的产物：其它模块按需取用，不缓存整份。 */
export interface CardMotion {
    /** 当帧几何。 */
    metrics: () => FlightMetrics;
    /** 当前宠物中心的视口坐标。 */
    center: () => {
        x: number;
        y: number;
    };
    /** 当前包围盒位置。 */
    box: () => {
        x: number;
        y: number;
    } | null;
    /** 写回包围盒位置。 */
    setBox: (box: {
        x: number;
        y: number;
    }) => void;
    /** 停走位与位置跟随。 */
    stopMove: () => void;
    /** 从给定左上角与初速起飞。 */
    startThrow: (px: number, py: number, vx: number, vy: number) => void;
    /** 抛掷指令：角度（度）与力度倍率。 */
    applyThrow: (angleDeg: number, power: number) => void;
    /** 自主走位。 */
    walk: Walk;
    /** 抛掷飞行。 */
    flight: Flight;
    /** 位置跟随。 */
    posFollow: PositionFollow;
    /** Q 弹挤压。 */
    squash: SquashDriver;
}
/**
 * 造运动装配的 hook。
 *
 * @param rt - 注入的 react 能力。
 * @returns 接收装配输入的 hook，返回本卡的运动驱动面。
 */
export declare function createCardMotion(rt: CardMotionRuntime): (input: CardMotionInput) => CardMotion;
