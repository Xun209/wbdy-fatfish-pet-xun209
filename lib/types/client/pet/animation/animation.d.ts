import { type EndedCue, type FreezeCue } from './cues.ts';
import type { ReportableStatus } from '../../../shared/playback.ts';
import type { Animations } from '../../../shared/types.ts';
import type { WorkStatusSnapshot } from '../../../shared/work-status.ts';
import { type AssetLoader } from './asset-loader.ts';
export type { EndedCue, FreezeCue };
/** 动画链的依赖：全部用取值函数，避免捕获渲染期的快照。 */
export interface OwnAnimationDeps {
    /** A/B 双缓冲的 A 元素。 */
    videoA: () => HTMLVideoElement | null;
    /** A/B 双缓冲的 B 元素。 */
    videoB: () => HTMLVideoElement | null;
    /** 该宠物的成品配置：素材根、id 与动画池都从它取。 */
    cfg: () => {
        id: string;
        assetRoot?: string;
        animations: Animations;
    };
    /** 当前动画名。 */
    currentAnim: () => string;
    /** 工作状态叶子；未启用联动时为空。 */
    workStatus: () => WorkStatusSnapshot | null | undefined;
    /** 当前朝向，决定镜像。 */
    facing: () => 'left' | 'right';
    /** 上报第三方点播的真实状态。 */
    report: (playbackId: string, status: ReportableStatus, reason?: string) => void;
    /** 消费掉点播编号（清 React 状态，避免 effect 再跑一趟）。 */
    clearCuePlayback: () => void;
    /** 新动画已就位：组件在这里补 Q 弹与走位驱动。 */
    onFrontReady: (el: HTMLVideoElement) => void;
    /** 前台播完的判定结果；组件据此改 React 状态。 */
    onEnded: (cue: EndedCue) => void;
    /** 用户是否正按着宠物（拖拽期间不推进动画链）。 */
    isDragging: () => boolean;
    /** 挂载那一刻是否已被锁冻住。 */
    initiallyFrozen: boolean;
    /** 素材加载器；缺省用带超时的默认实现。 */
    loader?: AssetLoader;
}
/** 动画链对外能力。 */
export interface OwnAnimation {
    /** 换源播放；`cuePlaybackId` 非空表示这是一次第三方点播，要回执。 */
    switchTo: (next: string, once: boolean, cuePlaybackId: string | null) => void;
    /** 前台播完的判定；回执在这里上报，React 状态由组件按 cue 改。 */
    handleEnded: (event?: Event) => EndedCue;
    /** 把前台的循环关掉并挂上 ended：正在循环的档位动画靠它播完即停。 */
    stopLoopingFront: () => void;
    /** 交接下一次换源要用的完整地址（第三方点播的 url 形态）。 */
    setCueUrl: (url: string) => void;
    /** 冻结/解冻；只做播放控制与回执，气泡与动画选择交给组件。 */
    setFrozen: (next: boolean) => FreezeCue | null;
    /** 当前是否冻结（随机链与自动来源的门禁）。 */
    isFrozen: () => boolean;
    /** 前台元素；进度服务读它。 */
    frontVideo: () => HTMLVideoElement | null;
    /** 正在播的点播编号；自播动画为 `null`。 */
    playingPlayback: () => string | null;
    /** 卸载清理：中断在途请求、释放 blob，之后不可再用。 */
    dispose: () => void;
}
/**
 * 造动画链。
 *
 * @param deps - 元素、配置与回调。
 * @returns 换源、播完判定、冻结控制与清理。
 */
export declare function createOwnAnimation(deps: OwnAnimationDeps): OwnAnimation;
