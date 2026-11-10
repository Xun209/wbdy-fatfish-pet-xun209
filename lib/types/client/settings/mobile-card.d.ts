/**
 * 移动端效果卡（全局）：碰撞震动、倾斜控制重力、摇一摇抛出。
 *
 * 与物理卡分开：这三项都依赖手机才有的东西——振动马达、姿态 / 加速度传感器——而且在桌面浏览器上
 * 只会静默不生效；和「拖拽手感」那些数值放同一张卡里，会让人以为它们也能在桌面上调出效果。
 * 只改本地状态，随「保存」整包写入。
 * @module dsh-pet/src/client/settings/mobile-card
 */
import type { FunctionComponent } from 'react';
import type { PhysicsParams } from '../../shared/types.ts';
import type { SettingsRuntime } from './runtime.ts';
/** 移动端效果卡的输入。 */
export interface MobileCardProps {
    /** 保存中或配置未就绪时禁用全部控件。 */
    busy: boolean;
    /** 当前物理参数：三个开关都住在这段的可选键里。 */
    physics: PhysicsParams;
    /** 改物理参数的若干字段。 */
    onChange: (patch: Partial<PhysicsParams>) => void;
}
/**
 * 造移动端效果卡。
 *
 * @param rt - 注入的 react 能力与翻译函数。
 * @returns 卡片组件。
 */
export declare function makeMobileCard(rt: SettingsRuntime): FunctionComponent<MobileCardProps>;
