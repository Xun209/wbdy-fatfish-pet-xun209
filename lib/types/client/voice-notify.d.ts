import { type WorkStatusSnapshot, type WorkStatusState } from '../shared/work-status.ts';
import type { Pet } from '../shared/types.ts';
/**
 * 判定这一拍要不要念、念什么。
 *
 * 只取配置里的台词，不念 `task`：`task` 是任务详情（常是对话片段或文件路径），读出来像在
 * 念日志；这里要的是宠物自己说的一句话。
 *
 * @param snap - 工作状态快照；只用到 `state`。
 * @param pets - 当前拍平的宠物列表；取首只的台词组，多宠物只念一次。
 * @param prev - 上次念过的档位。
 * @returns 要念的台词；档位没变、档位不出声或该档位没配台词时返回 undefined。
 */
export declare function decideWorkStatusLine(snap: WorkStatusSnapshot, pets: readonly Pet[], prev: WorkStatusState | null): string | undefined;
/**
 * 消费一拍工作状态：档位变了、且新档位会弹系统通知时才念。
 *
 * @param snap - 刚读到的工作状态快照。
 */
export declare function speakWorkStatus(snap: WorkStatusSnapshot): void;
/** 清掉去重状态，让下一次进入同一档位还能念。 @internal */
export declare function resetSpokenState(): void;
