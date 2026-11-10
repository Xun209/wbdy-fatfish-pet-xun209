;(()=>{

//#region src/shared/constants.ts
const CANVAS_H = 360;
const FEET_Y = 330;
const HIT_BOX = {
	x0: 200,
	y0: 50,
	x1: 440,
	y1: 335
};
const DRAG_THRESHOLD = 5;
const SLINGSHOT_DOUBLE_MS = 200;
const PET_REF_WIDTH = 462;
const ROUTE_SEGMENT = "/dsh-pet-7340";
function mountPrefixOf(baseURI) {
	if (baseURI === void 0 || baseURI === "") return "";
	try {
		const url = new URL(baseURI);
		if (url.protocol !== "http:" && url.protocol !== "https:") return "";
		return url.pathname.replace(/\/+$/, "");
	} catch {
		return "";
	}
}
function routePathOf(baseURI) {
	return mountPrefixOf(baseURI) + ROUTE_SEGMENT;
}
const ROUTE_PATH = routePathOf(typeof document === "undefined" ? void 0 : document.baseURI);
const ANIMATION_EXT = ".webm";

//#endregion
//#region src/shared/hotkey.ts
function isTypingTarget(target) {
	const el = target;
	if (!el || typeof el.tagName !== "string") return false;
	const tag = el.tagName.toLowerCase();
	if (tag === "input" || tag === "textarea" || tag === "select") return true;
	return el.isContentEditable === true;
}
function isBareKey(e, key) {
	if (e.ctrlKey || e.metaKey || e.altKey) return false;
	if (String(e.key).toLowerCase() !== key) return false;
	return !isTypingTarget(e.target);
}

//#endregion
//#region src/shared/display-hotkey.ts
const DISPLAY_ORDER = [
	"web",
	"desktop",
	"both",
	"none"
];
const DISPLAY_HOTKEY_HINTS = DISPLAY_ORDER.map((_, index) => String(index + 1) + " 鍵");
function displayOfHotkey(e) {
	for (let index = 0; index < DISPLAY_ORDER.length; index += 1) if (isBareKey(e, String(index + 1))) return DISPLAY_ORDER[index];
	return void 0;
}

//#endregion
//#region src/shared/menu/tree.ts
/** 睡着时仍然放行的菜单動作：维护类、「叫醒它」本身，以及第三方菜单项。
*  第三方要做什么由它自己决定——真去驱动宠物时会带占用锁调接口，宿主闸门在那一层再判
*  （锁优先）。在渲染端先拦掉，等于让「更多」里的第三方入口在睡覺时整体失效。 */
const SLEEP_ALLOWED_ACTIONS = [
	"sleep",
	"wake",
	"home",
	"set-display",
	"reload",
	"third-party"
];
const isSleepAllowedAction = (action) => action !== void 0 && SLEEP_ALLOWED_ACTIONS.includes(action);
/** 四个顯示位置的菜单文案；键是 {@link DISPLAY_ORDER} 的元素，顺序以那边为准。 */
const DISPLAY_LABELS = {
	web: "僅網頁",
	desktop: "僅桌面",
	both: "兩者",
	none: "都不要"
};
const displayMenuBranch = () => ({
	label: "顯示位置",
	children: DISPLAY_ORDER.map((display, index) => ({
		label: DISPLAY_LABELS[display],
		action: "set-display",
		display,
		hint: DISPLAY_HOTKEY_HINTS[index]
	}))
});
const MORE_MENU_LABEL = "更多";
function readMenuItems(data, surface$1) {
	if (!data || typeof data !== "object") return [];
	const items = data.items;
	if (!Array.isArray(items)) return [];
	const out = [];
	for (const item of items) {
		if (!item || typeof item !== "object") continue;
		const rec = item;
		const rawTarget = rec.target;
		const target = rawTarget === "web" || rawTarget === "desktop" || rawTarget === "both" ? rawTarget : "both";
		if (target !== "both" && target !== surface$1) continue;
		const owner = rec.owner;
		const label = rec.label;
		if (typeof owner === "string" && owner !== "" && typeof label === "string" && label !== "") out.push({
			owner,
			label
		});
	}
	return out;
}
function buildMoreBranch(items) {
	const groups = new Map();
	for (const item of items) {
		const list = groups.get(item.owner);
		if (list) list.push(item.label);
		else groups.set(item.owner, [item.label]);
	}
	const children = [];
	for (const [owner, labels$1] of groups) if (labels$1.length === 1) children.push({
		label: labels$1[0],
		action: "third-party",
		owner
	});
	else children.push({
		label: owner,
		children: labels$1.map((label) => ({
			label,
			action: "third-party",
			owner
		}))
	});
	return children.length > 0 ? {
		label: MORE_MENU_LABEL,
		children
	} : null;
}
/** 事件名 → 分类标签（无映射时用事件名本身）。 */
const EVENT_LABELS = {
	balance: "餘額檔位",
	whisper: "碎碎念",
	workStatus: "工作狀態"
};
const leaf = (anim) => ({
	label: anim,
	anim
});
function buildMenuTree(animations) {
	const groups = [];
	const pools = [
		["待機", animations.idle],
		["轉向", animations.turn],
		["拖拽", animations.drag],
		["點擊回應", animations.clicks],
		["移動", animations.moves.actions.map((m) => m.name)]
	];
	for (const [label, pool] of pools) if (pool.length) groups.push({
		label,
		children: pool.map(leaf)
	});
	const cats = (animations.categories ?? []).filter((c) => c.actions.length > 0);
	for (const c of cats) groups.push({
		label: c.id,
		children: c.actions.map(leaf)
	});
	const events = animations.events ?? {};
	for (const key of Object.keys(events)) {
		const pool = events[key] ?? [];
		const names = [];
		for (const slot of pool) if (typeof slot === "string") names.push(slot);
		else names.push(...slot);
		if (names.length) groups.push({
			label: EVENT_LABELS[key] ?? key,
			children: names.map(leaf)
		});
	}
	if (!groups.length) return [];
	return [{
		label: "動作",
		children: groups
	}];
}
function isNoMirrorAnimation(categories, anim) {
	return (categories ?? []).some((c) => c.noMirror === true && c.actions.includes(anim));
}

//#endregion
//#region src/shared/menu/memes.ts
/**
* 可用图的名称清单：描述为空的不算。
*
* 与宿主的池判定同口径（`host/memes` 的 readMemePool 要求描述非空）：模型靠描述才认得出这张图，
* 没描述的条目即使文件存在也进不了對話与碎碎念。顺序保留配置里的书写顺序。
*/
function usableNames(memes) {
	if (!memes || typeof memes !== "object" || Array.isArray(memes)) return [];
	const out = [];
	for (const [name, desc] of Object.entries(memes)) {
		if (!name.trim()) continue;
		if (typeof desc !== "string" || desc.trim() === "") continue;
		out.push(name);
	}
	return out;
}
function groupMemes(source) {
	const names = usableNames(source.memes);
	const limit = Math.floor(Number(source.chatImageLimit));
	const unlimited = !Number.isFinite(limit) || limit <= 0;
	const take = source.chatImageEnabled !== true ? 0 : unlimited ? names.length : Math.min(limit, names.length);
	return {
		chat: names.slice(0, take),
		other: names.slice(take)
	};
}
/** 单张图 → 菜单叶子：点它就是「用这张图说一句」；给了缩略图地址就带上，菜单据此画小图。 */
function memeLeaf(name, thumbOf) {
	const leaf$1 = {
		label: name,
		action: "whisper",
		image: name
	};
	if (thumbOf) leaf$1.thumb = thumbOf(name);
	return leaf$1;
}
function memeThumbUrl(baseUrl, assetRoot, name) {
	const root = assetRoot && assetRoot.trim() !== "" ? assetRoot : "main";
	return baseUrl + "/pic/memes/" + encodeURIComponent(root) + "/" + encodeURIComponent(name) + ".png";
}
function buildMemeBranch(source, thumbOf) {
	const { chat, other } = groupMemes(source);
	const leaf$1 = (name) => memeLeaf(name, thumbOf);
	const groups = [];
	if (chat.length > 0) groups.push({
		label: "納入對話的配圖",
		children: chat.map(leaf$1)
	});
	if (other.length > 0) groups.push({
		label: "其他",
		children: other.map(leaf$1)
	});
	if (groups.length === 0) return null;
	return {
		label: "配圖",
		children: groups
	};
}

//#endregion
//#region src/shared/menu/css.ts
const MENU_CSS = [
	".dsh-pet-menu{position:fixed;left:0;top:0;z-index:2147483000;color:#2b2b2b;font-size:13px;line-height:1.5;",
	"font-family:'Microsoft YaHei UI','Segoe UI','PingFang SC',sans-serif;user-select:none;pointer-events:auto}",
	".dsh-pet-menu,.dsh-pet-menu *{box-sizing:border-box}",
	".dsh-pet-menu-column{position:absolute;min-width:150px;max-width:300px;padding:4px;",
	"background:rgba(255,255,255,.98);border:1px solid rgba(0,0,0,.12);border-radius:8px;",
	"box-shadow:0 8px 28px rgba(0,0,0,.2);max-height:min(62vh,460px);overflow-y:auto;",
	"scrollbar-width:thin;scrollbar-color:rgba(0,0,0,.22) transparent}",
	".dsh-pet-menu-column::-webkit-scrollbar{width:8px;height:8px}",
	".dsh-pet-menu-column::-webkit-scrollbar-track{background:transparent}",
	".dsh-pet-menu-column::-webkit-scrollbar-thumb{background:rgba(0,0,0,.16);border-radius:4px;",
	"border:2px solid transparent;background-clip:content-box}",
	".dsh-pet-menu-column::-webkit-scrollbar-thumb:hover{background:rgba(43,99,255,.4);",
	"border:2px solid transparent;background-clip:content-box}",
	".dsh-pet-menu-column::-webkit-scrollbar-corner{background:transparent}",
	".dsh-pet-menu-item{position:relative;display:flex;align-items:center;justify-content:space-between;",
	"gap:14px;padding:5px 12px;border-radius:6px;white-space:nowrap;cursor:default}",
	".dsh-pet-menu-item:hover{background:rgba(43,99,255,.14)}",
	".dsh-pet-menu-label{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis}",
	".dsh-pet-menu-thumb{width:28px;height:28px;border-radius:4px;object-fit:cover;flex:none;",
	"background:rgba(0,0,0,.06)}",
	".dsh-pet-menu-item-pic{gap:8px}",
	".dsh-pet-menu-hint{color:#9aa0a6;font-size:12px;flex:none;white-space:nowrap}",
	".dsh-pet-menu-arrow{color:#9aa0a6;font-size:12px;flex:none}"
].join("");

//#endregion
//#region src/shared/menu/position.ts
/** 面板与边界、面板之间的间距（px）。 */
const PANEL_GAP = 4;
function pickPanelPosition(input) {
	const { panel, item, parent, others, clamp } = input;
	const minLeft = clamp.x + PANEL_GAP;
	const minTop = clamp.y + PANEL_GAP;
	const maxLeft = clamp.x + clamp.w - PANEL_GAP - panel.w;
	const maxTop = clamp.y + clamp.h - PANEL_GAP - panel.h;
	/** 夹进 clamp；面板比 clamp 还宽/高时贴左上角。 */
	const clampX = (v) => Math.max(minLeft, Math.min(v, Math.max(minLeft, maxLeft)));
	const clampY = (v) => Math.max(minTop, Math.min(v, Math.max(minTop, maxTop)));
	const hitsOther = (left, top) => others.some((b) => left < b.right && left + panel.w > b.left && top < b.bottom && top + panel.h > b.top);
	const fitsClamp = (left, top) => left >= minLeft - .5 && left <= maxLeft + .5 && top >= minTop - .5 && top <= maxTop + .5;
	const topAtItem = clampY(item.top);
	const topAtParent = clampY(parent.top);
	const cands = [
		{
			left: parent.right + PANEL_GAP,
			top: topAtItem
		},
		{
			left: parent.left - PANEL_GAP - panel.w,
			top: topAtItem
		},
		{
			left: parent.right + PANEL_GAP,
			top: topAtParent
		},
		{
			left: parent.left - PANEL_GAP - panel.w,
			top: topAtParent
		}
	];
	const ideal = cands.find((cd) => fitsClamp(cd.left, cd.top) && !hitsOther(cd.left, cd.top));
	if (ideal) return ideal;
	const fitted = cands.map((cd) => ({
		left: clampX(cd.left),
		top: clampY(cd.top)
	})).find((cd) => !hitsOther(cd.left, cd.top));
	if (fitted) return fitted;
	return {
		left: clampX(parent.right + PANEL_GAP),
		top: clampY(topAtItem)
	};
}

//#endregion
//#region src/shared/menu/mount.ts
function isBranchNode(n) {
	return "children" in n && Array.isArray(n.children);
}
function mountContextMenu(opts) {
	const { tree, x, y, onAction, onClose, clamp } = opts;
	const c = clamp && Number.isFinite(clamp.x + clamp.y + clamp.w + clamp.h) ? clamp : {
		x: 0,
		y: 0,
		w: window.innerWidth,
		h: window.innerHeight
	};
	const root = document.createElement("div");
	root.className = "dsh-pet-menu";
	root.style.left = "0px";
	root.style.top = "0px";
	root.addEventListener("contextmenu", (e) => e.preventDefault());
	let closed = false;
	/** 每个面板当前展开的子面板（无 = 未展开）；hideChain 会沿链清除 */
	const openChild = new Map();
	/** 指针整体离开菜单树的兜底关闭定时器（root mouseover 重新进入即取消） */
	let leaveTimer = null;
	/** 关闭某面板及其后代面板整条链（display:none + 清 openChild 链） */
	const hideChain = (panel) => {
		panel.style.display = "none";
		const child = openChild.get(panel);
		if (child) {
			openChild.delete(panel);
			hideChain(child);
		}
	};
	/** 把子面板摆到触发项旁边：优先父面板右侧，放不下翻到父面板左侧，
	*  且不与任何已展开面板重叠；贴边时夹进 clamp。 */
	const showPanel = (panel, item) => {
		const rect = item.getBoundingClientRect();
		panel.style.left = "";
		panel.style.top = "";
		panel.style.display = "block";
		const parentEl = item.parentElement;
		const pr = parentEl ? parentEl.getBoundingClientRect() : rect;
		const pick$1 = pickPanelPosition({
			panel: {
				w: panel.offsetWidth,
				h: panel.offsetHeight
			},
			item: {
				left: rect.left,
				right: rect.right,
				top: rect.top
			},
			parent: {
				left: pr.left,
				right: pr.right,
				top: pr.top
			},
			others: Array.from(root.querySelectorAll(".dsh-pet-menu-column")).filter((p) => p !== panel && p.style.display !== "none").map((p) => {
				const b = p.getBoundingClientRect();
				return {
					left: b.left,
					top: b.top,
					right: b.right,
					bottom: b.bottom
				};
			}),
			clamp: {
				x: c.x,
				y: c.y,
				w: c.w,
				h: c.h
			}
		});
		panel.style.left = pick$1.left + "px";
		panel.style.top = pick$1.top + "px";
	};
	/** 构建一层面板；分支项的子面板平级挂到 root 下、不嵌套。
	*  面板先入 DOM、子面板后入，层级越深绘制越靠上（子菜单盖在父菜单上层）。 */
	const buildPanel$1 = (nodes) => {
		const panel = document.createElement("div");
		panel.className = "dsh-pet-menu-column";
		panel.style.display = "none";
		if (clamp) panel.style.maxHeight = Math.min(460, Math.max(120, c.h - 16)) + "px";
		root.appendChild(panel);
		for (const node of nodes) {
			const item = document.createElement("div");
			item.className = "dsh-pet-menu-item";
			if (isBranchNode(node)) {
				item.classList.add("dsh-pet-menu-branch");
				const label = document.createElement("span");
				label.className = "dsh-pet-menu-label";
				label.textContent = node.label;
				const arrow = document.createElement("span");
				arrow.className = "dsh-pet-menu-arrow";
				arrow.textContent = "▸";
				item.appendChild(label);
				item.appendChild(arrow);
				const childPanel = buildPanel$1(node.children);
				item.addEventListener("mouseenter", () => {
					const prev = openChild.get(panel);
					if (prev && prev !== childPanel) hideChain(prev);
					openChild.set(panel, childPanel);
					showPanel(childPanel, item);
				});
			} else {
				if (node.thumb) {
					const thumb = document.createElement("img");
					thumb.className = "dsh-pet-menu-thumb";
					thumb.src = node.thumb;
					thumb.alt = "";
					thumb.draggable = false;
					thumb.loading = "lazy";
					thumb.decoding = "async";
					item.appendChild(thumb);
					item.classList.add("dsh-pet-menu-item-pic");
				}
				const label = document.createElement("span");
				label.className = "dsh-pet-menu-label";
				label.textContent = node.label;
				item.appendChild(label);
				if (node.hint) {
					const hint = document.createElement("span");
					hint.className = "dsh-pet-menu-hint";
					hint.textContent = node.hint;
					item.appendChild(hint);
				}
				item.addEventListener("click", (e) => {
					e.preventDefault();
					e.stopPropagation();
					close();
					onAction(node);
				});
			}
			panel.appendChild(item);
		}
		return panel;
	};
	const rootPanel = buildPanel$1(tree);
	rootPanel.style.display = "block";
	document.body.appendChild(root);
	rootPanel.style.left = "";
	rootPanel.style.top = "";
	const rw = rootPanel.offsetWidth;
	const rh = rootPanel.offsetHeight;
	rootPanel.style.left = Math.max(c.x + 4, Math.min(x, c.x + c.w - rw - 4)) + "px";
	rootPanel.style.top = Math.max(c.y + 4, Math.min(y, c.y + c.h - rh - 4)) + "px";
	root.addEventListener("mouseleave", () => {
		if (leaveTimer !== null) window.clearTimeout(leaveTimer);
		leaveTimer = window.setTimeout(() => {
			leaveTimer = null;
			close();
		}, 200);
	});
	root.addEventListener("mouseover", () => {
		if (leaveTimer !== null) {
			window.clearTimeout(leaveTimer);
			leaveTimer = null;
		}
	});
	const onDocPointerDown = (e) => {
		if (closed) return;
		if (root.contains(e.target)) return;
		close();
	};
	const onDocKeyDown = (e) => {
		if (closed) return;
		if (e.key === "Escape") close();
	};
	document.addEventListener("mousedown", onDocPointerDown, true);
	document.addEventListener("keydown", onDocKeyDown, true);
	const close = () => {
		if (closed) return;
		closed = true;
		if (leaveTimer !== null) window.clearTimeout(leaveTimer);
		leaveTimer = null;
		document.removeEventListener("mousedown", onDocPointerDown, true);
		document.removeEventListener("keydown", onDocKeyDown, true);
		root.remove();
		if (onClose) onClose();
	};
	return {
		el: root,
		close
	};
}

//#endregion
//#region src/shared/tooltip.ts
const TOOLTIP_CLASS = "pet-tooltip";
const TOOLTIP_GAP_RATIO = .022;
function tooltipPlacement(cursor, tip, bounds, gap) {
	const clamp = (v, lo, hi) => hi < lo ? lo : Math.min(Math.max(v, lo), hi);
	const rightMax = bounds.x + bounds.w;
	const bottomMax = bounds.y + bounds.h;
	let x = cursor.x + gap;
	if (x + tip.w > rightMax) x = cursor.x - gap - tip.w;
	x = clamp(x, bounds.x, rightMax - tip.w);
	let y = cursor.y + gap;
	if (y + tip.h > bottomMax) y = cursor.y - gap - tip.h;
	y = clamp(y, bounds.y, bottomMax - tip.h);
	return {
		x,
		y
	};
}
const TOOLTIP_CSS = [
	".pet-tooltip{",
	"position:fixed;left:0;top:0;",
	"max-width:calc(var(--dsh-pet-size,var(--pet-size,462px))*0.8);",
	"padding:calc(var(--dsh-pet-size,var(--pet-size,462px))*0.010) calc(var(--dsh-pet-size,var(--pet-size,462px))*0.021);",
	"border-radius:calc(var(--dsh-pet-size,var(--pet-size,462px))*0.016);",
	"background:rgba(255,255,255,.96);color:#1f1f1f;",
	"border:1px solid rgba(0,0,0,.12);",
	"font-family:var(--dsh-pet-font-family,\"ShangshouSoftCandy\",\"Yuanti SC\",\"YouYuan\",\"幼圓\",\"Comic Sans MS\",\"PingFang SC\",\"Microsoft YaHei\",sans-serif);",
	"font-size:var(--dsh-pet-font-tip,calc(var(--dsh-pet-size,var(--pet-size,462px))*0.026));line-height:1.4;",
	"white-space:nowrap;overflow:hidden;text-overflow:ellipsis;",
	"box-shadow:0 calc(var(--dsh-pet-size,var(--pet-size,462px))*0.004) calc(var(--dsh-pet-size,var(--pet-size,462px))*0.013) rgba(0,0,0,.18);",
	"opacity:0;transition:opacity .12s ease;pointer-events:none;z-index:2}",
	".pet-tooltip.is-on{opacity:1}"
].join("");

//#endregion
//#region src/client/pet/css.ts
/** 宠物页面样式表。 */
const PET_CSS = [
	".dsh-pet-root{position:fixed;z-index:40;pointer-events:none;user-select:none}",
	".dsh-pet-root[data-corner=\"bottom-right\"]{right:var(--dsh-pet-mx,24px);bottom:var(--dsh-pet-my,0)}",
	".dsh-pet-root[data-corner=\"bottom-left\"]{left:var(--dsh-pet-mx,24px);bottom:var(--dsh-pet-my,0)}",
	".dsh-pet-root[data-corner=\"top-right\"]{right:var(--dsh-pet-mx,24px);top:var(--dsh-pet-my,0)}",
	".dsh-pet-root[data-corner=\"top-left\"]{left:var(--dsh-pet-mx,24px);top:var(--dsh-pet-my,0)}",
	".dsh-pet-stage{position:relative;width:var(--dsh-pet-size,462px);height:calc(var(--dsh-pet-size,462px)*9/16);pointer-events:none}",
	".dsh-pet-video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;pointer-events:none;opacity:0;transition:opacity .18s ease;transform-origin:center}",
	".dsh-pet-video.is-front{opacity:1}",
	`.dsh-pet-hit{position:absolute;pointer-events:auto;cursor:url("${ROUTE_PATH}/pic/cursor-grab.png") 16 16, grab;z-index:1;touch-action:none;-webkit-user-select:none;-webkit-touch-callout:none}`,
	`.dsh-pet-hit.dragging{cursor:url("${ROUTE_PATH}/pic/cursor-grabbing.png") 16 16, grabbing}`,
	"@media (prefers-reduced-motion: reduce){.dsh-pet-video{transition:none}}",
	MENU_CSS,
	TOOLTIP_CSS
].join("\n");
/** 注入去重用的标记值，写在 `<style>` 的 `data-plugin-css` 上。 */
const cssTag = "dsh-pet/style.css";
function injectPetCss() {
	if (typeof document === "undefined") return;
	if (document.querySelector("style[data-plugin-css=\"" + cssTag + "\"]") !== null) return;
	const tag = document.createElement("style");
	tag.dataset.plugin = "dsh-pet";
	tag.dataset.pluginCss = cssTag;
	tag.textContent = PET_CSS;
	document.head.appendChild(tag);
}

//#endregion
//#region src/shared/physics/constants.ts
const SPRING_K = 200;
const SPRING_C = 30;
const TRAIL_KEEP_MS = 200;
const RELEASE_WINDOW_MS = 150;
const RELEASE_STALE_MS = 150;
const MIN_SPAN_MS = 20;
const SEG_MIN_DT_MS = 8;
const DEAD_ZONE_SPEED = 500;
const MAX_THROW_SPEED = 3600;
const PEAK_WEIGHT = .5;
const ACCEL_REF = 8e3;
const ACCEL_GAIN_MAX = .6;
const GRAVITY = 1400;
const RESTITUTION = .78;
const GROUND_FRICTION = 2.5;
const DEFAULT_PHYSICS = {
	gravity: GRAVITY,
	restitution: RESTITUTION,
	groundFriction: GROUND_FRICTION,
	ceilingBounce: true,
	throwPower: 1,
	petCollision: true,
	hapticEnabled: true,
	tiltGravity: false,
	shakeThrow: false
};
const DEFAULT_THROW_POWER = 1;
const REST_NORMAL = 40;
const REST_TANGENT = 15;
const REST_NORMAL_EPS = 1;
const MAX_STEP_DT = .05;
const SQ_SQUASH = .55;
const SQ_DURATION_MS = 220;
const SQ_SOFT_SPEED = 300;
const SQ_HARD_SPEED = 1500;
const SQ_MAX_SQUASH = .55;
const THROW_SPEED_ANCHOR = 1200;
const SLINGSHOT_REF_RATIO = .6;
const SUBSTEP_PX = 8;
const SUBSTEP_MAX = 64;
const PET_BOUNCE_E = .995;

//#endregion
//#region src/shared/physics/squash.ts
const landingSquash = (impactSpeed) => {
	const t = Math.min(Math.max((Math.abs(impactSpeed) - SQ_SOFT_SPEED) / (SQ_HARD_SPEED - SQ_SOFT_SPEED), 0), 1);
	return Math.min(.8, 1 - t * (1 - SQ_MAX_SQUASH));
};
const squashScale = (u, squash = SQ_SQUASH) => {
	if (u < .45) {
		const p$1 = u / .45;
		return 1 - (1 - squash) * p$1 * p$1;
	}
	const p = (u - .45) / .55;
	const c1 = 1.70158;
	const c3 = c1 + 1;
	const f = 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
	return Math.min(1.12, squash + (1 - squash) * Math.max(f, 0));
};

//#endregion
//#region src/shared/displays.ts
const rectRight = (r) => r.x + r.width;
const rectBottom = (r) => r.y + r.height;
const pointInRect = (r, x, y) => x >= r.x && x < rectRight(r) && y >= r.y && y < rectBottom(r);
const rectAtPoint = (rects, x, y) => {
	for (const r of rects) if (pointInRect(r, x, y)) return r;
	return null;
};

//#endregion
//#region src/shared/physics/contact.ts
const CONTACT_NORMALS = {
	left: {
		nx: 1,
		ny: 0
	},
	right: {
		nx: -1,
		ny: 0
	},
	ceiling: {
		nx: 0,
		ny: 1
	},
	floor: {
		nx: 0,
		ny: -1
	}
};
const resolveContact = (speed, edge, physics, dt) => {
	const { nx, ny } = CONTACT_NORMALS[edge];
	const tx = -ny;
	const ty = nx;
	const vn = speed.vx * nx + speed.vy * ny;
	const vt = speed.vx * tx + speed.vy * ty;
	const normalSpeed = Math.abs(vn) < REST_NORMAL ? 0 : Math.abs(vn) * physics.restitution;
	const tangentSpeed = vt * Math.max(0, 1 - physics.groundFriction * dt);
	return {
		vx: normalSpeed * nx + tangentSpeed * tx,
		vy: normalSpeed * ny + tangentSpeed * ty,
		normalSpeed,
		tangentSpeed
	};
};
const isRestingOnContacts = (edges, speed) => {
	if (edges.length === 0) return false;
	return edges.every((edge) => {
		const { nx, ny } = CONTACT_NORMALS[edge];
		const normal = Math.abs(speed.vx * nx + speed.vy * ny);
		const tangent = Math.abs(speed.vx * -ny + speed.vy * nx);
		return normal < REST_NORMAL_EPS && tangent < REST_TANGENT;
	});
};

//#endregion
//#region src/shared/physics/throw.ts
const throwBounds = (o) => {
	const h = o.size * 9 / 16;
	return {
		minX: -o.sideAllow,
		minY: 0,
		maxX: o.W - o.size + o.sideAllow,
		maxY: o.H - h
	};
};
const throwStep = (s, dtRaw, b, physics = DEFAULT_PHYSICS, gravity) => {
	const dt = Math.min(Math.max(dtRaw, 0), MAX_STEP_DT);
	const g = gravity ?? {
		gx: 0,
		gy: physics.gravity
	};
	let { x, y, vx, vy } = s;
	vx += g.gx * dt;
	vy += g.gy * dt;
	x += vx * dt;
	y += vy * dt;
	let bounced = false;
	let hit = null;
	const contacts = [];
	/** 同一步撞到两条边（角落）时 hit 留更重的那个（手感只按主撞击算），contacts 全量保留。 */
	const record = (edge, speed) => {
		contacts.push(edge);
		if (hit === null || speed > hit.speed) hit = {
			edge,
			speed
		};
	};
	if (x < b.minX) {
		record("left", Math.abs(vx));
		x = b.minX;
		const out = resolveContact({
			vx,
			vy
		}, "left", physics, dt);
		vx = out.vx;
		vy = out.vy;
		bounced = true;
	} else if (x > b.maxX) {
		record("right", Math.abs(vx));
		x = b.maxX;
		const out = resolveContact({
			vx,
			vy
		}, "right", physics, dt);
		vx = out.vx;
		vy = out.vy;
		bounced = true;
	}
	if (y < b.minY) {
		if (physics.ceilingBounce) {
			record("ceiling", Math.abs(vy));
			y = b.minY;
			const out = resolveContact({
				vx,
				vy
			}, "ceiling", physics, dt);
			vx = out.vx;
			vy = out.vy;
			bounced = true;
		}
	} else if (y >= b.maxY) {
		record("floor", Math.abs(vy));
		y = b.maxY;
		const out = resolveContact({
			vx,
			vy
		}, "floor", physics, dt);
		vx = out.vx;
		vy = out.vy;
		bounced = true;
	}
	return {
		x,
		y,
		vx,
		vy,
		bounced,
		atRest: isRestingOnContacts(contacts, {
			vx,
			vy
		}),
		hit,
		contacts
	};
};
const throwSubsteps = (vx, vy, dt) => {
	const travel = Math.hypot(vx, vy) * Math.min(Math.max(dt, 0), MAX_STEP_DT);
	if (!(travel > SUBSTEP_PX)) return 1;
	return Math.min(SUBSTEP_MAX, Math.ceil(travel / SUBSTEP_PX));
};

//#endregion
//#region src/shared/physics/spring.ts
const springStep = (v, x, target, dt, power = DEFAULT_THROW_POWER) => v + ((target - x) * SPRING_K - v * SPRING_C) * power * dt;
const softClampSpeed = (speed) => {
	if (speed <= 0) return 0;
	return MAX_THROW_SPEED * (1 - Math.exp(-speed / MAX_THROW_SPEED));
};

//#endregion
//#region src/shared/physics/release.ts
const trimTrail = (trail, now) => {
	const cutoff = now - TRAIL_KEEP_MS;
	let i = 0;
	while (i < trail.length && trail[i].t < cutoff) i++;
	return i === 0 ? trail : trail.slice(i);
};
const throwVelocity = (angleDeg, power) => {
	const speed = softClampSpeed(power * THROW_SPEED_ANCHOR);
	const rad = angleDeg * Math.PI / 180;
	return {
		vx: Math.cos(rad) * speed,
		vy: -Math.sin(rad) * speed
	};
};
const slingshotRefDist = (size) => size > 0 ? size * SLINGSHOT_REF_RATIO : 0;
const slingshotPower = (dist, size) => {
	const ref = slingshotRefDist(size);
	if (!(ref > 0) || !(dist > 0) || !Number.isFinite(dist)) return 0;
	return dist / ref;
};
const pullAngle = (pullX, pullY) => Math.atan2(pullY, -pullX) * 180 / Math.PI;
const slingshotVelocity = (angleDeg, power, throwPower = DEFAULT_THROW_POWER) => {
	const speed = THROW_SPEED_ANCHOR * Math.max(0, power) * Math.max(0, throwPower);
	if (speed === 0) return {
		vx: 0,
		vy: 0
	};
	const rad = angleDeg * Math.PI / 180;
	return {
		vx: Math.cos(rad) * speed,
		vy: -Math.sin(rad) * speed
	};
};
const estimateReleaseVelocity = (trail, now, physics = DEFAULT_PHYSICS) => {
	if (trail.length === 0) return null;
	const last = trail[trail.length - 1];
	if (now - last.t > RELEASE_STALE_MS) return null;
	const win = trail.filter((s) => now - s.t <= RELEASE_WINDOW_MS);
	if (win.length < 2) return null;
	const t0 = win[0].t;
	const x0 = win[0].x;
	const y0 = win[0].y;
	const t1 = win[win.length - 1].t;
	const x1 = win[win.length - 1].x;
	const y1 = win[win.length - 1].y;
	const spanMs = t1 - t0;
	if (spanMs < MIN_SPAN_MS) return null;
	const baseVx = (x1 - x0) / spanMs * 1e3;
	const baseVy = (y1 - y0) / spanMs * 1e3;
	const baseSpeed = Math.hypot(baseVx, baseVy);
	if (baseSpeed < 1e-6) return null;
	const segSpeeds = [];
	let px$1 = x0;
	let py = y0;
	let pt$1 = t0;
	for (const s of win.slice(1)) {
		const dt = s.t - pt$1;
		if (dt >= SEG_MIN_DT_MS) {
			segSpeeds.push({
				speed: Math.hypot(s.x - px$1, s.y - py) / dt * 1e3,
				tEnd: s.t
			});
			px$1 = s.x;
			py = s.y;
			pt$1 = s.t;
		}
	}
	const peakSpeed = segSpeeds.length ? Math.max(...segSpeeds.map((v) => v.speed)) : baseSpeed;
	let accel = 0;
	if (segSpeeds.length >= 2) {
		const lastSeg = segSpeeds[segSpeeds.length - 1];
		const firstSeg = segSpeeds[0];
		accel = (lastSeg.speed - firstSeg.speed) / Math.max((lastSeg.tEnd - firstSeg.tEnd) / 1e3, MIN_SPAN_MS / 1e3);
	}
	const speedBeforeClamp = ((1 - PEAK_WEIGHT) * baseSpeed + PEAK_WEIGHT * peakSpeed) * (1 + Math.min(Math.max(accel, 0) / ACCEL_REF, 1) * ACCEL_GAIN_MAX);
	const speed = softClampSpeed(speedBeforeClamp) * physics.throwPower;
	if (speed < DEAD_ZONE_SPEED) return null;
	return {
		vx: baseVx / baseSpeed * speed,
		vy: baseVy / baseSpeed * speed
	};
};

//#endregion
//#region src/shared/physics/collide.ts
const bodyPixelBox = (o) => {
	const h = o.size * 9 / 16;
	return {
		left: o.x + HIT_BOX.x0 / 640 * o.size,
		top: o.y + o.bottomPad + HIT_BOX.y0 / 360 * h,
		right: o.x + HIT_BOX.x1 / 640 * o.size,
		bottom: o.y + o.bottomPad + HIT_BOX.y1 / 360 * h
	};
};
const rectsOverlap = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const collidePet = (fly, hit) => {
	const hf = fly.size * 9 / 16 / 2;
	const hh = hit.size * 9 / 16 / 2;
	const cx = hit.x + hit.size / 2 - (fly.x + fly.size / 2);
	const cy = hit.y + hh - (fly.y + hf);
	const dist = Math.hypot(cx, cy);
	if (dist < 1e-6) return null;
	const nx = cx / dist;
	const ny = cy / dist;
	const vrel = (fly.vx - hit.vx) * nx + (fly.vy - hit.vy) * ny;
	if (vrel <= 0) return null;
	const e = PET_BOUNCE_E;
	const m1 = fly.size * fly.size;
	const m2 = hit.size * hit.size;
	const v1n = fly.vx * nx + fly.vy * ny;
	const v2n = hit.vx * nx + hit.vy * ny;
	const v1n2 = ((m1 - e * m2) * v1n + (1 + e) * m2 * v2n) / (m1 + m2);
	const v2n2 = ((m2 - e * m1) * v2n + (1 + e) * m1 * v1n) / (m1 + m2);
	return {
		fvx: fly.vx - v1n * nx + v1n2 * nx,
		fvy: fly.vy - v1n * ny + v1n2 * ny,
		hvx: hit.vx - v2n * nx + v2n2 * nx,
		hvy: hit.vy - v2n * ny + v2n2 * ny,
		impactSpeed: vrel
	};
};
const overlapPush = (a, b) => {
	const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
	const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
	if (ox <= 0 || oy <= 0) return null;
	const alongX = ox <= oy;
	const sign = alongX ? (a.left + a.right) / 2 >= (b.left + b.right) / 2 ? 1 : -1 : (a.top + a.bottom) / 2 >= (b.top + b.bottom) / 2 ? 1 : -1;
	return alongX ? {
		dx: sign * ox / 2,
		dy: 0
	} : {
		dx: 0,
		dy: sign * oy / 2
	};
};

//#endregion
//#region src/client/pet/motion/geometry.ts
function derivePetMetrics(size) {
	return {
		halfW: size / 2,
		halfH: size * 9 / 16 / 2,
		bottomPad: size * (9 / 16) * (CANVAS_H - FEET_Y) / CANVAS_H,
		sideAllow: HIT_BOX.x0 / 640 * size
	};
}
function centerToBox(center, viewport, half) {
	return {
		x: center.rx * viewport.width - half.w,
		y: center.ry * viewport.height - half.h
	};
}
function boxToRatio(box, viewport, half) {
	return {
		rx: (box.x + half.w) / viewport.width,
		ry: (box.y + half.h) / viewport.height
	};
}
const MIN_REACHABLE_PX = 24;
function clampReachableBox(box, viewport, body) {
	const inset = bodyPixelBox({
		x: 0,
		y: 0,
		size: body.size,
		bottomPad: body.bottomPad
	});
	const minX = MIN_REACHABLE_PX - inset.right;
	const maxX = viewport.width - inset.left - MIN_REACHABLE_PX;
	const minY = MIN_REACHABLE_PX - inset.bottom;
	const maxY = viewport.height - inset.top - MIN_REACHABLE_PX;
	const height = body.size * 9 / 16;
	return {
		x: clampAxis(box.x, minX, maxX, (viewport.width - body.size) / 2),
		y: clampAxis(box.y, minY, maxY, (viewport.height - height) / 2)
	};
}
/**
* 单轴夹取：视口与命中区加起來还容不下两倍下限时区间反向，改为居中，避免夹到错误的一侧。
*
* @param value - 待夹坐标（px）。
* @param lo - 允许下限（px）。
* @param hi - 允许上限（px）。
* @param centered - 区间反向时的居中坐标（px）。
* @returns 夹取后的坐标（px）。
*/
function clampAxis(value, lo, hi, centered) {
	return lo > hi ? centered : Math.min(Math.max(value, lo), hi);
}
function petStageStyle(dragging, bottomPad) {
	return dragging ? { transform: "none" } : { transform: "translateY(" + bottomPad + "px)" };
}
function petRootStyle(customPos, viewport, half) {
	if (!customPos) return {};
	return {
		left: customPos.rx * viewport.width - half.w + "px",
		top: customPos.ry * viewport.height - half.h + "px",
		right: "auto",
		bottom: "auto"
	};
}
const PET_HIT_STYLE = {
	left: HIT_BOX.x0 / 640 * 100 + "%",
	top: HIT_BOX.y0 / 360 * 100 + "%",
	width: (HIT_BOX.x1 - HIT_BOX.x0) / 640 * 100 + "%",
	height: (HIT_BOX.y1 - HIT_BOX.y0) / 360 * 100 + "%"
};

//#endregion
//#region src/client/pet/card/view.ts
/** 两路视频的共同属性：静音、内联播放并自动播放。 */
const VIDEO_PROPS = {
	muted: true,
	playsInline: true,
	autoPlay: true
};
function makeCardView(rt) {
	const { h } = rt;
	return function CardView(props) {
		return h("div", {
			ref: props.rootRef,
			className: "dsh-pet-root",
			"data-corner": props.corner,
			"data-facing": props.facing,
			style: Object.assign({
				"--dsh-pet-size": props.size + "px",
				"--dsh-pet-mx": props.marginX + "px",
				"--dsh-pet-my": props.marginY + "px",
				"--dsh-pet-font-bubble": props.fontBubblePx + "px",
				"--dsh-pet-font-tip": props.fontTipPx + "px"
			}, props.rootStyle),
			children: [
				props.bubble,
				h("div", {
					ref: props.stageRef,
					className: "dsh-pet-stage",
					style: props.stageStyle,
					children: [
						h("video", Object.assign({}, VIDEO_PROPS, {
							ref: props.videoARef,
							className: "dsh-pet-video is-front"
						})),
						h("video", Object.assign({}, VIDEO_PROPS, {
							ref: props.videoBRef,
							className: "dsh-pet-video"
						})),
						h("div", {
							className: "dsh-pet-hit",
							style: PET_HIT_STYLE,
							onClick: props.onClick,
							onPointerDown: props.onPointerDown,
							onPointerMove: props.onPointerMove,
							onPointerUp: props.onPointerUp,
							onPointerCancel: props.onPointerUp,
							onPointerEnter: props.onPointerEnter,
							onPointerLeave: props.onPointerLeave,
							onContextMenu: props.onContextMenu,
							"aria-label": props.name
						})
					]
				}),
				h("div", {
					ref: props.tipRef,
					className: TOOLTIP_CLASS + (props.tipOn ? " is-on" : ""),
					"aria-hidden": "true",
					children: props.name
				})
			]
		});
	};
}

//#endregion
//#region src/shared/pickers.ts
const pick = (pool, exclude) => {
	const entries = exclude ? pool.filter((n) => n !== exclude) : pool;
	const src = entries.length ? entries : pool;
	return src[Math.floor(Math.random() * src.length)];
};
const pickSlot = (slot, exclude) => {
	if (typeof slot === "string") return slot;
	const entries = exclude === void 0 ? slot : slot.filter((n) => n !== exclude);
	const src = entries.length ? entries : slot;
	return src[Math.floor(Math.random() * src.length)];
};
const slotIncludes = (slot, anim) => typeof slot === "string" ? slot === anim : slot.includes(anim);
const poolIncludes = (pool, anim) => pool.some((slot) => slotIncludes(slot, anim));
const isEventAnim = (events, anim) => events ? Object.values(events).some((pool) => poolIncludes(pool, anim)) : false;
const nextWorkStatusAnim = (pool, current$1) => {
	const idx = pool.findIndex((slot$1) => slotIncludes(slot$1, current$1));
	if (idx === -1) return null;
	const slot = pool[idx];
	if (!Array.isArray(slot) || slot.length <= 1) return null;
	return pickSlot(slot, current$1);
};
const randomBetween = (min, max) => Math.floor(min + Math.random() * (max - min));
const pickWeightedCategory = (categories, facing) => {
	const cats = categories.filter((c) => c.actions.length > 0);
	if (!cats.length) return null;
	const filtered = cats.filter((c) => !(c.noMirror && facing === "right"));
	const eligible = filtered.length ? filtered : cats;
	const totalW = eligible.reduce((s, c) => s + c.weight, 0) || 1;
	let t = Math.random() * totalW;
	for (const c of eligible) {
		t -= c.weight;
		if (t <= 0) return c;
	}
	return eligible[eligible.length - 1];
};
const rollKind = (roll, w, opts) => {
	const turn = opts?.fixed ? 0 : w.turn;
	const move = opts?.fixed ? 0 : w.move;
	const topEnd = (w.idle + turn + move) / 100;
	if (roll < w.idle / 100) return "idle";
	if (roll < (w.idle + turn) / 100) return "turn";
	if (roll < topEnd) return "move";
	return "action";
};
const pickCategoryAction = (categories, idlePool, facing, current$1) => {
	const cat = pickWeightedCategory(categories, facing);
	if (!cat) return {
		id: "FALLBACK",
		name: pick(idlePool, current$1)
	};
	return {
		id: cat.id,
		name: pick(cat.actions, current$1)
	};
};

//#endregion
//#region src/shared/balance/tone.ts
const QUOTA_WARN_PERCENT = 70;
const QUOTA_CRIT_PERCENT = 90;
function quotaTone(percent) {
	if (percent >= QUOTA_CRIT_PERCENT) return "crit";
	if (percent >= QUOTA_WARN_PERCENT) return "warn";
	return "ok";
}

//#endregion
//#region src/shared/balance/parse.ts
const CUSTOM_TAGS = [
	"div",
	"span",
	"i",
	"b",
	"strong",
	"em",
	"img"
];
const CUSTOM_STYLE_KEYS = new Set([
	"display",
	"flex",
	"flexDirection",
	"flexWrap",
	"alignItems",
	"justifyContent",
	"gap",
	"margin",
	"marginTop",
	"marginRight",
	"marginBottom",
	"marginLeft",
	"padding",
	"paddingTop",
	"paddingRight",
	"paddingBottom",
	"paddingLeft",
	"width",
	"height",
	"minWidth",
	"maxWidth",
	"minHeight",
	"maxHeight",
	"color",
	"fontSize",
	"fontWeight",
	"fontStyle",
	"lineHeight",
	"letterSpacing",
	"textAlign",
	"textDecoration",
	"whiteSpace",
	"verticalAlign",
	"fontVariantNumeric",
	"background",
	"backgroundColor",
	"border",
	"borderTop",
	"borderBottom",
	"borderLeft",
	"borderRight",
	"borderRadius",
	"overflow",
	"opacity"
]);
/** 样式值里一律禁止的片段：外部资源、表达式、注释截断。要图请用 `img` 节点（地址另有限制）。 */
const BANNED_STYLE_VALUE = /url\(|expression|javascript:|vbscript:|@import|\\|\/\*/i;
const CUSTOM_LIMITS = {
	maxDepth: 6,
	maxNodes: 200,
	maxChildren: 24,
	maxText: 120,
	maxStyleValue: 64,
	maxSrc: 512,
	maxViews: 4
};
/**
* 递归解析并校验一个节点，把外部输入转成视图树。
*
* 任一节点不合法即整树返回 null：部分渲染会得到一棵缺了一块的气泡，比这一拍不显示更误导人；
* 单个样式属性非法只丢那一条，不值得为此整树作废。
*
* @param raw - 外部节点；类型未知，逐层校验后才进入视图树。
* @param depth - 当前深度，根为 0。
* @param budget - 全树节点计数，跨递归共享。
* @returns 合法节点；不合法返回 null，调用方据此跳过这一拍。
*/
function parseCustomNode(raw, depth, budget) {
	if (!raw || typeof raw !== "object") return null;
	if (depth >= CUSTOM_LIMITS.maxDepth) return null;
	budget.nodes += 1;
	if (budget.nodes > CUSTOM_LIMITS.maxNodes) return null;
	const n = raw;
	const tag = typeof n.tag === "string" ? n.tag : "";
	if (!CUSTOM_TAGS.includes(tag)) return null;
	const node = { tag };
	if (typeof n.text === "string" && n.text.length > 0) node.text = n.text.slice(0, CUSTOM_LIMITS.maxText);
	if (tag === "img") {
		const src = typeof n.src === "string" ? n.src.trim() : "";
		if (!/^https?:\/\//i.test(src) || src.length > CUSTOM_LIMITS.maxSrc) return null;
		node.src = src;
	}
	if (n.style && typeof n.style === "object" && !Array.isArray(n.style)) {
		const style = {};
		for (const [k, v] of Object.entries(n.style)) {
			if (!CUSTOM_STYLE_KEYS.has(k)) continue;
			if (typeof v !== "string") continue;
			const value = v.trim();
			if (value === "" || value.length > CUSTOM_LIMITS.maxStyleValue) continue;
			if (BANNED_STYLE_VALUE.test(value)) continue;
			style[k] = value;
		}
		if (Object.keys(style).length > 0) node.style = style;
	}
	if (Array.isArray(n.children)) {
		if (n.children.length > CUSTOM_LIMITS.maxChildren) return null;
		const children = [];
		for (const child of n.children) {
			const parsed = parseCustomNode(child, depth + 1, budget);
			if (parsed === null) return null;
			children.push(parsed);
		}
		if (children.length > 0) node.children = children;
	}
	return node;
}
/** 可选数字：缺省返回 undefined，出现但非法返回 null，调用方据此跳过这一拍而不是把坏数字送进展示层。 */
function optNum(value) {
	if (value === void 0 || value === null) return void 0;
	const n = Number(value);
	return Number.isFinite(n) ? n : null;
}
/**
* 解析区间累计用量：缺省返回 undefined（服务商没有这项数据），出现但不完整或非法返回 null。
*
* 五个数字缺一不可——少一个就拼不出一页可信的用量，宁可这一拍整片不显示，也不拿 0 顶替。
*/
function parseUsage(raw) {
	if (raw === void 0) return void 0;
	if (!raw || typeof raw !== "object") return null;
	const u = raw;
	const fields = [
		u.totalTokens,
		u.inputTokens,
		u.outputTokens,
		u.requests,
		u.spentUsd
	].map(optNum);
	if (fields.some((n) => typeof n !== "number")) return null;
	const [totalTokens, inputTokens, outputTokens, requests, spentUsd] = fields;
	return {
		totalTokens,
		inputTokens,
		outputTokens,
		requests,
		spentUsd
	};
}
function toBalanceState(raw) {
	if (!raw || typeof raw !== "object") return null;
	const r = raw;
	const provider = String(r.provider ?? "unknown");
	if (r.ok !== true) {
		const reason = r.reason === "unsupported" || r.reason === "credential-missing" || r.reason === "fetch-error" ? r.reason : "fetch-error";
		return {
			provider,
			ok: false,
			reason,
			message: typeof r.message === "string" ? r.message : void 0
		};
	}
	const d = r.data;
	if (!d || typeof d !== "object") return null;
	if (r.shape === "windows") {
		const monthly = optNum(d.monthly);
		const rolling = optNum(d.rolling);
		const weekly = optNum(d.weekly);
		const rollingCapUsd = optNum(d.rollingCapUsd);
		const weeklyCapUsd = optNum(d.weeklyCapUsd);
		const monthlyCapUsd = optNum(d.monthlyCapUsd);
		const usage = parseUsage(d.usage);
		if (monthly === void 0 || monthly === null) return null;
		if (rolling === null || weekly === null || rollingCapUsd === null || weeklyCapUsd === null || monthlyCapUsd === null || usage === null) return null;
		return {
			provider,
			shape: "windows",
			ok: true,
			rolling,
			weekly,
			monthly,
			rollingCapUsd,
			weeklyCapUsd,
			monthlyCapUsd,
			...usage ? { usage } : {},
			rollingLabel: typeof d.rollingLabel === "string" && d.rollingLabel.length > 0 ? d.rollingLabel : void 0,
			rollingResetsAt: typeof d.rollingResetsAt === "string" ? d.rollingResetsAt : void 0,
			weeklyResetsAt: typeof d.weeklyResetsAt === "string" ? d.weeklyResetsAt : void 0,
			monthlyResetsAt: typeof d.monthlyResetsAt === "string" ? d.monthlyResetsAt : void 0
		};
	}
	if (r.shape === "money") {
		const raw$1 = Array.isArray(d.wallets) ? d.wallets : [];
		const wallets = [];
		for (const item of raw$1) {
			if (!item || typeof item !== "object") continue;
			const w = item;
			if (typeof w.currency !== "string" || w.currency.length === 0) continue;
			if (typeof w.total !== "string" || w.total.length === 0) continue;
			wallets.push({
				currency: w.currency,
				total: w.total,
				granted: typeof w.granted === "string" && w.granted.length > 0 ? w.granted : "0.00",
				toppedUp: typeof w.toppedUp === "string" && w.toppedUp.length > 0 ? w.toppedUp : "0.00",
				fullBalance: typeof w.fullBalance === "string" && w.fullBalance.length > 0 ? w.fullBalance : void 0
			});
		}
		if (wallets.length === 0) return null;
		return {
			provider,
			shape: "money",
			ok: true,
			wallets,
			tier: d.tier === "peak" || d.tier === "idle" ? d.tier : void 0
		};
	}
	if (r.shape === "points") {
		if (typeof d.unit !== "string" || d.unit.length === 0) return null;
		if (typeof d.total !== "string" || d.total.length === 0) return null;
		return {
			provider,
			shape: "points",
			ok: true,
			points: {
				unit: d.unit,
				total: d.total,
				full: typeof d.full === "string" && d.full.length > 0 ? d.full : void 0
			}
		};
	}
	if (r.shape === "custom") {
		let views = [];
		if (Array.isArray(d.views) && d.views.length > 0) {
			if (d.views.length > CUSTOM_LIMITS.maxViews) return null;
			for (const raw$1 of d.views) {
				const page = parseCustomNode(raw$1, 0, { nodes: 0 });
				if (!page) return null;
				views.push(page);
			}
		} else {
			const rows = parseCustomNode(d.rows, 0, { nodes: 0 });
			if (!rows) return null;
			views = [rows];
			if (d.detailRows !== void 0) {
				const detail = parseCustomNode(d.detailRows, 0, { nodes: 0 });
				if (!detail) return null;
				views.push(detail);
			}
		}
		const pct = typeof d.percent === "number" && Number.isFinite(d.percent) ? Math.max(0, Math.min(100, d.percent)) : void 0;
		return {
			provider,
			shape: "custom",
			ok: true,
			custom: {
				views,
				percent: pct
			}
		};
	}
	return null;
}

//#endregion
//#region src/shared/balance/handlers/custom.ts
const customHandler = {
	percent: (v) => v.custom?.percent,
	rows: () => [],
	detail: () => [],
	views: (v) => v.custom?.views
};

//#endregion
//#region src/shared/balance/handlers/money.ts
/**
* 各币种按自己的基准算剩余比例，相加后折算成已用百分比。
*
* 没有基准的币种跳过，不替它猜一个；一个带基准的币种都没有则返回 undefined，不播档位动画。
*/
function moneyPercent(v) {
	let remaining = 0;
	let based = 0;
	for (const w of v.wallets ?? []) {
		const total = Number(w.total);
		const full = Number(w.fullBalance);
		if (!Number.isFinite(total) || !Number.isFinite(full) || full <= 0) continue;
		remaining += total / full;
		based++;
	}
	if (based === 0) return void 0;
	return Math.max(0, Math.min(100, 100 - remaining * 100));
}
/**
* 一行「餘額（峰/谷）¥x.xx」。
*
* 只显示 total 非 0 的币种：负数要显示（透支是真的欠钱），正好 0 的不占地方；CNY 优先，
* 用符号拼接、以「/」分隔；全为 0 时兜底 ¥0.00，否则气泡会空一行。档位装饰只有提供该计价
* 规则的服务商才有，没有就不加括号那一段。
*/
function moneyRows(v) {
	const visible = (v.wallets ?? []).filter((w) => Number(w.total) !== 0).sort((a, b) => (a.currency === "CNY" ? 0 : 1) - (b.currency === "CNY" ? 0 : 1));
	const amount = visible.length > 0 ? visible.map((w) => (w.currency === "USD" ? "$" : "¥") + w.total).join("/") : "¥0.00";
	if (!v.tier) return [{
		role: "label",
		text: "餘額 " + amount
	}];
	return [
		{
			role: "label",
			text: "餘額（"
		},
		{
			role: "tier",
			tier: v.tier,
			text: v.tier === "peak" ? "峰" : "谷"
		},
		{
			role: "label",
			text: "）" + amount
		}
	];
}
const moneyHandler = {
	percent: moneyPercent,
	rows: moneyRows
};

//#endregion
//#region src/shared/balance/handlers/points.ts
/**
* 与 money 同一套「按基准折算」的数学，数据来自 points 而非 wallets。
*
* 没有基准或基准非法则返回 undefined，不播档位动画，也不替服务商猜一个。
*/
function pointsPercent(v) {
	const total = Number(v.points?.total);
	const full = Number(v.points?.full);
	if (!Number.isFinite(total) || !Number.isFinite(full) || full <= 0) return void 0;
	return Math.max(0, Math.min(100, 100 - total / full * 100));
}
/**
* 一行「餘額 800 积分」。
*
* 单位是数据带出的后缀，绝不套货币符号——$/¥ 那套判断只属于 money；0 也照常显示，0 积分是真实读数。
*/
function pointsRows(v) {
	const p = v.points;
	if (!p) return [{
		role: "label",
		text: "積分資料不可用"
	}];
	return [{
		role: "label",
		text: "餘額 " + p.total + " " + p.unit
	}];
}
const pointsHandler = {
	percent: pointsPercent,
	rows: pointsRows
};

//#endregion
//#region src/shared/balance/handlers/windows.ts
const WINDOW_LABELS = {
	weekly: "周",
	monthly: "月"
};
const DEFAULT_ROLLING_LABEL = "5h";
/** 取窗口展示名：滚动窗用服务商自报值，周与月走固定表 */
function windowLabel(v, w) {
	if (w === "rolling") return v.rollingLabel ?? DEFAULT_ROLLING_LABEL;
	return WINDOW_LABELS[w];
}
/** 各窗口的满额度，全部来自数据 */
function windowQuotas(v) {
	return {
		rolling: v.rollingCapUsd,
		weekly: v.weeklyCapUsd,
		monthly: v.monthlyCapUsd
	};
}
function urgentWindow(v) {
	if (v.shape !== "windows") return void 0;
	const quotas = windowQuotas(v);
	const resets = {
		rolling: v.rollingResetsAt,
		weekly: v.weeklyResetsAt,
		monthly: v.monthlyResetsAt
	};
	const present = [
		"rolling",
		"weekly",
		"monthly"
	].filter((w) => v[w] !== void 0);
	if (present.length === 0) return void 0;
	const allQuotas = present.every((w) => {
		const quota = quotas[w];
		return quota !== void 0 && quota > 0;
	});
	let best;
	for (const w of present) {
		const percent = v[w] ?? 0;
		const quota = quotas[w];
		const cand = {
			label: windowLabel(v, w),
			percent,
			quotaUsd: quota,
			remainingUsd: allQuotas && quota !== void 0 ? quota * (100 - percent) / 100 : void 0,
			resetsAt: resets[w]
		};
		if (best === void 0) {
			best = cand;
			continue;
		}
		const moreUrgent = allQuotas ? (cand.remainingUsd ?? 0) < (best.remainingUsd ?? 0) : cand.percent > best.percent;
		if (moreUrgent) best = cand;
	}
	return best;
}
function resetInText(iso) {
	if (!iso) return "";
	const t = new Date(iso).getTime();
	if (!Number.isFinite(t)) return "";
	const delta = t - Date.now();
	if (delta <= 0) return "已重置";
	const hoursF = delta / 36e5;
	if (hoursF >= 96) return (Math.round(hoursF / 24 * 10) / 10).toFixed(1) + " 天";
	return Math.max(.1, Math.round(hoursF * 10) / 10).toFixed(1) + " 小時";
}
/** 三窗口取最大值，只有月窗口时就是它本身 */
function windowsPercent(v) {
	return Math.max(v.rolling ?? 0, v.weekly ?? 0, v.monthly ?? 0);
}
/** 把 resetInText 的三种返回翻成一句提示：空串 = 时间未知，'已重置' = 已经过点，其余 = 倒计时。 */
function resetPhrase(reset) {
	if (reset === "") return "重置時間未知";
	return reset === "已重置" ? reset : reset + "重置";
}
/** 两行：最紧迫窗口的已用百分比与重置倒计时 */
function windowsRows(v) {
	const w = urgentWindow(v);
	if (!w) return [{
		role: "label",
		text: "額度資料不可用"
	}];
	const reset = resetInText(w.resetsAt);
	return [{
		role: "label",
		text: w.label + "額度已用 " + Math.round(w.percent) + "%"
	}, {
		role: "sub",
		text: resetPhrase(reset)
	}];
}
/**
* 展开态每个存在的窗口一行：窗口名、进度条、已用百分比与重置倒计时。
*
* 只列存在的窗口，rolling 与 weekly 缺省表示该服务商没有这个窗口，不补 0、不画空条。
*/
function windowsDetail(v) {
	const resets = {
		rolling: v.rollingResetsAt,
		weekly: v.weeklyResetsAt,
		monthly: v.monthlyResetsAt
	};
	const rows = [];
	for (const w of [
		"rolling",
		"weekly",
		"monthly"
	]) {
		const percent = v[w];
		if (percent === void 0) continue;
		const reset = resetInText(resets[w]);
		const usedText = Math.round(percent) + "%";
		const resetText = resetPhrase(reset);
		rows.push({
			role: "quota",
			text: windowLabel(v, w) + " " + usedText + " " + resetText,
			label: windowLabel(v, w),
			percent,
			tone: quotaTone(percent),
			usedText,
			resetText
		});
	}
	return rows.length > 0 ? rows : windowsRows(v);
}
/** 紧凑计数：1.2B / 96.0M / 478.3K，千以下取整。固定一位小数——同一页三个数字宽度稳定，不随取值跳动。 */
function compactCount(n) {
	if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
	if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
	if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
	return String(Math.round(n));
}
/**
* 第三页：本期累计用量。一行 `usage` 承载整张卡，两端摆成三行两列——
* 「Token / 总量」「输入 / 输出」「本期请求数 / 花费」，总量是唯一的大字。
*
* 服务商没给这项数据时返回 undefined，由页数判定决定气泡只有两页；给的一半数字不会被拼进来。
*/
function windowsUsage(v) {
	const u = v.usage;
	if (!u) return void 0;
	const total = compactCount(u.totalTokens);
	const input = compactCount(u.inputTokens) + " 入";
	const output = compactCount(u.outputTokens) + " 出";
	const period = "本期 " + u.requests + " 次";
	const spend = "$" + u.spentUsd.toFixed(2);
	const sum = u.inputTokens + u.outputTokens;
	const inputPercent = sum > 0 ? u.inputTokens / sum * 100 : void 0;
	return [{
		role: "usage",
		text: "Token " + total + " · " + input + " / " + output + " · " + period + " · " + spend,
		title: "Token",
		total,
		input,
		output,
		period,
		spend,
		inputPercent
	}];
}
const windowsHandler = {
	percent: windowsPercent,
	rows: windowsRows,
	detail: windowsDetail,
	usage: windowsUsage
};

//#endregion
//#region src/shared/balance/handlers/index.ts
const HANDLERS = {
	windows: windowsHandler,
	money: moneyHandler,
	points: pointsHandler,
	custom: customHandler
};

//#endregion
//#region src/shared/balance/percent.ts
function balancePercent(v) {
	return HANDLERS[v.shape].percent(v);
}
function balanceEventIndex(p) {
	if (p === 100) return 5;
	const i = Math.floor(p / 20);
	return i < 5 ? i : 4;
}

//#endregion
//#region src/shared/balance/view.ts
/**
* 不可用状态的气泡行：显式给出原因，绝不伪造数字。
*
* 次要行为空的会被剔除——空 div 在气泡里会白占一行高度。
*/
function unavailableRows(state) {
	const rows = state.reason === "unsupported" ? [{
		role: "error",
		text: "當前服務商暫不支援餘額查詢"
	}, {
		role: "sub",
		text: "目前服務商：" + state.provider
	}] : state.reason === "credential-missing" ? [{
		role: "error",
		text: "缺少餘額查詢憑證"
	}, {
		role: "sub",
		text: state.message ?? ""
	}] : [{
		role: "error",
		text: "餘額查詢失敗"
	}, {
		role: "sub",
		text: state.message ?? ""
	}];
	return rows.filter((r) => r.role !== "quota" && r.text !== "");
}
function balanceDetailView(state) {
	if (!state.ok) return unavailableRows(state);
	const handler = HANDLERS[state.shape];
	return handler.detail ? handler.detail(state) : handler.rows(state);
}
function balancePageCount$1(state) {
	if (!state.ok) return 1;
	if (state.shape === "custom") return Math.max(1, customViews(state)?.length ?? 1);
	if (state.shape !== "windows") return 1;
	return state.usage ? 3 : 2;
}
function balancePageView(state, page) {
	if (!state.ok) return unavailableRows(state);
	const handler = HANDLERS[state.shape];
	if (state.shape !== "windows" || page <= 0) return handler.rows(state);
	if (page === 1 || !state.usage) return balanceDetailView(state);
	return handler.usage?.(state) ?? balanceDetailView(state);
}
function customViews(state) {
	if (!state.ok || state.shape !== "custom") return void 0;
	const views = HANDLERS[state.shape].views?.(state);
	return views && views.length > 0 ? views : void 0;
}
function customClickable(state) {
	return (customViews(state)?.length ?? 0) > 1;
}

//#endregion
//#region src/shared/balance/notice.ts
function decideBalanceNotice(state, lastKey, explicit) {
	if (state.ok) return {
		show: false,
		key: null
	};
	const key = state.reason + ":" + state.provider;
	return {
		show: explicit || key !== lastKey,
		key
	};
}

//#endregion
//#region src/shared/work-status.ts
const WORK_STATUS_STATES = [
	"thinking",
	"working",
	"result",
	"waiting",
	"success",
	"error"
];
const WORK_STATUS_INDEX = {
	thinking: 0,
	working: 1,
	result: 2,
	waiting: 3,
	success: 4,
	error: 5
};
function toWorkStatus(raw) {
	if (!raw || typeof raw !== "object") return null;
	const r = raw;
	const state = r.state === null || typeof r.state === "string" && WORK_STATUS_STATES.includes(r.state) ? r.state : null;
	return {
		state,
		task: typeof r.task === "string" ? r.task : null
	};
}

//#endregion
//#region src/shared/state.ts
/** 叶子规范化：形状不对（非对象或 counter 非数字）→ null，不让脏数据进渲染层。 */
function normLeaf(value) {
	if (!value || typeof value !== "object") return null;
	const leaf$1 = value;
	if (typeof leaf$1.counter !== "number" || !Number.isFinite(leaf$1.counter)) return null;
	return {
		counter: leaf$1.counter,
		data: leaf$1.data ?? null
	};
}
async function fetchState(baseUrl = ROUTE_PATH + "/state", wait) {
	try {
		const url = wait ? `${baseUrl}?since=${wait.since}&timeout=${wait.timeoutMs}` : baseUrl;
		const res = await fetch(url, { cache: "no-store" });
		if (!res.ok) return null;
		const raw = await res.json().catch(() => null);
		if (!raw || typeof raw !== "object" || raw.ok === false) return null;
		const sections = {};
		const rawSections = raw.sections && typeof raw.sections === "object" ? raw.sections : {};
		for (const [name, value] of Object.entries(rawSections)) {
			const leaf$1 = normLeaf(value);
			if (leaf$1) sections[name] = leaf$1;
		}
		const pets = {};
		const rawPets = raw.pets && typeof raw.pets === "object" ? raw.pets : {};
		for (const [petId, entry] of Object.entries(rawPets)) {
			if (!entry || typeof entry !== "object") continue;
			const leaves = {};
			for (const [name, value] of Object.entries(entry)) {
				const leaf$1 = normLeaf(value);
				if (leaf$1) leaves[name] = leaf$1;
			}
			pets[petId] = leaves;
		}
		return {
			counter: typeof raw.counter === "number" && Number.isFinite(raw.counter) ? raw.counter : void 0,
			sections,
			pets
		};
	} catch {
		return null;
	}
}
/** 遍历 S 的所有叶子（sections 在前、pets 在后）。 */
function* walkLeaves(s) {
	for (const [name, leaf$1] of Object.entries(s.sections ?? {})) yield ["sections." + name, leaf$1];
	for (const [petId, leaves] of Object.entries(s.pets ?? {})) for (const [name, leaf$1] of Object.entries(leaves ?? {})) yield ["pets." + petId + "." + name, leaf$1];
}
function flattenCounters(s) {
	const out = {};
	for (const [path, leaf$1] of walkLeaves(s)) out[path] = leaf$1.counter;
	return out;
}
function takeChanged(s, baseline) {
	const out = [];
	for (const [path, leaf$1] of walkLeaves(s)) {
		if (baseline[path] === leaf$1.counter) continue;
		baseline[path] = leaf$1.counter;
		out.push({
			path,
			leaf: leaf$1
		});
	}
	return out;
}
/** 分段叶子名的全集；新增 section 叶子时与 {@link SectionLeafName} 一起改。 */
const SECTION_LEAF_NAMES = [
	"config",
	"balance",
	"workStatus",
	"notify",
	"menu"
];
/** 宠物叶子名的全集；新增宠物叶子时与 {@link PetLeafName} 一起改。 */
const PET_LEAF_NAMES = [
	"say",
	"anim",
	"position",
	"throw",
	"lock",
	"sleep"
];
/** 把字符串收窄成分段叶子名。 */
function isSectionLeafName(name) {
	return SECTION_LEAF_NAMES.includes(name);
}
/** 把字符串收窄成宠物叶子名。 */
function isPetLeafName(name) {
	return PET_LEAF_NAMES.includes(name);
}
function resolveLeafPath(path) {
	if (path.startsWith("sections.")) {
		const name$1 = path.slice(9);
		return isSectionLeafName(name$1) ? {
			where: "section",
			name: name$1
		} : null;
	}
	if (!path.startsWith("pets.")) return null;
	const rest = path.slice(5);
	const dot = rest.lastIndexOf(".");
	if (dot <= 0) return null;
	const name = rest.slice(dot + 1);
	return isPetLeafName(name) ? {
		where: "pet",
		name,
		petId: rest.slice(0, dot)
	} : null;
}
function readBalance(leaf$1) {
	const state = toBalanceState(leaf$1.data);
	if (!state) return null;
	const manual = leaf$1.data.manual === true;
	return {
		state,
		manual
	};
}
function readSay(leaf$1) {
	if (!leaf$1.data || typeof leaf$1.data !== "object") return null;
	const d = leaf$1.data;
	if (d.clear === true) return { kind: "clear" };
	if (typeof d.text !== "string" || !d.text) return null;
	return {
		kind: "say",
		text: d.text,
		image: typeof d.image === "string" ? d.image : void 0,
		url: typeof d.url === "string" ? d.url : void 0,
		duration: typeof d.duration === "number" && Number.isFinite(d.duration) && d.duration >= 0 ? d.duration : void 0,
		anim: typeof d.anim === "boolean" ? d.anim : void 0,
		voiceTo: d.voiceTo === "web" || d.voiceTo === "desktop" ? d.voiceTo : void 0
	};
}
function readWorkStatus(leaf$1) {
	return toWorkStatus(leaf$1.data);
}
function readAnim(leaf$1) {
	if (!leaf$1.data || typeof leaf$1.data !== "object") return null;
	const d = leaf$1.data;
	const name = typeof d.name === "string" && d.name ? d.name : void 0;
	const url = typeof d.url === "string" && d.url ? d.url : void 0;
	if (name === void 0 && url === void 0) return null;
	return {
		name,
		url,
		playbackId: typeof d.playbackId === "string" && d.playbackId ? d.playbackId : void 0,
		facing: d.facing === "left" || d.facing === "right" ? d.facing : void 0
	};
}
function readLock(leaf$1) {
	if (!leaf$1.data || typeof leaf$1.data !== "object") return null;
	const d = leaf$1.data;
	if (d.locked === false) return { locked: false };
	if (d.locked !== true) return null;
	if (typeof d.expiresAt !== "number" || !Number.isFinite(d.expiresAt)) return null;
	return {
		locked: true,
		expiresAt: d.expiresAt
	};
}
function readSleep(leaf$1) {
	if (!leaf$1.data || typeof leaf$1.data !== "object") return null;
	const d = leaf$1.data;
	if (d.sleeping === false) return { sleeping: false };
	if (d.sleeping !== true) return null;
	for (const name of [
		d.start,
		d.loop,
		d.end
	]) if (typeof name !== "string" || name === "") return null;
	return {
		sleeping: true,
		start: d.start,
		loop: d.loop,
		end: d.end
	};
}
function readPosition(leaf$1) {
	if (!leaf$1.data || typeof leaf$1.data !== "object") return null;
	const d = leaf$1.data;
	if (typeof d.x !== "number" || !Number.isFinite(d.x)) return null;
	if (typeof d.y !== "number" || !Number.isFinite(d.y)) return null;
	if (d.mode !== "instant" && d.mode !== "spring" && d.mode !== "line") return null;
	if (d.mode === "line") {
		if (typeof d.duration !== "number" || !Number.isFinite(d.duration) || d.duration < 0) return null;
		return {
			x: d.x,
			y: d.y,
			mode: "line",
			duration: d.duration
		};
	}
	return {
		x: d.x,
		y: d.y,
		mode: d.mode,
		duration: 0
	};
}
function readThrow(leaf$1) {
	if (!leaf$1.data || typeof leaf$1.data !== "object") return null;
	const d = leaf$1.data;
	if (typeof d.angle !== "number" || !Number.isFinite(d.angle)) return null;
	if (typeof d.power !== "number" || !Number.isFinite(d.power) || d.power <= 0) return null;
	return {
		angle: d.angle,
		power: d.power
	};
}
async function postAction(baseUrl, body) {
	try {
		const res = await fetch(baseUrl, {
			method: "POST",
			...body === void 0 ? {} : {
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body)
			}
		});
		if (!res.ok) return false;
		const data = await res.json().catch(() => null);
		return data?.ok === true;
	} catch {
		return false;
	}
}

//#endregion
//#region src/shared/fonts.ts
const FONT_PRESETS = [
	{
		id: "candy",
		stack: "\"ShangshouSoftCandy\",\"Yuanti SC\",\"YouYuan\",\"幼圓\",\"Comic Sans MS\",\"PingFang SC\",\"Microsoft YaHei\",sans-serif"
	},
	{
		id: "yahei",
		stack: "\"Microsoft YaHei\",\"PingFang SC\",sans-serif"
	},
	{
		id: "youyuan",
		stack: "\"YouYuan\",\"Yuanti SC\",sans-serif"
	},
	{
		id: "kaiti",
		stack: "\"KaiTi\",\"STKaiti\",serif"
	},
	{
		id: "simsun",
		stack: "\"SimSun\",\"Songti SC\",serif"
	},
	{
		id: "comic",
		stack: "\"Comic Sans MS\",\"Comic Sans\",cursive"
	},
	{
		id: "system",
		stack: "system-ui,sans-serif"
	}
];
const FONT_SIZE_MIN = 4;
const FONT_SIZE_MAX = 200;
const DEFAULT_FONT = {
	family: "candy",
	size: 21,
	followPet: true
};
function fontStackOf(id) {
	return (FONT_PRESETS.find((p) => p.id === id) ?? FONT_PRESETS[0]).stack;
}
const FONT_REF_SIZE = 462;
const BUBBLE_FONT_BASE_PX = .0455 * FONT_REF_SIZE;
const TIP_FONT_BASE_PX = .026 * FONT_REF_SIZE;
function resolveFontPx(font, size) {
	const own = Number(font?.size);
	const ratio = Number.isFinite(own) && own > 0 ? own / DEFAULT_FONT.size : 1;
	const w = Number(size);
	const follow = font?.followPet !== false;
	const scale = follow && Number.isFinite(w) && w > 0 ? w / FONT_REF_SIZE : 1;
	return {
		bubble: BUBBLE_FONT_BASE_PX * ratio * scale,
		tip: TIP_FONT_BASE_PX * ratio * scale
	};
}

//#endregion
//#region src/shared/pet-size.ts
/** 人物本体宽度占画框宽度的比例；由命中框反推（240/640），不在别处再写一份 0.375。 */
const BODY_WIDTH_RATIO = (HIT_BOX.x1 - HIT_BOX.x0) / 640;
const SIZE_PERCENT_MIN = 1;
const SIZE_PERCENT_DEFAULT = 20;
function isValidSizePercent(value) {
	return typeof value === "number" && Number.isFinite(value) && value >= SIZE_PERCENT_MIN;
}
function resolvePetSizePx(sizePx, sizePercent, viewportWidthPx) {
	const percent = sizePercent ?? SIZE_PERCENT_DEFAULT;
	if (!isValidSizePercent(percent)) return sizePx;
	if (!Number.isFinite(viewportWidthPx) || viewportWidthPx <= 0) return sizePx;
	const bodyWidthPx = viewportWidthPx * percent / 100;
	return Math.min(sizePx, bodyWidthPx / BODY_WIDTH_RATIO);
}

//#endregion
//#region src/shared/whisper.ts
function whisperBubbleView(state) {
	if (state.ok) return [{
		role: "label",
		text: state.text
	}];
	const msg = state.reason === "provider-missing" ? "當前對話未設定模型，碎碎念不可用" : "碎碎念生成失敗" + (state.message ? "：" + state.message : "");
	return [{
		role: "label",
		text: msg
	}];
}
function memeImageUrl(name, base = ROUTE_PATH, assetRoot = "") {
	const root = String(assetRoot ?? "").trim();
	const prefix = root ? "/pic/memes/" + encodeURIComponent(root) : "/pic/memes";
	return base + prefix + "/" + encodeURIComponent(name) + ".png";
}
const MEME_IMG_CLASS = "pet-bub-img";
const MEME_BUBBLE_CLASS = "has-img";
const MEME_BUBBLE_CSS = [
	".pet-bub-img{--m:var(--f,calc(var(--dsh-pet-size,var(--pet-size,462px))*0.0455));display:block;width:calc(var(--m)*7.4725);max-width:100%;height:auto;border-radius:calc(var(--m)*0.5714);margin:0 auto calc(var(--m)*0.3736);object-fit:cover;pointer-events:none;user-select:none}",
	".pet-bubble.has-img,.dsh-pet-bubble.has-img{min-width:0}",
	".dsh-pet-voice-badge{position:absolute;right:calc(var(--f,21px)*0.25);bottom:calc(var(--f,21px)*0.15);width:calc(var(--f,21px)*0.66);height:calc(var(--f,21px)*0.66);display:flex;align-items:center;justify-content:center;font-size:calc(var(--f,21px)*0.5);line-height:1;opacity:.65;pointer-events:none}",
	".dsh-pet-voice-badge.is-loading::before{content:\"\";width:calc(var(--f,21px)*0.5);height:calc(var(--f,21px)*0.5);border:1.5px solid rgba(43,43,43,.22);border-top-color:rgba(43,43,43,.7);border-radius:50%;animation:dsh-pet-voice-spin .8s linear infinite}",
	"@keyframes dsh-pet-voice-spin{to{transform:rotate(360deg)}}",
	".dsh-pet-voice-badge.is-failed{opacity:.5}"
].join("");
/** 只注入一次（页面已有同一标记则跳过）。 */
let memeCssInjected = false;
function injectMemeBubbleCss() {
	if (memeCssInjected || typeof document === "undefined") return;
	memeCssInjected = true;
	if (document.querySelector("style[data-plugin-css=\"dsh-pet/meme-bubble\"]") !== null) return;
	const tag = document.createElement("style");
	tag.dataset.plugin = "dsh-pet";
	tag.dataset.pluginCss = "dsh-pet/meme-bubble";
	tag.textContent = MEME_BUBBLE_CSS;
	document.head.appendChild(tag);
}

//#endregion
//#region src/client/bubble.ts
/** 气泡内联样式：白色半透明圆泡加底部小尾巴，盒子尺寸锚字号 `--f`，位置锚宠物尺寸。
*  width:max-content 不可省：left:50% 的绝对定位盒可用宽度只有包含块一半，shrink-to-fit
*  会先被卡死；先按内容取宽，再由 max-width 收口。box-sizing 钉死 content-box，避免宿主
*  全局 border-box 把内边距算进宽度；断词用 break-word，数字与单位不会被拆行。
*/
const bubbleCss = [
	`@font-face{font-family:"ShangshouSoftCandy";src:url("${ROUTE_PATH}/font/上首軟糖體.ttf") format("truetype");font-display:swap;font-weight:400}`,
	".dsh-pet-bubble{position:absolute;left:50%;transform:translateX(-50%);bottom:calc(100% - var(--dsh-pet-size)*0.108);width:max-content;min-width:calc(var(--f)*5.7143);max-width:min(calc(var(--f)*16),100%);box-sizing:content-box;padding:calc(var(--f)*0.4835) calc(var(--f)*0.6593);border-radius:calc(var(--f)*0.7692);background:rgba(255,255,255,.92);--f0:var(--dsh-pet-font-bubble,calc(var(--dsh-pet-size)*0.0455));--f:var(--f0);color:#2b2b2b;font-family:var(--dsh-pet-font-family,\"ShangshouSoftCandy\",\"Yuanti SC\",\"YouYuan\",\"幼圓\",\"Comic Sans MS\",\"PingFang SC\",\"Microsoft YaHei\",sans-serif);font-size:var(--f);line-height:1.6;z-index:3;pointer-events:none;box-shadow:0 calc(var(--f)*0.1978) calc(var(--f)*0.7692) rgba(0,0,0,.14),0 1px 3px rgba(0,0,0,.08);backdrop-filter:blur(6px);opacity:0;transition:opacity .25s ease;white-space:normal;overflow-wrap:break-word}",
	".dsh-pet-bubble::after{content:\"\";position:absolute;left:50%;bottom:calc(var(--f)*-0.3736);transform:translateX(-50%);border:calc(var(--f)*0.3736) solid transparent;border-top-color:rgba(255,255,255,.92);border-bottom:none}",
	".dsh-pet-bubble.is-on{opacity:1}",
	".dsh-pet-bubble.dsh-pet-whisper{font-size:calc(var(--f)*0.7473);min-width:calc(var(--f)*2.1978);max-width:min(calc(var(--f)*10.989),100%)}",
	".dsh-pet-bubble .pet-bub-title{font-size:calc(var(--f)*0.7692);color:rgba(43,43,43,.6);margin-bottom:calc(var(--f)*0.1978)}",
	".dsh-pet-bubble .pet-bub-row{display:flex;justify-content:space-between;gap:calc(var(--f)*0.6593);flex-wrap:wrap}",
	".dsh-pet-bubble .pet-bub-row>span{white-space:nowrap}",
	".dsh-pet-bubble .pet-bub-sub{font-size:calc(var(--f)*0.7692);color:rgba(43,43,43,.6)}",
	".dsh-pet-bubble .pet-bub-val{font-variant-numeric:tabular-nums;font-weight:650;color:#1f1f1f}",
	".dsh-pet-bubble .pet-bub-err{color:#d94f3d;font-size:calc(var(--f)*0.7692)}",
	".dsh-pet-bubble .pet-bub-tag{margin-left:calc(var(--f)*0.2857);font-size:calc(var(--f)*0.4835);color:rgba(43,43,43,.55);border:1px solid rgba(43,43,43,.25);border-radius:calc(var(--f)*0.2857);padding:0 calc(var(--f)*0.1978);vertical-align:1px}",
	".dsh-pet-bubble .pet-bub-tier{font-weight:700}",
	".dsh-pet-bubble .pet-bub-tier-peak{color:#e53935}",
	".dsh-pet-bubble .pet-bub-tier-idle{color:#2e9e4f}",
	".dsh-pet-bubble.is-clickable{pointer-events:auto;cursor:pointer}",
	".dsh-pet-bubble.is-expanded{--f:calc(var(--f0)*0.6);width:min(calc(var(--f)*21),100%);max-width:100%}",
	".dsh-pet-bubble.is-on.is-fading{opacity:0}",
	".dsh-pet-bubble .pet-bub-quota{display:flex;align-items:center;gap:calc(var(--f)*0.4);margin:calc(var(--f)*0.13) 0}",
	".dsh-pet-bubble .pet-bub-quota-label{flex:none;min-width:calc(var(--f)*1.9);font-size:calc(var(--f)*0.7692);color:rgba(43,43,43,.6)}",
	".dsh-pet-bubble .pet-bub-quota-bar{flex:1 1 auto;height:calc(var(--f)*0.5);border-radius:calc(var(--f)*0.25);background:rgba(43,43,43,.12);overflow:hidden}",
	".dsh-pet-bubble .pet-bub-quota-fill{display:block;height:100%;border-radius:inherit;background:#2e9e4f}",
	".dsh-pet-bubble .pet-bub-quota-fill.pet-bub-quota-warn{background:#e8952f}",
	".dsh-pet-bubble .pet-bub-quota-fill.pet-bub-quota-crit{background:#e53935}",
	".dsh-pet-bubble .pet-bub-quota-used{flex:none;min-width:calc(var(--f)*2.2);text-align:right;font-variant-numeric:tabular-nums;font-weight:650;color:#1f1f1f}",
	".dsh-pet-bubble .pet-bub-quota-reset{flex:none;min-width:calc(var(--f)*2.6);text-align:right;font-size:calc(var(--f)*0.7692);color:rgba(43,43,43,.6)}",
	".dsh-pet-bubble .pet-bub-usage{display:flex;flex-direction:column;gap:calc(var(--f)*0.22);margin:calc(var(--f)*0.1) 0}",
	".dsh-pet-bubble .pet-bub-usage-line{display:flex;align-items:baseline;justify-content:space-between;gap:calc(var(--f)*0.8);line-height:1.45}",
	".dsh-pet-bubble .pet-bub-usage-title{font-size:calc(var(--f)*0.7692);color:rgba(43,43,43,.62)}",
	".dsh-pet-bubble .pet-bub-usage-total{font-size:calc(var(--f)*1.45);line-height:1.2;font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:-.02em;color:#1f1f1f}",
	".dsh-pet-bubble .pet-bub-usage-in{font-size:calc(var(--f)*0.7692);font-variant-numeric:tabular-nums;color:#3f6ea8}",
	".dsh-pet-bubble .pet-bub-usage-out{font-size:calc(var(--f)*0.7692);font-variant-numeric:tabular-nums;color:#b4703c}",
	".dsh-pet-bubble .pet-bub-usage-period{font-size:calc(var(--f)*0.7692);color:rgba(43,43,43,.62)}",
	".dsh-pet-bubble .pet-bub-usage-spend{font-size:calc(var(--f)*0.7692);font-weight:650;font-variant-numeric:tabular-nums;color:#1f1f1f}",
	".dsh-pet-bubble .pet-bub-usage-bar{display:flex;height:calc(var(--f)*0.3);border-radius:calc(var(--f)*0.15);overflow:hidden;background:rgba(43,43,43,.1);margin:calc(var(--f)*0.05) 0}",
	".dsh-pet-bubble .pet-bub-usage-bar-in{display:block;height:100%;background:#3f6ea8}",
	".dsh-pet-bubble .pet-bub-usage-bar-out{display:block;height:100%;background:#b4703c}"
].join("\n");
/** 注入气泡样式，每页只注入一次。 */
function injectBubbleCss() {
	if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=\"dsh-pet/bubble\"]") === null) {
		const tag = document.createElement("style");
		tag.dataset.plugin = "dsh-pet";
		tag.dataset.pluginCss = "dsh-pet/bubble";
		tag.textContent = bubbleCss;
		document.head.appendChild(tag);
	}
}
/** 把餘額行数据映射成 React 节点。 */
function rowsToNodes(h, rows) {
	if (rows.some((r) => r.role === "tier")) return h("div", {
		className: "pet-bub-row",
		children: rows.map((r, i) => {
			if (r.role === "quota") return null;
			if (r.role === "tier") return h("span", {
				key: i,
				className: "pet-bub-tier pet-bub-tier-" + r.tier,
				children: r.text
			});
			return h("span", {
				key: i,
				children: r.text
			});
		})
	});
	return rows.map((r, i) => {
		if (r.role === "quota") return h("div", {
			key: i,
			className: "pet-bub-quota",
			children: [
				h("span", {
					key: "label",
					className: "pet-bub-quota-label",
					children: r.label
				}),
				h("span", {
					key: "bar",
					className: "pet-bub-quota-bar",
					children: h("i", {
						className: "pet-bub-quota-fill pet-bub-quota-" + r.tone,
						style: { width: Math.max(0, Math.min(100, r.percent)) + "%" }
					})
				}),
				h("span", {
					key: "used",
					className: "pet-bub-quota-used",
					children: r.usedText
				}),
				h("span", {
					key: "reset",
					className: "pet-bub-quota-reset",
					children: r.resetText
				})
			]
		});
		if (r.role === "usage") return h("div", {
			key: i,
			className: "pet-bub-usage",
			children: [
				h("div", {
					key: "head",
					className: "pet-bub-usage-line",
					children: [h("span", {
						key: "title",
						className: "pet-bub-usage-title",
						children: r.title
					}), h("span", {
						key: "total",
						className: "pet-bub-usage-total",
						children: r.total
					})]
				}),
				r.inputPercent === void 0 ? null : h("div", {
					key: "bar",
					className: "pet-bub-usage-bar",
					children: [h("i", {
						key: "in",
						className: "pet-bub-usage-bar-in",
						style: { width: r.inputPercent + "%" }
					}), h("i", {
						key: "out",
						className: "pet-bub-usage-bar-out",
						style: { width: 100 - r.inputPercent + "%" }
					})]
				}),
				h("div", {
					key: "io",
					className: "pet-bub-usage-line",
					children: [h("span", {
						key: "in",
						className: "pet-bub-usage-in",
						children: r.input
					}), h("span", {
						key: "out",
						className: "pet-bub-usage-out",
						children: r.output
					})]
				}),
				h("div", {
					key: "foot",
					className: "pet-bub-usage-line",
					children: [h("span", {
						key: "period",
						className: "pet-bub-usage-period",
						children: r.period
					}), h("span", {
						key: "spend",
						className: "pet-bub-usage-spend",
						children: r.spend
					})]
				})
			]
		});
		if (r.role === "error") return h("div", {
			key: i,
			className: "pet-bub-err",
			children: r.text
		});
		if (r.role === "sub") return h("div", {
			key: i,
			className: "pet-bub-row pet-bub-sub",
			children: r.text
		});
		return h("div", {
			key: i,
			className: "pet-bub-row",
			children: r.text
		});
	});
}
/** 把自定义节点树映射成 React 节点，与 rowsToNodes 并列。
*  行数据由插件定排版，这里把第三方定好的 tag、内联样式与文本原样映射。
*  解析层已做白名单裁剪，故不做二次校验；不用 innerHTML，没有注入面。
*  先文本后子节点，与 DOM 的 textContent + appendChild 顺序一致。
*/
function treeToNodes(h, node, key) {
	const props = { key };
	if (node.style) props.style = node.style;
	if (node.tag === "img") {
		props.src = node.src ?? "";
		props.alt = "";
		return h("img", props);
	}
	const children = [];
	if (node.text) children.push(node.text);
	for (let i = 0; i < (node.children?.length ?? 0); i++) children.push(treeToNodes(h, node.children[i], i));
	props.children = children;
	return h(node.tag, props);
}
/** 换内容前的淡出等待（ms），与 opacity 过渡同为 250ms。 */
const BALANCE_FADE_MS = 250;
function makeBalanceBubble(rt) {
	const { h, useState, useEffect } = rt;
	injectBubbleCss();
	return function BalanceBubble({ state, on, index, onCycle }) {
		const [shown, setShown] = useState(0);
		const [fading, setFading] = useState(false);
		useEffect(() => {
			if (index === shown) return;
			setFading(true);
			const timer = window.setTimeout(() => {
				setShown(index);
				setFading(false);
			}, BALANCE_FADE_MS);
			return () => window.clearTimeout(timer);
		}, [index, shown]);
		const isCustom = state.ok && state.shape === "custom";
		const views = isCustom ? customViews(state) : void 0;
		const tree = views ? views[Math.min(shown, views.length - 1)] : void 0;
		const rows = isCustom ? [] : balancePageView(state, shown);
		const clickable = state.ok && (state.shape === "windows" || isCustom && customClickable(state));
		const wrap = state.ok ? "" : " dsh-pet-whisper";
		return h("div", {
			className: "dsh-pet-bubble" + wrap + (on ? " is-on" : "") + (clickable ? " is-clickable" : "") + (!isCustom && shown > 0 ? " is-expanded" : "") + (fading ? " is-fading" : ""),
			onClick: clickable ? (e) => {
				e.stopPropagation();
				onCycle();
			} : void 0,
			children: tree ? treeToNodes(h, tree, "tree") : rowsToNodes(h, rows)
		});
	};
}
function makeWhisperBubble(rt) {
	const { h } = rt;
	injectBubbleCss();
	injectMemeBubbleCss();
	return function WhisperBubble({ text, image, url, assetRoot, on, voiceState: voiceState$1 = "idle" }) {
		const rows = whisperBubbleView({
			ok: true,
			text,
			ts: 0
		});
		const key = String(image ?? "").trim();
		const href = String(url ?? "").trim();
		const src = href || (key ? memeImageUrl(key, ROUTE_PATH, assetRoot) : "");
		const body = src ? [h("img", {
			key: "img",
			className: MEME_IMG_CLASS,
			src,
			alt: key || href
		}), rowsToNodes(h, rows)] : rowsToNodes(h, rows);
		return h("div", {
			className: "dsh-pet-bubble dsh-pet-whisper" + (src ? " " + MEME_BUBBLE_CLASS : "") + (on ? " is-on" : ""),
			children: voiceState$1 === "idle" ? body : [body, voiceBadgeNode(h, voiceState$1)]
		});
	};
}
/** 语音状态角标：只在手动触发的播报上出现，右下角绝对定位，不参与文字排版。
*  `failed` 用静音喇叭——「本该有声却没响」，不是系统告警，所以不上警告符号。 */
function voiceBadgeNode(h, state) {
	return h("span", {
		key: "voice",
		className: "dsh-pet-voice-badge" + (state === "loading" ? " is-loading" : "") + (state === "failed" ? " is-failed" : ""),
		"aria-hidden": "true",
		children: state === "loading" ? null : state === "failed" ? "🔇" : "🔊"
	});
}

//#endregion
//#region src/shared/todo/types.ts
/** 读一个数字，非法回落。 */
function numberOr(raw, fallback) {
	return typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;
}
function parseTodoItem(raw) {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
	const record = raw;
	if (typeof record.id !== "string" || record.id === "") return null;
	if (typeof record.text !== "string") return null;
	const dueAt = record.dueAt === null || record.dueAt === void 0 ? null : typeof record.dueAt === "number" && Number.isFinite(record.dueAt) ? record.dueAt : void 0;
	if (dueAt === void 0) return null;
	return {
		id: record.id,
		text: record.text,
		dueAt,
		done: record.done === true,
		createdAt: numberOr(record.createdAt, 0),
		updatedAt: numberOr(record.updatedAt, 0),
		completedAt: typeof record.completedAt === "number" ? record.completedAt : null
	};
}
function parseTodoList(raw) {
	if (!Array.isArray(raw)) return [];
	const out = [];
	for (const item of raw) {
		const todo = parseTodoItem(item);
		if (todo !== null) out.push(todo);
	}
	return out;
}

//#endregion
//#region src/shared/todo/api.ts
const TODOS_PATH = ROUTE_PATH + "/todos";
/** 发一次请求并收窄最外层：协议失败、业务失败、非 JSON 都归成失败。 */
async function send(url, method, body) {
	try {
		const response = await fetch(url, {
			method,
			cache: "no-store",
			...body === void 0 ? {} : {
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body)
			}
		});
		const payload = await response.json().catch(() => null);
		if (!response.ok) return {
			failed: true,
			message: `請求失敗（HTTP ${response.status}）`
		};
		if (payload === null) return {
			failed: true,
			message: "響應不是 JSON"
		};
		if (payload.ok === false) {
			const reason = typeof payload.message === "string" ? payload.message : payload.reason;
			return {
				failed: true,
				message: typeof reason === "string" && reason !== "" ? reason : "請求被拒絕"
			};
		}
		return {
			failed: false,
			body: payload
		};
	} catch (error) {
		return {
			failed: true,
			message: "連不上桌寵服務：" + (error instanceof Error ? error.message : String(error))
		};
	}
}
/** 单条响应 → 待办；形状不对时给出可展示的失败。 */
function readTodo(body) {
	const todo = parseTodoItem(body.todo);
	return todo === null ? {
		ok: false,
		message: "響應里沒有有效的待辦"
	} : {
		ok: true,
		value: todo
	};
}
async function loadTodos(baseUrl = TODOS_PATH) {
	const result = await send(baseUrl, "GET");
	if (result.failed) return {
		ok: false,
		message: result.message
	};
	return {
		ok: true,
		value: parseTodoList(result.body.todos)
	};
}
async function addTodo(text, dueAt, baseUrl = TODOS_PATH) {
	const result = await send(baseUrl, "POST", {
		text,
		dueAt
	});
	if (result.failed) return {
		ok: false,
		message: result.message
	};
	return readTodo(result.body);
}
async function patchTodo(id, patch, baseUrl = TODOS_PATH) {
	const result = await send(baseUrl + "/" + encodeURIComponent(id), "PATCH", patch);
	if (result.failed) return {
		ok: false,
		message: result.message
	};
	return readTodo(result.body);
}
async function removeTodo(id, baseUrl = TODOS_PATH) {
	const result = await send(baseUrl + "/" + encodeURIComponent(id), "DELETE");
	if (result.failed) return {
		ok: false,
		message: result.message
	};
	return {
		ok: true,
		value: typeof result.body.removed === "number" ? result.body.removed : 0
	};
}

//#endregion
//#region src/shared/todo/format.ts
const MINUTE_MS = 60 * 1e3;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS$1 = 24 * HOUR_MS;
/** 星期名，索引与 Date.getDay() 对齐。 */
const WEEKDAYS = [
	"周日",
	"周一",
	"周二",
	"周三",
	"周四",
	"周五",
	"周六"
];
/** 两位补零。 */
function pad2$1(value) {
	return String(value).padStart(2, "0");
}
/** 当天零点的时间戳：跨日比较用它，避开夏令时造成的 23/25 小时日。 */
function startOfDay$1(date) {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}
/** 两个时刻相差几个自然日（按本地日历，向前为负）。 */
function dayDiff(target, base) {
	return Math.round((startOfDay$1(target) - startOfDay$1(base)) / DAY_MS$1);
}
function spanText(ms) {
	const minutes = Math.max(1, Math.round(Math.abs(ms) / MINUTE_MS));
	if (minutes < 60) return `${minutes}分鐘`;
	const hours = Math.max(1, Math.round(minutes / 60));
	if (hours < 24) return `${hours}小時`;
	return `${Math.max(1, Math.round(hours / 24))}天`;
}
function dueLabel(dueAt, now) {
	if (dueAt === null) return "無期限";
	const due = new Date(dueAt);
	const clock = `${pad2$1(due.getHours())}:${pad2$1(due.getMinutes())}`;
	const days = dayDiff(due, new Date(now));
	if (days === 0) return `今天 ${clock}`;
	if (days === 1) return `明天 ${clock}`;
	if (days === 2) return `后天 ${clock}`;
	if (days > 2 && days < 7) return `${WEEKDAYS[due.getDay()]} ${clock}`;
	return `${due.getMonth() + 1}月${due.getDate()}日 ${clock}`;
}
function remainingLabel(dueAt, now) {
	if (dueAt === null) return "";
	if (dueAt <= now) return `已逾期${spanText(now - dueAt)}`;
	return `還剩${spanText(dueAt - now)}`;
}
function todoUrgency(dueAt, now) {
	if (dueAt === null) return "undated";
	const remaining = dueAt - now;
	if (remaining <= 0) return "overdue";
	if (remaining <= 6 * HOUR_MS) return "soon";
	if (remaining <= DAY_MS$1) return "today";
	return "later";
}
function metaLabel(todo, now) {
	if (todo.done) return todo.dueAt === null ? "已完成" : `已完成 · ${dueLabel(todo.dueAt, now)}`;
	if (todo.dueAt === null) return "無期限";
	const relative = remainingLabel(todo.dueAt, now);
	if (todo.dueAt <= now) return relative;
	return `${dueLabel(todo.dueAt, now)} · ${relative}`;
}
function formatDateTimeLocal(ms) {
	const date = new Date(ms);
	return `${date.getFullYear()}-${pad2$1(date.getMonth() + 1)}-${pad2$1(date.getDate())}T${pad2$1(date.getHours())}:${pad2$1(date.getMinutes())}`;
}
function parseDateTimeLocal(value) {
	const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value.trim());
	if (!match) return null;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const hour = Number(match[4]);
	const minute = Number(match[5]);
	if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
	const date = new Date(year, month - 1, day, hour, minute, 0, 0);
	if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
	return date.getTime();
}

//#endregion
//#region src/shared/todo/calendar.ts
function monthCells(year, month) {
	const first = new Date(year, month, 1);
	const lead = (first.getDay() + 6) % 7;
	const days = new Date(year, month + 1, 0).getDate();
	const rows = Math.ceil((lead + days) / 7);
	const cells = [];
	for (let i = 0; i < rows * 7; i++) {
		const date = new Date(year, month, 1 - lead + i);
		cells.push({
			date,
			out: date.getMonth() !== month
		});
	}
	return cells;
}

//#endregion
//#region src/shared/todo/due-picker.ts
/** 周一为一周首日，与国内日历习惯一致。 */
const WEEK_HEAD = [
	"一",
	"二",
	"三",
	"四",
	"五",
	"六",
	"日"
];
/** 分钟档位：与提醒的最短间隔一致，避免选出提醒策略分辨不出的时刻。 */
const MINUTE_STEP = 5;
/** 未选日期时的默认时分：早上九点，比零点更像个「该做事了」的时刻。 */
const DEFAULT_HOUR = 9;
/** 两位补零。 */
function pad2(value) {
	return String(value).padStart(2, "0");
}
/** 造一个带 class 的元素。 */
function make(tag, className) {
	const node = document.createElement(tag);
	node.className = className;
	return node;
}
/** 造一个按钮：全部是 `type="button"`，否则在表单里会触发提交。 */
function makeButton(className, text) {
	const button = make("button", className);
	button.type = "button";
	if (text !== void 0) button.textContent = text;
	return button;
}
/** 建整个选择器的 DOM（尚未挂进文档）。 */
function buildPickerDom() {
	const el = makeButton("dsh-pet-todo-due", "無期限");
	el.setAttribute("aria-haspopup", "dialog");
	el.setAttribute("aria-expanded", "false");
	el.setAttribute("aria-label", "提醒時間（可選）");
	const calendar = make("div", "dsh-pet-todo-cal");
	calendar.setAttribute("role", "dialog");
	calendar.setAttribute("aria-label", "選擇提醒時間");
	const head = make("div", "dsh-pet-todo-cal-head");
	const prev = makeButton("dsh-pet-todo-cal-nav", "‹");
	prev.dataset.act = "prev";
	prev.setAttribute("aria-label", "上個月");
	const title = make("span", "dsh-pet-todo-cal-title");
	const next = makeButton("dsh-pet-todo-cal-nav", "›");
	next.dataset.act = "next";
	next.setAttribute("aria-label", "下個月");
	head.append(prev, title, next);
	const week = make("div", "dsh-pet-todo-cal-week");
	for (const name of WEEK_HEAD) {
		const cell = make("span", "");
		cell.textContent = name;
		week.appendChild(cell);
	}
	const grid = make("div", "dsh-pet-todo-cal-grid");
	const foot = make("div", "dsh-pet-todo-cal-foot");
	const today = makeButton("dsh-pet-todo-cal-act", "今天");
	today.dataset.act = "today";
	const clear = makeButton("dsh-pet-todo-cal-act", "清除");
	clear.dataset.act = "clear";
	const grow = make("span", "dsh-pet-todo-cal-grow");
	const hourChip = makeButton("dsh-pet-todo-cal-chip", "09");
	hourChip.dataset.act = "hour";
	hourChip.setAttribute("aria-label", "選擇小時");
	const colon = make("span", "dsh-pet-todo-cal-colon");
	colon.textContent = ":";
	const minuteChip = makeButton("dsh-pet-todo-cal-chip", "00");
	minuteChip.dataset.act = "minute";
	minuteChip.setAttribute("aria-label", "選擇分鐘");
	const done = makeButton("dsh-pet-todo-cal-act", "完成");
	done.dataset.act = "done";
	foot.append(today, clear, grow, hourChip, colon, minuteChip, done);
	calendar.append(head, week, grid, foot);
	return {
		el,
		calendar,
		prev,
		next,
		title,
		grid,
		hourChip,
		minuteChip
	};
}
/** 同一个自然日（忽略时分）。 */
function sameDay(a, b) {
	return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
/** 选中日期 + 当前时分组成的时刻；未选日期为 null。 */
function dueMs(state) {
	if (state.picked === null) return null;
	const { picked } = state;
	return new Date(picked.getFullYear(), picked.getMonth(), picked.getDate(), state.hour, state.minute).getTime();
}
/** 造一个日历格：选中态同时写进 class 与 aria。 */
function cellButton(text, selected) {
	const button = makeButton("dsh-pet-todo-cal-cell", text);
	button.classList.toggle("is-sel", selected);
	button.setAttribute("aria-pressed", String(selected));
	return button;
}
/** 画日期网格。 */
function renderDays(dom, state) {
	const today = new Date();
	for (const cell of monthCells(state.view.getFullYear(), state.view.getMonth())) {
		const { date } = cell;
		const button = cellButton(String(date.getDate()), state.picked !== null && sameDay(state.picked, date));
		button.classList.toggle("is-out", cell.out);
		button.classList.toggle("is-today", sameDay(today, date));
		button.dataset.ts = String(date.getTime());
		button.setAttribute("aria-label", `${date.getMonth() + 1}月${date.getDate()}日`);
		dom.grid.appendChild(button);
	}
}
/** 画小时或分钟的网格：一格一个数，当前值高亮。 */
function renderNumbers(dom, state) {
	const isHour = state.mode === "hour";
	const count = isHour ? 24 : 60;
	const step = isHour ? 1 : MINUTE_STEP;
	for (let value = 0; value < count; value += step) {
		const button = cellButton(pad2(value), (isHour ? state.hour : state.minute) === value);
		button.dataset.num = String(value);
		button.setAttribute("aria-label", `${value} ${isHour ? "時" : "分"}`);
		dom.grid.appendChild(button);
	}
}
/** 同步按钮文案、时分标签与当前网格的标题。 */
function syncPicker(dom, state) {
	const ms = dueMs(state);
	dom.el.textContent = ms === null ? "無期限" : dueLabel(ms, Date.now());
	dom.el.classList.toggle("is-set", ms !== null);
	dom.hourChip.textContent = pad2(state.hour);
	dom.minuteChip.textContent = pad2(state.minute);
	dom.hourChip.classList.toggle("is-on", state.mode === "hour");
	dom.minuteChip.classList.toggle("is-on", state.mode === "minute");
}
/** 整块重画：标题、翻月按钮、网格与文案一次到位。 */
function renderPicker(dom, state) {
	const day = state.mode === "day";
	dom.title.textContent = day ? `${state.view.getFullYear()}年${state.view.getMonth() + 1}月` : state.mode === "hour" ? "選擇小時" : "選擇分鐘";
	dom.prev.hidden = !day;
	dom.next.hidden = !day;
	dom.grid.className = "dsh-pet-todo-cal-grid is-" + state.mode;
	dom.grid.textContent = "";
	if (day) renderDays(dom, state);
	else renderNumbers(dom, state);
	syncPicker(dom, state);
}
/** 选中某一天：同步展示月份，并回到日期网格。 */
function pickDay(dom, state, date) {
	state.picked = date;
	state.view = new Date(date.getFullYear(), date.getMonth(), 1);
	state.mode = "day";
	renderPicker(dom, state);
}
/** 点日历里的按钮：翻月、切网格、今天、清除、完成，或选中某一天 / 某个数。 */
function onCalendarClick(dom, state, button, close) {
	const { ts, num, act } = button.dataset;
	if (ts !== void 0) {
		pickDay(dom, state, new Date(Number(ts)));
		return;
	}
	if (num !== void 0) {
		if (state.mode === "hour") state.hour = Number(num);
		else state.minute = Number(num);
		state.mode = "day";
		renderPicker(dom, state);
		return;
	}
	if (act === "prev" || act === "next") {
		state.view = new Date(state.view.getFullYear(), state.view.getMonth() + (act === "prev" ? -1 : 1), 1);
		renderPicker(dom, state);
		return;
	}
	if (act === "hour" || act === "minute") {
		state.mode = state.mode === act ? "day" : act;
		renderPicker(dom, state);
		return;
	}
	if (act === "today") {
		const now = new Date();
		pickDay(dom, state, new Date(now.getFullYear(), now.getMonth(), now.getDate()));
		return;
	}
	if (act === "clear") state.picked = null;
	renderPicker(dom, state);
	if (act === "clear" || act === "done") close();
}
function createDuePicker(options = {}) {
	const now = new Date();
	const state = {
		picked: null,
		hour: DEFAULT_HOUR,
		minute: 0,
		view: new Date(now.getFullYear(), now.getMonth(), 1),
		mode: "day",
		open: false
	};
	const dom = buildPickerDom();
	const setOpen = (open) => {
		if (state.open === open) return;
		state.open = open;
		dom.el.setAttribute("aria-expanded", String(open));
		options.onOpenChange?.(open);
	};
	dom.el.addEventListener("click", () => {
		if (!state.open) {
			const anchor = state.picked ?? new Date();
			state.view = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
			state.mode = "day";
			renderPicker(dom, state);
		}
		setOpen(!state.open);
	});
	dom.calendar.addEventListener("click", (event) => {
		const button = event.target.closest("button");
		if (button !== null) onCalendarClick(dom, state, button, () => setOpen(false));
	});
	const onDocMouseDown = (event) => {
		if (!state.open) return;
		const target = event.target;
		if (target !== null && (dom.el.contains(target) || dom.calendar.contains(target))) return;
		setOpen(false);
	};
	document.addEventListener("mousedown", onDocMouseDown, true);
	renderPicker(dom, state);
	return {
		el: dom.el,
		calendar: dom.calendar,
		value: () => {
			const ms = dueMs(state);
			return ms === null ? "" : formatDateTimeLocal(ms);
		},
		close: () => setOpen(false),
		reset: () => {
			state.picked = null;
			state.hour = DEFAULT_HOUR;
			state.minute = 0;
			state.mode = "day";
			renderPicker(dom, state);
			setOpen(false);
		},
		dispose: () => document.removeEventListener("mousedown", onDocMouseDown, true)
	};
}

//#endregion
//#region src/shared/todo/render.ts
/** 删除按钮的二次确认窗口（ms）：超时自动复原，避免「确认」态一直挂着。 */
const DELETE_ARM_MS = 2500;
/** 空态文案：加载中会临时替换它，重渲染时再写回来。 */
const EMPTY_TEXT = "還沒有待辦。記一件要做的事，到點我会提醒你～";
/** 清单最多露出几行，其余靠滚动。 */
const LIST_ROWS = 2;
/** 造一个带 class 的元素，避免每处都写 createElement + className。 */
function element(tag, className, text) {
	const node = document.createElement(tag);
	node.className = className;
	if (text !== void 0) node.textContent = text;
	return node;
}
/** 造一个可折叠区：高度靠 grid-template-rows 在 0fr 与 1fr 之间过渡，内容高度是 auto 也能动画。 */
function fold(className, children) {
	const outer = element("div", "dsh-pet-todo-fold " + className);
	const clip = element("div", "dsh-pet-todo-foldClip");
	clip.append(...children);
	outer.appendChild(clip);
	return outer;
}
function createTodoPanelParts() {
	const root = element("div", "dsh-pet-todo");
	root.setAttribute("role", "dialog");
	root.setAttribute("aria-label", "待辦事項");
	const head = element("div", "dsh-pet-todo-head");
	const title = element("span", "dsh-pet-todo-title", "待辦事項");
	const count = element("span", "dsh-pet-todo-count", "0 項未完成");
	count.setAttribute("aria-live", "polite");
	const closeButton = element("button", "dsh-pet-todo-close", "✕");
	closeButton.type = "button";
	closeButton.setAttribute("aria-label", "關閉待辦面板");
	head.append(title, count, closeButton);
	const form = element("form", "dsh-pet-todo-form");
	const input = element("input", "dsh-pet-todo-input");
	input.type = "text";
	input.maxLength = 200;
	input.placeholder = "記一件要做的事…";
	input.autocomplete = "off";
	input.setAttribute("aria-label", "待辦內容");
	const row = element("div", "dsh-pet-todo-row");
	const duePicker = createDuePicker({ onOpenChange: (open) => root.classList.toggle("is-picking", open) });
	const addButton = element("button", "dsh-pet-todo-add", "添加");
	addButton.type = "submit";
	row.append(duePicker.el, addButton);
	form.append(input, row);
	const error = element("div", "dsh-pet-todo-err");
	error.hidden = true;
	const empty = element("div", "dsh-pet-todo-empty", EMPTY_TEXT);
	empty.hidden = true;
	const list = element("ul", "dsh-pet-todo-list");
	const hint = element("div", "dsh-pet-todo-hint", "離到期越近，我会提醒得越勤快～");
	const lower = element("div", "dsh-pet-todo-lower");
	lower.append(fold("is-cal", [duePicker.calendar]), fold("is-list", [
		error,
		empty,
		list,
		hint
	]));
	root.append(head, form, lower);
	return {
		root,
		form,
		input,
		duePicker,
		addButton,
		list,
		empty,
		count,
		closeButton,
		error
	};
}
/**
* 把清单压到「两行」的高度，多出来的部分靠清单自己滚动。
*
* 行高随正文折行变化，写不成 CSS 常量，所以量一次首行再乘二；量不到（未挂载）就不设上限，
* 免得把清单压成 0 高。
*
* @param list - 清单容器。
*/
function capListHeight(list) {
	const first = list.firstElementChild;
	if (first === null) {
		list.style.maxHeight = "";
		return;
	}
	const rowHeight = first.getBoundingClientRect().height;
	if (rowHeight <= 0) return;
	const pad$1 = parseFloat(getComputedStyle(list).paddingTop) || 0;
	list.style.maxHeight = rowHeight * LIST_ROWS + pad$1 * 2 + "px";
}
function renderTodoList(parts, todos, handlers, now) {
	parts.list.textContent = "";
	const pending = todos.filter((todo) => !todo.done).length;
	parts.count.textContent = `${pending} 項未完成`;
	parts.empty.textContent = EMPTY_TEXT;
	parts.empty.hidden = todos.length > 0;
	for (const todo of todos) parts.list.appendChild(renderItem(todo, handlers, now));
	capListHeight(parts.list);
}
/** 渲染一条；未完成项带紧迫度，已完成项划线。 */
function renderItem(todo, handlers, now) {
	const item = element("li", "dsh-pet-todo-item" + (todo.done ? " is-done" : ""));
	if (!todo.done) item.dataset.urgency = todoUrgency(todo.dueAt, now);
	const check = element("input", "dsh-pet-todo-check");
	check.type = "checkbox";
	check.checked = todo.done;
	check.setAttribute("aria-label", (todo.done ? "標記未完成：" : "標記完成：") + todo.text);
	check.addEventListener("change", () => handlers.onToggle(todo, check.checked));
	const main = element("div", "dsh-pet-todo-main");
	const text = element("div", "dsh-pet-todo-text", todo.text);
	const meta = element("div", "dsh-pet-todo-meta", metaLabel(todo, now));
	main.append(text, meta);
	const remove = element("button", "dsh-pet-todo-del", "✕");
	remove.type = "button";
	remove.setAttribute("aria-label", "刪除：" + todo.text);
	remove.addEventListener("click", () => {
		if (remove.dataset.armed !== "1") {
			remove.dataset.armed = "1";
			remove.classList.add("is-armed");
			remove.textContent = "確認";
			window.setTimeout(() => {
				if (!remove.isConnected) return;
				delete remove.dataset.armed;
				remove.classList.remove("is-armed");
				remove.textContent = "✕";
			}, DELETE_ARM_MS);
			return;
		}
		handlers.onDelete(todo);
	});
	item.append(check, main, remove);
	return item;
}
function setTodoError(parts, message) {
	parts.error.hidden = message === null;
	parts.error.textContent = message ?? "";
}
function setTodoBusy(parts, busy) {
	parts.input.disabled = busy;
	parts.duePicker.el.disabled = busy;
	parts.addButton.disabled = busy;
}

//#endregion
//#region src/shared/todo/styles.ts
const TODO_FONT_SCALE = .618;
const TODO_CSS = [
	".dsh-pet-bubble.dsh-pet-todo-bubble,.pet-bubble.dsh-pet-todo-bubble{padding:0;",
	"width:max(220px,calc(var(--f)*14.65));max-width:calc(100vw - 16px);pointer-events:auto;cursor:default}",
	".dsh-pet-todo{--t:calc(var(--f)*" + TODO_FONT_SCALE + ");display:flex;flex-direction:column;",
	"box-sizing:border-box;border-radius:inherit;overflow:hidden;color:#2b2b2b;font-size:var(--t);",
	"line-height:1.5;user-select:none;",
	"font-family:var(--dsh-pet-font-family,'ShangshouSoftCandy','Yuanti SC','YouYuan','幼圓','Comic Sans MS','PingFang SC','Microsoft YaHei',sans-serif);",
	"}",
	".dsh-pet-todo *{box-sizing:border-box}",
	".dsh-pet-todo-head{display:flex;align-items:center;gap:.615em;padding:.769em .923em .615em}",
	".dsh-pet-todo-title{flex:1;font-size:1.077em;font-weight:600}",
	".dsh-pet-todo-count{color:rgba(43,43,43,.55);font-size:.923em}",
	".dsh-pet-todo-close{border:none;background:transparent;color:rgba(43,43,43,.5);font-family:inherit;",
	"font-size:1em;line-height:1;padding:.308em .385em;border-radius:.462em;cursor:pointer}",
	".dsh-pet-todo-close:hover{background:rgba(0,0,0,.06);color:rgba(43,43,43,.9)}",
	".dsh-pet-todo-form{display:flex;flex-direction:column;gap:.462em;padding:0 .923em .769em;",
	"border-bottom:1px solid rgba(0,0,0,.07)}",
	".dsh-pet-todo-input{width:100%;border:1px solid rgba(0,0,0,.12);border-radius:.615em;",
	"background:rgba(255,255,255,.9);padding:.462em .615em;font-size:1em;line-height:1.4;color:#2b2b2b;",
	"font-family:inherit;outline:none}",
	".dsh-pet-todo-input:focus{border-color:rgba(64,128,255,.55);box-shadow:0 0 0 .154em rgba(64,128,255,.14)}",
	".dsh-pet-todo-input::placeholder{color:rgba(43,43,43,.42)}",
	".dsh-pet-todo-row{display:flex;align-items:center;gap:.462em}",
	".dsh-pet-todo-due{flex:1;min-width:0;text-align:left;border:1px solid rgba(0,0,0,.12);border-radius:.615em;",
	"background:rgba(255,255,255,.9);padding:.462em .615em;font-size:1em;line-height:1.4;font-family:inherit;",
	"color:rgba(43,43,43,.55);cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
	".dsh-pet-todo-due:hover{border-color:rgba(64,128,255,.45)}",
	".dsh-pet-todo-due.is-set{color:#2b2b2b}",
	".dsh-pet-todo-due[aria-expanded=\"true\"]{border-color:rgba(64,128,255,.55);",
	"box-shadow:0 0 0 .154em rgba(64,128,255,.14)}",
	".dsh-pet-todo-add{border:none;border-radius:.615em;background:#4a7dff;color:#fff;font-size:1em;",
	"padding:.462em .923em;cursor:pointer;font-family:inherit;white-space:nowrap}",
	".dsh-pet-todo-add:hover{background:#3a6ce8}",
	".dsh-pet-todo-add:disabled,.dsh-pet-todo-input:disabled{opacity:.55;cursor:default}",
	".dsh-pet-todo-cal{display:flex;flex-direction:column;gap:.308em;",
	"padding:.462em .615em .615em;background:rgba(43,43,43,.025)}",
	".dsh-pet-todo-cal-head{display:flex;align-items:center;gap:.308em}",
	".dsh-pet-todo-cal-title{flex:1;text-align:center;font-size:1.077em;font-weight:600}",
	".dsh-pet-todo-cal-nav{border:none;background:transparent;color:rgba(43,43,43,.55);font-family:inherit;",
	"font-size:1.154em;line-height:1;padding:.154em .385em;border-radius:.462em;cursor:pointer}",
	".dsh-pet-todo-cal-nav:hover{background:rgba(0,0,0,.07);color:#2b2b2b}",
	".dsh-pet-todo-cal-week,.dsh-pet-todo-cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:.154em}",
	".dsh-pet-todo-cal-grid{grid-auto-rows:1.862em}",
	".dsh-pet-todo-cal-grid.is-hour,.dsh-pet-todo-cal-grid.is-minute{grid-template-columns:repeat(6,1fr);",
	"grid-auto-rows:1.6em;align-content:center}",
	".dsh-pet-todo-cal-week{font-size:.846em;line-height:1.5;color:rgba(43,43,43,.45);text-align:center}",
	".dsh-pet-todo-cal-cell{border:none;background:transparent;font-family:inherit;font-size:1em;line-height:1.4;",
	"color:#2b2b2b;padding:.231em 0;border-radius:.462em;cursor:pointer;font-variant-numeric:tabular-nums}",
	".dsh-pet-todo-cal-cell:hover{background:rgba(0,0,0,.06)}",
	".dsh-pet-todo-cal-cell.is-out{color:rgba(43,43,43,.26)}",
	".dsh-pet-todo-cal-cell.is-today{box-shadow:inset 0 0 0 1px rgba(74,125,255,.55)}",
	".dsh-pet-todo-cal-cell.is-sel{background:#4a7dff;color:#fff;font-weight:600}",
	".dsh-pet-todo-cal-foot{display:flex;align-items:center;gap:.308em}",
	".dsh-pet-todo-cal-act{border:none;background:transparent;color:#4a7dff;font-family:inherit;font-size:.923em;",
	"line-height:1.5;padding:.231em .385em;border-radius:.462em;cursor:pointer}",
	".dsh-pet-todo-cal-act:hover{background:rgba(74,125,255,.1)}",
	".dsh-pet-todo-cal-grow{flex:1}",
	".dsh-pet-todo-cal-chip{border:1px solid rgba(0,0,0,.12);border-radius:.462em;background:rgba(255,255,255,.95);",
	"color:#2b2b2b;font-family:inherit;font-size:.923em;line-height:1.4;padding:.154em .385em;cursor:pointer;",
	"font-variant-numeric:tabular-nums}",
	".dsh-pet-todo-cal-chip.is-on{border-color:rgba(74,125,255,.55);color:#4a7dff;",
	"box-shadow:0 0 0 .154em rgba(74,125,255,.14)}",
	".dsh-pet-todo-cal-colon{color:rgba(43,43,43,.45)}",
	".dsh-pet-todo-lower{display:flex;flex-direction:column}",
	".dsh-pet-todo-fold{display:grid;grid-template-rows:0fr;visibility:hidden;",
	"transition:grid-template-rows .18s ease,visibility 0s .18s}",
	".dsh-pet-todo-fold>.dsh-pet-todo-foldClip{overflow:hidden;min-height:0}",
	".dsh-pet-todo-fold.is-list{grid-template-rows:1fr;visibility:visible;transition-delay:0s}",
	".dsh-pet-todo.is-picking .dsh-pet-todo-fold.is-cal{grid-template-rows:1fr;visibility:visible;",
	"transition-delay:0s}",
	".dsh-pet-todo.is-picking .dsh-pet-todo-fold.is-list{grid-template-rows:0fr;visibility:hidden;",
	"transition-delay:0s,.18s}",
	".dsh-pet-todo-list{list-style:none;margin:0;padding:.462em;overflow-y:auto;overscroll-behavior:contain;",
	"flex:0 1 auto;min-height:0;scrollbar-width:thin}",
	".dsh-pet-todo-item{display:flex;align-items:flex-start;gap:.615em;padding:.538em .462em;border-radius:.615em}",
	".dsh-pet-todo-item:hover{background:rgba(0,0,0,.045)}",
	".dsh-pet-todo-check{margin-top:.231em;width:1.154em;height:1.154em;flex:0 0 auto;cursor:pointer;",
	"accent-color:#4a7dff}",
	".dsh-pet-todo-main{flex:1;min-width:0}",
	".dsh-pet-todo-text{overflow-wrap:anywhere;white-space:pre-wrap}",
	".dsh-pet-todo-meta{margin-top:calc(var(--t)*0.154);font-size:.846em;color:rgba(43,43,43,.5)}",
	".dsh-pet-todo-item[data-urgency=\"overdue\"] .dsh-pet-todo-meta{color:#d94f3d}",
	".dsh-pet-todo-item[data-urgency=\"soon\"] .dsh-pet-todo-meta{color:#c9761b}",
	".dsh-pet-todo-item[data-urgency=\"today\"] .dsh-pet-todo-meta{color:#3f6fd8}",
	".dsh-pet-todo-item.is-done .dsh-pet-todo-text{text-decoration:line-through;color:#2e9e4f}",
	".dsh-pet-todo-del{border:none;background:transparent;color:rgba(43,43,43,.34);font-size:.923em;line-height:1;",
	"padding:calc(var(--t)*0.308) calc(var(--t)*0.385);border-radius:.462em;cursor:pointer;flex:0 0 auto;",
	"min-width:calc(var(--t)*1.692)}",
	".dsh-pet-todo-del:hover{background:rgba(0,0,0,.07);color:rgba(43,43,43,.8)}",
	".dsh-pet-todo-del.is-armed{background:rgba(217,79,61,.12);color:#d94f3d}",
	".dsh-pet-todo-empty{padding:calc(var(--t)*1.538) calc(var(--t)*0.923);text-align:center;",
	"color:rgba(43,43,43,.44);font-size:.923em}",
	".dsh-pet-todo-empty[hidden]{display:none}",
	".dsh-pet-todo-err{flex:0 0 auto;padding:0 calc(var(--t)*0.923) calc(var(--t)*0.615);color:#d94f3d;",
	"font-size:.923em;white-space:pre-wrap;overflow-wrap:anywhere}",
	".dsh-pet-todo-err[hidden]{display:none}",
	".dsh-pet-todo-hint{margin-top:auto;padding:calc(var(--t)*0.462) calc(var(--t)*0.923) calc(var(--t)*0.692);",
	"color:rgba(43,43,43,.4);font-size:.846em;text-align:center}"
].join("");
let todoCssInjected = false;
function injectTodoCss() {
	if (todoCssInjected || typeof document === "undefined") return;
	todoCssInjected = true;
	const tag = document.createElement("style");
	tag.dataset.plugin = "dsh-pet";
	tag.dataset.pluginCss = "dsh-pet/todo";
	tag.textContent = TODO_CSS;
	document.head.appendChild(tag);
}

//#endregion
//#region src/shared/todo/panel.ts
function createTodoPanel(options = {}) {
	injectTodoCss();
	const parts = createTodoPanelParts();
	const baseUrl = options.baseUrl ?? TODOS_PATH;
	let disposed = false;
	let busy = false;
	let todos = [];
	const handlers = {
		onToggle: (todo, done) => void mutate(() => patchTodo(todo.id, { done }, baseUrl)),
		onDelete: (todo) => void mutate(() => removeTodo(todo.id, baseUrl))
	};
	/** 重新拉整张清单：修改一律以宿主返回为准，不在本地猜结果。 */
	async function reload() {
		const result = await loadTodos(baseUrl);
		if (disposed) return;
		if (!result.ok) {
			setTodoError(parts, result.message);
			parts.empty.textContent = "清單載入失敗，關掉面板再開一次試試";
			parts.empty.hidden = false;
			return;
		}
		todos = result.value;
		setTodoError(parts, null);
		renderTodoList(parts, todos, handlers, Date.now());
	}
	/** 串行执行一次修改：请求在途时禁止再次提交，成功后统一重拉。 */
	async function mutate(task) {
		if (disposed || busy) return;
		busy = true;
		setTodoBusy(parts, true);
		setTodoError(parts, null);
		const result = await task();
		busy = false;
		if (disposed) return;
		setTodoBusy(parts, false);
		if (!result.ok) {
			setTodoError(parts, result.message);
			return;
		}
		await reload();
	}
	/** 提交新增：空正文直接回到输入框。 */
	const submitAdd = () => {
		const text = parts.input.value.trim();
		if (text === "") {
			parts.input.focus();
			return;
		}
		const dueText = parts.duePicker.value();
		const dueAt = dueText === "" ? null : parseDateTimeLocal(dueText);
		parts.duePicker.close();
		if (dueAt !== null && dueAt < Date.now()) {
			setTodoError(parts, "這個時間已經過去了，換一個吧");
			return;
		}
		mutate(async () => {
			const result = await addTodo(text, dueAt, baseUrl);
			if (result.ok) {
				parts.input.value = "";
				parts.duePicker.reset();
			}
			return result;
		});
	};
	parts.form.addEventListener("submit", (event) => {
		event.preventDefault();
		submitAdd();
	});
	const onDocMouseDown = (event) => {
		if (disposed) return;
		const target = event.target;
		if (target !== null && parts.root.contains(target)) return;
		if (options.keepOpenOn?.(event.target) === true) return;
		options.onClose?.();
	};
	document.addEventListener("mousedown", onDocMouseDown, true);
	parts.closeButton.addEventListener("click", () => options.onClose?.());
	parts.empty.textContent = "載入中…";
	parts.empty.hidden = false;
	reload();
	return {
		el: parts.root,
		dispose: () => {
			if (disposed) return;
			disposed = true;
			document.removeEventListener("mousedown", onDocMouseDown, true);
			parts.duePicker.dispose();
			parts.root.remove();
		}
	};
}

//#endregion
//#region src/client/todo-bubble.ts
function makeTodoBubble(rt) {
	const { h, useRef, useEffect } = rt;
	return function TodoBubble({ on, onClose }) {
		const hostRef = useRef(null);
		const closeRef = useRef(onClose);
		closeRef.current = onClose;
		useEffect(() => {
			const host = hostRef.current;
			if (host === null) return;
			const panel = createTodoPanel({
				onClose: () => closeRef.current(),
				keepOpenOn: (target) => target instanceof Element && target.closest(".dsh-pet-hit") !== null
			});
			host.appendChild(panel.el);
			return () => panel.dispose();
		}, []);
		return h("div", {
			ref: hostRef,
			className: "dsh-pet-bubble dsh-pet-todo-bubble" + (on ? " is-on" : "")
		});
	};
}

//#endregion
//#region src/shared/notify.ts
const NOTIFY_ICONS$1 = {
	done: "notify-done",
	error: "notify-error",
	truncated: "notify-truncated",
	approval: "notify-approval",
	question: "notify-question",
	test: "notify-test"
};
const MAX_BODY = 80;
/** 会话名在标题里的截断上限（字符）：名字只是认人用，太长会把事件类型挤出标题那一行。 */
const MAX_SESSION_NAME = 30;
function truncate(text) {
	return text.length > MAX_BODY ? text.slice(0, MAX_BODY) + "…" : text;
}
/** 会话名 → 能放进标题的名字：去掉首尾空白并截断；没有名字时返回 undefined。 */
function sessionNameOf(sessionTitle) {
	const name = sessionTitle?.trim();
	if (!name) return void 0;
	return name.length > MAX_SESSION_NAME ? name.slice(0, MAX_SESSION_NAME) + "…" : name;
}
/** 「会话名 · 事件」形式的标题；没有会话名时只留事件类型。 */
function composeTitle(sessionTitle, label) {
	const name = sessionNameOf(sessionTitle);
	return name ? name + " · " + label : label;
}
function frameToToast(frame, sessionTitle) {
	switch (frame.type) {
		case "session/event": {
			const ev = frame.event ?? {};
			if (ev.type !== "turn/end") return null;
			const kind = ev.data?.reason?.kind;
			if (kind === "completed") {
				const text = typeof ev.data?.text === "string" ? ev.data.text.trim() : "";
				return {
					title: sessionNameOf(sessionTitle) ?? "對話完成",
					body: text ? truncate(text) : "",
					icon: NOTIFY_ICONS$1.done
				};
			}
			if (kind === "error") return {
				title: composeTitle(sessionTitle, "生成失敗"),
				body: ev.data?.reason?.error?.message ?? "",
				icon: NOTIFY_ICONS$1.error
			};
			if (kind === "max-tokens") return {
				title: composeTitle(sessionTitle, "輸出被截斷"),
				body: "已達到輸出 token 上限",
				icon: NOTIFY_ICONS$1.truncated
			};
			return null;
		}
		case "approval/requested": {
			const toolName = typeof frame.toolName === "string" ? frame.toolName : "";
			const reason = typeof frame.reason === "string" && frame.reason ? frame.reason : "";
			return {
				title: composeTitle(sessionTitle, "正在申請權限"),
				body: (toolName ? "工具「" + toolName + "」" : "") + (reason ? "：" + reason : ""),
				icon: NOTIFY_ICONS$1.approval
			};
		}
		case "question/requested": {
			const q = Array.isArray(frame.questions) && frame.questions[0]?.question || "";
			return {
				title: composeTitle(sessionTitle, "模型在等你回答"),
				body: q,
				icon: NOTIFY_ICONS$1.question
			};
		}
		case "host/agent-error": return {
			title: "生成失敗",
			body: typeof frame.message === "string" ? frame.message : "",
			icon: NOTIFY_ICONS$1.error
		};
		default: return null;
	}
}

//#endregion
//#region src/client/notify.ts
let pageVisible = typeof document !== "undefined" && !document.hidden;
let pageFocused = typeof document !== "undefined" && document.hasFocus();
function refreshVisible() {
	pageVisible = !document.hidden;
}
function refreshFocused() {
	pageFocused = document.hasFocus();
}
/** 注册聚焦与可见性监听，返回解绑函数。 */
function initFocusTracking() {
	if (typeof document === "undefined") return () => {};
	document.addEventListener("visibilitychange", refreshVisible);
	window.addEventListener("focus", refreshFocused);
	window.addEventListener("blur", refreshFocused);
	return () => {
		document.removeEventListener("visibilitychange", refreshVisible);
		window.removeEventListener("focus", refreshFocused);
		window.removeEventListener("blur", refreshFocused);
	};
}
/** 用户是否在看本页（页面可见且持有焦点）；是则跳过通知。 */
function isPageActive() {
	return pageVisible && pageFocused;
}
/** 图标 URL；pic 路由由宿主提供（`assets/pic` → `/dsh-pet-7340/pic/<file>`）。 */
const PIC = (name) => `${ROUTE_PATH}/pic/${name}.png`;
const NOTIFY_ICONS = {
	done: PIC(NOTIFY_ICONS$1.done),
	error: PIC(NOTIFY_ICONS$1.error),
	truncated: PIC(NOTIFY_ICONS$1.truncated),
	approval: PIC(NOTIFY_ICONS$1.approval),
	question: PIC(NOTIFY_ICONS$1.question),
	test: PIC(NOTIFY_ICONS$1.test)
};
/** 当前生效的总开关；运行中可被 reloadNotifications 更新，设置页保存后即时生效。 */
let notifyEnabled = true;
/** 当前生效的会话跳转器（app.ts 注入；旧版 DSH 没有 uiWorkspace 时为 undefined）。 */
let sessionNavigator;
function sessionTitleFrom(navigator$1, sessionId) {
	if (sessionId === void 0) return void 0;
	try {
		return navigator$1?.sessionTitle?.(sessionId);
	} catch {
		return void 0;
	}
}
function wireNotificationClick(n, sessionId) {
	n.onclick = () => {
		n.close();
		if (sessionId !== void 0) try {
			sessionNavigator?.openSession(sessionId);
		} catch {}
		window.focus();
		if (!/electron/i.test(navigator.userAgent)) return;
		const frame = document.createElement("iframe");
		frame.style.display = "none";
		frame.src = "dsh://open";
		document.body.append(frame);
		setTimeout(() => frame.remove(), 1e3);
	};
}
/** 发一条系统通知；总开关关闭、环境不支持、未授权或本页正在看时静默跳过。
* 日志只在门之后记录：被拦下的触发不产生「弹窗」日志。 */
function toast(title, body, icon, sessionId) {
	if (!notifyEnabled) return;
	if (isPageActive()) return;
	if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
	console.log("[dsh-pet] 【彈窗】" + title + (body ? "：" + body : ""));
	try {
		const opts = {};
		if (body) opts.body = truncate(body);
		if (icon) opts.icon = icon;
		const n = new Notification(title, opts);
		wireNotificationClick(n, sessionId);
	} catch {}
}
/**
* 帧 → toast 并发出；未知帧静默跳过，帧里的 sessionId 一并透传给点击行为。
* 标题优先用会话名：同一个宿主上可以并行跑多条会话，通知里必须能认出是哪一条回来了。
*/
function toastFrame(frame) {
	const sessionId = typeof frame.sessionId === "string" ? frame.sessionId : void 0;
	const t = frameToToast(frame, sessionTitleFrom(sessionNavigator, sessionId));
	if (!t) return;
	toast(t.title, t.body, PIC(t.icon), sessionId);
}
async function requestNotificationPermission() {
	if (typeof Notification === "undefined") return {
		ok: false,
		reason: "unsupported"
	};
	if (Notification.permission === "granted") return { ok: true };
	if (Notification.permission === "denied") return {
		ok: false,
		reason: "denied"
	};
	try {
		const p = await Notification.requestPermission();
		if (p === "granted") return { ok: true };
		if (p === "denied") return {
			ok: false,
			reason: "rejected"
		};
		return {
			ok: false,
			reason: "error",
			message: "權限未授予（" + p + "）"
		};
	} catch (e) {
		return {
			ok: false,
			reason: "error",
			message: e instanceof Error ? e.message : String(e)
		};
	}
}
/** 读系统通知总开关（成品配置 main 条目）；拉取或解析失败时按开启处理，不阻塞。 */
async function readNotificationsEnabled() {
	try {
		const r = await fetch(ROUTE_PATH + "/config");
		if (!r.ok) return true;
		const d = await r.json().catch(() => null);
		return typeof d?.main?.notificationsEnabled === "boolean" ? d.main.notificationsEnabled : true;
	} catch {
		return true;
	}
}
async function reloadNotifications() {
	notifyEnabled = await readNotificationsEnabled();
}
function notifyFromFrame(frame) {
	toastFrame(frame);
}
function initNotify(navigator$1) {
	sessionNavigator = navigator$1;
	readNotificationsEnabled().then((enabled) => {
		notifyEnabled = enabled;
		if (typeof Notification !== "undefined" && enabled && Notification.permission === "default") requestNotificationPermission();
	});
	return initFocusTracking();
}

//#endregion
//#region src/client/settings/css.ts
/**
* 设置页样式表与注入入口：三族类名——`dsh-pet-mp__*`（AI 模型选择器）、`dsh-pet-sel__*`（通用单选下拉）与 `dsh-pet-cfg__*`（配置卡片）。
* 只放伪类、悬浮、过渡与容器查询这类内联 style 表达不了的东西，其余排版走组件内联 style。
* 颜色与圆角取 `--dsw-alias-*` / `--dsw-radius-*` token；填充按钮上的白字与阴影回退值是刻意例外。
* 注入按 `data-plugin-css` 去重，同一页面重复渲染设置页不会长第二份样式。
* @module dsh-pet/src/client/settings/css
*/
/** 设置页样式表；按类名族分段拼成单段文本，行内注释标出反直觉的那几条规则。 */
const SETTINGS_CSS = [
	".dsh-pet-mp{position:relative;min-width:0;display:flex;flex-direction:column;gap:4px}",
	".dsh-pet-mp__trigger{display:flex;align-items:center;gap:6px;width:100%;max-width:340px;height:28px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;text-align:left;cursor:pointer;outline:none}",
	".dsh-pet-mp__trigger:hover:not(:disabled){border-color:var(--dsw-alias-state-business-primary)}",
	".dsh-pet-mp__trigger:focus-visible{border-color:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}",
	".dsh-pet-mp__trigger:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}",
	".dsh-pet-mp__label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}",
	".dsh-pet-mp__sub{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex-shrink:1000;color:var(--dsw-alias-label-caption,var(--dsw-alias-label-tertiary))}",
	".dsh-pet-mp__chevron{flex:none;margin-left:auto;color:var(--dsw-alias-label-caption,var(--dsw-alias-label-tertiary));transition:transform .12s}",
	".dsh-pet-mp__chevron.is-open{transform:rotate(180deg)}",
	".dsh-pet-mp__panel{position:fixed;z-index:2147483000;display:flex;flex-direction:column;gap:4px;padding:4px;overflow:hidden;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md,10px);background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-elevation-prominent,0 8px 30px rgba(0,0,0,.35));color:var(--dsw-alias-label-primary)}",
	".dsh-pet-mp__search{box-sizing:border-box;width:100%;height:28px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;outline:none}",
	".dsh-pet-mp__search:focus{border-color:var(--dsw-alias-state-business-primary)}",
	".dsh-pet-mp__list{display:flex;flex-direction:column;min-height:0;overflow-x:hidden;overflow-y:auto;scrollbar-width:thin}",
	".dsh-pet-mp__group{padding:6px 8px 2px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}",
	".dsh-pet-mp__item{display:flex;align-items:center;gap:8px;width:100%;padding:6px 8px;border:none;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:inherit;font-size:13px;line-height:20px;text-align:left;cursor:pointer}",
	".dsh-pet-mp__item:hover:not(:disabled),.dsh-pet-mp__item.is-active{background:var(--dsw-alias-interactive-bg-hover)}",
	".dsh-pet-mp__item[aria-checked=\"true\"]{color:var(--dsw-alias-state-business-primary)}",
	".dsh-pet-mp__item:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}",
	".dsh-pet-mp__name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}",
	".dsh-pet-mp__check{flex:none;margin-left:auto}",
	".dsh-pet-mp__status{padding:8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}",
	".dsh-pet-sel{position:relative;min-width:0}",
	".dsh-pet-sel__trigger{display:flex;align-items:center;gap:6px;text-align:left;cursor:pointer}",
	".dsh-pet-sel__trigger:disabled{cursor:default}",
	".dsh-pet-sel__label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}",
	".dsh-pet-sel__chevron{flex:none;margin-left:auto;width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;border-top:5px solid currentColor;color:var(--dsw-alias-label-tertiary);transition:transform .12s}",
	".dsh-pet-sel__chevron.is-open{transform:rotate(180deg)}",
	".dsh-pet-sel__panel{position:fixed;z-index:2147483000;display:flex;flex-direction:column;gap:2px;padding:4px;overflow:hidden;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md,10px);background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-elevation-prominent,0 8px 30px rgba(0,0,0,.35));color:var(--dsw-alias-label-primary)}",
	".dsh-pet-sel__list{display:flex;flex-direction:column;min-height:0;overflow-x:hidden;overflow-y:auto;scrollbar-width:thin}",
	".dsh-pet-sel__item{display:flex;align-items:center;gap:8px;width:100%;padding:5px 8px;border:none;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:inherit;font:inherit;font-size:13px;line-height:20px;text-align:left;cursor:pointer}",
	".dsh-pet-sel__item:hover:not(:disabled),.dsh-pet-sel__item.is-active{background:var(--dsw-alias-interactive-bg-hover)}",
	".dsh-pet-sel__item[aria-selected=\"true\"]{color:var(--dsw-alias-state-business-primary)}",
	".dsh-pet-sel__item:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}",
	".dsh-pet-sel__name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}",
	".dsh-pet-sel__check{flex:none;margin-left:auto}",
	".dsh-pet-cfg{container-type:inline-size;display:flex;flex-direction:column;gap:12px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}",
	".dsh-pet-cfg__title{display:flex;align-items:center;gap:6px;margin:0;font-size:16px;font-weight:500;line-height:24px}",
	".dsh-pet-cfg__card{display:flex;flex-direction:column;gap:10px;padding:12px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px}",
	".dsh-pet-cfg__cardHead{display:flex;align-items:center;gap:6px;min-height:20px}",
	".dsh-pet-cfg__cardTitle{font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary)}",
	".dsh-pet-cfg__card.is-fold{gap:0}",
	".dsh-pet-cfg__foldToggle{display:flex;align-items:center;gap:6px;flex:1 1 auto;min-width:0;min-height:20px;padding:0;border:none;border-radius:4px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;outline:none}",
	".dsh-pet-cfg__foldToggle:focus-visible{box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}",
	".dsh-pet-cfg__chevron{flex:none;margin-left:auto;width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;border-top:5px solid currentColor;color:var(--dsw-alias-label-tertiary);transition:transform .12s}",
	".dsh-pet-cfg__chevron.is-open{transform:rotate(180deg)}",
	".dsh-pet-cfg__fold{display:grid;grid-template-rows:0fr;transition:grid-template-rows .12s ease}",
	".dsh-pet-cfg__card.is-open .dsh-pet-cfg__fold{grid-template-rows:1fr}",
	".dsh-pet-cfg__foldClip{min-height:0;overflow:hidden}",
	".dsh-pet-cfg__foldBody{display:flex;flex-direction:column;gap:10px;padding-top:10px}",
	".dsh-pet-cfg__grid3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px 16px;align-items:end}",
	".dsh-pet-cfg__grid4{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px 16px;align-items:end}",
	".dsh-pet-cfg__grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 16px;align-items:end}",
	"@container (max-width:600px){.dsh-pet-cfg__grid4{grid-template-columns:repeat(2,minmax(0,1fr))}}",
	"@container (max-width:400px){.dsh-pet-cfg__grid2,.dsh-pet-cfg__grid3,.dsh-pet-cfg__grid4{grid-template-columns:minmax(0,1fr)}}",
	".dsh-pet-cfg__field{display:flex;flex-direction:column;gap:4px;min-width:0}",
	".dsh-pet-cfg__flabel{display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--dsw-alias-label-secondary)}",
	".dsh-pet-cfg__inp{box-sizing:border-box;width:100%;min-height:28px;padding:4px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;outline:none}",
	".dsh-pet-cfg__inp:focus{border-color:var(--dsw-alias-state-business-primary)}",
	".dsh-pet-cfg__inp:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}",
	".dsh-pet-cfg__persona{display:flex;flex-direction:column;gap:2px;min-width:0}",
	".dsh-pet-cfg__area{min-height:66px;resize:vertical;line-height:18px}",
	".dsh-pet-cfg__count{font-size:11px;color:var(--dsw-alias-label-tertiary);text-align:right}",
	".dsh-pet-cfg__toggle{display:flex;align-items:center;gap:6px;min-width:0;font-size:13px;color:var(--dsw-alias-label-primary)}",
	".dsh-pet-cfg__toggle>label{display:inline-flex;align-items:center;gap:6px;cursor:pointer;min-width:0}",
	".dsh-pet-cfg__toggle>label>span{overflow-wrap:anywhere}",
	".dsh-pet-cfg__toggle input[type=checkbox]{flex:none;width:16px;height:16px;margin:0;accent-color:var(--dsw-alias-state-business-primary);cursor:pointer}",
	".pet-cfg-tip{position:fixed;left:0;top:0;z-index:2147483000;max-width:320px;padding:6px 10px;border-radius:8px;background:var(--dsw-alias-tooltip-bg);color:var(--dsw-static-neutral-00);font-size:12px;font-style:normal;font-weight:400;line-height:18px;text-align:left;white-space:pre-wrap;overflow-wrap:anywhere;pointer-events:none;opacity:0;transition:opacity .12s ease;box-shadow:var(--dsw-elevation-prominent,0 6px 20px rgba(0,0,0,.22))}",
	".pet-cfg-tip.is-on{opacity:1}",
	".dsh-pet-cfg__q{display:inline-flex;align-items:center;justify-content:center;flex:none;width:14px;height:14px;border:1px solid var(--dsw-alias-label-tertiary);border-radius:50%;color:var(--dsw-alias-label-tertiary);font-size:10px;font-style:normal;line-height:1;cursor:help;user-select:none}",
	".dsh-pet-cfg__qWrap{display:inline-flex;flex:none;align-items:center}",
	".dsh-pet-cfg__btn{border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);border-radius:8px;padding:4px 14px;font:inherit;font-size:12px;line-height:20px;cursor:pointer;white-space:nowrap}",
	".dsh-pet-cfg__btn:hover:not(:disabled):not(.is-primary){background:var(--dsw-alias-interactive-bg-hover)}",
	".dsh-pet-cfg__btn:disabled{opacity:.5;cursor:default}",
	".dsh-pet-cfg__btn.is-primary{border-color:var(--dsw-alias-button-info-fill);background:var(--dsw-alias-button-info-fill);color:#fff}",
	".dsh-pet-cfg__btn.is-primary:hover:not(:disabled){border-color:var(--dsw-alias-button-info-hover);background:var(--dsw-alias-button-info-hover)}",
	".dsh-pet-cfg__btn.is-danger{border-color:var(--dsw-alias-state-error-secondary);color:var(--dsw-alias-state-error-primary)}",
	".dsh-pet-cfg__btn.is-sm{padding:2px 10px}",
	".dsh-pet-cfg__btn.is-ghost{border-style:dashed;color:var(--dsw-alias-label-secondary)}",
	".dsh-pet-cfg__tabs{display:flex;gap:8px;flex-wrap:wrap;align-items:center}",
	".dsh-pet-cfg__tabsLabel{font-size:12px;color:var(--dsw-alias-label-secondary)}",
	".dsh-pet-cfg__kinds{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px}",
	".dsh-pet-cfg__tab{border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);border-radius:8px;padding:4px 12px;font:inherit;font-size:13px;cursor:pointer}",
	".dsh-pet-cfg__tab:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}",
	".dsh-pet-cfg__tab:disabled{opacity:.5;cursor:default}",
	".dsh-pet-cfg__tab.is-active{border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-interactive-bg-active)}",
	".dsh-pet-cfg__tab.is-ghost{border-style:dashed;color:var(--dsw-alias-label-secondary)}",
	".dsh-pet-cfg__actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:4px}",
	".dsh-pet-cfg__msg{margin-left:4px;font-size:12px;color:var(--dsw-alias-state-success-primary)}",
	".dsh-pet-cfg__msg.is-err{color:var(--dsw-alias-state-error-primary)}",
	".dsh-pet-cfg__note{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}",
	".dsh-pet-cfg__path{font-size:12px;line-height:18px;word-break:break-all;user-select:text;color:var(--dsw-alias-label-secondary)}",
	".dsh-pet-cfg__path b{color:var(--dsw-alias-label-primary);font-weight:400}",
	".dsh-pet-cfg__cmd{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,\"Courier New\",monospace;font-size:12px;line-height:18px;word-break:break-all;user-select:text;padding:6px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary)}"
].join("\n");
/** 注入去重用的标记值，写在 `<style>` 的 `data-plugin-css` 上。 */
const settingsCssTag = "dsh-pet/settings.css";
function injectSettingsCss() {
	if (typeof document === "undefined") return;
	if (document.querySelector("style[data-plugin-css=\"" + settingsCssTag + "\"]") !== null) return;
	const tag = document.createElement("style");
	tag.dataset.plugin = "dsh-pet";
	tag.dataset.pluginCss = settingsCssTag;
	tag.textContent = SETTINGS_CSS;
	document.head.appendChild(tag);
}

//#endregion
//#region src/client/settings/ui.ts
const INPUT_CLASS = "dsh-pet-cfg__inp";
function numberInputProps(value, onCommit, extra = {}) {
	return {
		...extra,
		type: "number",
		className: INPUT_CLASS,
		defaultValue: String(value),
		key: String(value),
		onBlur: (e) => {
			const text = e.target.value.trim();
			const parsed = Number(text);
			const next = text !== "" && Number.isFinite(parsed) ? parsed : value;
			e.target.value = String(next);
			if (next !== value) onCommit(next);
		},
		onKeyDown: (e) => {
			if (e.key === "Enter") e.currentTarget.blur();
		}
	};
}
const MONO_STACK = "ui-monospace, SFMono-Regular, Menlo, Consolas, \"Courier New\", monospace";
function makeUiKit(rt) {
	const { h, t } = rt;
	/**
	* 悬浮说明的展开属性。
	*
	* @param text - 说明正文（已翻译）。
	*/
	const tip = (text) => ({ "data-tip": text });
	/** 问号：气泡的圆形触发元素。用 `<i>` 而不是 `<button>`——它只展示说明，点了不该有行为，也不该进 Tab 顺序。 */
	const q = (text) => h("i", {
		className: "dsh-pet-cfg__q",
		...tip(text),
		"aria-label": text,
		role: "img",
		children: "?"
	});
	return {
		tip,
		q,
		cardHead: (title, hint) => h("div", {
			className: "dsh-pet-cfg__cardHead",
			children: [h("span", {
				key: "t",
				className: "dsh-pet-cfg__cardTitle",
				children: title
			}), hint ? q(hint) : null]
		}),
		field: (label, control, hint) => h("div", {
			className: "dsh-pet-cfg__field",
			children: [h("span", {
				key: "l",
				className: "dsh-pet-cfg__flabel",
				children: hint ? [label, q(hint)] : label
			}), control]
		}),
		toggleCell: (label, value, disabled, onToggle) => h("div", {
			className: "dsh-pet-cfg__toggle",
			children: [h("label", {
				key: "l",
				children: [h("input", {
					key: "i",
					type: "checkbox",
					checked: value,
					disabled,
					onChange: (e) => onToggle(e.target.checked)
				}), h("span", {
					key: "t",
					children: t(label)
				})]
			}), q(t(label + "Hint"))]
		}),
		foldCard: (options) => h("div", {
			className: "dsh-pet-cfg__card is-fold" + (options.open ? " is-open" : ""),
			children: [h("button", {
				key: "head",
				type: "button",
				className: "dsh-pet-cfg__foldToggle",
				"aria-expanded": options.open,
				"aria-controls": options.id,
				onClick: options.onToggle,
				children: [
					h("span", {
						key: "t",
						className: "dsh-pet-cfg__cardTitle",
						children: options.title
					}),
					h("span", {
						key: "q",
						className: "dsh-pet-cfg__qWrap",
						onClick: (e) => e.stopPropagation(),
						children: q(options.hint)
					}),
					h("i", {
						key: "c",
						className: "dsh-pet-cfg__chevron" + (options.open ? " is-open" : ""),
						"aria-hidden": "true"
					})
				]
			}), h("div", {
				key: "body",
				id: options.id,
				className: "dsh-pet-cfg__fold",
				"aria-hidden": options.open ? void 0 : "true",
				children: h("div", {
					className: "dsh-pet-cfg__foldClip",
					children: h("div", {
						className: "dsh-pet-cfg__foldBody",
						children: options.body
					})
				})
			})]
		})
	};
}

//#endregion
//#region src/client/settings/actions.ts
function makeActions(rt) {
	const { h, t } = rt;
	const { tip, q } = makeUiKit({
		h,
		t
	});
	return function Actions(props) {
		const { busy, msg, permMsg } = props;
		return h("div", {
			className: "dsh-pet-cfg__actions",
			children: [
				h("button", {
					type: "button",
					disabled: busy,
					onClick: props.onSave,
					className: "dsh-pet-cfg__btn is-primary",
					...tip(t("saveHotkey")),
					children: t("save")
				}),
				h("button", {
					type: "button",
					disabled: busy,
					onClick: props.onSync,
					className: "dsh-pet-cfg__btn",
					children: t("sync")
				}),
				h("button", {
					type: "button",
					onClick: props.onTestNotification,
					className: "dsh-pet-cfg__btn",
					children: t("notifyTest")
				}),
				q(t("syncHint")),
				msg.text ? h("span", {
					className: "dsh-pet-cfg__msg" + (msg.kind === "err" ? " is-err" : ""),
					children: msg.text
				}) : null,
				permMsg.text ? h("span", {
					className: "dsh-pet-cfg__msg" + (permMsg.kind === "err" ? " is-err" : ""),
					children: permMsg.text
				}) : null
			]
		});
	};
}

//#endregion
//#region src/client/settings/bridge.ts
const petBridge = {
	current: [],
	reload: () => {},
	template: void 0
};

//#endregion
//#region src/client/settings/config/read.ts
/** 非负有限数才算合法；其余（`NaN`、负数、字符串）一律当作没写。 */
const nonNegative = (value) => {
	const n = Number(value);
	return Number.isFinite(n) && n >= 0 ? n : void 0;
};
/** 一对模型选择：两项都是字符串才算写全，只写一半视为没写（宿主会按非法拒绝）。 */
const readModel = (value) => {
	const model = value;
	if (!model || typeof model.provider !== "string" || typeof model.model !== "string") return void 0;
	return {
		provider: model.provider,
		model: model.model
	};
};
function readMainConfig(merged) {
	const main = merged.main;
	if (!main || !Array.isArray(main.pets)) return null;
	const pets = main.pets;
	const patch = { pets: pets.map((pet) => ({
		...pet,
		position: { ...pet.position }
	})) };
	if (typeof main.whisperPrompt === "string") patch.entryPrompt = main.whisperPrompt;
	if (typeof main.notificationsEnabled === "boolean") patch.notificationsEnabled = main.notificationsEnabled;
	if (typeof main.clickSoundEnabled === "boolean") patch.clickSoundEnabled = main.clickSoundEnabled;
	if (typeof main.whisperImageEnabled === "boolean") patch.whisperImageEnabled = main.whisperImageEnabled;
	if (typeof main.chatImageEnabled === "boolean") patch.chatImageEnabled = main.chatImageEnabled;
	if (typeof main.chatAnimationEnabled === "boolean") patch.chatAnimationEnabled = main.chatAnimationEnabled;
	if (typeof main.confineToScreen === "boolean") patch.confineToScreen = main.confineToScreen;
	if (typeof main.trayEnabled === "boolean") patch.trayEnabled = main.trayEnabled;
	if (typeof main.voiceEnabled === "boolean") patch.voiceEnabled = main.voiceEnabled;
	if (typeof main.voiceName === "string") patch.voiceName = main.voiceName;
	if (typeof main.voiceWhisperEnabled === "boolean") patch.voiceWhisperEnabled = main.voiceWhisperEnabled;
	if (typeof main.voiceTodoEnabled === "boolean") patch.voiceTodoEnabled = main.voiceTodoEnabled;
	if (main.physics && typeof main.physics === "object") patch.physics = {
		...DEFAULT_PHYSICS,
		...main.physics
	};
	if (main.font && typeof main.font === "object") patch.font = {
		...DEFAULT_FONT,
		...main.font
	};
	const whisperModel = readModel(main.whisperModel);
	if (whisperModel) patch.whisperModel = whisperModel;
	const chatModel = readModel(main.chatModel);
	if (chatModel) patch.chatModel = chatModel;
	const rounds = nonNegative(main.chatMemoryRounds);
	if (rounds !== void 0) patch.chatMemoryRounds = rounds;
	const limit = nonNegative(main.chatImageLimit);
	if (limit !== void 0) patch.chatImageLimit = limit;
	const volume = nonNegative(main.voiceVolume);
	if (volume !== void 0 && volume <= 1) patch.voiceVolume = volume;
	return patch;
}
function readConfigEntries(merged) {
	const main = merged.main;
	if (!main || !Array.isArray(main.pets)) return null;
	const out = [];
	for (const [key, conf] of Object.entries(merged)) {
		const pets = Array.isArray(conf?.pets) ? conf.pets : [];
		out.push({
			key,
			kind: key === "main" ? "main" : "pack",
			...typeof conf?.whisperPrompt === "string" ? { entryPrompt: conf.whisperPrompt } : {},
			pets: pets.map((pet) => ({
				...pet,
				position: { ...pet.position },
				assetRoot: key
			}))
		});
	}
	return out;
}

//#endregion
//#region src/client/settings/config/http.ts
function buildSaveBody(fields) {
	return {
		pets: fields.pets,
		notificationsEnabled: fields.notificationsEnabled,
		clickSoundEnabled: fields.clickSoundEnabled,
		whisperImageEnabled: fields.whisperImageEnabled,
		chatImageEnabled: fields.chatImageEnabled,
		chatAnimationEnabled: fields.chatAnimationEnabled,
		confineToScreen: fields.confineToScreen,
		trayEnabled: fields.trayEnabled,
		voiceEnabled: fields.voiceEnabled,
		voiceName: fields.voiceName,
		voiceVolume: fields.voiceVolume,
		voiceWhisperEnabled: fields.voiceWhisperEnabled,
		voiceTodoEnabled: fields.voiceTodoEnabled,
		physics: fields.physics,
		whisperModel: fields.whisperModel,
		chatModel: fields.chatModel,
		chatMemoryRounds: fields.chatMemoryRounds,
		chatImageLimit: fields.chatImageLimit,
		font: fields.font
	};
}
async function loadConfig(signal) {
	try {
		const response = await fetch(ROUTE_PATH + "/config", signal === void 0 ? {} : { signal });
		if (!response.ok) return null;
		const body = await response.json();
		if (body.ok === false) return null;
		return body;
	} catch {
		return null;
	}
}
async function loadMeta() {
	try {
		const response = await fetch(ROUTE_PATH + "/config/meta");
		if (!response.ok) return null;
		return await response.json();
	} catch {
		return null;
	}
}
async function loadModelCatalog() {
	try {
		const response = await fetch(ROUTE_PATH + "/models");
		if (!response.ok) return null;
		const body = await response.json();
		if (!body || !Array.isArray(body.providers)) return null;
		return body.providers;
	} catch {
		return null;
	}
}
async function saveConfig(body, force) {
	try {
		const response = await fetch(ROUTE_PATH + "/config" + (force === true ? "?force=1" : ""), {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body)
		});
		const payload = await response.json().catch(() => null);
		if (payload && payload.ok === false) {
			if (payload.reason === "user-config-unparsable") return {
				kind: "corrupt",
				userFile: typeof payload.userFile === "string" ? payload.userFile : null
			};
			if (payload.reason === "bad-request" || payload.reason === "invalid-json") return { kind: "invalid" };
			return { kind: "error" };
		}
		if (!response.ok) return { kind: "error" };
		return {
			kind: "ok",
			merged: payload
		};
	} catch {
		return { kind: "error" };
	}
}
async function syncConfig() {
	try {
		const response = await fetch(ROUTE_PATH + "/config", { method: "POST" });
		if (!response.ok) return null;
		return await response.json();
	} catch {
		return null;
	}
}
async function savePetLayer(entry, pets) {
	try {
		const response = await fetch(ROUTE_PATH + "/pet-config", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				entry,
				pets
			})
		});
		const payload = await response.json().catch(() => null);
		if (payload && payload.ok === false) {
			if (payload.reason === "bad-request" || payload.reason === "unknown-entry") return {
				kind: "invalid",
				message: typeof payload.message === "string" ? payload.message : ""
			};
			return { kind: "error" };
		}
		if (!response.ok) return { kind: "error" };
		return {
			kind: "ok",
			merged: payload
		};
	} catch {
		return { kind: "error" };
	}
}

//#endregion
//#region src/client/settings/config/pack-writes.ts
/** 提交形状的指纹：只含会被宿主持久化的字段，位置逐子字段取。 */
function fingerprint(pet) {
	return JSON.stringify([
		pet.id,
		pet.name,
		pet.size,
		pet.sizePercent ?? "",
		pet.balanceEnabled,
		pet.whisperEnabled,
		pet.workStatusEnabled,
		pet.fixedEnabled,
		pet.display,
		pet.position.corner,
		pet.position.marginX,
		pet.position.marginY,
		pet.whisperPrompt ?? ""
	]);
}
function diffPackWrites(loaded, current$1) {
	const groups = new Map();
	for (const pet of current$1) {
		const entry = pet.assetRoot ?? "";
		if (entry === "" || entry === "main") continue;
		const list = groups.get(entry);
		if (list) list.push(pet);
		else groups.set(entry, [pet]);
	}
	const out = [];
	for (const [entry, pets] of groups) {
		const before = loaded.find((item) => item.key === entry)?.pets ?? [];
		const unchanged = before.length === pets.length && before.every((pet, i) => fingerprint(pet) === fingerprint(pets[i]));
		if (!unchanged) out.push({
			entry,
			pets
		});
	}
	return out;
}

//#endregion
//#region src/client/settings/config/persist.ts
async function persistSettings(fields, packWrites, force, fallbackUserFile) {
	const outcome = await saveConfig(buildSaveBody(fields), force);
	if (outcome.kind === "corrupt") return {
		kind: "corrupt",
		path: outcome.userFile ?? fallbackUserFile
	};
	if (outcome.kind !== "ok") return { kind: outcome.kind };
	let merged = outcome.merged;
	const failed = [];
	for (const write of packWrites) {
		const result = await savePetLayer(write.entry, write.pets);
		if (result.kind === "ok") merged = result.merged;
		else failed.push(write.entry);
	}
	petBridge.reload(merged);
	reloadNotifications();
	return failed.length > 0 ? {
		kind: "partial",
		failed
	} : { kind: "ok" };
}
async function syncSettings() {
	const merged = await syncConfig();
	if (merged === null) return null;
	petBridge.reload(merged);
	reloadNotifications();
	return merged;
}

//#endregion
//#region src/client/settings/config/validate-form.ts
const modelPairValid = (model) => model.provider.trim() === "" === (model.model.trim() === "");
/** 宠物：宽度必须为正数、百分比缺省或是不小于 1 的数字、两个偏移必须是有限数（负数合法，宠物可以压出屏外）。 */
const petValid = (pet) => Number.isFinite(pet.size) && pet.size > 0 && (pet.sizePercent === void 0 || isValidSizePercent(pet.sizePercent)) && Number.isFinite(pet.position.marginX) && Number.isFinite(pet.position.marginY);
/** 物理参数：与宿主 `physicsValid` 同名规则，客户端只覆盖数值字段（布尔项由宿主兜底）。 */
const physicsValid = (physics) => Number.isFinite(physics.gravity) && physics.gravity >= 0 && Number.isFinite(physics.restitution) && physics.restitution >= 0 && physics.restitution <= 1 && Number.isFinite(physics.groundFriction) && physics.groundFriction >= 0 && Number.isFinite(physics.throwPower) && physics.throwPower > 0;
/** 字体：种类必须在预设白名单内，字号在闭区间内。 */
const fontValid = (font) => FONT_PRESETS.some((preset) => preset.id === font.family) && Number.isFinite(font.size) && font.size >= FONT_SIZE_MIN && font.size <= FONT_SIZE_MAX;
function validateForm(values) {
	if (!values.pets.every(petValid)) return "invalid";
	if (!physicsValid(values.physics)) return "invalidPhysics";
	if (!modelPairValid(values.whisperModel) || !modelPairValid(values.chatModel)) return "invalidModel";
	if (!Number.isFinite(values.chatMemory) || values.chatMemory < 0) return "invalidChatMemory";
	if (!Number.isFinite(values.chatImageLimit) || values.chatImageLimit < 0) return "invalidChatImageLimit";
	if (!fontValid(values.font)) return "invalidFont";
	return null;
}

//#endregion
//#region src/client/settings/config/write-flow.ts
function createWriteFlow(deps) {
	const { setBusy, setMsg, setDialog, t } = deps;
	const save = async (force = false) => {
		if (deps.busy()) return;
		const fields = deps.fields();
		const invalid = validateForm({
			pets: fields.pets,
			physics: fields.physics,
			whisperModel: fields.whisperModel,
			chatModel: fields.chatModel,
			chatMemory: fields.chatMemoryRounds,
			chatImageLimit: fields.chatImageLimit,
			font: fields.font
		});
		if (invalid !== null) {
			setMsg({
				kind: "err",
				text: t(invalid)
			});
			return;
		}
		setBusy(true);
		setMsg({
			kind: "",
			text: ""
		});
		try {
			const result = await persistSettings(fields, deps.packWrites(), force, deps.userFile());
			if (result.kind === "ok") {
				setMsg({
					kind: "ok",
					text: t("saved")
				});
				return;
			}
			if (result.kind === "corrupt") {
				setDialog({
					kind: "corrupt",
					path: result.path
				});
				return;
			}
			if (result.kind === "partial") {
				setMsg({
					kind: "err",
					text: t("savePartial").replace("{names}", result.failed.join("、"))
				});
				return;
			}
			setMsg({
				kind: "err",
				text: t(result.kind === "invalid" ? "saveInvalid" : "saveError")
			});
		} finally {
			setBusy(false);
		}
	};
	const doSync = async () => {
		setBusy(true);
		setMsg({
			kind: "",
			text: ""
		});
		try {
			const merged = await syncSettings();
			if (merged === null) {
				setMsg({
					kind: "err",
					text: t("syncError")
				});
				return;
			}
			deps.applyConfig(merged);
			setMsg({
				kind: "ok",
				text: t("saved")
			});
		} finally {
			setBusy(false);
		}
	};
	return {
		save,
		requestSync: () => setDialog({ kind: "sync" }),
		confirmDialog: () => {
			const pending = deps.dialog();
			if (pending === null) return;
			setDialog(null);
			if (pending.kind === "remove") deps.onRemove();
			else if (pending.kind === "corrupt") save(true);
			else if (pending.kind === "sync") doSync();
		}
	};
}

//#endregion
//#region src/client/settings/config/use-config-load.ts
function useConfigLoad(rt, onMerged) {
	const { useState, useEffect } = rt;
	const [loadState, setLoadState] = useState("loading");
	const [attempt, setAttempt] = useState(0);
	useEffect(() => {
		let alive = true;
		const controller = new AbortController();
		loadConfig(controller.signal).then((merged) => {
			if (!alive) return;
			if (merged === null) {
				setLoadState("error");
				return;
			}
			onMerged(merged);
			setLoadState("ready");
		}).catch(() => {
			if (alive) setLoadState("error");
		});
		return () => {
			alive = false;
			controller.abort();
		};
	}, [onMerged, attempt]);
	const retry = () => {
		setLoadState("loading");
		setAttempt((value) => value + 1);
	};
	return {
		loadState,
		retry
	};
}

//#endregion
//#region src/client/settings/dialog.ts
/** 正文文案：每个场景一句，参数就地代入。 */
function bodyText(dialog, t, selId) {
	if (dialog.kind === "remove") return t("confirmRemove").replace("{id}", selId);
	if (dialog.kind === "lastOne") return t("atLeastOne");
	if (dialog.kind === "lastOfKind") return t("lastOfKind").replace("{entry}", dialog.entry);
	if (dialog.kind === "corrupt") return t("corruptBody").replace("{path}", dialog.path);
	return t("confirmSync");
}
/** 确认按钮文案：三个可确认场景各一句。 */
function confirmLabel(kind, t) {
	if (kind === "remove") return t("remove");
	if (kind === "corrupt") return t("corruptConfirm");
	return t("sync");
}
function makeDialog(rt) {
	const { h, t } = rt;
	return function SettingsDialog(props) {
		const { dialog } = props;
		const confirmable = dialog.kind === "lastOne" || dialog.kind === "lastOfKind" ? null : dialog;
		return h("div", {
			style: {
				position: "fixed",
				inset: 0,
				zIndex: 2147483647,
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				background: "rgba(0, 0, 0, 0.45)"
			},
			onClick: props.onDismiss,
			children: h("div", {
				style: {
					width: "340px",
					maxWidth: "calc(100vw - 40px)",
					background: "var(--dsw-alias-bg-layer-1)",
					border: "1px solid var(--dsw-alias-border-l2)",
					borderRadius: "12px",
					padding: "16px 18px",
					boxShadow: "0 8px 30px rgba(0, 0, 0, 0.35)",
					display: "flex",
					flexDirection: "column",
					gap: "12px"
				},
				onClick: (e) => e.stopPropagation(),
				children: [
					h("div", {
						style: {
							fontSize: "14px",
							fontWeight: 500,
							color: "var(--dsw-alias-label-primary)"
						},
						children: t(dialog.kind === "corrupt" ? "corruptTitle" : "confirmTitle")
					}),
					h("div", {
						style: {
							fontSize: "13px",
							lineHeight: "20px",
							color: "var(--dsw-alias-label-secondary)"
						},
						children: bodyText(dialog, t, props.selId)
					}),
					h("div", {
						style: {
							display: "flex",
							gap: "8px",
							justifyContent: "flex-end"
						},
						children: confirmable === null ? [h("button", {
							key: "ok",
							type: "button",
							onClick: props.onDismiss,
							className: "dsh-pet-cfg__btn is-primary",
							children: t("ok")
						})] : [h("button", {
							key: "cancel",
							type: "button",
							onClick: props.onDismiss,
							className: "dsh-pet-cfg__btn",
							children: t("cancel")
						}), h("button", {
							key: "confirm",
							type: "button",
							onClick: props.onConfirm,
							className: "dsh-pet-cfg__btn " + (confirmable.kind === "sync" ? "is-primary" : "is-danger"),
							children: confirmLabel(confirmable.kind, t)
						})]
					})
				]
			})
		});
	};
}

//#endregion
//#region src/client/settings/panel/placement.ts
/**
* 设置页浮层的定位计算：把触发器的实测矩形与视口尺寸换算成浮层的 fixed 坐标。
* 下方放不下且上方更宽裕时翻到上方，左右钳制在视口内，并给出高度上限——浮层自身不进文档流。
* 纯函数，不读 `window`：矩形与视口由调用方传入，便于单测与将来的视口外定位。
* 模型选择器与通用单选下拉共用这一份算术，差异只经 {@link PlacementOptions} 传入，不在调用方各自复制。
* @module dsh-pet/src/client/settings/panel/placement
*/
/** 浮层与触发器、视口边缘之间的间距。 */
const PANEL_GAP_PX = 12;
/** 浮层离触发器的偏移，避免贴着触发器边框。 */
const PANEL_OFFSET_PX = 4;
/** 视口余量：浮层左右各留 8px，不贴死屏幕边。 */
const EDGE_MARGIN_PX = 8;
/** 视口更窄时浮层宽度的兜底余量。 */
const VIEWPORT_INSET_PX = 16;
/** 视口窄到连它都装不下时，仍按这个宽度渲染。 */
const MIN_AVAILABLE_WIDTH_PX = 200;
function computePanelPlacement(anchor, viewport, options = {}) {
	const minWidth = options.minWidthPx ?? 240;
	const maxWidth = options.maxWidthPx ?? 420;
	const maxHeight = options.maxHeightPx ?? 360;
	const flipThreshold = options.flipThresholdPx ?? 240;
	const below = viewport.height - anchor.bottom - PANEL_GAP_PX;
	const above = anchor.top - PANEL_GAP_PX;
	const available = Math.max(MIN_AVAILABLE_WIDTH_PX, Math.min(maxWidth, viewport.width - VIEWPORT_INSET_PX));
	const width = Math.min(Math.max(anchor.width, minWidth), available);
	const left = Math.max(EDGE_MARGIN_PX, Math.min(anchor.left, viewport.width - width - EDGE_MARGIN_PX));
	const openUp = below < flipThreshold && above > below;
	return openUp ? {
		left,
		bottom: viewport.height - anchor.top + PANEL_OFFSET_PX,
		width,
		maxHeight: Math.min(maxHeight, above)
	} : {
		left,
		top: anchor.bottom + PANEL_OFFSET_PX,
		width,
		maxHeight: Math.min(maxHeight, below)
	};
}

//#endregion
//#region src/client/settings/panel/select.ts
function makeSelect(rt) {
	const { h, useState, useEffect, useRef } = rt;
	return function Select(props) {
		const [open, setOpen] = useState(false);
		const [active, setActive] = useState(0);
		const [pos, setPos] = useState(null);
		const rootRef = useRef(null);
		const panelRef = useRef(null);
		const selectedAt = props.options.findIndex((option) => option.id === props.value);
		const currentLabel = selectedAt >= 0 ? props.options[selectedAt].label : "";
		/** 打开并把高亮停到当前选中项上。 */
		const openAt = (index) => {
			setActive(index >= 0 ? index : 0);
			setOpen(true);
		};
		const commit = (index) => {
			const option = props.options[index];
			setOpen(false);
			if (option !== void 0 && option.id !== props.value) props.onChange(option.id);
		};
		const step = (dir) => {
			const count = props.options.length;
			if (count === 0) return;
			const next = (Math.max(active, 0) + dir + count) % count;
			setActive(next);
			panelRef.current?.querySelector("[data-row=\"" + next + "\"]")?.scrollIntoView({ block: "nearest" });
		};
		useEffect(() => {
			if (!open) return;
			const root = rootRef.current;
			const place = () => {
				if (!root) return;
				setPos(computePanelPlacement(
					root.getBoundingClientRect(),
					{
						width: window.innerWidth,
						height: window.innerHeight
					},
					// 与触发器等宽：240 的下限是给「服务商 + 模型」两段文字留的，单行下拉不该继承。
					{ minWidthPx: 0 }
));
			};
			place();
			const onDown = (e) => {
				const target = e.target;
				if (target && (rootRef.current?.contains(target) === true || panelRef.current?.contains(target) === true)) return;
				setOpen(false);
			};
			const onKey = (e) => {
				if (e.key === "Escape") setOpen(false);
			};
			document.addEventListener("mousedown", onDown, true);
			document.addEventListener("keydown", onKey, true);
			window.addEventListener("scroll", place, true);
			window.addEventListener("resize", place);
			return () => {
				document.removeEventListener("mousedown", onDown, true);
				document.removeEventListener("keydown", onKey, true);
				window.removeEventListener("scroll", place, true);
				window.removeEventListener("resize", place);
			};
		}, [open]);
		useEffect(() => {
			if (props.disabled) setOpen(false);
		}, [props.disabled]);
		const toggle = () => {
			if (props.disabled) return;
			if (open) setOpen(false);
			else openAt(selectedAt);
		};
		const onTriggerKey = (e) => {
			const count = props.options.length;
			if (e.key === "ArrowDown" || e.key === "ArrowUp") {
				e.preventDefault();
				if (open) step(e.key === "ArrowDown" ? 1 : -1);
				else openAt(selectedAt);
				return;
			}
			if (open && (e.key === "Home" || e.key === "End")) {
				e.preventDefault();
				setActive(e.key === "Home" || count === 0 ? 0 : count - 1);
				return;
			}
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				if (open) commit(active);
				else openAt(selectedAt);
			}
		};
		const panel = open && pos ? h("div", {
			ref: panelRef,
			className: "dsh-pet-sel__panel",
			role: "listbox",
			"aria-label": props.label,
			style: {
				left: pos.left + "px",
				top: pos.top === void 0 ? void 0 : pos.top + "px",
				bottom: pos.bottom === void 0 ? void 0 : pos.bottom + "px",
				width: pos.width + "px",
				maxHeight: pos.maxHeight + "px"
			},
			children: h("div", {
				className: "dsh-pet-sel__list",
				children: props.options.map((option, index) => h("button", {
					key: option.id,
					type: "button",
					role: "option",
					"aria-selected": option.id === props.value,
					"data-row": index,
					className: "dsh-pet-sel__item" + (index === active ? " is-active" : ""),
					onMouseMove: () => setActive(index),
					onClick: () => commit(index),
					children: [h("span", {
						key: "n",
						className: "dsh-pet-sel__name",
						children: option.label
					}), h("span", {
						key: "c",
						className: "dsh-pet-sel__check",
						children: option.id === props.value ? "✓" : ""
					})]
				}))
			})
		}) : null;
		return h("div", {
			ref: rootRef,
			className: "dsh-pet-sel",
			children: [h("button", {
				key: "trigger",
				type: "button",
				className: INPUT_CLASS + " dsh-pet-sel__trigger",
				disabled: props.disabled,
				"aria-haspopup": "listbox",
				"aria-expanded": open,
				"aria-label": props.label,
				onClick: toggle,
				onKeyDown: onTriggerKey,
				children: [h("span", {
					key: "l",
					className: "dsh-pet-sel__label",
					children: currentLabel
				}), h("span", {
					key: "c",
					className: "dsh-pet-sel__chevron" + (open ? " is-open" : "")
				})]
			}), panel]
		});
	};
}

//#endregion
//#region src/client/settings/font-card.ts
function makeFontCard(rt) {
	const { h, t } = rt;
	const { cardHead, field, toggleCell } = makeUiKit({
		h,
		t
	});
	const Select = makeSelect(rt);
	return function FontCard(props) {
		const { busy, font } = props;
		return h("div", {
			className: "dsh-pet-cfg__card",
			children: [
				cardHead(t("fontTitle"), t("fontHint")),
				h("div", {
					className: "dsh-pet-cfg__grid2",
					children: [field(t("fontFamilyLabel"), h(Select, {
						label: t("fontFamilyLabel"),
						value: font.family,
						options: FONT_PRESETS.map((preset) => ({
							id: preset.id,
							label: t("font." + preset.id)
						})),
						disabled: busy,
						onChange: (id) => props.onChange({ family: id })
					}), t("fontFamilyHint")), field(t("fontSizeLabel"), h("input", numberInputProps(font.size, (v) => props.onChange({ size: v }), {
						step: "1",
						min: String(FONT_SIZE_MIN),
						max: String(FONT_SIZE_MAX),
						disabled: busy
					})), t("fontSizeHint"))]
				}),
				h("div", {
					className: "dsh-pet-cfg__grid2",
					children: [toggleCell("fontFollowToggle", font.followPet, busy, (v) => props.onChange({ followPet: v }))]
				})
			]
		});
	};
}

//#endregion
//#region src/client/settings/global-card.ts
/** 开关的展示顺序与文案键。 */
const TOGGLES = [
	{
		key: "notificationsEnabled",
		label: "notifyToggle"
	},
	{
		key: "clickSoundEnabled",
		label: "clickSoundToggle"
	},
	{
		key: "confineToScreen",
		label: "confineToggle"
	},
	{
		key: "trayEnabled",
		label: "trayToggle"
	}
];
function makeGlobalCard(rt) {
	const { h, t } = rt;
	const { cardHead, toggleCell } = makeUiKit({
		h,
		t
	});
	return function GlobalCard(props) {
		return h("div", {
			className: "dsh-pet-cfg__card",
			children: [cardHead(t("globalTitle"), t("globalHint")), h("div", {
				className: "dsh-pet-cfg__grid4",
				children: TOGGLES.map((toggle) => toggleCell(toggle.label, props.values[toggle.key], props.busy, (value) => props.onChange(toggle.key, value)))
			})]
		});
	};
}

//#endregion
//#region src/client/settings/load-status.ts
function makeLoadStatus(rt) {
	const { h, t } = rt;
	return function LoadStatus(props) {
		if (props.loadState === "ready") return null;
		const failed = props.loadState === "error";
		return h("div", {
			role: failed ? "alert" : "status",
			className: "dsh-pet-cfg__actions",
			children: [h("span", { children: t(failed ? "loadError" : "loading") }), failed ? h("button", {
				type: "button",
				className: "dsh-pet-cfg__btn",
				onClick: props.onRetry,
				children: t("retry")
			}) : null]
		});
	};
}

//#endregion
//#region src/client/settings/model-card.ts
/** 對話开关的展示顺序与文案键。 */
const CHAT_TOGGLES = [
	{
		key: "whisperImageEnabled",
		label: "whisperImageToggle"
	},
	{
		key: "chatImageEnabled",
		label: "chatImageToggle"
	},
	{
		key: "chatAnimationEnabled",
		label: "chatAnimationToggle"
	}
];
function makeModelCard(rt, picker) {
	const { h, t } = rt;
	const { cardHead, field, toggleCell } = makeUiKit({
		h,
		t
	});
	return function ModelCard(props) {
		const { busy, catalog, failed } = props;
		/** 「全局默认」的数字格：标签与问号在上、数字输入在下。 */
		const numField = (label, value, setter) => field(t(label), h("input", numberInputProps(value, setter, {
			step: "1",
			min: "0",
			disabled: busy
		})), t(label + "Hint"));
		/** 「AI 模型」的一格：标签与问号在上、单下拉选择器在下。 */
		const modelCell = (key, value) => {
			const label = t(key === "whisperModel" ? "whisperModelLabel" : "chatModelLabel");
			return field(label, h(picker, {
				label,
				value,
				disabled: busy,
				catalog,
				failed,
				onChange: (next) => props.onModelChange(key, next)
			}), t("modelFieldHint"));
		};
		return h("div", {
			className: "dsh-pet-cfg__card",
			children: [
				cardHead(t("modelTitle"), t("modelHint")),
				failed ? h("p", {
					className: "dsh-pet-cfg__note",
					style: { color: "var(--dsw-alias-state-error-primary)" },
					children: t("modelCatalogFailed")
				}) : null,
				h("div", {
					className: "dsh-pet-cfg__grid2",
					children: [modelCell("whisperModel", props.whisperModel), modelCell("chatModel", props.chatModel)]
				}),
				h("div", {
					className: "dsh-pet-cfg__grid4",
					children: [numField("chatMemory", props.chatMemory, props.onChatMemoryChange), numField("chatImageLimit", props.chatImageLimit, props.onChatImageLimitChange)]
				}),
				h("div", {
					className: "dsh-pet-cfg__grid3",
					children: CHAT_TOGGLES.map((toggle) => toggleCell(toggle.label, props.values[toggle.key], busy, (value) => props.onFlagChange(toggle.key, value)))
				})
			]
		});
	};
}

//#endregion
//#region src/client/pet/device-tilt.ts
const TILT_DEAD_ZONE_DEG = 2;
const SHAKE_THRESHOLD = 18;
const SHAKE_COOLDOWN_MS = 300;
/** 摇一摇基准：3600 px/s 起，随加速度线性加码，封顶 4800。 */
const SHAKE_BASE_SPEED = 3600;
const SHAKE_GAIN = 160;
const SHAKE_MAX_BONUS = 4800;
/** 屏幕方向角（0/90/180/270）：横屏时倾斜轴要换过来。 */
const screenAngleDeg = () => {
	if (typeof screen === "undefined" || !screen.orientation) return 0;
	return screen.orientation.angle || 0;
};
/** 把角度差折到最近的等价角，避免从 179° 跳到 -179° 时方向反转。 */
const nearestDelta = (delta, period) => {
	const half = period / 2;
	return ((delta + half) % period + period) % period - half;
};
function tiltGravity(sample, baseline, gravity, screenAngle = screenAngleDeg()) {
	const dBeta = nearestDelta(sample.beta - baseline.beta, 360);
	const dGamma = nearestDelta(sample.gamma - baseline.gamma, 180);
	if (Math.abs(dBeta) < TILT_DEAD_ZONE_DEG && Math.abs(dGamma) < TILT_DEAD_ZONE_DEG) return {
		gx: 0,
		gy: 0
	};
	if (!Number.isFinite(gravity) || gravity <= 0) return {
		gx: 0,
		gy: 0
	};
	const rad = Math.PI / 180;
	const ax = gravity * Math.sin(dGamma * rad);
	const ay = gravity * Math.sin(dBeta * rad);
	switch ((screenAngle % 360 + 360) % 360) {
		case 90: return {
			gx: ay,
			gy: -ax
		};
		case 180: return {
			gx: -ax,
			gy: -ay
		};
		case 270: return {
			gx: -ay,
			gy: ax
		};
		default: return {
			gx: ax,
			gy: ay
		};
	}
}
function shakeImpulse(ax, ay, az, throwPower) {
	const mag = Math.hypot(ax, ay, az);
	if (!Number.isFinite(mag) || mag < SHAKE_THRESHOLD) return null;
	const lateral = Math.hypot(ax, ay);
	if (lateral < 1e-6) return null;
	const speed = (SHAKE_BASE_SPEED + Math.min(SHAKE_MAX_BONUS, mag * SHAKE_GAIN)) * Math.max(0, throwPower);
	return {
		vx: ax / lateral * speed,
		vy: ay / lateral * speed
	};
}
function canReadMotionSensors() {
	return typeof DeviceOrientationEvent !== "undefined" && typeof DeviceMotionEvent !== "undefined";
}
async function requestMotionPermission(kinds) {
	const ask = async (ctor) => {
		if (ctor === void 0) return false;
		const fn = ctor.requestPermission;
		if (typeof fn !== "function") return true;
		try {
			return await fn.call(ctor) === "granted";
		} catch {
			return false;
		}
	};
	const granted = [];
	if (kinds.tilt) granted.push(await ask(globalThis.DeviceOrientationEvent));
	if (kinds.shake) granted.push(await ask(globalThis.DeviceMotionEvent));
	return granted.every(Boolean);
}
function subscribeTilt(onSample) {
	if (typeof window === "undefined" || typeof DeviceOrientationEvent === "undefined") return () => {};
	const handler = (e) => {
		if (e.beta === null || e.gamma === null) return;
		onSample({
			beta: e.beta,
			gamma: e.gamma
		});
	};
	window.addEventListener("deviceorientation", handler, true);
	return () => window.removeEventListener("deviceorientation", handler, true);
}
function subscribeShake(onShake, now = () => performance.now()) {
	if (typeof window === "undefined" || typeof DeviceMotionEvent === "undefined") return () => {};
	let lastAt = 0;
	const handler = (e) => {
		const a = e.acceleration;
		const raw = a && (a.x !== null || a.y !== null || a.z !== null) ? a : e.accelerationIncludingGravity;
		if (!raw) return;
		const ax = raw.x ?? 0;
		const ay = raw.y ?? 0;
		const az = raw.z ?? 0;
		if (Math.hypot(ax, ay, az) < SHAKE_THRESHOLD) return;
		const at = now();
		if (at - lastAt < SHAKE_COOLDOWN_MS) return;
		lastAt = at;
		onShake(ax, ay, az);
	};
	window.addEventListener("devicemotion", handler, true);
	return () => window.removeEventListener("devicemotion", handler, true);
}

//#endregion
//#region src/client/settings/mobile-card.ts
function makeMobileCard(rt) {
	const { h, t } = rt;
	const { cardHead, toggleCell } = makeUiKit({
		h,
		t
	});
	return function MobileCard(props) {
		const { busy, physics } = props;
		return h("div", {
			className: "dsh-pet-cfg__card",
			children: [cardHead(t("mobileTitle"), t("mobileHint")), h("div", {
				className: "dsh-pet-cfg__grid3",
				children: [
					toggleCell("physicsHaptic", physics.hapticEnabled !== false, busy, (v) => props.onChange({ hapticEnabled: v })),
					toggleCell("physicsTilt", physics.tiltGravity === true, busy, (v) => {
						if (v) requestMotionPermission({
							tilt: true,
							shake: false
						});
						props.onChange({ tiltGravity: v });
					}),
					toggleCell("physicsShake", physics.shakeThrow === true, busy, (v) => {
						if (v) requestMotionPermission({
							tilt: false,
							shake: true
						});
						props.onChange({ shakeThrow: v });
					})
				]
			})]
		});
	};
}

//#endregion
//#region src/client/settings/picker/model-rows.ts
function matchModelQuery(text, query) {
	const needle = query.trim().toLowerCase();
	if (needle === "") return true;
	let at = 0;
	for (const char of text.toLowerCase()) {
		if (char === needle[at]) at += 1;
		if (at >= needle.length) return true;
	}
	return false;
}
function buildModelRows(groups, query) {
	const needle = query.trim().toLowerCase();
	const rows = [];
	if (needle === "") rows.push({
		kind: "follow",
		key: "__follow"
	});
	for (const group of groups) {
		const models = group.models.filter((model) => matchModelQuery(model.name + " " + model.id, needle));
		if (models.length === 0 && !(needle === "" && group.models.length === 0)) continue;
		rows.push({
			kind: "group",
			key: group.id,
			name: group.name
		});
		if (models.length === 0) {
			rows.push({
				kind: "none",
				key: group.id + "/__none"
			});
			continue;
		}
		for (const model of models) rows.push({
			kind: "model",
			key: group.id + "/" + model.id,
			provider: group.id,
			model
		});
	}
	return rows;
}
function selectableIndexes(rows) {
	return rows.map((row, index) => row.kind === "group" || row.kind === "none" ? -1 : index).filter((i) => i >= 0);
}

//#endregion
//#region src/client/settings/picker/model-picker-panel.ts
function buildModelPanel(view) {
	const { h, t } = view;
	const emptyHint = view.catalog !== null && view.catalog.length === 0 ? t("modelNoModels") : view.rows.length === 0 ? t("modelEmpty") : "";
	return h("div", {
		ref: view.panelRef,
		className: "dsh-pet-mp__panel",
		role: "menu",
		"aria-label": view.label,
		style: {
			left: view.pos.left + "px",
			top: view.pos.top === void 0 ? void 0 : view.pos.top + "px",
			bottom: view.pos.bottom === void 0 ? void 0 : view.pos.bottom + "px",
			width: view.pos.width + "px",
			maxHeight: view.pos.maxHeight + "px"
		},
		children: [searchNode(view), view.catalog === null ? statusNode(h, "loading", view.failed ? t("modelCatalogFailed") : t("modelLoading"), false) : emptyHint !== "" ? statusNode(h, "empty", emptyHint, true) : h("div", {
			key: "list",
			className: "dsh-pet-mp__list",
			role: "group",
			children: view.rows.map((row, index) => rowNode(view, row, index))
		})]
	});
}
/** 三态提示行：加载中 / 失败 / 空结果。 */
function statusNode(h, key, text, live) {
	return h("div", {
		key,
		className: "dsh-pet-mp__status",
		role: live ? "status" : void 0,
		children: text
	});
}
/** 搜索框：↑↓ 走行、Enter 选中，Esc 由浮层级的 document 监听处理。 */
function searchNode(view) {
	const { h, t } = view;
	return h("input", {
		key: "search",
		type: "text",
		className: "dsh-pet-mp__search",
		role: "searchbox",
		placeholder: t("modelSearch"),
		"aria-label": t("modelSearch"),
		value: view.query,
		disabled: view.disabled,
		onChange: (event) => view.onQueryChange(event.target.value),
		onKeyDown: view.onKeyDown
	});
}
/** 一行：分组头、提示行、模型（可选、可高亮）。 */
function rowNode(view, row, index) {
	const { h, t } = view;
	if (row.kind === "group") return h("div", {
		key: row.key,
		className: "dsh-pet-mp__group",
		children: row.name
	});
	if (row.kind === "none") return h("div", {
		key: row.key,
		className: "dsh-pet-mp__status",
		children: t("modelNone")
	});
	const checked = row.kind === "follow" ? view.value.provider === "" : view.value.provider === row.provider && view.value.model === row.model.id;
	return h("button", {
		key: row.key,
		type: "button",
		role: "menuitemradio",
		"aria-checked": checked,
		"data-row": index,
		className: "dsh-pet-mp__item" + (index === view.active ? " is-active" : ""),
		disabled: view.disabled,
		onClick: () => view.onPick(row),
		onMouseMove: () => view.onHover(index),
		children: [h("span", {
			key: "n",
			className: "dsh-pet-mp__name",
			children: row.kind === "follow" ? t("modelFollow") : row.model.name
		}), h("span", {
			key: "c",
			className: "dsh-pet-mp__check",
			children: checked ? "✓" : ""
		})]
	});
}

//#endregion
//#region src/client/settings/picker/model-picker.ts
function makeModelPicker(rt) {
	const { h, useState, useEffect, useRef, t } = rt;
	return function ModelPicker(props) {
		const [open, setOpen] = useState(false);
		const [query, setQuery] = useState("");
		const [active, setActive] = useState(0);
		const [pos, setPos] = useState(null);
		const rootRef = useRef(null);
		const panelRef = useRef(null);
		const groups = props.catalog ?? [];
		const group = groups.find((g) => g.id === props.value.provider);
		const picked = group?.models.find((m) => m.id === props.value.model);
		const isFollow = props.value.provider === "";
		const triggerLabel = isFollow ? t("modelFollow") : picked?.name ?? props.value.model;
		const triggerSub = isFollow ? "" : group?.name ?? props.value.provider + t("modelUnknown");
		const rows = buildModelRows(groups, query);
		const selectable = selectableIndexes(rows);
		const commit = (value) => {
			props.onChange(value);
			setOpen(false);
			setQuery("");
		};
		const pick$1 = (row) => {
			if (!row) return;
			if (row.kind === "follow") commit({
				provider: "",
				model: ""
			});
			else if (row.kind === "model") commit({
				provider: row.provider,
				model: row.model.id
			});
		};
		const step = (dir) => {
			if (selectable.length === 0) return;
			const at = selectable.indexOf(active);
			const next = selectable[at < 0 ? 0 : (at + dir + selectable.length) % selectable.length];
			setActive(next);
			panelRef.current?.querySelector("[data-row=\"" + next + "\"]")?.scrollIntoView({ block: "nearest" });
		};
		useEffect(() => {
			if (!open) return;
			const el = rootRef.current;
			const place = () => {
				if (!el) return;
				setPos(computePanelPlacement(el.getBoundingClientRect(), {
					width: window.innerWidth,
					height: window.innerHeight
				}));
			};
			place();
			panelRef.current?.querySelector("input")?.focus();
			const onDown = (e) => {
				const target = e.target;
				if (target && (rootRef.current?.contains(target) === true || panelRef.current?.contains(target) === true)) return;
				setOpen(false);
			};
			const onKey = (e) => {
				if (e.key === "Escape") setOpen(false);
			};
			document.addEventListener("mousedown", onDown, true);
			document.addEventListener("keydown", onKey, true);
			window.addEventListener("scroll", place, true);
			window.addEventListener("resize", place);
			return () => {
				document.removeEventListener("mousedown", onDown, true);
				document.removeEventListener("keydown", onKey, true);
				window.removeEventListener("scroll", place, true);
				window.removeEventListener("resize", place);
			};
		}, [open]);
		const toggle = () => {
			if (props.disabled) return;
			if (!open) {
				setQuery("");
				const at = rows.findIndex((r) => r.kind === "model" && r.provider === props.value.provider && r.model.id === props.value.model);
				setActive(at >= 0 ? at : 0);
			}
			setOpen(!open);
		};
		const panel = open && pos ? buildModelPanel({
			h,
			t,
			label: props.label,
			disabled: props.disabled,
			catalog: props.catalog,
			failed: props.failed,
			rows,
			active,
			query,
			value: props.value,
			pos,
			panelRef,
			onQueryChange: (value) => {
				setQuery(value);
				setActive(selectable.length > 0 ? selectable[0] : 0);
			},
			onPick: pick$1,
			onHover: setActive,
			onKeyDown: (event) => {
				if (event.key === "ArrowDown") {
					event.preventDefault();
					step(1);
				} else if (event.key === "ArrowUp") {
					event.preventDefault();
					step(-1);
				} else if (event.key === "Enter") {
					event.preventDefault();
					pick$1(rows[active]);
				}
			}
		}) : null;
		return h("div", {
			ref: rootRef,
			className: "dsh-pet-mp",
			children: [h("button", {
				key: "trigger",
				type: "button",
				className: "dsh-pet-mp__trigger",
				disabled: props.disabled,
				"aria-haspopup": "menu",
				"aria-expanded": open,
				"aria-label": t("modelTriggerAria").replace("{model}", triggerLabel),
				onClick: toggle,
				children: [
					h("span", {
						key: "l",
						className: "dsh-pet-mp__label",
						children: triggerLabel
					}),
					triggerSub ? h("span", {
						key: "s",
						className: "dsh-pet-mp__sub",
						children: triggerSub
					}) : null,
					h("span", {
						key: "c",
						className: "dsh-pet-mp__chevron" + (open ? " is-open" : ""),
						children: "▾"
					})
				]
			}), panel]
		});
	};
}

//#endregion
//#region src/client/settings/picker/voice-picker.ts
function makeVoicePicker(rt) {
	const { h } = rt;
	const Select = makeSelect(rt);
	return function VoicePicker(props) {
		return h(Select, {
			label: props.label,
			value: props.value,
			options: props.options.map((option) => ({
				id: option.id,
				label: `${option.name}（${option.tag}）`
			})),
			disabled: props.disabled,
			onChange: props.onChange
		});
	};
}

//#endregion
//#region src/client/settings/notify-test.ts
async function runNotificationTest(deps) {
	const { t, report } = deps;
	report({
		kind: "",
		text: ""
	});
	const result = await requestNotificationPermission();
	if (!result.ok) {
		const reason = result.reason === "unsupported" ? t("notifyDenyUnsupported") : result.reason === "denied" ? t("notifyDenyBlocked") : result.reason === "rejected" ? t("notifyDenyRejected") : t("notifyDenyError") + (result.message ? "：" + result.message : "");
		report({
			kind: "err",
			text: reason + (result.reason === "unsupported" ? "" : " " + t("notifyGuide"))
		});
		return;
	}
	try {
		wireNotificationClick(new Notification("測試通知", {
			body: "【dsh-pet】系統通知已就緒。",
			icon: NOTIFY_ICONS.test
		}));
	} catch {}
	report({
		kind: "ok",
		text: t("notifyTestOk")
	});
}

//#endregion
//#region src/client/settings/kind-tabs.ts
function makeKindTabs(rt) {
	const { h, t } = rt;
	return function KindTabs(props) {
		return h("div", {
			className: "dsh-pet-cfg__kinds",
			children: [h("span", {
				key: "label",
				className: "dsh-pet-cfg__tabsLabel",
				children: t("kindLabel")
			}), ...props.kinds.map((item) => h("button", {
				key: item.entry,
				type: "button",
				disabled: props.busy,
				onClick: () => props.onSelect(item.entry),
				className: "dsh-pet-cfg__tab" + (item.entry === props.kind ? " is-active" : ""),
				children: (item.kind === "main" ? t("kindMain") : item.entry) + " (" + item.count + ")"
			}))]
		});
	};
}

//#endregion
//#region src/client/settings/paths-cards.ts
/** 折叠正文的 id：与按钮的 `aria-controls` 成对，两张卡各一份。 */
const BODY_ID$1 = {
	meta: "pet-cfg-paths-meta",
	storage: "pet-cfg-paths-storage"
};
function makePathsCards(rt) {
	const { h, t, useState } = rt;
	const { foldCard } = makeUiKit({
		h,
		t
	});
	function ConfigMetaCard(props) {
		const { paths } = props;
		const [open, setOpen] = useState(false);
		const line = (key, value, suffix = "") => value === void 0 ? null : h("div", {
			key,
			className: "dsh-pet-cfg__path",
			children: t(key) + "：" + value + suffix
		});
		const body = [
			line("defaultConfig", paths.default),
			line("userConfig", paths.user),
			line("todosFile", paths.todos),
			line("animationDir", paths.animations),
			line("memesDir", paths.memes),
			line("logFile", paths.logs),
			paths.logs ? h("div", {
				key: "logNote",
				className: "dsh-pet-cfg__note",
				children: t("logFileNote")
			}) : null
		];
		return foldCard({
			id: BODY_ID$1.meta,
			title: t("configMeta"),
			hint: t("configMetaHint"),
			body,
			open,
			onToggle: () => setOpen(!open)
		});
	}
	function StorageCard(props) {
		const { paths } = props;
		const [open, setOpen] = useState(false);
		const storage = paths.storage ?? [];
		if (storage.length === 0) return null;
		const body = [
			...storage.map((entry) => h("div", {
				key: entry.key,
				className: "dsh-pet-cfg__path",
				children: [h("b", {
					key: "p",
					style: { fontFamily: MONO_STACK },
					children: entry.path
				}), h("span", {
					key: "d",
					children: " — " + t("storage." + entry.key) + (entry.exists === false ? t("storageMissing") : "")
				})]
			})),
			h("div", {
				key: "ut",
				className: "dsh-pet-cfg__cardTitle",
				style: { marginTop: "4px" },
				children: t("uninstallTitle")
			}),
			h("div", {
				key: "u1",
				className: "dsh-pet-cfg__note",
				children: t("uninstallStep1")
			}),
			h("div", {
				key: "u2",
				className: "dsh-pet-cfg__note",
				children: t("uninstallStep2")
			}),
			h("div", {
				key: "cmd",
				className: "dsh-pet-cfg__cmd",
				children: t("uninstallCmd").replace("{profile}", paths.profile || "<profile>")
			}),
			h("div", {
				key: "u3",
				className: "dsh-pet-cfg__note",
				children: t("uninstallStep3")
			})
		];
		return foldCard({
			id: BODY_ID$1.storage,
			title: t("storageTitle"),
			hint: t("storageHint"),
			body,
			open,
			onToggle: () => setOpen(!open)
		});
	}
	return {
		ConfigMetaCard,
		StorageCard
	};
}

//#endregion
//#region src/shared/config.ts
const PET_DISPLAYS = [
	"web",
	"desktop",
	"both",
	"none"
];
const isWebVisible = (display) => display === "web" || display === "both";
function flattenConfigPets(merged) {
	const out = [];
	for (const [entry, conf] of Object.entries(merged)) {
		const list = Array.isArray(conf?.pets) ? conf.pets : [];
		for (const p of list) out.push({
			...p,
			animations: conf.animations,
			animationWeights: conf.animationWeights,
			eventsRefreshSec: conf.eventsRefreshSec,
			physics: conf.physics,
			font: conf.font,
			confineToScreen: conf.confineToScreen,
			workStatusTexts: conf.workStatusTexts,
			sleepStartTexts: conf.sleepStartTexts,
			sleepEndTexts: conf.sleepEndTexts,
			sleepRefuseTexts: conf.sleepRefuseTexts,
			whisperModel: conf.whisperModel,
			chatModel: conf.chatModel,
			memes: conf.memes,
			chatImageEnabled: conf.chatImageEnabled,
			chatAnimationEnabled: conf.chatAnimationEnabled,
			chatImageLimit: conf.chatImageLimit,
			assetRoot: entry,
			extra: entry !== "main"
		});
	}
	return out;
}

//#endregion
//#region src/client/settings/pet-card.ts
/** 四个角落的固定顺序；文案走 `corner.<corner>`。 */
const CORNERS = [
	"top-left",
	"top-right",
	"bottom-left",
	"bottom-right"
];
function makePetCard(rt) {
	const { h, t } = rt;
	const { tip, q, field, toggleCell } = makeUiKit({
		h,
		t
	});
	const Select = makeSelect(rt);
	/** 宠物数值输入（大小 / 水平偏移 / 垂直偏移）；宽度交给栅格。 */
	const numInput = (key, value, disabled, setter) => h("input", numberInputProps(value, setter, {
		step: key === "size" ? "10" : "1",
		min: key === "size" ? "120" : "",
		disabled
	}));
	/** 百分比输入：默认 20；不设上限（超过 100 只在 size 也够大时才生效）。 */
	const percentInput = (value, disabled, setter) => h("input", numberInputProps(value, setter, {
		min: String(SIZE_PERCENT_MIN),
		step: "1",
		disabled
	}));
	return function PetCard(props) {
		const { pet, busy, msg } = props;
		if (pet === null) return h("p", {
			className: "dsh-pet-cfg__note",
			children: t("emptyPets")
		});
		return h("div", {
			className: "dsh-pet-cfg__card",
			children: [
				h("div", {
					className: "dsh-pet-cfg__cardHead",
					children: [
						h("span", {
							key: "t",
							className: "dsh-pet-cfg__cardTitle",
							children: t("petCardTitle")
						}),
						q(t("petCardHint")),
						h("div", {
							key: "acts",
							style: {
								marginLeft: "auto",
								display: "flex",
								alignItems: "center",
								gap: "6px"
							},
							children: [
								msg.text ? h("span", {
									key: "msg",
									className: "dsh-pet-cfg__msg" + (msg.kind === "err" ? " is-err" : ""),
									children: msg.text
								}) : null,
								h("button", {
									key: "sv",
									type: "button",
									onClick: props.onSave,
									disabled: busy,
									className: "dsh-pet-cfg__btn is-primary is-sm",
									...tip(t("saveHotkey")),
									children: t("save")
								}),
								h("button", {
									key: "rm",
									type: "button",
									onClick: props.onRemove,
									disabled: busy,
									className: "dsh-pet-cfg__btn is-danger is-sm",
									children: t("remove")
								})
							]
						})
					]
				}),
				h("div", {
					className: "dsh-pet-cfg__grid4",
					children: [
						field(t("nameLabel"), h("input", {
							type: "text",
							className: INPUT_CLASS,
							value: String(pet.name ?? ""),
							disabled: busy,
							maxLength: 50,
							onChange: (e) => props.onChange({ name: e.target.value })
						}), t("nameHint")),
						field(t("sizeLabel"), numInput("size", pet.size, busy, (v) => props.onChange({ size: v })), t("sizeHint")),
						field(t("sizePercentLabel"), percentInput(pet.sizePercent ?? SIZE_PERCENT_DEFAULT, busy, (v) => props.onChange({ sizePercent: v })), t("sizePercentHint")),
						field(t("displayLabel"), h(Select, {
							label: t("displayLabel"),
							value: pet.display,
							options: PET_DISPLAYS.map((d) => ({
								id: d,
								label: t("display." + d)
							})),
							disabled: busy,
							onChange: (id) => props.onChange({ display: id })
						}), t("displayHint"))
					]
				}),
				h("div", {
					className: "dsh-pet-cfg__grid3",
					children: [
						field(t("cornerLabel"), h(Select, {
							label: t("cornerLabel"),
							value: pet.position.corner,
							options: CORNERS.map((c) => ({
								id: c,
								label: t("corner." + c)
							})),
							disabled: busy,
							onChange: (id) => props.onChange({ position: { corner: id } })
						}), t("cornerHint")),
						field(t("marginX"), numInput("marginX", pet.position.marginX, busy, (v) => props.onChange({ position: { marginX: v } })), t("marginXHint")),
						field(t("marginY"), numInput("marginY", pet.position.marginY, busy, (v) => props.onChange({ position: { marginY: v } })), t("marginYHint"))
					]
				}),
				h("div", {
					className: "dsh-pet-cfg__grid4",
					children: [
						toggleCell("balanceEnabled", !!pet.balanceEnabled, busy, (v) => props.onChange({ balanceEnabled: v })),
						toggleCell("whisperEnabled", !!pet.whisperEnabled, busy, (v) => props.onChange({ whisperEnabled: v })),
						toggleCell("workStatusEnabled", !!pet.workStatusEnabled, busy, (v) => props.onChange({ workStatusEnabled: v })),
						toggleCell("fixedEnabled", !!pet.fixedEnabled, busy, (v) => props.onChange({ fixedEnabled: v }))
					]
				}),
				field(t("personaLabel"), h("div", {
					className: "dsh-pet-cfg__persona",
					children: [h("textarea", {
						className: INPUT_CLASS + " dsh-pet-cfg__area",
						rows: 3,
						value: String(pet.whisperPrompt ?? ""),
						disabled: busy,
						placeholder: props.entryPrompt,
						onChange: (e) => props.onChange({ whisperPrompt: e.target.value })
					}), h("span", {
						className: "dsh-pet-cfg__count",
						children: t("personaCount").replace("{n}", String(String(pet.whisperPrompt ?? "").length))
					})]
				}), t("personaHint"))
			]
		});
	};
}

//#endregion
//#region src/client/settings/pet-tabs.ts
function makePetTabs(rt) {
	const { h, t } = rt;
	return function PetTabs(props) {
		return h("div", {
			className: "dsh-pet-cfg__tabs",
			children: [
				h("span", {
					key: "label",
					className: "dsh-pet-cfg__tabsLabel",
					children: t("petsLabel")
				}),
				...props.pets.map((pet) => h("button", {
					key: pet.id,
					type: "button",
					onClick: () => props.onSelect(pet.id),
					className: "dsh-pet-cfg__tab" + (pet.id === props.selId ? " is-active" : ""),
					children: (pet.name || pet.id) + " (" + pet.size + "px" + (pet.sizePercent === void 0 || pet.sizePercent >= 100 ? "" : " / " + pet.sizePercent + "%") + ")"
				})),
				h("button", {
					key: "add",
					type: "button",
					onClick: props.onAdd,
					disabled: props.busy,
					className: "dsh-pet-cfg__tab is-ghost",
					children: "+ " + t("add")
				})
			]
		});
	};
}

//#endregion
//#region src/client/settings/physics-card.ts
function makePhysicsCard(rt) {
	const { h, t } = rt;
	const { cardHead, field, toggleCell } = makeUiKit({
		h,
		t
	});
	return function PhysicsCard(props) {
		const { busy, physics } = props;
		/** 物理参数的一格：标签与问号在上、数字输入在下。 */
		const physField = (key, step, min) => field(t("physics." + key), h("input", numberInputProps(physics[key], (v) => props.onChange({ [key]: v }), {
			step,
			min,
			disabled: busy
		})), t("physics." + key + "Hint"));
		return h("div", {
			className: "dsh-pet-cfg__card",
			children: [
				cardHead(t("physicsTitle"), t("physicsHint")),
				h("div", {
					className: "dsh-pet-cfg__grid4",
					children: [
						physField("gravity", "50", "0"),
						physField("restitution", "0.01", "0"),
						physField("groundFriction", "0.1", "0"),
						physField("throwPower", "0.05", "0.05")
					]
				}),
				h("div", {
					className: "dsh-pet-cfg__grid2",
					children: [toggleCell("physicsCeilingBounce", physics.ceilingBounce, busy, (v) => props.onChange({ ceilingBounce: v })), toggleCell("physicsPetCollision", physics.petCollision, busy, (v) => props.onChange({ petCollision: v }))]
				})
			]
		});
	};
}

//#endregion
//#region src/shared/chat/hear-hold.ts
/** 目标键的小写形式：判定与状态机共用这一份，避免两处各写一个字面量。 */
const HEAR_KEY = "m";
const HEAR_HOTKEY_HINT = "M 鍵";
function isHearHotkey(e) {
	if (e.ctrlKey || e.metaKey || e.altKey) return false;
	return String(e.key).toLowerCase() === HEAR_KEY;
}
function createHearHold(hooks) {
	let holding = false;
	/** 只比键名：按住期间焦点已交给输入框，不能再套「不在可编辑元素里」那道判据。 */
	const sameKey = (key) => String(key).toLowerCase() === HEAR_KEY;
	const release = () => {
		if (!holding) return;
		holding = false;
		hooks.onRelease();
	};
	return {
		onKeyDown(e) {
			if (holding) return sameKey(e.key);
			if (e.repeat === true || !isHearHotkey(e) || !hooks.isArmed()) return false;
			holding = true;
			hooks.onPress();
			return true;
		},
		onKeyUp(e) {
			if (sameKey(e.key)) release();
		},
		release
	};
}

//#endregion
//#region src/shared/chat/hotkey.ts
const CHAT_HOTKEY_HINT = "L 鍵";
const CAPTURE_HOTKEY_HINT = "S 鍵";
function isChatHotkey(e) {
	return isBareKey(e, "l");
}
function isCaptureHotkey(e) {
	return isBareKey(e, "s");
}

//#endregion
//#region src/shared/sleep-hotkey.ts
const SLEEP_HOTKEY_HINT = "Z 鍵";
function isSleepHotkey(e) {
	return isBareKey(e, "z");
}

//#endregion
//#region src/shared/todo/hotkey.ts
const TODO_HOTKEY_HINT = "D 鍵";
function isTodoHotkey(e) {
	return isBareKey(e, "d");
}

//#endregion
//#region src/client/app-shortcut.ts
/** 修饰键的显示名：`primary` 按平台展开。 */
const MODIFIER_LABELS = {
	alt: "Alt",
	control: "Ctrl",
	meta: "Cmd",
	shift: "Shift"
};
function keycapOf(binding) {
	const isMac = /Mac/i.test(navigator.platform || navigator.userAgent);
	const modifiers = binding.modifiers.map((modifier) => modifier === "primary" ? isMac ? "Cmd" : "Ctrl" : MODIFIER_LABELS[modifier] ?? modifier);
	return [...modifiers, binding.code.replace(/^Key/, "")].join("+");
}
const SHORTCUT_PROFILES = [
	"desktop:macos",
	"desktop:windows",
	"desktop:linux",
	"web:macos",
	"web:windows"
];
function registerAppShortcut(ctx, shortcut) {
	const shortcuts = ctx.get?.("shortcuts");
	if (shortcuts === void 0 || typeof shortcuts.register !== "function") {
		console.warn("[dsh-pet] 快捷鍵服務不可用，「" + shortcut.id + "」未註册");
		return {
			registered: false,
			dispose: () => {}
		};
	}
	try {
		const defaults = Object.fromEntries(SHORTCUT_PROFILES.map((profile) => [profile, shortcut.binding]));
		const dispose = shortcuts.register({
			id: shortcut.id,
			label: shortcut.label,
			aliases: [],
			defaults,
			regions: ["page", "editable"],
			modals: [],
			resolve: () => ({
				status: "handled",
				run: shortcut.run
			})
		});
		return {
			registered: true,
			dispose: () => dispose()
		};
	} catch (error) {
		console.warn("[dsh-pet] 快捷鍵註册失敗：" + (error instanceof Error ? error.message : String(error)));
		return {
			registered: false,
			dispose: () => {}
		};
	}
}
function readShortcutKeycap(ctx, id) {
	const catalog = (ctx.get?.("shortcuts"))?.catalog;
	if (catalog === void 0) return void 0;
	const row = catalog.getSnapshot().find((item) => item.id === id);
	return row === void 0 || row.keys.length === 0 ? void 0 : row.keys.join("");
}
function subscribeShortcutKeycaps(ctx, listener) {
	const catalog = (ctx.get?.("shortcuts"))?.catalog;
	if (catalog === void 0) return () => {};
	return catalog.subscribe(listener);
}

//#endregion
//#region src/client/chat/shortcut.ts
const PET_CHAT_COMMAND_ID = "pet-chat.open";
/** 主修饰键 + Shift + P；Web 白名单允许「主键 + Shift/Alt + 字母」，所以两端同一个键。 */
const BINDING = {
	code: "KeyP",
	modifiers: ["primary", "shift"]
};
function petChatShortcutKeycap(ctx) {
	return readShortcutKeycap(ctx, PET_CHAT_COMMAND_ID) ?? keycapOf(BINDING);
}
function registerPetChatShortcut(ctx, label, open) {
	return registerAppShortcut(ctx, {
		id: PET_CHAT_COMMAND_ID,
		label,
		binding: BINDING,
		run: open
	});
}

//#endregion
//#region src/client/pet/card/registry.ts
/** 按宠物 id 登记；Map 的插入序就是渲染序，「第一只」的兜底直接靠它。 */
const handles = new Map();
function registerPetChatHandle(id, handle) {
	handles.set(id, handle);
	return () => {
		if (handles.get(id) === handle) handles.delete(id);
	};
}
function pickPetChatHandle() {
	const mainId = petBridge.template?.id;
	if (typeof mainId === "string") {
		const main = handles.get(mainId);
		if (main !== void 0) return main;
	}
	return handles.values().next().value;
}
function togglePetChatHear(handle) {
	if (handle === void 0) return;
	if (handle.isHearing()) handle.stopHear();
	else handle.startHear();
}
function togglePetChat(handle) {
	if (handle === void 0) return;
	if (handle.isOpen()) handle.close();
	else handle.open();
}

//#endregion
//#region src/client/pet/card/shortcut.ts
const PET_FLOAT_COMMAND_ID = "pet-chat.float";
const PET_HEAR_COMMAND_ID = "pet-chat.hear";
const PET_CAPTURE_COMMAND_ID = "pet-chat.capture";
/** 弹窗键位：主修饰键 + Shift + L。T 在浏览器里被「恢复标签页」占用，L 两端都空着。 */
const FLOAT_BINDING = {
	code: "KeyL",
	modifiers: ["primary", "shift"]
};
/** 录音键位：主修饰键 + Shift + M（M = mic）。V 在输入框里会被浏览器当成「粘贴为纯文本」，避开。 */
const HEAR_BINDING = {
	code: "KeyM",
	modifiers: ["primary", "shift"]
};
/** 截图键位：主修饰键 + Shift + S。Edge 与 Firefox 把它给了自己的截图，Chrome 空着。 */
const CAPTURE_BINDING = {
	code: "KeyS",
	modifiers: ["primary", "shift"]
};
/** 命令 id 与默认键位：注册与展示都从这里取，不写第二份。 */
const COMMANDS = {
	chat: {
		id: PET_FLOAT_COMMAND_ID,
		binding: FLOAT_BINDING
	},
	hear: {
		id: PET_HEAR_COMMAND_ID,
		binding: HEAR_BINDING
	},
	capture: {
		id: PET_CAPTURE_COMMAND_ID,
		binding: CAPTURE_BINDING
	}
};
function petShortcutKeycap(ctx, key) {
	const command = COMMANDS[key];
	return readShortcutKeycap(ctx, command.id) ?? keycapOf(command.binding);
}
function registerPetCardShortcuts(ctx, label) {
	const float = registerAppShortcut(ctx, {
		id: COMMANDS.chat.id,
		label: () => label("shortcut.chat"),
		binding: COMMANDS.chat.binding,
		run: () => togglePetChat(pickPetChatHandle())
	});
	const hear = registerAppShortcut(ctx, {
		id: COMMANDS.hear.id,
		label: () => label("shortcut.hear"),
		binding: COMMANDS.hear.binding,
		run: () => togglePetChatHear(pickPetChatHandle())
	});
	const capture = registerAppShortcut(ctx, {
		id: COMMANDS.capture.id,
		label: () => label("shortcut.capture"),
		binding: COMMANDS.capture.binding,
		run: () => pickPetChatHandle()?.screenshot()
	});
	return { dispose: () => {
		float.dispose();
		hear.dispose();
		capture.dispose();
	} };
}

//#endregion
//#region src/client/settings/shortcuts-card.ts
/** 折叠正文的 id：与标题按钮的 `aria-controls` 成对。 */
const BODY_ID = "pet-cfg-shortcuts";
/** 粘贴不是我们注册的命令，键帽按平台推导（macOS 是 ⌘V），不写死字符串。 */
const PASTE_KEYCAP = keycapOf({
	code: "KeyV",
	modifiers: ["primary"]
});
/** 现读一遍三条全局命令的键帽。 */
function readKeycaps(ctx) {
	return {
		open: petShortcutKeycap(ctx, "chat"),
		hear: petShortcutKeycap(ctx, "hear"),
		capture: petShortcutKeycap(ctx, "capture"),
		sidebar: petChatShortcutKeycap(ctx)
	};
}
function makeShortcutsCard(rt, ctx) {
	const { h, t, useState, useEffect } = rt;
	const { foldCard } = makeUiKit({
		h,
		t
	});
	return function ShortcutsCard() {
		const [open, setOpen] = useState(false);
		const [keycaps, setKeycaps] = useState(readKeycaps(ctx));
		useEffect(() => subscribeShortcutKeycaps(ctx, () => setKeycaps(readKeycaps(ctx))), []);
		/** 一行：左边動作名，右边键帽。 */
		const row = (label, keys) => h("div", {
			className: "dsh-pet-cfg__field",
			children: [h("span", {
				key: "l",
				className: "dsh-pet-cfg__flabel",
				children: t(label)
			}), h("span", {
				key: "v",
				className: "dsh-pet-cfg__note",
				children: keys
			})]
		});
		return foldCard({
			id: BODY_ID,
			title: t("shortcutCardTitle"),
			hint: t("shortcutCardHint"),
			body: [
				h("p", {
					key: "petTitle",
					className: "dsh-pet-cfg__cardTitle",
					children: t("shortcutGroupPet")
				}),
				h("p", {
					key: "petHint",
					className: "dsh-pet-cfg__note",
					children: t("shortcutGroupPetHint")
				}),
				h("div", {
					key: "petRows",
					className: "dsh-pet-cfg__grid2",
					children: [
						row("shortcutRowChat", CHAT_HOTKEY_HINT),
						row("shortcutRowHold", HEAR_HOTKEY_HINT),
						row("shortcutRowCapture", CAPTURE_HOTKEY_HINT),
						row("shortcutRowPaste", PASTE_KEYCAP),
						row("shortcutRowTodo", TODO_HOTKEY_HINT),
						row("shortcutRowSleep", SLEEP_HOTKEY_HINT),
						row("shortcutRowDisplay", DISPLAY_HOTKEY_HINTS.join(" · "))
					]
				}),
				h("p", {
					key: "globalTitle",
					className: "dsh-pet-cfg__cardTitle",
					children: t("shortcutGroupGlobal")
				}),
				h("p", {
					key: "globalHint",
					className: "dsh-pet-cfg__note",
					children: t("shortcutGroupGlobalHint")
				}),
				h("div", {
					key: "globalRows",
					className: "dsh-pet-cfg__grid2",
					children: [
						row("shortcutRowChat", keycaps.open),
						row("shortcutRowHear", keycaps.hear),
						row("shortcutRowCapture", keycaps.capture),
						row("shortcutRowSidebar", keycaps.sidebar)
					]
				})
			],
			open,
			onToggle: () => setOpen(!open)
		});
	};
}

//#endregion
//#region src/client/settings/tip-layer.ts
/** 气泡 class，外观在 ./css。 */
const TIP_CLASS$1 = "pet-cfg-tip";
/** 触发元素的属性名：选择器与取值都从它派生，改名只改一处。 */
const TIP_ATTR = "data-tip";
/** 光标与气泡的间隙（px）。 */
const TIP_GAP_PX$1 = 10;
/** 唯一的那个气泡；悬停很频繁，反复建删会让气泡闪。 */
let bubble;
/** 当前挂着气泡的触发元素，用于跳过「在同一元素内移动」的重复派发。 */
let current;
/** 这一层的解除函数；`undefined` 表示没装。 */
let detach;
/** 收起气泡：元素留着复用，只摘显隐。 */
function hideTip$1() {
	bubble?.classList.remove("is-on");
	current = void 0;
}
/** 取气泡元素，没有就建一个挂到 body——挂在设置页里会被滚动容器裁掉。 */
function ensureTip$1() {
	if (bubble !== void 0 && bubble.parentNode === document.body) return bubble;
	const el = document.createElement("div");
	el.setAttribute("class", TIP_CLASS$1);
	el.setAttribute("role", "tooltip");
	document.body.appendChild(el);
	bubble = el;
	return el;
}
/** 从事件目标往上找触发元素；不在说明元素上时返回 `undefined`。 */
function triggerOf(node) {
	const host = node;
	if (host === null || typeof host.closest !== "function") return void 0;
	return host.closest("[" + TIP_ATTR + "]") ?? void 0;
}
/**
* 在光标处显示说明。
*
* @param text - 气泡正文。
* @param cursor - 光标位置（视口坐标）。
*/
function showTip$1(text, cursor) {
	const el = ensureTip$1();
	el.textContent = text;
	el.style.left = "0px";
	el.style.top = "0px";
	const placed = tooltipPlacement(cursor, {
		w: el.offsetWidth,
		h: el.offsetHeight
	}, {
		x: 0,
		y: 0,
		w: window.innerWidth,
		h: window.innerHeight
	}, TIP_GAP_PX$1);
	el.style.left = placed.x + "px";
	el.style.top = placed.y + "px";
	el.classList.add("is-on");
}
/** 光标进入触发元素：换一条说明就重摆，同一元素内移动不动。 */
function onOver(event) {
	const trigger = triggerOf(event.target);
	if (trigger === void 0 || trigger === current) return;
	const text = trigger.getAttribute(TIP_ATTR);
	if (text === null || text === "") return;
	showTip$1(text, {
		x: event.clientX,
		y: event.clientY
	});
	current = trigger;
}
/** 光标离开：移进触发元素自己的子节点也会派发 pointerout，只有真离开才收。 */
function onOut(event) {
	const from = triggerOf(event.target);
	if (from === void 0) return;
	if (triggerOf(event.relatedTarget ?? null) === from) return;
	hideTip$1();
}
function attachTipLayer() {
	if (detach !== void 0) return detach;
	const root = document;
	root.addEventListener("pointerover", onOver);
	root.addEventListener("pointerout", onOut);
	root.addEventListener("pointerdown", hideTip$1);
	root.addEventListener("scroll", hideTip$1, true);
	detach = () => {
		root.removeEventListener("pointerover", onOver);
		root.removeEventListener("pointerout", onOut);
		root.removeEventListener("pointerdown", hideTip$1);
		root.removeEventListener("scroll", hideTip$1, true);
		bubble?.remove();
		bubble = void 0;
		current = void 0;
		detach = void 0;
	};
	return detach;
}

//#endregion
//#region src/client/settings/pet-draft.ts
function nextPetId(list, kind = "main") {
	const prefix = kind === "main" ? "pet" : kind;
	for (let n = 2;; n += 1) {
		const id = prefix + "-" + n;
		if (!list.some((pet) => pet.id === id)) return id;
	}
}
function draftPet(template, id) {
	return {
		id,
		name: id,
		size: template.size,
		sizePercent: template.sizePercent ?? SIZE_PERCENT_DEFAULT,
		balanceEnabled: template.balanceEnabled,
		whisperEnabled: template.whisperEnabled,
		workStatusEnabled: template.workStatusEnabled,
		fixedEnabled: template.fixedEnabled,
		display: template.display,
		position: { ...template.position }
	};
}

//#endregion
//#region src/client/settings/use-pet-list.ts
function petKinds(pets) {
	const order = [];
	const counts = new Map();
	for (const pet of pets) {
		const entry = pet.assetRoot ?? "main";
		if (!counts.has(entry)) order.push(entry);
		counts.set(entry, (counts.get(entry) ?? 0) + 1);
	}
	return order.map((entry) => ({
		entry,
		kind: entry === "main" ? "main" : "pack",
		count: counts.get(entry) ?? 0
	}));
}
function mainPetsOf(pets) {
	return pets.filter((pet) => (pet.assetRoot ?? "main") === "main");
}
function usePetList(rt, requestDialog) {
	const { useState, useCallback, useRef } = rt;
	const initial = petBridge.current;
	const [pets, setPets] = useState(initial.map((pet) => ({
		...pet,
		position: { ...pet.position }
	})));
	const [kind, setKind] = useState(initial[0]?.assetRoot ?? "main");
	const [selId, setSelId] = useState(initial[0]?.id ?? "");
	const loadedRef = useRef([]);
	const kindRef = useRef(kind);
	kindRef.current = kind;
	const update = (patch) => setPets((list) => list.map((pet) => {
		if (pet.id !== selId) return pet;
		const { position: posPatch,...rest } = patch;
		return {
			...pet,
			...rest,
			position: posPatch ? {
				...pet.position,
				...posPatch
			} : pet.position
		};
	}));
	const add = () => {
		const group = pets.filter((pet) => (pet.assetRoot ?? "main") === kind);
		const template = group[0];
		if (!template) return;
		const id = nextPetId(pets, kind);
		const draft = {
			...draftPet(template, id),
			assetRoot: kind
		};
		setPets((list) => {
			const next = [...list];
			let at = -1;
			for (let i = 0; i < next.length; i += 1) if ((next[i].assetRoot ?? "main") === kind) at = i;
			next.splice(at + 1, 0, draft);
			return next;
		});
		setSelId(id);
	};
	const remove = () => {
		const list = pets.filter((pet) => pet.id !== selId);
		setPets(list);
		setSelId(list[0]?.id ?? "");
	};
	const replace = useCallback((entries) => {
		loadedRef.current = entries;
		const loaded = entries.flatMap((entry) => entry.pets);
		const nextKind = entries.some((entry) => entry.key === kindRef.current) ? kindRef.current : entries[0]?.key ?? "main";
		setPets(loaded);
		setKind(nextKind);
		setSelId((id) => {
			if (loaded.some((pet) => pet.id === id)) return id;
			return loaded.find((pet) => (pet.assetRoot ?? "main") === nextKind)?.id ?? "";
		});
	}, []);
	const selectKind = (entry) => {
		setKind(entry);
		const first = pets.find((pet) => (pet.assetRoot ?? "main") === entry);
		if (first) setSelId(first.id);
	};
	const current$1 = pets.find((pet) => pet.id === selId);
	const entryPrompt = loadedRef.current.find((item) => item.key === kind)?.entryPrompt ?? "";
	const requestRemove = () => {
		if (!current$1) return;
		const entry = current$1.assetRoot ?? "main";
		const groupSize = pets.filter((pet) => (pet.assetRoot ?? "main") === entry).length;
		if (groupSize <= 1) requestDialog(entry === "main" ? { kind: "lastOne" } : {
			kind: "lastOfKind",
			entry
		});
		else requestDialog({ kind: "remove" });
	};
	return {
		pets,
		mainPets: mainPetsOf(pets),
		kinds: petKinds(pets),
		kind,
		visiblePets: pets.filter((pet) => (pet.assetRoot ?? "main") === kind),
		selId,
		entryPrompt,
		select: setSelId,
		selectKind,
		update,
		add,
		requestRemove,
		remove,
		replace,
		packWrites: () => diffPackWrites(loadedRef.current, pets)
	};
}

//#endregion
//#region src/client/settings/use-remote-data.ts
function useRemoteData(rt) {
	const { useState, useEffect } = rt;
	const [paths, setPaths] = useState(null);
	const [catalog, setCatalog] = useState(null);
	const [catalogFailed, setCatalogFailed] = useState(false);
	useEffect(() => {
		let alive = true;
		loadMeta().then((meta) => {
			if (alive) setPaths(meta);
		});
		return () => {
			alive = false;
		};
	}, []);
	useEffect(() => {
		let alive = true;
		loadModelCatalog().then((groups) => {
			if (!alive) return;
			if (groups === null) setCatalogFailed(true);
			else setCatalog(groups);
		});
		return () => {
			alive = false;
		};
	}, []);
	return {
		paths,
		catalog,
		catalogFailed
	};
}

//#endregion
//#region src/client/settings/voice-card.ts
function makeVoiceCard(rt, picker) {
	const { h, t } = rt;
	const { cardHead, field, toggleCell } = makeUiKit({
		h,
		t
	});
	return function VoiceCard(props) {
		return h("div", {
			className: "dsh-pet-cfg__card",
			children: [
				cardHead(t("voiceTitle"), t("voiceHint")),
				h("div", {
					className: "dsh-pet-cfg__grid3",
					children: [
						toggleCell("voiceEnabled", props.enabled, props.busy, props.onToggle),
						toggleCell("voiceWhisperEnabled", props.whisperEnabled, props.busy, props.onWhisperToggle),
						toggleCell("voiceTodoEnabled", props.todoEnabled, props.busy, props.onTodoToggle)
					]
				}),
				h("div", {
					className: "dsh-pet-cfg__grid2",
					children: [h(picker, {
						label: t("voiceNameLabel"),
						value: props.voiceName,
						options: props.voices,
						disabled: props.busy,
						onChange: props.onVoiceChange
					}), field(t("voiceVolumeLabel"), h("input", numberInputProps(props.volume, props.onVolumeChange, {
						step: "0.05",
						min: "0",
						max: "1",
						disabled: props.busy
					})), t("voiceVolumeHint"))]
				})
			]
		});
	};
}

//#endregion
//#region src/client/settings/locales/de.ts
const de = {
	nav: "Desktop-Pet-Konfiguration",
	intro: "Mehrere Pets verwalten: Jedes Pet hat eigene Größe und Position (gilt sofort nach dem Speichern).",
	petCardTitle: "Pet-Konfiguration",
	petCardHint: "Einstellungen pro Pet: Name / Größe / Anzeige / Position / Offsets / die vier Funktionsschalter. Nach dem Ändern unten auf „Speichern\" klicken – gilt sofort.",
	globalTitle: "Globale Schalter",
	globalHint: "Gilt für alle Pets (ein Pet-Pack kann dies in seiner Art-Datei überschreiben). Diese Schalter ändern nur den lokalen Zustand und werden beim „Speichern\" mit in die Benutzerkonfiguration geschrieben (kein sofortiges Schreiben); Systembenachrichtigungen werden nach dem Speichern sofort neu eingelesen, ohne Neuladen der Seite.",
	cornerHint: "An welcher Bildschirmecke das Pet klebt (im Desktop-Modus pro Monitor-Arbeitsbereich).",
	marginXHint: "Horizontaler Abstand zur gewählten Ecke (px), beliebige Zahl.",
	marginYHint: "Vertikaler Abstand zur gewählten Ecke (px), beliebige Zahl.",
	"cmd.chat": "Chat",
	"cmd.pet": "Pet",
	"cmd.balance": "Guthaben",
	"shortcut.open": "Pet-Chat öffnen",
	"shortcut.chat": "Chatfenster öffnen",
	"shortcut.hear": "Spracheingabe",
	"shortcut.capture": "Bildschirmfoto in den Chat",
	shortcutCardTitle: "Tastenkürzel",
	shortcutCardHint: "Aufgeklappt zwei Gruppen: Pet-Tastenkürzel und globale Tastenkürzel.",
	shortcutRowChat: "Chat öffnen",
	shortcutRowHold: "Zum Sprechen halten",
	shortcutRowHear: "Spracheingabe",
	shortcutRowCapture: "Bildschirmfoto",
	shortcutRowPaste: "Bild einfügen",
	shortcutRowTodo: "Aufgaben",
	shortcutRowSleep: "Schlafen / Aufwachen",
	shortcutRowDisplay: "Anzeigeposition",
	shortcutRowSidebar: "Seitenleisten-Chat öffnen",
	shortcutGroupPet: "Pet-Tastenkürzel",
	shortcutGroupPetHint: "Im Web genügt der Zeiger auf dem Pet. Im Desktop-Fenster zuerst auf das Pet klicken, damit es den Tastaturfokus bekommt.",
	shortcutGroupGlobal: "Globale Tastenkürzel",
	shortcutGroupGlobalHint: "Werden von DSH im Web und im Desktop-Fenster verteilt; änderbar unter Einstellungen → Allgemein → Tastenkürzel.",
	petsLabel: "Pet-Liste",
	add: "Pet hinzufügen",
	remove: "Entfernen",
	confirmRemove: "Pet „{id}\" wirklich löschen?",
	confirmTitle: "Aktion bestätigen",
	cancel: "Abbrechen",
	ok: "Verstanden",
	atLeastOne: "Mindestens ein Pet muss erhalten bleiben.",
	emptyPets: "Noch keine Pets – auf „Pet hinzufügen\" klicken, um eines zu erstellen.",
	sizeLabel: "Größe (Breite px)",
	sizeHint: "Höhe automatisch = Breite × 9/16.",
	sizePercentLabel: "Max. Bildschirmbreite (%)",
	sizePercentHint: "Wie viel der Bildschirmbreite der Pet höchstens einnimmt: 100 = nie breiter als ein Bildschirm (bei breiten Fenstern identisch mit px); 30–40 macht ihn auf dem Handy deutlich kleiner, ohne den Desktop zu verändern. Wird beim Laden einmal berechnet; nach Größenänderung neu laden.",
	nameLabel: "Name",
	nameHint: "Anzeigename: erscheint beim Hovern über dem Pet und fließt in die KI-Persona ein („Dein Name ist X\"). Doppelt erlaubt; leer = es gilt die Pet-ID.",
	personaLabel: "Persona (optional)",
	personaHint: "Gilt nur für dieses Pet. Leer lassen = Persona des Eintrags übernehmen – der graue Text im Feld ist genau diese. Das tatsächlich an das Modell gesendete System = dieser Text + automatisch angehängtem Hinweis „Dein Name ist <Name>\" + aktuellem Zeitkontext; Name und Datum hier also nicht wiederholen.",
	personaCount: "{n} Zeichen",
	balanceEnabled: "Guthaben-Funktion",
	balanceEnabledHint: "Wenn aktiv, spielt dieses Pet Guthaben-Animationen und zeigt die Guthaben-Blase.",
	whisperEnabled: "Flüstern",
	whisperEnabledHint: "Wenn aktiv, erzeugt dieses Pet regelmäßig per KI einen Satz und spielt die Flüstern-Animation (Persona siehe Feld „Persona\" unten; leer = Eintrag übernehmen).",
	workStatusEnabled: "Arbeitsstatus-Kopplung",
	workStatusEnabledHint: "Wenn aktiv, folgt dieses Pet dem DSH-Arbeitsstatus: Denken / Arbeiten / Warten auf Bestätigung / Fertig / Fehler wechseln automatisch die passende Animation und zeigen eine Blase (Animationspool in der Top-Level-Konfiguration; nur Zuhören, keine Modellaufrufe).",
	fixedEnabled: "Pet fixieren",
	fixedEnabledHint: "Wenn aktiv, dreht sich das Pet bei Zufallsanimationen nicht mehr selbst um und läuft nicht weg – es spielt nur Leerlauf und kleine Aktionen am Platz. Rechtsklick-Auswahl, API-Auslöser sowie Guthaben-/Flüstern-/Arbeitsstatus-Animationen sind nicht betroffen.",
	displayLabel: "Anzeige",
	displayHint: "web = nur Browser / desktop = nur Desktop / both = beides / none = nichts",
	"display.web": "Nur Browser",
	"display.desktop": "Nur Desktop",
	"display.both": "Beides",
	"display.none": "Nichts",
	cornerLabel: "Position",
	"corner.top-left": "Oben links",
	"corner.top-right": "Oben rechts",
	"corner.bottom-left": "Unten links",
	"corner.bottom-right": "Unten rechts",
	marginX: "Horizontaler Versatz",
	marginY: "Vertikaler Versatz",
	save: "Speichern",
	saveHotkey: "Ctrl+S / Cmd+S",
	sync: "Synchronisieren",
	confirmSync: "Wirklich synchronisieren? Die mitgelieferte Standardkonfiguration (alle Felder + Kommentare) überschreibt die Benutzerkonfiguration; Ihre aktuellen Anpassungen gehen verloren.",
	corruptTitle: "Benutzerkonfiguration beschädigt – nicht gespeichert",
	corruptConfirm: "Trotzdem speichern",
	corruptBody: "Die Benutzerkonfigurationsdatei ist nicht lesbar (beschädigt, kein gültiges JSON/JSONC): {path}. Beim Weiterspeichern wird die Datei anhand der Whitelist neu aufgebaut – alle aktuellen Inhalte (animations / physics / memes und weitere eigene Felder) gehen verloren. Abbrechen = Datei unverändert lassen (zuerst die Konfiguration reparieren, dann speichern); Bestätigen = trotzdem speichern (vorhandene Inhalte verwerfen).",
	syncHint: "„Synchronisieren\" schreibt die mitgelieferte Standardkonfiguration (inkl. Kommentare und aller erweiterten Felder) in die Benutzerkonfigurationsdatei und überschreibt die aktuellen Anpassungen; danach ist die Datei direkt bearbeitbar. Zwei Hinweise: (1) Sobald die Datei existiert, ist sie eine explizite Override-Schicht – spätere Änderungen an den mitgelieferten Standards greifen nicht automatisch (außer bei erneuter Synchronisierung oder Löschen der Datei); (2) „Speichern\" auf dieser Seite schreibt die Datei anhand der Whitelist neu (Feldwerte bleiben, Kommentare entfallen).",
	configMeta: "Erweitert (Dateien)",
	configMetaHint: "Die Benutzerkonfiguration kann Pet-Liste / Animationspools / Wiedergabegewichtung überschreiben; Änderungen greifen nach Aktualisieren oder Neustart: im Browser die Seite neu laden, im Desktop-Modus Rechtsklick auf das Pet → „Konfiguration neu laden\" (lädt alle Desktop-Pet-Fenster neu); die Standardkonfiguration ist die vollständige Referenz.",
	defaultConfig: "Standardkonfiguration (schreibgeschützt, vollständige Referenz)",
	userConfig: "Benutzerkonfiguration (eigene Überschreibungen)",
	todosFile: "To-do-Daten (Listentext, Fälligkeit und Erledigt-Status; Löschen entspricht alle To-dos leeren)",
	animationDir: "Verzeichnis der Animations-Assets (Animationen anpassen/ergänzen)",
	memesDir: "Verzeichnis der Meme-Bilder (Bilder anpassen/ergänzen)",
	logFile: "Protokolldatei (für die Fehlersuche; kann geleert werden)",
	logFileNote: "Die Desktop-Version hat keine Konsole, daher gehen alle Laufzeitprotokolle des Plugins (Start, Absturz/Neustart des Desktop-Pets, Fehler und Warnungen) in diese eine Datei; bitte bei Problemmeldungen anhängen. Maximal 1 MB pro Datei, danach bleiben nur die letzten 512 KB erhalten.",
	saved: "Gespeichert – die Pets gelten sofort.",
	loadError: "Konfiguration konnte nicht geladen werden",
	saveError: "Konfiguration konnte nicht gespeichert werden. Bitte Serververbindung, Schreibrechte im Konfigurationsverzeichnis und Serverprotokoll prüfen.",
	saveInvalid: "Konfiguration konnte nicht gespeichert werden: Inhalt ungültig. Bitte prüfen und erneut versuchen.",
	syncError: "Synchronisieren fehlgeschlagen. Bitte Serververbindung und Schreibrechte im Konfigurationsverzeichnis prüfen.",
	loading: "Konfiguration wird geladen…",
	retry: "Erneut versuchen",
	invalid: "Bitte Eingaben prüfen: Größe muss positiv sein, Ränder dürfen beliebige Zahlen sein.",
	busy: "Wird gespeichert…",
	extraPetsHint: "Weitere {n} Art(en) stammen aus Dateien im Verzeichnis pet/ (<Name>-config.json + <Name>-animation/); oben in der Zeile „Arten\" umschalten und bearbeiten. Speichern schreibt jeweils in die eigene Paketkonfiguration, nie in main-config.jsonc.",
	kindLabel: "Arten",
	kindMain: "Integriert",
	lastOfKind: "„{entry}\" hat nur noch dieses eine Pet – beim Löschen verschwindet die ganze Art. Zum vollständigen Entfernen die Pet-Pack-Dateien löschen.",
	savePartial: "Haupt-Pets gespeichert, aber {names} konnten nicht zurückgeschrieben werden: Prüfen Sie, ob die Pack-Konfiguration gültig und das Verzeichnis beschreibbar ist.",
	notifyToggle: "Systembenachrichtigungen",
	notifyToggleHint: "System-Toasts (unten rechts auf dem Desktop) bei Abschluss einer Konversation, Fehlern, Berechtigungsanfragen und Rückfragen – nur wenn das Fenster nicht fokussiert ist.",
	clickSoundToggle: "Klick-Sound",
	clickSoundToggleHint: "Beim Klick auf ein Pet ertönt der integrierte Klick-Sound (assets/sound/click-duck.wav, Lautstärke 0.5); Klicks innerhalb von 100 ms werden nur einmal abgespielt, auch bei mehreren Pets überlagert sich nichts. Aus = völlig stumm. Wird beim „Speichern\" in die Benutzerkonfiguration geschrieben.",
	whisperImageToggle: "Flüstern-Bilder",
	whisperImageToggleHint: "Hängt an jede Flüstern-Zeile ein zufälliges Meme aus dem Pool (Bildzuordnung im Top-Level-Feld `memes` der Konfiguration). Token: Flüstern ruft ohnehin pro Zyklus das Modell auf, das Bild fügt nur Name + Beschreibung des gezogenen Memes (ca. 100 Zeichen / ≈60 Token) an dieselbe Anfrage an – vernachlässigbar.",
	chatImageToggle: "Chat-Bilder",
	chatImageToggleHint: "Die KI wählt im Chat passend zum Kontext ein Meme aus dem Pool (optional; Zuordnung im Top-Level-Feld `memes`). Token: Jede Nachricht führt den gesamten Katalog mit – aktuell ca. 1,1k Zeichen (≈650 Token, etwa 11-mal so viel wie beim Flüstern) und linear mit der Bildanzahl wachsend; aus = es wird kein Zeichen angehängt.",
	chatAnimationToggle: "Chat-Aktionen",
	chatAnimationToggleHint: "Wenn an, enthält die Chat-Anfrage die Liste der spielbaren Animationen (alle Aktionen unter animations.categories): Hält das Modell die Zeile für eine tatsächliche Aufführung, spielt das Pet sie sofort; sonst antwortet es nur mit Text. Token: Jede Nachricht führt die ganze Liste mit; aus = es wird nichts angehängt. Globaler Standard für alle Pets (ein Pet-Pack kann ihn in seiner eigenen Konfigurationsdatei überschreiben).",
	confineToggle: "Auf aktuellen Bildschirm begrenzen",
	confineToggleHint: "Mehrere Monitore: Wenn an, bleibt das Pet auf dem Bildschirm, auf dem es sich gerade befindet – ein geworfenes Pet prallt nur innerhalb des Bildschirms ab, auf dem es losgelassen wurde (Bildschirmfugen wirken als Wände, es fliegt nicht zum Nachbarmonitor), und autonomes Umherlaufen bleibt auf dem aktuellen Bildschirm (ein Schritt über die Fuge wird einfach verworfen). Aus = Überqueren der Bildschirme wie gewohnt. Nur Desktop-Modus – das Browser-Overlay bleibt ohnehin im Viewport.",
	trayToggle: "System-Tray",
	trayToggleHint: "Zeigt im Desktop-Modus ein Tray-Symbol (Windows: Infobereich, macOS: Menüleiste). Es listet alle Pets der Konfiguration und schaltet die Anzeige um – auch für Pets, die gerade nicht auf dem Desktop sind und kein Fenster zum Rechtsklicken haben. Ohne Tray lässt sich ein Pet nur über den Browser (Einstellungsseite oder Rechtsklick auf das Web-Pet) zurück auf den Desktop holen. Windows blendet das Symbol ohnehin in die „ausgeblendeten Symbole\" aus. Nur Desktop-Modus.",
	voiceTitle: "Sprachausgabe",
	voiceHint: "Drei Schalter und eine Stimme: Der Hauptschalter steuert die automatische Ausgabe, die beiden Unterschalter je eine Art proaktiver Meldung. Standardmäßig alle aus; wird beim „Speichern\" in die Benutzerkonfiguration geschrieben (kein sofortiges Schreiben).",
	voiceEnabled: "Sprachausgabe aktivieren",
	voiceEnabledHint: "Hauptschalter für die automatische Sprachausgabe. Aus = regelmäßige Flüstern-Sätze und To-do-Erinnerungen werden nicht gesprochen (die beiden Unterschalter unten wirken dann nicht). Manuelles Flüstern, Chat-Antworten und die Lautsprecher-Schaltfläche im Chat-Panel sind nicht betroffen – die haben Sie selbst ausgelöst, die sprechen direkt. Es betrifft nur das Sprechen: Blasen, Chat-Gedächtnis und Systembenachrichtigungen bleiben unberührt; eine fehlgeschlagene Synthese wird nur protokolliert und unterbricht den Chat nicht.",
	voiceWhisperEnabled: "Flüstern sprechen",
	voiceWhisperEnabledHint: "Spricht den regelmäßig erzeugten Flüstern-Satz (manuelles Flüstern per Rechtsklick bleibt unberührt). Unterliegt dem Hauptschalter oben: Ist er aus, wirkt dieser Schalter nicht. Standardmäßig aus – Flüstern ist Hintergrundbegleitung und sollte nicht ungefragt Geräusche machen.",
	voiceTodoEnabled: "To-do-Erinnerungen sprechen",
	voiceTodoEnabledHint: "Spricht eine fällige To-do-Erinnerung (die Blase erscheint weiterhin; dieser Schalter entscheidet nur, ob gesprochen wird). Unterliegt dem Hauptschalter oben. Standardmäßig aus.",
	voiceNameLabel: "Stimme",
	voiceVolumeLabel: "Lautstärke",
	voiceVolumeHint: "Wiedergabelautstärke als Dezimalzahl 0–1: 1 ist die maximale Lautstärke (100 %), 0 ist stumm. Ändert nur die Lautheit und synthetisiert kein Audio neu, kostet also nichts extra. Unabhängig vom Hauptschalter oben — bei ausgeschaltetem Schalter ohne Wirkung.",
	physicsTitle: "Physik (Zieh- und Wurfgefühl)",
	physicsHint: "Globaler Standard für alle Pets (ein Pet-Pack kann ihn in seiner Art-Datei überschreiben); wird beim „Speichern\" in die Benutzerkonfiguration geschrieben (kein sofortiges Schreiben). Im Browser sofort wirksam, im Desktop-Modus, sobald das Speichern die Pet-Fenster neu lädt.",
	mobileTitle: "Mobil-Effekte",
	mobileHint: "Nur im Handy-Browser sinnvoll: Vibration braucht einen Motor, die beiden Bewegungs-Schalter brauchen Neigungs-/Beschleunigungssensoren, und Sensoren gibt es nur über HTTPS oder localhost.",
	"physics.gravity": "Schwerkraft",
	"physics.gravityHint": "px/s², größer = fällt schneller; 0 = schwerelos (fliegt geradeaus weiter)",
	"physics.restitution": "Elastizität",
	"physics.restitutionHint": "0–1, Geschwindigkeitsanteil beim Abprallen von Wand/Boden (1 = voll elastisch, 0 = bleibt sofort stehen)",
	"physics.groundFriction": "Kontaktreibung",
	"physics.groundFrictionHint": "/s, Abklingen der Geschwindigkeit entlang jeder Kontaktfläche (Wand, Boden, Decke); 0 = überall eisglatt",
	"physics.throwPower": "Wurfkraft",
	"physics.throwPowerHint": "> 0, Gesamtfaktor für Federfolge und Abwurfgeschwindigkeit (1 = Standard; höher = folgt enger, wirft härter)",
	physicsCeilingBounce: "Deckenabprall",
	physicsCeilingBounceHint: "Aus: Würfe können oben aus dem Bildschirm fliegen (die Schwerkraft holt sie zurück)",
	physicsPetCollision: "Pet-Kollisionen",
	physicsPetCollisionHint: "Ein fliegendes Pet prallt mit Impulserhaltung von anderen ab (Masse ∝ Größe²)",
	physicsHaptic: "Kollisions-Vibration",
	physicsHapticHint: "Ein Impuls pro Treffer (Wand, Boden, Decke, andere Pets). Funktioniert in Chrome/Edge; nicht auf iOS oder in WebView-Hüllen wie Via. „Nicht stören“ blockiert die Vibration.",
	physicsTilt: "Schwerkraft per Neigung",
	physicsTiltHint: "Handy neigen: die Schwerkraft folgt der Neigung (Betrag = der Wert oben). Bei Schwerkraft 0 bewirkt Neigen nichts. Benötigt HTTPS/localhost.",
	physicsShake: "Schütteln zum Werfen",
	physicsShakeHint: "Schütteln schleudert den Pet in Wurfrichtung; die Stärke folgt throwPower. Unabhängig von der Schwerkraft, funktioniert also auch bei 0. Benötigt HTTPS/localhost.",
	invalidPhysics: "Bitte Physikwerte prüfen: Schwerkraft / Bodenreibung ≥ 0, Elastizität 0–1, Wurfkraft > 0.",
	fontTitle: "Aussehen & Schrift",
	fontHint: "Die Schriftart gilt für alle Texte, die derzeit die Candy-Schrift nutzen: Pet-Blase, Hover-Tooltip, Chat-Fenster, Score-Popup; die Schriftgröße gilt nur für Pet-Blase und Hover-Tooltip (Chat- und Score-Popup behalten ihre Größe). Globaler Standard für alle Pets (ein Pet-Pack kann ihn in seiner Art-Datei überschreiben); wird beim „Speichern\" in die Benutzerkonfiguration geschrieben – im Browser sofort wirksam, im Desktop-Modus, sobald das Speichern die Pet-Fenster neu lädt.",
	fontFamilyLabel: "Schriftart",
	fontFamilyHint: "„Candy (integriert)\" wird mit dem Plugin geliefert; die übrigen sind Systemschriften. Fehlt eine Schrift auf diesem Rechner, greift die nächste im Stapel (nie leer, kein Fehler).",
	fontSizeLabel: "Schriftgröße (px)",
	fontSizeHint: "Schriftgröße des Blasentexts; Tooltip und kleinere Zeilen in der Blase skalieren anteilig. Bereich 4–200.",
	fontFollowToggle: "Schriftgröße mit Pet-Größe skalieren",
	fontFollowToggleHint: "An (Standard): die Schrift wächst mit dem Pet – bei 462 px Breite entspricht sie genau der obigen Größe. Aus: die Größe bleibt unabhängig von der Pet-Größe konstant.",
	invalidFont: "Bitte Schrifteinstellungen prüfen: Die Schriftart muss in der Liste stehen, die Größe eine Zahl zwischen 4 und 200 sein.",
	"font.candy": "Candy (integriert)",
	"font.yahei": "Microsoft YaHei / PingFang",
	"font.youyuan": "YouYuan",
	"font.kaiti": "KaiTi",
	"font.simsun": "SimSun",
	"font.comic": "Comic Sans MS",
	"font.system": "Systemstandard",
	modelTitle: "Chat & Modelle",
	modelHint: "Welches Modell Flüstern und Chat jeweils nutzen und wie viel Verlauf jeder Chat-Aufruf mitführt. „Aktueller Konversation folgen\" = das Modell, das Ihre aktuelle Konversation verwendet (Standard). Globaler Standard: gilt für alle Pets, ein Pet-Pack kann ihn in seiner Art-Datei überschreiben. Die Optionen stammen aus derselben Quelle wie die Modellauswahl von DSH und werden vom Host live geliefert.",
	modelFollow: "Aktueller Konversation folgen",
	modelSearch: "Modelle suchen…",
	modelEmpty: "Keine passenden Modelle.",
	modelNoModels: "Keine Modelle verfügbar.",
	modelLoading: "Modellliste wird aktualisiert…",
	modelTriggerAria: "Modell wählen, aktuell {model}",
	modelUnknown: " (aktuelle Konfiguration, nicht in der Liste)",
	modelNone: "Für diesen Anbieter sind keine Modelle verfügbar",
	whisperModelLabel: "Flüstern-Modell",
	chatModelLabel: "Chat-Modell",
	modelFieldHint: "„Aktueller Konversation folgen\" = Modell der aktuellen Konversation; schlägt ein gewähltes Modell fehl, fällt das Plugin auf das Modell der aktuellen Konversation zurück und versucht es einmal erneut.",
	invalidModel: "Bitte Modelleinstellungen prüfen: Anbieter und Modell entweder beide wählen oder beide leer lassen (aktuelle Konversation folgen).",
	modelCatalogFailed: "Modellliste konnte nicht geladen werden (Seite neu laden für einen neuen Versuch); die aktuellen Konfigurationswerte bleiben unverändert erhalten.",
	chatMemory: "Chat-Verlaufsrunden",
	chatMemoryHint: "Wie viele der letzten Runden jeder Chat-Aufruf mitführt (1 Runde = 1 Frage + 1 Antwort; 0 = kein Verlauf, jede Nachricht ist neu). Das Gedächtnis selbst behält alles – dieser Wert bestimmt nur, wie viel in den Kontext kommt: mehr merkt mehr und kostet mehr Token. Globaler Standard für alle Pets (ein Pet-Pack kann ihn in seiner Art-Datei überschreiben).",
	invalidChatMemory: "Bitte Chat-Verlaufsrunden prüfen: Zahl ≥ 0 erforderlich.",
	chatImageLimit: "Max. Chat-Bilder",
	chatImageLimitHint: "Wie viele Memes beim Chat höchstens an das Modell gelistet werden („erste N\" = die ersten N in der Konfiguration; was bevorzugt gesendet werden soll, nach vorne verschieben). Die ganze Liste wird an jede Nachricht angehängt, Token wachsen linear mit der Anzahl – eine lange Liste kostet nur. Mit der Grenze auf die ersten N wählt das Modell nur daraus. 0 = keine Grenze (alles senden). Integrierter Standard 10. Globaler Standard für alle Pets (ein Pet-Pack kann ihn in seiner Art-Datei überschreiben). Nur Chat-Auswahl: Flüstern führt nur das gezogene Meme mit.",
	invalidChatImageLimit: "Bitte das Limit für Chat-Bilder prüfen: Zahl ≥ 0 erforderlich (0 = keine Grenze).",
	notifyTest: "Testbenachrichtigung",
	notifyTestOk: "Testbenachrichtigung gesendet – bitte unten rechts auf dem Desktop prüfen.",
	notifyDenyUnsupported: "Systembenachrichtigungen werden in dieser Umgebung nicht unterstützt (keine Notification-API).",
	notifyDenyBlocked: "Die Benachrichtigungsberechtigung ist im Browser blockiert.",
	notifyDenyRejected: "Sie haben im Berechtigungsdialog „Blockieren\" gewählt.",
	notifyDenyError: "Fehler beim Anfordern der Berechtigung",
	notifyGuide: "Anleitung: links neben der Adressleiste auf 🔒/ⓘ klicken → „Website-Einstellungen\" → „Benachrichtigungen\" → auf „Zulassen\" setzen, Seite neu laden und erneut versuchen.",
	storageTitle: "Deinstallation & Speicher",
	storageHint: "Alle Orte, an denen das Plugin auf diesem Rechner Daten ablegt. Cache löschen ist unschädlich (wird automatisch neu geladen/neu aufgebaut); „Plugin-Benutzerdaten\" löschen kostet Konfiguration und Chat-Gedächtnis.",
	"storage.userData": "Plugin-Benutzerdaten: eigene Konfiguration main-config.jsonc, Chat-Gedächtnis memory.json, eigene Animations-Assets main-animation/, Datei-Pets pet/",
	"storage.electron": "Electron-Laufzeit für das Desktop-Pet (groß; wird beim nächsten Start des Desktop-Modus automatisch neu heruntergeladen)",
	"storage.desktopCache": "Cache der Desktop-Pet-Fenster und Skalierungs-Cache des Hauptbildschirms (löschbar, wird automatisch neu aufgebaut)",
	"storage.electronCache": "Download-Cache des Electron-Installers (löschbar, wird bei Bedarf neu geladen)",
	"storage.package": "Das Plugin selbst (von DSH verwaltet – mit dem Befehl unten entfernen, nicht von Hand löschen)",
	storageMissing: " (noch nicht erstellt)",
	uninstallTitle: "So deinstallieren Sie",
	uninstallStep1: "1. Zuerst DSH beenden (das Desktop-Pet beendet sich mit); die obigen Dateien nicht löschen, während das Pet läuft.",
	uninstallStep2: "2. Das Plugin selbst entfernen (im Terminal ausführen; entfernt es auch aus der Bundle-Schicht des Profils):",
	uninstallStep3: "3. Die obigen Orte nach Bedarf löschen: Caches sind unschädlich; „Plugin-Benutzerdaten\" löschen kostet Konfiguration und Chat-Gedächtnis (vorher main-config.jsonc sichern, wenn Sie es behalten wollen).",
	uninstallCmd: "dsh plugin --profile {profile} remove dsh-pet"
};

//#endregion
//#region src/client/settings/locales/en.ts
const en = {
	nav: "Pet Config",
	intro: "Manage multiple pets: each pet has its own size and position (applies instantly after saving).",
	petCardTitle: "Pet",
	petCardHint: "Per-pet settings: name / size / display / corner / offsets / the four feature switches. Click \"Save\" at the bottom to apply instantly.",
	globalTitle: "Global switches",
	globalHint: "Shared by every pet (a pet pack may override them in its own kind file). These switches only change local state and are written to the user config on \"Save\" (never written immediately); system notifications re-read right after saving, no page refresh needed.",
	cornerHint: "Which screen corner the pet sticks to (per-monitor work area in desktop mode).",
	marginXHint: "Horizontal distance from the chosen corner (px); any number.",
	marginYHint: "Vertical distance from the chosen corner (px); any number.",
	"cmd.chat": "Chat",
	"cmd.pet": "Pet",
	"cmd.balance": "Balance",
	"shortcut.open": "Open pet chat",
	"shortcut.chat": "Open chat bubble",
	"shortcut.hear": "Voice input",
	"shortcut.capture": "Screenshot to chat",
	shortcutCardTitle: "Shortcuts",
	shortcutCardHint: "Two groups once expanded: pet shortcuts and global shortcuts.",
	shortcutRowChat: "Open chat",
	shortcutRowHold: "Hold to talk",
	shortcutRowHear: "Voice input",
	shortcutRowCapture: "Screenshot",
	shortcutRowPaste: "Paste image",
	shortcutRowTodo: "Todo list",
	shortcutRowSleep: "Sleep / wake",
	shortcutRowDisplay: "Display position",
	shortcutRowSidebar: "Open sidebar chat",
	shortcutGroupPet: "Pet shortcuts",
	shortcutGroupPetHint: "On the web, hovering the pet is enough. In the desktop pet window, click the pet first so it takes keyboard focus.",
	shortcutGroupGlobal: "Global shortcuts",
	shortcutGroupGlobalHint: "Dispatched by DSH in the web app and the desktop window; rebind them in Settings → General → Shortcuts.",
	petsLabel: "Pets",
	add: "Add pet",
	remove: "Remove",
	confirmRemove: "Delete pet \"{id}\"?",
	confirmTitle: "Confirm action",
	cancel: "Cancel",
	ok: "Got it",
	atLeastOne: "Keep at least one pet.",
	emptyPets: "No pets yet — click \"Add pet\" to create one.",
	sizeLabel: "Size (width px)",
	sizeHint: "Height is automatic = width × 9/16.",
	sizePercentLabel: "Max screen width (%)",
	sizePercentHint: "How much of the screen width the pet may take: 100 = never wider than one screen (identical to px on wide windows); try 30–40 to make it clearly smaller on a phone without changing the desktop. Computed once on page load; refresh after resizing.",
	nameLabel: "Name",
	nameHint: "Shown on hover and added to AI personas (\"your name is X\"). Duplicates allowed; empty falls back to the pet id.",
	personaLabel: "Persona (optional)",
	personaHint: "Applies to this pet only. Leave empty to follow the entry persona — the grey text inside the box is exactly that. The system prompt actually sent = this text + an appended 「your name is \"<name>\"」 line + the current time context, so do not repeat the name or the date here.",
	personaCount: "{n} chars",
	balanceEnabled: "Balance",
	balanceEnabledHint: "When enabled, this pet plays balance animations and shows the balance bubble.",
	whisperEnabled: "Whisper",
	whisperEnabledHint: "When enabled, this pet periodically generates a line via AI and plays the whisper animation (persona = the field below; empty follows the entry).",
	workStatusEnabled: "Work status",
	workStatusEnabledHint: "When enabled, this pet follows DSH work state: thinking / working / waiting / done / error switch animations and show bubbles (pool in top-level config; listening only, no model calls).",
	fixedEnabled: "Pin in place",
	fixedEnabledHint: "When enabled, the random chain no longer turns this pet or walks it away — only idle and in-place actions play. Right-click picks, API triggers and balance / whisper / work-status animations are unaffected.",
	displayLabel: "Display",
	displayHint: "web = browser only / desktop = desktop only / both = both / none = neither",
	"display.web": "Browser only",
	"display.desktop": "Desktop only",
	"display.both": "Both",
	"display.none": "Neither",
	cornerLabel: "Position",
	"corner.top-left": "Top-left",
	"corner.top-right": "Top-right",
	"corner.bottom-left": "Bottom-left",
	"corner.bottom-right": "Bottom-right",
	marginX: "Horizontal offset",
	marginY: "Vertical offset",
	save: "Save",
	saveHotkey: "Ctrl+S / Cmd+S",
	sync: "Sync",
	confirmSync: "Sync? This overwrites the user config with the bundled default config (all fields + comments); current customizations are lost.",
	corruptTitle: "User config is corrupted — not saved",
	corruptConfirm: "Save anyway",
	corruptBody: "The user config file cannot be parsed (corrupted, not valid JSON/JSONC): {path}. Saving now rebuilds it from the whitelist — everything currently in that file (animations / physics / memes …) will be lost. Cancel = leave the file untouched (fix it and save again); Confirm = save anyway (discard what is in the file).",
	syncHint: "\"Sync\" writes the bundled default config (comments + every advanced field included) to the user config file, overwriting your current customizations; the file is then directly editable. Two caveats: (1) once created, that file is an explicit override layer — later changes to the bundled defaults will not take effect automatically (until you sync again or delete the file); (2) clicking \"Save\" on this page rewrites the file from a whitelist — field values are kept, comments are dropped.",
	configMeta: "Advanced (files)",
	configMetaHint: "User config may override pets / animation pools / weights — refresh or restart to apply: refresh the page in the browser, or right-click a desktop pet → \"Reload config\" (rebuilds every desktop pet window). The default config is the complete reference.",
	defaultConfig: "Default config (read-only, complete reference)",
	userConfig: "User config (custom overrides)",
	todosFile: "Todo data (text, due time and done state; deleting it clears every todo)",
	animationDir: "Animation assets dir (add/customize animations here)",
	memesDir: "Meme images dir (add/customize images here)",
	logFile: "Log file (for troubleshooting; safe to clear)",
	logFileNote: "The DSH desktop app has no console, so every runtime log of the plugin (startup, desktop pet crashes/restarts, errors and warnings) goes into this single file — attach it when reporting a problem. It is capped at 1 MB; once full, only the latest 512 KB is kept.",
	saved: "Saved — the pets updated instantly.",
	loadError: "Failed to load config",
	saveError: "Failed to save config. Check the server connection, configuration directory write permissions and server log.",
	saveInvalid: "Failed to save config: invalid configuration. Check the values and try again.",
	syncError: "Failed to sync config. Check the server connection and configuration directory write permissions.",
	loading: "Loading config…",
	retry: "Retry",
	invalid: "Check your input: size must be positive; margins can be any number.",
	busy: "Saving…",
	extraPetsHint: "{n} more kind(s) come from files in the pet/ directory (<name>-config.json + <name>-animation/). Switch to them in the Kinds row above; Save writes back to each pack's own config, never into main-config.jsonc.",
	kindLabel: "Kinds",
	kindMain: "Built-in",
	lastOfKind: "\"{entry}\" has only this pet left — deleting it would remove the whole kind. Delete the pet pack files to remove it entirely.",
	savePartial: "Main pets saved, but {names} could not be written back: check that the pack config is valid and the directory is writable.",
	notifyToggle: "System notifications",
	notifyToggleHint: "OS-level toasts (bottom-right of the desktop) for conversation completion, failures, permission requests, and questions — only while this window is unfocused.",
	clickSoundToggle: "Click sound",
	clickSoundToggleHint: "Plays the built-in click sound (assets/sound/click-duck.wav, volume 0.5) when a pet is clicked; repeated clicks within 100ms play only once, so multiple pets never stack up. Turn it off for silence. Written to the user config together with Save.",
	whisperImageToggle: "Whisper images",
	whisperImageToggleHint: "Attach one random meme from the pool to each whisper line (image mapping lives in the top-level `memes` config field). Tokens: a whisper already calls the model every cycle, so the image only appends the name + description of that one meme (~100 chars / ~60 tokens) to the same request — negligible.",
	chatImageToggle: "Chat images",
	chatImageToggleHint: "Let the AI pick one meme from the pool that fits the current context (optional; mapping lives in the top-level `memes` config field). Tokens: every message carries the whole catalog — currently ~1.1k chars (~650 tokens, about 11x the whisper case) and growing with the number of images; turning this off appends nothing at all.",
	chatAnimationToggle: "Chat actions",
	chatAnimationToggleHint: "When on, the chat request carries the list of playable animations (every action under animations.categories): if the model judges that the line really performs one, the pet acts it out on the spot; otherwise it replies in text only. Tokens: every message carries the whole list; off appends nothing. Global default for all pets (a pet pack can override it in its own config file).",
	confineToggle: "Lock to the current screen",
	confineToggleHint: "Multi-monitor: when on, the pet stays inside the screen it is currently on — a thrown pet bounces only inside the screen it was released on (screen seams act as walls, so it never flies to the neighbouring monitor), and autonomous wandering only walks within the screen it is currently on (a step that would cross the seam is simply cancelled). Turn this off to let it cross screens as usual. Desktop only — the browser overlay always stays inside the viewport anyway.",
	trayToggle: "System tray",
	trayToggleHint: "Shows a tray icon (notification area on Windows, menu bar on macOS) once desktop mode is running. It lists every pet in the config and toggles each one between desktop and web/none — including pets that are currently off the desktop and therefore have no window to right-click. With it off, bringing a pet back to the desktop requires opening the browser (the settings page, or right-clicking a web pet there). Windows already folds third-party icons into the \"hidden icons\" overflow. Desktop mode only.",
	voiceTitle: "Voice",
	voiceHint: "Three switches plus a voice: the master switch gates automatic speech, the two sub-switches gate one kind of proactive message each. All off by default; written to the user config on \"Save\" (never written immediately).",
	voiceEnabled: "Speak replies",
	voiceEnabledHint: "Master switch for automatic speech. When off, periodic whispers and todo reminders stay silent (the two sub-switches below have no effect). Manual whispers, chat replies and the speaker button in the chat panel are not gated — you asked for those, so the surface you asked from speaks them directly. It only affects whether sound is produced — bubbles, chat memory and system notifications are untouched; a failed synthesis is logged and never interrupts the conversation.",
	voiceWhisperEnabled: "Speak whispers",
	voiceWhisperEnabledHint: "Speaks the periodically generated whisper (right-clicking for a manual whisper is unaffected). Gated by the master switch above. Off by default — whispers are background narration and should not make noise unasked.",
	voiceTodoEnabled: "Speak todo reminders",
	voiceTodoEnabledHint: "Speaks a todo reminder when it comes due (the bubble still appears; this only decides whether it is spoken). Gated by the master switch above. Off by default.",
	voiceNameLabel: "Voice",
	voiceVolumeLabel: "Volume",
	voiceVolumeHint: "Playback volume as a 0–1 decimal: 1 is full volume (100%), 0 is muted. Changes loudness only and never re-synthesizes audio, so adjusting it costs nothing extra. Independent of the master switch above — it has no effect while that switch is off.",
	physicsTitle: "Physics (drag & throw feel)",
	physicsHint: "Global default, shared by every pet (a pet pack may override it in its own kind file); written to the user config on \"Save\" (never written immediately). Applies instantly in the browser; on the desktop it applies once Save reloads the pet windows.",
	mobileTitle: "Mobile effects",
	mobileHint: "Only meaningful in a phone browser: haptics needs a vibration motor, the two motion switches need tilt / accelerometer sensors, and sensors require HTTPS or localhost.",
	"physics.gravity": "Gravity",
	"physics.gravityHint": "px/s² — the higher, the faster it falls; 0 = weightless (flies straight forever)",
	"physics.restitution": "Bounciness",
	"physics.restitutionHint": "0–1, speed kept when bouncing off a wall or the floor (1 = perfectly elastic, 0 = stops dead)",
	"physics.groundFriction": "Contact friction",
	"physics.groundFrictionHint": "per second, damping along any surface hit (wall, floor, ceiling); 0 = frictionless ice everywhere",
	"physics.throwPower": "Throw power",
	"physics.throwPowerHint": "> 0, overall multiplier for spring tracking and release speed (1 = default; higher = tighter tracking, harder throws)",
	physicsCeilingBounce: "Ceiling bounce",
	physicsCeilingBounceHint: "Turn this off to let a throw fly out through the top of the screen (gravity still pulls it back)",
	physicsPetCollision: "Pet collisions",
	physicsPetCollisionHint: "A flying pet bounces off the others with momentum conservation (mass ∝ size²)",
	physicsHaptic: "Collision haptics",
	physicsHapticHint: "One buzz per hit (walls, floor, ceiling, other pets). Works in Chrome/Edge; not on iOS or WebView shells like Via. Do Not Disturb blocks it.",
	physicsTilt: "Tilt gravity",
	physicsTiltHint: "Tilt the phone and gravity follows it (magnitude = the gravity value above); with gravity at 0 tilt has no effect. Requires HTTPS/localhost.",
	physicsShake: "Shake to throw",
	physicsShakeHint: "Shake to fling the pet along the shake direction; strength scales with throwPower. Independent of gravity, so it still works at gravity 0. Requires HTTPS/localhost.",
	invalidPhysics: "Check the physics values: gravity / ground friction ≥ 0, bounciness 0–1, throw power > 0.",
	fontTitle: "Appearance & font",
	fontHint: "The family applies to every place that currently uses the candy font: pet bubble, hover tooltip, chat popup, score popup. The size applies only to the pet bubble and the hover tooltip (chat and score popups keep their own size). Global default, shared by every pet (a pet pack may override it in its own kind file); written to the user config on \"Save\" — instant in the browser, and on the desktop it applies once Save reloads the pet windows.",
	fontFamilyLabel: "Font",
	fontFamilyHint: "\"Candy (bundled)\" ships with the plugin; the others are system fonts. If a font is missing on this machine, it falls back to the next one in the stack (never blank, never an error).",
	fontSizeLabel: "Font size (px)",
	fontSizeHint: "Bubble body text size; the tooltip and the smaller lines inside the bubble scale proportionally. Range 4–200.",
	fontFollowToggle: "Scale font with pet size",
	fontFollowToggleHint: "On (default): the font grows with the pet — at 462 px width it is exactly the size above. Off: the size stays fixed regardless of pet size.",
	invalidFont: "Check the font settings: the family must be in the list and the size must be a number between 4 and 200.",
	"font.candy": "Candy (bundled)",
	"font.yahei": "Microsoft YaHei / PingFang",
	"font.youyuan": "YouYuan",
	"font.kaiti": "KaiTi",
	"font.simsun": "SimSun",
	"font.comic": "Comic Sans MS",
	"font.system": "System default",
	modelTitle: "Chat & models",
	modelHint: "Which model each of whisper and chat uses, and how much history every chat request carries. \"Follow current conversation\" uses the model your current conversation is on (default). Global default: applies to every pet, and a pet pack may override it in its own kind file. The options come from the same source as the DSH model picker, served live by the host.",
	modelFollow: "Follow current conversation",
	modelSearch: "Search models…",
	modelEmpty: "No matching models.",
	modelNoModels: "No models available.",
	modelLoading: "Refreshing model list…",
	modelTriggerAria: "Select model, current {model}",
	modelUnknown: " (current config, not in the list)",
	modelNone: "No models available for this provider",
	whisperModelLabel: "Whisper model",
	chatModelLabel: "Chat model",
	modelFieldHint: "\"Follow current conversation\" uses the conversation model; if a chosen model fails, the plugin falls back to the conversation model and retries once.",
	invalidModel: "Check the model settings: pick both a provider and a model, or leave both empty (follow the current conversation).",
	modelCatalogFailed: "Failed to load the model list (refresh the page to retry); your current values are kept as they are.",
	chatMemory: "Chat history rounds",
	chatMemoryHint: "How many recent rounds each chat request carries (1 round = 1 question + 1 answer; 0 = no history, every message starts fresh). The memory itself keeps everything — this only decides how much goes into the context: higher remembers more and costs more tokens. Global default, shared by every pet (a pet pack may override it in its own kind file).",
	invalidChatMemory: "Check the chat history rounds: it must be a number ≥ 0.",
	chatImageLimit: "Chat image limit",
	chatImageLimitHint: "How many memes at most are listed to the model during chat (\"first N\" = the first N you wrote in the config, so move the ones you want sent to the front). That whole list is attached to every message and tokens grow linearly with the count, so a long list is pure burn; capping it to the first N makes the model pick only among those. 0 = no limit (send everything). Built-in default 10. Global default, shared by every pet (a pet pack may override it in its own kind file). Chat only — a whisper carries just the one meme it drew.",
	invalidChatImageLimit: "Check the chat image limit: it must be a number ≥ 0 (0 = no limit).",
	notifyTest: "Test notification",
	notifyTestOk: "Test notification sent — check the bottom-right of your desktop.",
	notifyDenyUnsupported: "System notifications are not supported in this environment (no Notification API).",
	notifyDenyBlocked: "Notification permission is blocked by the browser.",
	notifyDenyRejected: "You chose \"Block\" in the permission prompt.",
	notifyDenyError: "Failed to request permission",
	notifyGuide: "Guide: click the 🔒/ⓘ icon next to the address bar → Site settings → Notifications → set to \"Allow\", then refresh and retry.",
	storageTitle: "Uninstall & storage",
	storageHint: "Every location this plugin writes to. Deleting cache folders is harmless (they re-download / rebuild); deleting \"plugin user data\" loses your config and chat memory.",
	"storage.userData": "Plugin user data: custom config main-config.jsonc, chat memory memory.json, custom animation assets main-animation/, file pets pet/",
	"storage.electron": "Electron runtime used by the desktop pet (large; re-downloaded automatically the next time desktop mode starts)",
	"storage.desktopCache": "Desktop pet window cache and primary-monitor scale cache (safe to delete, rebuilt automatically)",
	"storage.electronCache": "Electron installer download cache (safe to delete, re-downloaded when needed)",
	"storage.package": "The plugin itself (managed by DSH — remove it with the command below instead of deleting it)",
	storageMissing: " (not created yet)",
	uninstallTitle: "How to uninstall",
	uninstallStep1: "1. Quit DSH first (the desktop pet exits with it); do not delete these files while the pet is running.",
	uninstallStep2: "2. Remove the plugin itself (run in a terminal; this also drops it from the profile bundle layer):",
	uninstallStep3: "3. Delete the locations above as needed: cache folders are harmless; deleting \"plugin user data\" loses your config and chat memory (back up main-config.jsonc first if you want to keep it).",
	uninstallCmd: "dsh plugin --profile {profile} remove dsh-pet"
};

//#endregion
//#region src/client/settings/locales/es.ts
const es = {
	nav: "Configuración de mascotas",
	intro: "Gestiona varias mascotas: cada una tiene su propio tamaño y posición (se aplica al instante después de guardar).",
	petCardTitle: "Mascota",
	petCardHint: "Ajustes por mascota: nombre / tamaño / visualización / esquina / márgenes / los cuatro interruptores de funciones. Pulsa \"Guardar\" abajo para aplicar al instante.",
	globalTitle: "Interruptores globales",
	globalHint: "Compartidos por todas las mascotas (un pet pack puede sobrescribirlos en el archivo de su propio tipo). Estos interruptores solo cambian el estado local y se escriben en la configuración del usuario al \"Guardar\" (nunca al instante); las notificaciones del sistema se vuelven a leer justo después de guardar, sin necesidad de recargar la página.",
	cornerHint: "En qué esquina de la pantalla se pega la mascota (en escritorio se calcula por el área de trabajo de cada monitor).",
	marginXHint: "Distancia horizontal desde la esquina elegida (px); puede ser cualquier número.",
	marginYHint: "Distancia vertical desde la esquina elegida (px); puede ser cualquier número.",
	"cmd.chat": "Chat",
	"cmd.pet": "Mascota",
	"cmd.balance": "Saldo",
	"shortcut.open": "Abrir el chat de la mascota",
	"shortcut.chat": "Abrir la ventana de chat",
	"shortcut.hear": "Entrada de voz",
	"shortcut.capture": "Captura de pantalla al chat",
	shortcutCardTitle: "Atajos",
	shortcutCardHint: "Al expandir hay dos grupos: atajos de la mascota y atajos globales.",
	shortcutRowChat: "Abrir chat",
	shortcutRowHold: "Mantener para hablar",
	shortcutRowHear: "Entrada de voz",
	shortcutRowCapture: "Captura de pantalla",
	shortcutRowPaste: "Pegar imagen",
	shortcutRowTodo: "Tareas",
	shortcutRowSleep: "Dormir / despertar",
	shortcutRowDisplay: "Posición de visualización",
	shortcutRowSidebar: "Abrir el chat lateral",
	shortcutGroupPet: "Atajos de la mascota",
	shortcutGroupPetHint: "En la web basta con pasar el puntero sobre la mascota. En la ventana del escritorio hay que hacer clic en la mascota para que reciba el foco del teclado.",
	shortcutGroupGlobal: "Atajos globales",
	shortcutGroupGlobalHint: "Los distribuye DSH en la web y en la ventana del escritorio; se cambian en Ajustes → General → Atajos.",
	petsLabel: "Mascotas",
	add: "Agregar mascota",
	remove: "Eliminar",
	confirmRemove: "¿Eliminar la mascota \"{id}\"?",
	confirmTitle: "Confirmar acción",
	cancel: "Cancelar",
	ok: "Entendido",
	atLeastOne: "Debe quedar al menos una mascota.",
	emptyPets: "Aún no hay mascotas; haz clic en \"Agregar mascota\" para crear una.",
	sizeLabel: "Tamaño (ancho px)",
	sizeHint: "La altura es automática = ancho × 9/16.",
	sizePercentLabel: "Ancho de pantalla máx. (%)",
	sizePercentHint: "Cuánto del ancho de pantalla puede ocupar la mascota: 100 = nunca más ancha que una pantalla (igual que px en ventanas anchas); 30–40 la hace claramente más pequeña en el móvil sin cambiar el escritorio. Se calcula una vez al cargar; recarga tras redimensionar.",
	nameLabel: "Nombre",
	nameHint: "Se muestra al pasar el cursor y se añade a las personas de la IA (\"tu nombre es X\"). Se permiten duplicados; si se deja vacío, se usa el id de la mascota.",
	personaLabel: "Persona (opcional)",
	personaHint: "Solo afecta a esta mascota. Déjalo vacío para seguir la persona de la entrada: el texto gris del cuadro es exactamente ese contenido. El system que se envía al modelo = este texto + una línea añadida con \"tu nombre es <nombre>\" + el contexto de la hora actual, así que no repitas aquí el nombre ni la fecha.",
	personaCount: "{n} caracteres",
	balanceEnabled: "Saldo",
	balanceEnabledHint: "Cuando está activado, esta mascota reproduce animaciones de saldo y muestra el globo de saldo.",
	whisperEnabled: "Susurros",
	whisperEnabledHint: "Cuando está activado, esta mascota genera periódicamente una frase con IA y reproduce la animación de susurro (la persona está en el campo de abajo; vacío sigue la entrada).",
	workStatusEnabled: "Estado de trabajo",
	workStatusEnabledHint: "Cuando está activado, esta mascota sigue el estado de trabajo de DSH: pensando / trabajando / esperando confirmación / terminado / error cambian la animación y muestran globos (el pool está en la configuración de nivel superior; solo escucha, no llama al modelo).",
	fixedEnabled: "Fijar en el sitio",
	fixedEnabledHint: "Cuando está activado, la cadena aleatoria ya no gira ni aleja a esta mascota: solo se reproducen acciones de reposo y en el sitio. Las selecciones con clic derecho, los disparos por API y las animaciones de saldo / susurro / estado de trabajo no se ven afectados.",
	displayLabel: "Visualización",
	displayHint: "web = solo navegador / desktop = solo escritorio / both = ambos / none = ninguno",
	"display.web": "Solo navegador",
	"display.desktop": "Solo escritorio",
	"display.both": "Ambos",
	"display.none": "Ninguno",
	cornerLabel: "Posición",
	"corner.top-left": "Arriba a la izquierda",
	"corner.top-right": "Arriba a la derecha",
	"corner.bottom-left": "Abajo a la izquierda",
	"corner.bottom-right": "Abajo a la derecha",
	marginX: "Margen horizontal",
	marginY: "Margen vertical",
	save: "Guardar",
	saveHotkey: "Ctrl+S / Cmd+S",
	sync: "Sincronizar",
	confirmSync: "¿Sincronizar? Esto sobrescribe la configuración del usuario con la configuración predeterminada incluida (todos los campos + comentarios); las personalizaciones actuales se perderán.",
	corruptTitle: "La configuración del usuario está dañada; no se guardó",
	corruptConfirm: "Guardar de todos modos",
	corruptBody: "No se puede analizar el archivo de configuración del usuario (dañado, no es JSON/JSONC válido): {path}. Si guardas ahora, se reconstruirá desde la lista blanca: todo lo que hay actualmente en ese archivo (animations / physics / memes…) se perderá. Cancelar = no tocar el archivo (corrígelo y vuelve a guardar); Confirmar = guardar de todos modos (descartar lo que hay en el archivo).",
	syncHint: "\"Sincronizar\" escribe la configuración predeterminada incluida (con comentarios y todos los campos avanzados) en el archivo de configuración del usuario, sobrescribiendo tus personalizaciones actuales; después el archivo se puede editar directamente. Dos advertencias: (1) una vez creado, ese archivo es una capa de sobrescritura explícita: los cambios posteriores en los valores predeterminados incluidos no se aplicarán automáticamente (hasta que vuelvas a sincronizar o borres el archivo); (2) al pulsar \"Guardar\" en esta página se reescribe el archivo desde una lista blanca: los valores de los campos se conservan, pero los comentarios se pierden.",
	configMeta: "Avanzado (archivos)",
	configMetaHint: "La configuración del usuario puede sobrescribir las mascotas / los pools de animación / los pesos; recarga o reinicia para aplicarlo: recarga la página en el navegador, o haz clic derecho en una mascota de escritorio → \"Recargar configuración\" (reconstruye todas las ventanas de mascotas de escritorio). La configuración predeterminada es la referencia completa.",
	defaultConfig: "Configuración predeterminada (solo lectura, referencia completa)",
	userConfig: "Configuración del usuario (sobrescrituras personalizadas)",
	todosFile: "Datos de tareas (texto de la lista, hora de vencimiento y estado de completado; borrarlo vacía todas las tareas)",
	animationDir: "Directorio de recursos de animación (añade o personaliza animaciones aquí)",
	memesDir: "Directorio de imágenes de memes (añade o personaliza imágenes aquí)",
	logFile: "Archivo de registro (para diagnóstico; se puede vaciar)",
	logFileNote: "La versión de escritorio no tiene consola, así que todos los registros de ejecución del plugin (inicio, fallos y reinicios de la mascota de escritorio, errores y advertencias) van a este único archivo; adjúntalo al reportar un problema. El límite por archivo es de 1 MB; al llenarse solo se conservan los últimos 512 KB.",
	saved: "Guardado: las mascotas se actualizaron al instante.",
	loadError: "No se pudo cargar la configuración",
	saveError: "No se pudo guardar la configuración. Revisa la conexión con el servidor, los permisos de escritura del directorio de configuración y el registro del servidor.",
	saveInvalid: "No se pudo guardar la configuración: el contenido no es válido. Revísalo e inténtalo de nuevo.",
	syncError: "No se pudo sincronizar la configuración. Revisa la conexión con el servidor y los permisos de escritura del directorio de configuración.",
	loading: "Cargando configuración…",
	retry: "Reintentar",
	invalid: "Revisa los datos: el tamaño debe ser positivo; los márgenes pueden ser cualquier número.",
	busy: "Guardando…",
	extraPetsHint: "Otras {n} variantes provienen de archivos del directorio pet/ (<nombre>-config.json + <nombre>-animation/). Cambia a ellas en la fila Tipos de arriba; Guardar escribe en la configuración de cada pack, nunca en main-config.jsonc.",
	kindLabel: "Tipos",
	kindMain: "Integrado",
	lastOfKind: "«{entry}» solo tiene esta mascota; si la eliminas, desaparece todo el tipo. Para quitarlo por completo, borra los archivos del pack de la mascota.",
	savePartial: "Las mascotas principales se guardaron, pero {names} no se pudo escribir de vuelta: revisa que la configuración del pack sea válida y que el directorio tenga permisos de escritura.",
	notifyToggle: "Notificaciones del sistema",
	notifyToggleHint: "Avisos del sistema operativo (abajo a la derecha del escritorio) al completarse una conversación, si falla la generación, cuando se solicita permiso o cuando hay que elegir; solo mientras esta ventana no tiene el foco.",
	clickSoundToggle: "Sonido al hacer clic",
	clickSoundToggleHint: "Reproduce el sonido de clic integrado (assets/sound/click-duck.wav, volumen 0.5) al hacer clic en una mascota; los clics repetidos en menos de 100 ms solo suenan una vez, así que varias mascotas nunca se superponen. Desactívalo para silencio total. Se escribe en la configuración del usuario al Guardar.",
	whisperImageToggle: "Imágenes en susurros",
	whisperImageToggleHint: "Adjunta un meme aleatorio del pool a cada susurro (el mapeo de imágenes está en el campo `memes` de la configuración de nivel superior). Tokens: un susurro ya llama al modelo en cada ciclo, así que la imagen solo añade el nombre + la descripción de ese meme (~100 caracteres / ~60 tokens) a la misma solicitud: insignificante.",
	chatImageToggle: "Imágenes en el chat",
	chatImageToggleHint: "Deja que la IA elija un meme del pool que encaje con el contexto actual (opcional; el mapeo está en el campo `memes` de la configuración de nivel superior). Tokens: cada mensaje lleva el catálogo completo, unos 1.1k caracteres (~650 tokens, unas 11 veces el caso de los susurros) y crece con el número de imágenes; si lo desactivas, no se adjunta ni un carácter.",
	chatAnimationToggle: "Acciones en el chat",
	chatAnimationToggleHint: "Cuando está activado, la petición de chat lleva la lista de animaciones que se pueden representar (todas las acciones de animations.categories): si el modelo considera que la frase realmente representa una, la mascota la ejecuta en el acto; si no, responde solo con texto. Tokens: cada mensaje lleva la lista completa; desactivado no se adjunta nada. Valor predeterminado global para todas las mascotas (un pet pack puede sobrescribirlo en su propio archivo de configuración).",
	confineToggle: "Limitar a la pantalla actual",
	confineToggleHint: "Varios monitores: cuando está activado, la mascota solo se mueve dentro de la pantalla en la que está: una mascota lanzada rebota únicamente dentro de la pantalla donde se soltó (las uniones entre pantallas actúan como muros, así que nunca vuela al monitor vecino), y el vagabundeo autónomo solo camina dentro de la pantalla actual (el paso que cruzaría la unión se cancela). Desactívalo para permitir vuelos y caminatas entre pantallas. Solo afecta al modo escritorio: el overlay del navegador ya se queda dentro del viewport.",
	trayToggle: "Bandeja del sistema",
	trayToggleHint: "Muestra un icono en la bandeja (área de notificaciones en Windows, barra de menús en macOS) cuando el modo escritorio está activo. Lista todas las mascotas de la configuración y alterna cada una entre escritorio y web/ninguno, incluidas las que ahora no están en el escritorio y no tienen ventana donde hacer clic derecho. Con esto desactivado, para devolver una mascota al escritorio hay que abrir el navegador (la página de configuración o el clic derecho sobre la mascota web). Windows ya oculta los iconos de terceros en «iconos ocultos». Solo afecta al modo escritorio.",
	voiceTitle: "Voz",
	voiceHint: "Tres interruptores y una voz: el maestro controla la locución automática y los dos secundarios controlan un tipo de mensaje proactivo cada uno. Todo desactivado por defecto; se escribe en la configuración del usuario al \"Guardar\" (nunca al instante).",
	voiceEnabled: "Locutar respuestas",
	voiceEnabledHint: "Interruptor maestro de la locución automática. Si está desactivado, los susurros periódicos y los recordatorios de tareas quedan en silencio (los dos interruptores de abajo no tienen efecto). Los susurros manuales, las respuestas del chat y el botón de altavoz del panel de chat no dependen de él: los pediste tú, así que la superficie desde la que los pediste los locuta directamente. Solo afecta a si se produce sonido: los globos, la memoria del chat y las notificaciones del sistema no cambian; un fallo de síntesis se registra y nunca interrumpe la conversación.",
	voiceWhisperEnabled: "Locutar susurros",
	voiceWhisperEnabledHint: "Locuta el susurro generado periódicamente (el susurro manual con clic derecho no se ve afectado). Depende del interruptor maestro de arriba. Desactivado por defecto: los susurros son narración de fondo y no deberían sonar sin pedirlo.",
	voiceTodoEnabled: "Locutar recordatorios de tareas",
	voiceTodoEnabledHint: "Locuta el recordatorio de una tarea cuando vence (el globo sigue apareciendo; esto solo decide si se locuta). Depende del interruptor maestro de arriba. Desactivado por defecto.",
	voiceNameLabel: "Voz",
	voiceVolumeLabel: "Volumen",
	voiceVolumeHint: "Volumen de reproducción como decimal 0–1: 1 es el volumen máximo (100 %) y 0 silencia. Solo cambia la intensidad y no vuelve a sintetizar el audio, así que ajustarlo no tiene coste extra. Es independiente del interruptor general de arriba: con ese interruptor apagado no surte efecto.",
	physicsTitle: "Física (sensación al arrastrar y lanzar)",
	physicsHint: "Valor predeterminado global, compartido por todas las mascotas (un pet pack puede sobrescribirlo en el archivo de su propio tipo); se escribe en la configuración del usuario al \"Guardar\" (nunca al instante). En el navegador se aplica al instante; en el escritorio se aplica cuando Guardar recarga las ventanas de mascotas.",
	mobileTitle: "Efectos móviles",
	mobileHint: "Solo tienen sentido en el navegador del móvil: la vibración necesita motor, los dos interruptores de movimiento necesitan sensores de inclinación/aceleración, y los sensores exigen HTTPS o localhost.",
	"physics.gravity": "Gravedad",
	"physics.gravityHint": "px/s²: cuanto mayor, más rápido cae; 0 = sin gravedad (vuela en línea recta para siempre)",
	"physics.restitution": "Rebote",
	"physics.restitutionHint": "0–1, velocidad que se conserva al rebotar en una pared o el suelo (1 = completamente elástico, 0 = se detiene en seco)",
	"physics.groundFriction": "Fricción de contacto",
	"physics.groundFrictionHint": "por segundo, amortiguación a lo largo de cualquier superficie (pared, suelo, techo); 0 = hielo en todas",
	"physics.throwPower": "Fuerza de lanzamiento",
	"physics.throwPowerHint": "> 0, multiplicador general del seguimiento con resorte y de la velocidad de salida (1 = predeterminado; más alto = sigue más pegado y lanza más fuerte)",
	physicsCeilingBounce: "Rebote en el techo",
	physicsCeilingBounceHint: "Desactívalo para que un lanzamiento pueda salir por la parte superior de la pantalla (la gravedad sigue tirando de él hacia abajo)",
	physicsPetCollision: "Colisiones entre mascotas",
	physicsPetCollisionHint: "Una mascota en vuelo rebota contra las demás conservando el momento (masa ∝ tamaño²)",
	physicsHaptic: "Vibración al chocar",
	physicsHapticHint: "Una vibración por impacto (paredes, suelo, techo, otras mascotas). Funciona en Chrome/Edge; no en iOS ni en navegadores WebView como Via. El modo No molestar la bloquea.",
	physicsTilt: "Gravedad por inclinación",
	physicsTiltHint: "Inclina el móvil y la gravedad lo sigue (magnitud = el valor de arriba); con gravedad en 0 la inclinación no hace nada. Requiere HTTPS/localhost.",
	physicsShake: "Agitar para lanzar",
	physicsShakeHint: "Agita para lanzar la mascota en la dirección del gesto; la fuerza escala con throwPower. No depende de la gravedad, así que funciona con gravedad 0. Requiere HTTPS/localhost.",
	invalidPhysics: "Revisa los parámetros de física: gravedad / fricción con el suelo ≥ 0, rebote 0–1, fuerza de lanzamiento > 0.",
	fontTitle: "Apariencia y fuente",
	fontHint: "La familia se aplica a todos los textos que ahora usan la fuente candy: globo de la mascota, tooltip al pasar el cursor, ventana de chat y ventana de puntuación. El tamaño solo se aplica al globo de la mascota y al tooltip (las ventanas de chat y de puntuación conservan su tamaño). Valor predeterminado global, compartido por todas las mascotas (un pet pack puede sobrescribirlo en el archivo de su propio tipo); se escribe en la configuración del usuario al \"Guardar\": al instante en el navegador y, en el escritorio, cuando Guardar recarga las ventanas de mascotas.",
	fontFamilyLabel: "Fuente",
	fontFamilyHint: "«Candy (integrada)» viene con el plugin; las demás son fuentes del sistema. Si una fuente no está instalada en esta máquina, se usa la siguiente de la pila (nunca queda en blanco ni da error).",
	fontSizeLabel: "Tamaño de fuente (px)",
	fontSizeHint: "Tamaño del texto del globo; el tooltip y las líneas pequeñas dentro del globo se escalan en proporción. Rango 4–200.",
	fontFollowToggle: "Escalar la fuente con el tamaño de la mascota",
	fontFollowToggleHint: "Activado (predeterminado): la fuente crece con la mascota; con 462 px de ancho es exactamente el tamaño de arriba. Desactivado: el tamaño queda fijo sin importar el tamaño de la mascota.",
	invalidFont: "Revisa la configuración de la fuente: la familia debe estar en la lista y el tamaño debe ser un número entre 4 y 200.",
	"font.candy": "Candy (integrada)",
	"font.yahei": "Microsoft YaHei / PingFang",
	"font.youyuan": "YouYuan",
	"font.kaiti": "KaiTi",
	"font.simsun": "SimSun",
	"font.comic": "Comic Sans MS",
	"font.system": "Predeterminada del sistema",
	modelTitle: "Chat y modelos",
	modelHint: "Qué modelo usa cada uno de susurros y chat, y cuánto historial lleva cada solicitud de chat. \"Seguir la conversación actual\" usa el modelo de tu conversación actual (predeterminado). Valor predeterminado global: se aplica a todas las mascotas y un pet pack puede sobrescribirlo en el archivo de su propio tipo. Las opciones vienen de la misma fuente que el selector de modelos de DSH y el host las sirve en vivo.",
	modelFollow: "Seguir la conversación actual",
	modelSearch: "Buscar modelos…",
	modelEmpty: "No hay modelos que coincidan.",
	modelNoModels: "No hay modelos disponibles.",
	modelLoading: "Actualizando la lista de modelos…",
	modelTriggerAria: "Seleccionar modelo, actual {model}",
	modelUnknown: " (configuración actual, no está en la lista)",
	modelNone: "Este proveedor no tiene modelos disponibles",
	whisperModelLabel: "Modelo de susurros",
	chatModelLabel: "Modelo de chat",
	modelFieldHint: "\"Seguir la conversación actual\" usa el modelo de la conversación; si el modelo elegido falla, se vuelve al modelo de la conversación y se reintenta una vez.",
	invalidModel: "Revisa la configuración del modelo: elige proveedor y modelo, o deja ambos vacíos (seguir la conversación actual).",
	modelCatalogFailed: "No se pudo cargar la lista de modelos (recarga la página para reintentar); tus valores actuales se conservan tal cual.",
	chatMemory: "Rondas de historial del chat",
	chatMemoryHint: "Cuántas rondas recientes lleva cada solicitud de chat (1 ronda = 1 pregunta + 1 respuesta; 0 = sin historial, cada mensaje empieza de cero). La memoria en sí lo guarda todo: esto solo decide cuánto entra en el contexto; más rondas recuerdan más y gastan más tokens. Valor predeterminado global, compartido por todas las mascotas (un pet pack puede sobrescribirlo en el archivo de su propio tipo).",
	invalidChatMemory: "Revisa las rondas de historial del chat: debe ser un número ≥ 0.",
	chatImageLimit: "Límite de imágenes en el chat",
	chatImageLimitHint: "Cuántos memes como máximo se listan al modelo durante el chat (\"los primeros N\" = los N que escribiste primero en la configuración; mueve al frente los que quieras enviar). Esa lista completa se adjunta a cada mensaje y los tokens crecen de forma lineal con la cantidad, así que una lista larga es puro gasto; limitarla a los primeros N hace que el modelo elija solo entre esos. 0 = sin límite (enviar todo). Valor integrado predeterminado: 10. Valor predeterminado global, compartido por todas las mascotas (un pet pack puede sobrescribirlo en el archivo de su propio tipo). Solo afecta a la selección de imágenes del chat: un susurro lleva solo el meme que sacó.",
	invalidChatImageLimit: "Revisa el límite de imágenes del chat: debe ser un número ≥ 0 (0 = sin límite).",
	notifyTest: "Probar notificación",
	notifyTestOk: "Notificación de prueba enviada; mírala abajo a la derecha del escritorio.",
	notifyDenyUnsupported: "Este entorno no admite notificaciones del sistema (no hay API Notification).",
	notifyDenyBlocked: "El navegador tiene bloqueado el permiso de notificaciones.",
	notifyDenyRejected: "Elegiste «Bloquear» en el aviso de permiso.",
	notifyDenyError: "Error al solicitar permiso",
	notifyGuide: "Guía: haz clic en el icono 🔒/ⓘ junto a la barra de direcciones → Configuración del sitio → Notificaciones → cámbialo a «Permitir» y luego recarga la página y reintenta.",
	storageTitle: "Desinstalación y almacenamiento",
	storageHint: "Todas las ubicaciones que escribe este plugin. Borrar las cachés no rompe nada (se vuelven a descargar/reconstruir); borrar los «datos de usuario del plugin» pierde la configuración y la memoria del chat.",
	"storage.userData": "Datos de usuario del plugin: configuración personalizada main-config.jsonc, memoria del chat memory.json, recursos de animación personalizados main-animation/, mascotas de archivo pet/",
	"storage.electron": "Runtime de Electron que usa la mascota de escritorio (grande; se vuelve a descargar automáticamente la próxima vez que se active el modo escritorio)",
	"storage.desktopCache": "Caché de las ventanas de mascotas de escritorio y caché de escala del monitor principal (se puede borrar, se reconstruye automáticamente)",
	"storage.electronCache": "Caché de descarga del instalador de Electron (se puede borrar, se vuelve a descargar cuando haga falta)",
	"storage.package": "El plugin en sí (lo gestiona DSH: quítalo con el comando de abajo en vez de borrarlo a mano)",
	storageMissing: " (aún no se ha creado)",
	uninstallTitle: "Cómo desinstalar",
	uninstallStep1: "1. Cierra DSH primero (la mascota de escritorio se cierra con él); no borres estos archivos mientras la mascota esté en ejecución.",
	uninstallStep2: "2. Quita el plugin en sí (ejecútalo en la terminal; también lo elimina de la capa de bundles del perfil):",
	uninstallStep3: "3. Borra las ubicaciones de arriba según necesites: las cachés no hacen daño; borrar los «datos de usuario del plugin» pierde la configuración y la memoria del chat (haz una copia de main-config.jsonc si quieres conservarla).",
	uninstallCmd: "dsh plugin --profile {profile} remove dsh-pet"
};

//#endregion
//#region src/client/settings/locales/fr.ts
const fr = {
	nav: "Configuration des compagnons",
	intro: "Gérez plusieurs compagnons : chacun a sa taille et sa position (appliquées immédiatement après l'enregistrement).",
	petCardTitle: "Compagnon",
	petCardHint: "Réglages par compagnon : nom / taille / affichage / coin / décalages / les quatre interrupteurs de fonctionnalités. Cliquez sur « Enregistrer » en bas pour appliquer immédiatement.",
	globalTitle: "Interrupteurs globaux",
	globalHint: "Partagés par tous les compagnons (un pet pack peut les remplacer dans son propre fichier de type). Ces interrupteurs ne modifient que l'état local et sont écrits dans la configuration utilisateur lors de l'enregistrement (jamais immédiatement) ; les notifications système sont relues juste après l'enregistrement, sans rafraîchir la page.",
	cornerHint: "Le coin de l'écran auquel le compagnon se colle (par zone de travail de chaque écran en mode bureau).",
	marginXHint: "Distance horizontale au coin choisi (px) ; n'importe quel nombre.",
	marginYHint: "Distance verticale au coin choisi (px) ; n'importe quel nombre.",
	"cmd.chat": "Discussion",
	"cmd.pet": "Compagnon",
	"cmd.balance": "Solde",
	"shortcut.open": "Ouvrir le chat du compagnon",
	"shortcut.chat": "Ouvrir la fenêtre de chat",
	"shortcut.hear": "Saisie vocale",
	"shortcut.capture": "Capture d’écran vers le chat",
	shortcutCardTitle: "Raccourcis",
	shortcutCardHint: "Deux groupes une fois déployé : raccourcis du compagnon et raccourcis globaux.",
	shortcutRowChat: "Ouvrir le chat",
	shortcutRowHold: "Maintenir pour parler",
	shortcutRowHear: "Saisie vocale",
	shortcutRowCapture: "Capture d’écran",
	shortcutRowPaste: "Coller une image",
	shortcutRowTodo: "Tâches",
	shortcutRowSleep: "Dormir / réveiller",
	shortcutRowDisplay: "Position d’affichage",
	shortcutRowSidebar: "Ouvrir le chat latéral",
	shortcutGroupPet: "Raccourcis du compagnon",
	shortcutGroupPetHint: "Sur le web, il suffit de survoler le compagnon. Dans la fenêtre du bureau, cliquez d’abord sur le compagnon pour qu’il prenne le focus clavier.",
	shortcutGroupGlobal: "Raccourcis globaux",
	shortcutGroupGlobalHint: "Distribués par DSH dans le web et la fenêtre du bureau ; modifiables dans Réglages → Général → Raccourcis.",
	petsLabel: "Compagnons",
	add: "Ajouter un compagnon",
	remove: "Supprimer",
	confirmRemove: "Supprimer le compagnon « {id} » ?",
	confirmTitle: "Confirmer l'action",
	cancel: "Annuler",
	ok: "Compris",
	atLeastOne: "Gardez au moins un compagnon.",
	emptyPets: "Aucun compagnon pour l'instant — cliquez sur « Ajouter un compagnon » pour en créer un.",
	sizeLabel: "Taille (largeur px)",
	sizeHint: "La hauteur est automatique = largeur × 9/16.",
	sizePercentLabel: "Largeur d’écran max (%)",
	sizePercentHint: "Part de la largeur d’écran que le pet peut occuper : 100 = jamais plus large qu’un écran (identique au px sur une fenêtre large) ; 30–40 le rend nettement plus petit sur téléphone sans changer le bureau. Calculé une fois au chargement ; rechargez après redimensionnement.",
	nameLabel: "Nom",
	nameHint: "Affiché au survol du compagnon et ajouté aux personas de l'IA (« votre nom est X »). Les doublons sont permis ; laissé vide, l'identifiant du compagnon est utilisé.",
	personaLabel: "Persona (facultatif)",
	personaHint: "Ne concerne que ce compagnon. Laissez vide pour suivre le persona de l'entrée — le texte grisé dans le champ est exactement celui-ci. Le system réellement envoyé au modèle = ce texte + la ligne « votre nom est <nom> » ajoutée automatiquement + le contexte temporel courant ; ne répétez donc ni le nom ni la date ici.",
	personaCount: "{n} caractères",
	balanceEnabled: "Fonction solde",
	balanceEnabledHint: "Une fois activée, ce compagnon joue l'animation de solde et affiche la bulle de solde.",
	whisperEnabled: "Murmures",
	whisperEnabledHint: "Une fois activé, ce compagnon génère périodiquement une phrase via l'IA et joue l'animation de murmure (persona = le champ ci-dessous ; vide = celui de l'entrée).",
	workStatusEnabled: "Suivi de l'état de travail",
	workStatusEnabledHint: "Une fois activé, ce compagnon suit l'état de travail de DSH : réflexion / travail / attente de confirmation / terminé / erreur déclenchent l'animation correspondante et une bulle (le pool se trouve au niveau supérieur de la configuration ; écoute seule, aucun appel au modèle).",
	fixedEnabled: "Compagnon fixe",
	fixedEnabledHint: "Une fois activé, la chaîne aléatoire ne fait plus se retourner ni s'éloigner le compagnon — seules les actions sur place sont jouées. Les déclenchements par menu contextuel et par API, ainsi que les animations solde / murmure / état de travail, ne sont pas affectés.",
	displayLabel: "Affichage",
	displayHint: "web = navigateur seul / desktop = bureau seul / both = les deux / none = aucun",
	"display.web": "Navigateur seul",
	"display.desktop": "Bureau seul",
	"display.both": "Les deux",
	"display.none": "Aucun",
	cornerLabel: "Position",
	"corner.top-left": "En haut à gauche",
	"corner.top-right": "En haut à droite",
	"corner.bottom-left": "En bas à gauche",
	"corner.bottom-right": "En bas à droite",
	marginX: "Décalage horizontal",
	marginY: "Décalage vertical",
	save: "Enregistrer",
	saveHotkey: "Ctrl+S / Cmd+S",
	sync: "Synchroniser",
	confirmSync: "Synchroniser ? La configuration par défaut intégrée (tous les champs + commentaires) remplacera la configuration utilisateur ; vos personnalisations actuelles seront perdues.",
	corruptTitle: "Configuration utilisateur corrompue — non enregistrée",
	corruptConfirm: "Enregistrer quand même",
	corruptBody: "Le fichier de configuration utilisateur est illisible (corrompu, JSON/JSONC invalide) : {path}. Enregistrer maintenant le reconstruit à partir de la liste blanche — tout son contenu actuel (animations / physics / memes, etc.) sera perdu. Annuler = ne pas toucher au fichier (corrigez-le puis enregistrez) ; Confirmer = enregistrer quand même (le contenu actuel du fichier est abandonné).",
	syncHint: "« Synchroniser » écrit la configuration par défaut intégrée (commentaires et tous les champs avancés compris) dans le fichier de configuration utilisateur, en écrasant vos personnalisations ; le fichier est ensuite modifiable directement. Deux réserves : (1) une fois créé, ce fichier est une couche de remplacement explicite — les changements ultérieurs des valeurs par défaut intégrées ne s'appliquent pas automatiquement (sauf nouvelle synchronisation ou suppression du fichier) ; (2) cliquer sur « Enregistrer » sur cette page réécrit le fichier à partir d'une liste blanche — les valeurs sont conservées, les commentaires disparaissent.",
	configMeta: "Configuration avancée (fichiers)",
	configMetaHint: "La configuration utilisateur peut remplacer la liste des compagnons / les pools d'animation / les poids ; rechargez la page ou redémarrez pour appliquer : rafraîchissez la page dans le navigateur, ou sur le bureau, clic droit sur un compagnon → « Recharger la configuration » (reconstruit toutes les fenêtres de compagnons). La configuration par défaut est la référence complète.",
	defaultConfig: "Configuration par défaut (lecture seule, référence complète)",
	userConfig: "Configuration utilisateur (remplacements personnalisés)",
	todosFile: "Données de tâches (texte, échéance et état ; les supprimer vide toutes les tâches)",
	animationDir: "Dossier des animations (pour ajouter ou personnaliser des animations)",
	memesDir: "Dossier des mèmes (pour ajouter ou personnaliser des images)",
	logFile: "Fichier journal (pour le dépannage ; peut être vidé)",
	logFileNote: "L'application de bureau n'a pas de console : tous les journaux d'exécution du plugin (démarrage, plantages / redémarrages des compagnons, erreurs et avertissements) sont écrits dans ce seul fichier — joignez-le à vos rapports de problème. Limité à 1 Mo ; une fois plein, seuls les 512 Ko les plus récents sont conservés.",
	saved: "Enregistré — les compagnons sont à jour immédiatement.",
	loadError: "Échec du chargement de la configuration",
	saveError: "Échec de l'enregistrement de la configuration. Vérifiez la connexion au serveur, les droits d'écriture du dossier de configuration et le journal du serveur.",
	saveInvalid: "Échec de l'enregistrement : configuration invalide. Vérifiez les valeurs et réessayez.",
	syncError: "Échec de la synchronisation. Vérifiez la connexion au serveur et les droits d'écriture du dossier de configuration.",
	loading: "Chargement de la configuration…",
	retry: "Réessayer",
	invalid: "Vérifiez votre saisie : la taille doit être positive ; les marges peuvent être n'importe quel nombre.",
	busy: "Enregistrement…",
	extraPetsHint: "{n} autre(s) type(s) proviennent de fichiers du dossier pet/ (<nom>-config.json + <nom>-animation/) ; basculez dessus dans la ligne « Types » ci-dessus. L'enregistrement écrit dans la configuration propre à chaque pack, jamais dans main-config.jsonc.",
	kindLabel: "Types",
	kindMain: "Intégré",
	lastOfKind: "« {entry} » n'a plus que ce compagnon — le supprimer ferait disparaître tout le type. Pour le retirer complètement, supprimez les fichiers du pack.",
	savePartial: "Compagnons principaux enregistrés, mais {names} n'ont pas pu être écrits : vérifiez que la configuration du pack est valide et que le dossier est accessible en écriture.",
	notifyToggle: "Notifications système",
	notifyToggleHint: "Notifications du système d'exploitation (en bas à droite du bureau) pour la fin d'une conversation, les échecs, les demandes de permission et les questions — uniquement lorsque cette fenêtre n'a pas le focus.",
	clickSoundToggle: "Son au clic",
	clickSoundToggleHint: "Joue le son intégré (assets/sound/click-duck.wav, volume 0,5) quand on clique sur un compagnon ; les clics répétés en moins de 100 ms ne sonnent qu'une fois, donc plusieurs compagnons ne se superposent jamais. Désactivez-le pour un silence total. Écrit dans la configuration utilisateur avec « Enregistrer ».",
	whisperImageToggle: "Images des murmures",
	whisperImageToggleHint: "Joindre un mème tiré au hasard dans le pool à chaque murmure (la correspondance des images se trouve dans le champ memes, au niveau supérieur de la configuration). Tokens : un murmure appelle déjà le modèle à chaque cycle ; l'image ajoute seulement le nom + la description de ce mème (environ 100 caractères / ~60 tokens) à la même requête — négligeable.",
	chatImageToggle: "Images de discussion",
	chatImageToggleHint: "L'IA choisit un mème du pool adapté au contexte (facultatif ; la correspondance se trouve dans le champ memes, au niveau supérieur de la configuration). Tokens : chaque message transporte tout le catalogue — actuellement environ 1,1 k caractères (~650 tokens, soit environ 11 fois le cas des murmures) et cela croît avec le nombre d'images ; désactivé, rien du tout n'est ajouté.",
	chatAnimationToggle: "Actions en discussion",
	chatAnimationToggleHint: "Une fois activé, la requête de discussion transporte la liste des animations jouables (toutes les actions de animations.categories) : si le modèle estime que la réplique joue réellement l'une d'elles, le compagnon la joue immédiatement ; sinon il répond seulement en texte. Tokens : chaque message transporte toute la liste ; désactivé, rien n'est ajouté. Valeur par défaut globale pour tous les compagnons (un pet pack peut la surcharger dans son propre fichier de configuration).",
	confineToggle: "Limiter à l'écran actuel",
	confineToggleHint: "Multi-écrans : une fois activé, le compagnon reste sur l'écran où il se trouve — un compagnon lancé ne rebondit que sur l'écran du relâchement (les jointures d'écrans font office de murs, il ne passe pas sur l'écran voisin) et l'errance autonome ne se fait que sur l'écran actuel (tout pas qui franchirait la jointure est annulé). Désactivé, il traverse les écrans comme d'habitude. Mode bureau uniquement — l'overlay du navigateur reste de toute façon dans la zone visible.",
	trayToggle: "Zone de notification",
	trayToggleHint: "Affiche une icône dans la zone de notification (barre de menus sur macOS) dès que le mode bureau démarre. Elle liste tous les compagnons de la configuration et permet de basculer chacun entre bureau et web / aucun — y compris ceux qui ne sont pas sur le bureau et n'ont donc aucune fenêtre à cliquer droit. Une fois désactivée, ramener un compagnon sur le bureau exige d'ouvrir le navigateur (la page de configuration, ou un clic droit sur le compagnon web). Windows range déjà ces icônes dans le panneau « icônes masquées ». Mode bureau uniquement.",
	voiceTitle: "Synthèse vocale",
	voiceHint: "Trois interrupteurs et une voix : l'interrupteur principal commande la lecture automatique, les deux sous-interrupteurs commandent chacun un type de message proactif. Tout est désactivé par défaut et écrit dans la configuration utilisateur lors de l'enregistrement (jamais immédiatement).",
	voiceEnabled: "Lecture vocale",
	voiceEnabledHint: "Interrupteur principal de la lecture automatique. Désactivé, les murmures périodiques et les rappels de tâches restent muets (les deux sous-interrupteurs ci-dessous n'ont alors aucun effet). Les murmures manuels, les réponses de discussion et le bouton haut-parleur du panneau de discussion ne sont pas concernés — vous les avez demandés, la surface qui les déclenche les lit directement. Cela ne décide que du son émis : bulles, mémoire de discussion et notifications système restent intactes ; un échec de synthèse est seulement journalisé et n'interrompt jamais la conversation.",
	voiceWhisperEnabled: "Lire les murmures",
	voiceWhisperEnabledHint: "Lit le murmure généré périodiquement (un murmure manuel par clic droit n'est pas concerné). Soumis à l'interrupteur principal ci-dessus. Désactivé par défaut — les murmures sont une narration de fond et ne doivent pas faire de bruit sans qu'on le demande.",
	voiceTodoEnabled: "Lire les rappels de tâches",
	voiceTodoEnabledHint: "Lit un rappel de tâche à son échéance (la bulle s'affiche toujours ; cet interrupteur décide seulement s'il est lu). Soumis à l'interrupteur principal ci-dessus. Désactivé par défaut.",
	voiceNameLabel: "Voix",
	voiceVolumeLabel: "Volume",
	voiceVolumeHint: "Volume de lecture en décimal 0–1 : 1 correspond au volume maximal (100 %), 0 coupe le son. Seule l’intensité change et l’audio n’est pas resynthétisé, donc le régler ne coûte rien de plus. Indépendant de l’interrupteur général ci-dessus : il est sans effet quand celui-ci est désactivé.",
	physicsTitle: "Physique (ressenti du glisser-lancer)",
	physicsHint: "Valeurs par défaut globales, partagées par tous les compagnons (un pet pack peut les remplacer dans son propre fichier de type) ; écrites dans la configuration utilisateur lors de l'enregistrement (jamais immédiatement). Appliquées immédiatement dans le navigateur ; sur le bureau, après que l'enregistrement a rechargé les fenêtres des compagnons.",
	mobileTitle: "Effets mobiles",
	mobileHint: "Ces réglages n'ont de sens que dans un navigateur mobile : la vibration exige un moteur, les deux interrupteurs de mouvement exigent des capteurs d'inclinaison / d'accélération, et ces capteurs ne fonctionnent qu'en HTTPS ou sur localhost.",
	"physics.gravity": "Gravité",
	"physics.gravityHint": "px/s², plus la valeur est élevée, plus la chute est rapide ; 0 = apesanteur (trajectoire rectiligne uniforme)",
	"physics.restitution": "Rebond",
	"physics.restitutionHint": "0 à 1, proportion de vitesse conservée lors du rebond contre un mur ou le sol (1 = parfaitement élastique, 0 = arrêt net)",
	"physics.groundFriction": "Frottement de contact",
	"physics.groundFrictionHint": "par seconde, atténuation de la vitesse le long de toute surface touchée (mur, sol, plafond) ; 0 = verglas partout",
	"physics.throwPower": "Force de lancer",
	"physics.throwPowerHint": "> 0, multiplicateur global du suivi ressort et de la vitesse de lancer (1 = valeur par défaut ; plus haut = suivi plus ferme et lancers plus violents)",
	physicsCeilingBounce: "Rebond au plafond",
	physicsCeilingBounceHint: "Désactivé, un lancer peut sortir par le haut de l'écran (la gravité le ramène)",
	physicsPetCollision: "Collisions entre compagnons",
	physicsPetCollisionHint: "Un compagnon en vol rebondit sur les autres en conservant la quantité de mouvement (masse ∝ taille²)",
	physicsHaptic: "Vibration aux collisions",
	physicsHapticHint: "Une vibration par impact (murs, sol, plafond, autres compagnons). Fonctionne dans Chrome/Edge ; pas sur iOS ni dans les coques WebView comme Via. Le mode Ne pas déranger la bloque.",
	physicsTilt: "Gravité par inclinaison",
	physicsTiltHint: "Inclinez le téléphone : la gravité suit (valeur = celle ci-dessus) ; avec une gravité à 0, l’inclinaison n’a aucun effet. Nécessite HTTPS/localhost.",
	physicsShake: "Secouer pour lancer",
	physicsShakeHint: "Secouez pour lancer le compagnon dans le sens du geste ; la force suit throwPower. Indépendant de la gravité, donc utilisable à gravité 0. Nécessite HTTPS/localhost.",
	invalidPhysics: "Vérifiez les paramètres physiques : gravité / frottement au sol ≥ 0, rebond entre 0 et 1, force de lancer > 0.",
	fontTitle: "Apparence et police",
	fontHint: "La famille s'applique partout où la police bonbon est utilisée : bulle du compagnon, infobulle, fenêtre de discussion, fenêtre de score ; la taille ne concerne que la bulle et l'infobulle (les fenêtres de discussion et de score gardent la leur). Valeurs globales par défaut, partagées par tous les compagnons (un pet pack peut les remplacer dans son propre fichier de type) ; écrites dans la configuration utilisateur lors de l'enregistrement — immédiat dans le navigateur, et sur le bureau après rechargement des fenêtres par l'enregistrement.",
	fontFamilyLabel: "Police",
	fontFamilyHint: "« Bonbon (intégrée) » est fournie avec le plugin ; les autres sont des polices système. Si une police manque sur la machine, la pile passe à la suivante (jamais de vide ni d'erreur).",
	fontSizeLabel: "Taille de police (px)",
	fontSizeHint: "Taille du texte des bulles ; l'infobulle et les petites lignes de la bulle suivent proportionnellement. Plage 4 à 200.",
	fontFollowToggle: "Mettre la police à l'échelle du compagnon",
	fontFollowToggleHint: "Activé (par défaut) : la police grandit avec le compagnon — à 462 px de largeur, elle correspond exactement à la taille ci-dessus. Désactivé : la taille reste fixe quelle que soit la taille du compagnon.",
	invalidFont: "Vérifiez les réglages de police : la famille doit figurer dans la liste et la taille doit être un nombre entre 4 et 200.",
	"font.candy": "Bonbon (intégrée)",
	"font.yahei": "Microsoft YaHei / PingFang",
	"font.youyuan": "YouYuan",
	"font.kaiti": "KaiTi",
	"font.simsun": "SimSun",
	"font.comic": "Comic Sans MS",
	"font.system": "Police système",
	modelTitle: "Discussion et modèles",
	modelHint: "Quel modèle utilisent les murmures et la discussion, et combien d'historique chaque requête transporte. « Suivre la conversation actuelle » utilise le modèle de votre conversation en cours (par défaut). Valeur globale par défaut : s'applique à tous les compagnons, et un pet pack peut la remplacer dans son propre fichier de type. Les options viennent de la même source que le sélecteur de modèles de DSH, fournies en direct par l'hôte.",
	modelFollow: "Suivre la conversation actuelle",
	modelSearch: "Rechercher un modèle…",
	modelEmpty: "Aucun modèle correspondant.",
	modelNoModels: "Aucun modèle disponible.",
	modelLoading: "Actualisation de la liste des modèles…",
	modelTriggerAria: "Choisir un modèle, actuellement {model}",
	modelUnknown: " (configuration actuelle, absent de la liste)",
	modelNone: "Aucun modèle disponible pour ce fournisseur",
	whisperModelLabel: "Modèle des murmures",
	chatModelLabel: "Modèle de discussion",
	modelFieldHint: "« Suivre la conversation actuelle » utilise le modèle de la conversation ; si un modèle choisi échoue, le plugin revient au modèle de la conversation et réessaie une fois.",
	invalidModel: "Vérifiez les réglages de modèle : choisissez à la fois un fournisseur et un modèle, ou laissez les deux vides (suivre la conversation actuelle).",
	modelCatalogFailed: "Échec du chargement de la liste des modèles (rafraîchissez la page pour réessayer) ; vos valeurs actuelles sont conservées telles quelles.",
	chatMemory: "Tours d'historique de discussion",
	chatMemoryHint: "Nombre de tours récents transportés par chaque requête de discussion (1 tour = 1 question + 1 réponse ; 0 = aucun historique, chaque message repart de zéro). La mémoire elle-même conserve tout — cette valeur décide seulement de ce qui entre dans le contexte : plus elle est élevée, plus le compagnon se souvient, et plus cela coûte de tokens. Valeur globale par défaut, partagée par tous les compagnons (un pet pack peut la remplacer dans son propre fichier de type).",
	invalidChatMemory: "Vérifiez les tours d'historique : il faut un nombre ≥ 0.",
	chatImageLimit: "Limite d'images de discussion",
	chatImageLimitHint: "Nombre maximal de mèmes proposés au modèle pendant la discussion (« N premiers » = les N premières entrées de la configuration ; déplacez en tête celles que vous voulez voir partir en priorité). Toute la liste est jointe à chaque message et les tokens croissent linéairement avec le nombre, donc une longue liste coûte cher ; la limiter aux N premières restreint le choix du modèle à celles-là. 0 = aucune limite (tout envoyer). Valeur intégrée par défaut : 10. Valeur globale par défaut, partagée par tous les compagnons (un pet pack peut la remplacer dans son propre fichier de type). Discussion uniquement — un murmure ne porte que le mème tiré.",
	invalidChatImageLimit: "Vérifiez la limite d'images de discussion : il faut un nombre ≥ 0 (0 = aucune limite).",
	notifyTest: "Tester la notification",
	notifyTestOk: "Notification de test envoyée — regardez en bas à droite de votre bureau.",
	notifyDenyUnsupported: "Les notifications système ne sont pas prises en charge dans cet environnement (pas d'API Notification).",
	notifyDenyBlocked: "L'autorisation de notification est bloquée par le navigateur.",
	notifyDenyRejected: "Vous avez choisi « Bloquer » dans la demande d'autorisation.",
	notifyDenyError: "Échec de la demande d'autorisation",
	notifyGuide: "Marche à suivre : cliquez sur l'icône 🔒/ⓘ à gauche de la barre d'adresse → « Paramètres du site » → « Notifications » → choisissez « Autoriser », puis rafraîchissez la page et réessayez.",
	storageTitle: "Désinstallation et stockage",
	storageHint: "Tous les emplacements où ce plugin écrit sur la machine. Supprimer les caches est sans risque (ils sont retéléchargés / reconstruits) ; supprimer les « données utilisateur du plugin » fait perdre la configuration et la mémoire de discussion.",
	"storage.userData": "Données utilisateur du plugin : configuration personnalisée main-config.jsonc, mémoire de discussion memory.json, animations personnalisées main-animation/, compagnons fichiers pet/",
	"storage.electron": "Runtime Electron du compagnon de bureau (volumineux ; retéléchargé automatiquement au prochain démarrage du mode bureau)",
	"storage.desktopCache": "Cache des fenêtres de compagnons et cache d'échelle de l'écran principal (suppression sans risque, reconstruit automatiquement)",
	"storage.electronCache": "Cache de téléchargement de l'installateur Electron (suppression sans risque, retéléchargé si besoin)",
	"storage.package": "Le plugin lui-même (géré par DSH — retirez-le avec la commande ci-dessous plutôt que de le supprimer à la main)",
	storageMissing: " (pas encore créé)",
	uninstallTitle: "Comment désinstaller",
	uninstallStep1: "1. Quittez d'abord DSH (le compagnon de bureau s'arrête avec lui) ; ne supprimez pas ces fichiers pendant que le compagnon tourne.",
	uninstallStep2: "2. Retirez le plugin lui-même (dans un terminal ; il est aussi retiré de la couche bundle du profil) :",
	uninstallStep3: "3. Supprimez les emplacements ci-dessus selon vos besoins : les caches sont sans risque ; supprimer les « données utilisateur du plugin » fait perdre la configuration et la mémoire de discussion (sauvegardez main-config.jsonc si vous voulez le garder).",
	uninstallCmd: "dsh plugin --profile {profile} remove dsh-pet"
};

//#endregion
//#region src/client/settings/locales/ja.ts
const ja = {
	nav: "デスクトップペット設定",
	intro: "複數のペットを管理できます。ペットごとにサイズと位置を個別に設定できます（儲存するとすぐに反映されます）。",
	petCardTitle: "ペットの設定",
	petCardHint: "ペットごとに個別設定します：名前 / サイズ / 表示位置 / 位置 / オフセット / 4つの機能スイッチ。設定後、最下部の「儲存」をクリックするとすぐに反映されます。",
	globalTitle: "グローバルスイッチ",
	globalHint: "すべてのペットに共通です（pet pack は自身の種類ファイルで個別に上書きできます）。これらのスイッチはローカル狀態のみを変更し、「儲存」時にまとめてユーザー設定へ書き込みます（即時書き込みはしません）。システム通知の設定は儲存後すぐに再読み込みされ、ページの更新は不要です。",
	cornerHint: "ペットが畫面のどの隅に貼り付くかを指定します（デスクトップでは各ディスプレイのワークエリア基準）。",
	marginXHint: "選択した隅からの水平距離（px）。任意の數値が使えます。",
	marginYHint: "選択した隅からの垂直距離（px）。任意の數値が使えます。",
	"cmd.chat": "チャット",
	"cmd.pet": "ペット",
	"cmd.balance": "殘高",
	"shortcut.open": "ペット会話を開く",
	"shortcut.chat": "会話ウィンドウを開く",
	"shortcut.hear": "音聲入力",
	"shortcut.capture": "スクリーンショットを会話へ",
	shortcutCardTitle: "ショートカット",
	shortcutCardHint: "開くと 2 グループに分かれます：ペットのショートカットとグローバルショートカット。",
	shortcutRowChat: "会話を開く",
	shortcutRowHold: "押して話す",
	shortcutRowHear: "音聲入力",
	shortcutRowCapture: "スクリーンショット",
	shortcutRowPaste: "畫像を貼り付け",
	shortcutRowTodo: "ToDo",
	shortcutRowSleep: "寢る / 起きる",
	shortcutRowDisplay: "表示位置",
	shortcutRowSidebar: "サイドバーの会話を開く",
	shortcutGroupPet: "ペットのショートカット",
	shortcutGroupPetHint: "Web はポインタをペットに合わせるだけ。デスクトップペットのウィンドウは、先にペットをクリックしてキーボードフォーカスを移してください。",
	shortcutGroupGlobal: "グローバルショートカット",
	shortcutGroupGlobalHint: "Web とデスクトップ版のウィンドウでは DSH が振り分けます。設定 → 一般 → ショートカットで変更できます。",
	petsLabel: "ペット一覧",
	add: "ペットを追加",
	remove: "削除",
	confirmRemove: "ペット「{id}」を削除しますか？",
	confirmTitle: "操作の確認",
	cancel: "キャンセル",
	ok: "了解",
	atLeastOne: "ペットは少なくとも1匹必要です。",
	emptyPets: "ペットがありません。「ペットを追加」をクリックして作成してください。",
	sizeLabel: "サイズ（幅 px）",
	sizeHint: "高さは自動 = 幅 × 9/16。",
	sizePercentLabel: "畫面幅の上限（%）",
	sizePercentHint: "ペットが畫面幅のどれだけを占めるかの上限です。100 = 畫面幅を超えない（広いウィンドウでは px と完全に同じ）；30–40 にすると PC はそのままにスマホで明確に小さくなります。読み込み時に一度だけ計算されるので、ウィンドウサイズを変えたら再読み込みしてください。",
	nameLabel: "名前",
	nameHint: "表示名：ペットにマウスを重ねると表示され、AI のペルソナにも追加されます（あなたの名前は X）。重複も可能です。空欄の場合はペット id が使われます。",
	personaLabel: "ペルソナ（任意）",
	personaHint: "このペットだけに適用されます。空欄 = 所屬するエントリのペルソナに従います（入力欄のグレーの文字がその內容です）。実際にモデルへ送る system = このテキスト + 自動追加される「あなたの名前は“<名前>”」+ 現在時刻のコンテキスト。ここに名前や日付を再度書かないでください。",
	personaCount: "{n} 文字",
	balanceEnabled: "殘高機能",
	balanceEnabledHint: "有効にすると、このペットが殘高アニメーションを再生し、殘高バブルを表示します。",
	whisperEnabled: "ひとりごと",
	whisperEnabledHint: "有効にすると、このペットが定期的に AI で一言を生成し、ひとりごとアニメーションを再生します（ペルソナは下の「ペルソナ」欄。空欄ならエントリに従います）。",
	workStatusEnabled: "作業狀態の連動",
	workStatusEnabledHint: "有効にすると、このペットが DSH の作業狀態に追従します：思考中 / 作業中 / 確認待ち / 完了 / エラー時に、対応するアニメーションへ切り替えてバブルを表示します（アニメーションプールは設定のトップレベル。監視のみでモデルは呼び出しません）。",
	fixedEnabled: "ペットを固定",
	fixedEnabledHint: "有効にすると、ランダムアニメーションでペットが方向転換したり歩き去ったりしなくなり、その場の待機とランダムな小さな動作だけを再生します。右クリックメニューからの再生、API トリガー、殘高 / ひとりごと / 作業狀態のアニメーションには影響しません。",
	displayLabel: "表示位置",
	displayHint: "web=ブラウザのみ / desktop=デスクトップのみ / both=両方 / none=どちらも非表示",
	"display.web": "ブラウザのみ",
	"display.desktop": "デスクトップのみ",
	"display.both": "両方に表示",
	"display.none": "どちらも非表示",
	cornerLabel: "位置",
	"corner.top-left": "左上",
	"corner.top-right": "右上",
	"corner.bottom-left": "左下",
	"corner.bottom-right": "右下",
	marginX: "水平オフセット",
	marginY: "垂直オフセット",
	save: "儲存",
	saveHotkey: "Ctrl+S / Cmd+S",
	sync: "同期",
	confirmSync: "同期しますか？プロジェクト內蔵のデフォルト設定（全フィールド + コメント）でユーザー設定を上書きするため、現在のカスタマイズ內容は失われます。",
	corruptTitle: "ユーザー設定が破損しているため儲存されませんでした",
	corruptConfirm: "強制儲存",
	corruptBody: "ユーザー設定ファイルを解析できません（內容が破損しており、正しい JSON/JSONC ではありません）：{path}。儲存を続けるとホワイトリストに従ってこのファイルを再構築します——現在このファイルにある內容（animations / physics / memes などのカスタムフィールド）はすべて失われます。キャンセル = ファイルを変更しない（設定を正しい形式に戻してから儲存）；確認 = 強制儲存（ファイル內の既存內容を破棄）。",
	syncHint: "「同期」はプロジェクト內蔵のデフォルト設定（コメントとすべての高度なフィールドを含む）をユーザー設定ファイルへ書き込み、現在のカスタマイズ內容を上書きします。その後はこのファイルを直接編集できます。註意點が2つあります：① ファイルが一度生成されると明示的な上書きレイヤーになるため、プラグイン更新後の內蔵デフォルトの変更は自動では反映されません（再度同期するか、ファイルを削除するまで）。② このページで「儲存」をクリックすると、ホワイトリストに従ってファイルが書き換えられます（フィールド値は保持されますが、コメントは削除されます）。",
	configMeta: "詳細設定（ファイル）",
	configMetaHint: "ユーザー設定はペット一覧 / アニメーションプール / 再生ウェイトを上書きできます。変更後は更新または再起動で反映されます：ブラウザではページを更新、デスクトップではペットを右クリック →「設定を再読み込み」（すべてのデスクトップペットウィンドウを再読み込み）。デフォルト設定が完全なリファレンスです。",
	defaultConfig: "デフォルト設定（読み取り専用、完全なリファレンス）",
	userConfig: "ユーザー設定（カスタム上書き）",
	todosFile: "ToDo データ（リストの內容、期限、完了狀態。削除すると ToDo がすべて消えます）",
	animationDir: "アニメーション素材ディレクトリ（アニメーションをカスタマイズ / 追加できます）",
	memesDir: "ミーム畫像ディレクトリ（畫像をカスタマイズ / 追加できます）",
	logFile: "ログファイル（トラブルシューティング用。消去しても問題ありません）",
	logFileNote: "デスクトップ版にはコンソールがないため、プラグインの実行ログ（起動、デスクトップペットのクラッシュ / 再起動、エラーと警告）はすべてこの1つのファイルに書き込まれます。問題を報告する際はこのファイルを添付してください。1ファイルあたり最大 1 MB で、いっぱいになると最新の 512 KB だけが殘ります。",
	saved: "儲存しました。ペットにすぐ反映されました。",
	loadError: "設定の読み込みに失敗しました",
	saveError: "設定の儲存に失敗しました。サーバー接続、設定ディレクトリの書き込み権限、サーバーログを確認してください。",
	saveInvalid: "設定の儲存に失敗しました：設定內容が無効です。確認してから再試行してください。",
	syncError: "設定の同期に失敗しました。サーバー接続と設定ディレクトリの書き込み権限を確認してください。",
	loading: "設定を読み込み中…",
	retry: "再試行",
	invalid: "入力を確認してください：サイズは正の數、餘白は任意の數値です。",
	busy: "儲存中…",
	extraPetsHint: "ほかに {n} 種類が pet/ ディレクトリのファイル（<名>-config.json + <名>-animation/）から読み込まれます。上の「種類」バーで切り替えて変更できます。儲存は各キャラクターパックの設定に書き戻され、main-config.jsonc には混ざりません。",
	kindLabel: "種類",
	kindMain: "內蔵",
	lastOfKind: "「{entry}」はこの1匹だけです。削除するとこの種類自體がなくなります。完全に削除するには、そのキャラクターパックのファイルを直接削除してください。",
	savePartial: "メインペットは儲存されましたが、{names} を書き戻せませんでした：そのキャラクターパックの設定が正しいか、ディレクトリが書き込み可能かを確認してください。",
	notifyToggle: "システム通知",
	notifyToggleHint: "会話の完了 / 生成失敗 / 権限リクエスト / ユーザーへの確認を、ウィンドウが非アクティブのときに OS レベルの通知（デスクトップ右下）で表示します。",
	clickSoundToggle: "クリック音",
	clickSoundToggleHint: "ペットをクリックすると內蔵の効果音（assets/sound/click-duck.wav、音量 0.5）が一度鳴ります。100ms 以內の連続クリックは1回だけ鳴り、複數起動しても重なりません。オフにすると完全に無音になります。「儲存」と一緒にユーザー設定へ書き込まれます。",
	whisperImageToggle: "ひとりごとの畫像",
	whisperImageToggleHint: "ひとりごとのとき、ミーム畫像プールからランダムに1枚を選び、その一言と一緒に表示します（畫像のマッピングは設定ファイルのトップレベル memes）。トークン：ひとりごとは元々毎回モデルを呼ぶので、選んだ畫像の名前 + 説明（約100文字 / ≈60トークン）を同じリクエストに加えるだけで、増分はごくわずかです。",
	chatImageToggle: "チャットの畫像",
	chatImageToggleHint: "チャット時、AI が現在の文脈に合う畫像をミーム畫像プールから1枚選びます（選ばないこともできます。畫像のマッピングは設定ファイルのトップレベル memes）。トークン：メッセージごとに一覧全體をリクエストに添付するため、現在約 1.1k 文字（≈650トークン、ひとりごと畫像の約11倍）で、畫像の數に比例して増えます。オフにすると1文字も添付しません。",
	chatAnimationToggle: "チャットのアクション",
	chatAnimationToggleHint: "オンにすると、チャット時に演じられるアニメーション一覧（animations.categories の全アクション）をモデルに渡します。この一言が実際にその動作を演じているとモデルが判斷したときだけ、ペットがその場で演じます。合うものがなければ文字だけの返答になります。トークン：メッセージごとに一覧全體を添付します。オフなら 1 つも添付しません。グローバル既定で全ペット共通（pet pack は自分の設定ファイルで上書き可）。",
	confineToggle: "現在の畫面に固定",
	confineToggleHint: "マルチディスプレイの場合：オンにすると、ペットは現在いる畫面の中だけで動きます。投げたペットは離したときの畫面內でだけ跳ね（畫面の境目は壁として扱われ、隣の畫面へは飛びません）、自動での徘徊も現在いる畫面內だけを歩きます（境目を越える一歩はその場でキャンセル）。オフにすると従來どおり畫面をまたいで飛んだり歩いたりします。デスクトップモードのみに影響します。ブラウザのオーバーレイは元々ビューポート內だけで動きます。",
	trayToggle: "システムトレイ",
	trayToggleHint: "デスクトップモード起動後、通知領域（macOS ではメニューバー）にアイコンを常駐させ、設定に含まれるすべてのペットを一覧表示します。チェックを入れると、そのペットの表示位置を切り替えられます——現在デスクトップに表示されておらず、右クリックできるウィンドウがないペットも含みます。オフにすると、ペットをデスクトップに戻すにはブラウザで設定ページを開くか、Web 側のペットを右クリックするしかありません。Windows では元々「隠れたアイコン」に折りたたまれます。デスクトップモードのみに影響します。",
	voiceTitle: "音聲読み上げ",
	voiceHint: "ペットが音を出すための3つのスイッチと聲質：マスタースイッチが自動読み上げを制禦し、2つのサブスイッチがそれぞれ異なる種類の自発メッセージを制禦します。デフォルトはすべてオフで、「儲存」時にユーザー設定へ書き込まれます（即時書き込みはしません）。",
	voiceEnabled: "音聲読み上げ",
	voiceEnabledHint: "自動読み上げのマスタースイッチです。オフにすると、定期的なひとりごとと ToDo リマインダーは読み上げません（下の2つのサブスイッチは無効になります）。手動のひとりごと、チャットの返信、チャットパネルのスピーカーボタンは制限されません——これらはあなたが明示的に操作したもので、操作した畫面側がそのまま読み上げます。「聲を出すかどうか」だけに影響します：バブル、会話メモリ、システム通知は変わりません。音聲合成に失敗した場合はログに殘すだけで、会話を中斷しません。",
	voiceWhisperEnabled: "ひとりごとの読み上げ",
	voiceWhisperEnabledHint: "定期的に生成されるひとりごとを読み上げます（右クリックの手動ひとりごとはこの項目の影響を受けません）。上のマスタースイッチに従います：マスタースイッチがオフのときはこの項目は無効です。デフォルトはオフ——ひとりごとは背景ナレーションなので、デフォルトで聲を出すべきではありません。",
	voiceTodoEnabled: "ToDo の読み上げ",
	voiceTodoEnabledHint: "期限が來た ToDo リマインダーを読み上げます（同じ文言でバブルも表示され、この項目は読み上げるかどうかだけを決めます）。上のマスタースイッチに従います。デフォルトはオフです。",
	voiceNameLabel: "聲質",
	voiceVolumeLabel: "音量",
	voiceVolumeHint: "読み上げの音量（0〜1 の小數）。1 が最大音量（100%）、0 は消音です。変わるのは再生の大きさだけで、音聲の再合成は行いません。上の総スイッチとは別の設定で、総スイッチが切のときは効果がありません。",
	physicsTitle: "物理（ドラッグ＆投げの感觸）",
	physicsHint: "グローバルデフォルトで、すべてのペットに共通です（pet pack は自身の種類ファイルで個別に上書きできます）。「儲存」時にユーザー設定へ書き込まれます（即時書き込みはしません）。ブラウザでは儲存後すぐに反映され、デスクトップでは儲存でペットウィンドウが再読み込みされてから反映されます。",
	mobileTitle: "モバイル向け効果",
	mobileHint: "スマホのブラウザでのみ意味があります。振動にはモーター、2 つの體感スイッチには傾き／加速度センサーが必要で、センサーは HTTPS または localhost でのみ使えます。",
	"physics.gravity": "重力",
	"physics.gravityHint": "px/s²。大きいほど速く落下します。0 = 無重力（投げると等速直線運動で飛び続けます）",
	"physics.restitution": "弾性",
	"physics.restitutionHint": "0～1。壁や床に當たったときに殘る速度の割合（1 = 完全弾性、0 = 當たった瞬間に停止）",
	"physics.groundFriction": "接觸摩擦",
	"physics.groundFrictionHint": "/s。壁・床・天井に當たった後の接線方向の速度の減衰率。0 = どの面も氷のよう",
	"physics.throwPower": "投げる力",
	"physics.throwPowerHint": "> 0。バネの追従性と投げ出しの初速の全體倍率（1 = デフォルト。大きいほどよく追従し、勢いよく飛びます）",
	physicsCeilingBounce: "天井での跳ね返り",
	physicsCeilingBounceHint: "オフにすると、投げたペットが畫面の上端を越えて飛び出せます（重力が引き戻します）",
	physicsPetCollision: "ペット同士の衝突",
	physicsPetCollisionHint: "飛行中のペットが他のペットに當たると、運動量儲存に従って弾き返されます（質量 ∝ サイズ²）",
	physicsHaptic: "衝突時の振動",
	physicsHapticHint: "壁・床・天井・ペット同士の衝突ごとに 1 回振動します。Chrome / Edge で動作。iOS と Via のような WebView ブラウザでは無効。サイレント/集中モードは振動を止めます。",
	physicsTilt: "傾きで重力",
	physicsTiltHint: "端末を傾けると重力がそちらへ向かいます（大きさは上の重力値）。重力が 0 のときは傾けても効果がありません。HTTPS/localhost が必要です。",
	physicsShake: "振って投げる",
	physicsShakeHint: "振った方向へペットを飛ばします。強さは投げる力（throwPower）に比例し、重力とは無関係なので重力 0 でも使えます。HTTPS/localhost が必要です。",
	invalidPhysics: "物理パラメータを確認してください：重力 / 地面摩擦 ≥ 0、弾性 0～1、投げる力 > 0。",
	fontTitle: "外観とフォント",
	fontHint: "フォントの種類は、現在キャンディフォントを使用しているすべてのテキストに適用されます：ペットのバブル、ホバーツールチップ、チャットウィンドウ、スコアポップアップ。文字サイズはペットのバブルとホバーツールチップだけに適用されます（チャットウィンドウとスコアポップアップの文字サイズは変わりません）。グローバルデフォルトで、すべてのペットに共通です（pet pack は自身の種類ファイルで個別に上書きできます）。「儲存」時にユーザー設定へ書き込まれ、ブラウザでは儲存後すぐに反映、デスクトップでは儲存でペットウィンドウが再読み込みされてから反映されます。",
	fontFamilyLabel: "フォント",
	fontFamilyHint: "「キャンディフォント（內蔵）」はプラグインに同梱されています。それ以外はシステムフォントで、このマシンにインストールされていない場合はフォントスタックの次のものへ自動的にフォールバックします（空白になったりエラーになったりはしません）。",
	fontSizeLabel: "文字サイズ（px）",
	fontSizeHint: "バブル本文の文字サイズ。ツールチップとバブル內の小さい文字は既存の比率で算出されます。範囲は 4～200。",
	fontFollowToggle: "文字サイズをペットの大きさに合わせて拡大縮小",
	fontFollowToggleHint: "オン（デフォルト）：ペットを大きくすると文字サイズも比例して大きくなり、幅 462 のときに上の設定値と一致します。オフ：文字サイズは一定で、ペットの大きさに左右されません。",
	invalidFont: "フォント設定を確認してください：フォントはドロップダウンリスト內、文字サイズは 4～200 の數値である必要があります。",
	"font.candy": "キャンディフォント（內蔵）",
	"font.yahei": "Microsoft YaHei / PingFang",
	"font.youyuan": "YouYuan",
	"font.kaiti": "KaiTi",
	"font.simsun": "SimSun",
	"font.comic": "Comic Sans MS",
	"font.system": "システムデフォルト",
	modelTitle: "会話とモデル",
	modelHint: "ひとりごととチャットがそれぞれどのモデルを使うか、またチャットが毎回何ラウンドの履歴をコンテキストに含めるか。「現在の会話に従う」= 現在の会話で使っているモデルを使用（デフォルト）。グローバルデフォルト：すべてのペットに適用され、pet pack は自身の種類ファイルで個別に上書きできます。選択肢は DSH のモデルピッカーと同じソースからホストがリアルタイムに提供します。",
	modelFollow: "現在の会話に従う",
	modelSearch: "モデルを検索…",
	modelEmpty: "一致するモデルがありません。",
	modelNoModels: "利用できるモデルがありません。",
	modelLoading: "モデル一覧を更新中…",
	modelTriggerAria: "モデルを選択（現在 {model}）",
	modelUnknown: " （現在の設定、一覧にありません）",
	modelNone: "このプロバイダーに利用できるモデルはありません",
	whisperModelLabel: "ひとりごとモデル",
	chatModelLabel: "チャットモデル",
	modelFieldHint: "「現在の会話に従う」= 現在の会話のモデルを使用。指定しても呼び出しに失敗した場合は、現在の会話のモデルへ自動的にフォールバックして1回再試行します。",
	invalidModel: "モデル設定を確認してください：プロバイダーとモデルは両方選択するか、両方空欄（現在の会話に従う）にしてください。",
	modelCatalogFailed: "モデル一覧の読み込みに失敗しました（ページを更新すると再試行できます）。現在の設定値はそのまま保持されます。",
	chatMemory: "会話履歴のラウンド數",
	chatMemoryHint: "各チャットリクエストに含める直近の履歴ラウンド數（1ラウンド = 1問1答。0 = 履歴なしで、毎回まったく新しい会話）。会話メモリ自體はすべて儲存され、削除されません。この値はコンテキストに何ラウンド分を含めるかだけを決めます——大きいほどよく覚えていますが、トークンも多く消費します。グローバルデフォルトで、すべてのペットに共通です（pet pack は自身の種類ファイルで個別に上書きできます）。",
	invalidChatMemory: "会話履歴のラウンド數を確認してください：0 以上の數値である必要があります。",
	chatImageLimit: "チャット畫像の上限枚數",
	chatImageLimitHint: "チャット時にモデルへ送るミーム畫像一覧の最大枚數（「先頭 N 枚」= 設定の先頭に書いた N 件。優先して送りたい畫像は順番を前にしてください）。一覧全體はメッセージごとに添付され、トークンは枚數に比例して増えるため、多いとそのままコストになります。先頭 N 枚に制限すると、モデルはその中からだけ選びます。0 = 制限なし（すべて送信）。內蔵デフォルトは 10。グローバルデフォルトで、すべてのペットに共通です（pet pack は自身の種類ファイルで上書きできます）。影響するのはチャットの畫像選択だけです：ひとりごとは選んだ1枚だけを含めます。",
	invalidChatImageLimit: "チャット畫像の上限枚數を確認してください：0 以上の數値である必要があります（0 = 制限なし）。",
	notifyTest: "テスト通知",
	notifyTestOk: "テスト通知を送信しました。デスクトップの右下を確認してください。",
	notifyDenyUnsupported: "この環境ではシステム通知がサポートされていません（ブラウザに Notification API がありません）。",
	notifyDenyBlocked: "通知権限がブラウザによって「ブロック」に設定されています。",
	notifyDenyRejected: "権限確認のダイアログで「ブロック」を選択しました。",
	notifyDenyError: "権限の要求中にエラーが発生しました",
	notifyGuide: "ガイド：アドレスバー左側の 🔒/ⓘ →「サイトの設定」→「通知」→「許可」に変更し、ページを更新してから再試行してください。",
	storageTitle: "アンインストールとストレージ",
	storageHint: "プラグインがこの PC 上に作成されるすべての場所です。キャッシュを削除しても使用に影響はありません（自動的に再ダウンロード / 再構築されます）。「プラグインのユーザーデータ」を削除すると、設定と会話メモリが失われます。",
	"storage.userData": "プラグインのユーザーデータ：カスタム設定 main-config.jsonc、会話メモリ memory.json、カスタムアニメーション素材 main-animation/、ファイル型ペット pet/",
	"storage.electron": "デスクトップペットが使う Electron ランタイム（サイズが大きい。削除すると次回デスクトップモード起動時に自動で再ダウンロードされます）",
	"storage.desktopCache": "デスクトップペットウィンドウのキャッシュとメインディスプレイのスケールキャッシュ（削除しても問題ありません。自動で再構築されます）",
	"storage.electronCache": "Electron インストーラーのダウンロードキャッシュ（削除しても問題ありません。必要時に再ダウンロードされます）",
	"storage.package": "プラグイン本體（DSH が管理します。手動で削除せず、下のアンインストールコマンドで削除してください）",
	storageMissing: " （未作成）",
	uninstallTitle: "アンインストール方法",
	uninstallStep1: "1. まず DSH を終了します（デスクトップペットも一緒に終了します）。ペットの実行中に上記のファイルを削除しないでください。",
	uninstallStep2: "2. プラグイン本體を削除します（ターミナルで実行します。profile の bundle レイヤーからも同時に削除されます）：",
	uninstallStep3: "3. 上記の場所を必要に応じて削除します：キャッシュは削除しても影響ありません。「プラグインのユーザーデータ」を削除すると設定と会話メモリが失われます（殘したい場合は中の main-config.jsonc を先にバックアップしてください）。",
	uninstallCmd: "dsh plugin --profile {profile} remove dsh-pet"
};

//#endregion
//#region src/client/settings/locales/pt.ts
const pt = {
	nav: "Configuração do pet",
	intro: "Gerencie vários pets: cada um tem tamanho e posição próprios (aplicado na hora após salvar).",
	petCardTitle: "Pet",
	petCardHint: "Ajustes por pet: nome / tamanho / exibição / posição / deslocamentos / os quatro interruptores. Clique em \"Salvar\" no fim para aplicar na hora.",
	globalTitle: "Interruptores globais",
	globalHint: "Compartilhados por todos os pets (um pet pack pode sobrescrevê-los no arquivo do próprio tipo). Estes interruptores só mudam o estado local e são gravados na configuração do usuário ao \"Salvar\" (nunca na hora); as notificações do sistema são relidas logo após salvar, sem recarregar a página.",
	cornerHint: "Em qual canto da tela o pet fica (no desktop, conforme a área de trabalho de cada monitor).",
	marginXHint: "Distância horizontal até o canto escolhido (px); qualquer número.",
	marginYHint: "Distância vertical até o canto escolhido (px); qualquer número.",
	"cmd.chat": "Conversa",
	"cmd.pet": "Pet",
	"cmd.balance": "Saldo",
	"shortcut.open": "Abrir o chat do pet",
	"shortcut.chat": "Abrir a janela de chat",
	"shortcut.hear": "Entrada de voz",
	"shortcut.capture": "Captura de tela para o chat",
	shortcutCardTitle: "Atalhos",
	shortcutCardHint: "Ao expandir há dois grupos: atalhos do pet e atalhos globais.",
	shortcutRowChat: "Abrir chat",
	shortcutRowHold: "Segurar para falar",
	shortcutRowHear: "Entrada de voz",
	shortcutRowCapture: "Captura de tela",
	shortcutRowPaste: "Colar imagem",
	shortcutRowTodo: "Tarefas",
	shortcutRowSleep: "Dormir / acordar",
	shortcutRowDisplay: "Posição de exibição",
	shortcutRowSidebar: "Abrir chat lateral",
	shortcutGroupPet: "Atalhos do pet",
	shortcutGroupPetHint: "Na web basta passar o ponteiro sobre o pet. Na janela do desktop, clique no pet primeiro para ele receber o foco do teclado.",
	shortcutGroupGlobal: "Atalhos globais",
	shortcutGroupGlobalHint: "São distribuídos pelo DSH na web e na janela do desktop; mudam em Configurações → Geral → Atalhos.",
	petsLabel: "Pets",
	add: "Adicionar pet",
	remove: "Remover",
	confirmRemove: "Excluir o pet \"{id}\"?",
	confirmTitle: "Confirmar ação",
	cancel: "Cancelar",
	ok: "Entendi",
	atLeastOne: "Mantenha pelo menos um pet.",
	emptyPets: "Nenhum pet ainda — clique em \"Adicionar pet\" para criar.",
	sizeLabel: "Tamanho (largura px)",
	sizeHint: "A altura é automática = largura × 9/16.",
	sizePercentLabel: "Largura máx. da tela (%)",
	sizePercentHint: "Quanto da largura da tela o pet pode ocupar: 100 = nunca mais largo que uma tela (igual ao px em janelas largas); 30–40 deixa bem menor no celular sem mudar o desktop. Calculado uma vez ao carregar; recarregue após redimensionar.",
	nameLabel: "Nome",
	nameHint: "Nome exibido ao passar o mouse e incluído na persona da IA (\"seu nome é X\"). Pode repetir; vazio usa o id do pet.",
	personaLabel: "Persona (opcional)",
	personaHint: "Vale só para este pet. Vazio = segue a persona da entrada — o texto cinza na caixa é exatamente isso. O system enviado ao modelo = este texto + uma linha \"seu nome é <nome>\" anexada automaticamente + o contexto de hora atual, então não repita o nome nem a data aqui.",
	personaCount: "{n} caracteres",
	balanceEnabled: "Saldo",
	balanceEnabledHint: "Quando ativado, este pet toca as animações de saldo e mostra o balão de saldo.",
	whisperEnabled: "Sussurro",
	whisperEnabledHint: "Quando ativado, este pet gera uma frase com IA periodicamente e toca a animação de sussurro (persona = o campo abaixo; vazio segue a entrada).",
	workStatusEnabled: "Status de trabalho",
	workStatusEnabledHint: "Quando ativado, este pet segue o estado de trabalho do DSH: pensando / trabalhando / aguardando confirmação / concluído / erro trocam a animação e mostram balões (o pool fica na configuração de topo; apenas escuta, sem chamar o modelo).",
	fixedEnabled: "Fixar no lugar",
	fixedEnabledHint: "Quando ativado, a cadeia aleatória não gira nem afasta mais este pet — só tocam as ações de espera no lugar. Escolhas pelo menu de contexto, gatilhos da API e animações de saldo / sussurro / status de trabalho não são afetadas.",
	displayLabel: "Exibição",
	displayHint: "web = só no navegador / desktop = só no desktop / both = nos dois / none = em nenhum",
	"display.web": "Só no navegador",
	"display.desktop": "Só no desktop",
	"display.both": "Nos dois",
	"display.none": "Em nenhum",
	cornerLabel: "Posição",
	"corner.top-left": "Canto superior esquerdo",
	"corner.top-right": "Canto superior direito",
	"corner.bottom-left": "Canto inferior esquerdo",
	"corner.bottom-right": "Canto inferior direito",
	marginX: "Deslocamento horizontal",
	marginY: "Deslocamento vertical",
	save: "Salvar",
	saveHotkey: "Ctrl+S / Cmd+S",
	sync: "Sincronizar",
	confirmSync: "Sincronizar? Isso sobrescreve a configuração do usuário com a configuração padrão incluída no projeto (todos os campos + comentários); as personalizações atuais serão perdidas.",
	corruptTitle: "A configuração do usuário está corrompida — não salva",
	corruptConfirm: "Salvar mesmo assim",
	corruptBody: "Não foi possível ler a configuração do usuário (conteúdo corrompido, não é JSON/JSONC válido): {path}. Salvar agora recria o arquivo a partir da lista branca — tudo o que está nele hoje (animações / física / memes etc.) será perdido. Cancelar = não mexe no arquivo (corrija e salve de novo); Confirmar = salva mesmo assim (descarta o conteúdo atual do arquivo).",
	syncHint: "\"Sincronizar\" grava a configuração padrão incluída no projeto (com comentários e todos os campos avançados) no arquivo do usuário, sobrescrevendo suas personalizações; depois disso o arquivo já pode ser editado direto. Dois avisos: (1) uma vez criado, o arquivo é uma camada de sobrescrita explícita — mudanças nos padrões do projeto não passam a valer sozinhas (só sincronizando de novo ou apagando o arquivo); (2) clicar em \"Salvar\" nesta página reescreve o arquivo pela lista branca — os valores são mantidos, os comentários são removidos.",
	configMeta: "Configuração avançada (arquivos)",
	configMetaHint: "A configuração do usuário pode sobrescrever a lista de pets / pools de animação / pesos — recarregue ou reinicie para aplicar: no navegador atualize a página, no desktop clique com o botão direito no pet → \"Recarregar configuração\" (recria todas as janelas de pet do desktop); a configuração padrão é a referência completa.",
	defaultConfig: "Configuração padrão (somente leitura, referência completa)",
	userConfig: "Configuração do usuário (sobrescritas personalizadas)",
	todosFile: "Dados de tarefas (texto, prazo e estado de conclusão; apagar equivale a limpar tudo)",
	animationDir: "Pasta de animações (adicione ou personalize animações aqui)",
	memesDir: "Pasta de memes (adicione ou personalize imagens aqui)",
	logFile: "Arquivo de log (para diagnóstico; pode ser limpo)",
	logFileNote: "O app desktop do DSH não tem console, então todo log de execução do plugin (inicialização, travamentos e reinícios do pet, erros e avisos) vai para este único arquivo — anexe-o ao relatar um problema. Limite de 1 MB por arquivo; ao encher, só os 512 KB mais recentes são mantidos.",
	saved: "Salvo — os pets atualizaram na hora.",
	loadError: "Falha ao carregar a configuração",
	saveError: "Falha ao salvar a configuração. Verifique a conexão com o servidor, a permissão de escrita na pasta de configuração e o log do servidor.",
	saveInvalid: "Falha ao salvar a configuração: conteúdo inválido. Revise os valores e tente de novo.",
	syncError: "Falha ao sincronizar a configuração. Verifique a conexão com o servidor e a permissão de escrita na pasta de configuração.",
	loading: "Carregando configuração…",
	retry: "Tentar de novo",
	invalid: "Revise os valores: o tamanho precisa ser positivo; as margens podem ser qualquer número.",
	busy: "Salvando…",
	extraPetsHint: "Mais {n} tipo(s) vêm de arquivos na pasta pet/ (<nome>-config.json + <nome>-animation/). Troque para eles na linha \"Tipos\" acima; salvar grava no config de cada pacote, nunca no main-config.jsonc.",
	kindLabel: "Tipos",
	kindMain: "Embutido",
	lastOfKind: "\"{entry}\" tem só este pet — excluí-lo remove o tipo inteiro. Para remover de vez, apague os arquivos do pet pack.",
	savePartial: "Os pets principais foram salvos, mas {names} não pôde ser gravado: verifique se o config do pacote é válido e se a pasta permite escrita.",
	notifyToggle: "Notificações do sistema",
	notifyToggleHint: "Avisos do sistema (canto inferior direito do desktop) para fim de conversa, falhas, pedidos de permissão e perguntas — só enquanto esta janela está sem foco.",
	clickSoundToggle: "Som de clique",
	clickSoundToggleHint: "Toca o som de clique embutido (assets/sound/click-duck.wav, volume 0.5) quando o pet é clicado; cliques repetidos em até 100ms tocam uma vez só, então vários pets não empilham som. Desligue para silêncio total. Gravado na configuração do usuário junto com o \"Salvar\".",
	whisperImageToggle: "Imagens no sussurro",
	whisperImageToggleHint: "Anexa um meme aleatório do pool a cada sussurro (o mapeamento de imagens fica no campo de topo memes). Tokens: o sussurro já chama o modelo a cada ciclo, então a imagem só acrescenta o nome + a descrição daquele meme (~100 caracteres / ~60 tokens) ao mesmo pedido — desprezível.",
	chatImageToggle: "Imagens na conversa",
	chatImageToggleHint: "Deixa a IA escolher um meme do pool conforme o contexto atual (opcional; o mapeamento fica no campo de topo memes). Tokens: cada mensagem leva o catálogo inteiro — hoje ~1,1 mil caracteres (~650 tokens, cerca de 11x o caso do sussurro) e cresce com o número de imagens; desligado, não acrescenta nada.",
	chatAnimationToggle: "Ações na conversa",
	chatAnimationToggleHint: "Quando ligado, o pedido de conversa leva a lista de animações que podem ser encenadas (todas as ações de animations.categories): se o modelo considerar que a frase realmente encena uma delas, o pet a executa na hora; caso contrário responde só com texto. Tokens: cada mensagem leva a lista inteira; desligado não acrescenta nada. Valor padrão global para todos os pets (um pet pack pode substituí-lo no próprio arquivo de configuração).",
	confineToggle: "Fixar na tela atual",
	confineToggleHint: "Vários monitores: quando ligado, o pet fica dentro da tela em que está — um pet arremessado quica só na tela onde foi solto (as emendas entre telas viram paredes, ele não voa para a tela vizinha), e o passeio autônomo só anda dentro da tela atual (o passo que cruzaria a emenda é cancelado). Desligado, ele cruza telas normalmente. Só afeta o modo desktop — o overlay do navegador já fica dentro da viewport.",
	trayToggle: "Bandeja do sistema",
	trayToggleHint: "Mostra um ícone na área de notificação (barra de menus no macOS) quando o modo desktop inicia. Ele lista todos os pets da configuração e alterna a exibição de cada um — inclusive os que estão fora do desktop agora e não têm janela para clicar com o botão direito. Sem ele, para trazer um pet de volta ao desktop é preciso abrir o navegador (a página de configuração, ou clicar com o botão direito no pet na web). O Windows já esconde ícones de terceiros na gaveta \"ícones ocultos\". Só afeta o modo desktop.",
	voiceTitle: "Voz",
	voiceHint: "Três interruptores e uma voz: o mestre controla a fala automática; os dois secundários controlam um tipo de mensagem proativa cada. Tudo desligado por padrão; gravado na configuração do usuário ao \"Salvar\" (nunca na hora).",
	voiceEnabled: "Falar respostas",
	voiceEnabledHint: "Interruptor mestre da fala automática. Desligado, sussurros periódicos e lembretes de tarefas ficam mudos (os dois secundários abaixo não têm efeito). Sussurro manual, respostas da conversa e o botão de alto-falante do painel de conversa não são afetados — você pediu, então a origem fala direto. Só decide se sai som: balões, memória da conversa e notificações do sistema não mudam; falha na síntese só gera log e nunca interrompe a conversa.",
	voiceWhisperEnabled: "Falar sussurros",
	voiceWhisperEnabledHint: "Fala o sussurro gerado periodicamente (o sussurro manual pelo botão direito não é afetado). Dependente do interruptor mestre acima. Desligado por padrão — sussurros são narração de fundo e não devem fazer barulho sem pedir.",
	voiceTodoEnabled: "Falar lembretes de tarefas",
	voiceTodoEnabledHint: "Fala o lembrete quando uma tarefa vence (o balão continua aparecendo; isto só decide se fala). Dependente do interruptor mestre acima. Desligado por padrão.",
	voiceNameLabel: "Voz",
	voiceVolumeLabel: "Volume",
	voiceVolumeHint: "Volume de reprodução em decimal 0–1: 1 é o volume máximo (100%) e 0 silencia. Altera apenas a intensidade e não sintetiza o áudio de novo, então ajustá-lo não custa nada extra. É independente do interruptor geral acima: com ele desligado, não tem efeito.",
	physicsTitle: "Física (sensação de arrastar e arremessar)",
	physicsHint: "Padrão global, compartilhado por todos os pets (um pet pack pode sobrescrever no arquivo do próprio tipo); gravado na configuração do usuário ao \"Salvar\" (nunca na hora). No navegador vale na hora; no desktop vale quando o \"Salvar\" recarrega as janelas do pet.",
	mobileTitle: "Efeitos no celular",
	mobileHint: "Só fazem sentido no navegador do celular: a vibração precisa de motor, os dois interruptores de movimento precisam de sensores de inclinação/aceleração, e os sensores exigem HTTPS ou localhost.",
	"physics.gravity": "Gravidade",
	"physics.gravityHint": "px/s² — quanto maior, mais rápido cai; 0 = sem gravidade (voa em linha reta para sempre)",
	"physics.restitution": "Restituição",
	"physics.restitutionHint": "0–1, velocidade mantida ao quicar na parede ou no chão (1 = totalmente elástico, 0 = para na hora)",
	"physics.groundFriction": "Atrito de contato",
	"physics.groundFrictionHint": "por segundo, perda de velocidade ao longo de qualquer superfície (parede, chão, teto); 0 = gelo em todas",
	"physics.throwPower": "Força de arremesso",
	"physics.throwPowerHint": "> 0, multiplicador geral da mola que segue o cursor e da velocidade de saída (1 = padrão; maior = mais colado ao cursor e arremessos mais fortes)",
	physicsCeilingBounce: "Quicar no teto",
	physicsCeilingBounceHint: "Desligado, o arremesso pode sair pelo topo da tela (a gravidade ainda traz o pet de volta)",
	physicsPetCollision: "Colisão entre pets",
	physicsPetCollisionHint: "Um pet em voo quica nos outros com conservação de momento (massa ∝ tamanho²)",
	physicsHaptic: "Vibração ao colidir",
	physicsHapticHint: "Uma vibração por impacto (paredes, chão, teto, outros pets). Funciona no Chrome/Edge; não no iOS nem em navegadores WebView como o Via. O modo Não perturbe bloqueia o vibrador.",
	physicsTilt: "Gravidade por inclinação",
	physicsTiltHint: "Incline o celular e a gravidade acompanha (magnitude = o valor acima); com gravidade em 0 a inclinação não faz nada. Requer HTTPS/localhost.",
	physicsShake: "Sacudir para arremessar",
	physicsShakeHint: "Sacuda para arremessar o pet na direção do gesto; a força acompanha o throwPower. Independe da gravidade, então funciona com gravidade 0. Requer HTTPS/localhost.",
	invalidPhysics: "Revise os valores de física: gravidade / atrito com o chão ≥ 0, restituição 0–1, força de arremesso > 0.",
	fontTitle: "Aparência e fonte",
	fontHint: "A família vale para todo texto que hoje usa a fonte candy: balão do pet, dica ao passar o mouse, janela de conversa, popup de pontuação. O tamanho vale só para o balão do pet e a dica (as janelas de conversa e de pontuação mantêm o próprio tamanho). Padrão global, compartilhado por todos os pets (um pet pack pode sobrescrever no arquivo do próprio tipo); gravado na configuração do usuário ao \"Salvar\" — na hora no navegador, e no desktop quando o \"Salvar\" recarrega as janelas do pet.",
	fontFamilyLabel: "Fonte",
	fontFamilyHint: "\"Candy (embutida)\" vem com o plugin; as demais são fontes do sistema. Se faltar na máquina, cai para a próxima da pilha (nunca fica em branco nem dá erro).",
	fontSizeLabel: "Tamanho da fonte (px)",
	fontSizeHint: "Tamanho do texto do balão; a dica e as linhas menores dentro do balão escalam na proporção. Faixa 4–200.",
	fontFollowToggle: "Escalar a fonte com o tamanho do pet",
	fontFollowToggleHint: "Ligado (padrão): a fonte cresce com o pet — com 462 px de largura fica exatamente no tamanho definido acima. Desligado: o tamanho fica fixo, independente do pet.",
	invalidFont: "Revise as configurações de fonte: a família precisa estar na lista e o tamanho precisa ser um número entre 4 e 200.",
	"font.candy": "Candy (embutida)",
	"font.yahei": "Microsoft YaHei / PingFang",
	"font.youyuan": "YouYuan",
	"font.kaiti": "KaiTi",
	"font.simsun": "SimSun",
	"font.comic": "Comic Sans MS",
	"font.system": "Padrão do sistema",
	modelTitle: "Conversa e modelos",
	modelHint: "Qual modelo o sussurro e a conversa usam, e quanta história cada pedido de conversa carrega. \"Seguir a conversa atual\" usa o modelo da conversa em que você está (padrão). Padrão global: vale para todos os pets, e um pet pack pode sobrescrever no arquivo do próprio tipo. As opções vêm da mesma fonte do seletor de modelos do DSH, servidas pelo host em tempo real.",
	modelFollow: "Seguir a conversa atual",
	modelSearch: "Buscar modelos…",
	modelEmpty: "Nenhum modelo corresponde.",
	modelNoModels: "Nenhum modelo disponível.",
	modelLoading: "Atualizando a lista de modelos…",
	modelTriggerAria: "Escolher modelo, atual {model}",
	modelUnknown: " (configuração atual, fora da lista)",
	modelNone: "Este provedor não tem modelos disponíveis",
	whisperModelLabel: "Modelo do sussurro",
	chatModelLabel: "Modelo da conversa",
	modelFieldHint: "\"Seguir a conversa atual\" usa o modelo da conversa; se um modelo escolhido falhar, o plugin volta ao modelo da conversa e tenta mais uma vez.",
	invalidModel: "Revise as configurações de modelo: escolha provedor e modelo, ou deixe os dois vazios (seguir a conversa atual).",
	modelCatalogFailed: "Falha ao carregar a lista de modelos (atualize a página para tentar de novo); os valores atuais são mantidos como estão.",
	chatMemory: "Rodadas de histórico",
	chatMemoryHint: "Quantas rodadas recentes cada pedido de conversa carrega (1 rodada = 1 pergunta + 1 resposta; 0 = sem histórico, cada mensagem começa do zero). A memória em si guarda tudo — isto só decide quanto entra no contexto: mais memória, mais tokens. Padrão global, compartilhado por todos os pets (um pet pack pode sobrescrever no arquivo do próprio tipo).",
	invalidChatMemory: "Revise as rodadas de histórico: precisa ser um número ≥ 0.",
	chatImageLimit: "Limite de imagens na conversa",
	chatImageLimitHint: "Quantos memes no máximo são listados ao modelo na conversa (\"primeiros N\" = os N primeiros da configuração, então mova para o começo os que quer enviar). A lista inteira vai em cada mensagem e os tokens crescem linearmente com a quantidade, então lista longa é gasto puro; limitar aos N primeiros faz o modelo escolher só entre eles. 0 = sem limite (envia tudo). Padrão embutido 10. Padrão global, compartilhado por todos os pets (um pet pack pode sobrescrever no arquivo do próprio tipo). Só afeta a conversa — o sussurro leva só o meme sorteado.",
	invalidChatImageLimit: "Revise o limite de imagens na conversa: precisa ser um número ≥ 0 (0 = sem limite).",
	notifyTest: "Testar notificação",
	notifyTestOk: "Notificação de teste enviada — veja o canto inferior direito do desktop.",
	notifyDenyUnsupported: "Este ambiente não suporta notificações do sistema (sem API Notification no navegador).",
	notifyDenyBlocked: "A permissão de notificação está marcada como bloqueada pelo navegador.",
	notifyDenyRejected: "Você escolheu \"Bloquear\" na janela de permissão.",
	notifyDenyError: "Erro ao pedir permissão",
	notifyGuide: "Como liberar: clique no 🔒/ⓘ ao lado da barra de endereços → \"Configurações do site\" → \"Notificações\" → mude para \"Permitir\", atualize a página e tente de novo.",
	storageTitle: "Desinstalação e armazenamento",
	storageHint: "Todos os lugares em que o plugin grava arquivos. Apagar caches não atrapalha (são baixados ou recriados sozinhos); apagar \"dados do usuário do plugin\" perde a configuração e a memória da conversa.",
	"storage.userData": "Dados do usuário do plugin: configuração personalizada main-config.jsonc, memória da conversa memory.json, animações personalizadas main-animation/, pets de arquivo pet/",
	"storage.electron": "Runtime Electron usado pelo pet do desktop (grande; é baixado de novo automaticamente na próxima vez que o modo desktop iniciar)",
	"storage.desktopCache": "Cache das janelas do pet e cache de escala do monitor principal (pode apagar; é recriado sozinho)",
	"storage.electronCache": "Cache de download do instalador do Electron (pode apagar; é baixado de novo quando preciso)",
	"storage.package": "O plugin em si (gerenciado pelo DSH — remova com o comando abaixo em vez de apagar na mão)",
	storageMissing: " (ainda não criado)",
	uninstallTitle: "Como desinstalar",
	uninstallStep1: "1. Feche o DSH primeiro (o pet do desktop fecha junto); não apague os arquivos acima com o pet em execução.",
	uninstallStep2: "2. Remova o plugin em si (no terminal; isto também o tira da camada de bundle do profile):",
	uninstallStep3: "3. Apague os locais acima conforme a necessidade: caches não fazem falta; apagar \"dados do usuário do plugin\" perde a configuração e a memória da conversa (faça backup do main-config.jsonc antes, se quiser manter).",
	uninstallCmd: "dsh plugin --profile {profile} remove dsh-pet"
};

//#endregion
//#region src/client/settings/locales/ru.ts
const ru = {
	nav: "Настройки питомца",
	intro: "Управляйте несколькими питомцами: у каждого свои размер и позиция (применяются сразу после сохранения).",
	petCardTitle: "Питомец",
	petCardHint: "Настройки каждого питомца: имя / размер / отображение / позиция / отступы / четыре переключателя функций. Нажмите «Сохранить» внизу, чтобы применить сразу.",
	globalTitle: "Глобальные переключатели",
	globalHint: "Общие для всех питомцев (пакет питомца может переопределить их в своём файле вида). Эти переключатели меняют только локальное состояние и записываются в пользовательский конфиг по «Сохранить» (без немедленной записи); системные уведомления перечитываются сразу после сохранения, обновлять страницу не нужно.",
	cornerHint: "К какому углу экрана прикреплён питомец (в настольном режиме — рабочая область соответствующего монитора).",
	marginXHint: "Горизонтальное расстояние от выбранного угла (px); любое число.",
	marginYHint: "Вертикальное расстояние от выбранного угла (px); любое число.",
	"cmd.chat": "Чат",
	"cmd.pet": "Питомец",
	"cmd.balance": "Баланс",
	"shortcut.open": "Открыть чат питомца",
	"shortcut.chat": "Открыть окно чата",
	"shortcut.hear": "Голосовой ввод",
	"shortcut.capture": "Снимок экрана в чат",
	shortcutCardTitle: "Горячие клавиши",
	shortcutCardHint: "В раскрытом виде две группы: клавиши питомца и глобальные клавиши.",
	shortcutRowChat: "Открыть чат",
	shortcutRowHold: "Удерживать для речи",
	shortcutRowHear: "Голосовой ввод",
	shortcutRowCapture: "Снимок экрана",
	shortcutRowPaste: "Вставить изображение",
	shortcutRowTodo: "Задачи",
	shortcutRowSleep: "Спать / проснуться",
	shortcutRowDisplay: "Позиция показа",
	shortcutRowSidebar: "Открыть чат в панели",
	shortcutGroupPet: "Клавиши питомца",
	shortcutGroupPetHint: "В веб-версии достаточно навести курсор на питомца. В окне на рабочем столе сначала щёлкните питомца, чтобы он получил фокус клавиатуры.",
	shortcutGroupGlobal: "Глобальные клавиши",
	shortcutGroupGlobalHint: "Их распределяет DSH в веб-версии и в окне на рабочем столе; меняются в Настройки → Общие → Горячие клавиши.",
	petsLabel: "Питомцы",
	add: "Добавить питомца",
	remove: "Удалить",
	confirmRemove: "Удалить питомца «{id}»?",
	confirmTitle: "Подтверждение действия",
	cancel: "Отмена",
	ok: "Понятно",
	atLeastOne: "Оставьте хотя бы одного питомца.",
	emptyPets: "Питомцев пока нет — нажмите «Добавить питомца», чтобы создать.",
	sizeLabel: "Размер (ширина, px)",
	sizeHint: "Высота рассчитывается автоматически = ширина × 9/16.",
	sizePercentLabel: "Макс. ширина экрана (%)",
	sizePercentHint: "Какую долю ширины экрана может занимать питомец: 100 = не шире одного экрана (на широких окнах полностью совпадает с px); 30–40 заметно уменьшит его на телефоне, не меняя десктоп. Вычисляется один раз при загрузке; после изменения размера окна перезагрузите страницу.",
	nameLabel: "Имя",
	nameHint: "Отображаемое имя: всплывает при наведении и добавляется в образ ИИ («тебя зовут X»). Может повторяться; если пусто — используется id питомца.",
	personaLabel: "Образ (необязательно)",
	personaHint: "Действует только для этого питомца. Пусто = использовать образ записи — серый текст в поле и есть он. Фактический system для модели = этот текст + автоматически добавленная строка «тебя зовут \"<имя>\"» + текущий временной контекст, поэтому не повторяйте здесь имя и дату.",
	personaCount: "{n} симв.",
	balanceEnabled: "Функция баланса",
	balanceEnabledHint: "Если включено, питомец проигрывает анимацию баланса и показывает пузырь с балансом.",
	whisperEnabled: "Шёпот",
	whisperEnabledHint: "Если включено, питомец периодически генерирует фразу через ИИ и проигрывает анимацию шёпота (образ — поле ниже; пусто = образ записи).",
	workStatusEnabled: "Статус работы",
	workStatusEnabledHint: "Если включено, питомец следит за статусом работы DSH: размышление / работа / ожидание подтверждения / готово / ошибка — переключает анимации и показывает пузыри (пул в конфиге верхнего уровня; только прослушивание, без вызовов модели).",
	fixedEnabled: "Закрепить питомца",
	fixedEnabledHint: "Если включено, случайная цепочка больше не поворачивает и не уводит питомца — проигрываются только ожидание на месте и мелкие движения. Выбор по правому клику, запуски через API и анимации баланса / шёпота / статуса работы не затрагиваются.",
	displayLabel: "Отображение",
	displayHint: "web = только браузер / desktop = только рабочий стол / both = везде / none = нигде",
	"display.web": "Только браузер",
	"display.desktop": "Только рабочий стол",
	"display.both": "Везде",
	"display.none": "Нигде",
	cornerLabel: "Позиция",
	"corner.top-left": "Верхний левый",
	"corner.top-right": "Верхний правый",
	"corner.bottom-left": "Нижний левый",
	"corner.bottom-right": "Нижний правый",
	marginX: "Горизонтальный отступ",
	marginY: "Вертикальный отступ",
	save: "Сохранить",
	saveHotkey: "Ctrl+S / Cmd+S",
	sync: "Синхронизировать",
	confirmSync: "Синхронизировать? Пользовательский конфиг будет перезаписан встроенным конфигом по умолчанию (все поля + комментарии); текущие настройки будут потеряны.",
	corruptTitle: "Пользовательский конфиг повреждён — не сохранён",
	corruptConfirm: "Сохранить принудительно",
	corruptBody: "Не удаётся разобрать файл пользовательского конфига (повреждён, не валидный JSON/JSONC): {path}. При сохранении файл будет пересобран по белому списку — всё текущее содержимое (animations / physics / memes и другие пользовательские поля) будет потеряно. Отмена = не трогать файл (сначала исправьте конфиг и сохраните снова); Подтвердить = сохранить принудительно (отбросить содержимое файла).",
	syncHint: "«Синхронизировать» записывает встроенный конфиг по умолчанию (с комментариями и всеми расширенными полями) в файл пользовательского конфига, перезаписывая текущие настройки; после этого файл можно редактировать напрямую. Два замечания: ① после создания файл становится явным слоем переопределения — последующие изменения встроенных значений по умолчанию не применяются автоматически (пока не синхронизируете снова или не удалите файл); ② нажатие «Сохранить» на этой странице пересобирает файл по белому списку (значения полей сохраняются, комментарии удаляются).",
	configMeta: "Расширенная конфигурация (файлы)",
	configMetaHint: "Пользовательский конфиг может переопределять список питомцев / пулы анимаций / веса воспроизведения — изменения применяются после обновления или перезапуска: в браузере обновите страницу, в настольном режиме щёлкните питомца правой кнопкой → «Перезагрузить конфиг» (перезагружает все окна настольных питомцев); конфиг по умолчанию — полный справочник.",
	defaultConfig: "Конфиг по умолчанию (только чтение, полный справочник)",
	userConfig: "Пользовательский конфиг (свои переопределения)",
	todosFile: "Данные задач (текст списка, срок и статус выполнения; удаление очищает все задачи)",
	animationDir: "Каталог анимаций (можно добавлять и заменять анимации)",
	memesDir: "Каталог мемов (можно добавлять и заменять картинки)",
	logFile: "Файл журнала (для диагностики; можно очищать)",
	logFileNote: "В настольной версии нет консоли, поэтому все журналы работы плагина (запуск, падения и перезапуски настольных питомцев, ошибки и предупреждения) пишутся в этот единственный файл; прикладывайте его при сообщении о проблеме. Лимит файла — 1 МБ, при переполнении остаются последние 512 КБ.",
	saved: "Сохранено — питомцы обновились сразу.",
	loadError: "Не удалось загрузить конфиг",
	saveError: "Не удалось сохранить конфиг. Проверьте подключение к серверу, права на запись в каталог конфигурации и журнал сервера.",
	saveInvalid: "Не удалось сохранить конфиг: недопустимое содержимое. Проверьте значения и повторите попытку.",
	syncError: "Не удалось синхронизировать конфиг. Проверьте подключение к серверу и права на запись в каталог конфигурации.",
	loading: "Загрузка конфига…",
	retry: "Повторить",
	invalid: "Проверьте ввод: размер должен быть положительным, отступы — любым числом.",
	busy: "Сохранение…",
	extraPetsHint: "Ещё {n} вида берутся из файлов каталога pet/ (<имя>-config.json + <имя>-animation/); переключитесь на них в строке «Виды» выше — сохранение запишет в конфиг соответствующего пакета, не в main-config.jsonc.",
	kindLabel: "Виды",
	kindMain: "Встроенный",
	lastOfKind: "У «{entry}» остался только этот питомец — удаление уберёт весь вид. Чтобы удалить полностью, удалите файлы пакета.",
	savePartial: "Основные питомцы сохранены, но {names} не удалось записать: проверьте валидность конфига пакета и права на запись в каталог.",
	notifyToggle: "Системные уведомления",
	notifyToggleHint: "Уведомления ОС (в правом нижнем углу рабочего стола) о завершении диалога, ошибках генерации, запросах прав и вопросах — только когда окно не в фокусе.",
	clickSoundToggle: "Звук клика",
	clickSoundToggleHint: "При клике по питомцу воспроизводится встроенный звук (assets/sound/click-duck.wav, громкость 0.5); повторные клики в пределах 100 мс звучат один раз, поэтому несколько питомцев не накладываются. Выключите для полной тишины. Записывается в пользовательский конфиг вместе с «Сохранить».",
	whisperImageToggle: "Картинки к шёпоту",
	whisperImageToggleHint: "К каждой фразе шёпота добавляется случайный мем из пула (сопоставление картинок — в поле memes верхнего уровня конфига). Токены: шёпот и так вызывает модель каждый цикл, картинка лишь добавляет имя + описание выбранного мема (~100 символов / ≈60 токенов) в тот же запрос — прирост незначителен.",
	chatImageToggle: "Картинки к чату",
	chatImageToggleHint: "ИИ сам выбирает мем из пула под текущий контекст (может не выбирать; сопоставление — в поле memes верхнего уровня). Токены: каждое сообщение несёт весь список — сейчас ~1.1k символов (≈650 токенов, примерно в 11 раз больше, чем у шёпота) и растёт линейно с числом картинок; при выключении не добавляется ни одного символа.",
	chatAnimationToggle: "Действия в чате",
	chatAnimationToggleHint: "Если включено, запрос чата несёт список анимаций, которые можно сыграть (все действия из animations.categories): если модель считает, что реплика действительно изображает одно из них, питомец сразу его играет; иначе отвечает только текстом. Токены: каждое сообщение несёт весь список; при выключении не добавляется ничего. Глобальное значение по умолчанию для всех питомцев (pet pack может переопределить его в своём файле конфигурации).",
	confineToggle: "Не выходить за текущий экран",
	confineToggleHint: "Несколько мониторов: если включено, питомец остаётся в пределах экрана, на котором находится — брошенный питомец отскакивает только внутри экрана, где его отпустили (стыки экранов работают как стены, он не улетает на соседний монитор), а самостоятельные прогулки тоже идут только в пределах текущего экрана (шаг, пересекающий стык, просто отменяется). Если выключено, он свободно летает и ходит между экранами. Только настольный режим — браузерный оверлей и так остаётся в пределах окна.",
	trayToggle: "Системный трей",
	trayToggleHint: "В настольном режиме в области уведомлений (на macOS — в строке меню) постоянно показывается значок со всеми питомцами из конфига: галочка переключает место отображения, включая питомцев, которых сейчас нет на рабочем столе и у которых нет окна для правого клика. Если выключить, вернуть питомца на рабочий стол можно только через браузер (страница настроек или правый клик по питомцу на веб-странице). Windows и так сворачивает такие значки в «скрытые». Только настольный режим.",
	voiceTitle: "Голосовое озвучивание",
	voiceHint: "Три переключателя и голос: главный включает автоматическое озвучивание, два дополнительных — по одному типу активных сообщений. По умолчанию всё выключено; записывается в пользовательский конфиг по «Сохранить» (без немедленной записи).",
	voiceEnabled: "Озвучивание",
	voiceEnabledHint: "Главный переключатель автоматического озвучивания. Если выключен, периодический шёпот и напоминания о задачах не произносятся (два переключателя ниже не действуют); ручной шёпот, ответы в чате и кнопка динамика в панели чата от него не зависят — вы запросили их сами, и они озвучиваются сразу. Влияет только на «говорить или нет»: пузыри, история чата и системные уведомления не затрагиваются; ошибка синтеза пишется в журнал и не прерывает диалог.",
	voiceWhisperEnabled: "Озвучивать шёпот",
	voiceWhisperEnabledHint: "Озвучивает периодически генерируемую фразу шёпота (ручной шёпот по правому клику не затрагивается). Подчиняется главному переключателю выше. По умолчанию выключено — шёпот это фоновое повествование, он не должен звучать без запроса.",
	voiceTodoEnabled: "Озвучивать задачи",
	voiceTodoEnabledHint: "Озвучивает напоминание о задаче, когда подходит срок (пузырь появляется в любом случае; этот пункт решает только, произносить ли). Подчиняется главному переключателю выше. По умолчанию выключено.",
	voiceNameLabel: "Голос",
	voiceVolumeLabel: "Громкость",
	voiceVolumeHint: "Громкость воспроизведения в виде десятичной дроби 0–1: 1 — максимальная громкость (100 %), 0 — без звука. Меняется только уровень, звук заново не синтезируется, поэтому настройка ничего не стоит дополнительно. Не зависит от общего переключателя выше: при выключенном переключателе не действует.",
	physicsTitle: "Физика (ощущение перетаскивания и броска)",
	physicsHint: "Глобальное значение по умолчанию для всех питомцев (пакет питомца может переопределить в своём файле вида); записывается в пользовательский конфиг по «Сохранить» (без немедленной записи). В браузере применяется сразу, в настольном режиме — после перезагрузки окон питомцев при сохранении.",
	mobileTitle: "Эффекты для телефона",
	mobileHint: "Имеют смысл только в мобильном браузере: вибрации нужен мотор, двум переключателям движения — датчики наклона и ускорения, а датчики доступны только по HTTPS или на localhost.",
	"physics.gravity": "Гравитация",
	"physics.gravityHint": "px/s², чем больше, тем быстрее падает; 0 = без гравитации (летит по прямой с постоянной скоростью)",
	"physics.restitution": "Упругость",
	"physics.restitutionHint": "0~1, доля сохраняемой скорости при отскоке от стены / пола (1 = абсолютно упругий, 0 = останавливается при ударе)",
	"physics.groundFriction": "Трение о поверхности",
	"physics.groundFrictionHint": "/с, затухание скорости вдоль любой контактной поверхности (стена, пол, потолок); 0 = везде лёд",
	"physics.throwPower": "Общая сила броска",
	"physics.throwPowerHint": "> 0, общий множитель следования за курсором и начальной скорости броска (1 = по умолчанию; больше = точнее следует и сильнее бросок)",
	physicsCeilingBounce: "Отскок от потолка",
	physicsCeilingBounceHint: "Если выключено, бросок может вылететь за верхний край экрана (гравитация всё равно вернёт питомца)",
	physicsPetCollision: "Столкновения питомцев",
	physicsPetCollisionHint: "Летящий питомец отталкивается от других по закону сохранения импульса (масса ∝ размеру²)",
	physicsHaptic: "Вибрация при столкновении",
	physicsHapticHint: "Одна вибрация на удар (стены, пол, потолок, другие питомцы). Работает в Chrome/Edge; не работает на iOS и в WebView-оболочках вроде Via. Режим «Не беспокоить» блокирует вибрацию.",
	physicsTilt: "Гравитация по наклону",
	physicsTiltHint: "Наклоняйте телефон — гравитация следует за ним (величина = значение выше); при гравитации 0 наклон ничего не меняет. Нужен HTTPS/localhost.",
	physicsShake: "Встряхнуть, чтобы бросить",
	physicsShakeHint: "Встряхните, чтобы бросить питомца в направлении жеста; сила зависит от throwPower. Не зависит от гравитации, работает и при 0. Нужен HTTPS/localhost.",
	invalidPhysics: "Проверьте физические параметры: гравитация / трение о землю ≥ 0, упругость 0~1, общая сила броска > 0.",
	fontTitle: "Внешний вид и шрифт",
	fontHint: "Семейство шрифта применяется ко всем местам, где сейчас используется «мармеладный» шрифт: пузырь питомца, подсказка при наведении, окно чата, всплывающее окно счёта. Размер действует только на пузырь питомца и подсказку при наведении (в чате и окне счёта размер не меняется). Глобальное значение по умолчанию для всех питомцев (пакет питомца может переопределить в своём файле вида); записывается в пользовательский конфиг по «Сохранить» — в браузере сразу, в настольном режиме после перезагрузки окон питомцев.",
	fontFamilyLabel: "Шрифт",
	fontFamilyHint: "«Мармеладный (встроенный)» поставляется с плагином; остальные — системные шрифты. Если шрифта нет на машине, используется следующий в стеке (без пустых мест и ошибок).",
	fontSizeLabel: "Размер шрифта (px)",
	fontSizeHint: "Размер основного текста пузыря; подсказка и мелкий текст внутри пузыря масштабируются пропорционально. Диапазон 4~200.",
	fontFollowToggle: "Масштабировать шрифт вместе с питомцем",
	fontFollowToggleHint: "Включено (по умолчанию): при увеличении питомца шрифт растёт пропорционально, при ширине 462 это ровно заданный выше размер; выключено: размер фиксирован и не зависит от размера питомца.",
	invalidFont: "Проверьте настройки шрифта: семейство должно быть в списке, размер — числом от 4 до 200.",
	"font.candy": "Мармеладный (встроенный)",
	"font.yahei": "Microsoft YaHei / PingFang",
	"font.youyuan": "YouYuan",
	"font.kaiti": "KaiTi",
	"font.simsun": "SimSun",
	"font.comic": "Comic Sans MS",
	"font.system": "Системный по умолчанию",
	modelTitle: "Чат и модели",
	modelHint: "Какая модель используется для шёпота и для чата, и сколько истории каждый запрос чата несёт в контексте. «Следовать текущему диалогу» = использовать модель текущего диалога (по умолчанию). Глобальное значение по умолчанию: действует для всех питомцев, пакет питомца может переопределить в своём файле вида. Список тот же, что в выборе моделей DSH, и предоставляется хостом в реальном времени.",
	modelFollow: "Следовать текущему диалогу",
	modelSearch: "Поиск моделей…",
	modelEmpty: "Подходящих моделей нет.",
	modelNoModels: "Доступных моделей нет.",
	modelLoading: "Обновление списка моделей…",
	modelTriggerAria: "Выбрать модель, текущая {model}",
	modelUnknown: " (текущая настройка, отсутствует в списке)",
	modelNone: "У этого провайдера нет доступных моделей",
	whisperModelLabel: "Модель для шёпота",
	chatModelLabel: "Модель для чата",
	modelFieldHint: "«Следовать текущему диалогу» = использовать модель текущего диалога; если выбранная модель не сработает, плагин один раз повторит с моделью текущего диалога.",
	invalidModel: "Проверьте настройки модели: выберите и провайдера, и модель — либо оставьте оба поля пустыми (следовать текущему диалогу).",
	modelCatalogFailed: "Не удалось загрузить список моделей (обновите страницу, чтобы повторить); текущие значения сохранятся как есть.",
	chatMemory: "Реплик истории чата",
	chatMemoryHint: "Сколько последних реплик несёт каждый запрос чата (1 реплика = 1 вопрос + 1 ответ; 0 = без истории, каждое сообщение с чистого листа). Сама память хранит всё — это значение решает только, сколько попадает в контекст: больше = лучше помнит, но дороже по токенам. Глобальное значение по умолчанию для всех питомцев (пакет питомца может переопределить в своём файле вида).",
	invalidChatMemory: "Проверьте число реплик истории чата: нужно число ≥ 0.",
	chatImageLimit: "Лимит картинок в чате",
	chatImageLimitHint: "Сколько мемов максимум передаётся модели в чате («первые N» = первые N в конфиге, поэтому нужные перенесите в начало). Весь список прикладывается к каждому сообщению, и токены растут линейно с количеством — большой список это чистый перерасход; ограничение первыми N заставляет модель выбирать только из них. 0 = без ограничения (передавать все). Встроенное значение по умолчанию — 10. Глобальное значение по умолчанию для всех питомцев (пакет питомца может переопределить в своём файле вида). Только для выбора картинок в чате: шёпот несёт лишь одну выбранную картинку.",
	invalidChatImageLimit: "Проверьте лимит картинок в чате: нужно число ≥ 0 (0 = без ограничения).",
	notifyTest: "Тестовое уведомление",
	notifyTestOk: "Тестовое уведомление отправлено — проверьте правый нижний угол рабочего стола.",
	notifyDenyUnsupported: "В этой среде системные уведомления не поддерживаются (нет Notification API).",
	notifyDenyBlocked: "Разрешение на уведомления заблокировано браузером.",
	notifyDenyRejected: "Вы выбрали «Блокировать» в запросе разрешения.",
	notifyDenyError: "Ошибка при запросе разрешения",
	notifyGuide: "Подсказка: нажмите 🔒/ⓘ слева от адресной строки → «Настройки сайта» → «Уведомления» → выберите «Разрешить», затем обновите страницу и повторите.",
	storageTitle: "Удаление и хранилище",
	storageHint: "Все места, куда плагин пишет на этом компьютере. Удаление кеша не мешает работе (он скачается/пересоберётся); удаление «пользовательских данных плагина» стирает конфиг и память чата.",
	"storage.userData": "Пользовательские данные плагина: свой конфиг main-config.jsonc, память чата memory.json, свои анимации main-animation/, файловые питомцы pet/",
	"storage.electron": "Среда выполнения Electron для настольного питомца (большая; при следующем включении настольного режима скачается заново)",
	"storage.desktopCache": "Кеш окон настольных питомцев и кеш масштаба основного экрана (можно удалять, пересоберётся автоматически)",
	"storage.electronCache": "Кеш загрузки установщика Electron (можно удалять, при необходимости скачается заново)",
	"storage.package": "Сам плагин (управляется DSH — удаляйте командой ниже, не вручную)",
	storageMissing: " (ещё не создано)",
	uninstallTitle: "Как удалить",
	uninstallStep1: "1. Сначала закройте DSH (настольный питомец закроется вместе с ним); не удаляйте эти файлы, пока питомец запущен.",
	uninstallStep2: "2. Удалите сам плагин (выполните в терминале; он также убирается из слоя bundle профиля):",
	uninstallStep3: "3. Удалите нужные места из списка выше: кеш удалять безопасно; удаление «пользовательских данных плагина» стирает конфиг и память чата (если нужно сохранить — сначала сделайте резервную копию main-config.jsonc).",
	uninstallCmd: "dsh plugin --profile {profile} remove dsh-pet"
};

//#endregion
//#region src/client/settings/locales/zh.ts
const zh = {
	nav: "桌寵設定",
	intro: "管理多個桌寵：每個寵物可獨立設定大小與位置（儲存后即時生效）。",
	petCardTitle: "寵物設定",
	petCardHint: "每只寵物獨立設定：名字 / 大小 / 顯示位置 / 位置 / 偏移 / 四個功能開關。改完點最下面的「儲存」即時生效。",
	globalTitle: "全局開關",
	globalHint: "所有寵物共用（pet pack 可在自己种類文件里單獨覆蓋）。這几個開關只改本地狀態，隨「儲存」整包寫入用戶設定（不做即時寫入）；系統通知在儲存后即時重讀，無需刷新頁面。",
	cornerHint: "寵物貼著屏幕的哪個角（桌面端按各自顯示器的工作区算）。",
	marginXHint: "距所選角落的水平距離（px），可為任意數字。",
	marginYHint: "距所選角落的垂直距離（px），可為任意數字。",
	"cmd.chat": "對話",
	"cmd.pet": "桌寵",
	"cmd.balance": "餘額",
	"shortcut.open": "打開桌寵對話",
	"shortcut.chat": "打開對話彈窗",
	"shortcut.hear": "語音輸入",
	"shortcut.capture": "截圖到對話",
	shortcutCardTitle: "快捷鍵",
	shortcutCardHint: "展開后分兩組：桌寵快捷鍵與全局快捷鍵。",
	shortcutRowChat: "打開對話",
	shortcutRowHold: "按住說話",
	shortcutRowHear: "語音輸入",
	shortcutRowCapture: "截圖",
	shortcutRowPaste: "黏貼圖片",
	shortcutRowTodo: "待辦事項",
	shortcutRowSleep: "睡覺 / 起來",
	shortcutRowDisplay: "顯示位置",
	shortcutRowSidebar: "打開側栏對話",
	shortcutGroupPet: "桌寵快捷鍵",
	shortcutGroupPetHint: "網頁端鼠標停在寵物上即可；桌面寵物窗口要先點一下寵物，拿到鍵盤焦點后才生效。",
	shortcutGroupGlobal: "全局快捷鍵",
	shortcutGroupGlobalHint: "網頁端與桌面版窗口里由 DSH 分發；可在「設定 → 通用 → 快捷鍵」改綁。",
	petsLabel: "寵物列表",
	add: "添加寵物",
	remove: "刪除",
	confirmRemove: "確定刪除寵物「{id}」嗎？",
	confirmTitle: "確認操作",
	cancel: "取消",
	ok: "知道了",
	atLeastOne: "至少保留一個寵物。",
	emptyPets: "暫無寵物，點擊「添加寵物」創建。",
	sizeLabel: "大小（寬度 px）",
	sizeHint: "高度自動 = 寬度 × 9/16。",
	sizePercentLabel: "屏幕寬度上限（%）",
	sizePercentHint: "桌寵最多占屏幕多寬：100 = 不超過一屏寬，窗口比寵物寬時與按 px 顯示完全一致；填 30–40 可讓手機豎屏明顯變小，桌面觀感不變。只在頁面載入時計算一次，改窗口大小后刷新生效。",
	nameLabel: "名字",
	nameHint: "顯示名：鼠標懸浮寵物時彈出，也会加進 AI 人設（你的名字是 X）。可重復，留空按寵物 id 處理。",
	personaLabel: "人設（可選）",
	personaHint: "只影響這只寵物。留空 = 跟隨所屬條目的人設——輸入框里的灰色文字就是那份內容。實際發給模型的 system = 這段 + 自動追加的「你的名字是“<名字>”」+ 當前時間背景，所以別在這里再寫名字和日期。",
	personaCount: "{n} 字",
	balanceEnabled: "餘額功能",
	balanceEnabledHint: "啟用后該寵物觸發餘額動畫並顯示餘額氣泡。",
	whisperEnabled: "碎碎念",
	whisperEnabledHint: "啟用后該寵物按周期用 AI 生成一句話並播碎碎念動畫（人設見下方「人設」框，留空跟隨條目）。",
	workStatusEnabled: "工作狀態聯動",
	workStatusEnabledHint: "啟用后該寵物跟隨 DSH 工作狀態：思考/工作中/等待確認/完成/出錯時自動切對應動畫並彈氣泡（動畫池在設定頂層，僅監聽不調用模型）。",
	fixedEnabled: "寵物固定",
	fixedEnabledHint: "啟用后隨機動畫不再讓寵物自己轉向或走開，只播原地待機與隨機小動作；右鍵菜單點播、接口觸發、餘額/碎碎念/工作狀態動畫不受影響。",
	displayLabel: "顯示位置",
	displayHint: "web=僅瀏覽器 / desktop=僅桌面 / both=兩者都顯示 / none=都不要顯示",
	"display.web": "僅瀏覽器",
	"display.desktop": "僅桌面",
	"display.both": "兩者都顯示",
	"display.none": "都不要顯示",
	cornerLabel: "位置",
	"corner.top-left": "左上角",
	"corner.top-right": "右上角",
	"corner.bottom-left": "左下角",
	"corner.bottom-right": "右下角",
	marginX: "水平偏移",
	marginY: "垂直偏移",
	save: "儲存",
	saveHotkey: "Ctrl+S / Cmd+S",
	sync: "同步",
	confirmSync: "確定同步嗎？將用項目內置的預設設定（完整字段 + 註釋）覆蓋用戶設定，當前的自定義內容会丢失。",
	corruptTitle: "用戶設定已損壞，未儲存",
	corruptConfirm: "強行儲存",
	corruptBody: "用戶設定文件解析不了（內容已損壞，不是合法 JSON/JSONC）：{path}。繼續儲存会按白名單重建這個文件——它里面現有的內容（animations / physics / memes 等自定義字段）会全部丢失。取消 = 不動文件（先去把設定改回合法再儲存）；確認 = 強行儲存（丢棄文件里現有的內容）。",
	syncHint: "「同步」会把項目內置的預設設定（含註釋與全部高級字段）寫入用戶設定文件，覆蓋當前自定義內容；之后可直接編輯該文件。註意兩點：① 文件一旦生成即為顯式覆蓋層——插件升級后內置預設的變化不会自動生效（除非再次同步或刪除該文件）；② 在本頁點「儲存」会按白名單重寫該文件（字段值保留，但註釋会被去掉）。",
	configMeta: "高級設定（文件）",
	configMetaHint: "用戶設定可覆蓋寵物列表 / 動畫池 / 播放權重，修改后刷新或重啟生效：瀏覽器端刷新頁面，桌面端右鍵寵物 →「重載設定」（重載全部桌面寵物窗口）；預設設定為完整參考。",
	defaultConfig: "預設設定（只讀，完整參考）",
	userConfig: "用戶設定（自定義覆蓋）",
	todosFile: "待辦數據（清單正文、到期時間與完成狀態；刪掉等于清空待辦）",
	animationDir: "動畫素材目錄（可自定義/擴充動畫）",
	memesDir: "表情包目錄（可自定義/擴充配圖）",
	logFile: "日志文件（排障用，可清空）",
	logFileNote: "桌面版沒有控制臺，插件的運行日志（啟動、桌面寵物崩潰/重啟、錯誤與告警）全部寫進這一個文件；反饋問題請附上它。單文件上限 1 MB，寫滿只留最新的 512 KB。",
	saved: "已儲存，桌寵即時生效。",
	loadError: "載入設定失敗",
	saveError: "儲存設定失敗，請檢查服務連接、設定目錄的寫入權限或服務日志。",
	saveInvalid: "儲存設定失敗：設定內容無效，請檢查后重試。",
	syncError: "同步設定失敗，請檢查服務連接和設定目錄的寫入權限。",
	loading: "正在載入設定…",
	retry: "重試",
	invalid: "請檢查輸入：大小需為正數，邊距可為任意數字。",
	busy: "儲存中…",
	extraPetsHint: "另 {n} 個种類來自 pet/ 目錄文件（<名>-config.json + <名>-animation/），在上方「种類」條里切換即可修改；儲存会寫回各自的角色包設定，不混進 main-config.jsonc。",
	kindLabel: "种類",
	kindMain: "內置",
	lastOfKind: "「{entry}」只剩這一只，刪掉就沒有這個种類了。要徹底移除請直接刪除該角色包文件。",
	savePartial: "主寵物已儲存，但 {names} 沒能寫回：檢查該角色包設定是否合法、目錄是否可寫。",
	notifyToggle: "系統通知",
	notifyToggleHint: "對話完成 / 生成失敗 / 權限申請 / 用戶選擇，在窗口失焦時彈出系統級通知（桌面右下角）。",
	clickSoundToggle: "點擊音效",
	clickSoundToggleHint: "點一下寵物播一聲內置音效（assets/sound/click-duck.wav，音量 0.5；100ms 內的連續點擊只響一次，多開也不会疊音）。關掉即完全靜音。隨「儲存」寫入用戶設定。",
	whisperImageToggle: "碎碎念配圖",
	whisperImageToggleHint: "碎碎念時從表情包池隨機抽一張，連同那句話一起顯示（圖片映射在設定文件頂層 memes）。token：碎碎念本來就每次生成都要調一次模型，配圖只是把抽中那張的名稱+描述（約 100 字符 / ≈60 token）加進同一次請求，增量可忽略。",
	chatImageToggle: "對話配圖",
	chatImageToggleHint: "對話時由 AI 按當前語境從表情包池挑一張配圖（可不挑；圖片映射在設定文件頂層 memes）。token：每條訊息都要把整張清單附進請求，當前約 1.1k 字符（≈650 token，約碎碎念配圖的 11 倍），並隨圖片數量線性增長；關掉則一個字符都不要附。",
	chatAnimationToggle: "對話動作聯動",
	chatAnimationToggleHint: "開啟后，對話時会把可表演的動作清單（animations.categories 下的全部動作）交給模型：模型認為這句話確實在演某個動作時，寵物當場演出來；沒有合適的就只回文字。token：每條訊息都要附整張動作清單，關掉則一個名字都不要附。全局預設，所有寵物共用（pet pack 可在自己种類文件里覆蓋）。",
	confineToggle: "鎖定在當前屏幕",
	confineToggleHint: "多屏用戶：開了之后寵物只在當前所在那塊屏幕內活動——甩出去的寵物只在松手時所在那塊屏內彈（屏縫當牆，不飛到隔壁屏），自主漫遊也只在當前所在那塊屏內走（越出屏縫的那一步直接取消）。關掉則照常跨屏飛行 / 跨屏行走。只影響桌面模式——瀏覽器 overlay 本來就只在視口內活動。",
	trayToggle: "系統托盤",
	trayToggleHint: "桌面模式啟動后在通知區域（macOS 為菜單栏）常駐一個圖標，列出設定里的全部寵物，勾選就能切換顯示位置——包括當前不在桌面、沒有窗口可右鍵的那些。關掉之后要把寵物叫回桌面，只能開瀏覽器用設定頁，或在網頁端那只寵物身上右鍵。Windows 本來就会把它折疊進「隱藏的圖標」面板。僅影響桌面模式。",
	voiceTitle: "語音播報",
	voiceHint: "桌寵出聲的三個開關與音色：總開關管自動播報，兩個細分開關各管一類主動訊息。預設全關，隨「儲存」寫入用戶設定（不做即時寫入）。",
	voiceEnabled: "語音播報",
	voiceEnabledHint: "自動播報的總開關。關掉后週期碎碎念與待辦提醒都不念（下面兩個細分開關不起作用）；手動碎碎念、對話回覆與對話面板的喇叭按鈕不受它限制——那些是你主動點的，發起的那一端直接念。只影響「說不說」：氣泡、對話記憶與系統通知都不要受影響；合成失敗只留日志，不打斷對話。",
	voiceWhisperEnabled: "碎碎念播報",
	voiceWhisperEnabledHint: "周期生成的那句碎碎念念出來（手動右鍵的碎碎念不受本項影響）。受上面的總開關約束：總開關關掉時本項不起作用。預設關閉——碎碎念是背景旁白，不該預設出聲。",
	voiceTodoEnabled: "待辦播報",
	voiceTodoEnabledHint: "到點的待辦提醒念出來（同一句照樣彈氣泡，本項只決定念不念）。受上面的總開關約束。預設關閉。",
	voiceNameLabel: "音色",
	voiceVolumeLabel: "音量",
	voiceVolumeHint: "播報音量，0–1 的小數：1 是最大音量（100%），0 是靜音。只改播放響度，不会重新合成音頻，調它不額外花錢。與上面的總開關是兩件事——總開關關著時它不起作用。",
	physicsTitle: "物理（拖拽拋擲手感）",
	physicsHint: "全局預設，所有寵物共用（pet pack 可在自己种類文件里單獨覆蓋）；隨「儲存」寫入用戶設定（不做即時寫入）。瀏覽器儲存后即時生效，桌面端由儲存重載寵物窗口后生效。",
	mobileTitle: "移動端效果",
	mobileHint: "這几項只在手機瀏覽器上有意義：振動要有馬達，兩個體感開關要有姿態 / 加速度傳感器；傳感器還要求 HTTPS 或 localhost。",
	"physics.gravity": "重力",
	"physics.gravityHint": "px/s²，越大落得越快；0 = 無重力（拋出去勻速直線飛）",
	"physics.restitution": "彈性",
	"physics.restitutionHint": "0~1，碰壁 / 落地反彈保留的速度比例（1 = 完全彈性，0 = 撞上即停）",
	"physics.groundFriction": "接觸摩擦",
	"physics.groundFrictionHint": "/s，撞牆 / 落地 / 撞頂后沿接觸面方向的速度衰減率；0 = 四面都像冰面",
	"physics.throwPower": "總力度",
	"physics.throwPowerHint": "> 0，彈簧跟手與甩出初速的整體倍率（1 = 預設；越大越跟手、甩得越猛）",
	physicsCeilingBounce: "頂部反彈",
	physicsCeilingBounceHint: "關掉后拋擲可飛出屏幕頂部（重力仍会把它拉回來）",
	physicsPetCollision: "寵物互撞",
	physicsPetCollisionHint: "飛行中的寵物撞到別的寵物按動量守恆彈開（質量 ∝ 尺寸²）",
	physicsHaptic: "碰撞震動",
	physicsHapticHint: "撞牆、落地、撞頂、互撞各震一下。Chrome / Edge 可用；iOS 與 Via 等 WebView 殼不生效；勿擾模式会擋住振動。",
	physicsTilt: "傾斜控制重力",
	physicsTiltHint: "傾斜手機 = 重力朝那邊，大小就是上面的重力值；重力為 0 時傾斜沒有效果。需要 HTTPS 或 localhost。",
	physicsShake: "搖一搖拋出",
	physicsShakeHint: "搖一搖沿甩動方向把寵物甩出去，力度 = 基準 × 總力度；與重力無關，重力設 0 也能甩。需要 HTTPS 或 localhost。",
	invalidPhysics: "請檢查物理參數：重力 / 地面摩擦 ≥ 0，彈性 0~1，總力度 > 0。",
	fontTitle: "外觀與字體",
	fontHint: "字體种類作用于現在用軟糖體的全部文字：寵物氣泡、懸浮提示、對話窗、得分彈窗；字號只作用于寵物氣泡與懸浮提示（對話窗與得分彈窗的字號不變）。全局預設，所有寵物共用（pet pack 可在自己种類文件里單獨覆蓋）；隨「儲存」寫入用戶設定，瀏覽器儲存后即時生效，桌面端由儲存重載寵物窗口后生效。",
	fontFamilyLabel: "字體",
	fontFamilyHint: "「軟糖體（內置）」隨插件提供；其餘為系統字體，機器上沒裝時自動回退到字體栈里的下一個（不会空白或報錯）。",
	fontSizeLabel: "字號（px）",
	fontSizeHint: "氣泡正文字號；懸浮提示與氣泡內的小字按既有比例派生。范圍 4~200。",
	fontFollowToggle: "字號隨寵物大小縮放",
	fontFollowToggleHint: "開啟（預設）：寵物調大時字號等比放大，462 寬時正好是上面設定的字號；關閉：字號恆定，不隨寵物大小變化。",
	invalidFont: "請檢查字體設定：字體需在下拉列表內，字號需為 4~200 的數字。",
	"font.candy": "軟糖體（內置）",
	"font.yahei": "微軟雅黑 / 蘋方",
	"font.youyuan": "幼圓",
	"font.kaiti": "楷體",
	"font.simsun": "宋體",
	"font.comic": "漫畫體",
	"font.system": "系統預設",
	modelTitle: "對話與模型",
	modelHint: "碎碎念與對話各自用哪個模型，以及對話每次帶多少歷史進上下文。選「跟隨當前對話」= 用你當前對話正在用的那個模型（預設）。全局預設：對所有寵物生效，pet pack 可在自己种類文件里單獨覆蓋。選項與 DSH 的模型選擇器同源，由宿主實時提供。",
	modelFollow: "跟隨當前對話",
	modelSearch: "搜索模型…",
	modelEmpty: "沒有匹配的模型。",
	modelNoModels: "沒有可用的模型。",
	modelLoading: "正在刷新模型列表…",
	modelTriggerAria: "選擇模型，當前 {model}",
	modelUnknown: "（當前設定，不在列表中）",
	modelNone: "該服務商沒有可用模型",
	whisperModelLabel: "碎碎念模型",
	chatModelLabel: "對話模型",
	modelFieldHint: "選「跟隨當前對話」= 用當前對話的模型；指定了但調用失敗会自動回落到當前對話的模型重試一次。",
	invalidModel: "請檢查模型設定：服務商與模型要么都選，要么都留空（跟隨當前對話）。",
	modelCatalogFailed: "模型列表載入失敗（刷新頁面可重試）；當前設定值仍会原樣保留。",
	chatMemory: "對話歷史條數",
	chatMemoryHint: "每次對話請求攜帶的最近歷史輪數（1 輪 = 1 問 1 答；0 = 不帶歷史，每句都是全新對話）。對話記憶本身全存不刪，此值只決定截多少進上下文——越大越記得住，也越費 token。全局預設，所有寵物共用（pet pack 可在自己种類文件里單獨覆蓋）。",
	invalidChatMemory: "請檢查對話歷史條數：需為 ≥ 0 的數字。",
	chatImageLimit: "對話配圖張數上限",
	chatImageLimitHint: "對話時發給模型的表情包清單最多几張（「前 N 張」= 設定里寫在前面的那 N 條，想讓哪几張優先被發出去就把順序往前挪）。整張清單是每條訊息都要附的，token 隨張數線性增長——張數一多就是純燒錢，限制成前 N 張，模型只從這几張里挑。0 = 不限制（全部發）。內置預設 10。全局預設，所有寵物共用（pet pack 可在自己种類文件里覆蓋）。只影響對話選圖：碎碎念只帶抽中的那一張。",
	invalidChatImageLimit: "請檢查對話配圖張數上限：需為 ≥ 0 的數字（0 = 不限制）。",
	notifyTest: "測試彈窗",
	notifyTestOk: "測試通知已送出，請查看桌面右下角。",
	notifyDenyUnsupported: "當前環境不支持系統通知（瀏覽器無 Notification API）。",
	notifyDenyBlocked: "通知權限已被瀏覽器標記為「阻止」。",
	notifyDenyRejected: "你在權限詢問彈窗中選擇了「阻止」。",
	notifyDenyError: "申請權限時出錯",
	notifyGuide: "引導：點擊地址栏左側 🔒/ⓘ →「網站設定」→「通知」→ 改為「允許」，刷新頁面后重試。",
	storageTitle: "卸載與存儲",
	storageHint: "插件在本機落下的全部位置。刪緩存不影響使用（会自動重下/重建）；刪「插件用戶數據」会丢設定與對話記憶。",
	"storage.userData": "插件用戶數據：自定義設定 main-config.jsonc、對話記憶 memory.json、自定義動畫素材 main-animation/、文件寵物 pet/",
	"storage.electron": "桌面寵物用的 Electron 運行時（體積較大；刪除后下次啟用桌面模式会自動重新下載）",
	"storage.desktopCache": "桌面寵物窗口的緩存與主屏縮放緩存（可刪，会自動重建）",
	"storage.electronCache": "Electron 安裝包下載緩存（可刪，需要時会重新下載）",
	"storage.package": "插件本體（由 DSH 管理，用下面的卸載命令移除，不要手刪）",
	storageMissing: "（尚未創建）",
	uninstallTitle: "卸載方法",
	uninstallStep1: "1. 先退出 DSH（桌面寵物隨之退出）；不要在桌寵運行時刪除上面的文件。",
	uninstallStep2: "2. 卸載插件本體（終端執行，会同時從 profile 的 bundle 層移除）：",
	uninstallStep3: "3. 按需刪除上面的位置：緩存類刪了無影響；「插件用戶數據」刪了会丢設定與對話記憶（想保留就先備份其中的 main-config.jsonc）。",
	uninstallCmd: "dsh plugin --profile {profile} remove dsh-pet"
};

//#endregion
//#region src/client/settings/locales/index.ts
const NS = "pet.config";
const dicts = {
	zh,
	en,
	ja,
	es,
	fr,
	de,
	ru,
	pt
};

//#endregion
//#region src/client/settings.ts
function makePetConfigSection(rt, ctx) {
	const { h, useState, useEffect, useRef, useCallback, t } = rt;
	injectSettingsCss();
	const { q } = makeUiKit({
		h,
		t
	});
	const ModelPicker = makeModelPicker({
		h,
		useState,
		useEffect,
		useRef,
		t
	});
	const VoicePicker = makeVoicePicker({
		h,
		useState,
		useEffect,
		useRef
	});
	const PetTabs = makePetTabs({
		h,
		t
	});
	const KindTabs = makeKindTabs({
		h,
		t
	});
	const PetCard = makePetCard(rt);
	const GlobalCard = makeGlobalCard(rt);
	const VoiceCard = makeVoiceCard(rt, VoicePicker);
	const FontCard = makeFontCard(rt);
	const ModelCard = makeModelCard(rt, ModelPicker);
	const PhysicsCard = makePhysicsCard(rt);
	const ShortcutsCard = makeShortcutsCard(rt, ctx);
	const MobileCard = makeMobileCard(rt);
	const Actions = makeActions(rt);
	const { ConfigMetaCard, StorageCard } = makePathsCards(rt);
	const SettingsDialog = makeDialog(rt);
	const LoadStatus = makeLoadStatus({
		h,
		t
	});
	return function PetConfigSection() {
		const [saving, setBusy] = useState(false);
		const [msg, setMsg] = useState({
			kind: "",
			text: ""
		});
		const [permMsg, setPermMsg] = useState({
			kind: "",
			text: ""
		});
		const rootRef = useRef(null);
		const [dialog, setDialog] = useState(null);
		const { pets, mainPets, kinds, kind, visiblePets, selId, entryPrompt, select, selectKind, update, add, requestRemove, remove, replace, packWrites } = usePetList(rt, setDialog);
		const { paths, catalog, catalogFailed } = useRemoteData(rt);
		useEffect(() => attachTipLayer(), []);
		useEffect(() => {
			let alive = true;
			fetch(ROUTE_PATH + "/voice/voices").then((response) => response.ok ? response.json() : null).then((body) => {
				if (alive && body && Array.isArray(body.voices)) setVoiceOptions(body.voices);
			}).catch(() => void 0);
			return () => {
				alive = false;
			};
		}, []);
		const [notifyEnabled$1, setNotifyEnabled] = useState(true);
		const [clickSound, setClickSound] = useState(true);
		const [whisperImage, setWhisperImage] = useState(false);
		const [chatImage, setChatImage] = useState(false);
		const [chatAnimation, setChatAnimation] = useState(true);
		const [confineScreen, setConfineScreen] = useState(false);
		const [trayEnabled, setTrayEnabled] = useState(true);
		const [voiceEnabled$1, setVoiceEnabled] = useState(false);
		const [voiceName$1, setVoiceName] = useState("zh-CN-XiaoyiNeural");
		const [voiceVolume$1, setVoiceVolume] = useState(1);
		const [voiceWhisperEnabled, setVoiceWhisperEnabled] = useState(false);
		const [voiceTodoEnabled, setVoiceTodoEnabled] = useState(false);
		const [voiceOptions, setVoiceOptions] = useState([]);
		const [physics, setPhysics] = useState({ ...DEFAULT_PHYSICS });
		const [font, setFont] = useState({ ...DEFAULT_FONT });
		const [whisperModel, setWhisperModel] = useState({
			provider: "",
			model: ""
		});
		const [chatModel, setChatModel] = useState({
			provider: "",
			model: ""
		});
		const [chatMemory, setChatMemory] = useState(10);
		const [chatImageLimit, setChatImageLimit] = useState(20);
		const applyConfig = useCallback((merged) => {
			const entries = readConfigEntries(merged);
			const patch = readMainConfig(merged);
			if (entries === null || patch === null) throw new Error("Invalid config response");
			replace(entries);
			if (patch.notificationsEnabled !== void 0) setNotifyEnabled(patch.notificationsEnabled);
			if (patch.clickSoundEnabled !== void 0) setClickSound(patch.clickSoundEnabled);
			if (patch.whisperImageEnabled !== void 0) setWhisperImage(patch.whisperImageEnabled);
			if (patch.chatImageEnabled !== void 0) setChatImage(patch.chatImageEnabled);
			if (patch.chatAnimationEnabled !== void 0) setChatAnimation(patch.chatAnimationEnabled);
			if (patch.confineToScreen !== void 0) setConfineScreen(patch.confineToScreen);
			if (patch.trayEnabled !== void 0) setTrayEnabled(patch.trayEnabled);
			if (patch.voiceEnabled !== void 0) setVoiceEnabled(patch.voiceEnabled);
			if (patch.voiceName !== void 0) setVoiceName(patch.voiceName);
			if (patch.voiceVolume !== void 0) setVoiceVolume(patch.voiceVolume);
			if (patch.voiceWhisperEnabled !== void 0) setVoiceWhisperEnabled(patch.voiceWhisperEnabled);
			if (patch.voiceTodoEnabled !== void 0) setVoiceTodoEnabled(patch.voiceTodoEnabled);
			if (patch.physics !== void 0) setPhysics(patch.physics);
			if (patch.font !== void 0) setFont(patch.font);
			if (patch.whisperModel !== void 0) setWhisperModel(patch.whisperModel);
			if (patch.chatModel !== void 0) setChatModel(patch.chatModel);
			if (patch.chatMemoryRounds !== void 0) setChatMemory(patch.chatMemoryRounds);
			if (patch.chatImageLimit !== void 0) setChatImageLimit(patch.chatImageLimit);
		}, [replace]);
		const { loadState, retry } = useConfigLoad(rt, applyConfig);
		const busy = saving || loadState !== "ready";
		const toggleNotify = async (v) => {
			setNotifyEnabled(v);
			if (v) await requestNotificationPermission();
		};
		const testNotification = () => void runNotificationTest({
			t,
			report: setPermMsg
		});
		const cur = pets.find((p) => p.id === selId) ?? null;
		const packCount = kinds.filter((item) => item.kind === "pack").length;
		const globalFlags = {
			notificationsEnabled: notifyEnabled$1,
			clickSoundEnabled: clickSound,
			confineToScreen: confineScreen,
			trayEnabled
		};
		const chatFlags = {
			whisperImageEnabled: whisperImage,
			chatImageEnabled: chatImage,
			chatAnimationEnabled: chatAnimation
		};
		const flagSetters = {
			notificationsEnabled: (value) => void toggleNotify(value),
			clickSoundEnabled: setClickSound,
			confineToScreen: setConfineScreen,
			trayEnabled: setTrayEnabled,
			whisperImageEnabled: setWhisperImage,
			chatImageEnabled: setChatImage,
			chatAnimationEnabled: setChatAnimation
		};
		const setGlobalFlag = (key, value) => flagSetters[key](value);
		const setChatFlag = (key, value) => flagSetters[key](value);
		/** 局部补丁写入：字体与物理参数都是「整段对象 + 改几个字段」。 */
		const patchFont = (patch) => setFont((current$1) => ({
			...current$1,
			...patch
		}));
		const patchPhysics = (patch) => setPhysics((current$1) => ({
			...current$1,
			...patch
		}));
		/** 两个模型字段各有一份状态，卡片只回传键名。 */
		const setModel = (key, value) => {
			if (key === "whisperModel") setWhisperModel(value);
			else setChatModel(value);
		};
		const write = createWriteFlow({
			fields: () => ({
				pets: mainPets,
				notificationsEnabled: notifyEnabled$1,
				clickSoundEnabled: clickSound,
				whisperImageEnabled: whisperImage,
				chatImageEnabled: chatImage,
				chatAnimationEnabled: chatAnimation,
				confineToScreen: confineScreen,
				trayEnabled,
				voiceEnabled: voiceEnabled$1,
				voiceName: voiceName$1,
				voiceVolume: voiceVolume$1,
				voiceWhisperEnabled,
				voiceTodoEnabled,
				physics,
				whisperModel,
				chatModel,
				chatMemoryRounds: chatMemory,
				chatImageLimit,
				font
			}),
			busy: () => busy,
			setBusy,
			setMsg,
			setDialog,
			dialog: () => dialog,
			applyConfig,
			packWrites,
			userFile: () => paths?.user ?? "",
			t,
			onRemove: remove
		});
		const saveRef = useRef(() => {});
		useEffect(() => {
			saveRef.current = () => void write.save();
		});
		useEffect(() => {
			const onKey = (e) => {
				if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
				if (e.key.toLowerCase() !== "s") return;
				const root = rootRef.current;
				if (!root || !root.isConnected || root.getClientRects().length === 0) return;
				e.preventDefault();
				saveRef.current();
			};
			document.addEventListener("keydown", onKey);
			return () => document.removeEventListener("keydown", onKey);
		}, []);
		return h("section", {
			ref: rootRef,
			className: "dsh-pet-cfg",
			style: { maxWidth: "720px" },
			children: [
				h("h2", {
					className: "dsh-pet-cfg__title",
					children: [t("nav"), q(packCount > 0 ? t("intro") + "\n" + t("extraPetsHint").replace("{n}", String(packCount)) : t("intro"))]
				}),
				h(LoadStatus, {
					loadState,
					onRetry: retry
				}),
				h(KindTabs, {
					kinds,
					kind,
					busy,
					onSelect: selectKind
				}),
				h(PetTabs, {
					pets: visiblePets,
					selId,
					busy,
					onSelect: select,
					onAdd: add
				}),
				h(PetCard, {
					pet: cur,
					busy,
					msg,
					entryPrompt,
					onChange: update,
					onSave: () => void write.save(),
					onRemove: requestRemove
				}),
				h(GlobalCard, {
					busy,
					values: globalFlags,
					onChange: setGlobalFlag
				}),
				h(VoiceCard, {
					busy,
					enabled: voiceEnabled$1,
					voiceName: voiceName$1,
					volume: voiceVolume$1,
					voices: voiceOptions,
					whisperEnabled: voiceWhisperEnabled,
					todoEnabled: voiceTodoEnabled,
					onToggle: setVoiceEnabled,
					onVoiceChange: setVoiceName,
					onVolumeChange: setVoiceVolume,
					onWhisperToggle: setVoiceWhisperEnabled,
					onTodoToggle: setVoiceTodoEnabled
				}),
				h(FontCard, {
					busy,
					font,
					onChange: patchFont
				}),
				h(ModelCard, {
					busy,
					catalog,
					failed: catalogFailed,
					whisperModel,
					chatModel,
					onModelChange: setModel,
					chatMemory,
					chatImageLimit,
					onChatMemoryChange: setChatMemory,
					onChatImageLimitChange: setChatImageLimit,
					values: chatFlags,
					onFlagChange: setChatFlag
				}),
				h(PhysicsCard, {
					busy,
					physics,
					onChange: patchPhysics
				}),
				h(MobileCard, {
					busy,
					physics,
					onChange: patchPhysics
				}),
				h(Actions, {
					busy,
					msg,
					permMsg,
					onSave: () => void write.save(),
					onSync: write.requestSync,
					onTestNotification: testNotification
				}),
				h(ShortcutsCard, {}),
				paths ? h(ConfigMetaCard, { paths }) : null,
				paths ? h(StorageCard, { paths }) : null,
				dialog ? h(SettingsDialog, {
					dialog,
					selId,
					onDismiss: () => setDialog(null),
					onConfirm: write.confirmDialog
				}) : null
			]
		});
	};
}

//#endregion
//#region src/client/pet/click-sound.ts
/** 音效文件地址。 */
const CLICK_SOUND_URL = ROUTE_PATH + "/sound/click-duck.wav";
/** 音量：与其余提示音同一档，不抢對話内容。 */
const CLICK_SOUND_VOLUME = .5;
/** 连点节流：100ms 内只响一次，避免连点变成噪音。 */
const CLICK_SOUND_THROTTLE_MS = 100;
/** 复用的 audio 实例，首次播放时创建。 */
let clickAudio = null;
/** 上一次真正播放的时间戳（ms）。 */
let lastClickSoundAt = 0;
/** 点击音效开关；配置未加载前保守静音。 */
let clickSoundEnabled = false;
function setClickSoundEnabled(enabled) {
	clickSoundEnabled = enabled;
}
function playClickSound() {
	if (!clickSoundEnabled) return;
	const now = Date.now();
	if (now - lastClickSoundAt < CLICK_SOUND_THROTTLE_MS) return;
	lastClickSoundAt = now;
	try {
		clickAudio ?? (clickAudio = new Audio(CLICK_SOUND_URL));
		clickAudio.volume = CLICK_SOUND_VOLUME;
		clickAudio.currentTime = 0;
		clickAudio.play().catch(() => {});
	} catch {}
}

//#endregion
//#region src/client/menu-service.ts
/** owner → 本页可见的 label 列表（来源是 /state 的 sections.menu 快照）。 */
const labels = new Map();
/** owner → 每项的点击闩锁（连点两次同一条只留最后一次，与宿主一致）。 */
const marks = new Map();
function setMenuItems(items) {
	labels.clear();
	for (const item of items) {
		const list = labels.get(item.owner);
		if (list === void 0) labels.set(item.owner, [item.label]);
		else if (!list.includes(item.label)) list.push(item.label);
	}
	for (const [owner, entry] of marks) {
		const list = labels.get(owner);
		if (list === void 0) {
			marks.delete(owner);
			continue;
		}
		for (const label of [...entry.keys()]) if (!list.includes(label)) entry.delete(label);
	}
}
function setMenuClick(owner, label, pet) {
	let entry = marks.get(owner);
	if (entry === void 0) {
		entry = new Map();
		marks.set(owner, entry);
	}
	entry.set(label, pet);
}
function takeMenuEvents(owner) {
	const list = labels.get(owner);
	if (list === void 0) return {
		ok: false,
		reason: "unknown-owner"
	};
	const entry = marks.get(owner);
	const events = {};
	for (const label of list) {
		events[label] = entry?.get(label) ?? null;
		entry?.set(label, null);
	}
	return {
		ok: true,
		events
	};
}

//#endregion
//#region src/client/pet/menu-actions.ts
/** 顯示位置：写配置后宿主回成品聚合，交给容器重渲染。 */
async function switchDisplay(deps, display) {
	try {
		const response = await fetch(ROUTE_PATH + "/pet-display", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				id: deps.petId,
				display
			})
		});
		if (!response.ok) throw new Error("pet-display HTTP " + response.status);
		const body = await response.json();
		if (body.ok === false) throw new Error("pet-display 被拒：" + String(body.reason ?? ""));
		deps.applyMerged(body);
	} catch (error) {
		deps.warn("[dsh-pet] 顯示位置切換失敗 " + (error instanceof Error ? error.message : String(error)));
	}
}
function createMenuActions(deps) {
	const { petId } = deps;
	/** 動作端点：POST 一次，失败只留一行 warn——结果由 /state 送回，这里没有返回值可用。 */
	const fireAction = (route, label) => {
		postAction(route).then((ok) => {
			if (!ok) deps.warn("[dsh-pet] " + label + "失敗 pet=" + petId);
		}).catch((error) => deps.warn("[dsh-pet] " + label + "異常 pet=" + petId + " " + String(error)));
	};
	const run = (leaf$1, playbackId, keepFacing = false, hostInstruction = false) => {
		if (!hostInstruction && deps.sleeping?.() === true && deps.locked?.() !== true && !isSleepAllowedAction(leaf$1.action)) {
			const pool = deps.sleepRefuseTexts?.() ?? [];
			const text = pool[Math.floor(Math.random() * pool.length)];
			if (text !== void 0) deps.say?.(text);
			return;
		}
		if (leaf$1.action === "third-party") {
			const owner = leaf$1.owner ?? "";
			if (owner !== "") {
				setMenuClick(owner, leaf$1.label, petId);
				postAction(ROUTE_PATH + "/menu/click", {
					owner,
					label: leaf$1.label,
					pet: petId
				}).catch((error) => deps.warn("[dsh-pet] 第三方選單點擊回報失敗 " + String(error)));
			}
			return;
		}
		if (leaf$1.action === "sleep" || leaf$1.action === "wake") {
			const route = leaf$1.action === "sleep" ? "/sleep" : "/wake";
			console.info("[dsh-pet] 菜單" + (leaf$1.action === "sleep" ? "睡覺" : "起來") + " pet=" + petId);
			fireAction(ROUTE_PATH + route + "?pet=" + encodeURIComponent(petId), leaf$1.action === "sleep" ? "睡覺" : "起來");
			return;
		}
		if (leaf$1.action === "show-balance") {
			console.info("[dsh-pet] 菜單查看餘額 pet=" + petId);
			fireAction(ROUTE_PATH + "/balance", "餘額刷新動作");
			return;
		}
		if (leaf$1.action === "whisper") {
			console.info("[dsh-pet] 菜單觸發碎碎念 pet=" + petId + (leaf$1.image ? " image=" + leaf$1.image : ""));
			const pic = leaf$1.image ? "&image=" + encodeURIComponent(leaf$1.image) : "";
			fireAction(ROUTE_PATH + "/whisper?pet=" + encodeURIComponent(petId) + "&surface=web" + pic, "碎碎念手動觸發");
			return;
		}
		if (leaf$1.action === "chat") {
			deps.openChat();
			return;
		}
		if (leaf$1.action === "todo") {
			deps.openTodo();
			return;
		}
		if (leaf$1.action === "set-display") {
			const display = leaf$1.display;
			if (!display) return;
			console.info("[dsh-pet] 菜單切換顯示位置 pet=" + petId + " display=" + display);
			switchDisplay(deps, display);
			return;
		}
		if (leaf$1.action === "home") {
			deps.stopThrow();
			deps.stopMove();
			deps.resetPosition();
			return;
		}
		if (!leaf$1.anim) return;
		const cuePlaybackId = playbackId ?? null;
		if (!keepFacing && isNoMirrorAnimation(deps.animations().categories, leaf$1.anim) && deps.isFacingRight()) deps.faceLeft();
		const movies = deps.animations().moves.actions;
		if (movies.some((action) => action.name === leaf$1.anim)) {
			if (deps.tryMove(leaf$1.anim) === false) {
				deps.stopMove();
				deps.playOnce(leaf$1.anim, cuePlaybackId);
			} else if (cuePlaybackId !== null) deps.report(cuePlaybackId, "failed", "busy");
			return;
		}
		deps.stopMove();
		deps.playOnce(leaf$1.anim, cuePlaybackId);
	};
	return { run };
}

//#endregion
//#region src/client/pet/playback-report.ts
function playbackReportRequest(playbackId, status, reason) {
	return {
		url: ROUTE_PATH + "/playback/" + encodeURIComponent(playbackId) + "/report",
		body: reason === void 0 ? { status } : {
			status,
			reason
		}
	};
}
function makePlaybackReporter(o) {
	return (playbackId, status, reason) => {
		const request = playbackReportRequest(playbackId, status, reason);
		postAction(request.url, request.body).then((ok) => {
			if (!ok) console.warn("[dsh-pet] 播放回執未送達 pet=" + o.petId + " id=" + playbackId + " status=" + status);
		});
	};
}

//#endregion
//#region src/client/pet/animation/next-animation.ts
function decideNextAnimation(input) {
	const { kind, animations, facing, current: current$1, move } = input;
	if (kind === "idle") return {
		kind: "IDLE",
		anim: pick(animations.idle, current$1),
		play: true
	};
	if (kind === "turn") return {
		kind: "TURN",
		anim: pick(animations.turn, current$1),
		play: true
	};
	if (kind === "move" && move !== false && move !== void 0) return {
		kind: "MOVES",
		anim: typeof move === "string" ? move : null,
		play: false
	};
	const action = pickCategoryAction(animations.categories, animations.idle, facing, current$1);
	return {
		kind: action.id,
		anim: action.name,
		play: true
	};
}

//#endregion
//#region src/client/pet/card/sleep-machine.ts
function createSleepMachine(hub, pickNext, log$3) {
	let current$1 = null;
	/** 换一段：`once` 决定播完是否触发 ended（循环段必须 false）。 */
	const play = (name, once) => {
		hub.card.actions.setOnce(once);
		hub.card.actions.setAnim(name);
		hub.card.actions.bumpSeq();
	};
	const apply = (state) => {
		const petId = hub.cfg().id;
		if (state.sleeping) {
			if (current$1 !== null) return;
			hub.stopMotion();
			hub.bubbles.hideWork();
			current$1 = {
				set: {
					start: state.start,
					loop: state.loop,
					end: state.end
				},
				phase: "start"
			};
			log$3(petId, "睡覺 -> [" + state.start + "]");
			play(state.start, true);
			return;
		}
		if (current$1 === null || current$1.phase === "end") return;
		if (current$1.phase === "start") {
			current$1 = null;
			log$3(petId, "入睡被打斷：不播起來");
			return;
		}
		current$1.phase = "end";
		log$3(petId, "醒來 -> [" + current$1.set.end + "]");
		play(current$1.set.end, true);
	};
	return {
		apply,
		consumeEnded: () => {
			if (current$1 === null) return false;
			if (current$1.phase === "start") {
				current$1.phase = "loop";
				play(current$1.set.loop, false);
				return true;
			}
			if (current$1.phase === "loop") {
				play(current$1.set.loop, false);
				return true;
			}
			current$1 = null;
			pickNext();
			return true;
		},
		sleeping: () => current$1 !== null,
		phase: () => current$1?.phase ?? null
	};
}

//#endregion
//#region src/client/pet/card/animation-flow.ts
/** 日志行的时刻前缀。 */
const stamp$3 = () => new Date().toTimeString().slice(0, 8);
/** 一行带时刻与宠物 id 的日志。 */
const log$2 = (petId, message) => {
	console.log("[dsh-pet] " + stamp$3() + " pet=" + petId + " " + message);
};
function createAnimationFlow(rt) {
	const { useRef } = rt;
	return function useAnimationFlow(hub, workStatus) {
		const workStatusRef = useRef(workStatus);
		workStatusRef.current = workStatus;
		const machineRef = useRef(null);
		const sleep$1 = () => machineRef.current ?? (machineRef.current = createSleepMachine(hub, pickNext, log$2));
		/** 此刻是否在睡（含两段过渡）。 */
		const sleeping = () => sleep$1().sleeping();
		/** 当前睡觉阶段；醒着为 null。 */
		const sleepPhase = () => sleep$1().phase();
		/** 应用宿主写的睡覺状态（转发给状态机）。 */
		const applySleep = (state) => sleep$1().apply(state);
		/** 非终态工作状态回到档位循环；冻结、空闲与终态都返回 false。 */
		const resumeWorkStatusAnim = () => {
			const card = hub.card;
			if (hub.ownAnim.isFrozen()) return false;
			if (sleeping()) return false;
			const ws = workStatusRef.current;
			if (!ws || !ws.state || ws.state === "success" || ws.state === "error") return false;
			const pool = hub.anims().events?.workStatus;
			if (!pool || pool.length === 0) return false;
			const idx = WORK_STATUS_INDEX[ws.state];
			const slot = pool[idx];
			if (slot === void 0) return false;
			const name = pickSlot(slot, card.animRef.current);
			log$2(hub.cfg().id, "互動結束恢復狀態動畫: " + name);
			card.actions.setOnce(Array.isArray(slot) && slot.length > 1);
			card.actions.setAnim(name);
			return true;
		};
		/** 按权重掷骰选择下一段自播动画。 */
		const pickNext = () => {
			const card = hub.card;
			if (hub.ownAnim.isFrozen()) return;
			if (sleeping()) return;
			const roll = Math.random();
			const kind = rollKind(roll, hub.cfg().animationWeights, { fixed: hub.cfg().fixedEnabled });
			const move = kind === "move" ? hub.tryWalk() : void 0;
			const decision = decideNextAnimation({
				kind,
				animations: hub.anims(),
				facing: card.facingRef.current,
				current: card.animRef.current,
				move
			});
			log$2(hub.cfg().id, "facing=" + card.facingRef.current + " roll=" + roll.toFixed(4) + " -> [" + decision.kind + "] " + (decision.anim ?? "移動進行中(不重播)"));
			if (decision.play && decision.anim !== null) card.actions.setAnim(decision.anim);
			card.actions.setOnce(true);
			card.actions.bumpSeq();
		};
		/** 按播完判定改状态。 */
		const applyEndedCue = (cue) => {
			const card = hub.card;
			if (sleep$1().consumeEnded()) return;
			if (cue.kind === "ignore") return;
			if (cue.kind === "work-rotate") {
				card.actions.setOnce(true);
				card.actions.setAnim(cue.anim);
				card.actions.bumpSeq();
				return;
			}
			if (cue.kind === "work-replay") {
				card.actions.setOnce(false);
				card.actions.bumpSeq();
				return;
			}
			if (cue.kind === "event-done") {
				if (resumeWorkStatusAnim()) return;
				if (hub.anims().idle.length) card.actions.setAnim(pick(hub.anims().idle, card.animRef.current));
				card.actions.setOnce(true);
				card.actions.bumpSeq();
				return;
			}
			if (cue.kind === "turn") {
				const next = card.state.facing === "left" ? "right" : "left";
				card.actions.setFacing(next);
				card.facingRef.current = next;
				return;
			}
			if (cue.kind === "interaction-done") {
				if (resumeWorkStatusAnim()) return;
				if (hub.anims().idle.length) card.actions.setAnim(pick(hub.anims().idle, card.animRef.current));
				card.actions.setOnce(true);
				card.actions.bumpSeq();
				return;
			}
			pickNext();
		};
		/** 说一句：抽碎碎念动画并弹气泡，兩者独立。 */
		const speak$1 = (text, image, url, duration, anim) => {
			const card = hub.card;
			let name = null;
			if (anim !== false && !sleeping()) {
				const pool = hub.anims().events?.whisper;
				if (!pool || pool.length === 0) {
					console.error("[dsh-pet] 設定缺少 animations.events.whisper，無法播放碎碎念動畫");
					return;
				}
				name = pickSlot(pick(pool, card.animRef.current), card.animRef.current);
			}
			log$2(hub.cfg().id, "whisper" + (name === null ? " （不聯動動畫）" : " -> [" + name + "]") + " 「" + text + "」");
			if (name !== null) {
				hub.stopMotion();
				card.actions.setOnce(true);
				card.actions.setAnim(name);
			}
			hub.bubbles.showWhisper(text, {
				image,
				url
			}, duration);
		};
		return {
			applyEndedCue,
			applySleep,
			pickNext,
			resumeWorkStatusAnim,
			sleepPhase,
			sleeping,
			speak: speak$1
		};
	};
}

//#endregion
//#region src/shared/voice.ts
/** 当前音色；空串 = 不指定，由宿主用默认音色。 */
let voiceName = "";
/** 播报总开关；只有成品配置明确为 true 才播。 */
let voiceEnabled = false;
/** 播放音量系数（0–1，1 = 最大音量）；两端共用，只作用于播放，不影响已合成好的音频。 */
let voiceVolume = 1;
/** 本端是网页端还是桌面端；`null` = 还没声明，此时不按叶子播放。 */
let surface = null;
/** 接口基址：网页端是同源前缀，桌面端由 `setVoiceBase` 换成 bridge 地址。 */
let voiceBase = ROUTE_PATH;
/** 配置是否已就绪；网页端由 `setVoiceConfig` 置位，桌面端首次播放时懒加载。 */
let configLoaded = false;
/** 当前播报状态；气泡据此显示图标。 */
let voiceState = "idle";
/** 状态订阅者：两端的说话气泡据此渲染图标。 */
const stateListeners = new Set();
/**
* 客户端等合成结果的上限（ms）。
*
* 比宿主侧第三方合成的超时（15s）再宽一点：让宿主先超时并回结构化失败，
* 客户端这道只是兜底，避免上游挂住时气泡上的转圈永远停不下来。
*/
const SPEAK_TIMEOUT_MS = 2e4;
/** 合成请求的超时信号；自动播报与手动点播共用同一份口径。 */
function speakSignal() {
	return AbortSignal.timeout(SPEAK_TIMEOUT_MS);
}
/** 切换状态并通知订阅者；同值不重复通知。 */
function setVoiceState(next) {
	if (voiceState === next) return;
	voiceState = next;
	for (const listener of stateListeners) listener(next);
}
function subscribeVoiceState(listener) {
	stateListeners.add(listener);
	listener(voiceState);
	return () => {
		stateListeners.delete(listener);
	};
}
function setSurface(next) {
	if (next === "web" || next === "desktop") surface = next;
}
function setVoiceConfig(name, enabled, volume) {
	voiceName = typeof name === "string" ? name : "";
	voiceEnabled = enabled === true;
	voiceVolume = clampVolume(volume);
	configLoaded = true;
}
/** 把音量收敛到 0–1；非数值按最大音量（1）处理——脏配置不该把声音悄悄变成 0。 */
function clampVolume(value) {
	const n = Number(value);
	return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1;
}
/** 懒加载成品配置；失败按「不播」处理，且只试一次（避免每句都发请求）。 */
async function loadConfigOnce() {
	if (configLoaded) return;
	try {
		const response = await fetch(voiceBase + "/config", { cache: "no-store" });
		const body = await response.json();
		const main = body?.main;
		voiceName = typeof main?.voiceName === "string" ? main.voiceName : "";
		voiceEnabled = main?.voiceEnabled === true;
		voiceVolume = clampVolume(main?.voiceVolume);
		configLoaded = true;
	} catch {}
}
function playSayVoice(say) {
	const isMine = say.voiceTo !== void 0 && say.voiceTo === surface;
	if (!say.text || !isMine) {
		setVoiceState("idle");
		return;
	}
	if (surface === "web" && typeof document !== "undefined" && document.hidden) {
		setVoiceState("idle");
		return;
	}
	speakIfEnabled(say.text);
}
/** 确认配置后再播；桌面端首次调用会顺手拉一次 `/config`。 */
async function speakIfEnabled(text) {
	await loadConfigOnce();
	if (!voiceEnabled) {
		setVoiceState("idle");
		return;
	}
	setVoiceState("loading");
	await speak(text);
}
/** 请求合成并播放；任何一步失败都落到 `failed`（气泡上留一个静音喇叭，而不是干脆没图标）。 */
async function speak(text) {
	try {
		const response = await fetch(voiceBase + "/voice/speak", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				text,
				...voiceName ? { voice: voiceName } : {}
			}),
			signal: speakSignal()
		});
		if (!response.ok || !(response.headers.get("content-type") ?? "").includes("audio")) {
			setVoiceState("failed");
			return;
		}
		const objectUrl = URL.createObjectURL(await response.blob());
		const audio = new Audio(objectUrl);
		audio.volume = voiceVolume;
		audio.onended = () => URL.revokeObjectURL(objectUrl);
		audio.onerror = () => URL.revokeObjectURL(objectUrl);
		setVoiceState("ready");
		await audio.play();
	} catch {
		setVoiceState("failed");
	}
}
/** 手动点播时正在响的那个音频；新的一句先掐掉旧的，避免两句话叠在一起。 */
let manualAudio = null;
/** 手动点播的世代号：新的点播会作废旧请求的阶段回调，避免旧回调清掉新状态。 */
let manualSeq = 0;
function speakText(text, onPhase) {
	if (!text) return;
	playManual(text, onPhase);
}
/** 请求合成并播放手动点播；失败静默，不打断面板交互。 */
async function playManual(text, onPhase) {
	const token = ++manualSeq;
	await loadConfigOnce();
	if (manualAudio) {
		manualAudio.pause();
		manualAudio = null;
	}
	if (token !== manualSeq) return;
	onPhase?.("loading");
	try {
		const response = await fetch(voiceBase + "/voice/speak", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				text,
				...voiceName ? { voice: voiceName } : {}
			}),
			signal: speakSignal()
		});
		if (token !== manualSeq) return;
		if (!response.ok || !(response.headers.get("content-type") ?? "").includes("audio")) {
			onPhase?.("failed");
			return;
		}
		const objectUrl = URL.createObjectURL(await response.blob());
		if (token !== manualSeq) return;
		const audio = new Audio(objectUrl);
		audio.volume = voiceVolume;
		audio.onended = () => {
			URL.revokeObjectURL(objectUrl);
			if (manualAudio === audio) {
				manualAudio = null;
				onPhase?.("idle");
			}
		};
		audio.onerror = () => URL.revokeObjectURL(objectUrl);
		manualAudio = audio;
		onPhase?.("playing");
		await audio.play();
	} catch {
		if (token === manualSeq) onPhase?.("failed");
	}
}

//#endregion
//#region src/client/pet/timings.ts
const BUBBLE_DURATION_MS = 10 * 1e3;
const STATE_WAIT_MS = 1e3;
const STATE_FALLBACK_MS = 1e3;

//#endregion
//#region src/client/pet/card/bubble-slots.ts
function decideBubbleSlot(input) {
	if (input.todoOn) return "todo";
	if (input.workTerminal && input.workOn && input.workText && input.workStatusEnabled) return "work-terminal";
	if (input.whisperOn && input.whisperText) return "whisper";
	if (input.balanceOn && input.balanceAvailable && (input.balanceEnabled || input.balanceManual)) return "balance";
	if (input.workOn && input.workText && input.workStatusEnabled) return "work";
	return "none";
}
function balancePageCount(balance) {
	return balance ? balancePageCount$1(balance) : 1;
}
function createBubbleSlots(rt, components) {
	const { h, useState, useRef, useEffect } = rt;
	const BalanceBubble = components.balanceBubble;
	const TodoBubble = components.todoBubble;
	const WhisperBubble = components.whisperBubble;
	return function useBubbleSlots(input) {
		const [balanceOn, setBalanceOn] = useState(false);
		const [balancePage, setBalancePage] = useState(0);
		const balanceTimerRef = useRef(null);
		const [whisperOn, setWhisperOn] = useState(false);
		const [whisperText, setWhisperText] = useState(null);
		const [whisperImage, setWhisperImage] = useState(void 0);
		const [whisperUrl, setWhisperUrl] = useState(void 0);
		const whisperTimerRef = useRef(null);
		const [todoOn, setTodoOn] = useState(false);
		const [workOn, setWorkOn] = useState(false);
		const [workText, setWorkText] = useState(null);
		const workTimerRef = useRef(null);
		const [voiceState$1, setVoiceState$1] = useState("idle");
		useEffect(() => subscribeVoiceState(setVoiceState$1), []);
		useEffect(() => () => {
			if (balanceTimerRef.current !== null) window.clearTimeout(balanceTimerRef.current);
			if (whisperTimerRef.current !== null) window.clearTimeout(whisperTimerRef.current);
			if (workTimerRef.current !== null) window.clearTimeout(workTimerRef.current);
		}, []);
		/** 重置餘額气泡的停留计时；重复触发先清旧定时器，否则旧的会提前收起。 */
		const armBalanceTimeout = () => {
			if (balanceTimerRef.current !== null) window.clearTimeout(balanceTimerRef.current);
			balanceTimerRef.current = window.setTimeout(() => setBalanceOn(false), BUBBLE_DURATION_MS);
		};
		const showBalance = () => {
			setBalancePage(0);
			setBalanceOn(true);
			armBalanceTimeout();
		};
		const cycleBalance = () => {
			const pages = balancePageCount(input.balance);
			setBalancePage((page) => (page + 1) % pages);
			armBalanceTimeout();
		};
		const showWhisper = (text, parts, duration) => {
			if (duration === 0) return;
			setWhisperText(text);
			setWhisperImage(parts.image);
			setWhisperUrl(parts.url);
			setWhisperOn(true);
			if (whisperTimerRef.current !== null) window.clearTimeout(whisperTimerRef.current);
			whisperTimerRef.current = window.setTimeout(() => setWhisperOn(false), duration ?? BUBBLE_DURATION_MS);
		};
		const clearWhisper = () => {
			if (whisperTimerRef.current !== null) window.clearTimeout(whisperTimerRef.current);
			whisperTimerRef.current = null;
			setWhisperOn(false);
			setWhisperText(null);
			setWhisperImage(void 0);
		};
		const lightWork = (terminal) => {
			setWorkOn(true);
			if (workTimerRef.current !== null) window.clearTimeout(workTimerRef.current);
			workTimerRef.current = terminal ? window.setTimeout(() => setWorkOn(false), BUBBLE_DURATION_MS) : null;
		};
		const hideWork = () => {
			if (workTimerRef.current !== null) window.clearTimeout(workTimerRef.current);
			workTimerRef.current = null;
			setWorkOn(false);
		};
		const resetWork = () => {
			hideWork();
			setWorkText(null);
		};
		const showTodo = () => setTodoOn(true);
		const hideTodo = () => setTodoOn(false);
		const toggleTodo = () => setTodoOn((on) => !on);
		const node = () => {
			const slot = decideBubbleSlot({
				todoOn,
				workTerminal: input.workTerminal,
				workOn,
				workText,
				workStatusEnabled: input.workStatusEnabled,
				whisperOn,
				whisperText,
				balanceOn,
				balanceAvailable: input.balance !== null,
				balanceEnabled: input.balanceEnabled,
				balanceManual: input.balanceManual
			});
			if (slot === "todo") return h(TodoBubble, {
				on: todoOn,
				onClose: hideTodo
			});
			if (slot === "balance") return input.balance === null ? null : h(BalanceBubble, {
				state: input.balance,
				on: balanceOn,
				index: balancePage,
				onCycle: cycleBalance
			});
			if (slot === "whisper") return whisperText === null ? null : h(WhisperBubble, {
				text: whisperText,
				image: whisperImage,
				url: whisperUrl,
				assetRoot: input.assetRoot,
				on: whisperOn,
				voiceState: voiceState$1
			});
			if (slot === "work" || slot === "work-terminal") return workText === null ? null : h(WhisperBubble, {
				text: workText,
				on: workOn
			});
			return null;
		};
		return {
			clearWhisper,
			cycleBalance,
			hideTodo,
			hideWork,
			lightWork,
			node,
			resetWork,
			showBalance,
			showTodo,
			showWhisper,
			toggleTodo,
			updateWorkText: setWorkText
		};
	};
}

//#endregion
//#region src/client/pet/animation/cues.ts
/** 工作状态是否处在「非终态」：终态（success / error）与空闲都不要续播档位动画。 */
const isWorkActive = (state) => state !== null && state !== void 0 && state !== "success" && state !== "error";
function decideEndedCue(input) {
	const { animations, current: current$1, workState } = input;
	const isEvent = isEventAnim(animations.events, current$1);
	if (isEvent && isWorkActive(workState)) {
		const nextWork = nextWorkStatusAnim(animations.events?.workStatus ?? [], current$1);
		if (nextWork !== null) return {
			kind: "work-rotate",
			anim: nextWork
		};
		if (poolIncludes(animations.events?.workStatus ?? [], current$1)) return { kind: "work-replay" };
	}
	if (isEvent) return { kind: "event-done" };
	if (animations.turn.includes(current$1)) return { kind: "turn" };
	if (animations.drag.includes(current$1) || animations.clicks.includes(current$1)) return { kind: "interaction-done" };
	return { kind: "random" };
}

//#endregion
//#region src/client/pet/animation/asset-loader.ts
function createAssetLoader(timeoutMs) {
	/** 在途请求：销毁时统一中断，否则卸载后完成的响应会创建无人回收的地址。 */
	const inflight = new Set();
	return {
		load: (url, handlers) => {
			const controller = new AbortController();
			inflight.add(controller);
			const timer = window.setTimeout(() => controller.abort(), timeoutMs);
			const settle = () => {
				window.clearTimeout(timer);
				inflight.delete(controller);
			};
			fetch(url, {
				cache: "default",
				signal: controller.signal
			}).then((response) => {
				if (!response.ok) throw new Error("asset HTTP " + response.status);
				return response.blob();
			}).then((blob) => {
				settle();
				handlers.onObjectUrl(URL.createObjectURL(blob));
			}).catch((error) => {
				settle();
				handlers.onError(error);
			});
		},
		abortAll: () => {
			for (const controller of inflight) controller.abort();
			inflight.clear();
		},
		release: (objectUrl) => {
			URL.revokeObjectURL(objectUrl);
		}
	};
}

//#endregion
//#region src/client/pet/animation/assets.ts
function animationAssetUrl(source) {
	if (source.cueUrl) return source.cueUrl;
	const root = source.assetRoot === "" ? source.id : source.assetRoot;
	return ROUTE_PATH + "/thumb/" + encodeURIComponent(root) + "/" + encodeURIComponent(source.anim) + source.ext;
}

//#endregion
//#region src/client/pet/animation/media.ts
/** 本次会话已定论的扩展名，`null` = 尚未判断。 */
let resolvedExt = null;
function prefersMov() {
	const ua = navigator.userAgent;
	if (/iPhone|iPad|iPod/i.test(ua)) return true;
	if (/Chrome|Chromium|Edg|OPR|Firefox|FxiOS/i.test(ua)) return false;
	return /Mac/i.test(navigator.platform || ua);
}
function thumbExt() {
	if (resolvedExt === null) {
		const explicit = ANIMATION_EXT;
		resolvedExt = explicit === ".mov" || prefersMov() ? ".mov" : ".webm";
	}
	return resolvedExt;
}

//#endregion
//#region src/client/pet/animation/animation.ts
/** 换源失败与打断的原因，落进回执的 `reason` 字段。 */
const REASON_ASSET_LOAD = "asset-load";
const REASON_PLAY_REJECTED = "play-rejected";
const REASON_DECODE = "decode-error";
const REASON_SUPERSEDED = "superseded";
const REASON_FROZEN = "frozen";
/** 资源超时（ms）：DSH WebServer 偶发 stalled，超时就丢弃本次换源。 */
const ASSET_FETCH_TIMEOUT_MS = 1e4;
/** 日志时间戳：与其余宠物日志同一格式，便于对照同一次事件。 */
const stamp$2 = (petId) => new Date().toTimeString().slice(0, 8) + " pet=" + petId;
function createOwnAnimation(deps) {
	/** 当前前台槽位：0 = A，1 = B。 */
	let front = 0;
	/** 挂起的换源；`null` = 没有换源在等首帧。 */
	let pending = null;
	/** 换源世代号，只增不减。 */
	let gen = 0;
	/** 待消费的点播地址，一次性取走。 */
	let cueUrl = null;
	/** 正在播的点播编号。 */
	let playing = null;
	/** 冻结标志：只挡自动来源，显式指令照常。 */
	let frozen = deps.initiallyFrozen;
	/** 两个槽位各自的 blob 地址，换源时先释放旧的。 */
	const blobUrl = {
		a: null,
		b: null
	};
	const loader = deps.loader ?? createAssetLoader(ASSET_FETCH_TIMEOUT_MS);
	/** 挂载标志：卸载后迟到的加载结果直接丢弃。 */
	let mounted = true;
	const slotOf = (index) => index === 0 ? "a" : "b";
	const elementOf = (index) => index === 0 ? deps.videoA() : deps.videoB();
	const frontVideo = () => elementOf(front);
	/** 上报并清掉「正在播」的编号；`keep` 为真时不清（同一编号继续播）。 */
	const reportOnce = (playbackId, status, reason) => {
		if (playing === playbackId) playing = null;
		deps.report(playbackId, status, reason);
	};
	const switchTo = (next, nextOnce, cuePlaybackId) => {
		if (cuePlaybackId !== null) deps.clearCuePlayback();
		const cfg = deps.cfg();
		const url = cueUrl;
		cueUrl = null;
		if (next === "") return;
		if (pending !== null && pending.anim === next && pending.once === nextOnce) {
			if (cuePlaybackId !== null) {
				playing = cuePlaybackId;
				deps.report(cuePlaybackId, "playing");
			}
			return;
		}
		if (isEventAnim(cfg.animations.events, next)) console.log("[dsh-pet] " + stamp$2(cfg.id) + " switch " + next + " once=" + nextOnce);
		const swapGen = gen += 1;
		pending = {
			anim: next,
			once: nextOnce,
			gen: swapGen
		};
		const targetIndex = front === 0 ? 1 : 0;
		const el = elementOf(targetIndex);
		if (el === null) return;
		el.loop = !nextOnce;
		el.muted = true;
		el.autoplay = true;
		el.playsInline = true;
		el.onended = nextOnce ? (event) => deps.onEnded(handleEnded(event)) : null;
		el.onerror = cuePlaybackId === null ? null : () => reportOnce(cuePlaybackId, "failed", REASON_DECODE);
		const assetUrl = animationAssetUrl({
			cueUrl: url,
			assetRoot: cfg.assetRoot ?? "",
			id: cfg.id,
			anim: next,
			ext: thumbExt()
		});
		loader.load(assetUrl, {
			onObjectUrl: (objectUrl) => {
				if (!mounted) {
					loader.release(objectUrl);
					return;
				}
				if (pending?.gen !== swapGen) {
					loader.release(objectUrl);
					return;
				}
				const slot = slotOf(targetIndex);
				const previous = blobUrl[slot];
				if (previous !== null) loader.release(previous);
				blobUrl[slot] = objectUrl;
				el.src = objectUrl;
				el.load();
			},
			onError: (error) => {
				if (!mounted) return;
				if (pending?.gen !== swapGen) return;
				pending = null;
				if (cuePlaybackId !== null) reportOnce(cuePlaybackId, "failed", REASON_ASSET_LOAD);
				console.warn("[dsh-pet] 素材載入失敗 pet=" + cfg.id + " anim=" + next + "：" + (error instanceof Error ? error.message : String(error)) + "（已釋放本次切換）");
			}
		});
		const onReady = () => {
			el.removeEventListener("loadeddata", onReady);
			if (pending?.gen !== swapGen) return;
			const outgoing = elementOf(front);
			el.classList.add("is-front");
			if (outgoing !== null && outgoing !== el) {
				outgoing.classList.remove("is-front");
				outgoing.onended = null;
				outgoing.onerror = null;
				outgoing.pause();
				if (playing !== null && playing !== cuePlaybackId) reportOnce(playing, "cancelled", REASON_SUPERSEDED);
			}
			front = front === 0 ? 1 : 0;
			pending = null;
			playing = cuePlaybackId;
			el.style.transform = deps.facing() === "right" ? "scaleX(-1)" : "";
			el.play().then(() => {
				if (cuePlaybackId !== null) deps.report(cuePlaybackId, "playing");
			}).catch(() => {
				if (cuePlaybackId !== null) reportOnce(cuePlaybackId, "failed", REASON_PLAY_REJECTED);
			});
			deps.onFrontReady(el);
		};
		el.addEventListener("loadeddata", onReady);
	};
	const handleEnded = (event) => {
		const endedOn = event === void 0 ? null : event.currentTarget;
		if (endedOn !== null && !endedOn.classList.contains("is-front")) return { kind: "ignore" };
		const done = playing;
		if (done !== null) {
			playing = null;
			deps.report(done, "ended");
		}
		if (deps.isDragging()) return { kind: "ignore" };
		if (frozen) return { kind: "ignore" };
		const cue = decideEndedCue({
			animations: deps.cfg().animations,
			current: deps.currentAnim(),
			workState: deps.workStatus()?.state
		});
		const petId = deps.cfg().id;
		if (cue.kind === "work-rotate") console.log("[dsh-pet] " + stamp$2(petId) + " workStatus 檔內輪換: " + deps.currentAnim() + " -> " + cue.anim);
		else if (cue.kind === "work-replay") console.log("[dsh-pet] " + stamp$2(petId) + " workStatus 循環續播: " + deps.currentAnim());
		else if (cue.kind === "event-done") console.log("[dsh-pet] " + stamp$2(petId) + " 事件動畫播完 ended anim=" + deps.currentAnim());
		return cue;
	};
	return {
		switchTo,
		handleEnded,
		stopLoopingFront: () => {
			const el = frontVideo();
			if (el === null) return;
			el.loop = false;
			el.onended = (event) => deps.onEnded(handleEnded(event));
		},
		setCueUrl: (url) => {
			cueUrl = url;
		},
		setFrozen: (next) => {
			if (frozen === next) return null;
			frozen = next;
			if (next) {
				frontVideo()?.pause();
				if (playing !== null) reportOnce(playing, "cancelled", REASON_FROZEN);
				return { kind: "frozen" };
			}
			return { kind: "resumed" };
		},
		isFrozen: () => frozen,
		frontVideo,
		playingPlayback: () => playing,
		dispose: () => {
			mounted = false;
			loader.abortAll();
			if (blobUrl.a !== null) loader.release(blobUrl.a);
			if (blobUrl.b !== null) loader.release(blobUrl.b);
			blobUrl.a = null;
			blobUrl.b = null;
		}
	};
}

//#endregion
//#region src/client/pose.ts
/** petId → 取当前实况的函数；PetCard 挂载时注册、卸载时摘除。 */
const readers$1 = new Map();
function registerPose(petId, read) {
	readers$1.set(petId, read);
	return () => {
		if (readers$1.get(petId) === read) readers$1.delete(petId);
	};
}
function readPose(petId) {
	if (typeof petId !== "string" || petId === "") return null;
	const read = readers$1.get(petId);
	return read === void 0 ? null : read();
}

//#endregion
//#region src/client/progress.ts
/** petId → 取当前进度的函数；PetCard 挂载时注册、卸载时摘除。 */
const readers = new Map();
function registerProgress(petId, read) {
	readers.set(petId, read);
	return () => {
		if (readers.get(petId) === read) readers.delete(petId);
	};
}
function readProgress(petId) {
	if (typeof petId !== "string" || petId === "") return null;
	const read = readers.get(petId);
	return read === void 0 ? null : read();
}

//#endregion
//#region src/client/pet/card/animation.ts
function createCardAnimation(rt) {
	const { useEffect, useRef } = rt;
	return function useCardAnimation(input) {
		const { card, cfgRef, live, pendingSquash, petId, workStatusRef } = input;
		const ownAnimRef = useRef(null);
		ownAnimRef.current ?? (ownAnimRef.current = createOwnAnimation({
			videoA: input.videoA,
			videoB: input.videoB,
			cfg: () => cfgRef.current,
			currentAnim: () => card.animRef.current,
			workStatus: () => workStatusRef.current,
			facing: () => card.facingRef.current,
			report: input.report,
			clearCuePlayback: () => input.setCuePlayback(null),
			onFrontReady: (el) => {
				if (pendingSquash.current) {
					pendingSquash.current = false;
					live.current.squash.start(el);
				}
				if (live.current.walk.hasPending()) live.current.walk.start(el);
			},
			onEnded: (cue) => live.current.flow?.applyEndedCue(cue),
			isDragging: () => live.current.drag.isActive(),
			initiallyFrozen: input.lock?.locked === true && input.lock.expiresAt > Date.now()
		}));
		const ownAnim = ownAnimRef.current;
		live.current.ownAnim = ownAnim;
		const { anim, cuePlayback, once, seq } = card.state;
		useEffect(() => {
			ownAnim.switchTo(anim, once, cuePlayback);
		}, [
			anim,
			once,
			seq,
			cuePlayback
		]);
		useEffect(() => {
			const services = live.current;
			const onResize = () => card.actions.setCustomPos((prev) => {
				if (!prev) return prev;
				const { size } = cfgRef.current;
				const { halfW, halfH, bottomPad } = derivePetMetrics(size);
				const viewport = {
					width: window.innerWidth,
					height: window.innerHeight
				};
				const half = {
					w: halfW,
					h: halfH
				};
				const box = centerToBox(prev, viewport, half);
				return { ...boxToRatio(clampReachableBox(box, viewport, {
					size,
					bottomPad
				}), viewport, half) };
			});
			window.addEventListener("resize", onResize);
			const unregisterPose = registerPose(petId, () => {
				const center = live.current.center();
				return {
					x: center.x / window.innerWidth,
					y: center.y / window.innerHeight,
					facing: card.facingRef.current
				};
			});
			const unregisterProgress = registerProgress(petId, () => {
				const el = ownAnim.frontVideo();
				const playbackId = ownAnim.playingPlayback();
				const anim$1 = card.animRef.current;
				if (el === null) return {
					playbackId,
					anim: anim$1,
					currentTime: 0,
					duration: 0,
					paused: true,
					buffering: false
				};
				const duration = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0;
				return {
					playbackId,
					anim: anim$1,
					currentTime: el.currentTime,
					duration,
					paused: el.paused,
					buffering: el.readyState < 3 || el.seeking
				};
			});
			return () => {
				window.removeEventListener("resize", onResize);
				unregisterPose();
				unregisterProgress();
				ownAnim.dispose();
				services.stopMove();
				services.drag.stopFollow();
				services.flight.stop();
				services.squash.stop();
			};
		}, []);
		return ownAnim;
	};
}

//#endregion
//#region src/shared/score.ts
const SCORE_MIN_SPEED = 400;
/** 每 100 px/s 记 1 分（基准尺寸 462px 下）。 */
const SCORE_SPEED_PER_POINT = 100;
const clickScore = (speed, size) => {
	if (speed <= 0 || size <= 0) return 0;
	return Math.max(1, Math.round(speed / SCORE_SPEED_PER_POINT * (PET_REF_WIDTH / size)));
};

//#endregion
//#region src/shared/score-popup.ts
const SCORE_POPUP_DURATION_MS = 2200;
const SCORE_POPUP_CSS = [
	".dsh-pet-score{position:fixed;z-index:2147483002;min-width:120px;text-align:center;",
	"background:rgba(255,255,255,.97);border:1px solid rgba(255,179,0,.35);border-radius:12px;",
	"box-shadow:0 10px 32px rgba(0,0,0,.22);padding:8px 16px 9px;user-select:none;pointer-events:auto;",
	"font-family:var(--dsh-pet-font-family,'ShangshouSoftCandy','Yuanti SC','YouYuan','幼圓','Comic Sans MS','PingFang SC','Microsoft YaHei',sans-serif);}",
	".dsh-pet-score.is-in{animation:dshPetScorePop .28s ease}",
	".dsh-pet-score-val{font-size:22px;line-height:1.25;font-weight:700;color:#ff8f00;font-variant-numeric:tabular-nums}",
	".dsh-pet-score-sub{font-size:11px;line-height:1.4;color:rgba(43,43,43,.6);margin-top:2px;white-space:nowrap}",
	".dsh-pet-score-burst{position:fixed;inset:0;pointer-events:none;z-index:2147483002}",
	".dsh-pet-score-particle{position:absolute;border-radius:50%;pointer-events:none}",
	"@keyframes dshPetScorePop{from{transform:scale(.6);opacity:0}to{transform:scale(1);opacity:1}}"
].join("");
/** 样式只注入一次（同 CHAT_CSS 的注入模式）。 */
let scoreCssInjected = false;
function injectScoreCss() {
	if (scoreCssInjected || typeof document === "undefined") return;
	scoreCssInjected = true;
	const tag = document.createElement("style");
	tag.dataset.plugin = "dsh-pet";
	tag.dataset.pluginCss = "dsh-pet/score";
	tag.textContent = SCORE_POPUP_CSS;
	document.head.appendChild(tag);
}
/** 粒子数量。 */
const BURST_COUNT = 20;
/** 初速范围（px/s）。 */
const BURST_SPEED_MIN = 120;
const BURST_SPEED_MAX = 460;
/** 重力（px/s²）：粒子向上喷出后回落。 */
const BURST_GRAVITY = 700;
/** 单粒子寿命范围（ms）。 */
const BURST_LIFE_MIN = 500;
const BURST_LIFE_MAX = 900;
/** 粒子半径范围（px）。 */
const BURST_RADIUS_MIN = 3;
const BURST_RADIUS_MAX = 7;
/** 暖色盘（积分与庆祝感）。 */
const BURST_COLORS = [
	"#ffb300",
	"#ff8f00",
	"#ff7043",
	"#f4511e",
	"#ffc400",
	"#ffd54f",
	"#ef5350"
];
function spawnScoreBurst(x, y) {
	if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
	injectScoreCss();
	const root = document.createElement("div");
	root.className = "dsh-pet-score-burst";
	document.body.appendChild(root);
	const parts = [];
	for (let i = 0; i < BURST_COUNT; i++) {
		const angle = Math.random() * Math.PI * 2;
		const speed = BURST_SPEED_MIN + Math.random() * (BURST_SPEED_MAX - BURST_SPEED_MIN);
		const r = BURST_RADIUS_MIN + Math.random() * (BURST_RADIUS_MAX - BURST_RADIUS_MIN);
		const el = document.createElement("div");
		el.className = "dsh-pet-score-particle";
		el.style.left = x + "px";
		el.style.top = y + "px";
		el.style.width = r * 2 + "px";
		el.style.height = r * 2 + "px";
		el.style.background = BURST_COLORS[Math.floor(Math.random() * BURST_COLORS.length)];
		root.appendChild(el);
		parts.push({
			el,
			vx: Math.cos(angle) * speed,
			vy: Math.sin(angle) * speed - 80,
			t0: performance.now(),
			life: BURST_LIFE_MIN + Math.random() * (BURST_LIFE_MAX - BURST_LIFE_MIN)
		});
	}
	const step = () => {
		const now = performance.now();
		let alive = false;
		for (const p of parts) {
			const tSec = (now - p.t0) / 1e3;
			const lifeRatio = (now - p.t0) / p.life;
			if (lifeRatio >= 1) continue;
			alive = true;
			p.el.style.transform = "translate(" + p.vx * tSec + "px," + (p.vy * tSec + .5 * BURST_GRAVITY * tSec * tSec) + "px)";
			p.el.style.opacity = String(Math.max(0, 1 - lifeRatio));
		}
		if (alive) requestAnimationFrame(step);
		else root.remove();
	};
	requestAnimationFrame(step);
}
function mountScorePopup(opts) {
	injectScoreCss();
	const x = opts.x;
	const y = opts.y;
	const root = document.createElement("div");
	root.className = "dsh-pet-score";
	const val = document.createElement("div");
	val.className = "dsh-pet-score-val";
	val.textContent = "+" + opts.score;
	const sub = document.createElement("div");
	sub.className = "dsh-pet-score-sub";
	sub.textContent = "速度 " + Math.round(opts.speed) + " · 大小 " + Math.round(opts.size);
	root.appendChild(val);
	root.appendChild(sub);
	document.body.appendChild(root);
	const rr = root.getBoundingClientRect();
	root.style.left = Math.max(4, Math.min(x - rr.width / 2, window.innerWidth - rr.width - 4)) + "px";
	root.style.top = Math.max(4, y - rr.height - 14) + "px";
	root.offsetWidth;
	root.classList.add("is-in");
	let closed = false;
	let timer = null;
	const close = () => {
		if (closed) return;
		closed = true;
		if (timer !== null) window.clearTimeout(timer);
		timer = null;
		document.removeEventListener("mousedown", onDocPointerDown, true);
		document.removeEventListener("keydown", onDocKeyDown, true);
		root.remove();
		if (opts.onClose) opts.onClose();
	};
	const mountedAt = performance.now();
	let graceConsumed = false;
	const onDocPointerDown = (e) => {
		if (closed) return;
		if (!graceConsumed) {
			graceConsumed = true;
			if (e.timeStamp - mountedAt < 300) return;
		}
		if (root.contains(e.target)) return;
		close();
	};
	const onDocKeyDown = (e) => {
		if (closed) return;
		if (e.key === "Escape") close();
	};
	document.addEventListener("mousedown", onDocPointerDown, true);
	document.addEventListener("keydown", onDocKeyDown, true);
	timer = window.setTimeout(close, SCORE_POPUP_DURATION_MS);
	return {
		el: root,
		close
	};
}

//#endregion
//#region src/client/pet/motion/drag-follow.ts
function createDragFollow(deps) {
	/** 在跑的 rAF；`null` = 没在追。 */
	let frame = null;
	/** 世代号：起跑或停下 +1，迟到的帧据此自弃。 */
	let token = 0;
	/** 追赶目标；`null` = 没有目标。 */
	let target = null;
	/** 上一帧的速度（px/s），跨帧累积出过阻尼手感。 */
	let velocity = {
		vx: 0,
		vy: 0
	};
	/** 上一帧的时刻（ms）。 */
	let last = 0;
	const stop = () => {
		token++;
		if (frame !== null) {
			cancelAnimationFrame(frame);
			frame = null;
		}
		target = null;
		velocity = {
			vx: 0,
			vy: 0
		};
	};
	const aim = (next) => {
		target = next;
	};
	const start = (rootEl) => {
		if (frame !== null) return;
		const current$1 = deps.card();
		const spring = current$1.physics.throwPower;
		const own = ++token;
		last = performance.now();
		const step = () => {
			if (token !== own) return;
			const goal = target;
			if (!goal) {
				frame = null;
				return;
			}
			const now = performance.now();
			const dt = Math.min((now - last) / 1e3, 1 / 30);
			last = now;
			const box = current$1.box() ?? {
				x: 0,
				y: 0
			};
			let x = box.x;
			let y = box.y;
			velocity.vx = springStep(velocity.vx, x, goal.x, dt, spring);
			velocity.vy = springStep(velocity.vy, y, goal.y, dt, spring);
			x += velocity.vx * dt;
			y += velocity.vy * dt;
			current$1.setBox({
				x,
				y
			});
			rootEl.style.left = x + "px";
			rootEl.style.top = y + "px";
			rootEl.style.right = "auto";
			rootEl.style.bottom = "auto";
			frame = requestAnimationFrame(step);
		};
		frame = requestAnimationFrame(step);
	};
	return {
		aim,
		start,
		stop
	};
}

//#endregion
//#region src/client/pet/motion/touch-press.ts
/**
* 触屏长按：按住到一定时长把这次按压当右键，计时期间手指移动超过容差就取消。
* 不负责右键菜单本身，也不碰拖拽与点击判定——到点只回调，派发交给调用方。
* 鼠标与笔不走这条分支，起表前先按指针类型挡掉。
* 不变量：同一时刻只有一个计时器；到点时按压若已结束，回调自弃。
* @module dsh-pet/src/client/pet/motion/touch-press
*/
/** 触屏长按多久算右键（ms）。 */
const LONG_PRESS_MS = 500;
/** 计时期间手指移动超过这个距离就取消（px）。 */
const SLOP_PX = 8;
function createTouchPress(deps) {
	/** 待触发的计时器；`null` = 没有在等。 */
	let timer = null;
	/** 本次按下的现场，到点时交给回调。 */
	let pending = null;
	const cancel = () => {
		if (timer !== null) {
			clearTimeout(timer);
			timer = null;
		}
		pending = null;
	};
	const arm = (target) => {
		cancel();
		if (target.pointerType === "mouse" || target.pointerType === "pen") return;
		pending = target;
		timer = setTimeout(() => {
			timer = null;
			const current$1 = pending;
			pending = null;
			if (current$1 === null || !deps.stillHolding()) return;
			deps.onMenu(current$1);
		}, LONG_PRESS_MS);
	};
	const move = (distancePx) => {
		if (timer === null) return;
		if (distancePx > SLOP_PX) cancel();
	};
	return {
		arm,
		cancel,
		isArmed: () => timer !== null,
		move
	};
}

//#endregion
//#region src/client/pet/motion/drag-release.ts
function decideRelease(input) {
	if (input.sling) {
		const pullX = input.box.x + input.half.w - input.anchor.x;
		const pullY = input.box.y + input.half.h - input.anchor.y;
		const dist = Math.hypot(pullX, pullY);
		const power = slingshotPower(dist, input.size);
		return {
			kind: "sling",
			dist,
			power,
			velocity: slingshotVelocity(pullAngle(pullX, pullY), power, input.physics.throwPower)
		};
	}
	const velocity = estimateReleaseVelocity(input.trail, input.now, input.physics);
	return velocity ? {
		kind: "throw",
		velocity
	} : { kind: "place" };
}

//#endregion
//#region src/client/pet/motion/drag.ts
/** 复位的按下状态：避免每个实例各写一份字面量。 */
const IDLE_PRESS = {
	active: false,
	dragging: false,
	sx: 0,
	sy: 0,
	offX: 0,
	offY: 0,
	sling: false,
	anchorX: 0,
	anchorY: 0
};
/** 松手后这段时间内的指针事件视为同一次拖拽的尾巴（ms）。 */
const JUST_DRAGGED_MS = 100;
/** 日志行的时刻前缀。 */
const stamp$1 = () => new Date().toTimeString().slice(0, 8);
/** 一行带时刻与宠物 id 的日志：客户端统一前缀，便于按宠物 grep。 */
const log$1 = (petId, message) => {
	console.log("[dsh-pet] " + stamp$1() + " pet=" + petId + " " + message);
};
/**
* 抓取瞬间记一行速度，手速够快就打分。
*
* @param current - 当帧能力。
* @param x - 指针横坐标（px），分数从这里弹出。
* @param y - 指针纵坐标（px）。
* @returns 是否打过分；调用方据此让随后的 click 不再播普通点击动画。
*/
function noteGrab(current$1, x, y) {
	const grab = current$1.grabVelocity();
	const speed = grab ? Math.hypot(grab.vx, grab.vy) : 0;
	log$1(current$1.petId, "grab vx=" + (grab ? Math.round(grab.vx) : 0) + " vy=" + (grab ? Math.round(grab.vy) : 0) + " |v|=" + Math.round(speed));
	if (speed < SCORE_MIN_SPEED) return false;
	const score = clickScore(speed, current$1.size);
	log$1(current$1.petId, "click-score speed=" + Math.round(speed) + " size=" + current$1.size + " -> +" + score);
	spawnScoreBurst(x, y);
	mountScorePopup({
		x,
		y,
		score,
		speed,
		size: current$1.size
	});
	return true;
}
function createDrag(card) {
	let press = { ...IDLE_PRESS };
	/** 「刚拖完」窗口的截止时刻（ms）；用时刻而不是定时器，读的时候再判，少一个待清理的句柄。 */
	let justDraggedUntil = 0;
	let pressScoreFired = false;
	let lastPressAt = 0;
	/** 指针轨迹采样，供初速估算。 */
	let trail = [];
	const follow = createDragFollow({ card });
	let mousePressHit = null;
	/** 捕获丢失后的松手：坐标来自 mouseup，落点判定与正常松开完全一致。 */
	function onWindowMouseUp(e) {
		const hit = mousePressHit;
		if (!hit || e.button !== 0 || e.buttons !== 0) return;
		endPress(card(), {
			x: e.clientX,
			y: e.clientY,
			hit
		});
	}
	/** 鼠标按下时登记命中区并挂兜底；node 里的测试没有 window，替身自己提供。 */
	const armMouseFallback = (hit) => {
		mousePressHit = hit;
		if (typeof window !== "undefined") window.addEventListener("mouseup", onWindowMouseUp, true);
	};
	const clearMouseFallback = () => {
		mousePressHit = null;
		if (typeof window !== "undefined") window.removeEventListener("mouseup", onWindowMouseUp, true);
	};
	/** 触屏长按：计时与容差在 motion/touch-press.ts，到点后把这次按压当右键。 */
	const touchPress = createTouchPress({
		onMenu: (target) => {
			press.active = false;
			pressScoreFired = true;
			if (target.el.hasPointerCapture(target.pointerId)) target.el.releasePointerCapture(target.pointerId);
			log$1(card().petId, "-> [TOUCH-MENU]");
			target.el.dispatchEvent(new MouseEvent("contextmenu", {
				bubbles: true,
				button: 2,
				cancelable: true,
				clientX: target.x,
				clientY: target.y,
				view: window
			}));
		},
		stillHolding: () => press.active && !press.dragging
	});
	/**
	* 记下这次按下的几何与弹弓判定。
	*
	* @param c - 当帧能力。
	* @param e - 按下事件。
	* @returns 新的按下状态。
	*/
	const beginPress = (c, e) => {
		e.currentTarget.classList.add("dragging");
		e.currentTarget.setPointerCapture(e.pointerId);
		c.setTipOn(false);
		const rootEl = c.root();
		let offX = 0;
		let offY = 0;
		if (rootEl) {
			const rr = rootEl.getBoundingClientRect();
			offX = e.clientX - (rr.left + rr.width / 2);
			offY = e.clientY - (rr.top + rr.height / 2);
			c.setBox({
				x: rr.left,
				y: rr.top
			});
		}
		const pressNow = performance.now();
		const sling = pressNow - lastPressAt < SLINGSHOT_DOUBLE_MS;
		lastPressAt = sling ? 0 : pressNow;
		const anchor = c.box();
		return {
			active: true,
			anchorX: anchor ? anchor.x + c.halfW : e.clientX,
			anchorY: anchor ? anchor.y + c.halfH : e.clientY,
			dragging: false,
			offX,
			offY,
			sling,
			sx: e.clientX,
			sy: e.clientY
		};
	};
	const onPointerDown = (e) => {
		const c = card();
		if (e.button !== 0) return;
		if (c.isFrozen()) c.releaseLock();
		pressScoreFired = noteGrab(c, e.clientX, e.clientY);
		c.stopFlight();
		follow.stop();
		c.stopAutonomy();
		trail = [];
		press = beginPress(c, e);
		clearMouseFallback();
		if (e.pointerType === "mouse") armMouseFallback(e.currentTarget);
		touchPress.arm({
			el: e.currentTarget,
			pointerId: e.pointerId,
			pointerType: e.pointerType,
			x: e.clientX,
			y: e.clientY
		});
	};
	const onPointerMove = (e) => {
		const c = card();
		if (c.tipOn()) c.placeTip(e.clientX, e.clientY);
		if (!press.active) return;
		const dx = e.clientX - press.sx;
		const dy = e.clientY - press.sy;
		touchPress.move(Math.hypot(dx, dy));
		if (!press.dragging) {
			if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
			press.dragging = true;
			c.setDragging(true);
			c.setOnce(true);
			if (c.dragAnims.length) {
				const name = pick(c.dragAnims);
				log$1(c.petId, "-> [DRAG] " + name);
				c.playAnim(name);
			}
		}
		const now = performance.now();
		trail = trimTrail([...trail, {
			t: now,
			x: e.clientX,
			y: e.clientY
		}], now);
		follow.aim({
			x: e.clientX - press.offX - c.halfW,
			y: e.clientY - press.offY - c.halfH
		});
		const rootEl = c.root();
		if (rootEl) follow.start(rootEl);
		const stageEl = c.stage();
		if (stageEl) stageEl.style.transform = "none";
	};
	/**
	* 松手结算：原地放下、甩抛或弹弓。
	*
	* @param c - 当帧能力。
	* @param point - 松手现场；指针没跟上时用它的坐标兜底算落点。
	*/
	const settleRelease = (c, point) => {
		const current$1 = c.box();
		const box = current$1 ?? {
			x: point.x - press.offX - c.halfW,
			y: point.y - press.offY - c.halfH
		};
		const decision = decideRelease({
			anchor: {
				x: press.anchorX,
				y: press.anchorY
			},
			box,
			half: {
				w: c.halfW,
				h: c.halfH
			},
			now: performance.now(),
			physics: c.physics,
			size: c.size,
			sling: press.sling,
			trail
		});
		trail = [];
		if (decision.kind === "sling") {
			log$1(c.petId, "sling dist=" + Math.round(decision.dist) + " power=" + decision.power.toFixed(2) + " vx=" + Math.round(decision.velocity.vx) + " vy=" + Math.round(decision.velocity.vy));
			c.startFlight(box.x, box.y, decision.velocity.vx, decision.velocity.vy);
			return;
		}
		if (decision.kind === "throw") {
			const { vx, vy } = decision.velocity;
			log$1(c.petId, "release vx=" + Math.round(vx) + " vy=" + Math.round(vy) + " |v|=" + Math.round(Math.hypot(vx, vy)));
			c.startFlight(box.x, box.y, vx, vy);
			return;
		}
		c.commitPlace(box);
	};
	/**
	* 松手后把提示摆回光标处并点亮；指针已移出命中区时保持收起。
	*
	* @param c - 当帧能力。
	* @param point - 松手现场。
	*/
	const restoreTip = (c, point) => {
		const hitRect = point.hit.getBoundingClientRect();
		const inside = point.x >= hitRect.left && point.x <= hitRect.right && point.y >= hitRect.top && point.y <= hitRect.bottom;
		if (!inside) return;
		c.placeTip(point.x, point.y);
		c.setTipOn(true);
	};
	/**
	* 松手收尾的唯一路径：复位按下态、摘拖拽类、结算去向并把提示摆回去。
	*
	* @param c - 当帧能力。
	* @param point - 松手现场；正常 pointerup 与捕获丢失后的 window mouseup 都折算成它。
	*/
	const endPress = (c, point) => {
		clearMouseFallback();
		touchPress.cancel();
		const wasDragging = press.dragging;
		press.active = false;
		press.dragging = false;
		point.hit.classList.remove("dragging");
		follow.stop();
		if (wasDragging) {
			justDraggedUntil = performance.now() + JUST_DRAGGED_MS;
			c.setDragging(false);
			const stageEl = c.stage();
			if (stageEl) stageEl.style.transform = "translateY(" + c.bottomPad + "px)";
			if (!c.resumeWork()) {
				if (c.idleAnims.length) c.playAnim(pick(c.idleAnims, c.currentAnim));
				c.setOnce(true);
			}
			settleRelease(c, point);
		}
		restoreTip(c, point);
	};
	const onPointerUp = (e) => {
		endPress(card(), {
			x: e.clientX,
			y: e.clientY,
			hit: e.currentTarget
		});
	};
	const onClick = () => {
		const c = card();
		if (press.active || press.dragging || performance.now() < justDraggedUntil) return;
		if (pressScoreFired) {
			pressScoreFired = false;
			c.stopFlight();
			c.stopAutonomy();
			return;
		}
		c.stopFlight();
		c.stopAutonomy();
		c.playClickSound();
		c.setOnce(true);
		if (!c.clickAnims.length) return;
		const name = pick(c.clickAnims);
		log$1(c.petId, "-> [CLICK] " + name);
		c.markSquash();
		c.bumpSeq();
		c.playAnim(name);
	};
	return {
		isActive: () => press.active,
		justDragged: () => performance.now() < justDraggedUntil,
		onClick,
		onPointerDown,
		onPointerMove,
		onPointerUp,
		stopFollow: follow.stop,
		dispose: clearMouseFallback
	};
}

//#endregion
//#region src/client/pet/card/drag.ts
function createCardDrag(rt) {
	const { useRef, useEffect } = rt;
	return function useCardDrag(input) {
		const { bumpSeq, card, cfgRef, live, motion, pendingSquash, root, setAnim, setCustomPos, setDragging } = input;
		const { setOnce, setTipOn, stage } = input;
		const dragCard = () => {
			const metrics = motion.metrics();
			return {
				petId: cfgRef.current.id,
				size: metrics.size,
				halfW: metrics.halfW,
				halfH: metrics.halfH,
				bottomPad: metrics.bottomPad,
				physics: cfgRef.current.physics,
				dragAnims: live.current.flow?.sleeping() ?? false ? [] : cfgRef.current.animations.drag,
				clickAnims: cfgRef.current.animations.clicks,
				idleAnims: live.current.flow?.sleeping() ?? false ? [] : cfgRef.current.animations.idle,
				currentAnim: card.animRef.current,
				setOnce: (on) => setOnce(on),
				playAnim: (name) => setAnim(name),
				bumpSeq: () => bumpSeq(),
				markSquash: () => {
					pendingSquash.current = true;
				},
				setDragging,
				resumeWork: () => live.current.flow?.resumeWorkStatusAnim() ?? false,
				stopAutonomy: () => motion.stopMove(),
				stopFlight: () => motion.flight.stop(),
				startFlight: motion.startThrow,
				isFrozen: () => live.current.ownAnim.isFrozen(),
				releaseLock: () => live.current.releaseLock(),
				grabVelocity: () => motion.flight.isFlying() ? motion.flight.velocity() : null,
				playClickSound: () => playClickSound(),
				tipOn: () => live.current.tipOn(),
				placeTip: (x, y) => live.current.placeTip(x, y),
				setTipOn,
				stage,
				root,
				box: () => motion.box(),
				setBox: (box) => motion.setBox(box),
				commitPlace: (box) => {
					const metrics$1 = motion.metrics();
					const viewport = {
						width: window.innerWidth,
						height: window.innerHeight
					};
					const half = {
						w: metrics$1.halfW,
						h: metrics$1.halfH
					};
					const reached = clampReachableBox(box, viewport, metrics$1);
					const rootEl = root();
					if (rootEl) {
						rootEl.style.left = reached.x + "px";
						rootEl.style.top = reached.y + "px";
						rootEl.style.right = "auto";
						rootEl.style.bottom = "auto";
					}
					motion.setBox(reached);
					setCustomPos(boxToRatio(reached, viewport, half));
				}
			};
		};
		const dragRef = useRef(null);
		dragRef.current ?? (dragRef.current = createDrag(dragCard));
		const drag = dragRef.current;
		useEffect(() => () => drag.dispose(), [drag]);
		live.current.drag = drag;
		return drag;
	};
}

//#endregion
//#region src/shared/chat/image-pick.ts
const IMAGE_TYPES = [
	"image/png",
	"image/jpeg",
	"image/webp",
	"image/gif"
];
const IMAGE_ACCEPT = IMAGE_TYPES.join(",");
/** 扩展名兜底：拖拽或部分系统来源不给 `file.type`。 */
const IMAGE_EXT = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	webp: "image/webp",
	gif: "image/gif"
};
function imageMediaTypeOf(file) {
	const declared = String(file.type || "").toLowerCase();
	if (IMAGE_TYPES.includes(declared)) return declared;
	const ext = String(file.name || "").split(".").pop()?.toLowerCase();
	return ext === void 0 ? void 0 : IMAGE_EXT[ext];
}
function isImageFile(file) {
	return imageMediaTypeOf(file) !== void 0;
}
function dragHasFiles(e) {
	const types = e.dataTransfer?.types;
	if (!types) return false;
	return Array.from(types).includes("Files");
}
function firstImageFile(dataTransfer) {
	const files = dataTransfer?.files;
	if (!files) return void 0;
	for (const file of Array.from(files)) if (isImageFile(file)) return file;
	return void 0;
}
function firstImageFromClipboard(data) {
	if (!data) return void 0;
	const files = data.files;
	if (files) {
		for (const file of Array.from(files)) if (isImageFile(file)) return file;
	}
	const items = data.items;
	if (!items) return void 0;
	for (const item of Array.from(items)) {
		if (item.kind !== "file") continue;
		const file = item.getAsFile();
		if (file && isImageFile(file)) return file;
	}
	return void 0;
}

//#endregion
//#region src/shared/chat/encode.ts
const IMAGE_MAX_BYTES = 640 * 1024;
const IMAGE_MAX_SIDE = 2048;
const IMAGE_QUALITIES = [
	.85,
	.75,
	.65,
	.55
];
/** 预览缩略图的长边（像素）：只用于弹窗里那枚 24×24。 */
const PREVIEW_SIDE = 96;
function attachmentBytes(base64) {
	const pad$1 = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
	return Math.floor(base64.length * 3 / 4) - pad$1;
}
function targetSize(width, height, maxSide = IMAGE_MAX_SIDE) {
	const scale = Math.min(1, maxSide / Math.max(width, height));
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale))
	};
}
/**
* 把文件解码成 `<img>`。
*
* 用 `FileReader` 的 data URL 而不是 `URL.createObjectURL`：桌面 helper 的 CSP 是
* `img-src 'self' http: https: data:`，不含 `blob:`，objectURL 在那边会被拦成 onerror
* （表现为"這個文件解不出圖片"，而浏览器端正常）。
*/
function loadImage(file) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onerror = () => reject(new Error("這個文件讀不出來"));
		reader.onload = () => {
			const url = typeof reader.result === "string" ? reader.result : "";
			if (!url) {
				reject(new Error("這個文件讀不出來"));
				return;
			}
			const img = new Image();
			img.onload = () => resolve(img);
			img.onerror = () => reject(new Error("這個文件解不出圖片"));
			img.src = url;
		};
		reader.readAsDataURL(file);
	});
}
/** 字节 → 规范 base64（分块，避免 String.fromCharCode 参数过多爆栈）。 */
function bytesToBase64(bytes) {
	let bin = "";
	const CHUNK = 32768;
	for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
	return btoa(bin);
}
/** 把源按目标尺寸画进一张新画布。 */
function drawToCanvas(source, size) {
	const canvas = document.createElement("canvas");
	canvas.width = size.width;
	canvas.height = size.height;
	canvas.getContext("2d")?.drawImage(source, 0, 0, size.width, size.height);
	return canvas;
}
/** 缩略图：96px、JPEG 0.72，几 KB 就够 24×24 显示。 */
function previewOf(source, width, height) {
	return drawToCanvas(source, targetSize(width, height, PREVIEW_SIDE)).toDataURL("image/jpeg", .72);
}
function encodeCanvas(canvas) {
	const { width, height } = canvas;
	const previewUrl = previewOf(canvas, width, height);
	const floor = IMAGE_QUALITIES[IMAGE_QUALITIES.length - 1];
	for (const quality of IMAGE_QUALITIES) {
		const dataUrl = canvas.toDataURL("image/jpeg", quality);
		const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
		const bytes = attachmentBytes(base64);
		if (bytes <= IMAGE_MAX_BYTES || quality === floor) return {
			base64,
			mediaType: "image/jpeg",
			bytes,
			width,
			height,
			resized: true,
			previewUrl
		};
	}
	throw new Error("無法壓到預算內");
}
async function encodeImageFile(file) {
	const mediaType = imageMediaTypeOf(file);
	if (!mediaType) throw new Error("不是可送出的圖片");
	const img = await loadImage(file);
	const width = img.naturalWidth || img.width;
	const height = img.naturalHeight || img.height;
	const raw = new Uint8Array(await file.arrayBuffer());
	if (raw.length <= IMAGE_MAX_BYTES && Math.max(width, height) <= IMAGE_MAX_SIDE) return {
		base64: bytesToBase64(raw),
		mediaType,
		bytes: raw.length,
		width,
		height,
		resized: false,
		previewUrl: previewOf(img, width, height)
	};
	const target = targetSize(width, height);
	return encodeCanvas(drawToCanvas(img, target));
}

//#endregion
//#region src/shared/hear.ts
const HEAR_SAMPLE_RATE = 16e3;
const MAX_RECORD_MS = 24e3;
const SILENCE_PEAK = .002;
const MIN_RECORD_MS = 300;
/** 等识别结果的上限（ms）：宿主自己 30s 超时，这里留点余量先等它回结构化失败。 */
const HEAR_TIMEOUT_MS = 4e4;
/** 每块采集的样本数：1024 样本 @16kHz = 64ms，松手后等待补齐尾音的时长也按它算。 */
const BLOCK_SAMPLES = 1024;
/** 松手后等最后一块音频落袋（ms）：比一块略长，避免把最后半句话砍掉。 */
const TAIL_SETTLE_MS = 80;
function canRecord() {
	return typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function";
}
function floatToPcm16(samples) {
	const out = new Int16Array(samples.length);
	for (let i = 0; i < samples.length; i++) {
		const v = samples[i] < -1 ? -1 : samples[i] > 1 ? 1 : samples[i];
		out[i] = v < 0 ? v * 32768 : v * 32767;
	}
	return out;
}
function peakOf(pcm) {
	let peak = 0;
	for (let i = 0; i < pcm.length; i++) {
		const v = pcm[i] < 0 ? -pcm[i] : pcm[i];
		if (v > peak) peak = v;
	}
	return peak / 32768;
}
function encodeWave(pcm, sampleRate = HEAR_SAMPLE_RATE) {
	const dataBytes = pcm.length * 2;
	const bytes = new Uint8Array(44 + dataBytes);
	const view = new DataView(bytes.buffer);
	/** 写 4 字节 ASCII 标记（RIFF/WAVE/fmt /data），全是大写或小写字母，不用考虑编码。 */
	const ascii = (offset, text) => {
		for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i);
	};
	ascii(0, "RIFF");
	view.setUint32(4, 36 + dataBytes, true);
	ascii(8, "WAVE");
	ascii(12, "fmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, 1, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * 2, true);
	view.setUint16(32, 2, true);
	view.setUint16(34, 16, true);
	ascii(36, "data");
	view.setUint32(40, dataBytes, true);
	for (let i = 0; i < pcm.length; i++) view.setInt16(44 + i * 2, pcm[i], true);
	return bytes;
}
function toBase64(bytes) {
	const BASE64_CHUNK_BYTES = 8192;
	let binary = "";
	for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_BYTES) {
		const end = Math.min(offset + BASE64_CHUNK_BYTES, bytes.length);
		for (let i = offset; i < end; i++) binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}
/** 把宿主的失败原因收敛到自己认识的几种；其余一律按生成失敗处理。 */
function reasonOf(raw) {
	return raw === "unsupported" || raw === "bad-request" ? raw : "generate-error";
}
async function hearAudio(url, audio, signal) {
	const timeout = AbortSignal.timeout(HEAR_TIMEOUT_MS);
	try {
		const res = await fetch(url, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ audio }),
			signal: signal === void 0 ? timeout : AbortSignal.any([signal, timeout])
		});
		const raw = await res.json().catch(() => null);
		if (!raw || typeof raw !== "object") return {
			ok: false,
			reason: "network",
			message: "識別響應不是 JSON"
		};
		const body = raw;
		if (body.ok === true && typeof body.text === "string") return {
			ok: true,
			text: body.text
		};
		return {
			ok: false,
			reason: reasonOf(body.reason),
			message: typeof body.message === "string" ? body.message : ""
		};
	} catch (e) {
		return {
			ok: false,
			reason: "network",
			message: e instanceof Error ? e.message : String(e)
		};
	}
}
async function startRecording() {
	const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
	const ctx = new AudioContext({ sampleRate: HEAR_SAMPLE_RATE });
	const source = ctx.createMediaStreamSource(stream);
	const processor = ctx.createScriptProcessor(BLOCK_SAMPLES, 1, 1);
	const chunks = [];
	const maxSamples = Math.floor(MAX_RECORD_MS / 1e3 * HEAR_SAMPLE_RATE);
	let frames = 0;
	let closed = false;
	processor.onaudioprocess = (event) => {
		if (frames >= maxSamples) return;
		const samples = event.inputBuffer.getChannelData(0);
		const room = maxSamples - frames;
		const take = samples.length > room ? samples.subarray(0, room) : samples;
		chunks.push(new Float32Array(take));
		frames += take.length;
	};
	source.connect(processor);
	processor.connect(ctx.destination);
	await ctx.resume();
	const teardown = () => {
		if (closed) return;
		closed = true;
		processor.onaudioprocess = null;
		try {
			source.disconnect();
			processor.disconnect();
		} catch {}
		for (const track of stream.getTracks()) track.stop();
		ctx.close();
	};
	return {
		elapsedMs: () => frames / HEAR_SAMPLE_RATE * 1e3,
		async stop() {
			await new Promise((resolve) => setTimeout(resolve, TAIL_SETTLE_MS));
			teardown();
			if (frames === 0) return null;
			const all = new Float32Array(frames);
			let offset = 0;
			for (const chunk of chunks) {
				all.set(chunk, offset);
				offset += chunk.length;
			}
			const pcm = floatToPcm16(all);
			return {
				wave: encodeWave(pcm),
				peak: peakOf(pcm)
			};
		},
		cancel: teardown
	};
}

//#endregion
//#region src/shared/chat/hear-control.ts
function createHearControl(opts) {
	const { micBtn, input, hint, resizeInput, hearUrl } = opts;
	let hearState = "idle";
	let recorder = null;
	let hearTimer = 0;
	/** 还没拿到麦克风就松手了：等 startRecording 一返回立刻收尾，避免麦克风一直开着。 */
	let wasReleasedEarly = false;
	/** 按钮外观：录音阶段画红，识别阶段禁用（避免连点开两次）。 */
	const paint = () => {
		if (hearState === "starting" || hearState === "recording") micBtn.dataset.hear = "recording";
		else delete micBtn.dataset.hear;
		micBtn.disabled = hearState === "transcribing";
	};
	/** 现在录不了的原因；能录时给空串。 */
	const blockedReason = () => {
		if (!canRecord()) return "當前地址不支持錄音：用 https 或 localhost 打開才有麥克風";
		if (hearUrl === "") return "這個入口沒有接上識別地址";
		return "";
	};
	/** 把识别结果接在光标处（替换当前选区），并把焦点交回输入框。 */
	const insertText = (text) => {
		const from = input.selectionStart ?? input.value.length;
		const to = input.selectionEnd ?? from;
		input.value = input.value.slice(0, from) + text + input.value.slice(to);
		const caret = from + text.length;
		input.setSelectionRange(caret, caret);
		resizeInput();
		input.focus();
	};
	/** 失败原因翻成人话；宿主给的 message 有就附上，方便对着日志排查。 */
	const describeFailure = (outcome) => {
		if (outcome.reason === "unsupported") return "這個宿主沒開語音識別";
		if (outcome.reason === "bad-request") return "音頻沒通過宿主校驗";
		if (outcome.reason === "network") return "識別請求失敗：" + outcome.message;
		return "識別失敗：" + (outcome.message || "未知原因");
	};
	/** 收尾：停采集 → 判误触 → 判静音 → 送宿主 → 文字落进输入框。失败只提示，不动已输入的文字。 */
	const stop = async () => {
		const current$1 = recorder;
		if (!current$1) return;
		recorder = null;
		window.clearInterval(hearTimer);
		if (current$1.elapsedMs() < MIN_RECORD_MS) {
			current$1.cancel();
			hearState = "idle";
			paint();
			hint.hide();
			return;
		}
		hearState = "transcribing";
		paint();
		hint.show("識別中…");
		try {
			const clip = await current$1.stop();
			if (clip === null) {
				hint.flash("沒錄到聲音");
				return;
			}
			if (clip.peak < SILENCE_PEAK) {
				hint.flash("沒聽到聲音，檢查一下麥克風");
				return;
			}
			if (!input.isConnected) return;
			const outcome = await hearAudio(hearUrl, toBase64(clip.wave));
			if (!input.isConnected) return;
			if (!outcome.ok) {
				hint.flash(describeFailure(outcome));
				return;
			}
			const text = outcome.text.trim();
			if (text === "") {
				hint.flash("沒聽清，再說一次");
				return;
			}
			hint.hide();
			insertText(text);
		} catch (e) {
			hint.flash("錄音出錯：" + (e instanceof Error ? e.message : String(e)));
		} finally {
			hearState = "idle";
			paint();
		}
	};
	/** 开录：先要麦克风，拿到了才开始计时。 */
	const start = async () => {
		const blocked = blockedReason();
		if (blocked !== "") {
			hint.flash(blocked);
			return;
		}
		if (hearState !== "idle") return;
		if (document.activeElement === input) input.blur();
		hearState = "starting";
		wasReleasedEarly = false;
		paint();
		hint.show("正在打開麥克風…");
		try {
			recorder = await startRecording();
		} catch (e) {
			hearState = "idle";
			paint();
			hint.flash("打不開麥克風：" + (e instanceof Error ? e.message : String(e)));
			return;
		}
		if (wasReleasedEarly) {
			stop();
			return;
		}
		hearState = "recording";
		paint();
		hearTimer = window.setInterval(() => {
			const rec = recorder;
			if (!rec) return;
			if (rec.elapsedMs() >= MAX_RECORD_MS) {
				stop();
				return;
			}
			const total = Math.floor(rec.elapsedMs() / 1e3);
			hint.show("錄音中 " + Math.floor(total / 60) + ":" + String(total % 60).padStart(2, "0") + " · 松開結束");
		}, 200);
	};
	micBtn.addEventListener("pointerdown", (e) => {
		if (e.button !== 0) return;
		e.preventDefault();
		try {
			micBtn.setPointerCapture(e.pointerId);
		} catch {}
		start();
	});
	/** 松手或指针被系统抢走（切窗口）都算说完；还在等麦克风时先记下，等它回来立刻收尾。 */
	const onRelease = () => {
		if (hearState === "starting") {
			wasReleasedEarly = true;
			return;
		}
		if (hearState === "recording") stop();
	};
	micBtn.addEventListener("pointerup", onRelease);
	micBtn.addEventListener("pointercancel", onRelease);
	return {
		start: () => void start(),
		stop: () => void stop(),
		isHearing: () => hearState === "recording",
		dispose: () => {
			window.clearInterval(hearTimer);
			if (recorder) {
				recorder.cancel();
				recorder = null;
			}
			hearState = "idle";
		}
	};
}

//#endregion
//#region src/shared/chat/icons.ts
/**
* 對話弹窗里的三枚内联 SVG 图标。
* 不用 emoji：同一个符号在不同字体回退链下会被渲染成异体字形（上传用的 🖼 在 Windows 上就是如此）。
* @module dsh-pet/src/shared/chat/icons
*/
/** SVG 图标共用的描边属性：一条线宽、随文字颜色。 */
const ICON_ATTRS = {
	fill: "none",
	stroke: "currentColor",
	"stroke-width": "1.8",
	"stroke-linecap": "round",
	"stroke-linejoin": "round",
	"aria-hidden": "true"
};
/** 造一个 SVG 子元素（属性原样写入，命名空间固定 SVG）。 */
function svgNode(tag, attrs) {
	const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
	for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
	return node;
}
function pictureIcon(size = 16) {
	const svg = svgNode("svg", {
		viewBox: "0 0 24 24",
		width: String(size),
		height: String(size),
		...ICON_ATTRS
	});
	svg.append(svgNode("rect", {
		x: "3",
		y: "3",
		width: "18",
		height: "18",
		rx: "2"
	}), svgNode("circle", {
		cx: "8.5",
		cy: "8.5",
		r: "1.5"
	}), svgNode("path", { d: "M21 15l-5-5L5 21" }));
	return svg;
}
function micIcon(size = 16) {
	const svg = svgNode("svg", {
		viewBox: "0 0 24 24",
		width: String(size),
		height: String(size),
		...ICON_ATTRS
	});
	svg.append(svgNode("rect", {
		x: "9",
		y: "2",
		width: "6",
		height: "11",
		rx: "3"
	}), svgNode("path", { d: "M5.5 11a6.5 6.5 0 0 0 13 0" }), svgNode("path", { d: "M12 17.5V21" }), svgNode("path", { d: "M8.5 21h7" }));
	return svg;
}
function cameraIcon(size = 16) {
	const svg = svgNode("svg", {
		viewBox: "0 0 24 24",
		width: String(size),
		height: String(size),
		...ICON_ATTRS
	});
	svg.append(svgNode("path", { d: "M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" }), svgNode("circle", {
		cx: "12",
		cy: "13",
		r: "4"
	}));
	return svg;
}

//#endregion
//#region src/shared/chat/styles.ts
const CHAT_CSS = [
	".dsh-pet-chat{position:fixed;z-index:2147483001;width:160px;max-width:80vw;",
	"background:rgba(255,255,255,.98);border:1px solid rgba(0,0,0,.12);border-radius:10px;",
	"box-shadow:0 10px 32px rgba(0,0,0,.22);color:#2b2b2b;font-size:14px;line-height:1.5;",
	"font-family:var(--dsh-pet-font-family,'ShangshouSoftCandy','Yuanti SC','YouYuan','幼圓','Comic Sans MS','PingFang SC','Microsoft YaHei',sans-serif);",
	"user-select:none}",
	".dsh-pet-chat *{box-sizing:border-box}",
	".dsh-pet-chat-input{display:block;width:100%;border:none;outline:none;background:transparent;",
	"padding:8px 11px 9px;font-size:14px;line-height:1.45;color:#2b2b2b;font-family:inherit;",
	"resize:none;overflow:hidden;white-space:pre-wrap;overflow-wrap:anywhere}",
	".dsh-pet-chat-input::placeholder{color:rgba(43,43,43,.45)}",
	".dsh-pet-chat-input:disabled{opacity:.55}",
	".dsh-pet-chat-actions{display:flex;align-items:center;gap:6px;padding:0 8px 7px}",
	".dsh-pet-chat-btn{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;",
	"border:none;border-radius:6px;background:transparent;color:rgba(43,43,43,.62);font-size:14px;line-height:1;",
	"cursor:pointer;transition:background .15s,color .15s}",
	".dsh-pet-chat-btn:hover{background:rgba(0,0,0,.06);color:rgba(43,43,43,.9)}",
	".dsh-pet-chat-btn:disabled{opacity:.45;cursor:default}",
	".dsh-pet-chat-btn svg{display:block}",
	".dsh-pet-chat-btn[data-hear=\"recording\"]{color:#e5484d;background:rgba(229,72,77,.14)}",
	".dsh-pet-chat-btn[data-hear=\"recording\"]:hover{background:rgba(229,72,77,.2);color:#e5484d}",
	".dsh-pet-chat-btn[data-hear=\"recording\"] svg{animation:dsh-pet-hear-pulse 1s ease-in-out infinite}",
	"@keyframes dsh-pet-hear-pulse{0%,100%{opacity:1}50%{opacity:.4}}",
	".dsh-pet-chat-attach{display:none;align-items:center;gap:4px;margin-left:2px}",
	".dsh-pet-chat-attach[data-on=\"1\"]{display:inline-flex}",
	".dsh-pet-chat-thumb{width:24px;height:24px;object-fit:cover;border-radius:4px;",
	"border:1px solid rgba(0,0,0,.1);flex:0 0 auto;background:rgba(0,0,0,.06)}",
	".dsh-pet-chat-attach-x{border:none;background:transparent;color:rgba(43,43,43,.45);cursor:pointer;",
	"font-size:12px;line-height:1;padding:2px 3px;border-radius:4px}",
	".dsh-pet-chat-attach-x:hover{background:rgba(0,0,0,.08);color:rgba(43,43,43,.85)}",
	".dsh-pet-chat-hint{display:none;color:rgba(43,43,43,.55);font-size:12px;padding:0 12px 8px}",
	".dsh-pet-chat-err{color:#d94f3d;font-size:12px;padding:0 12px 8px;white-space:pre-wrap;overflow-wrap:anywhere}"
].join("");
const CHAT_MIN_W = 160;
const CHAT_MAX_W = 340;
const CHAT_H_PAD = 22;
let chatCssInjected = false;
function injectChatCss() {
	if (chatCssInjected || typeof document === "undefined") return;
	chatCssInjected = true;
	const tag = document.createElement("style");
	tag.dataset.plugin = "dsh-pet";
	tag.dataset.pluginCss = "dsh-pet/chat";
	tag.textContent = CHAT_CSS;
	document.head.appendChild(tag);
}

//#endregion
//#region src/shared/chat/dom.ts
/** 提示自动收起的时间（ms）。 */
const HINT_MS = 2200;
/** 造一枚图标按钮（图标 + 无障碍标签）。 */
function iconButton(title, icon) {
	const btn = document.createElement("button");
	btn.type = "button";
	btn.className = "dsh-pet-chat-btn";
	btn.title = title;
	btn.setAttribute("aria-label", title);
	btn.appendChild(icon);
	return btn;
}
/** 输入框宽度随文本自适应：宽度按测量值，封顶后由高度接住折行。 */
function enableAutoResize(input, root) {
	let measureCtx = null;
	const resize = () => {
		const ctx = measureCtx ?? (measureCtx = document.createElement("canvas").getContext("2d"));
		ctx.font = getComputedStyle(input).font;
		const textW = ctx.measureText(input.value || " ").width;
		const w = Math.max(CHAT_MIN_W, Math.min(Math.ceil(textW + CHAT_H_PAD), CHAT_MAX_W));
		root.style.width = w + "px";
		input.style.height = "auto";
		input.style.height = Math.max(input.scrollHeight, 22) + "px";
	};
	input.addEventListener("input", resize);
	return resize;
}
function createChatDom(opts = {}) {
	const root = document.createElement("div");
	root.className = "dsh-pet-chat";
	const input = document.createElement("textarea");
	input.className = "dsh-pet-chat-input";
	input.placeholder = "說點什麼…";
	input.maxLength = 2e3;
	input.rows = 1;
	const err = document.createElement("div");
	err.className = "dsh-pet-chat-err";
	err.style.display = "none";
	const hint = document.createElement("div");
	hint.className = "dsh-pet-chat-hint";
	let hintTimer = 0;
	/** 常驻提示：录音与识别期间一直显示，由调用点自己收。 */
	const showHint = (text) => {
		window.clearTimeout(hintTimer);
		hint.textContent = text;
		hint.style.display = "block";
	};
	const hideHint = () => {
		window.clearTimeout(hintTimer);
		hint.style.display = "none";
	};
	const flash = (text) => {
		showHint(text);
		hintTimer = window.setTimeout(hideHint, HINT_MS);
	};
	const pickBtn = iconButton("上傳圖片", pictureIcon());
	const shotBtn = iconButton("截取當前屏幕", cameraIcon());
	const hearUrl = typeof opts.hearUrl === "string" ? opts.hearUrl : "";
	const micBtn = iconButton("按住說話", micIcon());
	const fileInput = document.createElement("input");
	fileInput.type = "file";
	fileInput.accept = IMAGE_ACCEPT;
	fileInput.style.display = "none";
	const attach = document.createElement("div");
	attach.className = "dsh-pet-chat-attach";
	const thumb = document.createElement("img");
	thumb.className = "dsh-pet-chat-thumb";
	thumb.alt = "已選圖片";
	const attachX = document.createElement("button");
	attachX.type = "button";
	attachX.className = "dsh-pet-chat-attach-x";
	attachX.textContent = "✕";
	attachX.title = "移除圖片";
	attachX.setAttribute("aria-label", "移除圖片");
	attach.append(thumb, attachX);
	const actions = document.createElement("div");
	actions.className = "dsh-pet-chat-actions";
	actions.append(pickBtn, shotBtn, micBtn, fileInput, attach);
	root.append(input, actions, hint, err);
	document.body.appendChild(root);
	const resizeInput = enableAutoResize(input, root);
	let attachment;
	let encoding = false;
	let capturing = false;
	const clearAttach = () => {
		attachment = void 0;
		attach.dataset.on = "0";
		thumb.removeAttribute("src");
		fileInput.value = "";
	};
	/** 把编码结果挂上去：上传与截屏两条路共用这一处落点。 */
	const applyEncoded = (encoded) => {
		if (!root.isConnected) return false;
		attachment = {
			mediaType: encoded.mediaType,
			data: encoded.base64
		};
		thumb.src = encoded.previewUrl;
		attach.dataset.on = "1";
		return true;
	};
	const setImageFile = async (file) => {
		if (!isImageFile(file)) {
			flash("只支持 PNG / JPEG / WebP / GIF");
			return false;
		}
		encoding = true;
		pickBtn.disabled = true;
		try {
			return applyEncoded(await encodeImageFile(file));
		} catch (e) {
			flash("讀圖失敗：" + (e instanceof Error ? e.message : String(e)));
			return false;
		} finally {
			encoding = false;
			pickBtn.disabled = false;
		}
	};
	pickBtn.addEventListener("click", () => fileInput.click());
	fileInput.addEventListener("change", () => {
		const file = fileInput.files && fileInput.files[0];
		if (file) setImageFile(file);
	});
	attachX.addEventListener("click", clearAttach);
	root.addEventListener("paste", (e) => {
		const file = firstImageFromClipboard(e.clipboardData);
		if (!file) return;
		e.preventDefault();
		setImageFile(file);
	});
	if (opts.capture) {
		const capture = opts.capture;
		shotBtn.addEventListener("click", () => {
			if (capturing) return;
			capturing = true;
			shotBtn.disabled = true;
			capture().then((encoded) => applyEncoded(encoded)).catch((e) => flash("截屏失敗：" + (e instanceof Error ? e.message : String(e)))).finally(() => {
				capturing = false;
				shotBtn.disabled = false;
			});
		});
	} else shotBtn.addEventListener("click", () => flash("當前環境不支持截屏，先用上傳試試"));
	const hear = createHearControl({
		micBtn,
		input,
		hint: {
			show: showHint,
			hide: hideHint,
			flash
		},
		resizeInput,
		hearUrl
	});
	resizeInput();
	return {
		root,
		input,
		err,
		shotBtn,
		resizeInput,
		clearAttach,
		setImageFile,
		setEncoded: applyEncoded,
		getAttachment: () => attachment,
		isEncoding: () => encoding || capturing,
		flash,
		startHear: hear.start,
		stopHear: hear.stop,
		isHearing: hear.isHearing,
		dispose: () => {
			window.clearTimeout(hintTimer);
			hear.dispose();
		}
	};
}

//#endregion
//#region src/shared/chat/send.ts
/** 對話要等 LLM 生成回复，比碎碎念（30s）放宽一倍 */
const SEND_TIMEOUT_MS = 6e4;
async function sendChat(baseUrl, text, attachment) {
	const res = await fetch(baseUrl, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(attachment ? {
			text,
			attachment
		} : { text }),
		signal: AbortSignal.timeout(SEND_TIMEOUT_MS)
	});
	const raw = await res.json().catch(() => null);
	if (!raw || typeof raw !== "object") throw new Error("dsh-pet: 對話響應非法");
	const o = raw;
	if (o.ok !== true) return {
		ok: false,
		reason: o.reason === "provider-missing" || o.reason === "generate-error" || o.reason === "config-error" ? o.reason : "bad-request",
		message: typeof o.message === "string" ? o.message : void 0
	};
	return { ok: true };
}

//#endregion
//#region src/shared/chat/dialog.ts
/** 点弹窗外或按 Esc 关闭；返回解绑函数。 */
function bindDismiss(root, isClosed, onDismiss) {
	const onPointerDown = (e) => {
		if (isClosed() || root.contains(e.target)) return;
		onDismiss();
	};
	const onKeyDown = (e) => {
		if (e.key === "Escape") onDismiss();
	};
	document.addEventListener("mousedown", onPointerDown, true);
	document.addEventListener("keydown", onKeyDown, true);
	return () => {
		document.removeEventListener("mousedown", onPointerDown, true);
		document.removeEventListener("keydown", onKeyDown, true);
	};
}
/** 回车发送：成功后回调、失败把原因写进 err 行，不伪造回复。 */
function bindSend(binding) {
	let sending = false;
	const doSend = () => {
		if (binding.isClosed() || sending) return;
		if (binding.isEncoding()) {
			binding.notify("圖片還在處理，稍等一下");
			return;
		}
		const text = binding.input.value.trim();
		if (!text) return;
		sending = true;
		binding.input.disabled = true;
		sendChat(binding.url, text, binding.attachment()).then((state) => {
			if (state.ok) binding.onOk();
			else {
				binding.err.textContent = "對話失敗：" + (state.message ?? state.reason);
				binding.err.style.display = "block";
			}
		}).catch((e) => {
			binding.err.textContent = "對話異常：" + String(e && e.message ? e.message : e);
			binding.err.style.display = "block";
		}).finally(() => {
			sending = false;
			binding.input.disabled = false;
			if (!binding.isClosed()) binding.input.focus();
		});
	};
	binding.input.addEventListener("keydown", (e) => {
		if (e.key === "Enter") {
			e.preventDefault();
			doSend();
		}
	});
}
/**
* 由对话地址推导识别地址：两端传进来的都是 `.../chat`，去掉尾段换成 `/voice/hear`。
*
* @param baseUrl - 已含挂载前缀的對話地址。
* @returns 同前缀下的识别地址。
*/
function hearUrlOf(baseUrl) {
	return baseUrl.replace(/\/chat$/, "") + "/voice/hear";
}
function mountChatDialog(opts) {
	injectChatCss();
	const { petId, surface: surface$1, x, y, onSent, onClose, clamp } = opts;
	const baseUrl = opts.baseUrl ?? ROUTE_PATH + "/chat";
	const withPet = baseUrl + "?pet=" + encodeURIComponent(petId) + "&surface=" + surface$1;
	const c = clamp && Number.isFinite(clamp.x + clamp.y + clamp.w + clamp.h) ? clamp : {
		x: 0,
		y: 0,
		w: window.innerWidth,
		h: window.innerHeight
	};
	const dom = createChatDom({
		capture: opts.capture,
		hearUrl: opts.hearUrl ?? hearUrlOf(baseUrl)
	});
	const { root, input, err } = dom;
	/** 以 (x,y) 落点，超出 clamp 矩形夹回。 */
	const place = () => {
		const r = root.getBoundingClientRect();
		root.style.left = Math.max(c.x + 4, Math.min(x, c.x + c.w - r.width - 4)) + "px";
		root.style.top = Math.max(c.y + 4, Math.min(y, c.y + c.h - r.height - 4)) + "px";
	};
	let closed = false;
	let unbindDismiss = () => {};
	const close = () => {
		if (closed) return;
		closed = true;
		unbindDismiss();
		dom.dispose();
		dom.clearAttach();
		root.remove();
		if (onClose) onClose();
	};
	unbindDismiss = bindDismiss(root, () => closed, close);
	bindSend({
		input,
		err,
		url: withPet,
		isClosed: () => closed,
		onOk: () => {
			close();
			if (onSent) onSent();
		},
		attachment: () => dom.getAttachment(),
		isEncoding: () => dom.isEncoding(),
		notify: (text) => dom.flash(text)
	});
	dom.resizeInput();
	place();
	if (opts.initialImage) dom.setImageFile(opts.initialImage);
	if (opts.initialEncoded) dom.setEncoded(opts.initialEncoded);
	input.focus();
	return {
		el: root,
		close,
		startHear: dom.startHear,
		stopHear: dom.stopHear,
		isHearing: dom.isHearing,
		setEncoded: dom.setEncoded,
		setImageFile: dom.setImageFile,
		flash: dom.flash
	};
}

//#endregion
//#region src/shared/chat/capture.ts
/** 等到视频真正有尺寸。 */
function waitForFrame(video) {
	if (video.videoWidth > 0) return Promise.resolve();
	return new Promise((resolve) => {
		video.onloadeddata = () => resolve();
	});
}
async function captureDisplayFrame() {
	const media = navigator.mediaDevices;
	if (!media || typeof media.getDisplayMedia !== "function") throw new Error("當前環境不支持截屏");
	const stream = await media.getDisplayMedia({
		video: true,
		audio: false
	});
	try {
		const video = document.createElement("video");
		video.srcObject = stream;
		video.muted = true;
		await video.play();
		await waitForFrame(video);
		const canvas = document.createElement("canvas");
		canvas.width = video.videoWidth || 1280;
		canvas.height = video.videoHeight || 720;
		canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
		return encodeCanvas(canvas);
	} finally {
		for (const track of stream.getTracks()) track.stop();
	}
}

//#endregion
//#region src/client/file-drop.ts
const DROP_TARGET_CLASS = "is-drop-target";
function claimFileDragEnter(event) {
	if (!dragHasFiles(event)) return false;
	event.stopPropagation();
	hideHostDropOverlay();
	return true;
}
function claimFileDragOver(event) {
	if (!dragHasFiles(event)) return false;
	event.preventDefault();
	event.stopPropagation();
	return true;
}
function claimFileDrop(event) {
	if (!dragHasFiles(event)) return void 0;
	event.preventDefault();
	event.stopPropagation();
	hideHostDropOverlay();
	return firstImageFile(event.dataTransfer);
}
/**
* 收起宿主（DSH）的整页拖拽遮罩。
*
* 它用 document 上的 dragenter/dragleave 计数维护遮罩，只有 drop 与 window 的 dragend 会清零。
* 我们的 drop 截住冒泡后它收不到收尾信号，遮罩会一直挂着；补这一次不带文件，不会触发上传。
*/
function hideHostDropOverlay() {
	if (typeof window === "undefined") return;
	window.dispatchEvent(new Event("dragend"));
}
function markDropTarget(event) {
	const el = event.currentTarget;
	if (!(el instanceof HTMLElement)) return;
	if (!claimFileDragEnter(event)) return;
	el.classList.add(DROP_TARGET_CLASS);
}
function unmarkDropTarget(event) {
	const el = event.currentTarget;
	const to = event.relatedTarget;
	if (!(el instanceof HTMLElement)) return;
	if (to instanceof Node && el.contains(to)) return;
	el.classList.remove(DROP_TARGET_CLASS);
}

//#endregion
//#region src/client/pet/card/open-chat.ts
function bindOpenChat(input) {
	const { stage, isHovered, openChat } = input;
	const onKeyDown = (e) => {
		if (!isHovered() || !isChatHotkey(e)) return;
		e.preventDefault();
		openChat();
	};
	const onPaste = (e) => {
		if (!isHovered() || isTypingTarget(e.target)) return;
		const file = firstImageFromClipboard(e.clipboardData);
		if (file === void 0) return;
		e.preventDefault();
		openChat(file);
	};
	const onDragOver = (e) => {
		if (!claimFileDragOver(e)) return;
		if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
	};
	const onDrop = (e) => {
		const file = claimFileDrop(e);
		if (file !== void 0) openChat(file);
	};
	document.addEventListener("keydown", onKeyDown, true);
	document.addEventListener("paste", onPaste, true);
	stage?.addEventListener("dragenter", claimFileDragEnter);
	stage?.addEventListener("dragover", onDragOver);
	stage?.addEventListener("drop", onDrop);
	return () => {
		document.removeEventListener("keydown", onKeyDown, true);
		document.removeEventListener("paste", onPaste, true);
		stage?.removeEventListener("dragenter", claimFileDragEnter);
		stage?.removeEventListener("dragover", onDragOver);
		stage?.removeEventListener("drop", onDrop);
	};
}

//#endregion
//#region src/client/pet/card/entry.ts
function createCardEntry(rt) {
	const { useEffect, useRef } = rt;
	return function useCardEntry(input) {
		const { card, cfgRef, drag, live, menuItemsRef, motion, runMenuAction, showTodo, stage, tipRef, toggleTodo } = input;
		const menuRef = useRef(null);
		const chatRef = useRef(null);
		/** 把提示框摆到光标右下，放不下时翻边并夹回视口。
		*  直接写 DOM style：每次鼠标移动都走 React 状态会让整个 PetCard 重渲染。
		*/
		const placeTip = (clientX, clientY) => {
			const tipEl$1 = tipRef.current;
			if (!tipEl$1) return;
			const viewport = document.documentElement;
			const p = tooltipPlacement({
				x: clientX,
				y: clientY
			}, {
				w: tipEl$1.offsetWidth,
				h: tipEl$1.offsetHeight
			}, {
				x: 0,
				y: 0,
				w: viewport.clientWidth,
				h: viewport.clientHeight
			}, motion.metrics().size * TOOLTIP_GAP_RATIO);
			tipEl$1.style.left = p.x + "px";
			tipEl$1.style.top = p.y + "px";
		};
		useEffect(() => () => {
			if (menuRef.current) {
				menuRef.current.close();
				menuRef.current = null;
			}
			if (chatRef.current) {
				chatRef.current.close();
				chatRef.current = null;
			}
		}, []);
		/** 挂载對話弹窗：弹窗贴在身体命中区右上角，视频框右上角不等于宠物右上角；超出视口夹回。 */
		const mountChat = (seed) => {
			if (chatRef.current) chatRef.current.close();
			const hitRect = stage()?.querySelector(".dsh-pet-hit")?.getBoundingClientRect();
			chatRef.current = mountChatDialog({
				petId: cfgRef.current.id,
				baseUrl: ROUTE_PATH + "/chat",
				surface: "web",
				x: hitRect ? hitRect.right + 6 : window.innerWidth - 256,
				y: hitRect ? hitRect.top + 6 : 8,
				...seed.image ? { initialImage: seed.image } : {},
				...seed.encoded ? { initialEncoded: seed.encoded } : {},
				capture: captureDisplayFrame,
				onSent: () => {
					console.info("[dsh-pet] 對話已送出 pet=" + cfgRef.current.id);
				},
				onClose: () => {
					chatRef.current = null;
				}
			});
		};
		/** 打开对话（菜单、悬停 L、拖拽都走这条）；带图时直接进入待发送状态。 */
		const openChat = (image) => mountChat(image ? { image } : {});
		/** 把一张图送进对话：已开着就塞进去（不丢写了一半的字），没开就带图打开。 */
		const openChatWithImage = (file) => {
			const existing = chatRef.current;
			if (existing !== null) {
				existing.setImageFile(file);
				return;
			}
			openChat(file);
		};
		/** 打开待办面板：面板占气泡槽，重复点击是幂等的。 */
		const openTodo = () => showTodo();
		/** 「按住说话」按下：弹窗没开就先开一个，再让它开录；已开着就直接在它上面开录。 */
		const startChatHear = () => {
			if (!chatRef.current) openChat();
			chatRef.current?.startHear();
		};
		/** 「按住说话」松开：只收尾，不关弹窗——识别结果要落进输入框让人看一眼。 */
		const stopChatHear = () => {
			chatRef.current?.stopHear();
		};
		/** 打开对话：已经开着就只把焦点交回输入框，重开会把打了一半的字丢掉。 */
		const openChatOrFocus = () => {
			const existing = chatRef.current;
			if (existing === null) {
				openChat();
				return;
			}
			existing.el.querySelector(".dsh-pet-chat-input")?.focus();
		};
		/** 截一帧塞进對話；截不到时照样开弹窗，把原因写在弹窗里——静默失败会被当成快捷键坏了。 */
		const captureInto = async () => {
			let encoded;
			try {
				encoded = await captureDisplayFrame();
			} catch (error) {
				const reason = "截屏失敗：" + (error instanceof Error ? error.message : String(error));
				const opened = chatRef.current;
				if (opened !== null) {
					opened.flash(reason);
					return;
				}
				mountChat({});
				chatRef.current?.flash(reason);
				return;
			}
			const existing = chatRef.current;
			if (existing !== null) {
				existing.setEncoded(encoded);
				return;
			}
			mountChat({ encoded });
		};
		/** 截图動作的对外形状；异步收在里面，调用方不关心。 */
		const screenshot = () => {
			captureInto();
		};
		const hoverRef = useRef(false);
		const openChatRef = useRef(openChat);
		openChatRef.current = openChat;
		const stageGetterRef = useRef(stage);
		stageGetterRef.current = stage;
		const toggleTodoRef = useRef(toggleTodo);
		toggleTodoRef.current = toggleTodo;
		const toggleSleepRef = useRef(() => {});
		toggleSleepRef.current = () => {
			const asleep = live.current.flow?.sleeping() ?? false;
			runMenuAction(asleep ? {
				label: "起來",
				action: "wake"
			} : {
				label: "睡覺",
				action: "sleep"
			});
		};
		const switchDisplayRef = useRef(() => {});
		switchDisplayRef.current = (display) => {
			runMenuAction({
				label: "顯示位置",
				action: "set-display",
				display
			});
		};
		const startChatHearRef = useRef(startChatHear);
		startChatHearRef.current = startChatHear;
		const stopChatHearRef = useRef(stopChatHear);
		stopChatHearRef.current = stopChatHear;
		const openChatOrFocusRef = useRef(openChatOrFocus);
		openChatOrFocusRef.current = openChatOrFocus;
		const openChatWithImageRef = useRef(openChatWithImage);
		openChatWithImageRef.current = openChatWithImage;
		const screenshotRef = useRef(screenshot);
		screenshotRef.current = screenshot;
		useEffect(() => registerPetChatHandle(cfgRef.current.id, {
			open: () => openChatOrFocusRef.current(),
			close: () => chatRef.current?.close(),
			isOpen: () => chatRef.current !== null,
			startHear: () => startChatHearRef.current(),
			stopHear: () => stopChatHearRef.current(),
			isHearing: () => chatRef.current?.isHearing() ?? false,
			screenshot: () => screenshotRef.current()
		}), [cfgRef]);
		useEffect(() => {
			const offChat = bindOpenChat({
				stage: stageGetterRef.current(),
				isHovered: () => hoverRef.current,
				openChat: (image) => image === void 0 ? openChatRef.current() : openChatWithImageRef.current(image)
			});
			const hearHold = createHearHold({
				isArmed: () => {
					if (hoverRef.current) return true;
					const chat = chatRef.current;
					const active = document.activeElement;
					return !!chat && !!active && chat.el.contains(active);
				},
				onPress: () => startChatHearRef.current(),
				onRelease: () => stopChatHearRef.current()
			});
			const onKeyDown = (e) => {
				if (hearHold.onKeyDown(e)) {
					e.preventDefault();
					return;
				}
				if (!hoverRef.current) return;
				const display = displayOfHotkey(e);
				if (display !== void 0) {
					e.preventDefault();
					switchDisplayRef.current(display);
					return;
				}
				if (isCaptureHotkey(e)) {
					e.preventDefault();
					screenshotRef.current();
					return;
				}
				if (isSleepHotkey(e)) {
					e.preventDefault();
					toggleSleepRef.current();
					return;
				}
				if (!isTodoHotkey(e)) return;
				e.preventDefault();
				toggleTodoRef.current();
			};
			const onKeyUp = (e) => hearHold.onKeyUp(e);
			document.addEventListener("keydown", onKeyDown, true);
			document.addEventListener("keyup", onKeyUp, true);
			return () => {
				offChat();
				document.removeEventListener("keydown", onKeyDown, true);
				document.removeEventListener("keyup", onKeyUp, true);
			};
		}, []);
		live.current.placeTip = placeTip;
		live.current.tipOn = () => card.state.tipOn;
		/** 打开右键菜单。 */
		const handleContextMenu = (e) => {
			const more = buildMoreBranch(menuItemsRef.current);
			const pic = cfgRef.current;
			const memes = buildMemeBranch(pic, (name) => memeThumbUrl(ROUTE_PATH, pic.assetRoot, name));
			const asleep = live.current.flow?.sleeping() ?? false;
			const canSleep = (cfgRef.current.animations.sleep ?? []).length > 0;
			const sleepItem = asleep ? {
				label: "起來",
				action: "wake",
				hint: SLEEP_HOTKEY_HINT
			} : {
				label: "睡覺",
				action: "sleep",
				hint: SLEEP_HOTKEY_HINT
			};
			const tools = [
				{
					label: "查看餘額",
					action: "show-balance"
				},
				{
					label: "待辦事項",
					action: "todo",
					hint: TODO_HOTKEY_HINT
				},
				{
					label: "碎碎念",
					action: "whisper"
				},
				{
					label: "對話",
					action: "chat",
					hint: CHAT_HOTKEY_HINT
				},
				...memes ? [memes] : [],
				...canSleep ? [sleepItem] : []
			];
			const tail = [displayMenuBranch(), {
				label: "回到初始位置",
				action: "home"
			}];
			const tree = [
				...tools,
				...buildMenuTree(cfgRef.current.animations),
				...tail,
				...more ? [more] : []
			];
			if (!tree.length) return;
			e.preventDefault();
			e.stopPropagation();
			if (drag.isActive() || drag.justDragged()) return;
			motion.flight.stop();
			motion.stopMove();
			if (menuRef.current) menuRef.current.close();
			menuRef.current = mountContextMenu({
				tree,
				x: e.clientX,
				y: e.clientY,
				onAction: runMenuAction,
				onClose: () => {
					if (menuRef.current) menuRef.current = null;
				}
			});
		};
		return {
			handleContextMenu,
			onPointerEnter: (e) => {
				hoverRef.current = true;
				placeTip(e.clientX, e.clientY);
				card.actions.setTipOn(true);
			},
			onPointerLeave: () => {
				hoverRef.current = false;
				card.actions.setTipOn(false);
			},
			openChat,
			openTodo,
			placeTip
		};
	};
}

//#endregion
//#region src/client/pet/motion/flight-integrate.ts
function integrateFlight(state, dt, bounds, physics, gravity) {
	const substeps = throwSubsteps(state.vx, state.vy, dt);
	let res = throwStep(state, dt / substeps, bounds, physics, gravity);
	/** 子步里只保留最重的一次撞击：一帧震一下就够了。 */
	let hit = res.hit;
	for (let i = 1; i < substeps && !res.atRest; i++) {
		res = throwStep(res, dt / substeps, bounds, physics, gravity);
		if (res.hit !== null && (hit === null || res.hit.speed > hit.speed)) hit = res.hit;
	}
	return {
		...res,
		hit
	};
}

//#endregion
//#region src/client/pet/motion/pet-collision.ts
/**
* 把重叠推开：{@link overlapPush} 给的是「各让一半」，这里取整段——
* 对方若也在跑，它下一帧会从自己那侧再推一次，两边各推一次正好分开。
*
* @param state - 当前状态。
* @param push - 半程位移；`null` = 没有重叠。
* @returns 推开后的状态（速度不动）。
*/
const separate = (state, push) => push === null ? state : {
	...state,
	x: state.x + push.dx * 2,
	y: state.y + push.dy * 2
};
function createPetCollision(deps) {
	return (state, metrics) => {
		const slots = deps.arena().slots;
		const myBody = bodyPixelBox({
			x: state.x,
			y: state.y,
			size: metrics.size,
			bottomPad: metrics.bottomPad
		});
		for (const slotId of Object.keys(slots)) {
			if (slotId === deps.petId) continue;
			const slot = slots[slotId];
			const otherBox = slot.getBox();
			if (!otherBox) continue;
			const otherBody = bodyPixelBox({
				x: otherBox.x,
				y: otherBox.y,
				size: slot.size,
				bottomPad: slot.bottomPad
			});
			if (!rectsOverlap(myBody, otherBody)) continue;
			const separated = separate(state, overlapPush(myBody, otherBody));
			const vel = slot.getVel();
			const hit = collidePet({
				x: state.x,
				y: state.y,
				vx: state.vx,
				vy: state.vy,
				size: metrics.size
			}, {
				x: otherBox.x,
				y: otherBox.y,
				vx: vel.vx,
				vy: vel.vy,
				size: slot.size
			});
			if (hit === null) return separated;
			deps.onPetImpact(hit.impactSpeed);
			slot.applyVelocity(hit.hvx, hit.hvy);
			return {
				...separated,
				vx: hit.fvx,
				vy: hit.fvy
			};
		}
		return state;
	};
}

//#endregion
//#region src/client/pet/motion/flight.ts
/** 常驻模式的速度上限（px/s）：传感器重力会持续加速，留一个硬天花板兜底。 */
const MAX_HELD_SPEED = 6e3;
function createFlight(deps) {
	/** 在跑的 rAF；`null` = 没在跑。 */
	let frame = null;
	/** 世代号：起飞或停飞 +1，迟到的帧据此自弃。 */
	let token = 0;
	/** 最近一帧的状态；`null` = 没在跑。帧间它与帧内的 `current` 是同一个对象，改速度就是改下一刻的输入。 */
	let state = null;
	/** 是否体感常驻模式：重力逐帧由 {@link FlightDeps.gravity} 提供，落定改用静默计时。 */
	let held = false;
	/** 常驻模式的静默时长（ms）：重力为零且速度低时累计，到点停帧。 */
	let quietMs = 0;
	/** 互撞结算：规则在 pet-collision，这里只把撞击转成触觉回调。 */
	const resolveCollisions = createPetCollision({
		arena: deps.arena,
		petId: deps.petId,
		onPetImpact: (speed) => deps.onImpact?.({
			kind: "pet",
			speed
		})
	});
	const stop = () => {
		token++;
		if (frame !== null) {
			cancelAnimationFrame(frame);
			frame = null;
		}
		state = null;
		held = false;
		quietMs = 0;
	};
	const start = (px$1, py, vx, vy) => {
		held = false;
		run(px$1, py, vx, vy);
	};
	/** 体感常驻模式：没有初速，重力逐帧由 {@link FlightDeps.gravity} 提供；已在常驻时无副作用。 */
	const startHeld = () => {
		if (frame !== null && held) return;
		const el = deps.root();
		const box = deps.box() ?? (el ? {
			x: el.getBoundingClientRect().left,
			y: el.getBoundingClientRect().top
		} : null);
		if (box === null) return;
		held = true;
		run(box.x, box.y, 0, 0);
	};
	/**
	* 改写当前速度：碰撞结算给的是绝对速度，不是增量。
	*
	* @param vx - 水平速度（px/s）。
	* @param vy - 竖直速度（px/s）。
	*/
	const setVelocity = (vx, vy) => {
		if (state === null) return;
		state.vx = vx;
		state.vy = vy;
	};
	/**
	* 叠加一个冲量（摇一摇）：只在已经在跑时有效——没在跑时由调用方按抛掷起飞。
	*
	* @param dvx - 横向冲量（px/s）。
	* @param dvy - 纵向冲量（px/s）。
	*/
	const impulse = (dvx, dvy) => {
		if (state === null) return;
		state.vx += dvx;
		state.vy += dvy;
	};
	const run = (px$1, py, vx, vy) => {
		const metrics = deps.metrics();
		const viewport = deps.viewport();
		const physics = deps.physics();
		const bounds = throwBounds({
			W: viewport.width,
			H: viewport.height,
			size: metrics.size,
			sideAllow: metrics.sideAllow
		});
		const own = ++token;
		quietMs = 0;
		let current$1 = {
			x: px$1,
			y: py,
			vx,
			vy
		};
		let last = performance.now();
		let prevGrounded = false;
		const rootEl = deps.root();
		/** 写回本帧位置：DOM、包围盒与归一化中心（后者供重渲染时按它重排）。 */
		const commitPose = (at) => {
			if (rootEl) {
				rootEl.style.left = at.x + "px";
				rootEl.style.top = at.y + "px";
				rootEl.style.right = "auto";
				rootEl.style.bottom = "auto";
			}
			deps.setBox({
				x: at.x,
				y: at.y
			});
			const center = {
				rx: (at.x + metrics.halfW) / viewport.width,
				ry: (at.y + metrics.halfH) / viewport.height
			};
			deps.commitLive(center);
			return center;
		};
		const step = () => {
			if (token !== own) return;
			const now = performance.now();
			const dt = Math.min(.05, Math.max(0, (now - last) / 1e3));
			last = now;
			const fallingVy = current$1.vy;
			const gravity = held ? deps.gravity?.() : void 0;
			const res = integrateFlight(current$1, dt, bounds, physics, gravity);
			if (res.hit !== null) deps.onImpact?.({
				kind: res.hit.edge,
				speed: res.hit.speed
			});
			const integrated = {
				x: res.x,
				y: res.y,
				vx: res.vx,
				vy: res.vy
			};
			current$1 = integrated;
			if (physics.petCollision) current$1 = resolveCollisions(current$1, metrics);
			const disturbed = current$1 !== integrated;
			if (held) {
				const speed = Math.hypot(current$1.vx, current$1.vy);
				if (speed > MAX_HELD_SPEED) {
					const k = MAX_HELD_SPEED / speed;
					current$1 = {
						...current$1,
						vx: current$1.vx * k,
						vy: current$1.vy * k
					};
				}
			}
			state = current$1;
			const center = commitPose(current$1);
			const grounded = current$1.y >= bounds.maxY - 1;
			if (res.bounced && grounded && !prevGrounded) deps.onLanding(fallingVy);
			prevGrounded = grounded;
			if (held) {
				const g = gravity ?? {
					gx: 0,
					gy: physics.gravity
				};
				const isStill = Math.hypot(g.gx, g.gy) < 1 && Math.hypot(current$1.vx, current$1.vy) < 20;
				quietMs = isStill ? quietMs + dt * 1e3 : 0;
				if (quietMs >= 300) {
					deps.commitFinal(center);
					stop();
					return;
				}
			} else if (res.atRest && !disturbed) {
				deps.commitFinal(center);
				stop();
				return;
			}
			frame = requestAnimationFrame(step);
		};
		frame = requestAnimationFrame(step);
	};
	return {
		impulse,
		isFlying: () => frame !== null,
		isHeld: () => held,
		setVelocity,
		start,
		startHeld,
		stop,
		velocity: () => frame !== null && state !== null ? {
			vx: state.vx,
			vy: state.vy
		} : {
			vx: 0,
			vy: 0
		}
	};
}

//#endregion
//#region src/client/pet/haptics.ts
const HAPTIC_COOLDOWN_MS = 120;
const HAPTIC_MIN_SPEED = 150;
/** 手感锚点：与落地挤压同一组速度阈值——软碰取最短，硬砸取最长。 */
const SOFT_SPEED = 300;
const HARD_SPEED = 1500;
const SHORT_PULSE_MS = 10;
const LONG_PULSE_MS = 28;
function pulseMsFor(speed) {
	if (!Number.isFinite(speed) || speed < HAPTIC_MIN_SPEED) return null;
	const t = Math.min(1, Math.max(0, (speed - SOFT_SPEED) / (HARD_SPEED - SOFT_SPEED)));
	return Math.round(SHORT_PULSE_MS + (LONG_PULSE_MS - SHORT_PULSE_MS) * t);
}
function createHaptics(deps) {
	const vibrate = deps?.vibrate ?? hardwareVibrate;
	const now = deps?.now ?? (() => performance.now());
	const enabled = deps?.enabled ?? (() => true);
	/** 每类撞击上次震动的时刻；`undefined` = 还没震过。 */
	const lastAt = new Map();
	return { hit(kind, speed) {
		if (!enabled()) return;
		const ms = pulseMsFor(speed);
		if (ms === null) return;
		const at = now();
		const prev = lastAt.get(kind);
		if (prev !== void 0 && at - prev < HAPTIC_COOLDOWN_MS) return;
		lastAt.set(kind, at);
		vibrate(ms);
	} };
}
/** 真实硬件：无 API、页面不可见或 WebView 抛错时静默跳过——触觉不是关键路径。 */
function hardwareVibrate(ms) {
	if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
	if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
	try {
		navigator.vibrate(ms);
	} catch {}
}

//#endregion
//#region src/client/pet/motion/position-follow.ts
function createPositionFollow(deps) {
	/** 进行中的 rAF；`null` = 没有跟随在跑。 */
	let frame = null;
	/** 世代号：每次开始或停止 +1，迟到的帧据此自弃。 */
	let token = 0;
	const stop = () => {
		token += 1;
		if (frame !== null) {
			cancelAnimationFrame(frame);
			frame = null;
		}
	};
	/** 写包围盒与四个 style，弹簧和直线两条路共用。 */
	const paint = (el, x, y) => {
		deps.setBox({
			x,
			y
		});
		el.style.left = x + "px";
		el.style.top = y + "px";
		el.style.right = "auto";
		el.style.bottom = "auto";
	};
	const apply = (rx, ry, mode, duration) => {
		if (deps.isDragging()) return;
		deps.takeOver();
		const target = centerToBox({
			rx,
			ry
		}, deps.viewport(), deps.half());
		const el = deps.root();
		if (!el || mode === "instant" || mode === "line" && duration <= 0) {
			deps.setBox(target);
			deps.commit({
				rx,
				ry
			});
			return;
		}
		const current$1 = token + 1;
		token = current$1;
		if (frame !== null) cancelAnimationFrame(frame);
		if (mode === "line") {
			if (duration <= 0) return;
			const from = deps.box() ?? target;
			const t0 = performance.now();
			const step$1 = () => {
				if (token !== current$1) return;
				const p = Math.min((performance.now() - t0) / duration, 1);
				if (p >= 1) {
					paint(el, target.x, target.y);
					frame = null;
					deps.commit({
						rx,
						ry
					});
					return;
				}
				paint(el, from.x + (target.x - from.x) * p, from.y + (target.y - from.y) * p);
				frame = requestAnimationFrame(step$1);
			};
			frame = requestAnimationFrame(step$1);
			return;
		}
		let last = performance.now();
		const vel = {
			vx: 0,
			vy: 0
		};
		const step = () => {
			if (token !== current$1) return;
			const now = performance.now();
			const dt = Math.min((now - last) / 1e3, 1 / 30);
			last = now;
			let x = deps.box()?.x ?? target.x;
			let y = deps.box()?.y ?? target.y;
			vel.vx = springStep(vel.vx, x, target.x, dt, deps.spring());
			vel.vy = springStep(vel.vy, y, target.y, dt, deps.spring());
			x += vel.vx * dt;
			y += vel.vy * dt;
			paint(el, x, y);
			if (Math.abs(target.x - x) < .5 && Math.abs(target.y - y) < .5 && Math.abs(vel.vx) < 1 && Math.abs(vel.vy) < 1) {
				paint(el, target.x, target.y);
				frame = null;
				deps.commit({
					rx,
					ry
				});
				return;
			}
			frame = requestAnimationFrame(step);
		};
		frame = requestAnimationFrame(step);
	};
	return {
		apply,
		stop
	};
}

//#endregion
//#region src/client/pet/motion/squash.ts
function createSquashDriver(o) {
	/** 进行中的 rAF；`null` = 没有挤压在跑。 */
	let frame = null;
	/** 世代号：每次开始或停止都 +1，迟到的帧据此自弃。 */
	let token = 0;
	const stop = () => {
		token += 1;
		if (frame !== null) {
			cancelAnimationFrame(frame);
			frame = null;
		}
	};
	const start = (el, depth = SQ_SQUASH) => {
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
		token += 1;
		const current$1 = token;
		if (frame !== null) cancelAnimationFrame(frame);
		const origin = el.style.transformOrigin;
		el.style.transformOrigin = "bottom";
		const t0 = performance.now();
		const step = () => {
			if (token !== current$1) return;
			const u = Math.min((performance.now() - t0) / SQ_DURATION_MS, 1);
			const scale = squashScale(u, depth);
			el.style.transform = (o.facing() === "right" ? "scaleX(-1) " : "") + "scaleY(" + scale + ")";
			if (u < 1) {
				frame = requestAnimationFrame(step);
				return;
			}
			frame = null;
			el.style.transformOrigin = origin;
			el.style.transform = o.facing() === "right" ? "scaleX(-1)" : "";
		};
		frame = requestAnimationFrame(step);
	};
	return {
		start,
		stop
	};
}

//#endregion
//#region src/shared/motion.ts
const planMove = (o) => {
	const side = o.sideAllow ?? 0;
	const distance = randomBetween(o.minDist, o.maxDist);
	const target = o.cx + o.dir * distance;
	if (o.areas && o.areas.length > 0) {
		const bodyHalf = o.halfW - side;
		if (!rectAtPoint(o.areas, target - bodyHalf - o.margin, o.cy)) return null;
		if (!rectAtPoint(o.areas, target + bodyHalf + o.margin, o.cy)) return null;
	} else {
		const leftBound = o.margin + o.halfW - side;
		const rightBound = o.W - o.margin - o.halfW + side;
		if (target < leftBound || target > rightBound) return null;
	}
	return {
		startRatio: o.cx / o.W,
		startYRatio: o.cy / o.H,
		targetRatio: target / o.W,
		totalRatio: Math.abs(target - o.cx) / o.W
	};
};

//#endregion
//#region src/client/pet/motion/move-action.ts
function planMoveAction(input) {
	const actions = input.moves.actions;
	if (actions.length === 0) return null;
	const random = input.random ?? Math.random;
	const chosen = input.preferredName ? actions.find((action) => action.name === input.preferredName) ?? null : actions[Math.floor(random() * actions.length)];
	if (!chosen) return null;
	const params = Object.assign({}, input.moves.default, chosen.params ?? {});
	const dir = input.facing === "right" ? 1 : -1;
	const distScale = input.size / PET_REF_WIDTH;
	const plan = planMove({
		cx: input.center.x,
		cy: input.center.y,
		W: input.viewport.width,
		H: input.viewport.height,
		dir,
		minDist: params.minDist * distScale,
		maxDist: params.maxDist * distScale,
		margin: params.margin,
		halfW: input.halfW,
		sideAllow: input.sideAllow
	});
	if (plan === null) return null;
	return {
		anim: chosen.name,
		pending: {
			...plan,
			dir,
			leadSec: params.leadSec,
			tailSec: params.tailSec
		}
	};
}

//#endregion
//#region src/client/pet/motion/walk.ts
/** 元数据未就绪时的兜底时长（秒）：取内置走路素材的常见时长，避免除零。 */
const FALLBACK_DURATION_SEC = 10.09;
function createWalk(deps) {
	/** 在跑的 rAF；`null` = 没在走。 */
	let frame = null;
	/** 世代号：开跑或停走 +1，迟到的帧据此自弃。 */
	let token = 0;
	/** 已规划、等待视频就绪的走位。 */
	let pending = null;
	const hasPending = () => pending !== null;
	const start = (el) => {
		if (pending === null || frame !== null) return;
		const move = pending;
		pending = null;
		const duration = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : FALLBACK_DURATION_SEC;
		const travelWindow = Math.max(.1, duration - move.leadSec - move.tailSec);
		const own = ++token;
		const step = () => {
			if (token !== own) return;
			const t = el.currentTime || 0;
			const { halfW, halfH } = deps.metrics();
			const { width: W, height: H } = deps.viewport();
			let ratioX;
			if (t <= move.leadSec) ratioX = move.startRatio;
			else if (t >= duration - move.tailSec) ratioX = move.targetRatio;
			else ratioX = move.startRatio + (move.targetRatio - move.startRatio) * ((t - move.leadSec) / travelWindow);
			const box = {
				x: ratioX * W - halfW,
				y: move.startYRatio * H - halfH
			};
			const rootEl = deps.root();
			if (rootEl) {
				rootEl.style.left = box.x + "px";
				rootEl.style.top = box.y + "px";
				rootEl.style.right = "auto";
				rootEl.style.bottom = "auto";
			}
			deps.setBox(box);
			if (t < duration - move.tailSec) frame = requestAnimationFrame(step);
			else {
				frame = null;
				deps.commit({
					rx: move.targetRatio,
					ry: move.startYRatio
				});
			}
		};
		frame = requestAnimationFrame(step);
	};
	const tryMove = (preferredName) => {
		if (frame !== null || pending !== null || deps.isFlying()) return true;
		const metrics = deps.metrics();
		const action = planMoveAction({
			moves: deps.moves(),
			preferredName,
			facing: deps.facing(),
			size: metrics.size,
			center: deps.center(),
			viewport: deps.viewport(),
			halfW: metrics.halfW,
			sideAllow: metrics.sideAllow
		});
		if (action === null) return false;
		pending = action.pending;
		deps.play(action.anim);
		return action.anim;
	};
	const stop = () => {
		pending = null;
		token++;
		if (frame !== null) {
			cancelAnimationFrame(frame);
			frame = null;
		}
	};
	return {
		hasPending,
		start,
		stop,
		tryMove
	};
}

//#endregion
//#region src/client/pet/card/motion.ts
function createCardMotion(rt) {
	const { useEffect, useRef } = rt;
	return function useCardMotion(input) {
		const { arena, card, cfgRef, live, metrics, moves, petId, root, setAnim, setOnce, setCustomPos } = input;
		/** 当帧走位参数：走位驱动长期持有，每渲染就地更新，避免把尺寸与动画池闭包进旧实例。 */
		const motionRef = useRef(metrics);
		motionRef.current = metrics;
		const movesRef = useRef(moves);
		movesRef.current = moves;
		/** 包围盒：与拖拽、飞行共享，谁动谁写回。 */
		const boxRef = useRef(null);
		const squashRef = useRef(null);
		squashRef.current ?? (squashRef.current = createSquashDriver({ facing: () => card.facingRef.current }));
		const squash = squashRef.current;
		/** 当前宠物中心的视口 X 坐标。 */
		const currentCenterX = () => {
			const cp = card.customPosRef.current;
			if (cp) return cp.rx * window.innerWidth;
			const rootEl = root();
			if (rootEl) return rootEl.getBoundingClientRect().left + motionRef.current.halfW;
			return window.innerWidth - 24 - motionRef.current.halfW;
		};
		/** 当前宠物中心的视口 Y 坐标。 */
		const currentCenterY = () => {
			const cp = card.customPosRef.current;
			if (cp) return cp.ry * window.innerHeight;
			const rootEl = root();
			if (rootEl) return rootEl.getBoundingClientRect().top + motionRef.current.halfH;
			return window.innerHeight - 20 - motionRef.current.halfH;
		};
		const walkRef = useRef(null);
		walkRef.current ?? (walkRef.current = createWalk({
			root,
			center: () => ({
				x: currentCenterX(),
				y: currentCenterY()
			}),
			metrics: () => motionRef.current,
			moves: () => movesRef.current,
			facing: () => card.facingRef.current,
			viewport: () => ({
				width: window.innerWidth,
				height: window.innerHeight
			}),
			isFlying: () => flightRef.current?.isFlying() ?? false,
			play: (name) => {
				setOnce(true);
				setAnim(name);
			},
			setBox: (box) => {
				boxRef.current = box;
			},
			commit: setCustomPos
		}));
		const walk = walkRef.current;
		/** 停止自主走位与位置跟随。 */
		const stopMove = () => {
			walkRef.current?.stop();
			posFollowRef.current?.stop();
		};
		const flightRef = useRef(null);
		/** 触觉反馈：每张卡一个，冷却状态跟着卡片走；开关实时读配置。 */
		const hapticsRef = useRef(null);
		hapticsRef.current ?? (hapticsRef.current = createHaptics({ enabled: () => cfgRef.current.physics?.hapticEnabled !== false }));
		const haptics = hapticsRef.current;
		flightRef.current ?? (flightRef.current = createFlight({
			root,
			metrics: () => motionRef.current,
			viewport: () => ({
				width: window.innerWidth,
				height: window.innerHeight
			}),
			physics: () => cfgRef.current.physics,
			arena: () => arena.current,
			petId,
			box: () => boxRef.current,
			setBox: (box) => {
				boxRef.current = box;
			},
			commitLive: (center$1) => {
				card.customPosRef.current = center$1;
			},
			commitFinal: setCustomPos,
			onLanding: (impactVy) => {
				const frontEl = live.current.ownAnim.frontVideo();
				if (frontEl) live.current.squash.start(frontEl, landingSquash(impactVy));
			},
			onImpact: (impact) => {
				haptics.hit(impact.kind, impact.speed);
			},
			gravity: () => {
				const physics = cfgRef.current.physics;
				const gravity = physics?.gravity ?? 0;
				if (physics?.tiltGravity !== true) return {
					gx: 0,
					gy: gravity
				};
				const sample = tiltSampleRef.current;
				const baseline = tiltBaselineRef.current;
				if (sample === null || baseline === null) return {
					gx: 0,
					gy: gravity
				};
				return tiltGravity(sample, baseline, gravity);
			}
		}));
		const flight = flightRef.current;
		/** 体感：采样与中性姿态；关掉倾斜时两个都清空，下次再开重新标定。 */
		const tiltSampleRef = useRef(null);
		const tiltBaselineRef = useRef(null);
		/** 从给定左上角与初速起飞；先停弹簧跟随与走位，免得两套运动同时改位置。 */
		const startThrow = (px$1, py, vx, vy) => {
			live.current.drag.stopFollow();
			stopMove();
			flight.start(px$1, py, vx, vy);
		};
		/**
		* 把速度落到这只宠物身上：在跑就按给定口径处理，没跑就从落点起飞。
		*
		* 没跑时一律起抛掷而不是起常驻——常驻只在倾斜开关开着时由姿态采样拉起，
		* 否则重力非零时会留下一个永远停不下来的常驻循环。
		*
		* @param vx - 水平速度或冲量（px/s）。
		* @param vy - 竖直速度或冲量（px/s）。
		* @param mode - `set` = 结算后的绝对速度（碰撞）；`add` = 叠加冲量（摇一摇）。
		*/
		const applyVelocity = (vx, vy, mode) => {
			if (flight.isFlying()) {
				if (mode === "set") flight.setVelocity(vx, vy);
				else flight.impulse(vx, vy);
				return;
			}
			const at = boxRef.current ?? root()?.getBoundingClientRect() ?? null;
			if (at === null) return;
			startThrow(at.x, at.y, vx, vy);
		};
		/** 最新的 applyVelocity 引用，供碰撞槽与传感器回调转发，避免陈旧闭包。 */
		const applyVelocityRef = useRef(() => {});
		applyVelocityRef.current = applyVelocity;
		useEffect(() => {
			if (!canReadMotionSensors()) return;
			const offTilt = subscribeTilt((sample) => {
				if (cfgRef.current.physics?.tiltGravity !== true) {
					tiltSampleRef.current = null;
					tiltBaselineRef.current = null;
					if (flight.isHeld()) flight.stop();
					return;
				}
				if (tiltBaselineRef.current === null) tiltBaselineRef.current = sample;
				tiltSampleRef.current = sample;
				if (live.current.drag.isActive() || flight.isFlying()) return;
				const gravity = cfgRef.current.physics?.gravity ?? 0;
				const vector = tiltGravity(sample, tiltBaselineRef.current, gravity);
				if (vector.gx === 0 && vector.gy === 0) return;
				stopMove();
				flight.startHeld();
			});
			const offShake = subscribeShake((ax, ay, az) => {
				const physics = cfgRef.current.physics;
				if (physics?.shakeThrow !== true) return;
				if (live.current.drag.isActive()) return;
				const impulse = shakeImpulse(ax, ay, az, physics.throwPower ?? 1);
				if (impulse !== null) applyVelocityRef.current(impulse.vx, impulse.vy, "add");
			});
			return () => {
				offTilt();
				offShake();
				flight.stop();
			};
		}, []);
		const posFollowRef = useRef(null);
		posFollowRef.current ?? (posFollowRef.current = createPositionFollow({
			root,
			box: () => boxRef.current,
			setBox: (box) => {
				boxRef.current = box;
			},
			commit: setCustomPos,
			viewport: () => ({
				width: window.innerWidth,
				height: window.innerHeight
			}),
			half: () => ({
				w: motionRef.current.halfW,
				h: motionRef.current.halfH
			}),
			spring: () => cfgRef.current.physics.throwPower,
			isDragging: () => live.current.drag.isActive(),
			takeOver: () => {
				flightRef.current?.stop();
				walkRef.current?.stop();
				posFollowRef.current?.stop();
			}
		}));
		const posFollow = posFollowRef.current;
		/** 执行抛掷指令：角度（度，0 为正右，逆时针为正）与力度倍率换算成初速度，交给 startThrow。
		*  下游物理全部复用，不设死区。
		*/
		const applyThrow = (angleDeg, power) => {
			if (live.current.drag.isActive()) return;
			const { vx, vy } = throwVelocity(angleDeg, power);
			const box = boxRef.current ?? {
				x: currentCenterX() - motionRef.current.halfW,
				y: currentCenterY() - motionRef.current.halfH
			};
			startThrow(box.x, box.y, vx, vy);
		};
		const { size, bottomPad } = metrics;
		useEffect(() => {
			const arenaSlots = arena.current.slots;
			arenaSlots[petId] = {
				size,
				bottomPad,
				getBox: () => {
					if (boxRef.current) return boxRef.current;
					const r = root()?.getBoundingClientRect();
					return r ? {
						x: r.left,
						y: r.top
					} : null;
				},
				getVel: () => flight.velocity(),
				applyVelocity: (vx, vy) => applyVelocityRef.current(vx, vy, "set")
			};
			return () => {
				delete arenaSlots[petId];
			};
		}, [
			petId,
			size,
			bottomPad,
			arena
		]);
		const center = () => ({
			x: currentCenterX(),
			y: currentCenterY()
		});
		live.current.walk = walk;
		live.current.flight = flight;
		live.current.posFollow = posFollow;
		live.current.squash = squash;
		live.current.center = center;
		live.current.stopMove = stopMove;
		return {
			applyThrow,
			box: () => boxRef.current,
			center,
			flight,
			metrics: () => motionRef.current,
			posFollow,
			setBox: (box) => {
				boxRef.current = box;
			},
			squash,
			startThrow,
			stopMove,
			walk
		};
	};
}

//#endregion
//#region src/client/pet/card/state.ts
function createCardState(rt) {
	const { useState, useRef } = rt;
	return function useCardState(init) {
		const [anim, setAnim] = useState(init.anim);
		const [once, setOnce] = useState(true);
		const [seq, setSeq] = useState(0);
		const [cuePlayback, setCuePlayback] = useState(null);
		const [facing, setFacing] = useState("left");
		const [dragging, setDragging] = useState(false);
		const [tipOn, setTipOn] = useState(false);
		const [customPos, setCustomPos] = useState(null);
		const [size, setSize] = useState(init.size);
		const [corner, setCorner] = useState(init.corner);
		const [margin, setMargin] = useState(init.margin);
		const animRef = useRef(anim);
		animRef.current = anim;
		const facingRef = useRef(facing);
		facingRef.current = facing;
		const customPosRef = useRef(customPos);
		customPosRef.current = customPos;
		const bumpSeq = () => setSeq((s) => s + 1);
		const play = (next, opts) => {
			setAnim(next);
			setOnce(opts?.once ?? true);
			if (opts?.replay) bumpSeq();
			if (opts?.cue !== void 0) setCuePlayback(opts.cue);
		};
		return {
			actions: {
				bumpSeq,
				play,
				setAnim,
				setCorner,
				setCuePlayback,
				setCustomPos,
				setDragging,
				setFacing,
				setMargin,
				setOnce,
				setSize,
				setTipOn
			},
			animRef,
			customPosRef,
			facingRef,
			state: {
				anim,
				corner,
				cuePlayback,
				customPos,
				dragging,
				facing,
				margin,
				once,
				seq,
				size,
				tipOn
			}
		};
	};
}

//#endregion
//#region src/client/pet/card/cue-effects.ts
/** 日志行的时刻前缀。 */
const stamp = () => new Date().toTimeString().slice(0, 8);
/** 一行带时刻的日志：客户端统一前缀，便于 grep。 */
const log = (message) => {
	console.log("[dsh-pet] " + stamp() + " " + message);
};
function createCueEffects(rt) {
	const { useEffect, useRef } = rt;
	return function useCueEffects(hub, props) {
		const { balance, balanceManual, balanceNoticeTick, balanceTick } = props;
		const { animCue, animCueTick, posCue, posCueTick, say, sayTick, throwCue, throwCueTick } = props;
		const { workStatus, workStatusTick } = props;
		const prevBalanceRef = useRef(0);
		const prevNoticeRef = useRef(0);
		const prevWorkRef = useRef(0);
		const prevWorkStateRef = useRef(void 0);
		const prevSayRef = useRef(0);
		const prevAnimRef = useRef(0);
		const prevPosRef = useRef(0);
		const prevThrowRef = useRef(0);
		/** 餘額事件：按档位播事件动画并弹气泡。手动请求无条件弹，自动轮询要求开启且有百分比；
		*  睡着时自动来源整拍丢弃，否则会顶掉睡姿。 */
		const consumeBalance = () => {
			const cfg = hub.cfg();
			const card = hub.card;
			if (balanceTick === 0 || balanceTick === prevBalanceRef.current) return;
			prevBalanceRef.current = balanceTick;
			if (hub.ownAnim.isFrozen() && !balanceManual) return;
			if (hub.sleeping()) return;
			if (!balance || !balance.ok) return;
			if (!cfg.balanceEnabled && !balanceManual) return;
			const percent = balancePercent(balance);
			if (balanceManual || percent !== void 0 || balance.shape === "custom") hub.bubbles.showBalance();
			if (!cfg.balanceEnabled) return;
			if (percent === void 0) return;
			const pool = hub.anims().events?.balance;
			if (!pool || pool.length === 0) {
				console.error("[dsh-pet] 設定缺少 animations.events.balance，無法播放餘額事件動畫");
				return;
			}
			const idx = balanceEventIndex(percent);
			const slot = pool[idx];
			if (!slot) {
				console.error("[dsh-pet] balance 檔位索引越界：p=" + percent + " idx=" + idx);
				return;
			}
			const name = pickSlot(slot, card.animRef.current);
			log("balance pet=" + cfg.id + " p=" + percent.toFixed(1) + "% -> [檔" + idx + "] " + name);
			hub.stopMotion();
			card.actions.setOnce(true);
			card.actions.setAnim(name);
		};
		/** 餘額不可用：容器递增计数，本宠物只弹文字说明，不播档位动画。 */
		const consumeBalanceNotice = () => {
			const cfg = hub.cfg();
			if (!cfg.balanceEnabled && !balanceManual) return;
			if (balanceNoticeTick === 0 || balanceNoticeTick === prevNoticeRef.current) return;
			prevNoticeRef.current = balanceNoticeTick;
			if (hub.ownAnim.isFrozen() && !balanceManual) return;
			if (hub.sleeping()) return;
			if (!balance || balance.ok) return;
			hub.bubbles.showBalance();
		};
		/** 工作状态联动：按档位播动画并弹文本气泡；回空闲时收起气泡并改播完即停。 */
		const consumeWorkStatus = () => {
			const cfg = hub.cfg();
			const card = hub.card;
			if (!cfg.workStatusEnabled) return;
			if (workStatusTick === 0 || workStatusTick === prevWorkRef.current) return;
			prevWorkRef.current = workStatusTick;
			if (hub.ownAnim.isFrozen()) return;
			if (hub.sleeping()) return;
			if (!workStatus || workStatus.state === null) {
				log("pet=" + cfg.id + " " + (prevWorkStateRef.current ?? "null") + "->null    播完即停（回待機，收起氣泡）");
				prevWorkStateRef.current = null;
				if (poolIncludes(hub.anims().events?.workStatus ?? [], card.animRef.current)) hub.ownAnim.stopLoopingFront();
				hub.bubbles.resetWork();
				return;
			}
			const pool = hub.anims().events?.workStatus;
			if (!pool || pool.length === 0) {
				console.error("[dsh-pet] 設定缺少 animations.events.workStatus，無法播放工作狀態動畫");
				return;
			}
			const idx = WORK_STATUS_INDEX[workStatus.state];
			const slot = pool[idx];
			if (slot === void 0) {
				console.error("[dsh-pet] work-status 檔位索引越界：state=" + workStatus.state + " idx=" + idx);
				return;
			}
			const name = pickSlot(slot, card.animRef.current);
			log("pet=" + cfg.id + " " + (prevWorkStateRef.current ?? "null") + "->" + workStatus.state + "    " + name);
			const stateChanged = prevWorkStateRef.current !== workStatus.state;
			prevWorkStateRef.current = workStatus.state;
			hub.stopMotion();
			const textGroup = Array.isArray(cfg.workStatusTexts) ? cfg.workStatusTexts[idx] : void 0;
			const configuredText = Array.isArray(textGroup) && textGroup.length > 0 ? textGroup[Math.floor(Math.random() * textGroup.length)] : void 0;
			hub.bubbles.updateWorkText(workStatus.task ?? configuredText ?? null);
			const terminal = workStatus.state === "success" || workStatus.state === "error";
			if (stateChanged) hub.bubbles.lightWork(terminal);
			const rotating = !terminal && Array.isArray(slot) && slot.length > 1;
			card.actions.setOnce(terminal || rotating);
			card.actions.setAnim(name);
		};
		/** 说话（碎碎念、命令气泡、對話回复、清空）：序号变化即执行清空或弹气泡。 */
		const consumeSay = () => {
			if (!say || say.seq === prevSayRef.current) return;
			prevSayRef.current = say.seq;
			if (say.kind === "clear") {
				hub.bubbles.clearWhisper();
				return;
			}
			hub.speak(say.text, say.image, say.url, say.duration, say.anim);
			playSayVoice(say);
		};
		/** 点播动画：url 插播一段，名称走菜单同一套動作。 */
		const consumeAnimCue = () => {
			const card = hub.card;
			if (!animCue || animCue.seq === prevAnimRef.current) return;
			prevAnimRef.current = animCue.seq;
			const explicitFacing = animCue.facing !== void 0;
			if (animCue.facing !== void 0) {
				card.actions.setFacing(animCue.facing);
				card.facingRef.current = animCue.facing;
			}
			if (animCue.url !== void 0) {
				hub.stopMotion();
				hub.ownAnim.setCueUrl(animCue.url);
				card.actions.setOnce(true);
				card.actions.bumpSeq();
				card.actions.setAnim(animCue.url);
				card.actions.setCuePlayback(animCue.playbackId ?? null);
				return;
			}
			if (animCue.name === void 0) return;
			hub.playByName(animCue.name, animCue.playbackId, explicitFacing);
		};
		/** 位置指令：交给位置跟随；用户正按着宠物时由驱动整拍丢弃。 */
		const consumePosCue = () => {
			if (!posCue || posCue.seq === prevPosRef.current) return;
			prevPosRef.current = posCue.seq;
			hub.posFollow.apply(posCue.x, posCue.y, posCue.mode, posCue.duration);
		};
		/** 抛掷指令：交给抛掷驱动。 */
		const consumeThrowCue = () => {
			if (!throwCue || throwCue.seq === prevThrowRef.current) return;
			prevThrowRef.current = throwCue.seq;
			hub.applyThrow(throwCue.angle, throwCue.power);
		};
		useEffect(() => {
			consumeBalance();
			consumeBalanceNotice();
			consumeWorkStatus();
			consumeSay();
			consumeAnimCue();
			consumePosCue();
			consumeThrowCue();
		}, [
			balanceTick,
			balanceNoticeTick,
			workStatusTick,
			sayTick,
			animCueTick,
			posCueTick,
			throwCueTick
		]);
	};
}

//#endregion
//#region src/client/pet/card/lock-freeze.ts
function freezeDeadline(lock, nowMs) {
	const expiresAt = lock?.locked === true ? lock.expiresAt : 0;
	return expiresAt > nowMs ? expiresAt : 0;
}
/** 执行一次翻转；cue 为 null 表示状态本来就是这个值。 */
function dispatchCue(cue, handlers) {
	if (cue === null) return;
	if (cue.kind === "frozen") handlers.onFrozen();
	else handlers.onResumed();
}
function createLockFreeze(rt) {
	const { useEffect, useRef } = rt;
	return function useLockFreeze(input) {
		/** 解冻定时器；重算与本地解冻前都必须清掉，否则旧定时器会提前解冻。 */
		const timerRef = useRef(null);
		/** 清掉解冻定时器；重复调用安全。 */
		const clearTimer = () => {
			if (timerRef.current !== null) {
				window.clearTimeout(timerRef.current);
				timerRef.current = null;
			}
		};
		useEffect(() => {
			clearTimer();
			const now = Date.now();
			const expiresAt = freezeDeadline(input.lock, now);
			dispatchCue(input.setFrozen(expiresAt > now), input);
			if (expiresAt <= now) return clearTimer;
			timerRef.current = window.setTimeout(() => {
				timerRef.current = null;
				dispatchCue(input.setFrozen(false), input);
			}, expiresAt - now);
			return clearTimer;
		}, [input.lockTick, input.lock]);
		return { release: () => {
			clearTimer();
			dispatchCue(input.setFrozen(false), input);
		} };
	};
}

//#endregion
//#region src/client/pet/card/runtime.ts
function createCardRuntime(rt) {
	const { h, useEffect, useRef, useState } = rt;
	/** 餘額气泡：数据与显隐由装配根传入。 */
	const BalanceBubble = makeBalanceBubble({
		h,
		useState,
		useEffect
	});
	/** 碎碎念气泡：文本与显隐由装配根传入。 */
	const WhisperBubble = makeWhisperBubble({ h });
	/** 待办气泡：面板本体挂在自己身上，关闭按钮回调装配根。 */
	const TodoBubble = makeTodoBubble({
		h,
		useEffect,
		useRef
	});
	/** 四种气泡的单槽：显隐、停留计时与优先级都在这里。 */
	const useBubbleSlots = createBubbleSlots({
		h,
		useState,
		useEffect,
		useRef
	}, {
		balanceBubble: BalanceBubble,
		todoBubble: TodoBubble,
		whisperBubble: WhisperBubble
	});
	const useCardState = createCardState({
		useState,
		useRef
	});
	const useLockFreeze = createLockFreeze({
		useEffect,
		useRef
	});
	const useCueEffects = createCueEffects({
		useEffect,
		useRef
	});
	const useAnimationFlow = createAnimationFlow({ useRef });
	const useCardAnimation = createCardAnimation({
		useEffect,
		useRef
	});
	const useCardMotion = createCardMotion({
		useEffect,
		useRef
	});
	const useCardDrag = createCardDrag({
		useRef,
		useEffect
	});
	const useCardEntry = createCardEntry({
		useEffect,
		useRef
	});
	return function useCardRuntime(props) {
		const { arena, balance, balanceManual, cfg, lock, lockTick, menuItemsRef, sleep: sleep$1, sleepTick, workStatus } = props;
		const effectiveSizePx = resolvePetSizePx(cfg.size, cfg.sizePercent, window.innerWidth);
		const card = useCardState({
			anim: cfg.animations.idle[0] ?? "",
			corner: cfg.position.corner,
			margin: {
				x: cfg.position.marginX,
				y: cfg.position.marginY
			},
			size: effectiveSizePx
		});
		const { actions, state } = card;
		const { corner, customPos, dragging, facing, margin, size, tipOn } = state;
		const liveRef = useRef({});
		const menuActionsRef = useRef(null);
		const entryRef = useRef(null);
		const pendingSquashRef = useRef(false);
		const cfgRef = useRef(cfg);
		cfgRef.current = cfg;
		const workStatusRef = useRef(workStatus);
		workStatusRef.current = workStatus;
		const rootRef = useRef(null);
		const stageRef = useRef(null);
		const videoARef = useRef(null);
		const videoBRef = useRef(null);
		const tipRef = useRef(null);
		const reportPlayback = makePlaybackReporter({ petId: cfg.id });
		const { halfW, halfH, bottomPad, sideAllow } = derivePetMetrics(size);
		const fontPx = resolveFontPx(cfg.font, size);
		const petAnims = cfg.animations;
		useEffect(() => {
			actions.setSize(resolvePetSizePx(cfg.size, cfg.sizePercent, window.innerWidth));
		}, [cfg.size, cfg.sizePercent]);
		useEffect(() => {
			actions.setCorner(cfg.position.corner);
			actions.setMargin({
				x: cfg.position.marginX,
				y: cfg.position.marginY
			});
			actions.setCustomPos(null);
		}, [
			cfg.position.corner,
			cfg.position.marginX,
			cfg.position.marginY
		]);
		const bubbles = useBubbleSlots({
			assetRoot: cfg.assetRoot,
			balance,
			balanceEnabled: cfg.balanceEnabled,
			balanceManual,
			workStatusEnabled: cfg.workStatusEnabled,
			workTerminal: workStatus?.state === "success" || workStatus?.state === "error"
		});
		const ownAnim = useCardAnimation({
			card,
			cfgRef,
			live: liveRef,
			lock,
			pendingSquash: pendingSquashRef,
			petId: cfg.id,
			report: reportPlayback,
			setCuePlayback: actions.setCuePlayback,
			videoA: () => videoARef.current,
			videoB: () => videoBRef.current,
			workStatusRef
		});
		const motion = useCardMotion({
			arena,
			card,
			cfgRef,
			live: liveRef,
			metrics: {
				bottomPad,
				halfH,
				halfW,
				sideAllow,
				size
			},
			moves: petAnims.moves,
			petId: cfg.id,
			root: () => rootRef.current,
			setAnim: actions.setAnim,
			setCustomPos: actions.setCustomPos,
			setOnce: actions.setOnce
		});
		const drag = useCardDrag({
			bumpSeq: actions.bumpSeq,
			card,
			cfgRef,
			live: liveRef,
			motion,
			pendingSquash: pendingSquashRef,
			root: () => rootRef.current,
			setAnim: actions.setAnim,
			setCustomPos: actions.setCustomPos,
			setDragging: actions.setDragging,
			setOnce: actions.setOnce,
			setTipOn: actions.setTipOn,
			stage: () => stageRef.current
		});
		const entry = useCardEntry({
			card,
			cfgRef,
			drag,
			live: liveRef,
			menuItemsRef,
			motion,
			runMenuAction: (leaf$1, playbackId, keepFacing) => menuActionsRef.current?.run(leaf$1, playbackId, keepFacing),
			showTodo: bubbles.showTodo,
			stage: () => stageRef.current,
			tipRef,
			toggleTodo: bubbles.toggleTodo
		});
		entryRef.current = entry;
		menuActionsRef.current ?? (menuActionsRef.current = createMenuActions({
			animations: () => cfgRef.current.animations,
			applyMerged: (merged) => petBridge.reload(merged),
			faceLeft: () => actions.setFacing("left"),
			isFacingRight: () => card.facingRef.current === "right",
			openChat: () => entryRef.current?.openChat(),
			openTodo: () => entryRef.current?.openTodo(),
			petId: cfg.id,
			playOnce: (anim, playbackId) => {
				actions.setOnce(true);
				actions.setAnim(anim);
				actions.setCuePlayback(playbackId);
			},
			report: reportPlayback,
			resetPosition: () => actions.setCustomPos(null),
			say: (text) => liveRef.current.flow?.speak(text, void 0, void 0, void 0, false),
			locked: () => ownAnim.isFrozen(),
			sleepRefuseTexts: () => cfgRef.current.sleepRefuseTexts ?? [],
			sleeping: () => liveRef.current.flow?.sleeping() ?? false,
			stopMove: motion.stopMove,
			stopThrow: () => motion.flight.stop(),
			tryMove: motion.walk.tryMove,
			warn: (message) => console.warn(message)
		}));
		const menuActions = menuActionsRef.current;
		const lockFreeze = useLockFreeze({
			lock,
			lockTick,
			onFrozen: () => {
				motion.stopMove();
				bubbles.hideWork();
			},
			onResumed: () => {
				if (liveRef.current.flow?.resumeWorkStatusAnim() ?? false) return;
				if (petAnims.idle.length) {
					actions.setAnim(pick(petAnims.idle, card.animRef.current));
					actions.setOnce(true);
					actions.bumpSeq();
				}
			},
			setFrozen: ownAnim.setFrozen
		});
		liveRef.current.releaseLock = () => {
			lockFreeze.release();
			postAction(ROUTE_PATH + "/lock/release?pet=" + encodeURIComponent(cfg.id), { force: true });
		};
		const hub = {
			anims: () => cfgRef.current.animations,
			applyThrow: motion.applyThrow,
			bubbles,
			card,
			cfg: () => cfgRef.current,
			isDragging: () => drag.isActive(),
			ownAnim,
			playByName: (anim, playbackId, keepFacing) => menuActions.run({
				anim,
				label: anim
			}, playbackId, keepFacing, true),
			posFollow: motion.posFollow,
			speak: (text, image, url, duration, anim) => liveRef.current.flow?.speak(text, image, url, duration, anim),
			sleeping: () => liveRef.current.flow?.sleeping() ?? false,
			locked: () => ownAnim.isFrozen(),
			stopMotion: motion.stopMove,
			tryWalk: motion.walk.tryMove
		};
		useCueEffects(hub, props);
		const flow = useAnimationFlow(hub, workStatus);
		liveRef.current.flow = flow;
		useEffect(() => {
			if (sleep$1) flow.applySleep(sleep$1);
		}, [sleepTick]);
		const stageStyle = petStageStyle(dragging, bottomPad);
		const rootStyle = petRootStyle(customPos, {
			width: window.innerWidth,
			height: window.innerHeight
		}, {
			h: halfH,
			w: halfW
		});
		return {
			bubble: bubbles.node(),
			corner,
			facing,
			fontBubblePx: fontPx.bubble,
			fontTipPx: fontPx.tip,
			marginX: margin.x,
			marginY: margin.y,
			name: cfg.name,
			onClick: () => {
				if (drag.justDragged() || drag.isActive()) return;
				const phase = liveRef.current.flow?.sleepPhase() ?? null;
				if (phase !== null && phase !== "start") {
					const front = ownAnim.frontVideo();
					if (front) liveRef.current.squash.start(front);
					playClickSound();
					postAction(ROUTE_PATH + "/wake?pet=" + encodeURIComponent(cfg.id));
					return;
				}
				if (phase === "start") postAction(ROUTE_PATH + "/wake?pet=" + encodeURIComponent(cfg.id));
				drag.onClick();
			},
			onContextMenu: entry.handleContextMenu,
			onPointerDown: drag.onPointerDown,
			onPointerEnter: entry.onPointerEnter,
			onPointerLeave: entry.onPointerLeave,
			onPointerMove: drag.onPointerMove,
			onPointerUp: drag.onPointerUp,
			rootRef,
			rootStyle,
			size,
			stageRef,
			stageStyle,
			tipOn,
			tipRef,
			videoARef,
			videoBRef
		};
	};
}

//#endregion
//#region src/client/pet/card/pet-card.ts
function createPetCard(rt) {
	const { h } = rt;
	/** 宠物卡的 DOM 结构：只拼装，不持有状态。 */
	const CardView = makeCardView({ h });
	const useCardRuntime = createCardRuntime(rt);
	/** 单个宠物实例，配置由容器传入。 */
	function PetCard(props) {
		return h(CardView, useCardRuntime(props));
	}
	return PetCard;
}

//#endregion
//#region src/client/pet/state-poll.ts
/** 一个不会 resolve 的等待：单纯让出这一拍，用定时器而不是忙等。 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function runStatePoll(deps) {
	/** 宿主是否支持长轮询：首拍带 counter 就是支持。 */
	let longPoll = false;
	/** 上次拿到的 counter，作为长轮询的 since。 */
	let since;
	while (deps.isAlive()) {
		let state = null;
		try {
			state = await deps.fetch(longPoll && since !== void 0 ? {
				since,
				timeoutMs: deps.waitMs
			} : void 0);
		} catch {}
		if (!deps.isAlive()) return;
		if (state !== null) {
			longPoll = typeof state.counter === "number";
			if (longPoll && typeof state.counter === "number") since = state.counter;
			deps.onState(state);
		}
		if (state === null || !longPoll) await sleep(deps.fallbackMs);
	}
}

//#endregion
//#region src/client/state-service.ts
/** 最近一拍的状态；`null` = 本页还没拉到过。 */
let latest = null;
/** 订阅者：每来一拍通知一次。 */
const listeners = new Set();
function setStateSnapshot(state) {
	latest = state;
	for (const listener of listeners) try {
		listener(state);
	} catch (error) {
		console.error("[dsh-pet] 狀態訂閱回調出錯（已忽略，不影響輪詢）：", error);
	}
}
function getStateSnapshot() {
	return latest;
}
function subscribeStateSnapshot(listener) {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

//#endregion
//#region src/client/pet/multi.ts
function createPetMulti(rt, Card) {
	const { h, useState, useEffect, useRef } = rt;
	return function PetMulti() {
		const [pets, setPets] = useState([]);
		const [ready, setReady] = useState(false);
		const arenaRef = useRef({ slots: {} });
		const [balance, setBalance] = useState(null);
		const [balanceTick, setBalanceTick] = useState(0);
		const [balanceNoticeTick, setBalanceNoticeTick] = useState(0);
		const [balanceManual, setBalanceManual] = useState(false);
		const noticeKeyRef = useRef(null);
		const applyBalanceRef = useRef(() => {});
		applyBalanceRef.current = (state, explicit) => {
			setBalance(state);
			setBalanceManual(explicit);
			if (state.ok) {
				setBalanceTick((t) => t + 1);
				return;
			}
			const { show, key } = decideBalanceNotice(state, noticeKeyRef.current, explicit);
			noticeKeyRef.current = key;
			if (show) setBalanceNoticeTick((t) => t + 1);
			if (state.reason !== "unsupported") console.error("[dsh-pet] 餘額查詢失敗 reason=" + state.reason + (state.message ? " " + state.message : ""));
		};
		const [workStatus, setWorkStatus] = useState(null);
		const [workStatusTick, setWorkStatusTick] = useState(0);
		useEffect(() => {
			const family = pets[0]?.font?.family;
			if (family === void 0) return;
			document.documentElement.style.setProperty("--dsh-pet-font-family", fontStackOf(family));
		}, [pets]);
		useEffect(() => {
			let alive = true;
			/** 唯一填充点：成品聚合 → 渲染列表；条目级字段只由 flattenConfigPets 吹入。 */
			const applyMerged = (merged) => {
				const main = merged?.main;
				if (typeof main !== "object" || main === null) throw new Error("設定響應不是成品聚合（host 版本不匹配？）");
				setClickSoundEnabled(main.clickSoundEnabled === true);
				setSurface("web");
				setVoiceConfig(main.voiceName, main.voiceEnabled, main.voiceVolume);
				const flattened = flattenConfigPets(merged);
				petBridge.current = flattened;
				petBridge.template = Array.isArray(main.pets) ? main.pets[0] ?? void 0 : void 0;
				setPets(flattened);
			};
			/** 拉取成品聚合：host readAllConfig 的输出，客户端零校验零兜底。 */
			const loadMerged = async () => {
				const r = await fetch(ROUTE_PATH + "/config", { cache: "no-store" });
				if (!r.ok) throw new Error("config HTTP " + r.status);
				const body = await r.json();
				if (body.ok === false) throw new Error("config: " + String(body.reason ?? "failed"));
				return body;
			};
			(async () => {
				try {
					const merged = await loadMerged();
					if (!alive) return;
					applyMerged(merged);
					setReady(true);
				} catch (e) {
					console.error("[dsh-pet] 設定載入失敗", e);
				}
			})();
			petBridge.reload = (merged) => {
				(async () => {
					try {
						const next = merged ?? await loadMerged();
						if (!alive) return;
						applyMerged(next);
					} catch (e) {
						console.error("[dsh-pet] 設定重載失敗，保留當前渲染列表", e);
					}
				})();
			};
			return () => {
				alive = false;
				petBridge.reload = () => {};
			};
		}, []);
		const visiblePets = pets.filter((p) => isWebVisible(p.display));
		const [sayTick, setSayTick] = useState(0);
		const sayRef = useRef({});
		const [animCueTick, setAnimCueTick] = useState(0);
		const animCueRef = useRef({});
		const [posCueTick, setPosCueTick] = useState(0);
		const posCueRef = useRef({});
		const [throwCueTick, setThrowCueTick] = useState(0);
		const throwCueRef = useRef({});
		const [lockTick, setLockTick] = useState(0);
		const lockRef = useRef({});
		const [sleepTick, setSleepTick] = useState(0);
		const sleepRef = useRef({});
		const menuItemsRef = useRef([]);
		useEffect(() => {
			if (!ready) return;
			let alive = true;
			let baseline = null;
			/** 分段叶子 → 消费端副作用；不认识的名字已被 resolveLeafPath 挡在外面。 */
			const applySection = (name, leaf$1) => {
				switch (name) {
					case "config":
						petBridge.reload();
						return;
					case "balance": {
						const hit = readBalance(leaf$1);
						if (hit) applyBalanceRef.current(hit.state, hit.manual);
						return;
					}
					case "workStatus": {
						const snap = readWorkStatus(leaf$1);
						if (snap) {
							setWorkStatus(snap);
							setWorkStatusTick((t) => t + 1);
						}
						return;
					}
					case "notify":
						notifyFromFrame(leaf$1.data);
						return;
					case "menu":
						menuItemsRef.current = readMenuItems(leaf$1.data, "web");
						setMenuItems(menuItemsRef.current);
						return;
				}
			};
			/** 宠物叶子 → 该宠物的指令槽；序号自增，卡片据此知道「又写了一次」。 */
			const applyPetLeaf = (name, petId, leaf$1) => {
				switch (name) {
					case "say": {
						const said = readSay(leaf$1);
						if (!said) return;
						sayRef.current[petId] = {
							...said,
							seq: (sayRef.current[petId]?.seq ?? 0) + 1
						};
						setSayTick((t) => t + 1);
						return;
					}
					case "anim": {
						const hit = readAnim(leaf$1);
						if (!hit) return;
						animCueRef.current[petId] = {
							name: hit.name,
							url: hit.url,
							playbackId: hit.playbackId,
							facing: hit.facing,
							seq: (animCueRef.current[petId]?.seq ?? 0) + 1
						};
						setAnimCueTick((t) => t + 1);
						return;
					}
					case "position": {
						const hit = readPosition(leaf$1);
						if (!hit) return;
						posCueRef.current[petId] = {
							...hit,
							seq: (posCueRef.current[petId]?.seq ?? 0) + 1
						};
						setPosCueTick((t) => t + 1);
						return;
					}
					case "throw": {
						const hit = readThrow(leaf$1);
						if (!hit) return;
						throwCueRef.current[petId] = {
							...hit,
							seq: (throwCueRef.current[petId]?.seq ?? 0) + 1
						};
						setThrowCueTick((t) => t + 1);
						return;
					}
					case "lock": {
						const hit = readLock(leaf$1);
						if (!hit) return;
						lockRef.current[petId] = hit;
						setLockTick((t) => t + 1);
						return;
					}
					case "sleep": {
						const hit = readSleep(leaf$1);
						if (!hit) return;
						sleepRef.current[petId] = hit;
						setSleepTick((t) => t + 1);
						return;
					}
				}
			};
			/** 应用一份轮询状态：首拉只记基线，之后按 counter 变化逐个分发。 */
			const applyState = (s) => {
				setStateSnapshot(s);
				if (baseline === null) {
					baseline = flattenCounters(s);
					menuItemsRef.current = readMenuItems(s.sections.menu?.data, "web");
					setMenuItems(menuItemsRef.current);
					for (const [petId, entry] of Object.entries(s.pets)) {
						const hit = entry?.sleep?.data == null ? null : readSleep(entry.sleep);
						if (hit) sleepRef.current[petId] = hit;
					}
					setSleepTick((t) => t + 1);
					return;
				}
				for (const { path, leaf: leaf$1 } of takeChanged(s, baseline)) {
					if (leaf$1.data === null) continue;
					const target = resolveLeafPath(path);
					if (target === null) continue;
					if (target.where === "section") applySection(target.name, leaf$1);
					else applyPetLeaf(target.name, target.petId, leaf$1);
				}
			};
			runStatePoll({
				fetch: (options) => fetchState(void 0, options === void 0 ? void 0 : {
					since: options.since,
					timeoutMs: options.timeoutMs
				}),
				onState: applyState,
				waitMs: STATE_WAIT_MS,
				fallbackMs: STATE_FALLBACK_MS,
				isAlive: () => alive
			});
			return () => {
				alive = false;
			};
		}, [ready]);
		return ready ? visiblePets.map((p) => h(Card, {
			key: p.id,
			cfg: p,
			balance,
			balanceTick,
			balanceNoticeTick,
			balanceManual,
			workStatus,
			workStatusTick,
			say: sayRef.current[p.id],
			sayTick,
			animCue: animCueRef.current[p.id],
			animCueTick,
			posCue: posCueRef.current[p.id],
			posCueTick,
			throwCue: throwCueRef.current[p.id],
			throwCueTick,
			lock: lockRef.current[p.id],
			lockTick,
			sleep: sleepRef.current[p.id],
			sleepTick,
			menuItemsRef,
			arena: arenaRef
		})) : null;
	};
}

//#endregion
//#region src/client/pet.ts
function makePetUI(rt) {
	injectPetCss();
	const PetCard = createPetCard(rt);
	const PetMulti = createPetMulti(rt, PetCard);
	return PetMulti;
}

//#endregion
//#region src/client/command-faces.ts
function installCommandFaces(commandUi, faces) {
	const original = commandUi.candidates;
	if (typeof original !== "function") {
		console.warn("[dsh-pet] 命令圖標不可用：commandUi.candidates 缺失（命令本身仍可用，只是沒有圖標）");
		return () => {};
	}
	const patched = async (session, req) => {
		const rows = await original.call(commandUi, session, req);
		try {
			if (!Array.isArray(rows)) return rows;
			return rows.map((raw) => {
				if (raw === null || typeof raw !== "object") return raw;
				const row = raw;
				const face = faces.get(typeof row.name === "string" ? row.name : "");
				if (face === void 0 || row.icon !== void 0) return row;
				return {
					...row,
					label: face.label(),
					icon: face.icon
				};
			});
		} catch (error) {
			console.warn("[dsh-pet] 命令圖標補丁異常，本次退回原始菜單行：" + (error instanceof Error ? error.message : String(error)));
			return rows;
		}
	};
	commandUi.candidates = patched;
	return () => {
		if (commandUi.candidates === patched) commandUi.candidates = original;
	};
}

//#endregion
//#region src/client/nav-icon.ts
/**
* 设置面板导航图标补丁：把「桌宠配置」那一行的兜底齿轮换成指定图标。
* DSH 的导航图标按分区 id 硬编码白名单，且私有、外部拿不到引用，只能在 DOM 层做。
* 只打 `data-*` 标记并用 `::before` + mask 画字形，不动 DOM 结构，否则 React 会对被替换的节点 removeChild 崩。
* mask 是 data URI，即独立图像文档：宿主 0.2.2 起图标改成 sprite 引用（`<use>` 指向页面里的 `<symbol>`），
* 必须先展开成自包含 SVG，否则 mask 全透明、齿轮又被盖住，那一行直接变成零图标。
* sprite 由宿主在挂载后才注入，装配这一刻取不到，所以字形推迟到认出面板时才解析。
* 认行只能靠标题文本：投影到 DOM 的只有 label，而 account 行条件出现、位置会漂，不能用 `:nth-child`。
* 降级：缺 document / MutationObserver、取不到字形时不装（齿轮留着），认不出那一行时什么都不要做，只告警。
* @module dsh-pet/src/client/nav-icon
*/
/** 注入的样式表去重标记（与宠物页面 / 设置页同一套 `data-plugin-css` 约定）。 */
const STYLE_TAG = "dsh-pet/nav-icon.css";
/** 打在目标行 `<button>` 上的标记属性：React 从不 diff 它，重渲染 / 切语言都不要会掉。 */
const MARK = "data-dsh-pet-nav";
/** 设置面板根节点：shell 用 `createPortal` 挂到 body 上。 */
const PANEL_SELECTOR = "[data-shortcut-modal=\"settings\"]";
/**
* 类名来自 CSS Modules，哈希前缀会随 DSH 构建变，只匹配 `navList` / `navCell` / `navLabel` 这些名字部分。
*/
const LIST_SELECTOR = "[class*=\"navList\"]";
const CELL_SELECTOR = "[class*=\"navCell\"]";
const LABEL_SELECTOR = "[class*=\"navLabel\"]";
function svgMaskUri(svg) {
	const source = svg.trim();
	if (source === "") return "";
	const namespaced = /<svg[^>]*\sxmlns=/i.test(source) ? source : source.replace(/<svg\b/i, "<svg xmlns=\"http://www.w3.org/2000/svg\"");
	return "url(\"data:image/svg+xml," + encodeURIComponent(namespaced.split("currentColor").join("#000")) + "\")";
}
function expandUseRefs(svg, lookup) {
	const ref = /<use\b[^>]*\s(?:xlink:)?href="#([^"]+)"/i.exec(svg);
	if (ref === null) return svg;
	const symbol = lookup(ref[1]);
	if (symbol === void 0) return void 0;
	const attrs = Object.entries(symbol.attrs).map(([name, value]) => " " + name + "=\"" + value + "\"").join("");
	return "<svg xmlns=\"http://www.w3.org/2000/svg\"" + attrs + ">" + symbol.content + "</svg>";
}
function symbolIn(find) {
	return (id) => {
		const symbol = find(id);
		if (symbol === null) return void 0;
		const attrs = {};
		for (let index = 0; index < symbol.attributes.length; index += 1) {
			const attr = symbol.attributes.item(index);
			if (attr === null || attr.name === "id") continue;
			attrs[attr.name] = attr.value;
		}
		return {
			attrs,
			content: symbol.innerHTML
		};
	};
}
/** 换字形用的 CSS：盖住齿轮，用 `::before` + mask 画上我们的图标。 */
function cssFor(glyph) {
	return [
		"/* 「桌寵設定」行的導航圖標：蓋住齒輪，換成本模塊的圖形 */",
		"[" + MARK + "] [class*=\"navIcon\"]{display:none}",
		"[" + MARK + "]::before{content:\"\";flex:none;width:16px;height:16px;background-color:currentColor;-webkit-mask:" + glyph + " center/16px 16px no-repeat;mask:" + glyph + " center/16px 16px no-repeat}"
	].join("\n");
}
/** 注入样式表（只注入一次）。 */
function injectCss(doc, glyph) {
	if (doc.querySelector("style[data-plugin-css=\"" + STYLE_TAG + "\"]") !== null) return;
	const tag = doc.createElement("style");
	tag.dataset.plugin = "dsh-pet";
	tag.dataset.pluginCss = STYLE_TAG;
	tag.textContent = cssFor(glyph);
	doc.head.appendChild(tag);
}
/** 异常 → 单行文案（告警用）。 */
function describe(error) {
	return error instanceof Error ? error.message : String(error);
}
function installSectionNavIcon(target) {
	const doc = typeof document === "undefined" ? void 0 : document;
	const Observer = typeof MutationObserver === "undefined" ? void 0 : MutationObserver;
	if (doc === void 0 || Observer === void 0 || doc.body === null) {
		console.warn("[dsh-pet] 設定頁導覽圖示不可用：缺少 document / body / MutationObserver（齒輪照舊）");
		return () => {};
	}
	let injected = false;
	let warnedGlyph = false;
	/** 告警只报一次：面板反复开关会反复走到同一条失败路径。 */
	const warnGlyph = (reason) => {
		if (warnedGlyph) return;
		warnedGlyph = true;
		console.warn("[dsh-pet] 設定頁導覽圖示不可用：" + reason + "（齒輪照舊）");
	};
	/** 解析并注入换字形样式；成功一次后不再重算，失败时留待面板下次出现再试。 */
	const ensureCss = () => {
		if (injected) return;
		let glyph;
		try {
			const expanded = expandUseRefs(target.renderSvg(), symbolIn((id) => doc.getElementById(id)));
			if (expanded === void 0) {
				warnGlyph("sprite 里找不到引用的 <symbol>");
				return;
			}
			glyph = svgMaskUri(expanded);
		} catch (error) {
			warnGlyph("圖標渲染失敗：" + describe(error));
			return;
		}
		if (glyph === "") {
			warnGlyph("圖標渲成了空 SVG");
			return;
		}
		injectCss(doc, glyph);
		injected = true;
	};
	let warned = false;
	/** 给面板里标题匹配的那一行打标记（幂等；已打过的不再读标题）。 */
	const markPanel = (panel) => {
		try {
			const wanted = target.label();
			if (wanted === "") return;
			const list = panel.querySelector(LIST_SELECTOR);
			if (list === null) return;
			for (const cell of list.querySelectorAll(CELL_SELECTOR)) {
				if (cell.getAttribute(MARK) !== null) continue;
				if (cell.querySelector(LABEL_SELECTOR)?.textContent === wanted) cell.setAttribute(MARK, "");
			}
		} catch (error) {
			if (!warned) {
				warned = true;
				console.warn("[dsh-pet] 設定頁導航圖標補丁異常，本次跳過（齒輪照舊）：" + describe(error));
			}
		}
	};
	let watched;
	let panelObserver;
	const sync = () => {
		const panel = doc.querySelector(PANEL_SELECTOR);
		if (panel === null) {
			panelObserver?.disconnect();
			panelObserver = void 0;
			watched = void 0;
			return;
		}
		markPanel(panel);
		if (panel === watched) return;
		ensureCss();
		panelObserver?.disconnect();
		watched = panel;
		panelObserver = new Observer(() => {
			markPanel(panel);
		});
		panelObserver.observe(panel, {
			childList: true,
			subtree: true
		});
	};
	sync();
	const bodyObserver = new Observer(sync);
	bodyObserver.observe(doc.body, { childList: true });
	return () => {
		bodyObserver.disconnect();
		panelObserver?.disconnect();
	};
}

//#endregion
//#region src/client/chat/api.ts
/** 校验并收窄一条图片引用；形状不对返回 undefined（旧记录没有这个字段）。 */
function imageRefOf(raw) {
	if (!raw || typeof raw !== "object") return void 0;
	const ref = raw;
	if (typeof ref.attachmentId !== "string" || ref.attachmentId === "") return void 0;
	const num = (value) => typeof value === "number" && Number.isFinite(value) ? value : 0;
	return {
		attachmentId: ref.attachmentId,
		mediaType: typeof ref.mediaType === "string" ? ref.mediaType : "image/png",
		bytes: num(ref.bytes),
		width: num(ref.width),
		height: num(ref.height)
	};
}
function toChatMessages(body) {
	const raw = body?.messages;
	if (!Array.isArray(raw)) return [];
	const out = [];
	for (const item of raw) {
		if (!item || typeof item !== "object") continue;
		const m = item;
		const role = m.role === "assistant" ? "assistant" : m.role === "user" ? "user" : void 0;
		if (role === void 0 || typeof m.content !== "string") continue;
		const image = imageRefOf(m.image);
		const meme = typeof m.meme === "string" && m.meme !== "" ? m.meme : void 0;
		const action = typeof m.action === "string" && m.action !== "" ? m.action : void 0;
		out.push({
			role,
			text: m.content,
			ts: typeof m.ts === "number" ? m.ts : 0,
			...image === void 0 ? {} : { image },
			...meme === void 0 ? {} : { meme },
			...action === void 0 ? {} : { action }
		});
	}
	return out;
}
function groupRounds(messages) {
	const rounds = [];
	for (const message of messages) {
		const last = rounds[rounds.length - 1];
		if (last !== void 0 && last.ts === message.ts && message.ts !== 0) {
			rounds[rounds.length - 1] = message.role === "user" ? {
				...last,
				user: message
			} : {
				...last,
				assistant: message
			};
			continue;
		}
		rounds.push(message.role === "user" ? {
			ts: message.ts,
			user: message
		} : {
			ts: message.ts,
			assistant: message
		});
	}
	return rounds;
}
const LOGO_URL = ROUTE_PATH + "/logo";
async function playAction(petId, name) {
	return postAction(ROUTE_PATH + "/anim?pet=" + encodeURIComponent(petId) + "&surface=any", { name });
}
function attachmentUrl(ref) {
	return ROUTE_PATH + "/attachment?id=" + encodeURIComponent(ref.attachmentId);
}
function memeUrl(name, assetRoot) {
	const root = assetRoot.trim();
	const prefix = root === "" ? "" : encodeURIComponent(root) + "/";
	return ROUTE_PATH + "/pic/memes/" + prefix + encodeURIComponent(name) + ".png";
}
function personaText(own, entry) {
	if (typeof own === "string" && own.trim() !== "") return own;
	return typeof entry === "string" ? entry : "";
}
async function fetchChatConfig() {
	const res = await fetch(ROUTE_PATH + "/config", { cache: "no-store" });
	if (!res.ok) throw new Error("config HTTP " + res.status);
	const body = await res.json();
	if (body.ok === false) throw new Error("config: " + String(body.reason ?? "failed"));
	const merged = body;
	const roundsByEntry = {};
	for (const [entry, conf] of Object.entries(merged)) {
		const rounds = Number(conf?.chatMemoryRounds);
		if (Number.isFinite(rounds) && rounds >= 0) roundsByEntry[entry] = Math.floor(rounds);
	}
	const pets = flattenConfigPets(merged);
	const personaByPet = {};
	for (const pet of pets) {
		const entry = merged[pet.assetRoot ?? ""]?.whisperPrompt;
		personaByPet[pet.id] = personaText(pet.whisperPrompt, entry);
	}
	return {
		pets,
		roundsByEntry,
		personaByPet
	};
}
function memoryBoundaryIndex(totalRounds, memoryRounds) {
	if (memoryRounds === void 0 || memoryRounds <= 0) return null;
	const cut = totalRounds - memoryRounds;
	return cut > 0 ? cut : null;
}
const HISTORY_ROUNDS = 200;
async function fetchHistory(petId) {
	const url = ROUTE_PATH + "/chat?pet=" + encodeURIComponent(petId) + "&rounds=" + HISTORY_ROUNDS;
	const res = await fetch(url, { cache: "no-store" });
	if (!res.ok) throw new Error("chat HTTP " + res.status);
	return toChatMessages(await res.json());
}
async function sendMessage(petId, text, attachment) {
	const url = ROUTE_PATH + "/chat?pet=" + encodeURIComponent(petId) + "&surface=any";
	const result = await sendChat(url, text, attachment);
	return result.ok ? { ok: true } : {
		ok: false,
		message: result.message ?? result.reason
	};
}
/** 把删除响应收窄成回执；`ts` 为空 = 清空整只。 */
async function deleteChat(petId, ts) {
	const query = ts.map((value) => "&ts=" + encodeURIComponent(String(value))).join("");
	const res = await fetch(ROUTE_PATH + "/chat?pet=" + encodeURIComponent(petId) + query, { method: "DELETE" });
	const body = await res.json().catch(() => null);
	if (body?.ok === true) return {
		ok: true,
		removed: Number(body.removed ?? 0)
	};
	const reason = typeof body?.message === "string" ? body.message : "HTTP " + res.status;
	return {
		ok: false,
		message: reason
	};
}
async function deleteRounds(petId, ts) {
	if (ts.length === 0) return {
		ok: true,
		removed: 0
	};
	return deleteChat(petId, ts);
}
async function clearHistory(petId) {
	return deleteChat(petId, []);
}
async function fetchOrphans() {
	const res = await fetch(ROUTE_PATH + "/chat/memory", { cache: "no-store" });
	if (!res.ok) throw new Error("chat/memory HTTP " + res.status);
	const body = await res.json();
	const raw = Array.isArray(body.orphans) ? body.orphans : [];
	const out = [];
	for (const item of raw) {
		if (!item || typeof item !== "object") continue;
		const one = item;
		if (typeof one.petId !== "string") continue;
		out.push({
			entry: typeof one.entry === "string" ? one.entry : "",
			petId: one.petId,
			messages: typeof one.messages === "number" ? one.messages : 0,
			lastTs: typeof one.lastTs === "number" ? one.lastTs : 0
		});
	}
	return out;
}
async function clearOrphans() {
	const res = await fetch(ROUTE_PATH + "/chat/memory", { method: "DELETE" });
	const body = await res.json().catch(() => null);
	if (body?.ok === true) return {
		ok: true,
		pets: Number(body.pets ?? 0),
		messages: Number(body.messages ?? 0)
	};
	return {
		ok: false,
		message: typeof body?.message === "string" ? body.message : "HTTP " + res.status
	};
}

//#endregion
//#region src/client/chat/actions.ts
function createHistoryActions(ports) {
	/** 跑一次删除：失败只报错；成功后清勾选并以服务端为准重读。 */
	const apply = async (run) => {
		try {
			const result = await run();
			if (!result.ok) {
				ports.fail(result.message);
				return;
			}
			ports.patch({
				selected: [],
				error: ""
			});
			await ports.reload(ports.read().petId);
		} catch (error) {
			ports.fail(error);
		}
	};
	return {
		deleteSelected: () => {
			const { petId, selected } = ports.read();
			if (petId === "" || selected.length === 0) return;
			apply(() => deleteRounds(petId, selected));
		},
		clearAll: () => {
			const { petId } = ports.read();
			if (petId === "") return;
			apply(() => clearHistory(petId));
		}
	};
}
function createSendActions(ports) {
	return {
		send: () => {
			const data = ports.read();
			const text = data.draft.trim();
			if (text === "" || data.busy || data.petId === "") return;
			ports.patch({
				busy: true,
				error: ""
			});
			(async () => {
				try {
					const attachment = data.attachment === void 0 ? void 0 : {
						mediaType: data.attachment.mediaType,
						data: data.attachment.base64
					};
					const result = await sendMessage(data.petId, text, attachment);
					if (!result.ok) {
						ports.fail(result.message);
						return;
					}
					ports.patch({
						draft: "",
						attachment: void 0
					});
					await ports.reload(data.petId);
				} catch (error) {
					ports.fail(error);
				} finally {
					ports.patch({ busy: false });
				}
			})();
		},
		pickFile: (file) => {
			(async () => {
				try {
					ports.patch({
						attachment: await encodeImageFile(file),
						error: ""
					});
				} catch (error) {
					ports.fail(error);
				}
			})();
		}
	};
}
function createShellActions(deps) {
	const { ports, history, listRef, pageRounds } = deps;
	/** 清掉已删宠物残留的历史。 */
	const clearOrphans$1 = () => {
		(async () => {
			try {
				const result = await clearOrphans();
				if (!result.ok) {
					ports.fail(result.message);
					return;
				}
				ports.patch({
					orphans: [],
					error: ""
				});
			} catch (error) {
				ports.fail(error);
			}
		})();
	};
	/** 确认条点「确定」后按待办类型分发；先清 pending，避免重复触发。 */
	const confirmAsk = () => {
		const kind = ports.read().pending;
		ports.patch({ pending: null });
		if (kind === "delete-selected") history.deleteSelected();
		else if (kind === "clear-all") history.clearAll();
		else if (kind === "clear-orphans") clearOrphans$1();
	};
	/** 多放一批更早的轮；按高度差补偿滚动位置，视线不跳。 */
	const showOlder = () => {
		const el = listRef.current;
		const before = el?.scrollHeight ?? 0;
		ports.patch({ visibleRounds: ports.read().visibleRounds + pageRounds });
		if (el === null) return;
		requestAnimationFrame(() => {
			el.scrollTop = el.scrollHeight - before;
		});
	};
	return {
		clearOrphans: clearOrphans$1,
		ask: (kind) => ports.patch({ pending: kind }),
		cancelAsk: () => ports.patch({ pending: null }),
		confirmAsk,
		showOlder
	};
}

//#endregion
//#region src/client/chat/metrics.ts
const SIZE = {
	pad: 12,
	padBottom: 10,
	gap: 8,
	gapTight: 6,
	gapWide: 10,
	listGap: 20,
	avatar: 28,
	imgMaxW: 220,
	imgMaxH: 180,
	preview: 48,
	hairline: 2,
	spinner: 12,
	tabPadY: 3,
	tabPadX: 12,
	toolPadY: 2,
	toolPadX: 10,
	bubblePadY: 8,
	bubblePadX: 12,
	composerPad: 10,
	composerPadBottom: 6,
	inputMinH: 44,
	inputMaxH: 140,
	send: 34,
	pillPadY: 4,
	pill: 999,
	tipPadY: 6,
	tipPadX: 10,
	tipMaxW: 260,
	personaMaxH: 200
};
const INPUT_MAX_HEIGHT = SIZE.inputMaxH;
const px = (value) => value + "px";

//#endregion
//#region src/client/chat/effects.ts
function createChatEffects(rt) {
	const { useEffect } = rt;
	return function useChatEffects(input) {
		const { data, fail, listRef, draftRef, newestTs, patch, reload } = input;
		useEffect(() => {
			(async () => {
				try {
					const [config, orphans] = await Promise.all([fetchChatConfig(), fetchOrphans().catch(() => [])]);
					const first = config.pets[0]?.id ?? "";
					patch({
						pets: config.pets,
						roundsByEntry: config.roundsByEntry,
						personas: config.personaByPet,
						petId: first,
						orphans
					});
					await reload(first);
				} catch (error) {
					fail(error);
				} finally {
					patch({ loading: false });
				}
			})();
		}, []);
		useEffect(() => {
			const el = listRef.current;
			if (el === null) return;
			const newest = data.messages[data.messages.length - 1]?.ts ?? 0;
			if (newest === newestTs.current) return;
			newestTs.current = newest;
			el.scrollTop = el.scrollHeight;
		}, [data.messages]);
		useEffect(() => {
			const el = draftRef.current;
			if (el === null) return;
			el.style.height = "auto";
			el.style.height = Math.min(el.scrollHeight, INPUT_MAX_HEIGHT) + "px";
		}, [data.draft]);
		useEffect(() => {
			const petId = data.petId;
			if (petId === "") return;
			let last = getStateSnapshot()?.pets[petId]?.say?.counter ?? 0;
			return subscribeStateSnapshot((snapshot) => {
				const counter = snapshot.pets[petId]?.say?.counter ?? 0;
				if (counter === last) return;
				last = counter;
				reload(petId);
			});
		}, [data.petId]);
	};
}

//#endregion
//#region src/client/chat/state.ts
/** 首屏与每次「加载更早」放出的轮数。 */
const PAGE_ROUNDS = 10;
/** 初始状态：空列表 + 加载中。 */
const INITIAL = {
	pets: [],
	petId: "",
	messages: [],
	draft: "",
	attachment: void 0,
	busy: false,
	loading: true,
	error: "",
	selected: [],
	selecting: false,
	orphans: [],
	pending: null,
	visibleRounds: PAGE_ROUNDS,
	previewUrl: void 0,
	roundsByEntry: {},
	personas: {},
	personaOpen: false,
	speaking: null
};
function createPetChatState(rt) {
	const { useRef, useState } = rt;
	const useChatEffects = createChatEffects(rt);
	return function usePetChatState() {
		const [data, setData] = useState(INITIAL);
		const listRef = useRef(null);
		const draftRef = useRef(null);
		/** 已贴到底的那条消息（`ts`）：只有它变化时才自动滚到底。 */
		const newestTs = useRef(0);
		const patch = (next) => setData((prev) => ({
			...prev,
			...next
		}));
		const fail = (error) => patch({ error: error instanceof Error ? error.message : String(error) });
		/** 重读某只宠物的历史；失败只落在 error 上，不静默清空已有消息。 */
		const reload = async (petId) => {
			if (petId === "") return;
			try {
				patch({ messages: await fetchHistory(petId) });
			} catch (error) {
				fail(error);
			}
		};
		useChatEffects({
			data,
			patch,
			fail,
			reload,
			listRef,
			draftRef,
			newestTs
		});
		const ports = {
			read: () => data,
			patch,
			fail,
			reload
		};
		const history = createHistoryActions(ports);
		const shell = createShellActions({
			ports,
			history,
			listRef,
			pageRounds: PAGE_ROUNDS
		});
		const pet = data.pets.find((one) => one.id === data.petId);
		const allRounds = groupRounds(data.messages);
		const rounds = allRounds.slice(-data.visibleRounds);
		return {
			...data,
			...createSendActions(ports),
			...history,
			...shell,
			rounds,
			hasOlder: allRounds.length > rounds.length,
			petName: pet?.name || "寵",
			assetRoot: pet?.assetRoot ?? "",
			memoryRounds: data.roundsByEntry[pet?.assetRoot ?? ""],
			persona: data.personas[data.petId] ?? "",
			togglePersona: () => patch({ personaOpen: !data.personaOpen }),
			closePersona: () => patch({ personaOpen: false }),
			listRef,
			draftRef,
			pickPet: (petId) => {
				patch({
					petId,
					messages: [],
					selected: [],
					selecting: false,
					pending: null,
					visibleRounds: PAGE_ROUNDS,
					error: ""
				});
				reload(petId);
			},
			toggleSelecting: () => patch({
				selecting: !data.selecting,
				selected: []
			}),
			toggleRound: (ts) => patch({ selected: data.selected.includes(ts) ? data.selected.filter((one) => one !== ts) : [...data.selected, ts] }),
			setDraft: (draft) => patch({ draft }),
			speakRound: (ts, text) => {
				speakText(text, (phase) => {
					setData((prev) => {
						if (phase === "idle") return prev.speaking?.ts === ts ? {
							...prev,
							speaking: null
						} : prev;
						return {
							...prev,
							speaking: {
								ts,
								phase
							}
						};
					});
				});
			},
			playAction: (name) => {
				if (data.petId !== "") playAction(data.petId, name);
			},
			clearAttachment: () => patch({ attachment: void 0 }),
			showImage: (previewUrl) => patch({ previewUrl }),
			closeImage: () => patch({ previewUrl: void 0 })
		};
	};
}

//#endregion
//#region src/client/chat/view-node.ts
function orphansNode(h, state) {
	if (state.orphans.length === 0) return null;
	const messages = state.orphans.reduce((sum, one) => sum + one.messages, 0);
	return h("div", {
		className: "pet-chat-orphans",
		children: [
			h("span", { children: `有 ${state.orphans.length} 只已刪除寵物的歷史（${messages} 條）` }),
			h("span", { className: "pet-chat-composer-spacer" }),
			h("button", {
				type: "button",
				className: "pet-chat-tool",
				onClick: () => state.ask("clear-orphans"),
				children: "清理"
			})
		]
	});
}
/** 卷帘块与按钮共用的 id：`aria-controls` 要指向它。 */
const PERSONA_PANEL_ID = "pet-chat-persona";
/** 「人设」按钮：点一下展开 / 收起工具栏下方那块卷帘。 */
function personaButton(h, state) {
	return h("button", {
		type: "button",
		className: "pet-chat-tool",
		"aria-expanded": String(state.personaOpen),
		"aria-controls": PERSONA_PANEL_ID,
		onClick: () => state.togglePersona(),
		children: "人設"
	});
}
function personaNode(h, state) {
	return h("div", {
		id: PERSONA_PANEL_ID,
		className: "pet-chat-persona" + (state.personaOpen ? " is-open" : ""),
		"aria-hidden": String(!state.personaOpen),
		children: [h("div", {
			className: "pet-chat-persona-clip",
			children: [h("div", {
				className: "pet-chat-persona-body",
				children: state.persona
			})]
		})]
	});
}
function toolsNode(h, state) {
	return h("div", {
		className: "pet-chat-tools",
		children: [
			personaButton(h, state),
			h("button", {
				type: "button",
				className: "pet-chat-tool",
				"aria-pressed": String(state.selecting),
				onClick: () => state.toggleSelecting(),
				children: state.selecting ? "取消選擇" : "選擇"
			}),
			state.selecting ? h("button", {
				type: "button",
				className: "pet-chat-tool",
				disabled: state.selected.length === 0,
				onClick: () => state.ask("delete-selected"),
				children: state.selected.length === 0 ? "刪除選中" : "刪除選中 " + state.selected.length
			}) : null,
			h("button", {
				type: "button",
				className: "pet-chat-tool",
				onClick: () => state.ask("clear-all"),
				children: "清空歷史"
			})
		]
	});
}
/** 待确认操作的文案：每条都说清「删什么、不可恢复」。 */
const CONFIRM_TEXT = {
	"delete-selected": "刪除選中的這几輪對話？",
	"clear-all": "清空這只寵物的全部對話歷史？",
	"clear-orphans": "清理已刪除寵物的殘留歷史？"
};
function confirmNode(rt, state) {
	if (state.pending === null) return null;
	const { h, ui } = rt;
	const count = state.pending === "delete-selected" ? `（${state.selected.length} 輪）` : state.pending === "clear-orphans" ? `（${state.orphans.length} 只）` : "";
	const description = CONFIRM_TEXT[state.pending] + count + "刪了找不回來。";
	if (ui === void 0) return h("div", {
		className: "pet-chat-confirm",
		role: "alertdialog",
		children: [
			h("span", { children: description }),
			h("span", { className: "pet-chat-composer-spacer" }),
			h("button", {
				type: "button",
				className: "pet-chat-danger",
				onClick: () => state.confirmAsk(),
				children: "刪除"
			}),
			h("button", {
				type: "button",
				className: "pet-chat-tool",
				onClick: () => state.cancelAsk(),
				children: "取消"
			})
		]
	});
	const { Button, Modal } = ui;
	return h(Modal, {
		open: true,
		title: "刪除對話歷史",
		closeLabel: "關閉",
		description,
		onClose: () => state.cancelAsk(),
		footer: h("div", {
			className: "pet-chat-confirm-actions",
			children: [h(Button, {
				variant: "ghost",
				type: "button",
				onClick: () => state.cancelAsk(),
				children: "取消"
			}), h(Button, {
				variant: "primary",
				type: "button",
				onClick: () => state.confirmAsk(),
				children: "刪除"
			})]
		})
	});
}
/** 待发送图片的预览条。 */
function previewNode$1(h, state) {
	if (state.attachment === void 0) return null;
	return h("div", {
		className: "pet-chat-preview",
		children: [
			h("img", {
				className: "pet-chat-preview-img",
				src: state.attachment.previewUrl,
				alt: "待送出的圖片"
			}),
			h("span", {
				className: "pet-chat-preview-meta",
				children: state.attachment.width + "×" + state.attachment.height
			}),
			h("button", {
				type: "button",
				className: "pet-chat-tool",
				onClick: () => state.clearAttachment(),
				children: "移除"
			})
		]
	});
}
/** 发送键里的箭头：与 DSH 输入框一致的圆形按钮造型。 */
function sendIcon(h) {
	return h("svg", {
		viewBox: "0 0 24 24",
		width: 16,
		height: 16,
		"aria-hidden": "true",
		children: [h("path", {
			d: "M12 19V6M6 12l6-6 6 6",
			fill: "none",
			stroke: "currentColor",
			strokeWidth: 2,
			strokeLinecap: "round",
			strokeLinejoin: "round"
		})]
	});
}
function composerNode(h, state) {
	return h("div", {
		className: "pet-chat-composer",
		onDragEnter: markDropTarget,
		onDragLeave: unmarkDropTarget,
		onDragOver: (event) => {
			claimFileDragOver(event);
		},
		onDrop: (event) => {
			const file = claimFileDrop(event);
			if (file !== void 0) state.pickFile(file);
			unmarkDropTarget(event);
		},
		children: [
			previewNode$1(h, state),
			h("textarea", {
				className: "pet-chat-input",
				ref: state.draftRef,
				value: state.draft,
				rows: 2,
				placeholder: "說點什麼…（Enter 送出，Shift+Enter 換行）",
				onChange: (event) => state.setDraft(event.target.value),
				onPaste: (event) => {
					const file = event.clipboardData?.files?.[0];
					if (file === void 0) return;
					event.preventDefault();
					state.pickFile(file);
				},
				onKeyDown: (event) => {
					if (event.key === "Enter" && !event.shiftKey) {
						event.preventDefault();
						state.send();
					}
				}
			}),
			h("div", {
				className: "pet-chat-composer-bar",
				children: [
					h("label", {
						className: "pet-chat-attach",
						title: "附一張圖（也可以直接貼上）",
						children: ["附圖", h("input", {
							className: "pet-chat-file",
							type: "file",
							accept: "image/png,image/jpeg,image/webp,image/gif",
							onChange: (event) => {
								const file = event.target.files?.[0];
								if (file !== void 0) state.pickFile(file);
								event.target.value = "";
							}
						})]
					}),
					h("span", { className: "pet-chat-composer-spacer" }),
					h("button", {
						type: "button",
						className: "pet-chat-send",
						"aria-label": state.busy ? "生成中" : "送出",
						onClick: () => state.send(),
						disabled: state.busy,
						children: sendIcon(h)
					})
				]
			})
		]
	});
}

//#endregion
//#region src/client/chat/stamp.ts
/**
* 消息时间戳的展示格式。
*
* 纯函数：`now` 由调用方传入，不读时钟，便于测试。今天的消息只给时间，
* 更早的补上日期——聊天记录跨天时，光看 `08:26:46` 分不清是哪天。
* @module dsh-pet/src/client/chat/stamp
*/
/** 一天的毫秒数；只用于算「差几天」，日界按本地时区取整。 */
const DAY_MS = 24 * 60 * 60 * 1e3;
/** 两位补零。 */
const pad = (value) => String(value).padStart(2, "0");
/** 时:分:秒。 */
const clockOf = (date) => pad(date.getHours()) + ":" + pad(date.getMinutes()) + ":" + pad(date.getSeconds());
/** 本地日界的时间戳（当天 00:00）。 */
const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
function formatStamp(ts, now) {
	if (!Number.isFinite(ts) || ts <= 0) return "";
	const date = new Date(ts);
	const today = new Date(now);
	const days = Math.round((startOfDay(today) - startOfDay(date)) / DAY_MS);
	const clock = clockOf(date);
	if (days <= 0) return clock;
	if (days === 1) return "昨天 " + clock;
	const monthDay = date.getMonth() + 1 + "月" + date.getDate() + "日";
	if (date.getFullYear() === today.getFullYear()) return monthDay + " " + clock;
	return date.getFullYear() + "年" + monthDay + " " + clock;
}

//#endregion
//#region src/client/chat/tooltip.ts
const TIP_CLASS = "pet-chat-tip";
/** 光标与气泡的间隙（px）：与设置页的 data-tip 气泡一致，视觉上不贴手。 */
const TIP_GAP_PX = 10;
/** 唯一的那个气泡；面板里悬停很频繁，反复建删会让气泡闪，所以复用。 */
let tipEl;
/** 全局监听的解除函数；与气泡一起登记、一起回收。 */
let unwatch;
/** 收起气泡：元素留着复用，只摘 `is-on`。 */
function hideTip() {
	tipEl?.classList.remove("is-on");
}
/** 取气泡元素，没有就建一个并挂到 body（挂 body 才不会被子孙的 overflow 裁掉）。 */
function ensureTip() {
	if (tipEl !== void 0 && tipEl.parentNode === document.body) return tipEl;
	const el = document.createElement("div");
	el.setAttribute("class", TIP_CLASS);
	el.setAttribute("role", "tooltip");
	document.body.appendChild(el);
	tipEl = el;
	const win = window;
	const root = document;
	const close = () => hideTip();
	win.addEventListener("scroll", close, true);
	root.addEventListener("pointerdown", close, true);
	unwatch = () => {
		win.removeEventListener("scroll", close, true);
		root.removeEventListener("pointerdown", close, true);
		unwatch = void 0;
	};
	return el;
}
/**
* 在光标处显示气泡。
*
* @param text - 气泡正文；每次重设，同一个气泡服务所有触发元素。
* @param cursor - 光标位置（视口坐标）。
*/
function showTip(text, cursor) {
	const el = ensureTip();
	el.textContent = text;
	el.style.left = px(0);
	el.style.top = px(0);
	const placed = tooltipPlacement(cursor, {
		w: el.offsetWidth,
		h: el.offsetHeight
	}, {
		x: 0,
		y: 0,
		w: window.innerWidth,
		h: window.innerHeight
	}, TIP_GAP_PX);
	el.style.left = px(placed.x);
	el.style.top = px(placed.y);
	el.classList.add("is-on");
}
function tipAttrs(text) {
	return {
		onMouseEnter: (event) => showTip(text, {
			x: event.clientX,
			y: event.clientY
		}),
		onMouseLeave: () => hideTip()
	};
}
function disposeTip() {
	unwatch?.();
	tipEl?.remove();
	tipEl = void 0;
}

//#endregion
//#region src/client/chat/view-message.ts
/** 语音播报按钮：贴在时间右边，四种状态一眼可分——可播 / 生成中转圈 / 播放中高亮 / 失败可重试。 */
function speakNode(h, text, ts, state) {
	const phase = state.speaking?.ts === ts ? state.speaking.phase : "idle";
	const label = phase === "loading" ? "正在生成語音…" : phase === "playing" ? "正在播放" : phase === "failed" ? "播放失敗，點擊重試" : "播放這句";
	return h("button", {
		type: "button",
		className: "pet-chat-speak is-" + phase,
		"aria-label": label,
		...tipAttrs(label),
		onClick: (event) => {
			event.stopPropagation();
			if (phase === "idle" || phase === "failed") state.speakRound(ts, text);
		},
		children: phase === "loading" ? null : phase === "failed" ? "🔇" : "🔊"
	});
}
/**
* 动作播放按钮：这一轮回答演出过动作时，贴在喇叭右边，悬浮显示动作名，点一下重演。
*
* 悬浮气泡只显示动作名本身（不加「播放動作：」这类前缀）；读屏需要的语义放在 aria-label 上。
*/
function actionNode(h, action, state) {
	return h("button", {
		type: "button",
		className: "pet-chat-action",
		"aria-label": "播放動作：" + action,
		...tipAttrs(action),
		onClick: (event) => {
			event.stopPropagation();
			state.playAction(action);
		},
		children: h("svg", {
			className: "pet-chat-action-icon",
			viewBox: "0 0 16 16",
			"aria-hidden": "true",
			children: h("path", {
				d: "M4.5 2.5v11l9-5.5z",
				fill: "currentColor"
			})
		})
	});
}
function avatarNode(h, isMe) {
	if (!isMe) return h("img", {
		className: "pet-chat-avatar",
		src: LOGO_URL,
		alt: "",
		loading: "lazy"
	});
	return h("svg", {
		className: "pet-chat-avatar",
		viewBox: "0 0 32 32",
		"aria-hidden": "true",
		children: [
			h("circle", {
				cx: 16,
				cy: 16,
				r: 16,
				fill: "var(--dsw-specific-bubble)"
			}),
			h("circle", {
				cx: 16,
				cy: 17.5,
				r: 9.5,
				fill: "var(--dsw-alias-bg-layer-1)"
			}),
			h("path", {
				d: "M6.8 15.5a9.2 9.2 0 0 1 18.4 0q-4.6-4.2-9.2-4.2t-9.2 4.2z",
				fill: "var(--dsw-alias-label-tertiary)",
				opacity: .75
			}),
			h("path", {
				d: "M16 9.2q1.1-2.6 3.4-1.7",
				fill: "none",
				stroke: "var(--dsw-alias-label-tertiary)",
				strokeWidth: 1.3,
				strokeLinecap: "round",
				opacity: .75
			}),
			h("ellipse", {
				cx: 12.4,
				cy: 17.6,
				rx: 1.5,
				ry: 2,
				fill: "var(--dsw-alias-label-primary)"
			}),
			h("ellipse", {
				cx: 19.6,
				cy: 17.6,
				rx: 1.5,
				ry: 2,
				fill: "var(--dsw-alias-label-primary)"
			}),
			h("circle", {
				cx: 12.9,
				cy: 16.8,
				r: .5,
				fill: "var(--dsw-alias-bg-layer-1)"
			}),
			h("circle", {
				cx: 20.1,
				cy: 16.8,
				r: .5,
				fill: "var(--dsw-alias-bg-layer-1)"
			}),
			h("ellipse", {
				cx: 9.6,
				cy: 21,
				rx: 1.7,
				ry: 1.1,
				fill: "var(--dsw-alias-state-error-secondary)",
				opacity: .45
			}),
			h("ellipse", {
				cx: 22.4,
				cy: 21,
				rx: 1.7,
				ry: 1.1,
				fill: "var(--dsw-alias-state-error-secondary)",
				opacity: .45
			}),
			h("path", {
				d: "M14.6 21.6q1.4 1.5 2.8 0",
				fill: "none",
				stroke: "var(--dsw-alias-label-secondary)",
				strokeWidth: 1,
				strokeLinecap: "round"
			}),
			h("path", {
				d: "M25.5 5.5v4M23.5 7.5h4",
				fill: "none",
				stroke: "var(--dsw-alias-state-business-primary)",
				strokeWidth: 1.3,
				strokeLinecap: "round",
				opacity: .9
			})
		]
	});
}
function messageNode(h, message, isMe, assetRoot, onOpenImage) {
	const image = message.image !== void 0 ? attachmentUrl(message.image) : message.meme !== void 0 ? memeUrl(message.meme, assetRoot) : void 0;
	return h("div", {
		className: "pet-chat-msg " + (isMe ? "is-me" : "is-pet"),
		children: [avatarNode(h, isMe), h("div", {
			className: "pet-chat-bubble",
			children: [h("div", {
				className: "pet-chat-text",
				children: message.text
			}), image === void 0 ? null : h("button", {
				type: "button",
				className: "pet-chat-img-btn",
				"aria-label": "點開看大圖",
				...tipAttrs("點開看大圖"),
				onClick: () => onOpenImage(image),
				children: h("img", {
					className: "pet-chat-img",
					src: image,
					alt: "對話圖片",
					loading: "lazy"
				})
			})]
		})]
	});
}
function roundNode(rt, state, round) {
	const { h } = rt;
	const selected = state.selected.includes(round.ts);
	const className = "pet-chat-round" + (state.selecting ? " is-selecting" : "") + (selected ? " is-selected" : "");
	return h("div", {
		key: String(round.ts),
		className,
		onClick: state.selecting ? (event) => {
			const target = event.target;
			if (!(target instanceof Element)) return;
			if (target.closest(".pet-chat-pick, button, a, [role=\"button\"]") !== null) return;
			state.toggleRound(round.ts);
		} : void 0,
		children: [state.selecting ? h("label", {
			className: "pet-chat-pick",
			title: "選中這一輪（問 + 答一起刪）",
			children: [h("input", {
				type: "checkbox",
				checked: selected,
				onChange: () => state.toggleRound(round.ts),
				"aria-label": "選中這一輪"
			})]
		}) : null, h("div", {
			className: "pet-chat-round-body",
			children: [
				round.user === void 0 ? null : messageNode(h, round.user, true, state.assetRoot, state.showImage),
				round.assistant === void 0 ? null : messageNode(h, round.assistant, false, state.assetRoot, state.showImage),
				round.ts > 0 ? h("div", {
					className: "pet-chat-time " + (round.assistant === void 0 ? "is-me" : "is-pet"),
					children: [
						formatStamp(round.ts, Date.now()),
						round.assistant === void 0 ? null : speakNode(h, round.assistant.text, round.ts, state),
						round.assistant?.action === void 0 ? null : actionNode(h, round.assistant.action, state)
					]
				}) : null
			]
		})]
	});
}

//#endregion
//#region src/client/chat/view.ts
/** 宠物标签条：点击切换對話。 */
function tabsNode(h, state) {
	return h("div", {
		className: "pet-chat-tabs",
		children: state.pets.map((pet) => h("button", {
			key: pet.id,
			type: "button",
			className: "pet-chat-tab",
			"aria-pressed": String(pet.id === state.petId),
			onClick: () => state.pickPet(pet.id),
			children: pet.name || pet.id
		}))
	});
}
/**
* 顶部「加载更早」：与 DSH 自己的历史加载同一个位置与形态。
*
* 内存里没有更早的轮时，同一个位置换成一行说明——不然按钮消失后用户不知道是「到底了」还是「坏了」。
*/
function olderNode(h, state) {
	if (state.rounds.length === 0) return null;
	if (state.hasOlder) return h("div", {
		className: "pet-chat-older",
		children: [h("button", {
			type: "button",
			className: "pet-chat-older-btn",
			onClick: () => state.showOlder(),
			children: "載入更早"
		})]
	});
	const capped = state.rounds.length >= HISTORY_ROUNDS;
	return h("div", {
		className: "pet-chat-older",
		children: [h("span", {
			className: "pet-chat-older-note",
			children: capped ? "已經到底了（最多載入 " + HISTORY_ROUNDS + " 輪）" : "已經到底了"
		})]
	});
}
/** 记忆边界：线以下才是桌宠每次真正带进上下文的最近 N 轮。 */
function memoryLineNode(h, rounds) {
	return h("div", {
		key: "memory-line",
		className: "pet-chat-memory",
		children: [h("span", {
			className: "pet-chat-memory-note",
			children: `以下 ${rounds} 輪進入桌寵的記憶`
		})]
	});
}
/** 消息列表：加载更早 + 记忆边界 + 空态提示或按轮渲染。 */
function listNode(rt, state) {
	const emptyText = state.loading ? "載入中…" : state.petId === "" ? "沒有可對話的桌寵" : "還沒有聊過天";
	const body = state.rounds.length === 0 ? [rt.h("div", {
		key: "empty",
		className: "pet-chat-hint",
		children: emptyText
	})] : state.rounds.map((round) => roundNode(rt, state, round));
	const cut = memoryBoundaryIndex(state.rounds.length, state.memoryRounds);
	if (cut !== null && state.memoryRounds !== void 0) body.splice(cut, 0, memoryLineNode(rt.h, state.memoryRounds));
	return rt.h("div", {
		className: "pet-chat-list",
		ref: state.listRef,
		children: [olderNode(rt.h, state), ...body]
	});
}
/**
* 图片放大：直接用平台的 `ImageLightbox`——与 DSH 会话里点开图片是同一个组件，
* 全屏遮罩、Esc / 点遮罩关闭、关闭后焦点回到原处都由它负责。
*
* @returns 没有预览或拿不到 primitives 时是 null。
*/
function previewNode(rt, state) {
	if (state.previewUrl === void 0 || rt.ui === void 0) return null;
	const { ImageLightbox } = rt.ui;
	return rt.h(ImageLightbox, {
		src: state.previewUrl,
		alt: "對話圖片",
		labels: {
			dialog: "圖片預覽",
			close: "關閉"
		},
		onClose: () => state.closeImage()
	});
}
function buildPanel(rt, state) {
	const { h } = rt;
	return h("div", {
		className: "pet-chat",
		onKeyDown: (event) => {
			if (state.personaOpen && event.key === "Escape") state.closePersona();
		},
		children: [
			tabsNode(h, state),
			orphansNode(h, state),
			toolsNode(h, state),
			personaNode(h, state),
			listNode(rt, state),
			confirmNode(rt, state),
			previewNode(rt, state),
			state.error === "" ? null : h("div", {
				className: "pet-chat-error",
				role: "alert",
				children: state.error
			}),
			composerNode(h, state)
		]
	});
}

//#endregion
//#region src/client/chat/panel.ts
function makePetChatPanel(rt) {
	const useChatState = createPetChatState(rt);
	return function PetChatPanel() {
		return buildPanel(rt, useChatState());
	};
}

//#endregion
//#region src/client/chat/panel-css.ts
const PANEL_CSS = `
.pet-chat {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  gap: ${px(SIZE.gapWide)};
  padding: ${px(SIZE.pad)} ${px(SIZE.pad)} ${px(SIZE.padBottom)};
  color: var(--dsw-alias-label-primary);
  font: var(--dsw-font-s-14);
}

.pet-chat-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: ${px(SIZE.gapTight)};
  flex: 0 0 auto;
}

.pet-chat-tab {
  border: 1px solid var(--dsw-alias-border-l2);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  border-radius: var(--dsw-radius-md);
  padding: ${px(SIZE.tabPadY)} ${px(SIZE.tabPadX)};
  font: var(--dsw-font-xxs-12);
  cursor: pointer;
  transition: background var(--ds-transition-duration-fast) var(--ds-ease-in-out),
    color var(--ds-transition-duration-fast) var(--ds-ease-in-out);
}

.pet-chat-tab:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.pet-chat-tab[aria-pressed="true"] {
  background: var(--dsw-alias-bg-multi-select);
  border-color: var(--dsw-alias-border-l3);
  color: var(--dsw-alias-label-primary);
  font-weight: 500;
}

.pet-chat-tools {
  display: flex;
  justify-content: flex-end;
  gap: ${px(SIZE.gapTight)};
  flex: 0 0 auto;
}

/* 人設卷簾：展開時把訊息列表頂下去，而不是浮在對話上——人設可以很長，浮層会擋住內容。
   0fr → 1fr 是唯一不用量高度的展開過渡；夾層負責裁剪，正文層才放內邊距與邊框，
   否則收起時 padding 與 border 仍在，留下一道縫。 */
.pet-chat-persona {
  display: grid;
  grid-template-rows: 0fr;
  flex: 0 0 auto;
  transition: grid-template-rows var(--ds-transition-duration-fast) var(--ds-ease-in-out);
}

.pet-chat-persona.is-open {
  grid-template-rows: 1fr;
}

.pet-chat-persona-clip {
  min-height: 0;
  overflow: hidden;
}

.pet-chat-persona-body {
  max-height: ${px(SIZE.personaMaxH)};
  overflow-y: auto;
  padding: ${px(SIZE.bubblePadY)} ${px(SIZE.bubblePadX)};
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-module-platform);
  color: var(--dsw-alias-label-primary);
  font: var(--dsw-font-s-14);
  line-height: 1.6;
  /* 人設正文自己帶換行與縮進：保留排版，長單詞與 URL 也要能斷開 */
  white-space: pre-wrap;
  word-break: break-word;
}

.pet-chat-orphans {
  display: flex;
  align-items: center;
  gap: ${px(SIZE.gap)};
  flex: 0 0 auto;
  padding: ${px(SIZE.gapTight)} ${px(SIZE.tabPadX)};
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-multi-select);
  color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xxs-12);
}

.pet-chat-confirm {
  display: flex;
  align-items: center;
  gap: ${px(SIZE.gap)};
  flex: 0 0 auto;
  padding: ${px(SIZE.gapTight)} ${px(SIZE.tabPadX)};
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-interactive-bg-hover-danger);
  color: var(--dsw-alias-label-primary);
  font: var(--dsw-font-xxs-12);
}

.pet-chat-danger {
  flex: 0 0 auto;
  border: none;
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-state-error-primary);
  color: var(--dsw-alias-label-primary-foreground);
  padding: ${px(SIZE.toolPadY)} ${px(SIZE.tabPadX)};
  font: var(--dsw-font-xxs-12);
  cursor: pointer;
  transition: background var(--ds-transition-duration-fast) var(--ds-ease-in-out);
}

.pet-chat-danger:hover {
  background: var(--dsw-alias-state-error-secondary);
}

.pet-chat-confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: ${px(SIZE.gap)};
}

/* 指南頁卡片圖標：框架給的槽位只按圖標尺寸排版，所以讓 logo 鋪滿它 */
.pet-chat-guide-icon {
  width: 100%;
  height: 100%;
  object-fit: contain;
  border-radius: var(--dsw-radius-xs);
  display: block;
}

.pet-chat-tool {
  border: 1px solid var(--dsw-alias-border-l2);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  border-radius: var(--dsw-radius-sm);
  padding: ${px(SIZE.toolPadY)} ${px(SIZE.toolPadX)};
  font: var(--dsw-font-xxs-12);
  cursor: pointer;
}

.pet-chat-tool:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}

.pet-chat-tool[aria-pressed="true"] {
  background: var(--dsw-alias-bg-multi-select);
  border-color: var(--dsw-alias-border-l3);
  color: var(--dsw-alias-label-primary);
}

.pet-chat-tool:disabled {
  opacity: 0.5;
  cursor: default;
}

.pet-chat-list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: ${px(SIZE.listGap)};
  padding-right: ${px(SIZE.hairline)};
}

.pet-chat-older {
  display: flex;
  justify-content: center;
  flex: 0 0 auto;
}

.pet-chat-older-btn {
  border: none;
  border-radius: ${px(SIZE.pill)};
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-secondary);
  padding: ${px(SIZE.pillPadY)} ${px(SIZE.tabPadX)};
  font: var(--dsw-font-xxs-12);
  cursor: pointer;
  transition: background var(--ds-transition-duration-fast) var(--ds-ease-in-out);
}

.pet-chat-older-btn:hover {
  background: var(--dsw-alias-interactive-bg-active);
}

.pet-chat-older-note {
  color: var(--dsw-alias-label-tertiary);
  font: var(--dsw-font-xxs-12);
  padding: ${px(SIZE.pillPadY)} 0;
}

.pet-chat-memory {
  display: flex;
  align-items: center;
  gap: ${px(SIZE.gap)};
  flex: 0 0 auto;
  color: var(--dsw-alias-label-caption);
  font: var(--dsw-font-xxxs-11);
}

/* 線本身用偽元素畫，文字居中：視覺上是「一條帶說明的分隔線」 */
.pet-chat-memory::before,
.pet-chat-memory::after {
  content: '';
  flex: 1 1 auto;
  border-top: 1px dashed var(--dsw-alias-border-l3);
}

.pet-chat-memory-note {
  flex: 0 0 auto;
}

.pet-chat-round {
  display: flex;
  align-items: flex-start;
  gap: ${px(SIZE.gap)};
}

/* 多選模式：整輪是一張可點卡片；選中給淺底，未選中透明（與豆包的選中樣式一致） */
.pet-chat-round.is-selecting {
  padding: ${px(SIZE.gapTight)} ${px(SIZE.gapWide)};
  border-radius: var(--dsw-radius-md);
  cursor: pointer;
  transition: background var(--ds-transition-duration-fast) var(--ds-ease-in-out);
}

.pet-chat-round.is-selecting:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.pet-chat-round.is-selected {
  background: var(--dsw-alias-bg-multi-select);
}

.pet-chat-pick {
  flex: 0 0 auto;
  padding-top: ${px(SIZE.gapTight)};
  opacity: 0.55;
  cursor: pointer;
}

.pet-chat-pick:hover {
  opacity: 1;
}

.pet-chat-round-body {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: ${px(SIZE.gap)};
}

.pet-chat-msg {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: ${px(SIZE.gap)};
  max-width: 92%;
}

.pet-chat-msg.is-me {
  align-self: flex-end;
  flex-direction: row-reverse;
}

.pet-chat-msg.is-pet {
  align-self: flex-start;
}

.pet-chat-avatar {
  flex: 0 0 auto;
  width: ${px(SIZE.avatar)};
  height: ${px(SIZE.avatar)};
  border-radius: 50%;
  object-fit: cover;
}

.pet-chat-msg.is-pet .pet-chat-avatar {
  border: 1px solid var(--dsw-alias-border-l2);
}

.pet-chat-bubble {
  padding: ${px(SIZE.bubblePadY)} ${px(SIZE.bubblePadX)};
  border-radius: var(--dsw-radius-md);
  word-break: break-word;
  line-height: 1.6;
}

.pet-chat-text {
  white-space: pre-wrap;
}

.pet-chat-msg.is-me .pet-chat-bubble {
  background: var(--dsw-specific-bubble);
  color: var(--dsw-alias-label-primary);
}

.pet-chat-msg.is-pet .pet-chat-bubble {
  background: var(--dsw-alias-bg-module-platform);
  color: var(--dsw-alias-label-primary);
}

.pet-chat-img-btn {
  display: block;
  margin-top: ${px(SIZE.gapTight)};
  padding: 0;
  border: none;
  background: none;
  cursor: zoom-in;
}

.pet-chat-img {
  display: block;
  max-width: ${px(SIZE.imgMaxW)};
  max-height: ${px(SIZE.imgMaxH)};
  border-radius: var(--dsw-radius-sm);
  object-fit: contain;
}

.pet-chat-time {
  display: inline-flex;
  align-items: center;
  gap: ${px(SIZE.gap)};
  margin-top: ${px(SIZE.hairline)};
  font: var(--dsw-font-xxxs-11);
  color: var(--dsw-alias-label-caption);
}

/* 時間右邊的播報 / 動作按鈕：與時間同字號，靠透明度與顏色表意，不占額外行高 */
.pet-chat-speak,
.pet-chat-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: ${px(SIZE.hairline * 12)};
  height: ${px(SIZE.hairline * 12)};
  border: 0;
  padding: 0;
  background: transparent;
  font: inherit;
  line-height: 1;
  color: inherit;
  cursor: pointer;
  opacity: 0.55;
  transition:
    opacity 0.15s,
    color 0.15s;
}

.pet-chat-speak:hover,
.pet-chat-action:hover {
  opacity: 1;
}

/* 動作鍵圖標：內聯 SVG 單色三角，顏色跟行內文字走。
   換成 emoji（▶️）会渲染成一塊彩色方塊，和喇叭放在一起就是兩种風格。 */
.pet-chat-action-icon {
  display: block;
  width: ${px(SIZE.hairline * 5)};
  height: ${px(SIZE.hairline * 5)};
}

/* 生成中：只有上半圈帶色的細環，靠旋轉表達「在生成」。
   尺寸與時間文字同高；border-box + flex:none 是必須的：預設 content-box 会把描邊算在尺寸外，
   而在 flex 行里被壓縮時環会變成橢圓，看著就是個「奇怪的圓角方塊」。 */
.pet-chat-speak.is-loading {
  opacity: 0.9;
  cursor: default;
}

.pet-chat-speak.is-loading::before {
  content: '';
  box-sizing: border-box;
  flex: none;
  width: ${px(SIZE.spinner)};
  height: ${px(SIZE.spinner)};
  border: 1.5px solid var(--dsw-alias-border-l2);
  border-top-color: var(--dsw-alias-label-secondary);
  border-radius: 50%;
  animation: pet-chat-spin 0.8s linear infinite;
}

/* 播放中：主色 + 滿不透明，和「可播放」明顯区分 */
.pet-chat-speak.is-playing {
  opacity: 1;
  color: var(--dsw-alias-state-business-primary);
  cursor: default;
}

/* 失敗：壓暗表示沒成，但仍可點（重試），所以指針保持手型 */
.pet-chat-speak.is-failed {
  opacity: 0.5;
}

@keyframes pet-chat-spin {
  to {
    transform: rotate(360deg);
  }
}

.pet-chat-time.is-pet {
  align-self: flex-start;
  /* 與寵物氣泡左沿對齊：讓時間明顯屬于這一輪的回答，而不是下一輪提問的開頭 */
  margin-left: ${px(SIZE.avatar + SIZE.gap)};
}

.pet-chat-time.is-me {
  align-self: flex-end;
}

.pet-chat-hint {
  color: var(--dsw-alias-label-tertiary);
  font: var(--dsw-font-xxs-12);
}

.pet-chat-error {
  color: var(--dsw-alias-state-error-primary);
  font: var(--dsw-font-xxs-12);
}

.pet-chat-composer {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: ${px(SIZE.gapTight)};
  padding: ${px(SIZE.composerPad)} ${px(SIZE.pad)} ${px(SIZE.composerPadBottom)};
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-xl);
  background: var(--dsw-specific-input-major);
  transition: border-color var(--ds-transition-duration-fast) var(--ds-ease-in-out);
}

.pet-chat-composer:focus-within {
  border-color: var(--dsw-alias-state-business-primary);
}

.pet-chat-composer.is-drop-target {
  border-color: var(--dsw-alias-state-business-primary);
}

.pet-chat-preview {
  display: flex;
  align-items: center;
  gap: ${px(SIZE.gap)};
}

.pet-chat-preview-img {
  width: ${px(SIZE.preview)};
  height: ${px(SIZE.preview)};
  object-fit: cover;
  border-radius: var(--dsw-radius-sm);
  border: 1px solid var(--dsw-alias-border-l2);
}

.pet-chat-preview-meta {
  font: var(--dsw-font-xxxs-11);
  color: var(--dsw-alias-label-tertiary);
}

.pet-chat-input {
  width: 100%;
  resize: none;
  border: none;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  padding: 0;
  min-height: ${px(SIZE.inputMinH)};
  max-height: ${px(SIZE.inputMaxH)};
  overflow-y: auto;
  font: var(--dsw-font-s-14);
  outline: none;
}

.pet-chat-input::placeholder {
  color: var(--dsw-alias-label-tertiary);
}

.pet-chat-composer-bar {
  display: flex;
  align-items: center;
  gap: ${px(SIZE.gap)};
}

.pet-chat-attach {
  display: inline-flex;
  align-items: center;
  gap: ${px(SIZE.hairline)};
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: ${px(SIZE.pill)};
  padding: ${px(SIZE.pillPadY)} ${px(SIZE.tabPadX)};
  font: var(--dsw-font-xxs-12);
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  user-select: none;
  transition: background var(--ds-transition-duration-fast) var(--ds-ease-in-out);
}

.pet-chat-attach:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.pet-chat-file {
  display: none;
}

.pet-chat-composer-spacer {
  flex: 1 1 auto;
}

.pet-chat-send {
  flex: 0 0 auto;
  width: ${px(SIZE.send)};
  height: ${px(SIZE.send)};
  display: grid;
  place-items: center;
  border: none;
  border-radius: 50%;
  background: var(--dsw-alias-button-info-fill);
  color: var(--dsw-alias-label-primary-foreground);
  cursor: pointer;
  transition: background var(--ds-transition-duration-fast) var(--ds-ease-in-out),
    opacity var(--ds-transition-duration-fast) var(--ds-ease-in-out);
}

.pet-chat-send:hover:not(:disabled) {
  background: var(--dsw-alias-button-info-hover);
}

.pet-chat-send:disabled {
  opacity: 0.45;
  cursor: default;
}

/* 懸浮提示氣泡：掛在 body 上按光標定位（見 ./tooltip），不在 .pet-chat 里，
   所以字體與顏色全部自帶——氣泡是深色底，兩种主題下都靠白字與背景的對比度讀。 */
.pet-chat-tip {
  position: fixed;
  z-index: 2147483000;
  max-width: ${px(SIZE.tipMaxW)};
  padding: ${px(SIZE.tipPadY)} ${px(SIZE.tipPadX)};
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-tooltip-bg);
  color: var(--dsw-static-neutral-00);
  font: var(--dsw-font-xxs-12);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
  opacity: 0;
  transition: opacity var(--ds-transition-duration-fast) var(--ds-ease-in-out);
}

.pet-chat-tip.is-on {
  opacity: 1;
}
`;

//#endregion
//#region src/client/chat/styles.ts
/** 样式标签的归属标记；同一 key 只注入一次。 */
const STYLE_KEY = "dsh-pet-chat-panel";
/** 当前挂载数：多个 pane 可能同时挂载面板，靠引用计数决定何时移除样式标签。 */
let mountedCount = 0;
/** 已注入的 style 元素（第一个挂载时创建）。 */
let styleTag;
function injectPanelCss() {
	if (typeof document === "undefined") return () => {};
	mountedCount += 1;
	if (styleTag === void 0) {
		const tag = document.createElement("style");
		tag.dataset.dshPetCss = STYLE_KEY;
		tag.textContent = PANEL_CSS;
		document.head.appendChild(tag);
		styleTag = tag;
	}
	let released = false;
	return () => {
		if (released) return;
		released = true;
		mountedCount -= 1;
		if (mountedCount === 0 && styleTag !== void 0) {
			styleTag.remove();
			styleTag = void 0;
		}
	};
}

//#endregion
//#region src/client/chat/register.ts
/** 标签实现身份；同时也是正文与标题插槽的 key。 */
const TAB_ID = "dsh-pet-chat";
/** 标签类型；`openTab` 按它打开。 */
const TAB_KIND = "pet-chat";
/** 标签头与指南页卡片的文案。 */
const TAB_TITLE = "桌寵對話";
function openPetChatTab(ctx) {
	const controller = ctx.get?.("sidebarRight");
	controller?.openTab?.(TAB_KIND);
}
function registerPetChatTab(ctx, rt, options = {}) {
	const tabs = ctx.get?.("sidebarRightTabs");
	if (tabs === void 0 || typeof tabs.register !== "function") {
		console.warn("[dsh-pet] 右側栏不可用：沒有 sidebarRightTabs 服務，桌寵對話標簽未註册");
		return () => {};
	}
	const disposeCss = injectPanelCss();
	const Panel = makePetChatPanel(rt);
	/** 指南页卡片的图标：插件 logo；框架给的位置只有 16px 左右，靠 CSS 铺满。 */
	const GuideIcon = () => rt.h("img", {
		className: "pet-chat-guide-icon",
		src: LOGO_URL,
		alt: "",
		loading: "lazy"
	});
	const commandId = options.commandId;
	const disposeType = tabs.register({
		id: TAB_ID,
		kind: TAB_KIND,
		priority: "extension",
		title: () => TAB_TITLE,
		guide: [{
			id: TAB_KIND,
			order: 400,
			title: () => TAB_TITLE,
			description: () => "與所有桌寵對話，點標簽切換",
			icon: GuideIcon,
			...commandId === void 0 ? {} : { commandId }
		}]
	});
	ctx.slots.inject("sidebar.right.pane.tab", function* () {
		yield ctx.slots.register({
			name: "sidebar.right.pane.tab",
			key: TAB_ID,
			order: 100
		}, () => rt.h(Panel, {}));
	});
	return () => {
		disposeType();
		disposeTip();
		disposeCss();
	};
}

//#endregion
//#region src/client/app.ts
function makeFactory() {
	return (require) => {
		const module = { exports: {} };
		const react = require("react");
		const { useEffect, useRef, useState, useCallback } = react;
		const { jsx: h } = require("react/jsx-runtime");
		let primitives;
		try {
			primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		} catch (error) {
			console.warn("[dsh-pet] 圖標模塊不可用：" + (error instanceof Error ? error.message : String(error)));
		}
		let renderIconSvg;
		try {
			const { createRoot } = require("react-dom/client");
			const { flushSync } = require("react-dom");
			renderIconSvg = (icon) => {
				const holder = document.createElement("div");
				const root = createRoot(holder);
				try {
					flushSync(() => root.render(h(icon, { size: 16 })));
					return holder.innerHTML;
				} finally {
					root.unmount();
				}
			};
		} catch (error) {
			console.warn("[dsh-pet] 圖標渲染器不可用（react-dom 缺失）：" + (error instanceof Error ? error.message : String(error)));
		}
		const PetMulti = makePetUI({
			h,
			useState,
			useEffect,
			useRef
		});
		const name = "pet";
		const inject = [
			"slots",
			"locale",
			"connection",
			"remote",
			"remote.commands",
			"commandUi"
		];
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, dicts), "dsh-pet: dictionaries");
			const t = ctx.locale.bind(NS);
			ctx.provide("petApi7340", {
				getState: getStateSnapshot,
				menuEvents: takeMenuEvents,
				pose: readPose,
				progress: readProgress
			});
			ctx.effect(() => initNotify({
				openSession: (sessionId) => ctx.get?.("uiWorkspace")?.openSession?.(sessionId),
				sessionTitle: (sessionId) => {
					const row = ctx.get?.("sessions")?.list?.getSnapshot?.()?.byId?.[sessionId];
					const name$1 = typeof row?.title === "string" ? row.title.trim() : "";
					return name$1 || void 0;
				}
			}), "dsh-pet: notifications");
			ctx.effect(() => {
				const commandUi = ctx.get?.("commandUi");
				if (!commandUi || typeof commandUi.decorate !== "function") {
					console.warn("[dsh-pet] 命令選擇框不可用：commandUi 服務缺失（/pet 仍可手輸 id 或名字）");
					return () => {};
				}
				return commandUi.decorate({
					name: "pet",
					available: () => true,
					ui: {
						kind: "popupSelect",
						options: async () => petBridge.current.map((p) => ({
							id: p.id,
							label: p.name || p.id,
							detail: (p.assetRoot && p.assetRoot !== p.id ? p.assetRoot + " / " : "") + p.id
						})),
						onSelect: async (option, session) => {
							await ctx.remote?.commands?.execute(session.sessionId, "/pet " + option.id, []);
						}
					}
				});
			}, "dsh-pet: /pet picker");
			ctx.effect(() => {
				const commandUi = ctx.get?.("commandUi");
				const icons = primitives;
				if (commandUi === void 0 || icons === void 0) {
					console.warn("[dsh-pet] 命令圖標不可用（命令本身仍可用，只是沒有圖標）");
					return () => {};
				}
				return installCommandFaces(commandUi, new Map([
					["chat", {
						label: () => t("cmd.chat"),
						icon: icons.IconQueueOutlineRegular
					}],
					["pet", {
						label: () => t("cmd.pet"),
						icon: icons.IconUsersOutlineRegular
					}],
					["balance", {
						label: () => t("cmd.balance"),
						icon: icons.IconGaugeOutlineRegular
					}]
				]));
			}, "dsh-pet: command faces");
			ctx.effect(() => {
				const renderIcon = renderIconSvg;
				const icon = primitives?.IconSlidersTwoOutlineMedium;
				if (renderIcon === void 0 || icon === void 0) {
					console.warn("[dsh-pet] 設定頁導覽圖示不可用（那一行仍是齒輪）");
					return () => {};
				}
				return installSectionNavIcon({
					label: () => t("nav"),
					renderSvg: () => renderIcon(icon)
				});
			}, "dsh-pet: settings nav icon");
			ctx.slots.inject("shell.overlay", function* () {
				yield ctx.slots.register({
					name: "shell.overlay",
					id: "pet",
					order: 1e3
				}, () => h(PetMulti, {}));
			});
			const PetConfigSection = makePetConfigSection({
				h,
				useState,
				useEffect,
				useRef,
				useCallback,
				t
			}, ctx);
			ctx.slots.inject("settings.section", function* () {
				yield ctx.slots.register({
					name: "settings.section",
					id: "pet-config",
					order: 30,
					label: () => t("nav"),
					inject: () => ({ t })
				}, PetConfigSection);
			});
			let sidebarChatReady = false;
			ctx.effect(() => {
				const sidebarChat = registerPetChatShortcut(ctx, () => t("shortcut.open"), () => openPetChatTab(ctx));
				sidebarChatReady = sidebarChat.registered;
				const card = registerPetCardShortcuts(ctx, (key) => t(key));
				return () => {
					sidebarChatReady = false;
					sidebarChat.dispose();
					card.dispose();
				};
			}, "dsh-pet: shortcuts");
			ctx.effect(() => {
				try {
					return registerPetChatTab(
						ctx,
						{
							h,
							useEffect,
							useRef,
							useState,
							...primitives === void 0 ? {} : { ui: {
								Modal: primitives.Modal,
								Button: primitives.Button,
								ImageLightbox: primitives.ImageLightbox
							} }
						},
						// 命令没登记成功就不带 commandId：指向不存在的命令会让侧栏注册抛错
						sidebarChatReady ? { commandId: PET_CHAT_COMMAND_ID } : {}
);
				} catch (error) {
					console.error("[dsh-pet] 右側栏對話面板註册失敗（已忽略，不影響啟動）：", error);
					return () => {};
				}
			}, "dsh-pet: sidebar chat tab");
		}
		module.exports = {
			apply,
			inject,
			name
		};
		return module.exports;
	};
}

//#endregion
//#region src/client/index.ts
window.__ModuleLoader__.load({
	id: "dsh-pet",
	factory: makeFactory()
});

//#endregion
})();