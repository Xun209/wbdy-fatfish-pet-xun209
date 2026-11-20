import type { ActivityAssets } from './assets.ts';
import type { Scene } from './scene.ts';
import type { Transport } from './transport.ts';
/** 演出对外暴露的面：一个入口、一个收场。 */
export interface Show {
    /** 开一场；重复调用等于重开（先彻底收掉上一场）。 */
    start: (petId: string, assets: ActivityAssets) => void;
    /** 收场：停一切、清干净、放锁。幂等。 */
    halt: (reason?: string) => Promise<void>;
    /** 这一场是否在跑；菜单用它避免重复开演。 */
    isRunning: () => boolean;
}
/** 建演出的依赖。 */
export interface ShowDeps {
    /** 接口调用与点播回执。 */
    transport: Transport;
    /** 米饭、分数与提示条。 */
    scene: Scene;
}
/**
 * 造演出导演。
 *
 * @param deps - 传输层与视觉层。
 * @returns 开演与收场。
 */
export declare function createShow(deps: ShowDeps): Show;
