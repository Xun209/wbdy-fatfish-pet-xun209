/**
 * 睡觉状态（host 半侧内存态）：睡下的宠物从自动来源里摘出去，并拒绝手动触发。
 *
 * 与占用锁（./lock）同一层：都是「这只宠物此刻不归日常流程管」的会话状态，重启即空、不进配置。
 * 区别：锁是第三方租约、有 TTL；睡觉是用户意图、没有期限，只有唤醒才结束。
 * 不负责渲染：叶子里的三段动画名是渲染端唯一真相，播放与时机由前端执行。
 * 必须始终成立：进睡时三段名字一起写定；醒来只清状态，不留半套。
 * @module dsh-pet/src/host/sleep
 */
/** 一套睡觉动作的名字（宿主挑好写进叶子，渲染端照此播 start → loop → end）。 */
export interface SleepSetNames {
    /** 入睡过渡（播一次） */
    readonly start: string;
    /** 睡眠循环（无限播） */
    readonly loop: string;
    /** 醒来过渡（播一次） */
    readonly end: string;
}
/** 写进 `pets.<id>.sleep` 的载荷；`sleeping: false` 也要写，渲染端靠它收尾。 */
export type SleepLeafData = ({
    sleeping: true;
} & SleepSetNames) | {
    sleeping: false;
};
/**
 * 从池里随机挑一句；空池返回 undefined，调用方据此不弹气泡。
 *
 * 默认文案只存在于内置配置 `assets/config.jsonc`：合并层对缺失/非法字段都回落到它，
 * 所以正常安装下池永远非空。真的空了说明配置损坏——这时宁可不说话，也不在代码里再抄一份文案。
 */
export declare function pickSleepText(pool: readonly string[]): string | undefined;
/** 条目级睡觉文案与情景提示词的解析结果；空池/空串 = 没配，由调用方决定不弹/不拼。 */
export interface SleepTexts {
    start: string[];
    end: string[];
    refuse: string[];
}
/** 把条目配置里的睡觉文案收窄成可用池（合并层已填好默认值，这里只做类型收窄）。 */
export declare function sleepTextsOf(conf: Record<string, unknown>): SleepTexts;
/**
 * 从成品 `animations.sleep` 里挑一套：外层整套随机，三段各自在候选数组里随机挑一个。
 *
 * 三段必须来自同一套（否则蹲着入睡、趴着醒来），所以整轮挑选只有一次随机数决定套。
 * @param animations - 成品动画配置（可能来自任何一个条目）。
 * @param roll - 随机源，测试注入固定值。
 * @returns 选中的三段名字；没有可用套时 null（调用方据此拒绝入睡）。
 */
export declare function pickSleepNames(animations: unknown, roll?: () => number): SleepSetNames | null;
/** 睡觉状态表（一个插件实例一个；进程内内存态，宿主重启即醒）。 */
export declare class SleepStore {
    /** petId → 本次睡觉挑中的那套名字。 */
    private readonly sets;
    /** 状态变化时同步叶子（进睡 / 醒来 / 批量唤醒都走它）。 */
    private readonly onChange;
    constructor(opts?: {
        onChange?: (petId: string, data: SleepLeafData) => void;
    });
    /** 这只宠物此刻是否在睡。 */
    sleeping(petId: string): boolean;
    /** 本次睡觉挑中的那套名字；没睡时 null。 */
    setOf(petId: string): SleepSetNames | null;
    /**
     * 进睡。已经在睡时保持原套、不重写叶子——重复调用（接口被连点、命令与菜单同时触发）
     * 不该把动画从头放一遍。
     * @returns 这次是否真的进入了睡觉状态。
     */
    enter(petId: string, set: SleepSetNames): boolean;
    /**
     * 醒来。
     * @returns 这次是否真的从睡眠状态退出（没在睡 = 幂等空操作）。
     */
    wake(petId: string): boolean;
    /** 全部唤醒（插件卸载 / 桌面 Helper 重启路径）：否则渲染端要一直停在睡姿。 */
    wakeAll(): void;
    /** 当前是否有任意宠物在睡（余额全局拉取据此决定要不要整拍跳过）。 */
    anySleeping(): boolean;
    /** 在睡的宠物 id（测试与日志用；顺序不保证）。 */
    ids(): string[];
}
