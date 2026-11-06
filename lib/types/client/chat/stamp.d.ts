/**
 * 消息时间戳的展示格式。
 *
 * 纯函数：`now` 由调用方传入，不读时钟，便于测试。今天的消息只给时间，
 * 更早的补上日期——聊天记录跨天时，光看 `08:26:46` 分不清是哪天。
 * @module dsh-pet/src/client/chat/stamp
 */
/**
 * 时间戳 → 展示文本。
 *
 * @param ts - 消息时间戳（毫秒）；非正数视为没有时间。
 * @param now - 当前时刻（毫秒），由调用方注入。
 * @returns 今天 `HH:mm:ss`；昨天 `昨天 HH:mm:ss`；同年 `M月D日 HH:mm:ss`；跨年 `YYYY年M月D日 HH:mm:ss`。
 */
export declare function formatStamp(ts: number, now: number): string;
