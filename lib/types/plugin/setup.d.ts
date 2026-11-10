import { type ConfigPaths } from '../config.ts';
import { type FileLogger, type LoggerLike } from '../log-file.ts';
import { MenuRegistry } from '../menu.ts';
import { PlaybackStore } from '../playback.ts';
import { PollStateStore } from '../state.ts';
import { WorkStatusStore } from '../work-status.ts';
import type { StandaloneWhisperPolicy } from '../whisper-policy.ts';
/** 装配期需要的宿主上下文：只有 logger / effect / provide 三处能力。 */
export interface HostSetupContext {
    /** 宿主日志（可能已被 standalone 换成文件 logger）。 */
    readonly logger?: LoggerLike;
    /** 注册随插件卸载自动清理的副作用。 */
    effect(setup: () => (() => void) | void, label: string): void;
    /** 对外提供 Cordis 服务。 */
    provide(name: string, value: unknown): void;
}
/** 装配产物：apply 后续逻辑与路由层共用的对象。 */
export interface HostSetup {
    /** 本插件的数据根（配置与用户素材都收敛于此） */
    readonly userRoot: string;
    /** 插件日志出口（文件 + 终端） */
    readonly log: FileLogger;
    /** 配置路径集 */
    readonly configPaths: ConfigPaths;
    /** 用户主配置路径 */
    readonly userConfigPath: string;
    /** 文件宠物目录 */
    readonly petConfigDir: string;
    /** 用户动画目录 */
    readonly thumbUserRoot: string;
    /** 用户表情包目录 */
    readonly memesUserRoot: string;
    /** 表情包目录链 */
    readonly memeDirsFor: (assetRoot: string) => string[];
    /** 软取宿主可选服务 */
    readonly optionalService: (name: string) => unknown;
    /** 独立模式的碎碎念授权策略 */
    readonly standaloneAiPolicy: () => StandaloneWhisperPolicy | undefined;
    /** 轮询快照 */
    readonly state: PollStateStore;
    /** 第三方菜单注册表 */
    readonly menuRegistry: MenuRegistry;
    /** 播放记录表 */
    readonly playback: PlaybackStore;
    /** 工作状态快照 */
    readonly workStatus: WorkStatusStore;
    /** 外部写入的固定会话 id */
    readonly EXTERNAL_WORK_SESSION: string;
    /** 推进外部写入序号 */
    readonly nextExternalWorkSeq: () => number;
}
/**
 * 创建宿主运行期对象。
 * @param ctx - 宿主上下文（apply 收到的那一个）。
 * @returns 日志、路径、store 与两个工具函数。
 */
export declare function createHostSetup(ctx: HostSetupContext): HostSetup;
