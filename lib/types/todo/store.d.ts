import { type TodoRecord } from './types.ts';
import type { LoggerLike } from '../log-file.ts';
/** 待办文件名：落在插件用户数据目录下；宿主建库与设置页展示路径共用这一份。 */
export declare const TODO_FILE_NAME = "todos.json";
/** 一次更新的字段：没出现的键保持不变。 */
export interface TodoPatch {
    text?: string;
    dueAt?: number | null;
    done?: boolean;
}
/** 构造入参。 */
export interface TodoStoreOptions {
    /** 待办文件绝对路径（父目录不存在时自动创建）。 */
    file: string;
    /** 读取与写盘失败的告警出口。 */
    log: LoggerLike;
    /** 时间源；测试注入固定时钟。 */
    now?: () => number;
}
export declare class TodoStore {
    private readonly file;
    private readonly log;
    private readonly now;
    /** 串行队列：所有读写排队，避免读改写交错。 */
    private queue;
    /** 磁盘内容的进程内副本；null = 还没读过。 */
    private cached;
    /** 同一毫秒内建多条时的序号。 */
    private seq;
    constructor(options: TodoStoreOptions);
    /** 全部待办（排序后的副本）。 */
    list(): Promise<TodoRecord[]>;
    /**
     * 新建一条。
     *
     * id 由时间戳 + 进程内序号生成：重启后时间戳不同，旧 id 不会撞。
     *
     * @param input - 已校验的正文与到期时刻。
     * @returns 落盘成功后的记录副本。
     */
    create(input: {
        text: string;
        dueAt: number | null;
    }): Promise<TodoRecord>;
    /**
     * 更新一条。
     *
     * 改期限或重新打开都会清空 `lastRemindedAt`：提醒按新的到期时刻重新排期。
     *
     * @returns 更新后的记录；id 不存在返回 null。
     */
    update(id: string, patch: TodoPatch): Promise<TodoRecord | null>;
    /**
     * 删除一条。
     *
     * @returns 删掉的条数；0 表示本来就没有（幂等，不当成错误）。
     */
    remove(id: string): Promise<number>;
    /** 记下一次提醒时刻：只动 `lastRemindedAt`，不推进 `updatedAt`（那不是用户修改）。 */
    markReminded(id: string, at: number): Promise<void>;
    /** 队列：上一个任务结束后执行下一个；失败不影响后续任务。 */
    private run;
    private ensureLoaded;
    private readDisk;
    /** 原子写：临时文件写完再 rename，进程中途退出不会留下半个 JSON。 */
    private persist;
}
