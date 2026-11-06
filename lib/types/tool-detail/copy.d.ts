/** 句子里可用的占位符：{target} 目标名、{cmd} 命令名。 */
export type CopyLine = string;
/** 从解析后的参数里取「目标」（文件名 / 搜索词 / 域名…）；取不到 → null。 */
type TargetPicker = (args: Record<string, unknown>) => string | null;
/** 只描述「怎么取目标」，不含任何文案（文案全部在下面的表里）。 */
export interface ToolRule {
    pick: TargetPicker;
    /**
     * 目标是不是路径：只有路径才做「太长只留文件名」的压缩。
     * 描述、搜索词、域名这类文本不该被 `/` 切开。
     */
    path?: boolean;
}
/** 一个工具的文案：3 句带 {target} 的说法 + 目标太长时的一句纯氛围兜底。 */
export interface ToolCopy {
    readonly lines: readonly CopyLine[];
    /** 目标超过 TARGET_DISPLAY_MAX 时用：不出现文件名与工具名（气泡是氛围，不是信息面板） */
    readonly short: CopyLine;
}
/** 工具 → 文案。没列在这里的工具走 UNKNOWN_TOOL_LINE。 */
export declare const TOOL_COPY: Readonly<Record<string, ToolCopy>>;
/** 未知工具：只说一句氛围话，不报工具名（`str_replace_editor` 这种名字上屏很怪）。 */
export declare const UNKNOWN_TOOL_LINE: CopyLine;
/** 兜底：没进表的命令（npm / python / node / tsc / eslint / docker…），短命令名会上屏。 */
export declare const COMMAND_FALLBACK: readonly CopyLine[];
/** 兜底：命令名本身太长（如 Get-NetTCPConnection）时用，不带名字。 */
export declare const COMMAND_NAME_TOO_LONG: CopyLine;
/** 命令 / 「命令 子命令」→ 3 句候选（键一律小写，别名共用同一组）。 */
export declare const COMMAND_COPY: Readonly<Record<string, readonly CopyLine[]>>;
/**
 * 语义已由别处表达、不该进气泡的工具：
 * `todo_write` 的文案本身就是气泡正文（写它等于自己盖自己）；`ask_user_question` 与 goal 系已有
 * 专门档位（waiting / success / error）；`exit_plan_mode` 是纯内部调度。
 * 这些报出来不是重复就是噪音。
 */
export declare const SILENT_TOOLS: ReadonlySet<string>;
/** 取目标的方式（与文案表按工具名关联；pwsh 不在这里，它走命令表）。 */
export declare const TOOL_RULES: Readonly<Record<string, ToolRule>>;
export {};
