/**
 * 气泡单槽：余额、说话、工作状态三种气泡的显隐、停留计时与优先级选择。
 * 不负责何时点亮与动画联动：tick 判定、抽动画、打日志都在 PetCard；也不负责外观，哑组件在 client/bubble.ts。
 * 依赖注入的 react 与两个气泡组件；三个停留计时器都归本模块清理。
 * 不变量：同一时刻只渲染一个气泡，优先级依次为终态任务、说话、余额、非终态任务。
 * @module dsh-pet/src/client/pet/card/bubble-slots
 */
import { type BalanceState } from '../../../shared/balance/index.ts';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import type * as ReactNS from 'react';
import type { jsx } from 'react/jsx-runtime';
/** 当前该挂哪个气泡；`none` 表示哪个条件都不成立。 */
export type BubbleSlot = 'todo' | 'work-terminal' | 'whisper' | 'balance' | 'work' | 'none';
/** 优先级判定的输入：全部是渲染期的既成事实，判定本身不产生副作用。 */
export interface BubbleSlotInput {
    /** 待办面板是否打开；打开时独占槽位，其余气泡一律让位。 */
    todoOn: boolean;
    /** 工作状态是否为终态（success / error）。 */
    workTerminal: boolean;
    /** 工作气泡是否点亮。 */
    workOn: boolean;
    /** 工作气泡文本。 */
    workText: string | null;
    /** 配置是否启用工作状态联动。 */
    workStatusEnabled: boolean;
    /** 说话气泡是否点亮。 */
    whisperOn: boolean;
    /** 说话气泡文本。 */
    whisperText: string | null;
    /** 余额气泡是否点亮。 */
    balanceOn: boolean;
    /** 余额数据是否已拉到；null 表示尚未拉到。 */
    balanceAvailable: boolean;
    /** 配置是否启用余额。 */
    balanceEnabled: boolean;
    /** 本次余额是否手动请求；手动请求不受开关门控。 */
    balanceManual: boolean;
}
/**
 * 决定当前挂哪个气泡。
 *
 * 终态任务只活 10s，所以不让位；非终态常驻，让位 10s 没有损失。
 *
 * @param input - 三种气泡的显隐与开关。
 * @returns 命中的槽位；都不成立时为 `none`。
 */
export declare function decideBubbleSlot(input: BubbleSlotInput): BubbleSlot;
/**
 * 余额气泡的可翻页数。
 *
 * 页数规则归 shared（与每页内容同源），这里只补一个「还没有结果」的兜底。
 *
 * @param balance - 最近一次余额结果；`null` 表示这一拍还没有数据。
 * @returns 页数，至少 1。
 */
export declare function balancePageCount(balance: BalanceState | null): number;
/** 余额气泡组件；props 与 `client/bubble.ts` 的 BalanceBubble 一致。 */
export type BalanceBubbleComponent = (props: {
    state: BalanceState;
    on: boolean;
    index: number;
    onCycle: () => void;
}) => ReactNode;
/** 说话气泡组件；配图二选一，props 与 `client/bubble.ts` 的 WhisperBubble 一致。 */
export type WhisperBubbleComponent = (props: {
    text: string;
    image?: string;
    url?: string;
    assetRoot?: string;
    on: boolean;
}) => ReactNode;
/** 注入的 react 能力。 */
export interface BubbleSlotsRuntime {
    /** 创建元素。 */
    h: typeof jsx;
    /** 状态。 */
    useState: <T>(init: T) => [T, Dispatch<SetStateAction<T>>];
    /** 引用。 */
    useRef: <T>(initial: T) => ReactNS.MutableRefObject<T>;
    /** 副作用；用于卸载时清计时器。 */
    useEffect: (effect: ReactNS.EffectCallback, deps?: ReactNS.DependencyList) => void;
}
/** 待办面板气泡组件；props 与 `client/todo-bubble.ts` 的 TodoBubble 一致。 */
export type TodoBubbleComponent = (props: {
    on: boolean;
    onClose: () => void;
}) => ReactNode;
/** 三种气泡组件。 */
export interface BubbleComponents {
    /** 余额气泡。 */
    balanceBubble: BalanceBubbleComponent;
    /** 待办面板气泡。 */
    todoBubble: TodoBubbleComponent;
    /** 说话气泡。 */
    whisperBubble: WhisperBubbleComponent;
}
/** 每次渲染由 PetCard 提供的视图输入。 */
export interface BubbleSlotsInput {
    /** 最近一次余额结果。 */
    balance: BalanceState | null;
    /** 配置是否启用余额。 */
    balanceEnabled: boolean;
    /** 本次余额是否手动请求。 */
    balanceManual: boolean;
    /** 配置是否启用工作状态联动。 */
    workStatusEnabled: boolean;
    /** 工作状态是否处于终态。 */
    workTerminal: boolean;
    /** 说话气泡配图的素材根。 */
    assetRoot?: string;
}
/** 气泡单槽对外的读写面。 */
export interface BubbleSlots {
    /** 点亮余额气泡并回到第一页，重置停留计时。 */
    showBalance(): void;
    /** 点余额气泡翻页，并重置停留计时。 */
    cycleBalance(): void;
    /** 点亮说话气泡；duration 为 0 时不改动当前气泡，undefined 用默认时长。 */
    showWhisper(text: string, parts: {
        image?: string;
        url?: string;
    }, duration?: number): void;
    /** 收起说话气泡；不碰动画与另两种气泡。 */
    clearWhisper(): void;
    /** 更新工作气泡文本，显隐不动。 */
    updateWorkText(text: string | null): void;
    /** 点亮工作气泡；terminal 决定 10s 后自动收起，非终态常驻。 */
    lightWork(terminal: boolean): void;
    /** 收起工作气泡但保留文本。 */
    hideWork(): void;
    /** 回空闲：收起工作气泡并清文本。 */
    resetWork(): void;
    /** 打开待办面板：它独占槽位，其余气泡让位。 */
    showTodo(): void;
    /** 收起待办面板，按原优先级恢复其余气泡。 */
    hideTodo(): void;
    /** 开关待办面板：已开则收起，供快捷键使用。 */
    toggleTodo(): void;
    /** 按优先级渲染当前该挂的气泡；无气泡时为 null。 */
    node(): ReactNode;
}
/**
 * 制造气泡单槽的 hook，每个 PetCard 调一次。
 *
 * @param rt - 注入的 react 能力。
 * @param components - 余额与说话气泡组件。
 * @returns 接收视图输入的 hook；钩子内部的状态与计时器随卡片卸载一并清理。
 */
export declare function createBubbleSlots(rt: BubbleSlotsRuntime, components: BubbleComponents): (input: BubbleSlotsInput) => BubbleSlots;
