/**
 * 「吃白饭」的常量：节奏参数、台词池与覆盖层样式。
 *
 * 台词与节奏是玩法的一部分，不开放给配置；用哪 5 段动画由 animations.baifan 决定，
 * 地址在 ./assets 里按「素材根 + 动画名」拼，与本插件其他动画同一条路。
 * @module dsh-pet/src/client/baifan/constants
 */
/** 接口基址（与页面同源）。 */
export declare const ROUTE = "/dsh-pet-7340";
/** 菜单 owner：与原扩展同名，装过老扩展的用户升级后不会多出一份重复项。 */
export declare const OWNER = "dsh-pet-baifan";
/** 菜单项文案；宿主按文案回传点击，属于协议的一部分。 */
export declare const LABEL = "\u5403\u767D\u996D";
/** 玩法 id：对应配置里的 animations.<id>。 */
export declare const ACTIVITY = "baifan";
/** 玩法自带的图片素材（包内 assets/pic/baifan）：米饭与空碗，不是动画名，不随配置变。 */
export declare const PIC: {
    readonly bowlFull: string;
    readonly bowlEmpty: string;
    readonly riceBall: string;
};
/**
 * 全部可调节奏。
 *
 * 坐标一律用**视口像素**算，只在调接口时归一化成 0–1——pose() 回的是归一化中心点，
 * 而米饭、气泡要按像素画在页面上，两边来回换算一次就够。
 * 注意这里没有「素材多长」：动画结束一律问 GET /playback/{id} 的回执，不吃定时器。
 */
export declare const CFG: {
    readonly groundOffset: 26;
    readonly prepMs: 2100;
    readonly travelMs: 5000;
    readonly runSpeed: 290;
    readonly patrolSpeedRatio: 0.72;
    readonly spawnMs: 4200;
    readonly bowlRatio: 0.38;
    readonly maxRice: 2;
    readonly eatPx: 40;
    readonly arrivePx: 12;
    readonly tripMaxMs: 4500;
    readonly sideWatchMs: 400;
    readonly idleMs: 140;
    readonly animLeadMs: 300;
    readonly backTurnPenalty: 1.8;
    readonly pollLatencyMs: 1000;
    readonly preRollSec: 0.35;
    readonly lockTtl: 30000;
    readonly lockWaitMs: 25000;
    readonly renewMs: 6000;
    readonly flyFallbackMs: 5200;
    readonly waitBudgetMs: 30000;
    readonly httpTimeoutMs: 20000;
    readonly bubbleMs: 2400;
    readonly footRatio: 0.894;
    readonly mouthRatio: 0.63;
    readonly mouthDx: -0.03;
    readonly refWidth: 498;
};
/** 台词池：只在合适的节拍上说一句，其余时间闭嘴，否则气泡会糊在演出上。 */
export declare const LINES: {
    readonly start: readonly ["开饭了——", "白饭时间到！", "饿了饿了饿了"];
    readonly down: readonly ["等我下去……", "下面有饭香", "让一让，我下去了"];
    readonly expect: readonly ["饭呢？饭呢？", "快点快点", "……还没好吗"];
    readonly drop: readonly ["掉下来了！", "接住！", "来了来了"];
    readonly bowl: readonly ["碗饭最香", "这个碗我要了", "再来一碗"];
    readonly ball: readonly ["饭团饭团", "一口一个", "捏得刚好"];
    readonly full: readonly ["嗝——还能吃！", "这点不够塞牙缝", "再来十份"];
};
/** 样式表去重标记（与 dsh-pet 的 data-plugin-css 约定一致）。 */
export declare const STYLE_TAG = "dsh-pet-baifan/baifan.css";
/** 覆盖层根节点 id，重复挂载时按它摘掉旧的。 */
export declare const ROOT_ID = "dsh-pet-baifan-root";
/** 覆盖层与米饭、分数的样式。 */
export declare const CSS: string;
