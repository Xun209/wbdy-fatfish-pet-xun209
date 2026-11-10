/**
 * 打开或关闭点击音效。
 *
 * @param enabled - 成品配置里的 `clickSoundEnabled`。
 */
export declare function setClickSoundEnabled(enabled: boolean): void;
/** 播放点击音效；开关关闭、节流中或音频不可用时静默返回。 */
export declare function playClickSound(): void;
