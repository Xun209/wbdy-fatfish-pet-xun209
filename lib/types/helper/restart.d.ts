/**
 * 重启策略：退避间隔、熔断条件、「跑稳了没有」的判定，以及崩溃现场的可读化（退出码含义与处理建议）。
 *
 * 不启动也不停止进程，只给 ./child 提供纯计算的决策与文案。
 * 必须始终成立：退避单调不减，熔断后不再自动重试。
 * @module dsh-pet/src/host/helper/restart
 */
/** 停止 helper 的等待上限（ms）：超过就升级 SIGKILL。 */
export declare const HELPER_STOP_TIMEOUT_MS = 3000;
/** SIGKILL 之后还给进程多久退出（ms）；到点仍未退出就放弃等待，绝不无限挂住调用方。 */
export declare const HELPER_STOP_GRACE_MS = 1000;
/** 稳定运行判定阈值：Helper 连续无崩溃运行 ≥ 3 分钟后，重启失败计数清零。 */
export declare const HELPER_STABLE_MS: number;
/**
 * 指数退避：第 n 次（0 起）失败后等待 base × 2ⁿ，封顶 30s。
 * 默认 base 750ms，序列 750 → 1500 → 3000 → … → 30000。
 */
export declare function restartBackoffDelayMs(consecutiveFailures: number, baseMs?: number): number;
/** 熔断判定：连续崩溃 ≥ limit（默认 12，按默认退避累计约 3 分钟）次后不再自动重启。 */
export declare function shouldCircuitBreak(consecutiveFailures: number, limit?: number): boolean;
/** 稳定运行判定：距上次拉起 ≥ HELPER_STABLE_MS 视为一次「成功运行」，可清零计数。 */
export declare function helperRunIsStable(elapsedMs: number): boolean;
/**
 * 拼一段「退出状态」日志片段：`code=3221225477 (0xC0000005 访问违例), signal=null`。
 *
 * 十六进制形态与含义只在这里出现一次，崩溃日志与熔断日志共用，避免两处各拼一份而漂移。
 * @param code - 退出码；null 表示被信号终止。
 * @param signal - 终止信号；正常退出为 null。
 * @returns 可直接拼进日志的一行文本。
 */
export declare function describeExit(code: number | null, signal: NodeJS.Signals | null): string;
/**
 * 熔断时给用户的处理建议。
 *
 * Windows 与 Linux 的病因完全不同：Windows 上「配置 DISPLAY」是无效建议（曾误导过装了虚拟显示器的用户），
 * 能起作用的只有换运行时或指向现成的可执行文件；Linux 才谈显示环境。
 * @param platform - 进程平台；由调用方传入，本函数不读全局。
 * @returns 一句面向用户的建议文本（含可复制的环境变量名）。
 */
export declare function crashLoopAdvice(platform: NodeJS.Platform): string;
/**
 * 是否值得改用 `--no-sandbox` 重试一次。
 *
 * 判定必须收紧，否则会把真正的崩溃吞成「换参数」：退出码 0x80000003、stdout/stderr 一行没有、
 * 5s 内就退、只试一次、自定义 command 不猜。沙箱建不起来的机器是确定性失败，重试 12 次只会把同一行
 * 日志刷 12 遍再熔断；真崩的（有输出 / 跑了一阵）照旧走退避与熔断，不会被掩盖。
 * 宿主侧已对 GPU 进程沙箱做过一层窄开关，本条处理的是更早、连 JS 都没跑起来的那个阶段。
 * @param input - 本次退出现场；`sandboxOptOut` 由调用方按环境给出，纯函数不读全局。
 * @returns true 表示下一次 start() 应在参数最前面加 `--no-sandbox`。
 */
export declare function shouldFallbackToNoSandbox(input: {
    code: number | null;
    sawOutput: boolean;
    ranMs: number;
    alreadyApplied: boolean;
    customCommand: boolean;
    sandboxOptOut: boolean;
}): boolean;
/** 退避基值（ms）：默认 750 与旧版首延一致，DSH_PET_RESTART_BASE_MS 可调。 */
export declare const RESTART_BASE_MS_DEFAULT = 750;
/** 熔断阈值（连续崩溃次数）：默认 12，DSH_PET_RESTART_MAX_FAILURES 可调。 */
export declare const RESTART_MAX_FAILURES_DEFAULT = 12;
/** 非负整数 env 解析（非法/未设回落默认），供重启参数读取共用。 */
export declare function envPositiveInt(value: string | undefined, fallback: number): number;
/**
 * 等子进程真正退出：已经退出（exitCode / signalCode 有值）→ 立即 resolve，不挂监听；只等 `exit`，
 * `close` 只代表 stdio 管道关闭，远早于进程真正退出；到 timeoutMs 调 onTimeout()（调用方升级
 * SIGKILL），再给 HELPER_STOP_GRACE_MS 宽限；宽限到点仍未退出就 resolve——调用方绝不能被无限挂住。
 */
export declare function waitForChildExit(child: import('node:child_process').ChildProcess, timeoutMs: number, onTimeout: () => void): Promise<void>;
