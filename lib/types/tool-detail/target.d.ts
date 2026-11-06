import type { CopyLine } from './copy.ts';
/** 非空字符串（去首尾空白），否则 null——所有取参都先过它。 */
export declare function str(value: unknown): string | null;
/** 按候选顺序取第一个非空字符串：同名工具在不同版本里字段叫法可能不同（file_path / filePath / path）。 */
export declare function firstStr(args: Record<string, unknown>, keys: readonly string[]): string | null;
/** 文件类工具：`file_path` 是主流，`path` 是部分工具的写法。 */
export declare function fileTarget(args: Record<string, unknown>): string | null;
/** 网页：给主机名就够（完整 URL 又长又带查询串，气泡放不下也没必要）。 */
export declare function urlHost(args: Record<string, unknown>): string | null;
/** 网络搜索：`queries` 可能是数组（主流）或单数字符串，两种都认。 */
export declare function queryTarget(args: Record<string, unknown>): string | null;
/** 展示文件：`files` 是 `[{ path, description }]`，取第一个的 path（没有就取 description）。 */
export declare function filesTarget(args: Record<string, unknown>): string | null;
/**
 * 命令名长什么样：ASCII 字母开头、至少两个字符、只含字母数字与 `_ . -`。
 * 纯数字（`18016`）、中文串（`监听`）、符号（`==`）、开关（`-v`）、单字母变量（`x`）全部落选——
 * 它们几乎只会是字符串字面量或参数，而不是命令本身。
 */
export declare const COMMAND_LIKE: RegExp;
/** 子命令长什么样：单词形态（`status` / `log` / `push`），不接受开关与路径。 */
export declare const SUBCOMMAND_LIKE: RegExp;
/** 复合命令：`;` `|` `&&` `||` 换行一律不猜（引号内的竖线也会被判成复合，宁保守）。 */
export declare const COMPOUND_COMMAND: RegExp;
/**
 * 把命令行切成「词」：引号内的整体算一个词（`"C:\Program Files\node.exe"` 不会被空格劈开），
 * 引号本身丢弃，`;` / `|` 当分隔符。
 *
 * 这不是通用 shell 解析器，只为「找命令名」服务，所以只处理引号与分隔符，不解释变量、转义与管道。
 */
export declare function tokenizeCommand(command: string): string[];
/**
 * 目标上屏的长度上限（码点）：超过就整句换成该工具的氛围兜底。
 * 比 TARGET_MAX 小是有意的——路径压缩后仍超过这个数的（长文件名、长 grep 正则、长 query）
 * 硬塞进句子会撑破气泡（真实案例：`grep` 的 pattern 是 `WORK_STATE_GAP_MS|busyFlip|…`）。
 */
export declare const TARGET_DISPLAY_MAX = 20;
/** 解析 tool/call 的 arguments（JSON 字符串；个别版本可能直接给对象）→ 参数对象；失败或超大 → null。 */
export declare function parseArgs(raw: unknown): Record<string, unknown> | null;
/** 按码点截断（与 ./work-status 的 currentTaskFromTodo 同口径：超长留 TASK_TEXT_MAX 个 + 省略号）。 */
export declare function clip(text: string): string;
/** 随机取一句（同一句连着出现很假，这里按调用随机）。 */
export declare function pickLine(lines: readonly CopyLine[]): CopyLine;
/** 填占位符（`{target}` / `{cmd}` / `{tool}`）；未知占位符原样保留。 */
export declare function fill(line: CopyLine, vars: Readonly<Record<string, string>>): string;
/**
 * 目标压短：短路径原样，长路径只留文件名。
 * 统一成 `/` 是为了跨平台文案一致（Windows 的 `\` 在气泡里更占宽度也更难读）。
 */
export declare function compactTarget(raw: string, pathLike: boolean): string;
