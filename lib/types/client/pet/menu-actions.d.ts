import type { MenuLeaf } from '../../shared/menu.ts';
import type { Animations } from '../../shared/types.ts';
/** 菜单派发的依赖。 */
export interface MenuActionDeps {
    /** 宠物 id：上报、点播与显示位置切换都要带。 */
    petId: string;
    /** 该宠物的动画池（移动池、分类镜像规则都读它）。 */
    animations: () => Animations;
    /** 当前朝向是否为右（文字类动画强制朝左前先看它）。 */
    isFacingRight: () => boolean;
    /** 把朝向改成左，并同步给换源用的事实值。 */
    faceLeft: () => void;
    /** 试发起一次走位；`true` = 占用中，`false` = 无法移动，字符串 = 动作名。 */
    tryMove: (preferredName?: string) => boolean | string;
    /** 停掉走位与位置跟随。 */
    stopMove: () => void;
    /** 停掉抛掷飞行。 */
    stopThrow: () => void;
    /** 提交一次自播切换（once 语义）。 */
    playOnce: (anim: string, playbackId: string | null) => void;
    /** 清掉会话位置，回到配置角落。 */
    resetPosition: () => void;
    /** 打开对话弹窗。 */
    openChat: () => void;
    /** 打开待办面板。 */
    openTodo: () => void;
    /** 上报点播回执。 */
    report: (playbackId: string, status: 'failed', reason: string) => void;
    /** 显示位置切换后，把宿主回的成品聚合交给容器重渲染。 */
    applyMerged: (merged: Record<string, Record<string, unknown>>) => void;
    /** 动作失败时打一行告警（文案自带原因）。 */
    warn: (message: string) => void;
    /** 是否在睡：睡着时任何「打扰类」动作只弹拒绝台词、不执行。缺省视为醒着。 */
    sleeping?: () => boolean;
    /** 是否被占用锁冻结：锁的语义是把控制权交给第三方，此时睡觉闸门让路。缺省视为未持锁。 */
    locked?: () => boolean;
    /** 弹一句气泡（拒绝台词用，不换动画）。缺省 = 不弹。 */
    say?: (text: string) => void;
    /** 睡觉拒绝台词池（条目级配置）。缺省 = 静默拒绝，不弹文字。 */
    sleepRefuseTexts?: () => string[];
}
/** 睡着时仍然放行的菜单动作由 shared/menu 的 isSleepAllowedAction 判定（两端共用一份）。 */
/** 菜单动作派发器。 */
export interface MenuActions {
    /**
     * 执行一个菜单叶子。
     *
     * @param leaf - 菜单叶子：内置动作或一个待点播的动画。
     * @param playbackId - 本次点播编号；自播动画不传。
     * @param keepFacing - 跳过「文字类强制朝左」的镜像修正，显式朝向优先。
     * @param hostInstruction - 这条是宿主写进 `pets.<id>.anim` 的显式指令（不是用户点菜单）：
     *  渲染端不判睡觉，放不放行由宿主闸门按「锁优先」决定。
     */
    run: (leaf: MenuLeaf, playbackId?: string, keepFacing?: boolean, hostInstruction?: boolean) => void;
}
/**
 * 造菜单派发器。
 *
 * @param deps - 宠物标识、动画池与各种副作用回调。
 * @returns 单一入口 {@link MenuActions.run}。
 */
export declare function createMenuActions(deps: MenuActionDeps): MenuActions;
