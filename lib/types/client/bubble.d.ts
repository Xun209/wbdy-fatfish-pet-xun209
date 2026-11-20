/**
 * 浏览器半侧的余额与碎碎念气泡：哑组件，只把 shared 的行数据或节点树映射成 React 节点。
 * 不发起请求，显隐与停留时长由 pet.ts 控制。
 * 依赖运行时注入的 react 与 shared 的 balance / whisper 视图。
 * 必须始终成立：样式与桌面端同源，文案与档位由 shared 计算。
 * @module dsh-pet/src/client/bubble
 */
import { type BalanceState } from '../shared/balance/index.ts';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import type * as ReactNS from 'react';
import type { jsx } from 'react/jsx-runtime';
import type { EnvState } from '../shared/state.ts';
/** 制造余额气泡组件（工厂），注入样式一次。
 *  内容来自 shared 的 balancePageView（按页取行数据）；内置形态走行数据，
 *  custom 走第三方节点树。切页是淡出 → 换内容 → 淡入，显隐与 10s 计时归 pet.ts 管。
 */
export declare function makeBalanceBubble(rt: {
    h: typeof jsx;
    useState: <T>(init: T) => [T, Dispatch<SetStateAction<T>>];
    useEffect: (effect: ReactNS.EffectCallback, deps?: ReactNS.DependencyList) => void;
}): (props: {
    state: BalanceState;
    on: boolean;
    /** 目标页：0 为初始页；内置 windows 形态下 0 收起、1 窗口明细、2 区间用量。 */
    index: number;
    /** 点击气泡：上层切到下一页并重置 10s 计时器。 */
    onCycle: () => void;
}) => ReactNode;
/** 制造碎碎念气泡组件（工厂），与余额气泡共用样式与行渲染。
 *  image 是池内名（按素材根拼路径），url 是第三方完整地址，两者互斥且由 host 判定层保证。
 *  有配图时渲染在文字上方，图片样式取自 shared 的 MEME_BUBBLE_CSS。
 *  可点有两个来源：工作状态气泡经 `onClick` 跳会话，说话气泡经 `onPop` 被戳破；两者不会同时给。
 */
export declare function makeWhisperBubble(rt: {
    h: typeof jsx;
    useState: <T>(init: T) => [T, Dispatch<SetStateAction<T>>];
    useEffect: (effect: ReactNS.EffectCallback, deps?: ReactNS.DependencyList) => void;
    useRef: <T>(initial: T) => ReactNS.MutableRefObject<T>;
}): (props: {
    text: string;
    image?: string;
    url?: string;
    assetRoot?: string;
    on: boolean;
    voiceState?: 'idle' | 'loading' | 'ready' | 'failed';
    /** 可点时的回调；工作状态气泡用它跳会话，缺省即不可点。 */
    onClick?: (e: ReactNS.MouseEvent<HTMLDivElement>) => void;
    /** 戳破回调：消失动画播完才调它；缺省即不可戳破。 */
    onPop?: () => void;
}) => ReactNode;
/** 环境气泡：视图与文案来自 shared 的 envBubbleView，这里只把行映射成 React 节点。
 *
 *  主区是天气图标 + 大字气温 + 中文短语，下面三行键值（体感 / 湿度 / 风速），脚注给观测时刻；
 *  没有天气数据时退化成一行「暂时查不到天气」——不画空数值，也不猜。
 *  图标几何由 {@link envBubbleView} 带出，描边颜色跟气泡内的次级灰同色系。
 */
export declare function makeEnvBubble(rt: {
    h: typeof jsx;
}): (props: {
    state: EnvState;
    on: boolean;
}) => ReactNode;
