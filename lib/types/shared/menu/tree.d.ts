import { type Animations, type Category } from '../types.ts';
import type { MenuBranch, MenuLeaf, MenuMoreItem, MenuNode } from './types.ts';
/** 该菜单动作在睡着时是否放行（两端共用：对话弹窗、待办面板、动作点播都是渲染端行为，宿主闸门拦不到）。 */
export declare const isSleepAllowedAction: (action: string | undefined) => boolean;
/** 「显示位置」子菜单：两端注入同一份，文案与设置页的显示位置下拉框一致。
 *  两端各写一份必然漂移，而这一项语义对称：桌面端用它把宠物送走，浏览器端用它送到桌面。
 *  「都不」是单向门（恢复入口是设置页），其余三个值都能从某一端改回来。
 *  右侧键帽由 `1`-`4` 数字键的同一份顺序派生，改顺序只改 {@link DISPLAY_ORDER}。 */
export declare const displayMenuBranch: () => MenuBranch;
/** 第三方菜单项统一收在这个一级菜单下（宿主自己的菜单项不进这里）。 */
export declare const MORE_MENU_LABEL = "\u66F4\u591A";
/** 从 /state 的 sections.menu.data 里读出本端要显示的第三方菜单项。
 *  target 等于本端身份或 both 才收；target 缺失或不认识时按 both 处理——老宿主没有这个字段，
 *  宁可在两端都显示，也不要让一个正在用的第三方菜单凭空消失。
 *  快照来自网络，字段一律按「可能不存在」处理：坏条目静默丢弃，不能让一条数据搞崩菜单。 */
export declare function readMenuItems(data: unknown, surface: 'web' | 'desktop'): MenuMoreItem[];
/** 「更多」一级菜单：把第三方菜单项拼成菜单树的一枝；没有第三方项时返回 null，菜单里不会出现空的「更多」。
 *  层级只按项数决定：某 owner 只有 1 项就直接平铺（少一次点击），2 项及以上才加 owner 这一层。
 *  同名不同 owner 的项允许共存，不做去重、编号或来源标注——文案由注册方负责。 */
export declare function buildMoreBranch(items: readonly MenuMoreItem[]): MenuBranch | null;
/** 把动画名包成叶子。 */
export declare const leaf: (anim: string) => MenuLeaf;
/** 由成品 animations 配置推导菜单树：一级「动作」→ 二级分类 → 三级动画名；空池与空分类自动省略。 */
export declare function buildMenuTree(animations: Animations): MenuNode[];
/** 该动画是否属于 noMirror 分类（文字类）：朝右镜像时点播前强制朝左，避免文字镜像。 */
export declare function isNoMirrorAnimation(categories: Category[], anim: string): boolean;
