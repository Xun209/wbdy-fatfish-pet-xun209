/** 过阻尼弹簧单轴速度步进：调用方随后 x += v*dt。
 *  power = 总力度（K/C 同乘：系统形态不变，收敛速度快 p 倍，即更跟手或更松）。 */
export declare const springStep: (v: number, x: number, target: number, dt: number, power?: number) => number;
/** 软钳速：cap×(1-e^(-s/cap))，任意速度下单调可区分、渐近不超过 cap。
 *  抛掷指令与拖拽甩抛走同一条限速，手感一致。 */
export declare const softClampSpeed: (speed: number) => number;
