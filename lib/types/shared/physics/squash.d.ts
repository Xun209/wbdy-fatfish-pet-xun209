/** 落地冲击速度 → 下压幅度（速度越大压得越狠），结果作为 startSquash 的 squash 参数。 */
export declare const landingSquash: (impactSpeed: number) => number;
/** Q 弹挤压曲线：u∈[0,1] 进度 → scaleY。
 *  下压段（0~0.45）ease-in 压缩，回弹段（0.45~1）easeOutBack 带回约 4% 过冲，两端共用同一曲线。 */
export declare const squashScale: (u: number, squash?: number) => number;
