/**
 * 设置面板导航图标补丁：把「桌宠配置」那一行的兜底齿轮换成指定图标。
 * DSH 的导航图标按分区 id 硬编码白名单，且私有、外部拿不到引用，只能在 DOM 层做。
 * 只打 `data-*` 标记并用 `::before` + mask 画字形，不动 DOM 结构，否则 React 会对被替换的节点 removeChild 崩。
 * mask 是 data URI，即独立图像文档：宿主 0.2.2 起图标改成 sprite 引用（`<use>` 指向页面里的 `<symbol>`），
 * 必须先展开成自包含 SVG，否则 mask 全透明、齿轮又被盖住，那一行直接变成零图标。
 * sprite 由宿主在挂载后才注入，装配这一刻取不到，所以字形推迟到认出面板时才解析。
 * 认行只能靠标题文本：投影到 DOM 的只有 label，而 account 行条件出现、位置会漂，不能用 `:nth-child`。
 * 降级：缺 document / MutationObserver、取不到字形时不装（齿轮留着），认不出那一行时什么都不做，只告警。
 * @module dsh-pet/src/client/nav-icon
 */
/** 换图标的目标：一行导航的标题与该行要画上的字形。 */
export interface SectionNavIcon {
    /** 目标行标题，与注册 `settings.section` 时的 label 同源；每次现取。 */
    label: () => string;
    /** 把图标渲成内联 SVG 源码；由调用方注入，本模块因此不依赖 react / react-dom。 */
    renderSvg: () => string;
}
/**
 * 把内联 SVG 源码转成可作 CSS mask 的 data URI。
 * 需要补 `xmlns`（data URI 按独立图像文档解析，缺了不渲染）并把 `currentColor` 定成不透明黑（mask 只看 alpha）。
 * @param svg - 内联 SVG 源码。
 * @returns `url("data:image/svg+xml,...")`；源码为空时返回空串。
 */
export declare function svgMaskUri(svg: string): string;
/** 宿主文档里 `<symbol>` 的定义：展开 `<use>` 时要搬过去的属性和内容。 */
export interface SpriteSymbol {
    /** 逐个搬过去的属性（viewBox、fill、stroke 等），宿主加什么就带什么。 */
    readonly attrs: Readonly<Record<string, string>>;
    /** `<symbol>` 的子内容。 */
    readonly content: string;
}
/** 按 id 取 `<symbol>`；取不到返回 undefined，调用方据此保留兜底齿轮。 */
export type SymbolLookup = (id: string) => SpriteSymbol | undefined;
/**
 * 把 SVG 里的 `<use href="#id">` 展开成自包含图形。
 *
 * data URI 是一份独立图像文档，`<use>` 在里面找不到宿主文档的 `<symbol>`；不展开就只剩一片空白。
 * 只展开第一个引用：图标字形不会引用多个 symbol。
 *
 * @param svg - 渲染出的内联 SVG 源码；没有引用的（老版本内联 `<path>`）原样返回。
 * @param lookup - 按 id 取 `<symbol>` 的查找函数。
 * @returns 自包含的 SVG 源码；引用的 symbol 取不到时返回 undefined。
 */
export declare function expandUseRefs(svg: string, lookup: SymbolLookup): string | undefined;
/**
 * 造一个「按 id 取 `<symbol>`」的查找器：搬属性时跳过 id，内容原样带过去。
 * @param find - 按 id 查元素的函数，通常是 `document.getElementById`。
 * @returns `expandUseRefs` 需要的查找函数；查不到时返回 undefined。
 * @internal
 */
export declare function symbolIn(find: (id: string) => Element | null): SymbolLookup;
/**
 * 把设置面板导航里目标分区的兜底齿轮换成指定图标。
 * @param target - 目标行标题与字形渲染器。
 * @returns 断开观察者的清理函数；已注入的样式与标记留在原地，不影响正确性。
 */
export declare function installSectionNavIcon(target: SectionNavIcon): () => void;
