import { type ChatPanelRuntime } from './panel.ts';
/** 注册对话标签需要的最小上下文。 */
export interface PetChatTabHost {
    /** Cordis 的软取服务：拿不到返回 undefined。 */
    get?(name: string): unknown;
    /** 插槽注册表。 */
    slots: {
        /** 等到某个插槽被声明后再执行注册（与 shell.overlay 同一套等待方式）。 */
        inject(name: string, generator: () => Generator<unknown, void, unknown>): void;
        /**
         * 注册一个挂载点。
         *
         * keyed 插槽按 `key` 分派（值即标签类型定义的 `id`）；写成 `id` 会让侧栏查不到正文，
         * 落到「这类内容还没有可用的查看方式」的兜底文案。
         */
        register(registration: {
            name: string;
            key: string;
            order: number;
        }, component: () => unknown): () => void;
    };
}
/**
 * 打开右侧栏的对话标签。
 *
 * 侧栏导航面可能比注册表晚到，取不到就什么都不做。快捷键的触发动作走这里，
 * 这样「标签类型」这个事实仍只在 registerPetChatTab 里出现一次。
 *
 * @param ctx - 客户端上下文（只用到软取）。
 */
export declare function openPetChatTab(ctx: PetChatTabHost): void;
/**
 * 注册对话标签（标签类型 + 正文插槽 + 样式）。
 *
 * @param ctx - 客户端上下文。
 * @param rt - 注入的 react 能力。
 * @param options.commandId - 快捷键命令 id；只有命令真的登记成功才传，指向不存在的命令会让侧栏抛错。
 * @returns 注销标签类型并释放样式的函数；正文插槽交给 slots.inject 的作用域随插件卸载。
 */
export declare function registerPetChatTab(ctx: PetChatTabHost, rt: ChatPanelRuntime, options?: {
    commandId?: string;
}): () => void;
