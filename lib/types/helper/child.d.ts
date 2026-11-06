import type { BridgeHandler } from './bridge.ts';
/** 构造 HelperProcess 的选项；全部可选，缺省走 defaultLaunch 与 $DSH_HOME。 */
export interface HelperOptions {
    electronPath?: string;
    helperPath?: string;
    command?: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string | undefined>;
    restartDelayMs?: number;
    /** bridge 协议处理器：renderer 的每条请求（配置/余额/碎碎念/素材等）都经它应答 */
    bridgeHandler?: BridgeHandler;
}
/** 最小日志接口（宿主传 console 或统一日志器）；与 log-file 的 LoggerLike 同形。 */
type Logger = {
    info?: (message: string) => void;
    warn?: (message: string) => void;
    error?: (message: string) => void;
    debug?: (message: string) => void;
};
/**
 * spawn helper 用的环境变量（纯函数，可独立测试）。
 *
 * 必须删掉 `ELECTRON_RUN_AS_NODE`：宿主自己可能就是个 Electron 应用（DSH Desktop），它的 env 里可能
 * 带着这个变量，原样透传会让子进程以纯 Node 模式启动——`require('electron')` 直接 MODULE_NOT_FOUND，
 * helper 崩、守护循环重启、最终熔断，桌面模式彻底不再出现，且没有任何用户可见提示。
 * 为什么是删除而不是置空：Electron 只看这个变量存不存在，实测置 `''` 直接 abort（exit 134），置
 * `'0'` / `'false'` / `'1'` 都进纯 Node 模式；运行期再 delete 已经晚了，模块加载器在进程启动时就定了。
 */
export declare function helperSpawnEnv(hostPid: number, extra?: Record<string, string | undefined>): NodeJS.ProcessEnv;
/**
 * 组装 helper 的 argv；`--no-sandbox` 必须排在 app 路径之前，否则 Electron 会把它当应用参数。
 *
 * Electron 只认命令行，没有环境变量或配置文件能表达「禁用沙箱」；自定义 command 一律不注入，
 * 那不是真正的 Electron（测试替身与用户脚本靠这条排除）。
 * @param baseArgs - 默认启动参数，首项是 main.js 路径。
 * @param opts - `sandboxFallback` 为已退化到 `--no-sandbox`；`customCommand` 为调用方自带了可执行文件。
 * @returns 可直接交给 spawn 的新数组；未回退时与 `baseArgs` 等值。
 */
export declare function helperLaunchArgs(baseArgs: readonly string[], opts: {
    sandboxFallback: boolean;
    customCommand: boolean;
}): string[];
/** 一个 Helper 子进程的生命周期：启动、协议读写、停止、崩溃重启。 */
export declare class HelperProcess {
    readonly options: HelperOptions;
    readonly logger: Logger;
    private child?;
    private stopping;
    private restartTimer?;
    /** 连续崩溃计数（稳定运行 ≥3 分钟清零；达上限触发熔断） */
    private restartFailures;
    /** 最近一次 start() 的时间戳（稳定性判定基准） */
    private lastStartAt;
    /** stdout 按行缓冲（协议行按 \n 切分）。用 declare + 构造器赋值，避免类字段降级出外部 helper */
    private stdoutBuffer;
    /** 最近一次拉起的运行时身份（可执行文件路径与版本）：崩溃与熔断日志都要带它 */
    private launchIdentity;
    /** 是否已经因为「沙箱初始化失败」改用过 `--no-sandbox`（只退一次） */
    private hasSandboxFallbackApplied;
    /** 当前子进程有没有写过 stdout/stderr：有输出说明 JS 已经跑过，秒退就不能赖沙箱 */
    private hasChildOutput;
    constructor(options?: HelperOptions, logger?: Logger);
    /** 拉起子进程；已有子进程在跑或正在停止时直接返回现有句柄。 */
    start(): import('node:child_process').ChildProcess | undefined;
    /** stdout 按行缓冲：`dsh-pet-bridge:` 前缀整行 = 协议请求，其余 = 日志行。 */
    private onStdoutChunk;
    /** 处理一条协议请求：交给宿主 bridgeHandler，结果按 id POST 回 main.js 的回调服务器
     *  （cb 由请求行携带；不走 stdin —— Electron 主进程收不到 piped stdin） */
    private handleBridgeLine;
    /** 把应答发回 main.js：优先 POST 到请求行携带的 cb（本地回调服务器）；无 cb 时回写 stdin（低版本兼容）。 */
    private sendBridgeResponse;
    /** 停止 helper：发 SIGTERM 即返回，不等它退出。宿主退出 / 插件卸载路径用它——宿主马上就没了
     *  （Windows 有 job 对象、POSIX 有 helper 自己的 host-liveness 兜底）。
     *  停止后要立刻重启的场景必须用 stopAndWait()，否则新旧进程会短暂重叠。 */
    stop(reason?: string): void;
    /**
     * 停止 helper 并等它真正退出：只发一次 SIGTERM 就 spawn 新进程是不行的——Electron 收到 SIGTERM 后
     * 关窗、销毁 GPU/动画合成器是异步的（几百 ms 起），旧窗口（旧大小）还没消失、新窗口已经画出来，
     * 桌面上会短暂出现「两只宠物」。所以：① 先置 `stopping`（由 stop() 完成），守护逻辑不得把这次主动
     * 停止误判成崩溃去自动重启；② 只等 `exit` 不等 `close`——stdio 管道关闭远早于进程真正退出；③ 超时
     * （默认 3s）升级 SIGKILL，再给 1s 宽限，仍未退出就放弃等待，配置保存绝不能被无限挂住。
     */
    stopAndWait(reason?: string, timeoutMs?: number): Promise<void>;
    /** 沙箱初始化失败的特殊崩溃 → 改用 `--no-sandbox` 立刻重试一次，不计入退避与熔断额度。 */
    private applySandboxFallback;
    private scheduleRestart;
    /** 退避基值：DSH_PET_RESTART_BASE_MS（ms，>0）可调，默认 750。 */
    private resolveRestartBaseMs;
    /** 熔断阈值：DSH_PET_RESTART_MAX_FAILURES（次，>0）可调，默认 12。 */
    private resolveMaxFailures;
}
export {};
