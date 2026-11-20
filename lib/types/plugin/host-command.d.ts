/**
 * 斜杠命令注册：宿主 commands 服务是软依赖。
 *
 * 服务不在场时只丢这一条命令（并留一行日志），其余功能照常；
 * 绝不因为一个可选服务缺失就让整条插件行失败。
 * @module dsh-pet/src/host/plugin/host-command
 */
import type { HostContext } from './context.ts';
/** 宿主命令服务的注册项（形状随宿主演进，这里只用到 name / description / handler）。 */
export interface CommandSpec {
    /** 命令名（斜杠后那段）。 */
    name: string;
    /** 命令说明。 */
    description?: string;
    /** 输入提示。 */
    input?: {
        hint?: string;
    };
    /** 执行体。 */
    handler: (args: never) => unknown;
}
/**
 * 注册一条斜杠命令；清理函数由 ctx.effect 收集。
 * @param ctx - 宿主上下文。
 * @param spec - 命令定义。
 * @param label - effect 标签（卸载时的可读名字）。
 */
export declare function registerCommand(ctx: HostContext, spec: CommandSpec, label: string): void;
