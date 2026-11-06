/**
 * 应用级快捷键的注册壳：软取 `shortcuts` 服务、按环境档案展开默认键位、失败只丢快捷键。
 *
 * DSH 的快捷键服务在旧宿主上可能不存在，注册也可能被拒（键位不合 Web 白名单、id 或键位冲突），
 * 两种情况都只让这一条命令消失，绝不拖垮插件加载。
 * 键位一律「一条命令一个键」：不按桌面/网页给不同默认值，要换去设置里换。
 * 同一个服务还提供「当前生效键帽」的读面：用户改绑后，展示必须跟着变，不能再念默认值。
 * @module dsh-pet/src/client/app-shortcut
 */
/** 一条物理键位：`primary` 在 macOS 展开成 Command，其余平台是 Control。 */
export interface ShortcutBinding {
    /** 物理键码（`KeyboardEvent.code`），如 `KeyL`。 */
    readonly code: string;
    readonly modifiers: readonly string[];
}
/**
 * 把绑定转成给人看的键帽（如 `Ctrl+Shift+L`）。
 *
 * 只给菜单与设置页展示用；`primary` 在 macOS 是 Command、其余平台是 Control。
 *
 * @param binding - 已声明的绑定。
 * @returns 以 `+` 连接的键帽文案。
 */
export declare function keycapOf(binding: ShortcutBinding): string;
/** 注册需要的上下文（只用到软取服务）。 */
export interface ShortcutHost {
    /** Cordis 的软取：拿不到返回 undefined。 */
    get?(name: string): unknown;
}
/**
 * 给默认键位的环境档案。
 *
 * **不含 `web:linux`**：DSH 对 Web 端快捷键有白名单，Linux 只放行几个固定组合，
 * 给它配普通组合会让整条注册被拒。那个环境的用户可以在设置里自己绑。
 */
export declare const SHORTCUT_PROFILES: readonly ["desktop:macos", "desktop:windows", "desktop:linux", "web:macos", "web:windows"];
/** 一条命令的定义：注册壳只关心这四样。 */
export interface AppShortcut {
    /** 命令 id，取 `<域>.<动作>`；重复注册会被服务拒绝。 */
    readonly id: string;
    /** 设置页里显示的标题；惰性求值，切语言后会重算。 */
    readonly label: () => string;
    readonly binding: ShortcutBinding;
    /** 触发时执行的动作。 */
    readonly run: () => void;
}
/**
 * 注册一条应用级快捷键。
 *
 * @param ctx - 客户端上下文。
 * @param shortcut - 命令定义。
 * @returns `registered` 表示是否真的登记成功；`dispose` 用于注销（失败时是空函数），
 *   拿到 `registered: false` 时调用方不能把 commandId 交给别处——指向不存在的命令会让对方注册抛错。
 */
export declare function registerAppShortcut(ctx: ShortcutHost, shortcut: AppShortcut): {
    registered: boolean;
    dispose: () => void;
};
/**
 * 读一条命令当前生效的键帽。
 *
 * 用户在「设置 → 快捷键」里改绑后，默认组合就不再是事实，展示必须问服务要。
 *
 * @param ctx - 客户端上下文。
 * @param id - 命令 id。
 * @returns 键帽（如 `Ctrl+Shift+L`）；没登记、被改到冲突、清空或宿主没有目录时 undefined。
 */
export declare function readShortcutKeycap(ctx: ShortcutHost, id: string): string | undefined;
/**
 * 订阅键位变化：改绑、恢复默认、清空都会触发。
 *
 * @param ctx - 客户端上下文。
 * @param listener - 变化回调；只关心「重新读一遍」，不接收快照。
 * @returns 注销函数；宿主没有目录时是空函数。
 */
export declare function subscribeShortcutKeycaps(ctx: ShortcutHost, listener: () => void): () => void;
