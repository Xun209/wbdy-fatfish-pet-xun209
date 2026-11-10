import type { CardHub } from './hub.ts';
import type { PetCardProps } from './props.ts';
import type * as ReactNS from 'react';
/** 注入的 react 能力。 */
export interface CueEffectsRuntime {
    /** 副作用；七个消费函数共用一个 effect。 */
    useEffect: (effect: ReactNS.EffectCallback, deps?: ReactNS.DependencyList) => void;
    /** 引用；守卫各自的已消费计数器。 */
    useRef: <T>(initial: T) => ReactNS.MutableRefObject<T>;
}
/**
 * 制造指令处理的 hook。
 *
 * @param rt - 注入的 react 能力。
 * @returns 接收运行时与 props 的 hook；内部只注册一个分派 effect。
 */
export declare function createCueEffects(rt: CueEffectsRuntime): (hub: CardHub, props: PetCardProps) => void;
