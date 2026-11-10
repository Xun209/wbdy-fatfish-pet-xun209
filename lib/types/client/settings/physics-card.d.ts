/**
 * 物理卡（全局）：重力、弹性、地面摩擦、抛掷力度，以及顶部反弹 / 宠物互撞两个开关。
 * 只改本地状态，随「保存」整包写入；浏览器保存后即时生效，桌面端由保存触发的 Helper 重启重读——
 * physics 在 sprite 构造时只读一次，所以这里不做即时写入。
 * 碰撞震动与两个体感开关依赖手机硬件，放在「移动端效果」卡里。
 * @module dsh-pet/src/client/settings/physics-card
 */
import type { FunctionComponent } from 'react';
import type { PhysicsParams } from '../../shared/types.ts';
import type { SettingsRuntime } from './runtime.ts';
/** 物理卡的输入。 */
export interface PhysicsCardProps {
    /** 保存中或配置未就绪时禁用全部控件。 */
    busy: boolean;
    /** 当前物理参数。 */
    physics: PhysicsParams;
    /** 改物理参数的若干字段。 */
    onChange: (patch: Partial<PhysicsParams>) => void;
}
/**
 * 造物理卡。
 *
 * @param rt - 注入的 react 能力与翻译函数。
 * @returns 卡片组件。
 */
export declare function makePhysicsCard(rt: SettingsRuntime): FunctionComponent<PhysicsCardProps>;
