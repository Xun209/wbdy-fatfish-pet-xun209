import type { Feedback } from './actions.ts';
/** {@link runNotificationTest} 的依赖。 */
export interface NotificationTestDeps {
    /** 文案翻译。 */
    t: (key: string) => string;
    /** 把结果交给设置页显示；空文案表示清掉上一次的红字。 */
    report: (feedback: Feedback) => void;
}
/**
 * 跑一次「测试弹窗」。
 *
 * @param deps - 翻译与反馈回调。
 * @returns 无返回值；结果全部经 `report` 回传。
 */
export declare function runNotificationTest(deps: NotificationTestDeps): Promise<void>;
