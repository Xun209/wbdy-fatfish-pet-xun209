/** 面板挂载参数。 */
export interface TodoPanelOptions {
    /** 接口基址；桌面端可传绝对地址，缺省走同源前缀。 */
    baseUrl?: string;
    /** 点面板外面时调用；显隐由槽位决定，面板不自己收。 */
    onClose?: () => void;
    /** 这次按下的落点是否该让面板留着；两端各判各的命中层，面板不认识它们的类名。 */
    keepOpenOn?: (target: EventTarget | null) => boolean;
}
/** 面板句柄。 */
export interface TodoPanel {
    /** 面板根元素；调用方负责塞进自己的容器。 */
    el: HTMLElement;
    /** 关闭并清理（幂等）。 */
    dispose: () => void;
}
/**
 * 建一个待办面板并开始取数。
 *
 * @param options - 接口基址与关闭回调。
 * @returns 面板根元素与清理函数。
 */
export declare function createTodoPanel(options?: TodoPanelOptions): TodoPanel;
