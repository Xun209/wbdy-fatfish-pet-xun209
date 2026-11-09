#!/usr/bin/env node
import { appendFileSync, chmodSync, closeSync, constants, createReadStream, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, normalize, resolve, sep } from "node:path";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { execFileSync, spawn } from "node:child_process";
import { homedir } from "node:os";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

//#region src/shared/fonts.ts
const FONT_PRESETS = [
	{
		id: "candy",
		stack: "\"ShangshouSoftCandy\",\"Yuanti SC\",\"YouYuan\",\"幼圆\",\"Comic Sans MS\",\"PingFang SC\",\"Microsoft YaHei\",sans-serif"
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
const FONT_REF_SIZE = 462;
const BUBBLE_FONT_BASE_PX = .0455 * FONT_REF_SIZE;
const TIP_FONT_BASE_PX = .026 * FONT_REF_SIZE;

//#endregion
//#region src/shared/config.ts
const PET_DISPLAYS = [
	"web",
	"desktop",
	"both",
	"none"
];

//#endregion
//#region src/host/log-file.ts
function isFileLogger(value) {
	if (!value || typeof value !== "object") return false;
	const candidate = value;
	return candidate.isFileLogger === true && typeof candidate.flush === "function" && typeof candidate.file === "string";
}
const LOG_MAX_BYTES = 1024 * 1024;
const LOG_KEEP_BYTES = 512 * 1024;
const LOG_FLUSH_MS = 1e3;
const LOG_FLUSH_LINES = 64;
const LOG_MAX_PENDING = 1e3;
function redactSensitive(text) {
	return text.replace(/(x-dsh-pet-token["'\s:=]+)[A-Za-z0-9_-]{16,}/gi, "$1***").replace(/(token["'\s:=]+)[A-Za-z0-9_-]{32,}/gi, "$1***").replace(/(#token=)[A-Za-z0-9_-]{16,}/g, "$1***").replace(/(DSH_PET_SITE_URL=)\S+/g, "$1***");
}
function tailForTrim(content, keepBytes) {
	if (content.length <= keepBytes) return content;
	return content.subarray(content.length - keepBytes);
}
function formatLogLine(level, message, now) {
	return `${now.toISOString()} [${level}] ${message}\n`;
}
function createFileLogger(options) {
	const file = options.file;
	const maxBytes = options.maxBytes ?? LOG_MAX_BYTES;
	const keepBytes = Math.max(0, Math.min(options.keepBytes ?? LOG_KEEP_BYTES, maxBytes));
	const flushMs = options.flushIntervalMs ?? LOG_FLUSH_MS;
	const threshold = Math.max(1, options.flushThreshold ?? LOG_FLUSH_LINES);
	const maxPending = Math.max(threshold, options.maxPending ?? LOG_MAX_PENDING);
	const debugEnabled = options.debugEnabled ?? false;
	const now = options.now ?? (() => new Date());
	let pending = [];
	let dropped = 0;
	/** 已离开 pending、尚未提交到文件的文本；退出与 dispose 靠它补写。 */
	let activeChunk = "";
	let flushing = null;
	let disposed = false;
	/** 目录只建一次（首次 flush 时）；失败后不再重试，日志静默降级 */
	let dirReady = null;
	const ensureDir = () => dirReady ??= mkdir(dirname(file), { recursive: true }).then(() => void 0).catch(() => void 0);
	/** 取走当前缓冲（含溢出提示）；取出后 pending 为空，文本改由调用方保管。 */
	const takePending = () => {
		const note = dropped > 0 ? formatLogLine("warn", `日志缓冲溢出，丢弃 ${dropped} 条`, now()) : "";
		const chunk = note + pending.join("");
		pending = [];
		dropped = 0;
		return chunk;
	};
	/** 同步提交 activeChunk；提交后这批文本与内存无关，退出路径不会重复写。 */
	const commit = () => {
		const chunk = activeChunk;
		activeChunk = "";
		if (!chunk) return;
		try {
			appendFileSync(file, chunk, "utf8");
		} catch {}
	};
	/** 退出与 dispose 共用的补写；首次运行目录可能还不存在，所以先同步建目录。 */
	const flushSync = () => {
		activeChunk += takePending();
		if (!activeChunk) return;
		try {
			mkdirSync(dirname(file), { recursive: true });
		} catch {}
		commit();
	};
	const push = (level, message) => {
		if (level === "debug" && !debugEnabled) return;
		try {
			options.base?.[level]?.(message);
		} catch {}
		pending.push(formatLogLine(level, redactSensitive(String(message)), now()));
		if (pending.length > maxPending) {
			dropped += pending.length - maxPending;
			pending.splice(0, pending.length - maxPending);
		}
		if (disposed) flushSync();
		else if (pending.length >= threshold) flush();
	};
	const flush = async () => {
		for (;;) {
			if (flushing) {
				await flushing;
				continue;
			}
			if (pending.length === 0) return;
			activeChunk = takePending();
			flushing = (async () => {
				await ensureDir();
				commit();
				try {
					const info = await stat(file);
					if (info.size > maxBytes) {
						const content = await readFile(file);
						if (!disposed) await writeFile(file, tailForTrim(content, keepBytes));
					}
				} catch {}
			})().finally(() => {
				flushing = null;
			});
			await flushing;
		}
	};
	const timer = setInterval(() => {
		flush();
	}, flushMs);
	timer.unref?.();
	const onExit = () => flushSync();
	process.once("exit", onExit);
	return {
		file,
		isFileLogger: true,
		info: (message) => push("info", message),
		warn: (message) => push("warn", message),
		error: (message) => push("error", message),
		debug: (message) => push("debug", message),
		flush,
		dispose() {
			if (disposed) return;
			disposed = true;
			clearInterval(timer);
			process.removeListener("exit", onExit);
			flushSync();
		}
	};
}
/**
* 模块级默认出口——给拿不到 `ctx.logger` 的纯模块用（./config、./chat、./whisper）。
*
* 这些模块是纯函数，签名里不该为一条告警塞一个 logger，但它们的 warn 同样是桌面版用户唯一能
* 看到的线索。宿主在 apply 开始时 `setDefaultLogger(log)`，之后直接 `defaultLog('warn', ...)`；
* 单测或极早期没有 logger 时退回 console，行为不变。
*/
let defaultLogger = null;
function setDefaultLogger(logger) {
	defaultLogger = logger;
}
function defaultLog(level, message) {
	const sink = defaultLogger?.[level];
	if (sink) {
		sink.call(defaultLogger, message);
		return;
	}
	if (level === "debug") {
		if (process.env.DSH_PET_LOG_DEBUG === "1") console.debug(message);
		return;
	}
	if (level === "info") console.info(message);
	else if (level === "warn") console.warn(message);
	else console.error(message);
}

//#endregion
//#region src/host/config/constants.ts
/** 位置角落白名单 */
const CORNERS = [
	"top-left",
	"top-right",
	"bottom-left",
	"bottom-right"
];
const CORNER_SET = new Set(CORNERS);
const PET_DISPLAY_SET = new Set(PET_DISPLAYS);
const FONT_FAMILY_SET = new Set(FONT_PRESETS.map((preset) => preset.id));
const ID_FORBIDDEN = /[\\/:\x00-\x1f]/;
const MAX_PET_ID_LENGTH = 64;
function isValidPetId(value) {
	if (value === "." || value === "..") return false;
	return value !== "" && value.length <= MAX_PET_ID_LENGTH && !ID_FORBIDDEN.test(value);
}
const GLOBAL_DEFAULT_KEYS = [
	"physics",
	"font",
	"confineToScreen",
	"voiceEnabled",
	"voiceName",
	"voiceVolume",
	"voiceWhisperEnabled",
	"voiceTodoEnabled",
	"whisperImageEnabled",
	"chatImageEnabled",
	"chatAnimationEnabled",
	"chatImageLimit",
	"chatMemoryRounds",
	"whisperModel",
	"chatModel",
	"eventsRefreshSec"
];
/** 已告警过的 文件:字段（进程内去重：同一问题只告警一次，避免每请求刷屏；重启重置） */
const warnedKeys = new Set();
function warnOnce(key, message) {
	if (warnedKeys.has(key)) return;
	warnedKeys.add(key);
	defaultLog("warn", "dsh-pet: " + message);
}

//#endregion
//#region src/host/config/jsonc.ts
/** 仅删除字符串之外的 JSONC 注释，保留字符串转义、换行与相邻 JSON token 的分隔。 */
function stripJsonc(src) {
	let out = "";
	let inString = false;
	for (let i = 0; i < src.length; i++) {
		const ch = src[i];
		if (inString) {
			out += ch;
			if (ch === "\\" && i + 1 < src.length) out += src[++i];
			else if (ch === "\"") inString = false;
		} else if (ch === "\"") {
			inString = true;
			out += ch;
		} else if (ch === "/" && src[i + 1] === "/") {
			out += " ";
			while (i + 1 < src.length && src[i + 1] !== "\r" && src[i + 1] !== "\n") i++;
		} else if (ch === "/" && src[i + 1] === "*") {
			const end = src.indexOf("*/", i + 2);
			if (end === -1) throw new SyntaxError("Unterminated JSONC block comment");
			out += src.slice(i, end + 2).replace(/[^\r\n]/g, " ");
			i = end + 1;
		} else out += ch;
	}
	return out.trim();
}
function readJsonc(path) {
	try {
		const raw = JSON.parse(stripJsonc(readFileSync(path, "utf8")));
		return raw && typeof raw === "object" ? raw : void 0;
	} catch {
		return void 0;
	}
}
function readUserConfig(paths) {
	const file = effectiveUserFile(paths);
	return file ? readJsonc(file) : void 0;
}
function userConfigUnparsable(paths) {
	const file = effectiveUserFile(paths);
	return file !== void 0 && readJsonc(file) === void 0;
}
function effectiveUserFile(paths) {
	if (existsSync(paths.userFile)) return paths.userFile;
	if (paths.legacyUserFile && existsSync(paths.legacyUserFile)) return paths.legacyUserFile;
	return void 0;
}

//#endregion
//#region src/shared/constants.ts
const HIT_BOX = {
	x0: 200,
	y0: 50,
	x1: 440,
	y1: 335
};
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

//#endregion
//#region src/shared/pet-size.ts
/** 人物本体宽度占画框宽度的比例；由命中框反推（240/640），不在别处再写一份 0.375。 */
const BODY_WIDTH_RATIO = (HIT_BOX.x1 - HIT_BOX.x0) / 640;
const SIZE_PERCENT_MIN = 1;
const SIZE_PERCENT_DEFAULT = 20;
function isValidSizePercent(value) {
	return typeof value === "number" && Number.isFinite(value) && value >= SIZE_PERCENT_MIN;
}

//#endregion
//#region src/host/voice/voices.ts
const VOICES = [
	{
		id: "zh-CN-XiaoxiaoNeural",
		name: "晓晓",
		tag: "女 · 通用",
		default: false
	},
	{
		id: "zh-CN-XiaoyiNeural",
		name: "晓伊",
		tag: "女 · 活泼",
		default: true
	},
	{
		id: "zh-CN-YunxiNeural",
		name: "云希",
		tag: "男 · 年轻",
		default: false
	},
	{
		id: "zh-CN-YunjianNeural",
		name: "云健",
		tag: "男 · 沉稳",
		default: false
	}
];
const DEFAULT_VOICE = "zh-CN-XiaoyiNeural";
function isKnownVoice(id) {
	return VOICES.some((voice) => voice.id === id);
}

//#endregion
//#region src/host/config/validate.ts
/** animations 段完整性校验（与旧 assertAnimationsHost 同一套规则；不 throw，非法返回 false） */
function animationsValid(a) {
	if (!a || typeof a !== "object") return false;
	const anims = a;
	for (const key of [
		"idle",
		"turn",
		"drag",
		"clicks"
	]) if (!Array.isArray(anims[key])) return false;
	const moves = anims.moves;
	if (!moves || typeof moves !== "object" || typeof moves.default !== "object" || moves.default === null || !Array.isArray(moves.actions)) return false;
	if (!Array.isArray(anims.categories)) return false;
	const ev = anims.events;
	if (!ev || typeof ev !== "object" || Array.isArray(ev)) return false;
	const evEntries = ev;
	for (const pool of Object.values(evEntries)) {
		if (!Array.isArray(pool) || pool.length === 0) return false;
		for (const slot of pool) if (typeof slot === "string") {
			if (slot.length === 0) return false;
		} else if (Array.isArray(slot)) {
			if (slot.length === 0) return false;
			for (const name of slot) if (typeof name !== "string" || name.length === 0) return false;
		} else return false;
	}
	const balance = evEntries.balance;
	if (!Array.isArray(balance) || balance.length === 0) return false;
	return anims.sleep === void 0 || sleepValid(anims.sleep);
}
/** sleep 段校验：非空套数组，每套都必须有非空的 start / loop / end 字符串数组。
*  未写由调用方放行（可选字段）；这里只处理「写了」的形态。 */
function sleepValid(value) {
	if (!Array.isArray(value) || value.length === 0) return false;
	for (const set of value) {
		if (!set || typeof set !== "object" || Array.isArray(set)) return false;
		const entry = set;
		for (const phase of [
			"start",
			"loop",
			"end"
		]) {
			const pool = entry[phase];
			if (!Array.isArray(pool) || pool.length === 0) return false;
			for (const name of pool) if (typeof name !== "string" || name.length === 0) return false;
		}
	}
	return true;
}
/** animationWeights 段校验（idle/turn/move 三个非负数字） */
function weightsValid(w) {
	if (!w || typeof w !== "object") return false;
	const weights = w;
	for (const key of [
		"idle",
		"turn",
		"move"
	]) {
		const v = Number(weights[key]);
		if (!Number.isFinite(v) || v < 0) return false;
	}
	return true;
}
function physicsValid(value) {
	if (!value || typeof value !== "object") return false;
	const p = value;
	const g = Number(p.gravity);
	const r = Number(p.restitution);
	const f = Number(p.groundFriction);
	const tp = Number(p.throwPower);
	return Number.isFinite(g) && g >= 0 && Number.isFinite(r) && r >= 0 && r <= 1 && Number.isFinite(f) && f >= 0 && typeof p.ceilingBounce === "boolean" && Number.isFinite(tp) && tp > 0 && typeof p.petCollision === "boolean" && (p.hapticEnabled === void 0 || typeof p.hapticEnabled === "boolean") && (p.tiltGravity === void 0 || typeof p.tiltGravity === "boolean") && (p.shakeThrow === void 0 || typeof p.shakeThrow === "boolean");
}
function fontValid(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const f = value;
	if (typeof f.family !== "string" || !FONT_FAMILY_SET.has(f.family)) return false;
	const size = Number(f.size);
	if (!Number.isFinite(size) || size < FONT_SIZE_MIN || size > FONT_SIZE_MAX) return false;
	return typeof f.followPet === "boolean";
}
function modelSelectionValid(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const m = value;
	if (typeof m.provider !== "string" || typeof m.model !== "string") return false;
	return m.provider.trim() === "" === (m.model.trim() === "");
}
/** workStatusTexts 段校验：二维数组——外层每项都是非空字符串数组（档位文案，每档可多句随机）；空数组不可用 */
function workStatusTextsValid(value) {
	if (!Array.isArray(value) || value.length === 0) return false;
	for (const group of value) {
		if (!Array.isArray(group) || group.length === 0) return false;
		for (const text of group) if (typeof text !== "string" || text.length === 0) return false;
	}
	return true;
}
function topFieldValid(key, value) {
	switch (key) {
		case "whisperPrompt": return typeof value === "string" && value.length > 0;
		case "chatMemoryRounds": {
			const n = Number(value);
			return Number.isFinite(n) && n >= 0;
		}
		case "chatImageLimit": {
			const n = Number(value);
			return Number.isFinite(n) && n >= 0;
		}
		case "notificationsEnabled": return typeof value === "boolean";
		case "clickSoundEnabled": return typeof value === "boolean";
		case "whisperImageEnabled": return typeof value === "boolean";
		case "voiceEnabled": return typeof value === "boolean";
		case "voiceName": return typeof value === "string" && isKnownVoice(value);
		case "voiceVolume": return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
		case "voiceWhisperEnabled": return typeof value === "boolean";
		case "voiceTodoEnabled": return typeof value === "boolean";
		case "chatImageEnabled": return typeof value === "boolean";
		case "chatAnimationEnabled": return typeof value === "boolean";
		case "confineToScreen": return typeof value === "boolean";
		case "trayEnabled": return typeof value === "boolean";
		case "animations": return animationsValid(value);
		case "animationWeights": return weightsValid(value);
		case "eventsRefreshSec": return eventsRefreshSecValid(value);
		case "physics": return physicsValid(value);
		case "font": return fontValid(value);
		case "whisperModel":
		case "chatModel": return modelSelectionValid(value);
		case "workStatusTexts": return workStatusTextsValid(value);
		case "sleepRefuseTexts":
		case "sleepStartTexts":
		case "sleepEndTexts": {
			if (!Array.isArray(value) || value.length === 0) return false;
			return value.every((text) => typeof text === "string" && text.length > 0);
		}
		default: return true;
	}
}
/**
* eventsRefreshSec 段校验：事件名 → 间隔秒（正的有限数字）。
* 这是整段替换字段：缺的键由消费端各自兜底（1800 / 300），多写的键原样保留；空对象合法。
*/
function eventsRefreshSecValid(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	for (const v of Object.values(value)) {
		const n = Number(v);
		if (!Number.isFinite(n) || n <= 0) return false;
	}
	return true;
}

//#endregion
//#region src/host/config/merge.ts
function packBase(base, mainOverlay) {
	if (!mainOverlay) return base;
	let out;
	for (const key of GLOBAL_DEFAULT_KEYS) {
		const own$1 = mainOverlay[key];
		if (own$1 === void 0 || !topFieldValid(key, own$1)) continue;
		out ??= { ...base };
		out[key] = own$1;
	}
	return out ?? base;
}
function mergeEntry(base, overlay, label, basePets, seenIds) {
	const out = {};
	for (const key of Object.keys(base)) {
		if (key === "pets") {
			out.pets = mergePets(basePets, overlay?.[key], label, seenIds);
			continue;
		}
		const own$1 = overlay ? overlay[key] : void 0;
		if (own$1 === void 0) {
			out[key] = base[key];
			continue;
		}
		if (!topFieldValid(key, own$1)) {
			warnOnce(`${label}:${key}`, `「${label}」的 ${key} 非法，已取默认值`);
			out[key] = base[key];
			continue;
		}
		out[key] = own$1;
	}
	return out;
}
/** pets 数组合并：文件没写/空 → 默认列表；逐实例合并（缺字段 → 内置默认 pets[0]，静默）。 */
function mergePets(basePets, raw, label, seenIds) {
	const basePet = basePets[0] ?? {};
	if (!Array.isArray(raw) || raw.length === 0) {
		warnOnce(`${label}:pets`, `「${label}」的 pets 缺失或为空，已取默认宠物列表`);
		return basePets;
	}
	const out = [];
	for (const item of raw) {
		const pet = mergePet(basePet, item, label, seenIds);
		if (pet) out.push(pet);
	}
	if (out.length === 0) {
		warnOnce(`${label}:pets`, `「${label}」的 pets 全部被跳过（id 非法/重复/冲突），已取默认宠物列表`);
		return basePets;
	}
	return out;
}
/** 宠物实例字段取数字；缺失 → 静默取默认（结构性常态）；显式写但非法 → 告警 + 默认 */
function petNumber(own$1, def, min, label, field, id) {
	const n = Number(own$1);
	if (own$1 !== void 0 && own$1 !== null && Number.isFinite(n) && n >= min) return n;
	if (own$1 !== void 0 && own$1 !== null) warnOnce(`${label}:${field}:${id}`, `宠物「${id}」的 ${field} 非法，已取默认值`);
	return Number(def);
}
/** 实例级 sizePercent：写了合法值才落键；缺省与越界都不落键，渲染侧按默认值处理。
*  不补默认值——补了会让「没动过」在保存时变成显式值，配置文件凭空长大，且没有用户层时形状不一致。 */
function petSizePercentField(own$1, def, label, id) {
	const value = own$1 ?? def;
	if (value === void 0 || value === null) return {};
	if (isValidSizePercent(value)) return { sizePercent: value };
	warnOnce(`${label}:sizePercent:${id}`, `宠物「${id}」的 sizePercent 非法（应为不小于 ${SIZE_PERCENT_MIN} 的数字），已忽略（按默认 ${SIZE_PERCENT_DEFAULT} 处理）`);
	return {};
}
/** 宠物实例字段取布尔；缺失 → 静默取默认；显式写但非法 → 告警 + 默认 */
function petBool(own$1, def, label, field, id) {
	if (typeof own$1 === "boolean") return own$1;
	if (own$1 !== void 0 && own$1 !== null) warnOnce(`${label}:${field}:${id}`, `宠物「${id}」的 ${field} 非法，已取默认值`);
	return Boolean(def);
}
/** 宠物实例字段取白名单枚举；缺失 → 静默取默认；显式写但非法 → 告警 + 默认 */
function petEnum(own$1, set, def, label, field, id) {
	if (typeof own$1 === "string" && set.has(own$1)) return own$1;
	if (own$1 !== void 0 && own$1 !== null) warnOnce(`${label}:${field}:${id}`, `宠物「${id}」的 ${field} 非法，已取默认值`);
	return typeof def === "string" ? def : "";
}
/** 一只实例 → 完成品实例（id 必须自己的且全局唯一；其余字段没写/非法 → 默认 + 告警） */
function mergePet(base, raw, label, seenIds) {
	const p = raw && typeof raw === "object" ? raw : {};
	const id = typeof p.id === "string" ? p.id.trim() : "";
	if (!isValidPetId(id) || seenIds.has(id)) {
		warnOnce(`${label}:id:${id || "(空)"}`, `「${label}」的宠物 id「${id || "(空)"}」非法、重复或已存在，已跳过该实例`);
		return null;
	}
	seenIds.add(id);
	const rawName = typeof p.name === "string" ? p.name.trim() : "";
	const name = rawName || id;
	if (!rawName) warnOnce(`${label}:name:${id}`, `宠物「${id}」缺少 name，已按 id 处理`);
	const basePos = base.position && typeof base.position === "object" ? base.position : {};
	const ownPos = p.position && typeof p.position === "object" ? p.position : {};
	return {
		id,
		name,
		size: petNumber(p.size, base.size, 1, label, "size", id),
		...petSizePercentField(p.sizePercent, base.sizePercent, label, id),
		balanceEnabled: petBool(p.balanceEnabled, base.balanceEnabled, label, "balanceEnabled", id),
		whisperEnabled: petBool(p.whisperEnabled, base.whisperEnabled, label, "whisperEnabled", id),
		workStatusEnabled: petBool(p.workStatusEnabled, base.workStatusEnabled, label, "workStatusEnabled", id),
		fixedEnabled: petBool(p.fixedEnabled, base.fixedEnabled, label, "fixedEnabled", id),
		display: petEnum(p.display, PET_DISPLAY_SET, base.display, label, "display", id),
		position: {
			corner: petEnum(ownPos.corner, CORNER_SET, basePos.corner, label, "position.corner", id),
			marginX: petNumber(ownPos.marginX, basePos.marginX, -Infinity, label, "position.marginX", id),
			marginY: petNumber(ownPos.marginY, basePos.marginY, -Infinity, label, "position.marginY", id)
		},
		...petPersonaField(p.whisperPrompt, label, id)
	};
}
/**
* 实例级 whisperPrompt 的合并：写了非空字符串 → 原样带出；否则返回空对象（该键不出现）。
* 显式写了非字符串（数字/对象/布尔）才算配置错误 → 告警一次并忽略（回落条目），与 petNumber 同口径。
*/
function petPersonaField(own$1, label, id) {
	if (typeof own$1 === "string") return own$1.trim() === "" ? {} : { whisperPrompt: own$1 };
	if (own$1 !== void 0 && own$1 !== null) warnOnce(`${label}:whisperPrompt:${id}`, `宠物「${id}」的 whisperPrompt 非法，已忽略（回落所属条目人设）`);
	return {};
}

//#endregion
//#region src/host/config/read.ts
function migrateUserConfig(paths, log) {
	const legacy = paths.legacyUserFile;
	if (!legacy || !existsSync(legacy) || existsSync(paths.userFile)) return false;
	try {
		renameSync(legacy, paths.userFile);
	} catch {
		return false;
	}
	log?.(`用户配置已迁移到 JSONC：${legacy} → ${paths.userFile}`);
	return true;
}
/** 扫描 pet/ 目录：<名>-config.(json|jsonc) → 条目（按文件名排序） */
function scanPetFiles(petDir) {
	let entries;
	try {
		entries = readdirSync(petDir, { withFileTypes: true });
	} catch {
		return [];
	}
	return entries.filter((e) => e.isFile()).map((e) => e.name).filter((name) => /^.+?-config\.(json|jsonc)$/.test(name)).sort().map((name) => ({
		prefix: name.replace(/-config\.(json|jsonc)$/, ""),
		path: join(petDir, name)
	}));
}
function readPetConfigEntry(paths, entry) {
	const hit = scanPetFiles(paths.petDir).find((f) => f.prefix === entry);
	return hit ? {
		path: hit.path,
		raw: readJsonc(hit.path)
	} : void 0;
}
function readAllConfig(paths) {
	const base = readJsonc(paths.defaultFile);
	if (!base) throw new Error("dsh-pet: 内置默认配置缺失或解析失败（安装损坏）：" + paths.defaultFile);
	const basePets = Array.isArray(base.pets) ? base.pets : [];
	const seenIds = new Set();
	const out = {};
	const userFile = effectiveUserFile(paths);
	const mainOverlay = userFile ? readJsonc(userFile) : void 0;
	if (userFile && !mainOverlay) warnOnce("file:" + userFile, "用户主配置解析失败，已按无用户配置处理：" + userFile);
	out.main = mergeEntry(base, mainOverlay, "main-config.jsonc", basePets, seenIds);
	const filePetBase = packBase(base, mainOverlay);
	for (const file of scanPetFiles(paths.petDir)) {
		const parsed = readJsonc(file.path);
		if (!parsed) {
			warnOnce("file:" + file.path, "文件宠物配置解析失败，已跳过：" + file.path);
			continue;
		}
		out[file.prefix] = mergeEntry(filePetBase, parsed, file.prefix + "-config.json", basePets, seenIds);
	}
	return out;
}
function flattenPetList(merged) {
	const out = [];
	for (const conf of Object.values(merged)) if (Array.isArray(conf?.pets)) out.push(...conf.pets);
	return out;
}
function findPetInstance(merged, petId) {
	for (const [entry, conf] of Object.entries(merged)) {
		const pets = Array.isArray(conf?.pets) ? conf.pets : [];
		const found = pets.find((p) => String(p.id) === petId);
		if (found) return {
			entry,
			conf,
			pet: found
		};
	}
	return void 0;
}

//#endregion
//#region src/host/config/save.ts
function saveUserConfig(raw, existing) {
	const o = raw && typeof raw === "object" ? raw : {};
	const arr = Array.isArray(o.pets) ? o.pets : null;
	if (!arr || !arr.length) return null;
	const out = [];
	const seenIds = new Set();
	for (const p of arr) {
		if (!p || typeof p !== "object") return null;
		const pp = p;
		const id = typeof pp.id === "string" ? pp.id.trim() : "";
		if (!isValidPetId(id) || seenIds.has(id)) return null;
		seenIds.add(id);
		const size = Number(pp.size);
		if (!Number.isFinite(size) || size <= 0) return null;
		const sizePercent = pp.sizePercent;
		if (sizePercent !== void 0 && sizePercent !== null && !isValidSizePercent(sizePercent)) return null;
		let name = typeof pp.name === "string" ? pp.name.trim() : "";
		if (!name) {
			defaultLog("warn", `dsh-pet: pet「${id}」缺少 name，已按默认 ${id}（宠物 id）处理`);
			name = id;
		}
		const balanceEnabled = pp.balanceEnabled;
		if (typeof balanceEnabled !== "boolean") return null;
		const whisperEnabled = pp.whisperEnabled;
		if (whisperEnabled !== void 0 && typeof whisperEnabled !== "boolean") return null;
		const workStatusEnabled = pp.workStatusEnabled;
		if (workStatusEnabled !== void 0 && typeof workStatusEnabled !== "boolean") return null;
		const fixedEnabled = pp.fixedEnabled;
		if (fixedEnabled !== void 0 && typeof fixedEnabled !== "boolean") return null;
		const display = String(pp.display ?? "");
		if (!PET_DISPLAY_SET.has(display)) return null;
		const pos = pp.position && typeof pp.position === "object" ? pp.position : {};
		const corner = String(pos.corner ?? "");
		if (!CORNER_SET.has(corner)) return null;
		const marginX = Number(pos.marginX);
		const marginY = Number(pos.marginY);
		if (!Number.isFinite(marginX) || !Number.isFinite(marginY)) return null;
		const rawPersona = pp.whisperPrompt;
		if (rawPersona !== void 0 && rawPersona !== null && typeof rawPersona !== "string") return null;
		const persona = typeof rawPersona === "string" ? rawPersona.trim() : "";
		const pet = {
			id,
			name,
			size,
			balanceEnabled,
			whisperEnabled,
			workStatusEnabled,
			fixedEnabled,
			display,
			position: {
				corner,
				marginX,
				marginY
			}
		};
		if (persona) pet.whisperPrompt = persona;
		if (sizePercent !== void 0 && sizePercent !== null) pet.sizePercent = sizePercent;
		out.push(pet);
	}
	const ne = o.notificationsEnabled;
	if (ne !== void 0 && typeof ne !== "boolean") return null;
	const cse = o.clickSoundEnabled;
	if (cse !== void 0 && typeof cse !== "boolean") return null;
	const wie = o.whisperImageEnabled;
	if (wie !== void 0 && typeof wie !== "boolean") return null;
	const cie = o.chatImageEnabled;
	if (cie !== void 0 && typeof cie !== "boolean") return null;
	const cae = o.chatAnimationEnabled;
	if (cae !== void 0 && typeof cae !== "boolean") return null;
	const cts = o.confineToScreen;
	if (cts !== void 0 && typeof cts !== "boolean") return null;
	const ve = o.voiceEnabled;
	if (ve !== void 0 && typeof ve !== "boolean") return null;
	const vn = o.voiceName;
	if (vn !== void 0 && !topFieldValid("voiceName", vn)) return null;
	const vv = o.voiceVolume;
	if (vv !== void 0 && !topFieldValid("voiceVolume", vv)) return null;
	const vwe = o.voiceWhisperEnabled;
	if (vwe !== void 0 && !topFieldValid("voiceWhisperEnabled", vwe)) return null;
	const vte = o.voiceTodoEnabled;
	if (vte !== void 0 && !topFieldValid("voiceTodoEnabled", vte)) return null;
	const te = o.trayEnabled;
	if (te !== void 0 && typeof te !== "boolean") return null;
	const ph = o.physics;
	if (ph !== void 0 && !physicsValid(ph)) return null;
	const fo = o.font;
	if (fo !== void 0 && !fontValid(fo)) return null;
	const wm = o.whisperModel;
	if (wm !== void 0 && !modelSelectionValid(wm)) return null;
	const cm = o.chatModel;
	if (cm !== void 0 && !modelSelectionValid(cm)) return null;
	const cmr = o.chatMemoryRounds;
	if (cmr !== void 0 && !topFieldValid("chatMemoryRounds", cmr)) return null;
	const cil = o.chatImageLimit;
	if (cil !== void 0 && !topFieldValid("chatImageLimit", cil)) return null;
	const cleanModel = (v) => ({
		provider: String(v.provider).trim(),
		model: String(v.model).trim()
	});
	const outConfig = { pets: out };
	if (ne !== void 0) outConfig.notificationsEnabled = ne;
	if (cse !== void 0) outConfig.clickSoundEnabled = cse;
	if (wie !== void 0) outConfig.whisperImageEnabled = wie;
	if (cie !== void 0) outConfig.chatImageEnabled = cie;
	if (cae !== void 0) outConfig.chatAnimationEnabled = cae;
	if (cts !== void 0) outConfig.confineToScreen = cts;
	if (ve !== void 0) outConfig.voiceEnabled = ve;
	if (vn !== void 0) outConfig.voiceName = vn;
	if (vv !== void 0) outConfig.voiceVolume = vv;
	if (vwe !== void 0) outConfig.voiceWhisperEnabled = vwe;
	if (vte !== void 0) outConfig.voiceTodoEnabled = vte;
	if (te !== void 0) outConfig.trayEnabled = te;
	if (ph !== void 0) outConfig.physics = ph;
	if (fo !== void 0) outConfig.font = fo;
	if (wm !== void 0) outConfig.whisperModel = cleanModel(wm);
	if (cm !== void 0) outConfig.chatModel = cleanModel(cm);
	if (cmr !== void 0) outConfig.chatMemoryRounds = Number(cmr);
	if (cil !== void 0) outConfig.chatImageLimit = Number(cil);
	const bodyOwned = new Set(["pets"]);
	if (ne !== void 0) bodyOwned.add("notificationsEnabled");
	if (cse !== void 0) bodyOwned.add("clickSoundEnabled");
	if (wie !== void 0) bodyOwned.add("whisperImageEnabled");
	if (cie !== void 0) bodyOwned.add("chatImageEnabled");
	if (cae !== void 0) bodyOwned.add("chatAnimationEnabled");
	if (cts !== void 0) bodyOwned.add("confineToScreen");
	if (ve !== void 0) bodyOwned.add("voiceEnabled");
	if (vn !== void 0) bodyOwned.add("voiceName");
	if (vv !== void 0) bodyOwned.add("voiceVolume");
	if (vwe !== void 0) bodyOwned.add("voiceWhisperEnabled");
	if (vte !== void 0) bodyOwned.add("voiceTodoEnabled");
	if (te !== void 0) bodyOwned.add("trayEnabled");
	if (ph !== void 0) bodyOwned.add("physics");
	if (fo !== void 0) bodyOwned.add("font");
	if (wm !== void 0) bodyOwned.add("whisperModel");
	if (cm !== void 0) bodyOwned.add("chatModel");
	if (cmr !== void 0) bodyOwned.add("chatMemoryRounds");
	if (cil !== void 0) bodyOwned.add("chatImageLimit");
	if (existing && typeof existing === "object") for (const key of Object.keys(existing)) {
		if (bodyOwned.has(key)) continue;
		outConfig[key] = existing[key];
	}
	return outConfig;
}
function syncUserConfigFromDefault(paths) {
	const raw = readFileSync(paths.defaultFile, "utf8");
	mkdirSync(dirname(paths.userFile), { recursive: true });
	writeFileSync(paths.userFile, raw, "utf8");
}
function sliceMemoryRounds(messages, rounds) {
	return rounds > 0 ? messages.slice(-Math.floor(rounds) * 2) : [];
}
function removeRoundsByTs(messages, ts) {
	const doomed = new Set(ts);
	const messages_ = messages.filter((m) => !doomed.has(m.ts));
	return {
		messages: messages_,
		removed: messages.length - messages_.length
	};
}

//#endregion
//#region src/host/paths.ts
const PACKAGE_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const PACKAGE_ROOT_ASSETS = join(PACKAGE_ROOT, "assets");
const PACKAGE_MEMES_DIR = join(PACKAGE_ROOT_ASSETS, "memes");

//#endregion
//#region src/host/helper/electron.ts
const require = createRequire(import.meta.url);
const packageRoot = PACKAGE_ROOT;
const defaultHelperMain = resolve(packageRoot, "runtime", "electron-helper", "main.js");
const DESKTOP_DEBUG_PORT = 0;
function helperLaunchArgs$1(helperPath, debugPort = DESKTOP_DEBUG_PORT) {
	return debugPort > 0 ? ["--remote-debugging-port=" + debugPort, helperPath] : [helperPath];
}
/** 只做基本文件校验：不验证二进制格式，也不实际启动候选。 */
function isNonEmptyFile(path) {
	try {
		const stat$1 = statSync(path);
		return stat$1.isFile() && stat$1.size > 0;
	} catch {
		return false;
	}
}
function resolveElectronPath(candidates = []) {
	const seen = new Set();
	const list = [];
	const push = (value) => {
		if (!value || seen.has(value)) return;
		seen.add(value);
		list.push(value);
	};
	for (const value of candidates) push(value);
	if (process.env.DSH_PET_ELECTRON_PATH) push(process.env.DSH_PET_ELECTRON_PATH);
	try {
		const resolved = require("electron");
		if (typeof resolved === "string" && resolved) push(resolved);
	} catch {}
	push(defaultElectronExe());
	return list.find(isNonEmptyFile);
}
function hasGraphicalDisplay() {
	if (process.platform !== "linux") return true;
	if (process.env.DSH_PET_DESKTOP_FORCE === "1") return true;
	return Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
}
function dshHomeDir() {
	const userProfile = process.env.USERPROFILE || process.env.HOME || "";
	return process.env.DSH_HOME || join(userProfile, ".dsh");
}
/** 当前平台标识（win32 / darwin / linux）。 */
const PLAT = process.platform;
/** $DSH_HOME/electron 落地目录下，可执行文件的相对路径（按平台）。 */
const ELECTRON_REL = PLAT === "win32" ? "electron.exe" : PLAT === "darwin" ? join("Electron.app", "Contents", "MacOS", "Electron") : "electron";
function electronLandingDir() {
	return join(dshHomeDir(), "electron");
}
function defaultElectronExe() {
	return join(electronLandingDir(), ELECTRON_REL);
}
function readElectronVersion(electronExe) {
	try {
		const version = readFileSync(join(dirname(electronExe), "version"), "utf8").trim();
		return /^\d+\.\d+\.\d+/.test(version) ? version : void 0;
	} catch {
		return void 0;
	}
}
async function ensureElectronDownload(options = {}) {
	const version = options.version || process.env.DSH_PET_ELECTRON_VERSION || "43.3.0";
	const mirror = options.mirror || process.env.DSH_PET_ELECTRON_MIRROR || "https://npmmirror.com/mirrors/electron/";
	const timeoutMs = options.timeoutMs ?? 10 * 60 * 1e3;
	const targetDir = electronLandingDir();
	const exe = defaultElectronExe();
	if (isNonEmptyFile(exe)) return exe;
	const sink = options.logger ?? console;
	const log = (message) => sink.info?.(`[dsh-pet] ${message}`);
	const warn = (message) => sink.warn?.(`[dsh-pet] ${message}`);
	const info = (consoleText, text, done = false) => {
		log(consoleText);
		options.onLog?.({
			text,
			level: "info",
			done
		});
	};
	const fail$1 = (consoleText, text) => {
		warn(consoleText);
		options.onLog?.({
			text,
			level: "warn",
			done: true
		});
	};
	const startedAt = Date.now();
	if (existsSync(exe)) info(`Electron cache is empty or not a regular file: ${exe}`, "Electron 缓存无效，准备重新下载");
	info(`Electron not found, downloading v${version} (${PLAT}-${process.arch}) ...`, `正在下载 Electron ${version}`);
	try {
		mkdirSync(targetDir, { recursive: true });
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(new Error(`Electron download timed out after ${timeoutMs}ms`)), timeoutMs);
		timer.unref?.();
		let nextLogAt = Date.now() + 3e3;
		try {
			const { downloadArtifact } = await import("@electron/get");
			const zipPath = await downloadArtifact({
				version: `v${version}`,
				artifactName: "electron",
				mirrorOptions: { mirror: mirror.replace(/\/$/, "") + "/" },
				downloadOptions: {
					signal: controller.signal,
					quiet: true,
					getProgressCallback: async (progress) => {
						const now = Date.now();
						if (!progress.total || now < nextLogAt) return;
						nextLogAt = now + 3e3;
						const doneMb = (progress.transferred / 1024 / 1024).toFixed(1);
						const totalMb = (progress.total / 1024 / 1024).toFixed(1);
						const percent = Math.min(100, Math.floor(progress.transferred / progress.total * 100));
						info(`downloading ${doneMb}MB / ${totalMb}MB`, `Electron 下载 ${percent}% · ${doneMb}/${totalMb}MB`);
					}
				}
			});
			const seconds = ((Date.now() - startedAt) / 1e3).toFixed(1);
			info(`download complete (${seconds}s), extracting to ${targetDir} ...`, `下载完成（${seconds}s），正在解压`);
			const { default: extract } = await import("@electron-internal/extract-zip");
			await extract(zipPath, { dir: targetDir });
			if (!isNonEmptyFile(exe)) throw new Error(`Electron zip extracted, but ${ELECTRON_REL} is missing, empty or not a regular file`);
			const readySeconds = ((Date.now() - startedAt) / 1e3).toFixed(1);
			info(`ready in ${readySeconds}s: ${exe}`, `Electron 就绪（${readySeconds}s），正在启动桌宠`, true);
			return exe;
		} finally {
			clearTimeout(timer);
		}
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		fail$1(`ensure failed: ${reason}`, `Electron 下载失败：${reason}`);
		warn("desktop pet unavailable. Set DSH_PET_ELECTRON_PATH to an existing Electron, or retry later.");
		return void 0;
	}
}
function defaultLaunch(options = {}) {
	const electronPath = resolveElectronPath([options.electronPath]);
	if (!electronPath) throw new Error("dsh-pet: cannot resolve Electron executable. Set DSH_PET_ELECTRON_PATH or install electron.");
	const helperPath = options.helperPath || defaultHelperMain;
	return {
		command: electronPath,
		args: helperLaunchArgs$1(helperPath)
	};
}

//#endregion
//#region src/host/helper/bridge.ts
const BRIDGE_PREFIX = "dsh-pet-bridge:";

//#endregion
//#region src/host/helper/restart.ts
const HELPER_STOP_TIMEOUT_MS = 3e3;
const HELPER_STOP_GRACE_MS = 1e3;
const HELPER_STABLE_MS = 3 * 60 * 1e3;
/** Electron 沙箱初始化失败时的退出码 0x80000003（STATUS_BREAKPOINT）；Node 的两种报法靠 `>>> 0` 归一。 */
const SANDBOX_INIT_FAILED_CODE = 2147483651;
/** 只有在这个时间窗内秒退、且一行输出都没有时，才把退出当成「沙箱起不来」。 */
const SANDBOX_FALLBACK_WINDOW_MS = 5e3;
function restartBackoffDelayMs(consecutiveFailures, baseMs = 750) {
	const MAX = 3e4;
	const raw = baseMs * 2 ** Math.max(0, consecutiveFailures);
	return Math.min(raw, MAX);
}
function shouldCircuitBreak(consecutiveFailures, limit = 12) {
	return consecutiveFailures >= limit;
}
function helperRunIsStable(elapsedMs) {
	return elapsedMs >= HELPER_STABLE_MS;
}
/** Windows NTSTATUS 退出码 → 中文短语；只收「进程被系统当场终止」这一类，其余不收录。 */
const WINDOWS_EXIT_MEANINGS = {
	3221225477: "访问违例",
	[SANDBOX_INIT_FAILED_CODE]: "断点（沙箱初始化失败）",
	3221225781: "缺少 DLL",
	3221225794: "DLL 初始化失败"
};
/**
* 把子进程退出码翻成一句人话。
*
* 只认 Windows 的 NTSTATUS 形态（无符号值 ≥ 0x80000000）：POSIX 退出码只有 0–255，不会撞上这张表。
* 入参同时认 Node 的两种报法——`3221225477` 与 `-1073741819` 指向同一个 `0xC0000005`。
* @param code - 子进程退出码；null 表示被信号终止。
* @returns 中文短语；未收录或 code 为 null 时返回 undefined。
*/
function explainExitCode(code) {
	if (code === null) return void 0;
	return WINDOWS_EXIT_MEANINGS[code >>> 0];
}
function describeExit(code, signal) {
	return `code=${String(code)}${describeCodeDetail(code)}, signal=${String(signal)}`;
}
/** 退出码的括号说明：形态像 NTSTATUS 才补十六进制，含义未收录时只留十六进制。 */
function describeCodeDetail(code) {
	if (code === null) return "";
	const unsigned = code >>> 0;
	if (unsigned < 2147483648) return "";
	const hex = `0x${unsigned.toString(16).toUpperCase()}`;
	const meaning = explainExitCode(code);
	return ` (${meaning ? `${hex} ${meaning}` : hex})`;
}
function crashLoopAdvice(platform) {
	const raise = "或设 DSH_PET_RESTART_MAX_FAILURES 提高重试上限后重启。";
	if (platform === "win32") return `换一个 Electron 版本（删掉日志里 electron= 指向的目录，用 DSH_PET_ELECTRON_VERSION 指定可用版本后重启），或用 DSH_PET_ELECTRON_PATH 指向本机能开窗的 electron.exe；${raise}`;
	if (platform === "linux") return `确认有可用显示环境（DISPLAY / WAYLAND_DISPLAY，无显示时用 Xvfb 并设 DSH_PET_DESKTOP_FORCE=1）；${raise}`;
	return `用 DSH_PET_ELECTRON_PATH 指向本机能开窗的 Electron；${raise}`;
}
function shouldFallbackToNoSandbox(input) {
	if (input.alreadyApplied || input.customCommand || input.sandboxOptOut) return false;
	if (input.code === null || input.code >>> 0 !== SANDBOX_INIT_FAILED_CODE) return false;
	if (input.sawOutput) return false;
	return input.ranMs < SANDBOX_FALLBACK_WINDOW_MS;
}
const RESTART_BASE_MS_DEFAULT = 750;
const RESTART_MAX_FAILURES_DEFAULT = 12;
function envPositiveInt(value, fallback) {
	const parsed = Number.parseInt(String(value ?? ""), 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
function waitForChildExit(child, timeoutMs, onTimeout) {
	if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
	return new Promise((resolve$1) => {
		let giveUpTimer;
		const done = () => {
			clearTimeout(killTimer);
			if (giveUpTimer) clearTimeout(giveUpTimer);
			child.removeListener("exit", done);
			resolve$1();
		};
		const killTimer = setTimeout(() => {
			onTimeout();
			giveUpTimer = setTimeout(done, HELPER_STOP_GRACE_MS);
			giveUpTimer.unref?.();
		}, timeoutMs);
		killTimer.unref?.();
		child.once("exit", done);
	});
}

//#endregion
//#region src/host/helper/child.ts
/** 日志里的运行时身份：` · electron=<路径> (<版本>)`；版本读不到时只留路径。 */
function electronIdentity(electronExe) {
	const version = readElectronVersion(electronExe);
	return ` · electron=${electronExe}${version ? ` (${version})` : ""}`;
}
function helperSpawnEnv(hostPid, extra) {
	const env = {
		...process.env,
		DSH_PET_HOST_PID: String(hostPid),
		...extra
	};
	delete env.ELECTRON_RUN_AS_NODE;
	return env;
}
function helperLaunchArgs(baseArgs, opts) {
	return opts.sandboxFallback && !opts.customCommand ? ["--no-sandbox", ...baseArgs] : [...baseArgs];
}
var HelperProcess = class {
	constructor(options = {}, logger = console) {
		this.options = options;
		this.logger = logger;
		this.child = void 0;
		this.stopping = false;
		this.restartTimer = void 0;
		this.restartFailures = 0;
		this.lastStartAt = 0;
		this.stdoutBuffer = "";
		this.launchIdentity = "";
		this.hasSandboxFallbackApplied = false;
		this.hasChildOutput = false;
	}
	/** 拉起子进程；已有子进程在跑或正在停止时直接返回现有句柄。 */
	start() {
		if (this.child || this.stopping) return this.child;
		this.lastStartAt = Date.now();
		const helperPath = this.options.helperPath || defaultHelperMain;
		const launch = this.options.command ? {
			command: this.options.command,
			args: this.options.args || [helperPath]
		} : defaultLaunch(this.options);
		const command = launch.command;
		const args = helperLaunchArgs(this.options.args || launch.args, {
			sandboxFallback: this.hasSandboxFallbackApplied,
			customCommand: Boolean(this.options.command)
		});
		this.hasChildOutput = false;
		this.launchIdentity = electronIdentity(command);
		const cwd = this.options.cwd || dshHomeDir();
		mkdirSync(cwd, { recursive: true });
		const child = spawn(command, args, {
			cwd,
			env: helperSpawnEnv(process.pid, this.options.env),
			stdio: [
				"pipe",
				"pipe",
				"pipe"
			],
			windowsHide: true
		});
		this.child = child;
		const stableTimer = setTimeout(() => {
			if (this.child === child && !this.stopping) this.logger.info?.(`dsh-pet desktop helper stable for ${HELPER_STABLE_MS / 6e4}m${this.launchIdentity}`);
		}, HELPER_STABLE_MS);
		stableTimer.unref?.();
		child.once("error", (error) => {
			this.logger.error?.(`dsh-pet desktop helper failed to start: ${error.message}${this.launchIdentity}`);
			if (child.pid === void 0 && this.child === child) {
				this.child = void 0;
				clearTimeout(stableTimer);
				this.scheduleRestart();
			}
		});
		child.once("exit", (code, signal) => {
			if (this.child !== child) return;
			this.child = void 0;
			clearTimeout(stableTimer);
			if (!this.stopping) {
				if (this.applySandboxFallback(code)) return;
				this.logger.warn?.(`dsh-pet desktop helper exited (${describeExit(code, signal)})${this.launchIdentity}; restarting`);
				this.scheduleRestart();
			}
		});
		child.stdout.on("data", (chunk) => {
			this.hasChildOutput = true;
			this.onStdoutChunk(String(chunk));
		});
		child.stderr.on("data", (chunk) => {
			const line = String(chunk).trim();
			if (line) {
				this.hasChildOutput = true;
				this.logger.warn?.(`[dsh-pet desktop helper] ${line}`);
			}
		});
		child.stdin?.on("error", () => {});
		return child;
	}
	/** stdout 按行缓冲：`dsh-pet-bridge:` 前缀整行 = 协议请求，其余 = 日志行。 */
	onStdoutChunk(chunk) {
		this.stdoutBuffer += chunk;
		let nl;
		while ((nl = this.stdoutBuffer.indexOf("\n")) >= 0) {
			const line = this.stdoutBuffer.slice(0, nl);
			this.stdoutBuffer = this.stdoutBuffer.slice(nl + 1);
			const trimmed = line.trim();
			if (!trimmed) continue;
			if (trimmed.startsWith(BRIDGE_PREFIX)) {
				this.handleBridgeLine(trimmed);
				continue;
			}
			this.logger.debug?.(`[dsh-pet desktop helper] ${trimmed}`);
		}
	}
	/** 处理一条协议请求：交给宿主 bridgeHandler，结果按 id POST 回 main.js 的回调服务器
	*  （cb 由请求行携带；不走 stdin —— Electron 主进程收不到 piped stdin） */
	async handleBridgeLine(line) {
		const child = this.child;
		if (!child?.stdin || !this.options.bridgeHandler) return;
		let req;
		try {
			req = JSON.parse(line.slice(BRIDGE_PREFIX.length));
		} catch {
			this.logger.warn?.("[dsh-pet desktop helper] bridge 协议行非法，已忽略");
			return;
		}
		if (typeof req.id !== "number") return;
		try {
			const resp = await this.options.bridgeHandler(req);
			this.sendBridgeResponse(req, resp);
		} catch (e) {
			this.sendBridgeResponse(req, {
				id: req.id,
				status: 500,
				contentType: "application/json; charset=utf-8",
				body: JSON.stringify({ error: `bridge handler error: ${e instanceof Error ? e.message : String(e)}` })
			});
		}
	}
	/** 把应答发回 main.js：优先 POST 到请求行携带的 cb（本地回调服务器）；无 cb 时回写 stdin（低版本兼容）。 */
	sendBridgeResponse(req, resp) {
		const cb = typeof req.cb === "string" && /^https?:[/][/]/.test(req.cb) ? req.cb : "";
		if (cb) {
			fetch(cb, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(resp)
			}).catch(() => {});
			return;
		}
		const child = this.child;
		if (!child?.stdin || child.stdin.destroyed) return;
		try {
			child.stdin.write(BRIDGE_PREFIX + JSON.stringify(resp) + "\n");
		} catch {}
	}
	/** 停止 helper：发 SIGTERM 即返回，不等它退出。宿主退出 / 插件卸载路径用它——宿主马上就没了
	*  （Windows 有 job 对象、POSIX 有 helper 自己的 host-liveness 兜底）。
	*  停止后要立刻重启的场景必须用 stopAndWait()，否则新旧进程会短暂重叠。 */
	stop(reason = "plugin-disposed") {
		this.stopping = true;
		if (this.restartTimer) clearTimeout(this.restartTimer);
		this.restartTimer = void 0;
		this.logger.debug?.(`dsh-pet desktop helper stopping (${reason})`);
		const child = this.child;
		if (!child) return;
		child.kill();
	}
	/**
	* 停止 helper 并等它真正退出：只发一次 SIGTERM 就 spawn 新进程是不行的——Electron 收到 SIGTERM 后
	* 关窗、销毁 GPU/动画合成器是异步的（几百 ms 起），旧窗口（旧大小）还没消失、新窗口已经画出来，
	* 桌面上会短暂出现「两只宠物」。所以：① 先置 `stopping`（由 stop() 完成），守护逻辑不得把这次主动
	* 停止误判成崩溃去自动重启；② 只等 `exit` 不等 `close`——stdio 管道关闭远早于进程真正退出；③ 超时
	* （默认 3s）升级 SIGKILL，再给 1s 宽限，仍未退出就放弃等待，配置保存绝不能被无限挂住。
	*/
	async stopAndWait(reason = "plugin-disposed", timeoutMs = HELPER_STOP_TIMEOUT_MS) {
		this.stop(reason);
		const child = this.child;
		if (!child) return;
		await waitForChildExit(child, timeoutMs, () => {
			this.logger.warn?.(`dsh-pet desktop helper 未在 ${timeoutMs}ms 内退出，升级 SIGKILL（${reason}）`);
			try {
				child.kill("SIGKILL");
			} catch {}
		});
	}
	/** 沙箱初始化失败的特殊崩溃 → 改用 `--no-sandbox` 立刻重试一次，不计入退避与熔断额度。 */
	applySandboxFallback(code) {
		const applied = shouldFallbackToNoSandbox({
			code,
			sawOutput: this.hasChildOutput,
			ranMs: Date.now() - this.lastStartAt,
			alreadyApplied: this.hasSandboxFallbackApplied,
			customCommand: Boolean(this.options.command),
			sandboxOptOut: process.env.DSH_PET_GPU_SANDBOX === "1"
		});
		if (!applied) return false;
		this.hasSandboxFallbackApplied = true;
		this.logger.warn?.(`dsh-pet desktop helper 因 Chromium 沙箱初始化失败而秒退（${describeExit(code, null)}），改用 --no-sandbox 重试一次${this.launchIdentity}`);
		this.start();
		return true;
	}
	scheduleRestart() {
		if (this.restartTimer || this.stopping) return;
		if (helperRunIsStable(Date.now() - this.lastStartAt)) this.restartFailures = 0;
		else this.restartFailures += 1;
		if (shouldCircuitBreak(this.restartFailures, this.resolveMaxFailures())) {
			this.logger.error?.(`dsh-pet desktop helper crashed ${this.restartFailures} consecutive times; circuit breaker tripped, no more restarts${this.launchIdentity} · 建议：${crashLoopAdvice(process.platform)}`);
			return;
		}
		const base = this.resolveRestartBaseMs();
		const delay = restartBackoffDelayMs(this.restartFailures - 1, base);
		this.logger.warn?.(`dsh-pet desktop helper exited; restarting in ${Math.round(delay)}ms (attempt ${this.restartFailures}, consecutive-crash limit ${this.resolveMaxFailures()})`);
		this.restartTimer = setTimeout(() => {
			this.restartTimer = void 0;
			this.start();
		}, delay);
		this.restartTimer.unref?.();
	}
	/** 退避基值：DSH_PET_RESTART_BASE_MS（ms，>0）可调，默认 750。 */
	resolveRestartBaseMs() {
		return envPositiveInt(process.env.DSH_PET_RESTART_BASE_MS, RESTART_BASE_MS_DEFAULT);
	}
	/** 熔断阈值：DSH_PET_RESTART_MAX_FAILURES（次，>0）可调，默认 12。 */
	resolveMaxFailures() {
		return envPositiveInt(process.env.DSH_PET_RESTART_MAX_FAILURES, RESTART_MAX_FAILURES_DEFAULT);
	}
};

//#endregion
//#region src/host/balance/internal.ts
/**
* 余额取数的内部工具（host 半侧）：网络策略、响应校验与金额处理。
*
* 只给 ./providers/* 使用，不含服务商知识，也不负责注册与路由。
* 统一 20s 超时加 3 次重试：目标端点多为境外，实测会间歇性超时。
* 依赖全局 fetch；始终成立：必填字段缺失或非法一律抛错，绝不静默当 0。
*
* @module dsh-pet/src/host/balance/internal
*/
/** 单次抓取超时（ms）。 */
const FETCH_TIMEOUT_MS = 2e4;
/** 单次抓取失败后的重试次数（间隔 0.8s）。 */
const RETRIES = 3;
/** 发起一次带超时的 fetch；失败抛错，是否重试由调用方决定。 */
async function fetchOnce(url, key) {
	return fetch(url, {
		headers: {
			Authorization: "Bearer " + key,
			"User-Agent": "dsh-pet-balance"
		},
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
	});
}
async function fetchWithRetry(url, key) {
	let last;
	for (let i = 0; i <= RETRIES; i++) try {
		return await fetchOnce(url, key);
	} catch (e) {
		last = e;
		if (i < RETRIES) await new Promise((r) => setTimeout(r, 800));
	}
	throw last instanceof Error ? last : new Error(String(last));
}
function num(value, what) {
	const n = Number(value);
	if (!Number.isFinite(n)) throw new Error("dsh-pet: 余额数据非法字段 " + what);
	return n;
}
function str$1(value, what) {
	if (typeof value !== "string" || value.length === 0) throw new Error("dsh-pet: 余额数据非法字段 " + what);
	return value;
}
function looseNum(value) {
	if (value === void 0 || value === null || value === "") return void 0;
	const n = Number(value);
	return Number.isFinite(n) ? n : void 0;
}
function obj(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? value : void 0;
}
/**
* 归一重置时间：字符串原样返回，数字时间戳自动识别秒/毫秒。
* 0、负数与非法值返回 undefined —— 报文里空闲窗口的 resetAt: 0 是占位，不是 1970 年。
*/
function resetTime(value) {
	if (typeof value === "string") return value.length > 0 ? value : void 0;
	const n = looseNum(value);
	if (n === void 0 || n <= 0) return void 0;
	const ms = n < 1e12 ? n * 1e3 : n;
	const d = new Date(ms);
	return Number.isNaN(d.getTime()) ? void 0 : d.toISOString();
}
function readWindow(value) {
	const w = obj(value);
	if (!w) return void 0;
	const used = looseNum(w.used);
	const cap = looseNum(w.cap);
	if (used === void 0 || cap === void 0 || cap <= 0) return void 0;
	return {
		percent: Math.max(0, used / cap * 100),
		capUsd: cap,
		resetsAt: resetTime(w.resetAt)
	};
}
function queryString(params) {
	const pairs = Object.entries(params).filter(([, v]) => v !== void 0);
	return pairs.length > 0 ? "?" + pairs.map(([k, v]) => k + "=" + encodeURIComponent(v)).join("&") : "";
}
function money(value, what) {
	const raw = str$1(value, what);
	const n = Number(raw);
	if (!Number.isFinite(n)) throw new Error("dsh-pet: 账号余额金额非法 " + what);
	return n.toFixed(2);
}
function sumMoney(a, b) {
	return ((Math.round(Number(a) * 100) + Math.round(Number(b) * 100)) / 100).toFixed(2);
}

//#endregion
//#region src/host/balance/providers/commandcode.ts
/** 控制面基址（/alpha/* 固定在根域名）。 */
const API_BASE = "https://api.commandcode.ai";
/** 滚动窗的展示名：本服务商的 5h 窗口即 windowLimits.fiveHour。 */
const ROLLING_LABEL$1 = "5h";
/** 抓一次 JSON，HTTP 非 2xx 抛错；label 是接口路径，只用于错误信息。 */
async function fetchJson(url, key, label) {
	const res = await fetchWithRetry(url, key);
	if (!res.ok) throw new Error("commandcode " + label + " HTTP " + res.status);
	return await res.json();
}
/**
* 从 usage 响应读区间用量（本期累计）；五个字段齐全才返回，缺一个即视为没有这项数据。
*
* 这些字段来自批量聚合（窗口百分比才是实时的），所以宁可整页不出，也不拿半份数字拼一张会漂的卡片。
*/
function readUsage(summary) {
	const totalTokens = looseNum(summary?.totalTokens);
	const inputTokens = looseNum(summary?.totalTokensIn);
	const outputTokens = looseNum(summary?.totalTokensOut);
	const requests = looseNum(summary?.totalCount);
	const spentUsd = looseNum(summary?.totalCost);
	if (totalTokens === void 0 || inputTokens === void 0 || outputTokens === void 0 || requests === void 0 || spentUsd === void 0) return void 0;
	return {
		totalTokens,
		inputTokens,
		outputTokens,
		requests,
		spentUsd
	};
}
function parseCommandCode(creditsBody, subscriptionBody, summaryBody, provider) {
	const root = obj(creditsBody);
	const credits = obj(root?.credits);
	if (!credits) throw new Error("dsh-pet: commandcode 响应缺少 credits");
	const creditFields = [
		credits.monthlyCredits,
		credits.purchasedCredits,
		credits.freeCredits
	];
	if (creditFields.every((v) => looseNum(v) === void 0)) throw new Error("dsh-pet: commandcode credits 响应缺少额度字段");
	const remaining = creditFields.reduce((sum, v) => sum + Math.max(0, looseNum(v) ?? 0), 0);
	const summary = obj(summaryBody);
	const spentRaw = summary?.totalCost;
	if (spentRaw === void 0 || spentRaw === null) throw new Error("dsh-pet: commandcode usage 响应缺少 totalCost");
	const spent = Math.max(0, num(spentRaw, "totalCost"));
	const pool = spent + remaining;
	const data = { monthly: pool > 0 ? spent / pool * 100 : 0 };
	if (pool > 0) data.monthlyCapUsd = pool;
	const usage = readUsage(summary);
	if (usage) data.usage = usage;
	const subscription = obj(obj(subscriptionBody)?.data);
	const periodEnd = subscription?.currentPeriodEnd;
	if (typeof periodEnd === "string" && periodEnd.length > 0) data.monthlyResetsAt = periodEnd;
	const limits = obj(root?.windowLimits) ?? obj(credits.windowLimits);
	if (limits?.limited === true) {
		const fiveHour = readWindow(limits.fiveHour);
		if (fiveHour) {
			data.rolling = fiveHour.percent;
			data.rollingCapUsd = fiveHour.capUsd;
			data.rollingLabel = ROLLING_LABEL$1;
			if (fiveHour.resetsAt) data.rollingResetsAt = fiveHour.resetsAt;
		}
		const weekly = readWindow(limits.weekly);
		if (weekly) {
			data.weekly = weekly.percent;
			data.weeklyCapUsd = weekly.capUsd;
			if (weekly.resetsAt) data.weeklyResetsAt = weekly.resetsAt;
		}
	}
	return {
		ok: true,
		provider,
		shape: "windows",
		data
	};
}
const commandCode = {
	id: "commandcode",
	credential: {
		mode: "ref",
		ref: "COMMANDCODE_API_KEY"
	},
	async fetch({ key, provider }) {
		const whoami = obj(await fetchJson(API_BASE + "/alpha/whoami" + queryString({ limits: "1" }), key, "/alpha/whoami"));
		const org = obj(whoami?.org);
		const orgId = typeof org?.id === "string" && org.id.length > 0 ? org.id : void 0;
		const credits = await fetchJson(API_BASE + "/alpha/billing/credits" + queryString({ orgId }), key, "/alpha/billing/credits");
		let subscription;
		try {
			subscription = await fetchJson(API_BASE + "/alpha/billing/subscriptions" + queryString({ orgId }), key, "/alpha/billing/subscriptions");
		} catch {
			subscription = void 0;
		}
		const summary = await fetchJson(API_BASE + "/alpha/usage/summary" + queryString({ orgId }), key, "/alpha/usage/summary");
		return parseCommandCode(credits, subscription, summary, provider);
	}
};

//#endregion
//#region src/host/balance/deepseek-common.ts
const DEEPSEEK_FULL_BALANCE = {
	CNY: "20",
	USD: "5"
};
function deepseekFullBalance(currency) {
	return DEEPSEEK_FULL_BALANCE[currency];
}
function deepseekPricingTier(now = new Date()) {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone: "Asia/Shanghai",
		weekday: "short",
		hour: "2-digit",
		hourCycle: "h23"
	}).formatToParts(now);
	const pick = (type) => parts.find((p) => p.type === type)?.value;
	const weekday = pick("weekday");
	const hour = Number(pick("hour"));
	if (weekday === "Sat" || weekday === "Sun") return "idle";
	return hour >= 9 && hour < 12 || hour >= 14 && hour < 18 ? "peak" : "idle";
}

//#endregion
//#region src/host/balance/providers/deepseek-account.ts
function parseAccountBalance(snapshot, provider) {
	if (!snapshot) throw new Error("dsh-pet: 账号未登录（deepseek-account）");
	if (snapshot.status !== "ready") throw new Error("dsh-pet: 账号余额查询失败");
	const wallets = Array.isArray(snapshot.value) ? snapshot.value : [];
	if (wallets.length === 0) throw new Error("dsh-pet: 账号没有充值钱包余额");
	const candidates = wallets.map((w) => obj(w)).filter((w) => w !== void 0);
	if (candidates.length === 0) throw new Error("dsh-pet: 账号钱包结构非法");
	const toppedUpBy = new Map();
	for (const w of candidates) {
		const currency = typeof w.currency === "string" && w.currency.length > 0 ? w.currency : "CNY";
		const amount = money(w.balance, "balance");
		const prev = toppedUpBy.get(currency);
		toppedUpBy.set(currency, prev === void 0 ? amount : sumMoney(prev, amount));
	}
	const grantedBy = new Map();
	for (const raw of Array.isArray(snapshot.bonusWallets) ? snapshot.bonusWallets : []) {
		const w = obj(raw);
		if (!w || typeof w.currency !== "string" || w.currency.length === 0) continue;
		const amount = money(w.balance, "bonus balance");
		const prev = grantedBy.get(w.currency);
		grantedBy.set(w.currency, prev === void 0 ? amount : sumMoney(prev, amount));
	}
	for (const currency of grantedBy.keys()) if (!toppedUpBy.has(currency)) toppedUpBy.set(currency, "0.00");
	const walletsOut = [...toppedUpBy.entries()].map(([currency, toppedUp]) => {
		const granted = grantedBy.get(currency) ?? "0.00";
		const fullBalance = deepseekFullBalance(currency);
		return {
			currency,
			total: sumMoney(granted, toppedUp),
			granted,
			toppedUp,
			...fullBalance === void 0 ? {} : { fullBalance }
		};
	});
	return {
		ok: true,
		provider,
		shape: "money",
		data: {
			wallets: walletsOut,
			tier: deepseekPricingTier()
		}
	};
}
const deepseekAccount = {
	id: "deepseek-account",
	credential: { mode: "none" },
	async fetch({ provider, resolveAccount }) {
		if (!resolveAccount) throw new Error("dsh-pet: 缺少账号服务（" + provider + "）");
		return parseAccountBalance(await resolveAccount(), provider);
	}
};

//#endregion
//#region src/host/balance/providers/deepseek-official.ts
const deepseekOfficial = {
	id: "deepseek-official",
	credential: {
		mode: "ref",
		ref: "DEEPSEEK_API_KEY"
	},
	async fetch({ key, provider }) {
		const res = await fetchWithRetry("https://api.deepseek.com/user/balance", key);
		if (!res.ok) throw new Error("deepseek balance HTTP " + res.status);
		const body = await res.json();
		const infos = body?.balance_infos;
		if (!Array.isArray(infos) || infos.length === 0) throw new Error("dsh-pet: deepseek balance 响应缺少 balance_infos");
		const wallets = infos.map((raw) => {
			const w = obj(raw) ?? {};
			const currency = str$1(w.currency, "currency");
			const fullBalance = deepseekFullBalance(currency);
			return {
				currency,
				total: str$1(w.total_balance, "total_balance"),
				granted: str$1(w.granted_balance, "granted_balance"),
				toppedUp: str$1(w.topped_up_balance, "topped_up_balance"),
				...fullBalance === void 0 ? {} : { fullBalance }
			};
		});
		return {
			ok: true,
			provider,
			shape: "money",
			data: {
				wallets,
				tier: deepseekPricingTier()
			}
		};
	}
};

//#endregion
//#region src/host/balance/providers/opencode-go.ts
/** 各窗口满额度（USD）：滚动 12、周 30、月 60；接口不回传，属业务常量。 */
const QUOTA_USD = {
	rolling: 12,
	weekly: 30,
	monthly: 60
};
/** 滚动窗的展示名：本服务商是 5 小时。 */
const ROLLING_LABEL = "5h";
const opencodeGo = {
	id: "opencode-go",
	credential: {
		mode: "ref",
		ref: "OPENCODE_GO_API_KEY"
	},
	async fetch({ key, provider }) {
		const res = await fetchWithRetry("https://opencode.ai/zen/go/v1/usage", key);
		if (!res.ok) throw new Error("opencode usage HTTP " + res.status);
		const body = await res.json();
		const usage = body?.usage;
		if (!usage || typeof usage !== "object") throw new Error("dsh-pet: opencode usage 响应缺少 usage");
		const u = usage;
		const rolling = u.rolling, weekly = u.weekly, monthly = u.monthly;
		if (!rolling || !weekly || !monthly) throw new Error("dsh-pet: opencode usage 响应缺少窗口");
		return {
			ok: true,
			provider,
			shape: "windows",
			data: {
				rolling: num(rolling.percent, "rolling.percent"),
				weekly: num(weekly.percent, "weekly.percent"),
				monthly: num(monthly.percent, "monthly.percent"),
				rollingCapUsd: QUOTA_USD.rolling,
				weeklyCapUsd: QUOTA_USD.weekly,
				monthlyCapUsd: QUOTA_USD.monthly,
				rollingLabel: ROLLING_LABEL,
				rollingResetsAt: str$1(rolling.resetsAt, "rolling.resetsAt"),
				weeklyResetsAt: str$1(weekly.resetsAt, "weekly.resetsAt"),
				monthlyResetsAt: str$1(monthly.resetsAt, "monthly.resetsAt")
			}
		};
	}
};

//#endregion
//#region src/host/balance/registry.ts
const BUILTIN_PROVIDERS = [
	opencodeGo,
	commandCode,
	deepseekOfficial,
	deepseekAccount
];
/** 第三方运行时登记表：provider id → 定义。 */
const external = new Map();
function registerBalanceProvider(def) {
	if (!def || typeof def !== "object") throw new TypeError("provider 定义必须是对象");
	if (typeof def.id !== "string" || def.id.length === 0) throw new TypeError("id 必须是非空字符串");
	if (typeof def.fetch !== "function") throw new TypeError("fetch 必须是函数");
	if (BUILTIN_PROVIDERS.some((p) => p.id === def.id)) throw new Error("不能覆盖内置服务商: " + def.id);
	if (external.has(def.id)) throw new Error("该服务商 id 已被注册: " + def.id);
	external.set(def.id, def);
	return () => {
		if (external.get(def.id) === def) external.delete(def.id);
	};
}
function listBalanceProviders() {
	return {
		builtin: BUILTIN_PROVIDERS.map((p) => p.id),
		external: [...external.keys()]
	};
}
function matchBalanceProvider(provider) {
	return BUILTIN_PROVIDERS.find((p) => p.id === provider) ?? external.get(provider);
}

//#endregion
//#region src/host/balance/index.ts
/** 第三方取数等待上限（ms）；内置 HTTP 服务商走各自的超时与重试。 */
const PLUGIN_FETCH_TIMEOUT_MS = 2e4;
/**
* 构造失败结果：三种 reason 走同一个出口，避免各处手写字段。
* `message` 缺省时不写这个键——叶子形状是对外契约，多一个 undefined 键会破坏严格比对。
*/
function failed(provider, reason, message) {
	return message === void 0 ? {
		ok: false,
		provider,
		reason
	} : {
		ok: false,
		provider,
		reason,
		message
	};
}
/** 把取数异常归一成 fetch-error（内置与第三方同一口径）。 */
function fetchFailed(provider, e) {
	return failed(provider, "fetch-error", e instanceof Error ? e.message : String(e));
}
async function queryBalance(provider, resolveKey, resolveAccount) {
	const def = matchBalanceProvider(provider);
	if (!def) return failed(provider, "unsupported");
	if (!("credential" in def)) {
		let timer;
		try {
			const timeout = new Promise((_, reject) => {
				timer = setTimeout(() => reject(new Error("余额查询超时（20 秒），请稍后重试")), PLUGIN_FETCH_TIMEOUT_MS);
				timer.unref();
			});
			return await Promise.race([def.fetch({ provider }), timeout]);
		} catch (e) {
			return fetchFailed(provider, e);
		} finally {
			if (timer !== void 0) clearTimeout(timer);
		}
	}
	let key = "";
	if (def.credential.mode === "ref") {
		const resolved = await resolveKey(def.credential.ref);
		if (!resolved) return failed(provider, "credential-missing", "缺少凭证 " + def.credential.ref);
		key = resolved;
	} else if (!resolveAccount) return failed(provider, "credential-missing", "缺少账号服务（" + provider + "）");
	try {
		return await def.fetch({
			provider,
			key,
			resolveAccount
		});
	} catch (e) {
		return fetchFailed(provider, e);
	}
}

//#endregion
//#region src/host/voice/registry.ts
const BUILTIN_VOICE_ID = "edge";
/** 当前生效的第三方实现；`null` = 没注册，合成走内置实现。 */
let current$1 = null;
function registerVoiceProvider(def) {
	if (!def || typeof def !== "object") throw new TypeError("voice provider 定义必须是对象");
	if (typeof def.id !== "string" || def.id.length === 0) throw new TypeError("id 必须是非空字符串");
	if (def.id === BUILTIN_VOICE_ID) throw new TypeError("不能与内置实现同名: " + BUILTIN_VOICE_ID);
	if (typeof def.synthesize !== "function") throw new TypeError("synthesize 必须是函数");
	current$1 = def;
	return () => {
		if (current$1 === def) current$1 = null;
	};
}
function activeVoiceProvider() {
	return current$1;
}
function listVoiceProviders() {
	return {
		builtin: [BUILTIN_VOICE_ID],
		external: current$1 ? [current$1.id] : []
	};
}

//#endregion
//#region src/host/voice/speech-registry.ts
const BUILTIN_SPEECH_ID = "dsh";
/** 当前生效的第三方实现；`null` = 没注册，识别走宿主自带能力。 */
let current = null;
function registerSpeechProvider(def) {
	if (!def || typeof def !== "object") throw new TypeError("speech provider 定义必须是对象");
	if (typeof def.id !== "string" || def.id.length === 0) throw new TypeError("id 必须是非空字符串");
	if (def.id === BUILTIN_SPEECH_ID) throw new TypeError("不能与内置来源同名: " + BUILTIN_SPEECH_ID);
	if (typeof def.transcribe !== "function") throw new TypeError("transcribe 必须是函数");
	current = def;
	return () => {
		if (current === def) current = null;
	};
}
function activeSpeechProvider() {
	return current;
}
function listSpeechProviders() {
	return {
		builtin: [BUILTIN_SPEECH_ID],
		external: current ? [current.id] : []
	};
}

//#endregion
//#region src/host/menu.ts
/**
* 第三方右键菜单注册表（进程内存态，DSH 重启即清空，不落盘）。
*
* 注册方用自己的 owner 注册菜单项，再用同一个 owner 查「我这一项被点了没有、在哪只宠物上点的」；
* 不负责菜单渲染与点击命中（两端按 target 过滤后自己拼「更多」）。必须始终成立：注册是 owner 级的
* 整体覆盖，菜单项生命周期与插件一致；点击是闩锁不是队列（连点两次只看到一次）；查询即清空（读取
* 即消费，没确认也没重投）；一个 owner 只该有一个消费者，两个进程同时查会互抢。
* 限额见下方常量；契约见 API.md 与 openapi.yaml。
* @module dsh-pet/src/host/menu
*/
/** owner 长度上限。 */
const OWNER_MAX = 64;
/** 单个菜单项 label 长度上限（面板宽 150–240px，再长会被省略号截断）。 */
const LABEL_MAX = 32;
/** 每 owner 菜单项上限。 */
const ITEMS_MAX = 20;
/** 全局 owner 上限。 */
const OWNERS_MAX = 32;
const MENU_WAIT_MAX_MS = 1e4;
/** 控制字符（换行、制表等会把菜单布局搞炸，一律拒绝）。 */
const CONTROL_CHARS = /[\x00-\x1f\x7f]/;
/** 合法的 target 取值。 */
const MENU_TARGETS = new Set([
	"web",
	"desktop",
	"both"
]);
/** 缺省 target = 两端都显示（= 加这个字段之前的行为）。 */
const DEFAULT_TARGET = "both";
/** 校验一个显示用字符串：必须是 string、trim 后非空、不超长、无控制字符。 */
function displayText(value, max) {
	if (typeof value !== "string") return null;
	const text = value.trim();
	if (text === "" || text.length > max || CONTROL_CHARS.test(text)) return null;
	return text;
}
var MenuRegistry = class {
	constructor() {
		this.owners = new Map();
		this.waiters = new Map();
	}
	/**
	* 注册（整体覆盖）：`{ owner, labels: string[], target?: 'web' | 'desktop' | 'both' }`。
	*
	* 覆盖粒度是整个 owner：注册方每次用一份完整列表描述「我现在有什么」，不必关心上次注册了什么，
	* 也不会留下已下线的僵尸项。`target` 选填、缺省 `both`（老调用方零改动），与 labels 一起被覆盖。
	*/
	register(raw) {
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {
			ok: false,
			reason: "bad-request",
			message: "body 必须是 { owner, labels, target? }"
		};
		const body = raw;
		const owner = displayText(body.owner, OWNER_MAX);
		if (owner === null) return {
			ok: false,
			reason: "invalid-owner",
			message: `owner 必须是 1–${OWNER_MAX} 字符的字符串（禁控制字符）`
		};
		const rawLabels = body.labels;
		if (!Array.isArray(rawLabels) || rawLabels.length === 0) return {
			ok: false,
			reason: "invalid-labels",
			message: "labels 必须是非空数组"
		};
		if (rawLabels.length > ITEMS_MAX) return {
			ok: false,
			reason: "too-many-items",
			message: `每个 owner 最多 ${ITEMS_MAX} 项`
		};
		const labels = [];
		for (const rawLabel of rawLabels) {
			const label = displayText(rawLabel, LABEL_MAX);
			if (label === null) return {
				ok: false,
				reason: "invalid-label",
				message: `每个 label 必须是 1–${LABEL_MAX} 字符的字符串（禁控制字符）`
			};
			if (!labels.includes(label)) labels.push(label);
		}
		if (!this.owners.has(owner) && this.owners.size >= OWNERS_MAX) return {
			ok: false,
			reason: "too-many-owners",
			message: `最多 ${OWNERS_MAX} 个 owner`
		};
		const rawTarget = body.target;
		let target = DEFAULT_TARGET;
		if (rawTarget !== void 0 && rawTarget !== null) {
			if (typeof rawTarget !== "string" || !MENU_TARGETS.has(rawTarget)) return {
				ok: false,
				reason: "invalid-target",
				message: "target 只能是 web / desktop / both（不写 = both）"
			};
			target = rawTarget;
		}
		this.owners.set(owner, {
			target,
			items: new Map(labels.map((label) => [label, null]))
		});
		return { ok: true };
	}
	/**
	* 清掉一个 owner 的全部菜单项（连它上面未取走的触发标记一起丢）。
	*
	* 幂等：owner 本来就不存在 → `removed: 0`，仍算成功，调用方重试注销时不该看到错误。
	* 挂在该 owner 上的长轮询会被叫醒，醒来后查不到 owner → 路由回 `unknown-owner`。
	*/
	clear(rawOwner) {
		const owner = displayText(rawOwner, OWNER_MAX);
		if (owner === null) return {
			ok: false,
			reason: "invalid-owner",
			message: `owner 必须是 1–${OWNER_MAX} 字符的字符串（禁控制字符）`
		};
		const entry = this.owners.get(owner);
		if (!entry) return {
			ok: true,
			removed: 0
		};
		const removed = entry.items.size;
		this.owners.delete(owner);
		const waiters = this.waiters.get(owner);
		this.waiters.delete(owner);
		if (waiters) for (const wake of [...waiters]) wake();
		return {
			ok: true,
			removed
		};
	}
	/** 全量快照（写进 state；顺序 = 注册顺序 + 列表顺序，两端渲染顺序与它一致）。 */
	snapshot() {
		const out = [];
		for (const [owner, entry] of this.owners) for (const label of entry.items.keys()) out.push({
			owner,
			label,
			target: entry.target
		});
		return out;
	}
	/**
	* 渲染端上报一次点击：把该项标成「被 petId 点了」，并叫醒该 owner 上挂着的长轮询。
	*
	* `delivered = false`（项不存在：菜单刚好被覆盖、还没注册）不算错误——渲染端拿的是上一拍
	* /state 快照，这一拍菜单已经变了，属于正常竞态，路由仍回 200。
	*/
	click(raw) {
		const body = raw && typeof raw === "object" ? raw : {};
		const owner = typeof body.owner === "string" ? body.owner : "";
		const label = typeof body.label === "string" ? body.label : "";
		const pet = typeof body.pet === "string" ? body.pet.trim() : "";
		const entry = this.owners.get(owner);
		if (!entry || !entry.items.has(label) || pet === "") return {
			ok: true,
			delivered: false
		};
		entry.items.set(label, pet);
		const waiters = this.waiters.get(owner);
		if (waiters) for (const wake of [...waiters]) wake();
		return {
			ok: true,
			delivered: true
		};
	}
	/**
	* 查询触发：返回 `{ label: petId | null }` 全量映射，返回即清空这些标记。
	*
	* `waitMs > 0` 且当下没有任何触发 → 挂起等待（被点、超时、被覆盖都会唤醒），超时后照常返回
	* 全 null 的映射。owner 不存在 → null（路由回 404，调用方据此知道要重新注册）。
	*/
	async poll(owner, waitMs) {
		const entry = this.owners.get(owner);
		if (!entry) return null;
		if (waitMs > 0 && !hasFired(entry.items)) await new Promise((resolve$1) => {
			const set = this.waiters.get(owner) ?? new Set();
			this.waiters.set(owner, set);
			const hold = {};
			let settled = false;
			const finish = () => {
				if (settled) return;
				settled = true;
				if (hold.timer !== void 0) clearTimeout(hold.timer);
				set.delete(finish);
				if (set.size === 0 && this.waiters.get(owner) === set) this.waiters.delete(owner);
				resolve$1();
			};
			hold.timer = setTimeout(finish, Math.min(waitMs, MENU_WAIT_MAX_MS));
			set.add(finish);
		});
		const current$2 = this.owners.get(owner);
		if (!current$2) return null;
		const out = {};
		for (const [label, pet] of current$2.items) {
			out[label] = pet;
			current$2.items.set(label, null);
		}
		return out;
	}
};
/** 该 owner 当前有没有任意一项被点过。 */
function hasFired(items) {
	for (const pet of items.values()) if (pet !== null) return true;
	return false;
}

//#endregion
//#region src/shared/playback.ts
const TERMINAL_STATUSES = [
	"ended",
	"failed",
	"cancelled"
];
const REPORTABLE_STATUSES = [
	"playing",
	"ended",
	"failed",
	"cancelled"
];

//#endregion
//#region src/host/playback/status.ts
const PLAYBACK_KEEP_MS = 60 * 1e3;
const MAX_PLAYBACK_WAIT_MS = 10 * 1e3;
/** 终态判定用集合。 */
const TERMINAL = new Set(TERMINAL_STATUSES);
/** 可上报判定用集合。 */
const REPORTABLE = new Set(REPORTABLE_STATUSES);
const isTerminalStatus = (s) => TERMINAL.has(s);
const isPlaybackStatus = (s) => s === "accepted" || REPORTABLE.has(s);
const isReportableStatus = (s) => REPORTABLE.has(s);

//#endregion
//#region src/host/playback/parse.ts
function parsePlaybackPath(rest) {
	const m = /^playback\/([^/]+)(\/report)?$/.exec(rest);
	if (!m) return void 0;
	return {
		playbackId: m[1] ?? "",
		isReport: m[2] === "/report"
	};
}
function parseWaitQuery(waitRaw, timeoutRaw) {
	if (waitRaw === null && timeoutRaw === null) return { kind: "none" };
	if (waitRaw === null || timeoutRaw === null) return {
		kind: "error",
		error: "wait and timeout must be used together"
	};
	const wait = waitRaw.split(",").map((s) => s.trim()).filter((s) => s !== "");
	const bad = wait.find((s) => !isPlaybackStatus(s));
	if (wait.length === 0 || bad !== void 0) return {
		kind: "error",
		error: `invalid wait status: ${bad ?? waitRaw}`
	};
	if (!/^\d+$/.test(timeoutRaw)) return {
		kind: "error",
		error: `invalid timeout (expect 0..${MAX_PLAYBACK_WAIT_MS})`
	};
	const timeoutMs = Number(timeoutRaw);
	if (!Number.isFinite(timeoutMs) || timeoutMs > MAX_PLAYBACK_WAIT_MS) return {
		kind: "error",
		error: `invalid timeout (expect 0..${MAX_PLAYBACK_WAIT_MS})`
	};
	return {
		kind: "ok",
		wait,
		timeoutMs
	};
}

//#endregion
//#region src/host/playback/store.ts
var PlaybackStore = class {
	constructor() {
		this.records = new Map();
		this.waiters = new Map();
		this.activeByPet = new Map();
		this.seq = 0;
	}
	/**
	* 受理一次点播：建记录（accepted），并把该宠物上一场（若仍在非终态）标为 cancelled/superseded。
	* @returns 新建的记录（调用方取 playbackId 下发给调用方）。
	*/
	create(petId, name) {
		this.sweep();
		const prev = this.activeByPet.get(petId);
		if (prev !== void 0) this.finish(prev, "cancelled", "superseded");
		const now = Date.now();
		const record = {
			playbackId: "pb-" + now.toString(36) + "-" + (++this.seq).toString(36),
			petId,
			name,
			status: "accepted",
			createdAt: now,
			updatedAt: now
		};
		this.records.set(record.playbackId, record);
		this.activeByPet.set(petId, record.playbackId);
		return record;
	}
	/** 查记录；不存在 / 已过期返回 undefined（路由回 404）。 */
	get(playbackId) {
		this.sweep();
		return this.records.get(playbackId);
	}
	/**
	* 渲染端上报一次状态。
	*
	* 终态之后的上报一律 ignored（迟到的 ended 不许覆盖 cancelled），与当前状态相同的上报同样
	* ignored；两种情况路由都回 200——对上报方来说「已经这样了」就是成功。
	*/
	report(playbackId, status, reason) {
		this.sweep();
		const record = this.records.get(playbackId);
		if (!record) return "unknown";
		const next = typeof status === "string" ? status : "";
		if (!isReportableStatus(next)) return "invalid";
		if (isTerminalStatus(record.status) || record.status === next) return "ignored";
		const why = typeof reason === "string" && reason !== "" ? reason : void 0;
		this.finish(playbackId, next, why);
		return "ok";
	}
	/**
	* 挂起一个等待者。
	* @returns 取消函数；编号不存在时返回 undefined（路由据此立刻回 404，不挂）。
	*/
	wait(args) {
		this.sweep();
		const record = this.records.get(args.playbackId);
		if (!record) return void 0;
		const waiter = {
			wait: new Set(args.wait),
			onWake: args.onWake,
			record,
			timer: void 0
		};
		let set = this.waiters.get(args.playbackId);
		if (!set) {
			set = new Set();
			this.waiters.set(args.playbackId, set);
		}
		set.add(waiter);
		waiter.timer = setTimeout(() => {
			this.dropWaiter(args.playbackId, waiter);
			waiter.onWake(waiter.record, false);
		}, Math.max(0, args.timeoutMs));
		waiter.timer.unref?.();
		return () => this.dropWaiter(args.playbackId, waiter);
	}
	/** 结束所有挂起的等待（插件卸载 / 宿主退出路径）；唤醒时 matched=false，调用方据此立刻收尾。 */
	cancelAll() {
		for (const [playbackId, set] of [...this.waiters]) for (const waiter of [...set]) {
			this.dropWaiter(playbackId, waiter);
			waiter.onWake(waiter.record, false);
		}
	}
	/**
	* 清理过期终态记录（惰性调用：create / get / report 各调一次，记录数很少，成本可忽略）。
	*
	* 必须先把还在等它的人叫醒：等待上限（10s）通常远小于保留时长（60s），但调用方完全可以在
	* 一条终态记录的保留窗口末尾注册一个等「别的状态」的等待者——不唤醒就成了永远等不到的悬挂等待者。
	*
	* @param now - 注入时间（单测用；缺省取当前时刻）。
	*/
	sweep(now = Date.now()) {
		for (const [playbackId, record] of this.records) {
			if (!isTerminalStatus(record.status)) continue;
			if (now - record.updatedAt < PLAYBACK_KEEP_MS) continue;
			const set = this.waiters.get(playbackId);
			if (set) for (const waiter of [...set]) {
				this.dropWaiter(playbackId, waiter);
				waiter.onWake(waiter.record, false);
			}
			this.records.delete(playbackId);
		}
	}
	/** 当前记录数（测试 / 观测用）。 */
	count() {
		return this.records.size;
	}
	/** 当前等待者数（测试 / 观测用：验证不泄漏）。 */
	waiterCount() {
		let n = 0;
		for (const set of this.waiters.values()) n += set.size;
		return n;
	}
	/**
	* 落到一个终态：写状态、更新时间、摘掉「当前活跃」、唤醒在等这个状态的人。
	* 这是唯一的状态写入点，所以等待者唤醒只在这里发生（不需要 diff、不需要比对）。
	*/
	finish(playbackId, status, reason) {
		const record = this.records.get(playbackId);
		if (!record) return;
		record.status = status;
		record.updatedAt = Date.now();
		if (status === "ended") record.endedAt = record.updatedAt;
		if (reason !== void 0) record.reason = reason;
		if (this.activeByPet.get(record.petId) === playbackId) this.activeByPet.delete(record.petId);
		const set = this.waiters.get(playbackId);
		if (!set) return;
		for (const waiter of [...set]) {
			if (!waiter.wait.has(status)) continue;
			this.dropWaiter(playbackId, waiter);
			waiter.onWake(waiter.record, true);
		}
	}
	/** 摘掉一个等待者（清定时器 + 从集合移除 + 空集合回收）。 */
	dropWaiter(playbackId, waiter) {
		if (waiter.timer !== void 0) {
			clearTimeout(waiter.timer);
			waiter.timer = void 0;
		}
		const set = this.waiters.get(playbackId);
		if (!set) return;
		set.delete(waiter);
		if (set.size === 0) this.waiters.delete(playbackId);
	}
};

//#endregion
//#region src/host/http.ts
const MIME = {
	".webm": "video/webm",
	".mov": "video/quicktime",
	".mp4": "video/mp4",
	".png": "image/png",
	".wav": "audio/wav",
	".json": "application/json; charset=utf-8",
	".jsonc": "application/json; charset=utf-8",
	".ttf": "font/ttf",
	".woff": "font/woff",
	".woff2": "font/woff2"
};
function resolveAsset(root, rel) {
	if (rel.length === 0) return void 0;
	const candidate = normalize(join(root, rel));
	const rootWithSep = root.endsWith(sep) ? root : root + sep;
	if (candidate !== root && !candidate.startsWith(rootWithSep)) return void 0;
	return candidate;
}
function resolveExisting(root, rel) {
	const candidate = resolveAsset(root, rel);
	return candidate && existsSync(candidate) ? candidate : void 0;
}
function parseRange(header, totalBytes) {
	if (!header || totalBytes <= 0) return null;
	const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
	if (!match) return null;
	const startText = match[1] ?? "";
	const endText = match[2] ?? "";
	if (startText === "" && endText === "") return null;
	if (startText === "") {
		const suffixLength = Number(endText);
		if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;
		return {
			start: Math.max(0, totalBytes - suffixLength),
			end: totalBytes - 1
		};
	}
	const start = Number(startText);
	const end = endText === "" ? totalBytes - 1 : Number(endText);
	if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
	if (start > end || start >= totalBytes) return "unsatisfiable";
	return {
		start,
		end: Math.min(end, totalBytes - 1)
	};
}
function sendFile(req, res, file, contentType) {
	const stream = createReadStream(file);
	stream.once("open", (fd) => {
		if (res.destroyed || res.writableEnded) {
			stream.destroy();
			return;
		}
		let totalBytes;
		try {
			totalBytes = fstatSync(fd).size;
		} catch {
			res.writeHead(200, {
				"content-type": contentType,
				"cache-control": "public, max-age=3600"
			});
			stream.pipe(res);
			return;
		}
		const decision = parseRange(req.headers.range, totalBytes);
		if (decision === "unsatisfiable") {
			stream.destroy();
			res.writeHead(416, {
				"content-type": contentType,
				"content-range": `bytes */${totalBytes}`,
				"accept-ranges": "bytes",
				"cache-control": "public, max-age=3600"
			});
			res.end();
			return;
		}
		if (decision !== null) {
			stream.destroy();
			const ranged = createReadStream(file, {
				start: decision.start,
				end: decision.end
			});
			res.writeHead(206, {
				"content-type": contentType,
				"content-length": decision.end - decision.start + 1,
				"content-range": `bytes ${decision.start}-${decision.end}/${totalBytes}`,
				"accept-ranges": "bytes",
				"cache-control": "public, max-age=3600"
			});
			ranged.pipe(res);
			ranged.on("error", () => res.destroy());
			res.on("close", () => ranged.destroy());
			return;
		}
		res.writeHead(200, {
			"content-type": contentType,
			"content-length": totalBytes,
			"accept-ranges": "bytes",
			"cache-control": "public, max-age=3600"
		});
		stream.pipe(res);
	});
	stream.on("error", () => res.destroy());
	res.on("close", () => stream.destroy());
}
function sendJson$1(res, status, obj$1, headers = {}) {
	const body = JSON.stringify(obj$1);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"content-length": Buffer.byteLength(body),
		...headers
	});
	res.end(body);
}
function sendText(res, status, body) {
	res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
	res.end(body);
}
const MAX_BODY_BYTES = 1024 * 1024;
function readBody(req) {
	return new Promise((resolve2, reject) => {
		const chunks = [];
		let size = 0;
		let settled = false;
		/**
		* 落地一次：'close' 在正常应答后也会触发，靠标志位拒绝二次落地。
		* 不摘监听——请求对象随连接回收，摘监听反而要求调用方提供完整的 on/off 对（测试桩通常只有 on）。
		*/
		const settle = (finish) => {
			if (settled) return;
			settled = true;
			finish();
		};
		const onData = (chunk) => {
			size += chunk.length;
			if (size > MAX_BODY_BYTES) {
				settle(() => reject(Object.assign(new Error("request body too large"), { code: "body-too-large" })));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		};
		const onEnd = () => settle(() => resolve2(Buffer.concat(chunks).toString("utf8")));
		const onError = (error) => settle(() => reject(error));
		const onAborted = () => settle(() => reject(Object.assign(new Error("client aborted"), { code: "client-aborted" })));
		req.on("data", onData);
		req.on("end", onEnd);
		req.on("error", onError);
		req.on("close", onAborted);
		req.on("aborted", onAborted);
	});
}

//#endregion
//#region src/host/state.ts
const MAX_STATE_WAIT_MS = 10 * 1e3;
function parseStateWaitQuery(sinceRaw, timeoutRaw) {
	if (sinceRaw === null && timeoutRaw === null) return { kind: "none" };
	if (sinceRaw === null || timeoutRaw === null) return {
		kind: "error",
		error: "since and timeout must be used together"
	};
	if (!/^\d+$/.test(sinceRaw)) return {
		kind: "error",
		error: "invalid since (expect a non-negative integer)"
	};
	if (!/^\d+$/.test(timeoutRaw)) return {
		kind: "error",
		error: `invalid timeout (expect 0..${MAX_STATE_WAIT_MS})`
	};
	const since = Number(sinceRaw);
	const timeoutMs = Number(timeoutRaw);
	if (!Number.isFinite(since)) return {
		kind: "error",
		error: "invalid since (expect a non-negative integer)"
	};
	if (!Number.isFinite(timeoutMs) || timeoutMs > MAX_STATE_WAIT_MS) return {
		kind: "error",
		error: `invalid timeout (expect 0..${MAX_STATE_WAIT_MS})`
	};
	return {
		kind: "ok",
		since,
		timeoutMs
	};
}
/** 空叶子：counter=0 表示从未写过——前端首拉把它当基线，之后 counter 变化才渲染。 */
const emptyLeaf = () => ({
	counter: 0,
	data: null
});
var PollStateStore = class {
	constructor() {
		this.last = 0;
		this.sections = {
			balance: emptyLeaf(),
			workStatus: emptyLeaf(),
			notify: emptyLeaf(),
			config: emptyLeaf(),
			menu: emptyLeaf()
		};
		this.pets = new Map();
		this.waiters = new Set();
	}
	/** 下一个 counter。 */
	next() {
		this.last = Math.max(Date.now(), this.last + 1);
		return this.last;
	}
	/**
	* 写一个全局叶子（余额 / 工作状态 / 通知 / 配置变更信号）。
	* 整体替换叶子对象而不是原地改字段：`read()` 拿到的引用因此不会半新半旧。
	*/
	writeSection(name, data) {
		this.sections[name] = {
			counter: this.next(),
			data
		};
		this.wakeWaiters();
	}
	/** 写一只宠物的叶子（宠物条目不存在则自动建立，所有槽位一起建好，形状恒定）。 */
	writePet(petId, leaf, data) {
		let entry = this.pets.get(petId);
		if (!entry) {
			entry = {
				say: emptyLeaf(),
				anim: emptyLeaf(),
				position: emptyLeaf(),
				throw: emptyLeaf(),
				lock: emptyLeaf(),
				sleep: emptyLeaf()
			};
			this.pets.set(petId, entry);
		}
		entry[leaf] = {
			counter: this.next(),
			data
		};
		this.wakeWaiters();
	}
	/**
	* 当前 S（GET /state 的响应体）。
	* sections 是浅拷贝、pets 是新建对象——叶子对象本身共享，但写入永远整体替换，
	* 所以消费端不会读到写了一半的叶子。
	*/
	read() {
		return {
			counter: this.last,
			sections: { ...this.sections },
			pets: Object.fromEntries(this.pets)
		};
	}
	/**
	* 挂起一个等待者：直到 `last` 变得不等于 `since`、或超时、或调用方取消。
	*
	* 三种收尾对调用方是同一件事（去 `read()` 拿最新状态），所以回调不带参数。
	*
	* @returns 取消函数（清掉超时定时器并摘掉等待者）。
	*/
	wait(args) {
		const waiter = {
			since: args.since,
			onWake: args.onWake,
			timer: void 0
		};
		this.waiters.add(waiter);
		waiter.timer = setTimeout(() => {
			this.dropWaiter(waiter);
			waiter.onWake();
		}, Math.max(0, args.timeoutMs));
		if (process.env.NODE_TEST_CONTEXT === void 0) waiter.timer.unref?.();
		return () => this.dropWaiter(waiter);
	}
	/**
	* 结束所有挂起的等待（插件卸载 / 宿主退出路径）。
	* 唤醒时不给区分标志：调用方据此立刻收尾，而不是留一个悬挂的响应。
	*/
	cancelAll() {
		for (const waiter of [...this.waiters]) {
			this.dropWaiter(waiter);
			waiter.onWake();
		}
	}
	/** 当前等待者数（测试 / 观测用：验证不泄漏）。 */
	waiterCount() {
		return this.waiters.size;
	}
	/**
	* 唤醒所有已经过期的等待者（唯一调用点是两个 write 方法，且必须在叶子写定之后）。
	* `since === this.last` 的跳过：那种等待者已经是最新的，叫醒它等于空转。
	* 必须写在 `this.sections[name] = …` 之后：放在 next() 里会让回调先于赋值执行，调用方读到旧状态。
	*/
	wakeWaiters() {
		if (this.waiters.size === 0) return;
		for (const waiter of [...this.waiters]) {
			if (waiter.since === this.last) continue;
			this.dropWaiter(waiter);
			waiter.onWake();
		}
	}
	/** 摘掉一个等待者（清定时器 + 从集合移除）。 */
	dropWaiter(waiter) {
		if (waiter.timer !== void 0) {
			clearTimeout(waiter.timer);
			waiter.timer = void 0;
		}
		this.waiters.delete(waiter);
	}
};

//#endregion
//#region src/host/work-status.ts
const HOST_WORK_STATUS_STATES = [
	"thinking",
	"working",
	"result",
	"waiting",
	"success",
	"error"
];
/**
* 回合结束原因 → 档位：completed → success，错误系（error / max-tokens / timeout）→ error，
* blocked → waiting；其余（aborted 等）→ null，由调用方清理会话回空闲——残留上一档会让回合被
* 打断后永远卡在 working。
*/
function turnEndState(kind) {
	if (kind === "completed") return "success";
	if (kind === "error" || kind === "max-tokens" || kind === "timeout") return "error";
	if (kind === "blocked") return "waiting";
	return null;
}
/** ask_user_question 工具名：模型在等用户选择题答复 → 归为 waiting（等待确认）而非普通工作。 */
const USER_QUESTION_TOOL$1 = "ask_user_question";
const GOAL_UPDATE_TOOL = "update_goal";
function goalUpdateAction(args) {
	try {
		const o = JSON.parse(args);
		const action = String(o?.action ?? "");
		if (action === "complete" || action === "blocked") return action;
	} catch {}
	return null;
}
function completedState(turn) {
	if (!turn?.goalRound) return "success";
	if (turn.closing === "blocked") return "error";
	if (turn.closing === "complete") return "success";
	return "result";
}
function reduceWorkStatus(event, turn) {
	switch (event?.type) {
		case "turn/start": return "thinking";
		case "tool/call": {
			if (String(event?.data?.name ?? "") === USER_QUESTION_TOOL$1) return "waiting";
			return "working";
		}
		case "tool/result": return "result";
		case "approval/asked": return "waiting";
		case "turn/end": {
			const reason = turnEndState(String(event?.data?.reason?.kind ?? ""));
			if (reason === "success") return completedState(turn);
			return reason;
		}
		default: return null;
	}
}
const TASK_TEXT_MAX = 40;
function currentTaskFromTodo(event) {
	const todos = Array.isArray(event?.data?.todos) ? event.data.todos : [];
	let current$2;
	for (const t of todos) if (t?.status === "in_progress") current$2 = t;
	if (!current$2) current$2 = todos.find((t) => t?.status === "pending");
	const content = String(current$2?.content ?? "").trim();
	if (!content) return null;
	const points = Array.from(content);
	return points.length > TASK_TEXT_MAX ? `${points.slice(0, TASK_TEXT_MAX).join("")}…` : content;
}
const WORK_STATUS_PRIORITY = {
	waiting: 60,
	error: 50,
	working: 40,
	thinking: 30,
	result: 25,
	success: 20
};
function pickDisplayed(entries) {
	let best;
	for (const entry of entries) if (!best || WORK_STATUS_PRIORITY[entry.state] > WORK_STATUS_PRIORITY[best.state] || WORK_STATUS_PRIORITY[entry.state] === WORK_STATUS_PRIORITY[best.state] && entry.seq > best.seq) best = entry;
	return best;
}
var WorkStatusStore = class {
	constructor() {
		this.sessions = new Map();
		this.snap = {
			state: null,
			task: null,
			ts: 0
		};
	}
	/** 该会话当前是否有活动条目（决定 todo/write 是否还值得更新它的文案）。 */
	has(sessionId) {
		return this.sessions.has(sessionId);
	}
	/** 该会话当前档位（无条目 / 已清返回 undefined）。 */
	stateOf(sessionId) {
		return this.sessions.get(sessionId)?.state;
	}
	/** 该会话当前任务详情（无条目返回 null）。 */
	taskOf(sessionId) {
		return this.sessions.get(sessionId)?.task ?? null;
	}
	/** 写会话状态（保留该会话已有的 task）；同状态且 seq 不更新则不写并返回 false（防刷屏）。 */
	setState(sessionId, state, seq = 0) {
		const prev = this.sessions.get(sessionId);
		if (prev?.state === state && prev.seq >= seq) return false;
		this.sessions.set(sessionId, {
			state,
			seq,
			task: prev?.task ?? null
		});
		this.refresh();
		return true;
	}
	/** 写该会话的任务详情（null = 清空）；会话无活动条目 → 不动（它不会被展示）。 */
	setTask(sessionId, task) {
		const prev = this.sessions.get(sessionId);
		if (!prev || prev.task === task) return false;
		this.sessions.set(sessionId, {
			...prev,
			task
		});
		this.refresh();
		return true;
	}
	/** 清掉某会话（回合结束 / 终态过期）：它的 task 一并消失，不会残留到后续活动里。 */
	clear(sessionId) {
		if (!this.sessions.delete(sessionId)) return false;
		this.refresh();
		return true;
	}
	/** 展示快照（对象引用稳定，供 /work-status 直接序列化）。 */
	snapshot() {
		return this.snap;
	}
	/** 重算展示：state 与 task 任一变化才更新 ts（轮询侧据此触发，两端都靠它刷新）。 */
	refresh() {
		const best = pickDisplayed(this.sessions.values());
		const nextState = best?.state ?? null;
		const nextTask = best?.task ?? null;
		if (nextState === this.snap.state && nextTask === this.snap.task) return;
		this.snap.state = nextState;
		this.snap.task = nextTask;
		this.snap.ts = Date.now();
	}
};

//#endregion
//#region src/host/plugin/setup.ts
function createHostSetup(ctx) {
	const dshHome = dshHomeDir();
	const userRoot = join(dshHome, "dsh-pet");
	const reusedLog = isFileLogger(ctx.logger) ? ctx.logger : void 0;
	const log = reusedLog ?? createFileLogger({
		file: join(userRoot, "logs.txt"),
		base: ctx.logger,
		debugEnabled: process.env.DSH_PET_LOG_DEBUG === "1"
	});
	setDefaultLogger(log);
	if (!reusedLog) ctx.effect(() => () => {
		log.flush();
		log.dispose();
	}, "dsh-pet: log file");
	/**
	* 软取宿主提供的可选服务（DSH 的 `ctx.get(name, required)` 语义：缺失返回 undefined，不抛）。
	*
	* 不能直接读 `ctx.xxx`：DSH 的 ctx 是严格 getter，读未写进 inject 的服务会抛异常而非返回 undefined
	* ——独立模式独有的 standaloneAi / shutdownApp 都没进 inject，裸读会让碎碎念 tick 每拍抛错、
	* /quit 回 500 而不是 {canQuit:false}。测试里的 fake ctx 没有 get，回落成属性读取即可。
	*/
	const optionalService = (name) => {
		const get = ctx.get;
		if (typeof get === "function") return get.call(ctx, name, false);
		return ctx[name];
	};
	/** 独立模式的碎碎念授权策略（可选能力）：DSH 宿主里是 undefined → 回落到只看 pet.whisperEnabled。 */
	const standaloneAiPolicy = () => optionalService("standaloneAi");
	const userConfigPath = join(userRoot, "main-config.jsonc");
	const legacyUserConfigPath = join(userRoot, "main-config.json");
	const petConfigDir = join(userRoot, "pet");
	const configPaths = {
		defaultFile: join(PACKAGE_ROOT, "assets", "config.jsonc"),
		userFile: userConfigPath,
		legacyUserFile: legacyUserConfigPath,
		petDir: petConfigDir
	};
	migrateUserConfig(configPaths, (msg) => log.info("[dsh-pet] " + msg));
	const thumbUserRoot = join(userRoot, "main-animation");
	const memesUserRoot = join(userRoot, "memes");
	/**
	* 表情包目录链，与动画素材（/thumb）同一套归属语义：`pet/<素材根>-memes/` 存在则只查它；
	* 否则用户目录优先、包内兜底。池（readMemePool）与路由（/pic/memes）必须走同一个函数，
	* 否则池里能选的名字路由取不到，气泡配图会图裂。
	* 素材根来自 URL 段，必须先过 resolveAsset，避免 Windows 上 %5C 解出的反斜杠逃出用户根。
	*/
	const memeDirsFor = (assetRoot) => {
		const own$1 = resolveAsset(petConfigDir, assetRoot + "-memes");
		if (own$1 !== void 0 && existsSync(own$1)) return [own$1];
		return [memesUserRoot, PACKAGE_MEMES_DIR];
	};
	const state = new PollStateStore();
	const menuRegistry = new MenuRegistry();
	ctx.provide("petApi7340", {
		balance: {
			register: registerBalanceProvider,
			list: listBalanceProviders
		},
		voice: {
			register: registerVoiceProvider,
			list: listVoiceProviders
		},
		speech: {
			register: registerSpeechProvider,
			list: listSpeechProviders
		}
	});
	const playback = new PlaybackStore();
	const workStatus = new WorkStatusStore();
	/** 外部写入槽：固定会话 id，最后写入者生效；不做多写者仲裁/租约/会话管理 */
	const EXTERNAL_WORK_SESSION = "api";
	let externalWorkSeq = 0;
	/** 推进外部写入序号并返回新值：每发生一次外部写入前进一拍，前端据此判断是否新的一次写入。 */
	const nextExternalWorkSeq = () => externalWorkSeq += 1;
	return {
		userRoot,
		log,
		configPaths,
		userConfigPath,
		petConfigDir,
		thumbUserRoot,
		memesUserRoot,
		memeDirsFor,
		optionalService,
		standaloneAiPolicy,
		state,
		menuRegistry,
		playback,
		workStatus,
		EXTERNAL_WORK_SESSION,
		nextExternalWorkSeq
	};
}

//#endregion
//#region src/host/routes/result.ts
function failureBody(reason, message, extra) {
	return {
		...extra,
		ok: false,
		reason,
		message
	};
}
function okResult(obj$1 = {}, headers) {
	return {
		kind: "json",
		status: 200,
		obj: obj$1,
		headers
	};
}
function failResult(reason, message, extra) {
	return {
		kind: "json",
		status: 200,
		obj: failureBody(reason, message, extra)
	};
}
function invalidJson(message = "invalid JSON body") {
	return rejected(400, "invalid-json", message);
}
function methodNotAllowed(message = "method not allowed") {
	return rejected(405, "method-not-allowed", message);
}
function payloadTooLarge(message = "request body too large") {
	return rejected(413, "payload-too-large", message);
}
/** 协议失败：真实状态码 + 与业务失败同一形状的体。 */
function rejected(status, reason, message) {
	return {
		kind: "json",
		status,
		obj: failureBody(reason, message)
	};
}

//#endregion
//#region src/host/routes/assets.ts
async function handleAssetsRoutes(deps, input) {
	const { assetRootFor, memeDirsFor, petConfigDir, userRootFor } = deps;
	const { rest } = input;
	const [scope, ...restParts] = rest.split("/");
	if (scope === "logo") {
		if (restParts.length > 0) return {
			kind: "text",
			status: 400,
			body: "dsh-pet: expected /dsh-pet-7340/logo"
		};
		const logo = resolveExisting(join(PACKAGE_ROOT, "assets"), "logo.png");
		if (logo === void 0) return {
			kind: "text",
			status: 404,
			body: "dsh-pet: logo not found"
		};
		return {
			kind: "file",
			file: logo,
			contentType: MIME[".png"] ?? "image/png"
		};
	}
	if (scope === "font") {
		const fontRoot = join(PACKAGE_ROOT, "assets", "fonts");
		const fontFile = resolveExisting(fontRoot, restParts.join("/"));
		if (fontFile === void 0) return {
			kind: "text",
			status: 404,
			body: "dsh-pet: font not found"
		};
		const ext$1 = fontFile.slice(fontFile.lastIndexOf(".")).toLowerCase();
		return {
			kind: "file",
			file: fontFile,
			contentType: MIME[ext$1] ?? "application/octet-stream"
		};
	}
	if (scope === "pic") {
		if (restParts[0] === "memes") {
			const segs = restParts.slice(1);
			const scoped = segs.length >= 2;
			const assetRoot = scoped ? segs[0] : "main";
			if (scoped && !isValidPetId(assetRoot)) return {
				kind: "text",
				status: 400,
				body: "dsh-pet: invalid asset root"
			};
			const rel = (scoped ? segs.slice(1) : segs).join("/");
			let picFile$1;
			for (const dir of memeDirsFor(assetRoot)) {
				picFile$1 = resolveExisting(dir, rel);
				if (picFile$1 !== void 0) break;
			}
			if (picFile$1 === void 0) return {
				kind: "text",
				status: 404,
				body: "dsh-pet: pic not found"
			};
			const ext$2 = picFile$1.slice(picFile$1.lastIndexOf(".")).toLowerCase();
			return {
				kind: "file",
				file: picFile$1,
				contentType: MIME[ext$2] ?? "application/octet-stream"
			};
		}
		const picRoot = join(PACKAGE_ROOT, "assets", "pic");
		const picFile = resolveExisting(picRoot, restParts.join("/"));
		if (picFile === void 0) return {
			kind: "text",
			status: 404,
			body: "dsh-pet: pic not found"
		};
		const ext$1 = picFile.slice(picFile.lastIndexOf(".")).toLowerCase();
		return {
			kind: "file",
			file: picFile,
			contentType: MIME[ext$1] ?? "application/octet-stream"
		};
	}
	if (scope === "sound") {
		const soundRoot = join(PACKAGE_ROOT, "assets", "sound");
		const soundFile = resolveExisting(soundRoot, restParts.join("/"));
		if (soundFile === void 0) return {
			kind: "text",
			status: 404,
			body: "dsh-pet: sound not found"
		};
		const ext$1 = soundFile.slice(soundFile.lastIndexOf(".")).toLowerCase();
		return {
			kind: "file",
			file: soundFile,
			contentType: MIME[ext$1] ?? "application/octet-stream"
		};
	}
	if (scope !== "thumb") return {
		kind: "text",
		status: 400,
		body: "dsh-pet: expected /dsh-pet-7340/thumb/<petId>/<file>"
	};
	const [petId, ...nameParts] = restParts;
	if (!petId || nameParts.length === 0) return {
		kind: "text",
		status: 400,
		body: "dsh-pet: expected /dsh-pet-7340/thumb/<petId>/<file>"
	};
	if (!isValidPetId(petId)) return {
		kind: "text",
		status: 400,
		body: "dsh-pet: invalid pet id"
	};
	const fileName = nameParts.join("/");
	const ext = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
	if (ext !== ".webm" && ext !== ".mov") return {
		kind: "text",
		status: 400,
		body: "dsh-pet: unsupported animation format (expected .webm or .mov)"
	};
	const extraAnimDir = resolveAsset(petConfigDir, petId + "-animation");
	/** 按扩展名查同名素材（专属目录优先；否则用户根 → 包内根） */
	const findAnim = (e) => {
		const name = fileName.replace(/\.(webm|mov)$/i, "") + e;
		return extraAnimDir !== void 0 && existsSync(extraAnimDir) ? resolveExisting(extraAnimDir, name) : resolveExisting(userRootFor(e), name) ?? resolveExisting(assetRootFor(e), name);
	};
	let file = findAnim(ext);
	let servedExt = ext;
	if (file === void 0 && ext === ".mov") {
		const fb = findAnim(".webm");
		if (fb !== void 0) {
			file = fb;
			servedExt = ".webm";
		}
	}
	if (file === void 0) return {
		kind: "text",
		status: 404,
		body: "dsh-pet: asset not found"
	};
	return {
		kind: "file",
		file,
		contentType: MIME[servedExt] ?? "application/octet-stream"
	};
}

//#endregion
//#region src/host/routes/attachment.ts
/** 附件 id 的合法形状（与宿主附件服务同一规则）：`sha256:` + 64 位小写 hex。 */
const ATTACHMENT_ID = /^sha256:[a-f0-9]{64}$/;
/** 嗅探读取的文件头长度：覆盖四种格式魔数所需的最大偏移（WebP 要看到第 12 字节）。 */
const HEAD_BYTES = 16;
async function handleAttachmentRoutes(deps, input) {
	const { method, rest, url } = input;
	if (rest === "attachment") {
		if (method !== "GET") return {
			kind: "text",
			status: 405,
			body: "dsh-pet: method not allowed"
		};
		const id = url.searchParams.get("id") ?? "";
		if (!ATTACHMENT_ID.test(id)) return {
			kind: "text",
			status: 400,
			body: "dsh-pet: invalid attachment id"
		};
		const sink = deps.optionalService("attachments");
		const file = locate(sink, id);
		if (file === void 0) return {
			kind: "text",
			status: 404,
			body: "dsh-pet: attachment not found"
		};
		const contentType = sniffImageType(file);
		if (contentType === void 0) return {
			kind: "text",
			status: 404,
			body: "dsh-pet: attachment is not a displayable image"
		};
		return {
			kind: "file",
			file,
			contentType
		};
	}
	return void 0;
}
/** 用附件服务定位对象；服务缺失、后端非文件式、引用非法或对象已被清掉都返回 undefined。 */
function locate(sink, id) {
	if (typeof sink?.imageHostPath !== "function") return void 0;
	try {
		const file = sink.imageHostPath({ attachmentId: id });
		return file !== void 0 && existsSync(file) ? file : void 0;
	} catch {
		return void 0;
	}
}
/** 按文件头判断图片类型；只认附件服务会存的四种，读不到或认不出返回 undefined。 */
function sniffImageType(file) {
	try {
		const fd = openSync(file, "r");
		try {
			const head = Buffer.alloc(HEAD_BYTES);
			return imageTypeOf(head, readSync(fd, head, 0, HEAD_BYTES, 0));
		} finally {
			closeSync(fd);
		}
	} catch {
		return void 0;
	}
}
/**
* 魔数判定（PNG / JPEG / GIF / WebP）。
*
* @param header - 文件头缓冲（可能不满 {@link HEAD_BYTES}）。
* @param size - header 里实际读到的字节数。
* @returns 图片的 Content-Type；不是这四种之一时返回 undefined。
*/
function imageTypeOf(header, size) {
	if (size >= 8 && header.readUInt32BE(0) === 2303741511 && header.readUInt32BE(4) === 218765834) return "image/png";
	if (size >= 3 && header[0] === 255 && header[1] === 216 && header[2] === 255) return "image/jpeg";
	if (size >= 6) {
		const tag = header.toString("latin1", 0, 6);
		if (tag === "GIF87a" || tag === "GIF89a") return "image/gif";
	}
	if (size >= 12 && header.toString("latin1", 0, 4) === "RIFF" && header.toString("latin1", 8, 12) === "WEBP") return "image/webp";
	return void 0;
}

//#endregion
//#region src/host/routes/balance.ts
async function handleBalanceRoutes(deps, input) {
	const { refreshBalance } = deps;
	const { method, rest } = input;
	if (rest === "balance") {
		if (method !== "POST") return methodNotAllowed();
		await refreshBalance(true);
		return okResult({ ok: true });
	}
	return void 0;
}

//#endregion
//#region src/host/image-attachment.ts
/** 允许的媒体类型；顺序用于错误文案，与宿主附件服务的白名单保持一份事实。 */
const MEDIA_TYPES = [
	"image/png",
	"image/jpeg",
	"image/webp",
	"image/gif"
];
/** base64 字符上限：请求体上限 1 MiB 下留出 text 与 JSON 结构的余量。 */
const MAX_BASE64_CHARS = 9e5;
function parseImageAttachment(raw) {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {
		ok: false,
		message: "attachment 必须是对象"
	};
	const { mediaType, data } = raw;
	if (typeof mediaType !== "string" || !MEDIA_TYPES.includes(mediaType)) return {
		ok: false,
		message: `attachment.mediaType 必须是 ${MEDIA_TYPES.join(" / ")} 之一`
	};
	if (typeof data !== "string" || data === "") return {
		ok: false,
		message: "attachment.data 必须是非空 base64 字符串"
	};
	if (data.length > MAX_BASE64_CHARS) return {
		ok: false,
		message: "attachment.data 过长（请压缩或降低分辨率）"
	};
	const decoded = Buffer.from(data, "base64");
	if (decoded.length === 0 || decoded.toString("base64") !== data) return {
		ok: false,
		message: "attachment.data 不是合法的 base64"
	};
	return {
		ok: true,
		mediaType,
		bytes: new Uint8Array(decoded)
	};
}

//#endregion
//#region src/host/routes/chat.ts
async function handleChatRoutes(deps, input) {
	const { configPaths, log, memoryPath, memoryRounds, readMemory, requirePet } = deps;
	const { body, method, rest, url } = input;
	if (rest === "chat/memory") {
		if (method !== "GET" && method !== "DELETE") return methodNotAllowed();
		try {
			if (method === "DELETE") return okResult(await deps.deleteOrphans());
			return okResult({
				ok: true,
				orphans: await deps.orphanHistory()
			});
		} catch (e) {
			return failResult("generate-error", e instanceof Error ? e.message : String(e));
		}
	}
	if (rest === "chat") {
		if (method !== "GET" && method !== "POST" && method !== "DELETE") return methodNotAllowed();
		try {
			const roundsRaw = method === "GET" ? url.searchParams.get("rounds") : null;
			let roundsOverride = null;
			if (roundsRaw !== null && roundsRaw.trim() !== "") {
				const n = Number(roundsRaw);
				if (!Number.isInteger(n) || n < 0 || n > 200) return failResult("bad-request", "rounds 必须是 0–200 的整数（不传则用配置）");
				roundsOverride = n;
			}
			let tsList;
			if (method === "DELETE") {
				const parsed = parseTsList(url.searchParams.getAll("ts"));
				if (parsed === null) return failResult("bad-request", "ts 必须是非负整数（毫秒时间戳）");
				tsList = parsed.length > 0 ? parsed : void 0;
			}
			let cfgCache;
			const cfg = () => cfgCache ??= readAllConfig(configPaths);
			const who = requirePet(url.searchParams, cfg, { surface: method === "POST" });
			if (!who.ok) return who.res;
			const petId = who.petId;
			if (method === "GET") {
				const mem = await readMemory();
				const rawMessages = mem[who.entry]?.[petId]?.messages;
				const list = Array.isArray(rawMessages) ? rawMessages.filter((m) => m && typeof m.content === "string") : [];
				if (rawMessages !== void 0 && !Array.isArray(rawMessages)) log.error(`[dsh-pet] 记忆结构异常（messages 不是数组）pet=${petId}，按空历史处理：${memoryPath}`);
				const rounds = roundsOverride ?? memoryRounds(who.conf);
				const messages = sliceMemoryRounds(list, rounds);
				return okResult({
					ok: true,
					messages,
					rounds
				});
			}
			if (method === "DELETE") return okResult(await deps.deleteHistory(petId, tsList));
			return await postChat(deps, petId, body);
		} catch (e) {
			return failResult("generate-error", e instanceof Error ? e.message : String(e));
		}
	}
	return void 0;
}
/**
* 解析 DELETE 的 `?ts=`（可重复）。
*
* @param raws - 查询串里所有 `ts` 的原值。
* @returns 去重后的时间戳数组；任一值不是非负整数时返回 `null`（调用方转 bad-request）。
*/
function parseTsList(raws) {
	const out = [];
	for (const raw of raws) {
		const n = Number(raw);
		if (raw.trim() === "" || !Number.isInteger(n) || n < 0) return null;
		out.push(n);
	}
	return [...new Set(out)];
}
/**
* POST /chat：解析文本与可选图片，交给对话层生成回复。
*
* @param deps - 路由依赖。
* @param petId - 已校验存在的宠物 id。
* @param body - 请求体原文；不是合法 JSON 时回 400。
* @returns 与加入图片前同形的应答：成功只带 `text`（配图时另有 `image`）。
*/
async function postChat(deps, petId, body) {
	let parsed;
	try {
		parsed = JSON.parse(body ?? "null") ?? {};
	} catch {
		return invalidJson();
	}
	const text = typeof parsed.text === "string" ? parsed.text.trim() : "";
	if (!text) return failResult("bad-request", "消息为空");
	if (text.length > 2e3) return failResult("bad-request", "消息过长（限 2000 字）");
	const admitted = await admitImage(deps, parsed.attachment);
	if (!admitted.ok) return admitted.res;
	return okResult(await deps.chatWithPet(petId, text, admitted.ref));
}
/**
* 校验图片入参并交给宿主附件服务落盘。
*
* @param deps - 路由依赖（附件服务经 optionalService 软取，不进 inject）。
* @param raw - 请求体里的 `attachment` 原始值；`undefined` 表示没传图。
* @returns 已落盘的图片引用，或可直接返回的失败应答。
*/
async function admitImage(deps, raw) {
	if (raw === void 0) return { ok: true };
	const parsed = parseImageAttachment(raw);
	if (!parsed.ok) return {
		ok: false,
		res: failResult("bad-request", parsed.message)
	};
	const sink = deps.optionalService("attachments");
	if (typeof sink?.saveImages !== "function") return {
		ok: false,
		res: failResult("bad-request", "当前模式不支持图片（缺少附件服务）")
	};
	const maxBytes = sink.imageLimits?.maxImageBytes;
	if (maxBytes !== void 0 && parsed.bytes.length > maxBytes) return {
		ok: false,
		res: failResult("bad-request", `图片过大（上限 ${maxBytes} 字节，请压缩或降低分辨率）`)
	};
	try {
		const [ref] = await sink.saveImages([{
			data: parsed.bytes,
			mediaType: parsed.mediaType
		}]);
		if (ref === void 0) return {
			ok: false,
			res: failResult("generate-error", "附件服务未返回图片引用")
		};
		return {
			ok: true,
			ref
		};
	} catch (e) {
		return {
			ok: false,
			res: failResult("generate-error", e instanceof Error ? e.message : String(e))
		};
	}
}

//#endregion
//#region src/host/storage-paths.ts
const DESKTOP_APP_NAME = "dsh-pet-electron-helper";
/** Electron 下载缓存的应用名（@electron/get 写死 env-paths('electron')，与插件名无关）。 */
const ELECTRON_PATHS_NAME = "electron";
/**
* 桌面端 userData 目录（Electron app.getPath('userData') 的等价推导）。
* 逐平台对齐 Electron 口径：win32 = %APPDATA%\<name>，darwin = ~/Library/Application Support/<name>，
* linux = $XDG_CONFIG_HOME/<name>，未设则 ~/.config/<name>。
*/
function desktopUserDataDir(input) {
	const { home, env = process.env, platform = process.platform } = input;
	if (platform === "win32") return join(env.APPDATA || join(home, "AppData", "Roaming"), DESKTOP_APP_NAME);
	if (platform === "darwin") return join(home, "Library", "Application Support", DESKTOP_APP_NAME);
	return join(env.XDG_CONFIG_HOME || join(home, ".config"), DESKTOP_APP_NAME);
}
/**
* Electron 安装包下载缓存目录（@electron/get 默认 cacheRoot = env-paths('electron').cache）。
* win32 在 LOCALAPPDATA 下多一层 Cache，macOS 用 ~/Library/Caches，Linux 用 $XDG_CACHE_HOME
* （默认 ~/.cache）。该目录与其它用 @electron/get 的工具共用，删掉只是下次重新下载。
*/
function electronCacheDir(input) {
	const { home, env = process.env, platform = process.platform } = input;
	if (platform === "win32") return join(env.LOCALAPPDATA || join(home, "AppData", "Local"), ELECTRON_PATHS_NAME, "Cache");
	if (platform === "darwin") return join(home, "Library", "Caches", ELECTRON_PATHS_NAME);
	return join(env.XDG_CACHE_HOME || join(home, ".cache"), ELECTRON_PATHS_NAME);
}
function storageEntries(input) {
	const items = [
		{
			key: "userData",
			path: input.userDataRoot
		},
		{
			key: "electron",
			path: input.electronDir
		},
		{
			key: "desktopCache",
			path: desktopUserDataDir(input)
		},
		{
			key: "electronCache",
			path: electronCacheDir(input)
		},
		{
			key: "package",
			path: input.packageRoot
		}
	];
	return items.map((it) => ({
		...it,
		exists: existsSync(it.path)
	}));
}
function profileNameFrom(packageRoot$1) {
	const m = /[\\/]profiles[\\/]([^\\/]+)[\\/]node_modules[\\/][^\\/]+[\\/]?$/.exec(packageRoot$1);
	return m?.[1];
}

//#endregion
//#region src/host/todo/types.ts
const TODO_FILE_VERSION = 1;
const TODO_TEXT_MAX = 200;
const TODO_BODY_MAX_BYTES = 16 * 1024;
function normalizeTodoText(raw) {
	if (typeof raw !== "string") return null;
	const text = raw.trim();
	if (text === "") return null;
	if (Array.from(text).length > TODO_TEXT_MAX) return null;
	return text;
}
function normalizeTodoDueAt(raw) {
	if (raw === null || raw === void 0) return {
		ok: true,
		value: null
	};
	if (typeof raw !== "number" || !Number.isFinite(raw)) return { ok: false };
	if (Math.abs(raw) > 864e13) return { ok: false };
	return {
		ok: true,
		value: raw
	};
}
/** 读一个有限数字，非法时回落。 */
function finiteOr(raw, fallback) {
	return typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;
}
function parseTodoRecord(raw) {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
	const record = raw;
	if (typeof record.id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(record.id)) return null;
	const text = normalizeTodoText(record.text);
	if (text === null) return null;
	const due = normalizeTodoDueAt(record.dueAt);
	if (!due.ok) return null;
	const createdAt = finiteOr(record.createdAt, 0);
	const updatedAt = finiteOr(record.updatedAt, createdAt);
	const done = record.done === true;
	const completedAt = done ? finiteOr(record.completedAt, updatedAt) : null;
	const lastRemindedAt = typeof record.lastRemindedAt === "number" && Number.isFinite(record.lastRemindedAt) ? record.lastRemindedAt : null;
	return {
		id: record.id,
		text,
		dueAt: due.value,
		done,
		createdAt,
		updatedAt,
		completedAt,
		lastRemindedAt
	};
}
function parseTodoFile(raw) {
	const root = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
	const list = Array.isArray(root.todos) ? root.todos : [];
	const out = [];
	const seen = new Set();
	for (const item of list) {
		const todo = parseTodoRecord(item);
		if (todo === null || seen.has(todo.id)) continue;
		seen.add(todo.id);
		out.push(todo);
	}
	return out;
}
function cloneTodo(todo) {
	return { ...todo };
}
function sortTodos(list) {
	return [...list].sort((a, b) => {
		if (a.done !== b.done) return a.done ? 1 : -1;
		if (a.done) return (b.completedAt ?? 0) - (a.completedAt ?? 0);
		const aDue = a.dueAt ?? Number.POSITIVE_INFINITY;
		const bDue = b.dueAt ?? Number.POSITIVE_INFINITY;
		if (aDue !== bDue) return aDue - bDue;
		return a.createdAt - b.createdAt;
	});
}

//#endregion
//#region src/host/todo/store.ts
const TODO_FILE_NAME = "todos.json";
/** 异常 → 一行可读原因（日志用，不外泄给 HTTP 响应）。 */
function messageOf(error) {
	return error instanceof Error ? error.message : String(error);
}
var TodoStore = class {
	constructor(options) {
		this.file = options.file;
		this.log = options.log;
		this.now = options.now ?? (() => Date.now());
		this.queue = Promise.resolve();
		this.cached = null;
		this.seq = 0;
	}
	/** 全部待办（排序后的副本）。 */
	list() {
		return this.run(async () => {
			await this.ensureLoaded();
			return sortTodos(this.cached ?? []).map(cloneTodo);
		});
	}
	/**
	* 新建一条。
	*
	* id 由时间戳 + 进程内序号生成：重启后时间戳不同，旧 id 不会撞。
	*
	* @param input - 已校验的正文与到期时刻。
	* @returns 落盘成功后的记录副本。
	*/
	create(input) {
		return this.run(async () => {
			await this.ensureLoaded();
			const at = this.now();
			this.seq += 1;
			const todo = {
				id: `todo-${at.toString(36)}-${this.seq.toString(36)}`,
				text: input.text,
				dueAt: input.dueAt,
				done: false,
				createdAt: at,
				updatedAt: at,
				completedAt: null,
				lastRemindedAt: null
			};
			await this.persist([...this.cached ?? [], todo]);
			return cloneTodo(todo);
		});
	}
	/**
	* 更新一条。
	*
	* 改期限或重新打开都会清空 `lastRemindedAt`：提醒按新的到期时刻重新排期。
	*
	* @returns 更新后的记录；id 不存在返回 null。
	*/
	update(id, patch) {
		return this.run(async () => {
			await this.ensureLoaded();
			const list = this.cached ?? [];
			const index = list.findIndex((todo) => todo.id === id);
			if (index < 0) return null;
			const prev = list[index];
			const at = this.now();
			const next = {
				...prev,
				updatedAt: at
			};
			if (patch.text !== void 0) next.text = patch.text;
			if (patch.dueAt !== void 0) {
				next.dueAt = patch.dueAt;
				next.lastRemindedAt = null;
			}
			if (patch.done !== void 0) {
				next.done = patch.done;
				next.completedAt = patch.done ? prev.completedAt ?? at : null;
				if (!patch.done) next.lastRemindedAt = null;
			}
			const updated = [...list];
			updated[index] = next;
			await this.persist(updated);
			return cloneTodo(next);
		});
	}
	/**
	* 删除一条。
	*
	* @returns 删掉的条数；0 表示本来就没有（幂等，不当成错误）。
	*/
	remove(id) {
		return this.run(async () => {
			await this.ensureLoaded();
			const list = this.cached ?? [];
			const next = list.filter((todo) => todo.id !== id);
			if (next.length === list.length) return 0;
			await this.persist(next);
			return 1;
		});
	}
	/** 记下一次提醒时刻：只动 `lastRemindedAt`，不推进 `updatedAt`（那不是用户修改）。 */
	markReminded(id, at) {
		return this.run(async () => {
			await this.ensureLoaded();
			const list = this.cached ?? [];
			const index = list.findIndex((todo) => todo.id === id);
			if (index < 0) return;
			const next = [...list];
			next[index] = {
				...list[index],
				lastRemindedAt: at
			};
			await this.persist(next);
		});
	}
	/** 队列：上一个任务结束后执行下一个；失败不影响后续任务。 */
	run(task) {
		const next = this.queue.then(task, task);
		this.queue = next.then(() => void 0, () => void 0);
		return next;
	}
	async ensureLoaded() {
		if (this.cached !== null) return;
		this.cached = await this.readDisk();
	}
	async readDisk() {
		let raw;
		try {
			raw = await readFile(this.file, "utf8");
		} catch (error) {
			if (error.code !== "ENOENT") this.log.warn?.(`[dsh-pet] 待办文件读取失败，按空清单继续：${messageOf(error)}`);
			return [];
		}
		try {
			return parseTodoFile(JSON.parse(raw));
		} catch (error) {
			this.log.warn?.(`[dsh-pet] 待办文件解析失败，按空清单继续：${messageOf(error)}`);
			return [];
		}
	}
	/** 原子写：临时文件写完再 rename，进程中途退出不会留下半个 JSON。 */
	async persist(next) {
		const file = {
			version: TODO_FILE_VERSION,
			todos: [...next]
		};
		await mkdir(dirname(this.file), { recursive: true });
		const temp = this.file + ".tmp";
		await writeFile(temp, JSON.stringify(file, null, 2) + "\n", "utf8");
		await rename(temp, this.file);
		this.cached = [...next];
	}
};

//#endregion
//#region src/host/routes/config/save.ts
async function saveConfigRoute(deps, input) {
	if (input.method === "PUT") return saveUserLayer(deps, input);
	if (input.method === "POST") return syncFromDefault(deps);
	return methodNotAllowed();
}
/** 白名单重建用户层后写盘，响应体是保存后的成品聚合。 */
async function saveUserLayer(deps, input) {
	const { configPaths, ctx, requestRestart, userConfigPath, userRoot } = deps;
	let parsed;
	try {
		parsed = JSON.parse(input.body ?? "");
	} catch {
		return invalidJson();
	}
	try {
		const existing = readUserConfig(configPaths);
		const clean = saveUserConfig(parsed, existing);
		if (!clean) return failResult("bad-request", "invalid pet config: expected { pets:[{name?,id,size,sizePercent?,balanceEnabled,display,position:{corner,marginX,marginY}}] }（id 为非空字符串且去除首尾空白后唯一；sizePercent 可选，不小于 1 的数字；display 为 web/desktop/both/none 之一；可选顶层 notificationsEnabled / whisperImageEnabled / chatImageEnabled / chatAnimationEnabled / trayEnabled 布尔；可选宠物布尔 whisperEnabled / workStatusEnabled / fixedEnabled）");
		if (input.url.searchParams.get("force") !== "1" && userConfigUnparsable(configPaths)) return failResult("user-config-unparsable", "用户配置无法解析，需确认后重建", {
			needConfirm: true,
			userFile: userConfigPath
		});
		await mkdir(userRoot, { recursive: true });
		await writeFile(userConfigPath, JSON.stringify(clean, null, 2), "utf8");
		requestRestart();
		return okResult(readAllConfig(configPaths));
	} catch (e) {
		ctx.logger?.warn?.(`[dsh-pet] config save failed: ${e instanceof Error ? e.message : String(e)}`);
		return failResult("generate-error", "failed to save config");
	}
}
/**
* 把内置默认配置（`assets/config.jsonc` 原文，含注释）整份写入用户配置。
*
* 既是「恢复默认」（合并结果 = 内置默认），又给用户留下一份可直接编辑的完整配置，
* 不必再自己从包内复制一份（见 ../config 的 syncUserConfigFromDefault）。
*/
function syncFromDefault(deps) {
	const { configPaths, requestRestart } = deps;
	try {
		syncUserConfigFromDefault(configPaths);
	} catch (e) {
		return failResult("generate-error", e instanceof Error ? e.message : String(e));
	}
	requestRestart();
	return okResult(readAllConfig(configPaths));
}

//#endregion
//#region src/host/routes/config/layer.ts
function resolveConfigLayer(deps, entry) {
	if (entry === "main") return {
		ok: true,
		layer: {
			path: deps.userConfigPath,
			dir: deps.userRoot,
			existing: readUserConfig(deps.configPaths)
		}
	};
	const file = readPetConfigEntry(deps.configPaths, entry);
	if (!file) return { ok: false };
	return {
		ok: true,
		layer: {
			path: file.path,
			dir: deps.petConfigDir,
			existing: file.raw
		}
	};
}

//#endregion
//#region src/host/routes/config/display.ts
async function setPetDisplay(deps, input) {
	if (input.method !== "POST") return methodNotAllowed();
	let payload;
	try {
		payload = JSON.parse(input.body ?? "");
	} catch {
		return invalidJson();
	}
	const petId = typeof payload.id === "string" ? payload.id.trim() : "";
	const nextDisplay = String(payload.display ?? "");
	if (!petId) return failResult("pet-required", "pet 必填：要指定操作哪只桌宠");
	if (!PET_DISPLAY_SET.has(nextDisplay)) return failResult("bad-request", `display 必须是 web / desktop / both / none：${nextDisplay}`);
	let merged;
	try {
		merged = readAllConfig(deps.configPaths);
	} catch (e) {
		return failResult("generate-error", e instanceof Error ? e.message : String(e));
	}
	const hit = findPetInstance(merged, petId);
	if (!hit) return failResult("unknown-pet", `没有这只桌宠：${petId}`);
	const resolved = resolveConfigLayer(deps, hit.entry);
	if (!resolved.ok) return failResult("generate-error", `宠物条目配置文件找不到：${hit.entry}`);
	const layer = resolved.layer;
	const layerPets = Array.isArray(hit.conf.pets) ? hit.conf.pets : [];
	const pets = layerPets.map((p) => String(p.id) === petId ? {
		...p,
		display: nextDisplay
	} : p);
	const clean = saveUserConfig({ pets }, layer.existing);
	if (!clean) return failResult("bad-request", "宠物配置非法");
	try {
		await mkdir(layer.dir, { recursive: true });
		await writeFile(layer.path, JSON.stringify(clean, null, 2), "utf8");
	} catch (e) {
		return failResult("generate-error", e instanceof Error ? e.message : String(e));
	}
	deps.state.writeSection("config", {});
	if (nextDisplay === "none") deps.lock.release({
		petId,
		force: true
	});
	deps.requestRestart();
	return okResult(readAllConfig(deps.configPaths));
}

//#endregion
//#region src/host/routes/config/entry.ts
/** main 条目连同全局字段走 PUT /config，本端点只收「种类」层。 */
const MAIN_ENTRY = "main";
/** 实例数组非法时的统一文案：saveUserConfig 只回 null，细节必须在这里讲清。 */
const INVALID_PETS = "pets 非法：必须是该种类的全部实例（至少 1 只），每只 id 唯一，size / balanceEnabled / display / position 齐全合法";
/**
* 找出与其它条目冲突的实例 id。
*
* 合并后 id 跨条目全局唯一，重复的实例会被静默跳过（只告警一次）；不在写盘前拦住，
* 用户看到的是「保存成功、宠物消失」。
*
* @param deps - 路由层依赖（路径集）。
* @param entry - 本次要写的条目；它自己的旧 id 不算冲突。
* @param pets - 已过白名单的实例数组。
* @returns 冲突描述列表；空数组表示没有冲突。
*/
function conflictingIds(deps, entry, pets) {
	const merged = readAllConfig(deps.configPaths);
	const taken = new Map();
	for (const [key, conf] of Object.entries(merged)) {
		if (key === entry) continue;
		const list = Array.isArray(conf?.pets) ? conf.pets : [];
		for (const pet of list) taken.set(String(pet.id), key);
	}
	const out = [];
	for (const pet of pets) {
		const id = String(pet.id);
		const owner = taken.get(id);
		if (owner !== void 0) out.push(`${id}（已被「${owner}」占用）`);
	}
	return out;
}
async function savePetLayer(deps, input) {
	if (input.method !== "POST") return methodNotAllowed();
	let payload;
	try {
		payload = JSON.parse(input.body ?? "");
	} catch {
		return invalidJson();
	}
	const entry = typeof payload.entry === "string" ? payload.entry.trim() : "";
	if (!entry) return failResult("bad-request", "entry 必填：要写哪个种类（pet/<名>-config.json 的文件名前缀）");
	if (!isValidPetId(entry)) return failResult("bad-request", `entry 不能当路径片段用：${entry}`);
	if (entry === MAIN_ENTRY) return failResult("bad-request", "main 条目请用 PUT /config：它还要带全局字段");
	const pets = payload.pets;
	if (!Array.isArray(pets) || pets.length === 0) return failResult("bad-request", INVALID_PETS);
	const resolved = resolveConfigLayer(deps, entry);
	if (!resolved.ok) return failResult("unknown-entry", `没有这个种类：${entry}`);
	const layer = resolved.layer;
	const clean = saveUserConfig({ pets }, layer.existing);
	if (!clean) return failResult("bad-request", INVALID_PETS);
	const instances = clean.pets;
	let conflicts;
	try {
		conflicts = conflictingIds(deps, entry, instances);
	} catch (e) {
		return failResult("generate-error", e instanceof Error ? e.message : String(e));
	}
	if (conflicts.length > 0) return failResult("bad-request", "宠物 id 与其它种类冲突：" + conflicts.join("、"));
	try {
		await mkdir(layer.dir, { recursive: true });
		await writeFile(layer.path, JSON.stringify(clean, null, 2), "utf8");
	} catch (e) {
		return failResult("generate-error", e instanceof Error ? e.message : String(e));
	}
	deps.state.writeSection("config", {});
	for (const pet of instances) if (pet.display === "none") deps.lock.release({
		petId: String(pet.id),
		force: true
	});
	deps.requestRestart();
	return okResult(readAllConfig(deps.configPaths));
}

//#endregion
//#region src/host/routes/config/index.ts
async function handleConfigRoutes(deps, input) {
	if (input.rest === "config") return input.method === "GET" ? getConfig(deps) : saveConfigRoute(deps, input);
	if (input.rest === "pet-display") return setPetDisplay(deps, input);
	if (input.rest === "pet-config") return savePetLayer(deps, input);
	if (input.rest === "config/meta") return getMeta(deps);
	return void 0;
}
/** 合并成品：唯一配置入口，浏览器 / 桌面 / 设置页直接消费，无需任何校验或兜底。 */
function getConfig(deps) {
	try {
		return okResult(readAllConfig(deps.configPaths), { "cache-control": "no-cache, no-store" });
	} catch (e) {
		return failResult("generate-error", e instanceof Error ? e.message : String(e));
	}
}
/** 路径与存储清单：只读环境与路径，不做业务判断，因此没有失败实体。 */
function getMeta(deps) {
	const { log, memesUserRoot, thumbUserRoot, userConfigPath, userRoot } = deps;
	return okResult({
		user: userConfigPath,
		default: join(PACKAGE_ROOT, "assets", "config.jsonc"),
		animations: thumbUserRoot,
		memes: memesUserRoot,
		todos: join(userRoot, TODO_FILE_NAME),
		logs: log.file,
		storage: storageEntries({
			userDataRoot: userRoot,
			electronDir: electronLandingDir(),
			home: homedir(),
			packageRoot: PACKAGE_ROOT
		}),
		profile: profileNameFrom(PACKAGE_ROOT) ?? ""
	});
}

//#endregion
//#region src/host/routes/desktop.ts
async function handleDesktopRoutes(deps, input) {
	const { log, optionalService, requestRestart } = deps;
	const { method, rest } = input;
	if (rest === "reload") {
		if (method !== "POST") return methodNotAllowed();
		requestRestart();
		return okResult({ reloading: true });
	}
	if (rest === "quit") {
		const quit = optionalService("shutdownApp");
		const canQuit = typeof quit === "function";
		if (method === "GET") return okResult({ canQuit });
		if (method !== "POST") return methodNotAllowed();
		if (!canQuit) return failResult("unsupported", "宿主未提供退出能力（DSH 内请关闭桌面模式）");
		setImmediate(() => {
			try {
				quit("托盘退出");
			} catch (e) {
				log.warn(`[dsh-pet] 托盘退出失败：${e instanceof Error ? e.message : String(e)}`);
			}
		});
		return okResult({ ok: true });
	}
	return void 0;
}

//#endregion
//#region src/host/surface.ts
const SURFACES = [
	"web",
	"desktop",
	"both",
	"any"
];
const SURFACE_TEXT = "surface 必填：web / desktop / both / any";
function normalizeSurface(v) {
	return typeof v === "string" && SURFACES.includes(v) ? v : null;
}
function displayCovers(want, display) {
	switch (want) {
		case "any": return display === "web" || display === "desktop" || display === "both" || display === "none";
		case "web": return display === "web" || display === "both";
		case "desktop": return display === "desktop" || display === "both";
		case "both": return display === "both";
	}
}
function isDisplayed(display) {
	return displayCovers("web", display) || displayCovers("desktop", display);
}
function pickVoiceSurface(display) {
	if (displayCovers("desktop", display)) return "desktop";
	if (displayCovers("web", display)) return "web";
	return null;
}
function voiceTargetOfSurface(want) {
	return want === "web" || want === "desktop" ? want : void 0;
}

//#endregion
//#region src/host/memes.ts
function readMemePool(memes, dirs) {
	if (!memes || typeof memes !== "object" || Array.isArray(memes)) return [];
	if (dirs.length === 0) return [];
	const out = [];
	for (const [name, desc] of Object.entries(memes)) {
		const text = typeof desc === "string" ? desc.trim() : "";
		if (!name || !text) continue;
		if (!dirs.some((dir) => existsSync(join(dir, name + ".png")))) continue;
		out.push({
			name,
			desc: text
		});
	}
	return out;
}
function pickMeme(pool, random = Math.random) {
	if (pool.length === 0) return void 0;
	const idx = Math.floor(random() * pool.length) % pool.length;
	return pool[idx];
}
function matchMeme(pool, name) {
	const key = String(name ?? "").trim();
	return key ? pool.find((m) => m.name === key) : void 0;
}
/** 配图选择标记：`[图:名称]` 附在回复末尾（容忍全角冒号与前后空白）。 */
const IMG_TAG = /\[图[:：]\s*([^\]\n]+?)\s*\]\s*$/;
function extractChatImage(text, pool) {
	const m = IMG_TAG.exec(text);
	if (!m) return { text };
	const hit = matchMeme(pool, m[1] ?? "");
	const body = text.slice(0, m.index).trim();
	if (!hit || !body) return { text };
	return {
		text: body,
		image: hit.name
	};
}
function memeCatalog(pool) {
	return pool.map((m) => "- " + m.name + "：" + m.desc).join("\n");
}
function limitPool(pool, limit) {
	const n = Math.floor(Number(limit));
	if (!Number.isFinite(n) || n <= 0) return pool;
	return pool.slice(0, n);
}

//#endregion
//#region src/host/anim.ts
/** 配置里的池子收窄：非数组、非字符串项一律丢弃。 */
function strings$1(v) {
	return Array.isArray(v) ? v.filter((x) => typeof x === "string" && x !== "") : [];
}
/** 朝向收窄：只认两个字面量，其余（大小写、空白、非字符串）一律不算。 */
const petFacing = (v) => v === "left" || v === "right" ? v : null;
function animationNames(animations) {
	const a = animations && typeof animations === "object" ? animations : {};
	const out = [];
	const push = (names) => {
		for (const n of names) if (!out.includes(n)) out.push(n);
	};
	push(strings$1(a.idle));
	push(strings$1(a.turn));
	push(strings$1(a.drag));
	push(strings$1(a.clicks));
	const moves = a.moves && typeof a.moves === "object" ? a.moves : {};
	push(Array.isArray(moves.actions) ? moves.actions.map((m) => m && typeof m === "object" ? m.name : void 0).filter((x) => typeof x === "string" && x !== "") : []);
	if (Array.isArray(a.categories)) {
		for (const c of a.categories) if (c && typeof c === "object") push(strings$1(c.actions));
	}
	const events = a.events && typeof a.events === "object" ? a.events : {};
	for (const key of Object.keys(events)) {
		const pool = events[key];
		if (!Array.isArray(pool)) continue;
		const names = [];
		for (const slot of pool) if (typeof slot === "string") names.push(slot);
		else names.push(...strings$1(slot));
		push(names);
	}
	return out;
}
function normalizeHttpUrl(v) {
	if (typeof v !== "string") return null;
	const raw = v.trim();
	if (!raw) return null;
	let parsed;
	try {
		parsed = new URL(raw);
	} catch {
		return null;
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
	return raw;
}
function decideAnim(args) {
	const { cfg, requested } = args;
	const name = typeof args.name === "string" ? args.name.trim() : "";
	const rawUrl = typeof args.url === "string" ? args.url.trim() : "";
	if (name && rawUrl) return {
		ok: false,
		reason: "bad-request",
		message: "name 与 url 只能给一个"
	};
	if (!name && !rawUrl) return {
		ok: false,
		reason: "bad-request",
		message: "name 或 url 必须给一个"
	};
	let facing;
	if (args.facing !== void 0 && args.facing !== null) {
		const f = petFacing(args.facing);
		if (f === null) return {
			ok: false,
			reason: "bad-request",
			message: "facing 必须是 left / right"
		};
		facing = f;
	}
	const petId = String(requested ?? "").trim();
	if (!petId) return {
		ok: false,
		reason: "pet-required",
		message: "pet 必填：要指定操作哪只桌宠"
	};
	const found = findPetInstance(cfg, petId);
	if (!found) return {
		ok: false,
		reason: "unknown-pet",
		message: "没有这只桌宠：" + petId
	};
	if (rawUrl) {
		const url = normalizeHttpUrl(rawUrl);
		if (url === null) return {
			ok: false,
			reason: "bad-request",
			message: "url 必须是 http/https 的完整地址"
		};
		return {
			ok: true,
			petId,
			url,
			facing
		};
	}
	const allowed = animationNames(found.conf.animations);
	if (!allowed.includes(name)) return {
		ok: false,
		reason: "unknown-animation",
		message: "没有这个动画：" + name
	};
	return {
		ok: true,
		petId,
		name,
		facing
	};
}

//#endregion
//#region src/host/broadcast.ts
/** 气泡默认显示时长（ms）——与两端消费侧的常量同值（host 不得 import src/shared，只能各写一份）。
*  它只用于把缺省解析成显式值写进叶子，让 /state 里能看到实际生效的时长。 */
const DEFAULT_BUBBLE_DURATION_MS = 10 * 1e3;
function normalizeBroadcastText(text) {
	return typeof text === "string" ? text.trim() : "";
}
function normalizeBroadcastDuration(duration) {
	if (duration === void 0 || duration === null) return DEFAULT_BUBBLE_DURATION_MS;
	if (typeof duration !== "number" || !Number.isFinite(duration) || duration < 0) return null;
	return duration;
}
function normalizeBroadcastAnim(anim) {
	return anim !== false;
}
/**
* `?pet=` → 实际落点（与 ./anim、./motion-cue 同一口径）：必填且必须真实存在。
*
* 两种失败分开报（绝不默认退到列表第一只）：没给 → pet-required，给了但配置里没有 → unknown-pet。
*/
function resolvePetId(cfg, requested) {
	const petId = String(requested ?? "").trim();
	if (!petId) return {
		ok: false,
		reason: "pet-required",
		message: "pet 必填：要指定操作哪只桌宠"
	};
	const found = findPetInstance(cfg, petId);
	if (!found) return {
		ok: false,
		reason: "unknown-pet",
		message: "没有这只桌宠：" + petId
	};
	return {
		ok: true,
		petId,
		entry: found.entry,
		conf: found.conf
	};
}
function decideBroadcast(args) {
	const { cfg, requested, memeDirs } = args;
	const text = normalizeBroadcastText(args.text);
	if (!text) return {
		ok: false,
		reason: "bad-request",
		message: "text 为空"
	};
	const who = resolvePetId(cfg, requested);
	if (!who.ok) return {
		ok: false,
		reason: who.reason,
		message: who.message
	};
	const petId = who.petId;
	const rawImage = typeof args.image === "string" ? args.image.trim() : "";
	const rawUrl = typeof args.url === "string" ? args.url.trim() : "";
	if (rawImage && rawUrl) return {
		ok: false,
		reason: "bad-request",
		message: "image 与 url 只能给一个"
	};
	if (!rawImage && !rawUrl) return {
		ok: true,
		petId,
		text,
		duration: args.duration,
		anim: args.anim
	};
	if (rawUrl) {
		const url = normalizeHttpUrl(rawUrl);
		if (url === null) return {
			ok: false,
			reason: "bad-request",
			message: "url 必须是 http/https 的完整地址"
		};
		return {
			ok: true,
			petId,
			text,
			url,
			duration: args.duration,
			anim: args.anim
		};
	}
	const hit = matchMeme(readMemePool(who.conf.memes, memeDirs(who.entry)), rawImage);
	if (!hit) return {
		ok: false,
		reason: "unknown-image",
		message: "配图不在表情包池内：" + rawImage
	};
	return {
		ok: true,
		petId,
		text,
		image: hit.name,
		duration: args.duration,
		anim: args.anim
	};
}
function decideBubbleClear(args) {
	const who = resolvePetId(args.cfg, args.requested);
	if (!who.ok) return {
		ok: false,
		reason: who.reason,
		message: who.message
	};
	return {
		ok: true,
		petId: who.petId
	};
}

//#endregion
//#region src/host/routes/interaction.ts
async function handleInteractionRoutes(deps, input) {
	const { configPaths, lock, lockBlocked, memeDirsFor, publishWhisper, requirePet, sleep, state, surfaceBlocked } = deps;
	const { body, method, rest, url } = input;
	if (rest === "lock" || rest === "lock/release") {
		const isRelease = rest === "lock/release";
		if (method !== "POST") return methodNotAllowed();
		let parsed;
		try {
			parsed = JSON.parse(body ?? "null");
		} catch {
			return invalidJson();
		}
		const o = parsed && typeof parsed === "object" ? parsed : {};
		try {
			const who = requirePet(url.searchParams, () => readAllConfig(configPaths), { surface: !isRelease });
			if (!who.ok) return who.res;
			const petId = who.petId;
			if (isRelease) {
				const d$1 = lock.release({
					petId,
					lockId: o.lockId,
					force: o.force
				});
				if (!d$1.ok) return failResult(d$1.reason, d$1.message, d$1.reason === "lock-lost" ? { cause: d$1.cause } : void 0);
				return okResult({ ok: true });
			}
			const d = lock.acquire({
				petId,
				lockId: o.lockId,
				ttl: o.ttl
			});
			if (!d.ok) {
				const extra = {};
				if (d.reason === "locked") extra.expiresAt = d.expiresAt;
				if (d.reason === "lock-lost") extra.cause = d.cause;
				return failResult(d.reason, d.message, extra);
			}
			sleep.wake(petId);
			return okResult({
				ok: true,
				lockId: d.lockId,
				petId: d.petId,
				expiresAt: d.expiresAt
			});
		} catch (e) {
			return failResult("generate-error", e instanceof Error ? e.message : String(e));
		}
	}
	if (rest === "whisper") {
		if (method !== "POST") return methodNotAllowed();
		try {
			const who = requirePet(url.searchParams, () => readAllConfig(configPaths), { surface: true });
			if (!who.ok) return who.res;
			const want = normalizeSurface(url.searchParams.get("surface"));
			const r = await publishWhisper(who.petId, url.searchParams.get("image") ?? void 0, want === null ? void 0 : voiceTargetOfSurface(want));
			if (r.ok) return okResult({
				ok: true,
				text: r.text,
				...r.image ? { image: r.image } : {}
			});
			return failResult(r.reason, r.message ?? "生成失败");
		} catch (e) {
			return failResult("generate-error", e instanceof Error ? e.message : String(e));
		}
	}
	if (rest === "broadcast") {
		if (method !== "POST") return methodNotAllowed();
		let parsed;
		try {
			parsed = JSON.parse(body ?? "null");
		} catch {
			return invalidJson();
		}
		const o = parsed && typeof parsed === "object" ? parsed : {};
		if (!normalizeBroadcastText(o.text)) return failResult("bad-request", "text 为空");
		const duration = normalizeBroadcastDuration(o.duration);
		if (duration === null) return failResult("bad-request", "duration 必须是 ≥0 的有限数字（毫秒）");
		const anim = normalizeBroadcastAnim(o.anim);
		try {
			const cfg = readAllConfig(configPaths);
			const d = decideBroadcast({
				cfg,
				requested: String(url.searchParams.get("pet") ?? ""),
				text: o.text,
				image: o.image,
				url: o.url,
				duration,
				anim,
				memeDirs: memeDirsFor
			});
			if (!d.ok) return failResult(d.reason, d.message);
			const noSurface = surfaceBlocked(cfg, d.petId, url.searchParams);
			if (noSurface) return noSurface;
			const blocked = lockBlocked(d.petId, url.searchParams);
			if (blocked) return blocked;
			const pic = d.url !== void 0 ? { url: d.url } : d.image !== void 0 ? { image: d.image } : {};
			const want = normalizeSurface(url.searchParams.get("surface"));
			const voiceTo = want === null ? void 0 : voiceTargetOfSurface(want);
			state.writePet(d.petId, "say", {
				text: d.text,
				...pic,
				duration: d.duration,
				anim: d.anim,
				...voiceTo ? { voiceTo } : {}
			});
			return okResult({ ok: true });
		} catch (e) {
			return failResult("generate-error", e instanceof Error ? e.message : String(e));
		}
	}
	if (rest === "bubble/clear") {
		if (method !== "POST") return methodNotAllowed();
		try {
			const cfg = readAllConfig(configPaths);
			const d = decideBubbleClear({
				cfg,
				requested: String(url.searchParams.get("pet") ?? "")
			});
			if (!d.ok) return failResult(d.reason, d.message);
			const noSurface = surfaceBlocked(cfg, d.petId, url.searchParams);
			if (noSurface) return noSurface;
			const blocked = lockBlocked(d.petId, url.searchParams);
			if (blocked) return blocked;
			state.writePet(d.petId, "say", { clear: true });
			return okResult({ ok: true });
		} catch (e) {
			return failResult("generate-error", e instanceof Error ? e.message : String(e));
		}
	}
	return void 0;
}

//#endregion
//#region src/host/routes/menu.ts
async function handleMenuRoutes(deps, input) {
	const { menuRegistry, state } = deps;
	const { body, method, rest, url } = input;
	if (rest === "menu/item") {
		if (method === "DELETE") {
			const result$1 = menuRegistry.clear(url.searchParams.get("owner") ?? "");
			if (!result$1.ok) return failResult(result$1.reason, result$1.message);
			state.writeSection("menu", { items: menuRegistry.snapshot() });
			return okResult({
				ok: true,
				removed: result$1.removed
			});
		}
		if (method !== "POST") return methodNotAllowed();
		let parsed;
		try {
			parsed = JSON.parse(body ?? "");
		} catch {
			return invalidJson();
		}
		const result = menuRegistry.register(parsed);
		if (!result.ok) return failResult(result.reason, result.message);
		state.writeSection("menu", { items: menuRegistry.snapshot() });
		return okResult({ ok: true });
	}
	if (rest === "menu/events") {
		if (method !== "GET") return methodNotAllowed();
		const owner = url.searchParams.get("owner") ?? "";
		const rawWait = Number(url.searchParams.get("wait") ?? "0");
		const waitMs = Number.isFinite(rawWait) && rawWait > 0 ? Math.min(rawWait, MENU_WAIT_MAX_MS) : 0;
		const events = await menuRegistry.poll(owner, waitMs);
		if (events === null) return failResult("unknown-owner", "这个 owner 没有注册，重新注册即可");
		return okResult({
			ok: true,
			events
		});
	}
	if (rest === "menu/click") {
		if (method !== "POST") return methodNotAllowed();
		let parsed;
		try {
			parsed = JSON.parse(body ?? "");
		} catch {
			return invalidJson();
		}
		return okResult(menuRegistry.click(parsed));
	}
	return void 0;
}

//#endregion
//#region src/host/motion-cue.ts
const POSITION_MODES = [
	"instant",
	"spring",
	"line"
];
/** 夹到 0~1：归一化坐标的合法范围，越界夹取而不是拒绝（响应里回的就是夹取后的值）。 */
const clamp01 = (v) => Math.min(1, Math.max(0, v));
/** 有限数字收窄：字符串、布尔、NaN、Infinity 一律不算（配置里也这么判）。 */
const finite = (v) => typeof v === "number" && Number.isFinite(v) ? v : null;
/** 模式收窄：只认三个字面量（大小写、空白、非字符串一律不算），不认识返回 `null`。 */
const positionMode = (v) => typeof v === "string" && POSITION_MODES.includes(v) ? v : null;
/**
* 目标宠物解析（与 ./anim、./broadcast 同一口径）：`?pet=` 必填且必须真实存在。
* 两种失败分开报：没给 → `pet-required`；给了但配置里没有 → `unknown-pet`。
*/
function resolvePet(cfg, requested) {
	const petId = String(requested ?? "").trim();
	if (!petId) return {
		ok: false,
		reason: "pet-required",
		message: "pet 必填：要指定操作哪只桌宠"
	};
	if (!flattenPetList(cfg).some((p) => String(p.id) === petId)) return {
		ok: false,
		reason: "unknown-pet",
		message: "没有这只桌宠：" + petId
	};
	return {
		ok: true,
		petId
	};
}
function decidePosition(args) {
	const x = finite(args.x);
	if (x === null) return {
		ok: false,
		reason: "bad-request",
		message: "x 必须是有限数字"
	};
	const y = finite(args.y);
	if (y === null) return {
		ok: false,
		reason: "bad-request",
		message: "y 必须是有限数字"
	};
	const mode = positionMode(args.mode);
	if (mode === null) return {
		ok: false,
		reason: "bad-request",
		message: "mode 必须是 instant / spring / line"
	};
	let duration = null;
	if (mode === "line") {
		const d = finite(args.duration);
		if (d === null || d < 0) return {
			ok: false,
			reason: "bad-request",
			message: "line 模式的 duration 必须是非负有限数字（毫秒）"
		};
		duration = d;
	}
	const pet = resolvePet(args.cfg, args.requested);
	if (!pet.ok) return pet;
	return {
		ok: true,
		petId: pet.petId,
		x: clamp01(x),
		y: clamp01(y),
		mode,
		duration
	};
}
const positionLeafData = (d) => d.duration === null ? {
	x: d.x,
	y: d.y,
	mode: d.mode
} : {
	x: d.x,
	y: d.y,
	mode: d.mode,
	duration: d.duration
};
function decideThrow(args) {
	const angle = finite(args.angle);
	if (angle === null) return {
		ok: false,
		reason: "bad-request",
		message: "angle 必须是有限数字"
	};
	const power = finite(args.power);
	if (power === null || power <= 0) return {
		ok: false,
		reason: "bad-request",
		message: "power 必须是大于 0 的有限数字"
	};
	const pet = resolvePet(args.cfg, args.requested);
	if (!pet.ok) return pet;
	return {
		ok: true,
		petId: pet.petId,
		angle,
		power
	};
}

//#endregion
//#region src/host/pose.ts
function normalizePoseInput(raw) {
	const o = raw && typeof raw === "object" ? raw : null;
	if (!o) return {
		ok: false,
		reason: "bad-request",
		message: "请求体必须是对象：{ x, y, facing }"
	};
	if (typeof o.x !== "number" || !Number.isFinite(o.x)) return {
		ok: false,
		reason: "bad-request",
		message: "x 必须是有限数字（归一化横坐标）"
	};
	if (typeof o.y !== "number" || !Number.isFinite(o.y)) return {
		ok: false,
		reason: "bad-request",
		message: "y 必须是有限数字（归一化纵坐标）"
	};
	if (o.facing !== "left" && o.facing !== "right") return {
		ok: false,
		reason: "bad-request",
		message: "facing 必须是 left / right"
	};
	return {
		ok: true,
		pose: {
			x: o.x,
			y: o.y,
			facing: o.facing
		}
	};
}
var PoseStore = class {
	constructor(opts) {
		this.byPet = new Map();
		this.now = opts?.now ?? Date.now;
	}
	/** 覆盖一只宠物的实况，返回落定的快照。 */
	set(petId, pose) {
		const snap = {
			x: pose.x,
			y: pose.y,
			facing: pose.facing,
			updatedAt: this.now()
		};
		this.byPet.set(petId, snap);
		return snap;
	}
	/** 读最近一次实况；从没上报过返回 undefined（路由回 pose-unavailable）。 */
	get(petId) {
		return this.byPet.get(petId);
	}
	/** 当前快照数（测试 / 观测用）。 */
	count() {
		return this.byPet.size;
	}
};

//#endregion
//#region src/host/routes/motion.ts
async function handleMotionRoutes(deps, input) {
	const { configPaths, lockBlocked, playback, pose, requirePet, state, surfaceBlocked } = deps;
	const { body, method, rest, url } = input;
	if (rest === "anim") {
		if (method !== "POST") return methodNotAllowed();
		let parsed;
		try {
			parsed = JSON.parse(body ?? "null");
		} catch {
			return invalidJson();
		}
		const o = parsed && typeof parsed === "object" ? parsed : {};
		try {
			const cfg = readAllConfig(configPaths);
			const d = decideAnim({
				cfg,
				requested: String(url.searchParams.get("pet") ?? ""),
				name: o.name,
				url: o.url,
				facing: o.facing
			});
			if (!d.ok) return failResult(d.reason, d.message);
			const noSurface = surfaceBlocked(cfg, d.petId, url.searchParams);
			if (noSurface) return noSurface;
			const blocked = lockBlocked(d.petId, url.searchParams);
			if (blocked) return blocked;
			const record = playback.create(d.petId, d.url ?? d.name ?? "");
			state.writePet(d.petId, "anim", {
				...d.url !== void 0 ? { url: d.url } : { name: d.name },
				playbackId: record.playbackId,
				...d.facing === void 0 ? {} : { facing: d.facing }
			});
			return okResult({
				ok: true,
				playbackId: record.playbackId
			});
		} catch (e) {
			return failResult("generate-error", e instanceof Error ? e.message : String(e));
		}
	}
	if (rest === "position" || rest === "throw") {
		const isPosition = rest === "position";
		if (method !== "POST") return methodNotAllowed();
		let parsed;
		try {
			parsed = JSON.parse(body ?? "null");
		} catch {
			return invalidJson();
		}
		const o = parsed && typeof parsed === "object" ? parsed : {};
		try {
			const cfg = readAllConfig(configPaths);
			const requested = String(url.searchParams.get("pet") ?? "");
			if (isPosition) {
				const d$1 = decidePosition({
					cfg,
					requested,
					x: o.x,
					y: o.y,
					mode: o.mode,
					duration: o.duration
				});
				if (!d$1.ok) return failResult(d$1.reason, d$1.message);
				const noSurface$1 = surfaceBlocked(cfg, d$1.petId, url.searchParams);
				if (noSurface$1) return noSurface$1;
				const blocked$1 = lockBlocked(d$1.petId, url.searchParams);
				if (blocked$1) return blocked$1;
				state.writePet(d$1.petId, "position", positionLeafData(d$1));
				return okResult({
					ok: true,
					x: d$1.x,
					y: d$1.y
				});
			}
			const d = decideThrow({
				cfg,
				requested,
				angle: o.angle,
				power: o.power
			});
			if (!d.ok) return failResult(d.reason, d.message);
			const noSurface = surfaceBlocked(cfg, d.petId, url.searchParams);
			if (noSurface) return noSurface;
			const blocked = lockBlocked(d.petId, url.searchParams);
			if (blocked) return blocked;
			state.writePet(d.petId, "throw", {
				angle: d.angle,
				power: d.power
			});
			return okResult({ ok: true });
		} catch (e) {
			return failResult("generate-error", e instanceof Error ? e.message : String(e));
		}
	}
	if (rest === "pose" || rest === "pose/report") {
		const isReport = rest === "pose/report";
		if (isReport && method !== "POST") return methodNotAllowed();
		if (!isReport && method !== "GET") return methodNotAllowed();
		let parsedPose;
		if (isReport) try {
			parsedPose = JSON.parse(body ?? "null");
		} catch {
			return invalidJson();
		}
		try {
			const who = requirePet(url.searchParams, () => readAllConfig(configPaths));
			if (!who.ok) return who.res;
			if (isReport) {
				const p = normalizePoseInput(parsedPose);
				if (!p.ok) return failResult(p.reason, p.message);
				pose.set(who.petId, p.pose);
				return okResult({ ok: true });
			}
			const display = String(who.pet.display ?? "");
			if (!displayCovers("desktop", display)) return failResult("pet-not-displayed", who.petId + " 的显示模式是 " + display + "；桌面端实况只对 display 含 desktop 的宠物有", { display });
			const snap = pose.get(who.petId);
			if (snap === void 0) return failResult("pose-unavailable", "还没收到过这只宠物的桌面端实况（桌面端没起来，或刚重启还没来得及上报）");
			return okResult({
				ok: true,
				petId: who.petId,
				...snap
			});
		} catch (e) {
			return failResult("generate-error", e instanceof Error ? e.message : String(e));
		}
	}
	return void 0;
}

//#endregion
//#region src/host/routes/playback.ts
async function handlePlaybackRoutes(deps, input) {
	const { playback } = deps;
	const { body, method, rest, signal, url } = input;
	const playbackPath = rest === "playback" || rest.startsWith("playback/") ? parsePlaybackPath(rest) : void 0;
	if (playbackPath) {
		const playbackId = playbackPath.playbackId;
		if (playbackPath.isReport) {
			if (method !== "POST") return methodNotAllowed();
			let reported;
			try {
				reported = JSON.parse(body ?? "null");
			} catch {
				return invalidJson();
			}
			const o = reported && typeof reported === "object" ? reported : {};
			const outcome = playback.report(playbackId, o.status, o.reason);
			if (outcome === "unknown") return failResult("unknown-playback", "unknown playback");
			if (outcome === "invalid") return failResult("bad-request", "invalid status");
			return okResult({ ok: true });
		}
		if (method !== "GET") return methodNotAllowed();
		const record = playback.get(playbackId);
		if (!record) return failResult("unknown-playback", "unknown playback");
		const parsed = parseWaitQuery(url.searchParams.get("wait"), url.searchParams.get("timeout"));
		if (parsed.kind === "error") return failResult("bad-request", parsed.error);
		if (parsed.kind === "none") return okResult({
			...record,
			matched: false
		});
		const { wait: waitList, timeoutMs } = parsed;
		if (waitList.includes(record.status)) return okResult({
			...record,
			matched: true
		});
		return await new Promise((resolveWait) => {
			let settled = false;
			/** 收尾：只认第一次（唤醒 / 超时 / 取消 / 调用方断开 都可能先后到达） */
			const settle = (result) => {
				if (settled) return;
				settled = true;
				resolveWait(result);
			};
			const cancel = playback.wait({
				playbackId,
				wait: waitList,
				timeoutMs,
				onWake: (r, matched) => settle(okResult({
					...r,
					matched
				}))
			});
			if (cancel === void 0) {
				settle(failResult("unknown-playback", "unknown playback"));
				return;
			}
			const onAbort = () => {
				cancel();
				settle({ kind: "none" });
			};
			if (signal?.aborted) {
				onAbort();
				return;
			}
			signal?.addEventListener("abort", onAbort, { once: true });
		});
	}
	return void 0;
}

//#endregion
//#region src/host/routes/state.ts
async function handleStateRoutes(deps, input) {
	const { EXTERNAL_WORK_SESSION, ctx, nextExternalWorkSeq, publishWorkStatus, state, workStatus } = deps;
	const { body, method, rest, signal, url } = input;
	if (rest === "models") {
		if (method !== "GET") return methodNotAllowed();
		try {
			const llm = ctx.llm;
			const named = (id, name) => {
				const pid = String(id ?? "");
				return {
					id: pid,
					name: String(name ?? "") || pid
				};
			};
			let providers = (typeof llm?.listProviders === "function" ? llm.listProviders() : []).map((p) => named(p?.id, p?.name));
			if (providers.length === 0 && typeof llm?.listConfigurableProviders === "function") providers = llm.listConfigurableProviders().map((p) => named(p?.provider, p?.displayName));
			providers = providers.filter((p) => p.id);
			const catalog = await Promise.all(providers.map(async (p) => {
				let models = [];
				try {
					const list = await llm?.listModels?.(p.id);
					models = (Array.isArray(list) ? list : []).map((m) => named(m?.id, m?.name)).filter((m) => m.id);
				} catch {}
				return {
					...p,
					models
				};
			}));
			return okResult({ providers: catalog });
		} catch (e) {
			return failResult("generate-error", e instanceof Error ? e.message : String(e));
		}
	}
	if (rest === "state") {
		if (method !== "GET") return methodNotAllowed();
		const headers = { "cache-control": "no-cache, no-store" };
		const parsed = parseStateWaitQuery(url.searchParams.get("since"), url.searchParams.get("timeout"));
		if (parsed.kind === "error") return failResult("bad-request", parsed.error);
		const current$2 = state.read();
		if (parsed.kind === "none" || current$2.counter !== parsed.since) return okResult(current$2, headers);
		const since = parsed.since;
		return await new Promise((resolveWait) => {
			let settled = false;
			/** 收尾：只认第一次（唤醒 / 超时 / 取消 / 调用方断开 都可能先后到达） */
			const settle = (result) => {
				if (settled) return;
				settled = true;
				resolveWait(result);
			};
			const cancel = state.wait({
				since,
				timeoutMs: parsed.timeoutMs,
				onWake: () => settle(okResult(state.read(), headers))
			});
			const onAbort = () => {
				cancel();
				settle({ kind: "none" });
			};
			if (signal?.aborted) {
				onAbort();
				return;
			}
			signal?.addEventListener("abort", onAbort, { once: true });
		});
	}
	if (rest === "work-status") {
		if (method === "DELETE") {
			if (workStatus.clear(EXTERNAL_WORK_SESSION)) publishWorkStatus();
			return {
				kind: "text",
				status: 204,
				body: ""
			};
		}
		if (method !== "POST") return methodNotAllowed();
		if (Buffer.byteLength(body ?? "", "utf8") > 8 * 1024) return payloadTooLarge("body too large");
		let parsed;
		try {
			parsed = JSON.parse(body ?? "");
		} catch {
			return invalidJson();
		}
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return invalidJson();
		const payload = parsed;
		const state$1 = payload.state;
		if (typeof state$1 !== "string" || !HOST_WORK_STATUS_STATES.includes(state$1)) return failResult("bad-request", `state 必须是 ${HOST_WORK_STATUS_STATES.join(" / ")} 之一`);
		let task;
		if (Object.prototype.hasOwnProperty.call(payload, "task")) if (payload.task === null) task = null;
		else if (typeof payload.task === "string") {
			const trimmed = payload.task.trim();
			if (trimmed === "") task = null;
			else if (Array.from(trimmed).length > TASK_TEXT_MAX) return failResult("bad-request", `task too long (max ${TASK_TEXT_MAX} code points)`);
			else task = trimmed;
		} else return failResult("bad-request", "invalid task");
		workStatus.setState(EXTERNAL_WORK_SESSION, state$1, nextExternalWorkSeq());
		if (task !== void 0) workStatus.setTask(EXTERNAL_WORK_SESSION, task);
		publishWorkStatus();
		return okResult({
			state: workStatus.stateOf(EXTERNAL_WORK_SESSION) ?? state$1,
			task: workStatus.taskOf(EXTERNAL_WORK_SESSION)
		});
	}
	return void 0;
}

//#endregion
//#region src/host/sleep.ts
/** 文案池收窄：非数组、非字符串项一律丢弃（配置已校验，这里只防手工改坏的文件）。 */
function textPool(value) {
	return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item !== "") : [];
}
function pickSleepText(pool) {
	return pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : void 0;
}
function sleepTextsOf(conf) {
	return {
		start: textPool(conf.sleepStartTexts),
		end: textPool(conf.sleepEndTexts),
		refuse: textPool(conf.sleepRefuseTexts)
	};
}
/** 池子收窄：非数组、非字符串项一律丢弃（配置已校验，这里只防手工改坏的文件）。 */
function strings(value) {
	return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item !== "") : [];
}
function pickSleepNames(animations, roll = Math.random) {
	const conf = animations && typeof animations === "object" ? animations : {};
	const sets = Array.isArray(conf.sleep) ? conf.sleep : [];
	const usable = [];
	for (const set of sets) {
		if (!set || typeof set !== "object") continue;
		const entry = set;
		const start = strings(entry.start);
		const loop = strings(entry.loop);
		const end = strings(entry.end);
		if (!start.length || !loop.length || !end.length) continue;
		usable.push({
			start: start[Math.floor(roll() * start.length)],
			loop: loop[Math.floor(roll() * loop.length)],
			end: end[Math.floor(roll() * end.length)]
		});
	}
	if (!usable.length) return null;
	return usable[Math.floor(roll() * usable.length)];
}
var SleepStore = class {
	constructor(opts) {
		this.sets = new Map();
		this.onChange = opts?.onChange ?? (() => {});
	}
	/** 这只宠物此刻是否在睡。 */
	sleeping(petId) {
		return this.sets.has(petId);
	}
	/** 本次睡觉挑中的那套名字；没睡时 null。 */
	setOf(petId) {
		return this.sets.get(petId) ?? null;
	}
	/**
	* 进睡。已经在睡时保持原套、不重写叶子——重复调用（接口被连点、命令与菜单同时触发）
	* 不该把动画从头放一遍。
	* @returns 这次是否真的进入了睡觉状态。
	*/
	enter(petId, set) {
		if (this.sets.has(petId)) return false;
		this.sets.set(petId, set);
		this.onChange(petId, {
			sleeping: true,
			...set
		});
		return true;
	}
	/**
	* 醒来。
	* @returns 这次是否真的从睡眠状态退出（没在睡 = 幂等空操作）。
	*/
	wake(petId) {
		if (!this.sets.delete(petId)) return false;
		this.onChange(petId, { sleeping: false });
		return true;
	}
	/** 全部唤醒（插件卸载 / 桌面 Helper 重启路径）：否则渲染端要一直停在睡姿。 */
	wakeAll() {
		for (const petId of [...this.sets.keys()]) this.wake(petId);
	}
	/** 当前是否有任意宠物在睡（余额全局拉取据此决定要不要整拍跳过）。 */
	anySleeping() {
		return this.sets.size > 0;
	}
	/** 在睡的宠物 id（测试与日志用；顺序不保证）。 */
	ids() {
		return [...this.sets.keys()];
	}
};

//#endregion
//#region src/host/routes/sleep.ts
async function handleSleepRoutes(deps, input) {
	const { configPaths, lock, requirePet, sleep, state } = deps;
	const { method, rest, url } = input;
	const isSleep = rest === "sleep";
	const isWake = rest === "wake";
	if (!isSleep && !isWake) return void 0;
	if (method !== "POST") return methodNotAllowed();
	try {
		const who = requirePet(url.searchParams, () => readAllConfig(configPaths));
		if (!who.ok) return who.res;
		const texts = sleepTextsOf(who.conf);
		if (rest === "wake") {
			const changed$1 = sleep.wake(who.petId);
			const text = pickSleepText(texts.end);
			if (text !== void 0) state.writePet(who.petId, "say", {
				text,
				anim: false
			});
			return okResult({
				ok: true,
				sleeping: false,
				changed: changed$1
			});
		}
		if (lock.locked(who.petId)) return failResult("locked", "这只桌宠正被占用，不能睡觉");
		const names = pickSleepNames(who.conf.animations);
		if (names === null) return failResult("no-sleep-animations", "这只宠物没有配置睡觉动画（animations.sleep）");
		const changed = sleep.enter(who.petId, names);
		if (changed) {
			const text = pickSleepText(texts.start);
			if (text !== void 0) state.writePet(who.petId, "say", {
				text,
				anim: false
			});
		}
		const active = sleep.setOf(who.petId) ?? names;
		return okResult({
			ok: true,
			sleeping: true,
			changed,
			start: active.start,
			loop: active.loop,
			end: active.end
		});
	} catch (e) {
		return failResult("generate-error", e instanceof Error ? e.message : String(e));
	}
}

//#endregion
//#region src/host/routes/todos.ts
/** 路径前缀：`todos` 或 `todos/<id>`。 */
const PREFIX = "todos";
/** Object.prototype.hasOwnProperty 的短别名：PATCH 要把「没传」与「传了 null」分开。 */
const has = (source, key) => Object.prototype.hasOwnProperty.call(source, key);
/** 解析请求体：不是 JSON 对象 → null。 */
function parseObjectBody(body) {
	if (body === void 0) return null;
	let parsed;
	try {
		parsed = JSON.parse(body);
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
	return parsed;
}
/**
* PATCH 的字段校验：出现的键逐个校验，任一非法整包拒绝。
*
* @param raw - 已解析的请求体。
* @returns 待写入的字段集合；没有可写字段时返回空对象。
*/
function readPatch(raw) {
	const patch = {};
	if (has(raw, "text")) {
		const text = normalizeTodoText(raw.text);
		if (text === null) return null;
		patch.text = text;
	}
	if (has(raw, "dueAt")) {
		const due = normalizeTodoDueAt(raw.dueAt);
		if (!due.ok) return null;
		patch.dueAt = due.value;
	}
	if (has(raw, "done")) {
		if (typeof raw.done !== "boolean") return null;
		patch.done = raw.done;
	}
	return patch;
}
async function handleTodoRoutes(deps, input) {
	const { body, method, rest } = input;
	if (rest !== PREFIX && !rest.startsWith(PREFIX + "/")) return void 0;
	const { log, todos } = deps;
	try {
		if (rest === "todos") {
			if (method === "GET") return okResult({
				ok: true,
				todos: await todos.list()
			});
			if (method !== "POST") return methodNotAllowed();
			if (Buffer.byteLength(body ?? "", "utf8") > TODO_BODY_MAX_BYTES) return payloadTooLarge();
			const raw = parseObjectBody(body);
			if (raw === null) return invalidJson();
			const text = normalizeTodoText(raw.text);
			if (text === null) return failResult("bad-request", `text 必须是非空字符串，最多 ${TODO_TEXT_MAX} 个字符`);
			const due = normalizeTodoDueAt(raw.dueAt);
			if (!due.ok) return failResult("bad-request", "dueAt 必须是毫秒时间戳或 null");
			return okResult({
				ok: true,
				todo: await todos.create({
					text,
					dueAt: due.value
				})
			});
		}
		const id = rest.slice(PREFIX.length + 1);
		if (id === "" || id.includes("/")) return failResult("bad-request", "todo id 不合法");
		if (method === "PATCH") {
			if (Buffer.byteLength(body ?? "", "utf8") > TODO_BODY_MAX_BYTES) return payloadTooLarge();
			const raw = parseObjectBody(body);
			if (raw === null) return invalidJson();
			const patch = readPatch(raw);
			if (patch === null) return failResult("bad-request", "text / dueAt / done 至少一个字段不合法");
			if (Object.keys(patch).length === 0) return failResult("bad-request", "没有可更新的字段");
			const todo = await todos.update(id, patch);
			if (todo === null) return failResult("todo-not-found", "没有这条待办");
			return okResult({
				ok: true,
				todo
			});
		}
		if (method === "DELETE") return okResult({
			ok: true,
			removed: await todos.remove(id)
		});
		return methodNotAllowed();
	} catch (error) {
		log.warn(`[dsh-pet] 待办读写失败：${error instanceof Error ? error.message : String(error)}`);
		return failResult("internal-error", "dsh-pet: 待办读写失败");
	}
}

//#endregion
//#region src/host/routes/voice.ts
async function handleVoiceRoutes(deps, input) {
	const { body, method, rest, signal } = input;
	if (rest === "voice/voices") {
		if (method !== "GET") return methodNotAllowed();
		return okResult({
			ok: true,
			voices: deps.voice.listVoices()
		});
	}
	if (rest === "voice/speak") {
		if (method !== "POST") return methodNotAllowed();
		let parsed;
		try {
			parsed = JSON.parse(body ?? "null");
		} catch {
			return invalidJson();
		}
		const result = await deps.voice.speak(parsed);
		if (!result.ok) return failResult(result.reason, result.message);
		return {
			kind: "file",
			file: result.file,
			contentType: "audio/mpeg"
		};
	}
	if (rest === "voice/hear") {
		if (method !== "POST") return methodNotAllowed();
		let parsed;
		try {
			parsed = JSON.parse(body ?? "null");
		} catch {
			return invalidJson();
		}
		const result = await deps.speech.hear(parsed, signal);
		if (!result.ok) return failResult(result.reason, result.message);
		return okResult({
			ok: true,
			text: result.text
		});
	}
	return void 0;
}

//#endregion
//#region src/host/routes/index.ts
/** 处理器顺序：越靠前越先匹配；素材兜底必须在末尾。 */
const HANDLERS = [
	handleConfigRoutes,
	handleDesktopRoutes,
	handleMenuRoutes,
	handleStateRoutes,
	handleBalanceRoutes,
	handleInteractionRoutes,
	handleMotionRoutes,
	handlePlaybackRoutes,
	handleSleepRoutes,
	handleChatRoutes,
	handleAttachmentRoutes,
	handleTodoRoutes,
	handleVoiceRoutes,
	handleAssetsRoutes
];
/**
* 睡觉期间要拒绝的端点：只列「打扰类」。
*
* 刻意用白名单而不是黑名单——新增端点默认放行，不会因为忘了排除而把维护动作（改显示位置、
* 重载配置）或拖拽链路（/position、/throw）一起锁死；反过来，漏列一个打扰端点只是它还能用，
* 不会造成「宠物叫不醒」。
*/
function sleepGated(rest, method) {
	if (rest === "chat") return method === "POST";
	if (rest === "todos") return method === "POST" || method === "DELETE";
	return rest === "anim" || rest === "whisper" || rest === "balance" || rest === "broadcast" || rest === "bubble/clear" || rest === "menu/click" || rest === "voice";
}
function createPetRouter(deps) {
	return async (url, rest, method, body, signal) => {
		if (sleepGated(rest, method)) {
			const petId = String(url.searchParams.get("pet") ?? "").trim();
			if (petId) {
				const blocked = deps.sleepBlocked(petId, url.searchParams);
				if (blocked) return blocked;
			}
		}
		for (const handle of HANDLERS) {
			const result = await handle(deps, {
				url,
				rest,
				method,
				body,
				signal
			});
			if (result !== void 0) return result;
		}
		return {
			kind: "text",
			status: 404,
			body: "dsh-pet: not found"
		};
	};
}

//#endregion
//#region src/host/plugin/http-route.ts
function createHttpRoute(deps) {
	let configQueue = Promise.resolve();
	/** 单次业务路由（HTTP 落盘与桌面 Helper 管道共用同一份实现）：输入 rawUrl + method + body 文本，
	*  返回 RouteResult，消费方各自落盘——业务逻辑只有一份，两端天然一致。
	*  signal 可选：调用方断开时中止挂起等待（只有 /playback 的 wait 分支会用到；管道侧不传）。 */
	const handlePetRoute = async (rawUrl, method, body, signal) => {
		const url = new URL(rawUrl, "http://localhost");
		const rest = decodeURIComponent(url.pathname.slice(ROUTE_SEGMENT.length + 1));
		const run$1 = () => dispatchPetRoute(url, rest, method, body, signal);
		const isConfigQueue = rest === "config" || (rest === "pet-display" || rest === "pet-config") && method === "POST";
		if (isConfigQueue) {
			const pending = configQueue.then(run$1, run$1);
			configQueue = pending.then(() => void 0, () => void 0);
			return pending;
		}
		return run$1();
	};
	const dispatchPetRoute = createPetRouter(deps);
	return { handlePetRoute };
}
function registerHttpRoute(ctx, handlePetRoute) {
	ctx.effect(() => ctx.webServer.register({
		kind: "prefix",
		path: ROUTE_SEGMENT,
		handler: async (req, res) => {
			const abort = new AbortController();
			const onClose = () => abort.abort();
			res.on("close", onClose);
			try {
				const readsBody = req.method === "PUT" || req.method === "POST" || req.method === "PATCH";
				const body = readsBody ? await readBody(req) : void 0;
				const result = await handlePetRoute(req.url ?? "/", req.method ?? "GET", body, abort.signal);
				res.off("close", onClose);
				if (result.kind === "json") sendJson$1(res, result.status, result.obj, result.headers);
				else if (result.kind === "text") sendText(res, result.status, result.body);
				else if (result.kind === "none") {} else sendFile(req, res, result.file, result.contentType);
			} catch (e) {
				res.off("close", onClose);
				if (!res.destroyed && !res.writableEnded) {
					const code = e.code;
					if (code === "body-too-large") sendJson$1(res, 413, failureBody("payload-too-large", "request body too large"));
					else if (code !== "client-aborted") {
						ctx.logger?.warn?.(`[dsh-pet] route failed: ${e instanceof Error ? e.message : String(e)}`);
						sendJson$1(res, 500, failureBody("internal-error", "dsh-pet: internal error"));
					}
				}
			}
		}
	}), `dsh-pet: ${ROUTE_SEGMENT} asset route`);
}

//#endregion
//#region src/host/plugin/lifecycle.ts
function registerLifecycle(deps) {
	const { ctx, lock, markDisposed, playback, state, stopDownloadSlotTimer, stopHelper, stopWorkStatusFlush } = deps;
	ctx.effect(() => () => {
		markDisposed();
		stopWorkStatusFlush();
		stopDownloadSlotTimer();
		lock.releaseAll();
		playback.cancelAll();
		state.cancelAll();
		stopHelper("dsh-host-stop");
	});
}

//#endregion
//#region src/host/plugin/command-chat.ts
function registerChatCommand(deps) {
	const { ctx, chatWithPet, log, publishWhisper, resolveActivePetId, sleep, sleepRefusalText } = deps;
	ctx.effect(() => ctx.commands.register({
		name: "chat",
		description: "与桌宠对话：留空 = 碎碎念一句；输入消息 = 正常对话",
		input: { hint: "[消息]（留空 = 碎碎念）" },
		handler: ({ rawInput }) => {
			const petId = resolveActivePetId();
			if (!petId) return {
				kind: "error",
				text: "没有可交互的桌宠"
			};
			if (sleep.sleeping(petId)) return {
				kind: "error",
				text: sleepRefusalText(petId)
			};
			const text = rawInput.trim();
			if (!text) {
				publishWhisper(petId).catch((e) => log.warn("[dsh-pet] 碎碎念异常：" + (e instanceof Error ? e.message : String(e))));
				return {
					kind: "success",
					text: "已让桌宠碎碎念一句"
				};
			}
			if (text.length > 2e3) return {
				kind: "error",
				text: "消息过长（限 2000 字）"
			};
			chatWithPet(petId, text).then((r) => {
				if (!r.ok) log.warn("[dsh-pet] 对话失败 reason=" + r.reason + (r.message ? " " + r.message : ""));
			}).catch((e) => log.warn("[dsh-pet] 对话异常：" + (e instanceof Error ? e.message : String(e))));
			return {
				kind: "success",
				text: "已发送，桌宠马上回应"
			};
		}
	}), "dsh-pet: /chat command");
}

//#endregion
//#region src/host/plugin/command-pet.ts
function registerPetCommand(deps) {
	const { ctx, effectivePetList, petDisplayName, resolveActivePetId, setActivePetId } = deps;
	ctx.effect(() => ctx.commands.register({
		name: "pet",
		description: "选择桌宠（/chat 对话的目标；支持选择框或手输 id/名字）",
		input: { hint: "[宠物 id 或名字]（留空查看当前）" },
		handler: ({ rawInput }) => {
			const arg = rawInput.trim();
			let eff;
			try {
				eff = effectivePetList();
			} catch {
				eff = [];
			}
			if (!arg) {
				const cur = resolveActivePetId();
				const found = eff.find((p) => String(p.id) === cur);
				return {
					kind: "success",
					text: "当前桌宠：" + (found ? petDisplayName(found) : cur || "（无可交互桌宠）")
				};
			}
			const byId = eff.find((p) => String(p.id) === arg);
			if (byId) {
				setActivePetId(String(byId.id));
				return {
					kind: "success",
					text: "已选择桌宠：" + petDisplayName(byId)
				};
			}
			const byName = eff.filter((p) => petDisplayName(p) === arg);
			if (byName.length === 1) {
				setActivePetId(String(byName[0].id));
				return {
					kind: "success",
					text: "已选择桌宠：" + petDisplayName(byName[0])
				};
			}
			if (byName.length > 1) return {
				kind: "error",
				text: "「" + arg + "」有 " + byName.length + " 只桌宠（id：" + byName.map((p) => String(p.id)).join("、") + "），请用 id 指定"
			};
			return {
				kind: "error",
				text: "找不到桌宠「" + arg + "」（id 或名字都行；/pet 回车可打开选择框）"
			};
		}
	}), "dsh-pet: /pet command");
}

//#endregion
//#region src/host/whisper-policy.ts
function automaticWhisperSchedule(policy, petEnabled, configuredPeriodSec) {
	if (!policy) return {
		enabled: petEnabled,
		periodSec: configuredPeriodSec
	};
	const period = policy.whisperIntervalSec();
	return {
		enabled: petEnabled && policy.isReady() && policy.canWhisper(),
		periodSec: Number.isFinite(period) ? Math.max(60, period) : 300
	};
}

//#endregion
//#region src/host/plugin/loops.ts
/** 梦话周期的兜底值（秒）：配置里 eventsRefreshSec.sleepTalk 缺失/非法时用它。 */
const SLEEP_TALK_DEFAULT_SEC = 60;
function registerLoops(deps) {
	const { ctx, balancePeriodSec, configPaths, lastWhisperAt, lock, log, publishWhisper, publishSleepTalk, refreshBalance, sleep, standaloneAiPolicy, whisperPeriodSec } = deps;
	ctx.effect(() => {
		let disposed = false;
		let timer = null;
		function arm(sec) {
			if (disposed) return;
			timer = setTimeout(() => void tick(), Math.max(1e3, sec * 1e3));
		}
		async function tick() {
			let sec;
			try {
				const cfg = readAllConfig(configPaths);
				sec = balancePeriodSec(cfg);
				const pets = flattenPetList(cfg);
				if (pets.some((p) => p.balanceEnabled === true && !sleep.sleeping(String(p.id ?? "")))) await refreshBalance();
				else log.info("[dsh-pet] 余额周期跳过：没有醒着且启用余额的宠物");
			} catch (e) {
				log.warn("[dsh-pet] 余额周期读配置失败，周期刷新已停止（重启 DSH 后恢复）：" + (e instanceof Error ? e.message : String(e)));
				return;
			}
			arm(sec);
		}
		tick();
		return () => {
			disposed = true;
			if (timer !== null) clearTimeout(timer);
		};
	}, "dsh-pet: balance poll");
	ctx.effect(() => {
		let disposed = false;
		let timer = null;
		function arm(sec) {
			if (disposed) return;
			timer = setTimeout(() => void tick(), Math.max(1e3, sec * 1e3));
		}
		function tick() {
			let next = 300;
			try {
				const cfg = readAllConfig(configPaths);
				const now = Date.now();
				let min = Infinity;
				let checked = 0;
				let due = 0;
				let notDue = 0;
				const skipped = [];
				for (const pet of flattenPetList(cfg)) {
					const petId = String(pet.id ?? "");
					if (!petId) continue;
					const found = findPetInstance(cfg, petId);
					if (!found) continue;
					checked += 1;
					const schedule = automaticWhisperSchedule(standaloneAiPolicy(), pet.whisperEnabled === true, whisperPeriodSec(found.conf));
					if (!schedule.enabled) {
						skipped.push(petId + ": " + (pet.whisperEnabled === true ? "独立模式未授权自动碎碎念" : "whisperEnabled=false"));
						continue;
					}
					const display = String(pet.display ?? "");
					if (!isDisplayed(display)) {
						skipped.push(petId + ": display=none");
						continue;
					}
					const sec = schedule.periodSec;
					min = Math.min(min, sec);
					if (now - (lastWhisperAt.get(petId) ?? 0) < sec * 1e3) {
						notDue += 1;
						continue;
					}
					if (lock.locked(petId)) {
						skipped.push(petId + ": 占用锁跳过");
						continue;
					}
					if (sleep.sleeping(petId)) {
						skipped.push(petId + ": 睡觉中");
						continue;
					}
					due += 1;
					log.info(`[dsh-pet] 碎碎念到点 pet=${petId}（周期 ${sec}s），开始生成`);
					lastWhisperAt.set(petId, now);
					publishWhisper(petId, void 0, void 0, "whisper").catch(() => {});
				}
				if (Number.isFinite(min)) next = min;
				log.info(`[dsh-pet] 碎碎念调度：检查 ${checked} 只 → 到点 ${due}、未到点 ${notDue}、跳过 ${skipped.length}` + (skipped.length > 0 ? `（${skipped.join("；")}）` : "") + `；下一拍 ${next}s`);
			} catch (e) {
				log.warn("[dsh-pet] 碎碎念调度读配置失败，自动碎碎念已停止（重启 DSH 后恢复）：" + (e instanceof Error ? e.message : String(e)));
				return;
			}
			arm(next);
		}
		tick();
		return () => {
			disposed = true;
			if (timer !== null) clearTimeout(timer);
		};
	}, "dsh-pet: whisper poll");
	ctx.effect(() => {
		let disposed = false;
		let timer = null;
		/** petId → 上一次说梦话的时刻；醒来不清，下次睡着时按周期自然接着算。 */
		const lastTalkAt = new Map();
		function arm(sec) {
			if (disposed) return;
			timer = setTimeout(() => void tick(), Math.max(1e3, sec * 1e3));
		}
		function tick() {
			let next = SLEEP_TALK_DEFAULT_SEC;
			try {
				const cfg = readAllConfig(configPaths);
				const now = Date.now();
				let min = Infinity;
				for (const petId of sleep.ids()) {
					const found = findPetInstance(cfg, petId);
					if (!found) continue;
					const sec = sleepTalkPeriodSec(found.conf);
					min = Math.min(min, sec);
					if (now - (lastTalkAt.get(petId) ?? 0) < sec * 1e3) continue;
					lastTalkAt.set(petId, now);
					publishSleepTalk(petId).catch(() => {});
				}
				if (Number.isFinite(min)) next = min;
			} catch (e) {
				log.warn("[dsh-pet] 梦话调度读配置失败，说梦话已停止（重启 DSH 后恢复）：" + (e instanceof Error ? e.message : String(e)));
				return;
			}
			arm(next);
		}
		tick();
		return () => {
			disposed = true;
			if (timer !== null) clearTimeout(timer);
		};
	}, "dsh-pet: sleep talk poll");
}
/** 梦话周期（秒）：条目级 eventsRefreshSec.sleepTalk，读不到按 60 兜底（与配置注释同一口径）。 */
function sleepTalkPeriodSec(conf) {
	const table = conf.eventsRefreshSec;
	const sec = Number(table?.sleepTalk);
	return Number.isFinite(sec) && sec > 0 ? sec : SLEEP_TALK_DEFAULT_SEC;
}

//#endregion
//#region src/host/plugin/command-balance.ts
function registerBalanceCommand(deps) {
	const { ctx, effectivePetList, refreshBalance, sleep, sleepRefusalText } = deps;
	ctx.effect(() => ctx.commands.register({
		name: "balance",
		description: "手动触发桌宠余额显示（立即弹出余额气泡）",
		handler: () => {
			const visible = effectivePetList().filter((pet) => String(pet.display ?? "") !== "none");
			if (visible.length > 0 && visible.every((pet) => sleep.sleeping(String(pet.id ?? "")))) return {
				kind: "error",
				text: sleepRefusalText(String(visible[0].id ?? ""))
			};
			refreshBalance(true);
			return {
				kind: "success",
				text: "已触发桌宠余额显示"
			};
		}
	}), "dsh-pet: /balance command");
}

//#endregion
//#region src/host/tool-detail/target.ts
function str(value) {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed === "" ? null : trimmed;
}
function firstStr(args, keys) {
	for (const key of keys) {
		const value = str(args[key]);
		if (value !== null) return value;
	}
	return null;
}
function fileTarget(args) {
	return firstStr(args, [
		"file_path",
		"filePath",
		"path"
	]);
}
function urlHost(args) {
	const raw = str(args.url);
	if (raw === null) return null;
	try {
		const host = new URL(raw).host;
		return host === "" ? null : host;
	} catch {
		const rest = raw.replace(/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//, "");
		const head = rest.split(/[/?#]/)[0] ?? "";
		return head === "" ? null : head;
	}
}
function queryTarget(args) {
	const queries = args.queries;
	if (Array.isArray(queries)) {
		for (const item of queries) {
			const value = str(item);
			if (value !== null) return value;
		}
		return null;
	}
	return firstStr(args, ["queries", "query"]);
}
function filesTarget(args) {
	const files = args.files;
	if (!Array.isArray(files)) return null;
	for (const item of files) {
		if (item === null || typeof item !== "object") continue;
		const picked = firstStr(item, ["path", "description"]);
		if (picked !== null) return picked;
	}
	return null;
}
const COMMAND_LIKE = /^[A-Za-z][A-Za-z\d_.-]+$/;
const SUBCOMMAND_LIKE = /^[A-Za-z][A-Za-z\d-]*$/;
const COMPOUND_COMMAND = /[;|]|&&|\|\||\r?\n/;
/**
* 取命令名时要剥掉的边角字符（运算符、括号、重定向、引号、变量前缀…）。
* 例：`(Get-NetTCPConnection` → `Get-NetTCPConnection`；`$env:FOO` → `env:FOO`（随后判定落选）。
*/
const EDGE_CHARS = new Set("&.([{!@$^+:=,;|\"'`)]}>#");
/** 剥掉词首词尾的边角字符。 */
function trimEdges(token) {
	let start = 0;
	let end = token.length;
	while (start < end && EDGE_CHARS.has(token.charAt(start))) start += 1;
	while (end > start && EDGE_CHARS.has(token.charAt(end - 1))) end -= 1;
	return token.slice(start, end);
}
function tokenizeCommand(command) {
	const tokens = [];
	let current$2 = "";
	let quote = null;
	for (const ch of command) {
		if (quote !== null) {
			if (ch === quote) quote = null;
			else current$2 += ch;
			continue;
		}
		if (ch === "\"" || ch === "'" || ch === "`") {
			quote = ch;
			continue;
		}
		if (/\s/.test(ch) || ch === ";" || ch === "|") {
			if (current$2 !== "") tokens.push(current$2);
			current$2 = "";
			continue;
		}
		current$2 += ch;
	}
	if (current$2 !== "") tokens.push(current$2);
	return tokens.map(trimEdges).filter((token) => token !== "");
}
/** arguments 的解析上限（UTF-16 码元数）：超过就不解析（write / edit 会带上整个文件内容）。 */
const MAX_ARGS_CHARS = 64 * 1024;
/** 气泡里目标的展示上限（码点）：超过就只留文件名。 */
const TARGET_MAX = 22;
const TARGET_DISPLAY_MAX = 20;
function parseArgs$1(raw) {
	if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) return raw;
	if (typeof raw !== "string" || raw === "" || raw.length > MAX_ARGS_CHARS) return null;
	try {
		const parsed = JSON.parse(raw);
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
		return parsed;
	} catch {
		return null;
	}
}
function clip(text) {
	const points = Array.from(text);
	return points.length > TASK_TEXT_MAX ? `${points.slice(0, TASK_TEXT_MAX).join("")}…` : text;
}
function pickLine(lines) {
	return lines[Math.floor(Math.random() * lines.length)] ?? lines[0] ?? "";
}
function fill(line, vars) {
	let out = line;
	for (const [key, value] of Object.entries(vars)) out = out.split(`{${key}}`).join(value);
	return out;
}
function compactTarget(raw, pathLike) {
	if (!pathLike) return raw;
	const text = raw.replace(/\\/g, "/").replace(/\/+$/, "");
	if (Array.from(text).length <= TARGET_MAX) return text;
	const parts = text.split("/").filter((part) => part !== "");
	return parts.length > 0 ? parts[parts.length - 1] : text;
}

//#endregion
//#region src/host/tool-detail/copy.ts
/** 文件名/图片类：每句都带 {target}。 */
const FILE_COPY = [
	"翻翻 {target} 看看嘛",
	"{target} 里面写了啥呢",
	"我先瞅瞅 {target} 哈"
];
/** 写文件。 */
const WRITE_COPY = [
	"写点东西到 {target}",
	"{target} 马上写出来",
	"给 {target} 添点料"
];
/** 改文件。 */
const EDIT_COPY = [
	"{target} 得改改啦",
	"我来动动 {target} 哦",
	"{target} 这里要修一下"
];
/** 找文件。 */
const GLOB_COPY = [
	"{target} 都躲哪儿了呢",
	"找找 {target} 在不在",
	"{target} 藏在哪个角落呀"
];
/** 搜内容。 */
const GREP_COPY = [
	"{target} 藏哪儿了呢",
	"搜搜 {target} 在哪",
	"哪儿有 {target} 呀"
];
/** 给人看文件。 */
const PRESENT_COPY = [
	"给你看 {target} 哦",
	"{target} 拿来给你瞧瞧",
	"喏，{target} 在这儿"
];
/** 学技能。 */
const SKILL_COPY = [
	"学个新本事 {target}",
	"{target} 这招得记住",
	"把 {target} 学起来"
];
/** 委派子任务。 */
const SUBAGENT_COPY = [
	"叫人搭把手：{target}",
	"让帮手去看看 {target}",
	"{target} 交给帮手了"
];
const TOOL_COPY = {
	read: {
		lines: FILE_COPY,
		short: "翻翻代码看看"
	},
	read_image: {
		lines: [
			"这 {target} 长啥样呀",
			"让我瞧瞧 {target} 呗",
			"{target} 是张什么图呢"
		],
		short: "看看这张图是啥"
	},
	write: {
		lines: WRITE_COPY,
		short: "写点东西进去"
	},
	edit: {
		lines: EDIT_COPY,
		short: "这里得改改"
	},
	str_replace_editor: {
		lines: EDIT_COPY,
		short: "这里得改改"
	},
	glob: {
		lines: GLOB_COPY,
		short: "找找东西在哪"
	},
	grep: {
		lines: GREP_COPY,
		short: "到处翻翻看"
	},
	present: {
		lines: PRESENT_COPY,
		short: "拿个东西给你看"
	},
	skill: {
		lines: SKILL_COPY,
		short: "学个新本事"
	},
	subagent: {
		lines: SUBAGENT_COPY,
		short: "叫人来搭把手"
	},
	subagent_fork: {
		lines: SUBAGENT_COPY,
		short: "叫人来搭把手"
	},
	workflow: {
		lines: [
			"把活排个序，开工咯",
			"几件事一起安排上",
			"按顺序一件件来"
		],
		short: "把活排一排"
	},
	web_search: {
		lines: [
			"我去查查 {target}",
			"{target} 得搜搜才知道",
			"上网问问 {target} 吧"
		],
		short: "上网查查"
	},
	web_fetch: {
		lines: [
			"去 {target} 瞅瞅有啥",
			"{target} 这页我翻翻",
			"看看 {target} 上写了啥"
		],
		short: "去网上看看"
	}
};
const UNKNOWN_TOOL_LINE = "这工具是干嘛的";
const COMMAND_FALLBACK = [
	"跑一下 {cmd} 咯",
	"{cmd} 跑起来了",
	"让 {cmd} 干点活"
];
const COMMAND_NAME_TOO_LONG = "跑一个命令咯";
const CD_COPY = [
	"先把位置挪一挪",
	"切到那个目录去",
	"挪个地方继续干活"
];
const LS_COPY = [
	"看看这儿都有啥",
	"这层都有什么东西",
	"翻翻这里有没有"
];
const CAT_COPY = [
	"把内容亮出来瞧瞧",
	"看看里头写了什么",
	"读读这份内容"
];
const MKDIR_COPY = [
	"建个新文件夹",
	"腾个地方出来",
	"新开一个目录"
];
const RM_COPY = [
	"把不要的清掉",
	"这份就别留了",
	"清理一下这些"
];
const MV_COPY = [
	"把东西挪个地儿",
	"换个位置放",
	"挪到那边去"
];
const CP_COPY = [
	"抄一份留着",
	"复制一份备用",
	"再备一份"
];
const CURL_COPY = [
	"去问问接口有没有人",
	"敲敲门看看通不通",
	"请求一下那个地址"
];
const CHECKOUT_COPY = [
	"换到那个分支瞧瞧",
	"切个分支看看",
	"换条路继续走"
];
const COMMAND_COPY = {
	cd: CD_COPY,
	"set-location": CD_COPY,
	ls: LS_COPY,
	dir: LS_COPY,
	"get-childitem": LS_COPY,
	cat: CAT_COPY,
	"get-content": CAT_COPY,
	mkdir: MKDIR_COPY,
	"new-item": MKDIR_COPY,
	rm: RM_COPY,
	del: RM_COPY,
	"remove-item": RM_COPY,
	mv: MV_COPY,
	"move-item": MV_COPY,
	cp: CP_COPY,
	"copy-item": CP_COPY,
	curl: CURL_COPY,
	"invoke-webrequest": CURL_COPY,
	git: [
		"折腾折腾 git 仓库",
		"跟 git 打个交道",
		"git 这边动一动"
	],
	"git status": [
		"看看现在改了些什么",
		"查查工作区干不干净",
		"目前是啥状况呢"
	],
	"git diff": [
		"瞅瞅这次到底改哪了",
		"到底动了哪些地方呀",
		"对比看看都改了啥"
	],
	"git log": [
		"让我康康你的提交历史",
		"翻翻最近都提交了啥",
		"看看这些天干了什么"
	],
	"git add": [
		"先把这些攒起来",
		"好东西先收进去",
		"把改动的都登记上"
	],
	"git commit": [
		"代码得保存好才行",
		"打个提交，记一笔",
		"先存一份再说"
	],
	"git push": [
		"该推上去了吧，我来",
		"推送一下，交给我",
		"该让远端知道了"
	],
	"git pull": [
		"拉一下最新的过来",
		"把远端的新东西拿回来",
		"先同步一下再说"
	],
	"git fetch": [
		"先问问远端有没有新东西",
		"悄悄看一眼远端",
		"拉个最新状态下来"
	],
	"git checkout": CHECKOUT_COPY,
	"git switch": CHECKOUT_COPY,
	"git branch": [
		"看看都有哪些分支",
		"理理这些分支",
		"新建个分支备用"
	],
	"git merge": [
		"把两边合到一起",
		"合并一下，别打架",
		"这两条线该合了"
	],
	"git rebase": [
		"把历史重新捋一捋",
		"重新排一下顺序",
		"理一理提交顺序"
	],
	"git stash": [
		"先把改动收起来",
		"这些先搁一边",
		"暂时藏起来一下"
	],
	"git clone": [
		"把整个仓库搬回来",
		"照着一份抄下来",
		"把这份拿下来瞧瞧"
	],
	"git reset": [
		"把刚才的退回去",
		"撤销一下这几步",
		"回到之前的样子"
	],
	"git tag": [
		"给这次打个标记",
		"贴个版本标签",
		"记个里程碑"
	]
};
const SILENT_TOOLS = new Set([
	"todo_write",
	"ask_user_question",
	"create_goal",
	"get_goal",
	"update_goal",
	"exit_plan_mode"
]);
const TOOL_RULES = {
	read: {
		pick: fileTarget,
		path: true
	},
	read_image: {
		pick: fileTarget,
		path: true
	},
	write: {
		pick: fileTarget,
		path: true
	},
	edit: {
		pick: fileTarget,
		path: true
	},
	str_replace_editor: {
		pick: fileTarget,
		path: true
	},
	glob: { pick: (args) => firstStr(args, ["pattern", "path"]) },
	grep: { pick: (args) => firstStr(args, ["pattern", "path"]) },
	web_fetch: { pick: urlHost },
	web_search: { pick: queryTarget },
	subagent: { pick: (args) => firstStr(args, ["description"]) },
	subagent_fork: { pick: (args) => firstStr(args, ["description"]) },
	workflow: { pick: (args) => firstStr(args, ["name", "description"]) },
	skill: { pick: (args) => firstStr(args, ["name"]) },
	present: {
		pick: filesTarget,
		path: true
	}
};

//#endregion
//#region src/host/tool-detail/detail.ts
/**
* 按外部给的键查表，只认自有属性。
*
* 表是普通对象，而键来自模型给的工具名与命令名：`constructor` / `toString` / `__proto__`
* 会命中原型链，查回来的不是文案而是函数。这类名字没有特殊语义，一律按「表里没有」处理。
*/
function own(table, key) {
	return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : void 0;
}
/**
* `pwsh` 的文案：按命令名（必要时加子命令）查表，查不到走兜底。
*
* 复合命令 → null，让前端回落配置文案（无法判断真正在做什么）；`git log` 这类命中「命令 + 子命令」
* 用子命令文案，只命中命令（`git`、`cd`）用通用文案，都没命中（`npm`、`python`、`node`…）走兜底——
* 兜底带命令名，至少知道在跑什么。
*/
function pwshDetail(args) {
	const command = args === null ? null : str(args.command);
	if (command === null) return null;
	if (COMPOUND_COMMAND.test(command)) return null;
	const tokens = tokenizeCommand(command);
	const nameAt = tokens.findIndex((token) => COMMAND_LIKE.test(token));
	if (nameAt < 0) return null;
	const rawCmd = tokens[nameAt];
	const lookup = rawCmd.toLowerCase();
	const subAt = tokens.findIndex((token, index) => index > nameAt && SUBCOMMAND_LIKE.test(token));
	const sub = subAt < 0 ? null : tokens[subAt].toLowerCase();
	const lines = (sub === null ? void 0 : own(COMMAND_COPY, `${lookup} ${sub}`)) ?? own(COMMAND_COPY, lookup);
	if (lines !== void 0) return clip(pickLine(lines));
	if (Array.from(rawCmd).length > TARGET_DISPLAY_MAX) return clip(COMMAND_NAME_TOO_LONG);
	return clip(fill(pickLine(COMMAND_FALLBACK), { cmd: rawCmd }));
}
function toolDetailFromEvent(event) {
	const name = str(event?.data?.name);
	if (name === null) return null;
	if (SILENT_TOOLS.has(name)) return null;
	const args = parseArgs$1(event?.data?.arguments);
	if (name === "pwsh") return pwshDetail(args);
	const entry = own(TOOL_COPY, name);
	if (entry === void 0) return clip(UNKNOWN_TOOL_LINE);
	const rule = own(TOOL_RULES, name);
	const line = pickLine(entry.lines);
	if (!line.includes("{target}")) return clip(line);
	const target = args === null || rule === void 0 ? null : rule.pick(args);
	if (target === null) return null;
	const shown = compactTarget(target, rule?.path === true);
	if (Array.from(shown).length > TARGET_DISPLAY_MAX) return clip(entry.short);
	return clip(fill(line, { target: shown }));
}

//#endregion
//#region src/host/notify-events.ts
function shouldNotifySession(session) {
	const header = session?.header;
	if (!header || typeof header !== "object") return true;
	if (header.origin === "subagent") return false;
	const depth = header.delegationDepth;
	if (typeof depth === "number" && Number.isFinite(depth) && depth > 0) return false;
	return true;
}
function sessionIdOf(session) {
	const s = session;
	return String(s?.header?.id ?? s?.id ?? "unknown");
}
function withSessionId(frame, sessionId) {
	return sessionId === "unknown" ? frame : {
		...frame,
		sessionId
	};
}
function isCompletionTurnEnd(event) {
	const e = event;
	return e?.type === "turn/end" && e.data?.reason?.kind === "completed";
}
function hasBlockingActivity(activity) {
	if (!Array.isArray(activity)) return false;
	for (const item of activity) {
		const kind = item?.kind;
		if (kind === "job" || kind === "subagent" || kind === "schedule") return true;
	}
	return false;
}
/** 回复开头在会话状态里的缓存上限：只用于一条 toast，留太长没有意义。 */
const MAX_REPLY_TEXT = 200;
function lastAssistantText(event) {
	if (event?.type !== "assistant/message") return null;
	const content = event.data?.message?.content;
	if (!Array.isArray(content)) return null;
	for (let i = content.length - 1; i >= 0; i -= 1) {
		const block = content[i];
		if (block?.type !== "text" || typeof block.text !== "string") continue;
		const text = block.text.replace(/\s+/g, " ").trim();
		if (text === "") continue;
		return text.length > MAX_REPLY_TEXT ? text.slice(0, MAX_REPLY_TEXT) : text;
	}
	return null;
}
function turnEndNotifyKind(kind) {
	if (kind === "completed") return "completed";
	if (kind === "error" || kind === "max-tokens") return kind;
	return null;
}
/** ask_user_question 工具名（与 work-status.ts 同源；该工具触发时模型在等用户答复）。 */
const USER_QUESTION_TOOL = "ask_user_question";
function parseToolQuestions(args) {
	if (typeof args !== "string") return null;
	try {
		const parsed = JSON.parse(args);
		const questions = parsed?.questions;
		if (!Array.isArray(questions)) return null;
		return questions;
	} catch {
		return null;
	}
}
function reduceNotifyFrame(event, replyText) {
	if (!event?.type) return null;
	switch (event.type) {
		case "turn/end": {
			const reason = event.data?.reason;
			const kind = turnEndNotifyKind(reason?.kind);
			if (!kind) return null;
			return {
				type: "session/event",
				event: {
					type: "turn/end",
					data: kind === "completed" && replyText ? {
						reason,
						text: replyText
					} : { reason }
				}
			};
		}
		case "approval/asked": {
			const data = event.data ?? {};
			return {
				type: "approval/requested",
				...typeof data.toolName === "string" && data.toolName ? { toolName: data.toolName } : {},
				...typeof data.reason === "string" && data.reason ? { reason: data.reason } : {}
			};
		}
		case "tool/call": {
			if (String(event.data?.name ?? "") !== USER_QUESTION_TOOL) return null;
			const questions = parseToolQuestions(event.data?.arguments);
			if (!questions || questions.length === 0) return null;
			return {
				type: "question/requested",
				questions
			};
		}
		default: return null;
	}
}
function agentErrorFrame(error) {
	const message = typeof error === "string" ? error : error instanceof Error ? error.message : String(error ?? "");
	return {
		type: "host/agent-error",
		message
	};
}

//#endregion
//#region src/host/plugin/session-watch.ts
/**
* 取本次工具事件的调用标识。
*
* `tool/call` 的标识在 `data.callId`，`tool/result` 在 `data.message.source.callId`
* （`ToolResultMessage.source` 由 `ToolMessageSource` 保证必带）。
*
* @returns 非空字符串标识；缺失或类型不对时 `undefined`，交给记账层用临时 Symbol 占位。
*/
function toolCallIdOf(event) {
	const data = event?.data;
	const raw = data?.message?.source?.callId ?? data?.callId;
	return typeof raw === "string" && raw !== "" ? raw : void 0;
}
/**
* 更新一个会话的在途调用表，算出气泡该显示什么。
*
* @param ledger - 每会话在途调用表；本函数原地修改。
* @param sessionId - 会话标识。
* @param phase - 本次是调用开始还是结果返回，以及对应的调用标识。
* @param lastTodo - 表清空后回落到的 todo 文案。
* @returns 气泡文案与是否仍在工作。
*/
function trackToolPhase(ledger, sessionId, phase, lastTodo) {
	if (phase.kind === "call") {
		let pending$1 = ledger.get(sessionId);
		if (!pending$1) ledger.set(sessionId, pending$1 = new Map());
		pending$1.set(phase.callId ?? Symbol(), phase.detail);
		return {
			task: phase.detail,
			keepWorking: true
		};
	}
	const pending = ledger.get(sessionId);
	const key = phase.callId ?? [...pending?.keys() ?? []].find((id) => typeof id === "symbol");
	if (key !== void 0) pending?.delete(key);
	const remaining = [...pending?.values() ?? []];
	if (pending?.size === 0) ledger.delete(sessionId);
	const active = remaining.pop();
	if (active !== void 0) return {
		task: active,
		keepWorking: true
	};
	return {
		task: lastTodo,
		keepWorking: false
	};
}
/**
* 把一次工具事件落进记账表。
*
* @param ledger - 每会话在途调用表；本函数原地修改。
* @param sessionId - 会话标识。
* @param input - 事件类型、调用标识与详情文案。
* @returns 记账结果；没有可展示详情且不是结果事件时返回 `undefined`（气泡不因它改文案）。
*/
function trackToolEvent(ledger, sessionId, input) {
	if (input.detail !== null) return trackToolPhase(ledger, sessionId, {
		kind: "call",
		detail: input.detail,
		callId: input.callId
	}, input.lastTodo);
	if (input.type === "tool/result") return trackToolPhase(ledger, sessionId, {
		kind: "result",
		callId: input.callId
	}, input.lastTodo);
	return void 0;
}
function registerSessionWatch(deps) {
	const { ctx, cancelTerminalCleanup, lastTodoText, lastReplyText, notifyActivityTimers, publishWorkStatus, pushNotifyFrame, scheduleCompletionNotify, scheduleTerminalCleanup, terminalTimers, toolsInFlight, turnFlags, workStatus } = deps;
	ctx.effect(() => {
		const dispose = ctx.on("session/event", (session, event) => {
			const type = event?.type;
			if (!type) return;
			const sessionId = String(session?.header?.id ?? session?.id ?? "unknown");
			if (type === "todo/write") {
				const text = currentTaskFromTodo(event);
				lastTodoText.set(sessionId, text);
				if ((toolsInFlight.get(sessionId)?.size ?? 0) > 0) return;
				if (workStatus.has(sessionId)) {
					workStatus.setTask(sessionId, text);
					publishWorkStatus();
				}
				return;
			}
			if (type === "user/message") {
				const source = event?.data?.source;
				if (source?.kind === "goal") {
					const flags = turnFlags.get(sessionId) ?? {
						goalRound: false,
						closing: null
					};
					flags.goalRound = true;
					turnFlags.set(sessionId, flags);
				}
				return;
			}
			if (type === "turn/start") {
				turnFlags.set(sessionId, {
					goalRound: false,
					closing: null
				});
				workStatus.setTask(sessionId, null);
				lastTodoText.delete(sessionId);
				toolsInFlight.delete(sessionId);
				publishWorkStatus();
			}
			if (type === "tool/call" && String(event?.data?.name ?? "") === GOAL_UPDATE_TOOL) {
				const action = goalUpdateAction(String(event?.data?.arguments ?? ""));
				if (action) {
					const flags = turnFlags.get(sessionId) ?? {
						goalRound: false,
						closing: null
					};
					flags.closing = action;
					turnFlags.set(sessionId, flags);
				}
			}
			let next = reduceWorkStatus(event, turnFlags.get(sessionId));
			if (!next) {
				if (type === "turn/end") {
					turnFlags.delete(sessionId);
					cancelTerminalCleanup(sessionId);
					lastTodoText.delete(sessionId);
					toolsInFlight.delete(sessionId);
					workStatus.clear(sessionId);
					publishWorkStatus();
				}
				return;
			}
			const seq = Number(event.seq ?? 0);
			const detail = type === "tool/call" ? toolDetailFromEvent(event) : null;
			const outcome = trackToolEvent(toolsInFlight, sessionId, {
				type,
				callId: toolCallIdOf(event),
				detail,
				lastTodo: lastTodoText.get(sessionId) ?? null
			});
			if (outcome?.keepWorking) next = "working";
			const changed = workStatus.setState(sessionId, next, seq);
			if (outcome?.task !== void 0) workStatus.setTask(sessionId, outcome.task);
			publishWorkStatus();
			if (!changed) return;
			if (next === "success" || next === "error") scheduleTerminalCleanup(sessionId);
			else cancelTerminalCleanup(sessionId);
		});
		return () => {
			dispose();
			for (const t of terminalTimers.values()) clearTimeout(t);
			terminalTimers.clear();
		};
	}, "dsh-pet: work-status session events");
	ctx.effect(() => {
		const sessionDispose = ctx.on(
			"session/event",
			// eslint-disable-next-line @typescript-eslint/no-explicit-any -- session/event 载荷无公开类型，any 只用于接收，函数内立刻交给 shouldNotifySession / reduceNotifyFrame 推导
			(session, event) => {
				if (!shouldNotifySession(session)) return;
				if (event?.type === "assistant/message") {
					const text = lastAssistantText(event);
					if (text) lastReplyText.set(sessionIdOf(session), text);
				}
				if (isCompletionTurnEnd(event)) {
					scheduleCompletionNotify(sessionIdOf(session), event);
					return;
				}
				if (event?.type === "turn/end") lastReplyText.delete(sessionIdOf(session));
				const frame = reduceNotifyFrame(event);
				if (frame) pushNotifyFrame(withSessionId(frame, sessionIdOf(session)));
			}
);
		const errorDispose = ctx.on(
			"agent/error",
			// eslint-disable-next-line @typescript-eslint/no-explicit-any -- agent/error 载荷无公开类型，且低版本 DSH 可能不带 error 字段，只能 any 后按可选链取 payload?.error
			(payload) => {
				pushNotifyFrame(agentErrorFrame(payload?.error));
			}
);
		return () => {
			for (const t of notifyActivityTimers.values()) clearTimeout(t);
			notifyActivityTimers.clear();
			sessionDispose();
			errorDispose();
		};
	}, "dsh-pet: notify frames");
}

//#endregion
//#region src/host/plugin/desktop/pets.ts
/** 该宠物是否参与桌面模式（Electron 透明窗）。 */
const isDesktopVisible$1 = (display) => display === "desktop" || display === "both";
/** 现读配置并算出判定；读不出来时抛出，由各取值函数决定降级方式。 */
function readDecision(configPaths) {
	const merged = readAllConfig(configPaths);
	const pets = flattenPetList(merged);
	return {
		pets,
		desktopPets: pets.filter((pet) => isDesktopVisible$1(pet.display))
	};
}
function createDesktopPets(deps) {
	const { configPaths, effectivePetList, log } = deps;
	/** 现在有没有桌面宠物；读配置失败按「没有」处理——宁可不起 helper，也不起一个没有宠物的空进程。 */
	const getHasDesktopPet = () => {
		try {
			return readDecision(configPaths).desktopPets.length > 0;
		} catch {
			return false;
		}
	};
	/** 托盘开关的当前值；读失败按「仍要托盘」处理（保守保留常驻图标）。 */
	const getTrayOn = () => {
		try {
			return readAllConfig(configPaths).main?.trayEnabled !== false;
		} catch {
			return true;
		}
	};
	/** 参与桌面窗的宠物（给 helper 的启动参数）；读失败返回空列表。 */
	const desktopPetList = () => {
		try {
			return effectivePetList().filter((pet) => isDesktopVisible$1(pet.display)).map((pet) => ({
				id: String(pet.id),
				size: Number(pet.size)
			}));
		} catch {
			return [];
		}
	};
	/** 打一行判定日志（诊断用）：设置页显示「仅桌面」却没有 helper 进程时，这行能分辨宿主读到的是 web 还是 desktop。 */
	const logDesktopDecision = () => {
		try {
			const { pets, desktopPets } = readDecision(configPaths);
			const trayOn = readAllConfig(configPaths).main?.trayEnabled !== false;
			log.info(`[dsh-pet] 桌面判定：pets=${pets.length}，桌面可见=${desktopPets.length}（${desktopPets.map((pet) => String(pet.id)).join(",") || "无"}）→ hasDesktopPet=${desktopPets.length > 0} tray=${trayOn}`);
		} catch (e) {
			log.warn(`[dsh-pet] 宠物配置非法，桌面模式已跳过：${e instanceof Error ? e.message : String(e)}`);
		}
	};
	logDesktopDecision();
	return {
		getHasDesktopPet,
		getTrayOn,
		desktopPetList,
		logDesktopDecision
	};
}

//#endregion
//#region src/host/plugin/desktop/bridge-response.ts
/** 纯文本应答的类型串；`text` 与 `none` 共用。 */
const TEXT_UTF8 = "text/plain; charset=utf-8";
/** JSON 应答的类型串。 */
const JSON_UTF8 = "application/json; charset=utf-8";
function toBridgeResponse(id, result) {
	if (result.kind === "file") return {
		id,
		status: 200,
		contentType: result.contentType,
		file: result.file
	};
	if (result.kind === "text") return {
		id,
		status: result.status,
		contentType: TEXT_UTF8,
		body: result.body
	};
	if (result.kind === "none") return {
		id,
		status: 204,
		contentType: TEXT_UTF8,
		body: ""
	};
	return {
		id,
		status: result.status,
		contentType: JSON_UTF8,
		body: JSON.stringify(result.obj)
	};
}

//#endregion
//#region src/host/plugin/desktop/spawn.ts
/** 宿主是不是 DSH 桌面应用（Electron 宿主）。 */
const isDesktopHost = () => Boolean(process.versions.electron);
function resolveOpenTarget(siteUrl, desktopHost) {
	if (desktopHost) return "desktop";
	return siteUrl.includes("/standalone-ai/") ? "standalone" : "web";
}
function createDesktopSpawn(deps) {
	const { ctx, getHandlePetRoute, log, reportDownload, thumbUserRoot, getHasDesktopPet, desktopPetList, getTrayOn } = deps;
	let desktopModeEverActive = false;
	let helper;
	let startRetryTimer;
	let electronEnsure;
	let disposed = false;
	let displayWarned = false;
	let noDesktopSkipped = false;
	let portWaitAttempts = 0;
	const inProcessHost = process.env.DSH_PET_IN_PROCESS === "1";
	const launchHelper = (electronPath) => {
		if (inProcessHost) return;
		if (helper || disposed) return;
		if (!getHasDesktopPet() && !(desktopModeEverActive && getTrayOn())) return;
		const port = typeof ctx.webServer?.port === "number" ? ctx.webServer.port : 0;
		if (!port || port <= 0) {
			portWaitAttempts += 1;
			if (portWaitAttempts === 1) log.info(`[dsh-pet] webServer 端口尚未就绪（port=${String(port)}），每 500ms 重试拉起桌面 Helper`);
			else if (portWaitAttempts % 20 === 0) log.warn(`[dsh-pet] 已等待 webServer 端口 ${portWaitAttempts * 500 / 1e3}s 仍未就绪（port=${String(port)}），桌面 Helper 尚未拉起`);
			if (!startRetryTimer) {
				startRetryTimer = setTimeout(() => {
					startRetryTimer = void 0;
					launchHelper(electronPath);
				}, 500);
				startRetryTimer.unref?.();
			}
			return;
		}
		portWaitAttempts = 0;
		let origin = `http://127.0.0.1:${port}`;
		try {
			origin = ctx.webServer.getOrigin();
		} catch {}
		const siteUrl = ctx.connection.authenticatedUrl(origin);
		const configUrl = `${origin}${ROUTE_SEGMENT}/config`;
		helper = new HelperProcess({
			electronPath,
			env: {
				DSH_PET_CONFIG_URL: configUrl,
				DSH_PET_SITE_URL: siteUrl,
				DSH_PET_OPEN_TARGET: resolveOpenTarget(siteUrl, isDesktopHost()),
				DSH_PET_SCALE: "1",
				DSH_PET_BRIDGE: "1",
				DSH_PET_PETS: JSON.stringify(desktopPetList())
			},
			bridgeHandler: async (req) => {
				const result = await getHandlePetRoute()(req.url ?? "/", req.method ?? "GET", req.body);
				return toBridgeResponse(req.id, result);
			}
		}, log);
		try {
			helper.start();
			desktopModeEverActive = true;
			log.info(`dsh-pet desktop helper started (config: ${configUrl})`);
		} catch (e) {
			log.warn(`dsh-pet desktop helper start failed: ${e instanceof Error ? e.message : String(e)}`);
			helper = void 0;
		}
	};
	const startHelper = () => {
		if (inProcessHost) return;
		if (helper || electronEnsure || disposed) return;
		if (!getHasDesktopPet() && !(desktopModeEverActive && getTrayOn())) {
			if (!noDesktopSkipped) {
				noDesktopSkipped = true;
				log.info(`[dsh-pet] 无桌面宠物（display 均为 web/none）且无需保留托盘（tray=${getTrayOn()}），已跳过桌面 Helper 启动`);
			}
			return;
		}
		if (!hasGraphicalDisplay()) {
			if (!displayWarned) {
				displayWarned = true;
				log.warn("[dsh-pet] 未检测到图形显示环境（DISPLAY/WAYLAND_DISPLAY 均为空），已跳过桌面宠物。浏览器内宠物不受影响；如需在服务器上启用桌面模式，请配置 Xvfb 后设置 DSH_PET_DESKTOP_FORCE=1。");
			}
			return;
		}
		const found = resolveElectronPath();
		if (found) {
			launchHelper(found);
			return;
		}
		log.warn(`[dsh-pet] 未找到 Electron 可执行文件：DSH_HOME=${dshHomeDir()}，查找路径=${defaultElectronExe()}，DSH_PET_ELECTRON_PATH=${process.env.DSH_PET_ELECTRON_PATH ?? "(未设置)"}`);
		log.warn(`[dsh-pet] 开始下载 Electron 到 ${defaultElectronExe()} ...`);
		electronEnsure = ensureElectronDownload({
			onLog: ({ text, level, done }) => reportDownload(text, level === "warn" ? "error" : done ? "success" : "working", done),
			logger: log
		}).then((path) => {
			if (path) launchHelper(path);
			else log.warn("[dsh-pet] Electron download failed; desktop pet unavailable. Set DSH_PET_ELECTRON_PATH and restart, or retry later.");
		}).finally(() => {
			electronEnsure = void 0;
		});
	};
	const stopHelper = (reason = "settings-change") => {
		if (startRetryTimer) {
			clearTimeout(startRetryTimer);
			startRetryTimer = void 0;
		}
		helper?.stop(reason);
		helper = void 0;
	};
	const stopHelperAndWait = async (reason) => {
		if (startRetryTimer) {
			clearTimeout(startRetryTimer);
			startRetryTimer = void 0;
		}
		const old = helper;
		helper = void 0;
		await old?.stopAndWait(reason);
	};
	const animSubdirFor = (ext) => ext === ".mov" ? "mov" : "webm";
	const assetRootFor = (ext) => join(PACKAGE_ROOT, "assets", animSubdirFor(ext));
	const userRootFor = (ext) => join(thumbUserRoot, animSubdirFor(ext));
	const markDisposed = () => {
		disposed = true;
	};
	return {
		startHelper,
		stopHelper,
		stopHelperAndWait,
		markDisposed,
		assetRootFor,
		userRootFor
	};
}

//#endregion
//#region src/host/plugin/desktop/sync.ts
function createDesktopSync(deps) {
	const { log, logDesktopDecision, startHelper, stopHelperAndWait } = deps;
	let desktopSyncQueue = Promise.resolve();
	const restartDesktop = () => {
		desktopSyncQueue = desktopSyncQueue.then(async () => {
			logDesktopDecision();
			await stopHelperAndWait("desktop-config-change");
			startHelper();
		}).catch((e) => {
			log.warn(`[dsh-pet] 重启桌面 Helper 失败：${e instanceof Error ? e.message : String(e)}`);
		});
		return desktopSyncQueue;
	};
	return { requestRestart: restartDesktop };
}

//#endregion
//#region src/host/plugin/desktop-helper.ts
function createDesktopHelper(deps) {
	const pets = createDesktopPets(deps);
	const spawn$1 = createDesktopSpawn({
		...deps,
		...pets
	});
	const sync = createDesktopSync({
		...deps,
		...pets,
		...spawn$1
	});
	return {
		startHelper: spawn$1.startHelper,
		stopHelper: spawn$1.stopHelper,
		requestRestart: sync.requestRestart,
		assetRootFor: spawn$1.assetRootFor,
		userRootFor: spawn$1.userRootFor,
		markDisposed: spawn$1.markDisposed
	};
}

//#endregion
//#region src/standalone/shims/dsh-credentials.ts
function credentialRef(ref) {
	return ref;
}

//#endregion
//#region src/host/plugin/balance-poll.ts
function createBalancePoll(deps) {
	const { ctx, configPaths, getActivePetId, log, state } = deps;
	/** 当前生效宠物列表：成品配置拍平（合并器已保证 id 唯一、字段填满），命令与桌面模式共用。 */
	const effectivePetList = () => flattenPetList(readAllConfig(configPaths));
	/** 余额刷新周期（秒）：成品 main 条目的 eventsRefreshSec.balance（合并器已填默认；非法兜底 1800） */
	const balancePeriodSec = (cfg) => {
		const ers = cfg.main?.eventsRefreshSec;
		const n = Number(ers?.balance);
		return Number.isFinite(n) && n > 0 ? n : 1800;
	};
	/** 碎碎念周期（秒）：该宠物所属条目的 eventsRefreshSec.whisper（合并器已填默认；非法兜底 300）。
	*  收已解析的条目配置：唯一调用方是周期调度，它的 petId 就是从同一份 cfg 拍平出来的。 */
	const whisperPeriodSec = (conf) => {
		const ers = conf.eventsRefreshSec;
		const n = Number(ers?.whisper);
		return Number.isFinite(n) && n > 0 ? n : 300;
	};
	/**
	* 账号服务要求的调用方身份（`AccountClientMetadata`）：只影响请求来源标识与服务端本地化文案，
	* 不参与余额数值与币种。version 读自身 package.json（读不到回落 '0.0.0'）；locale 固定 zh-CN。
	*/
	const accountClientMetadata = () => {
		let version = "0.0.0";
		try {
			const raw = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"));
			if (typeof raw.version === "string" && raw.version.length > 0) version = raw.version;
		} catch {}
		return {
			version,
			locale: "zh-CN",
			timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60
		};
	};
	/**
	* 刷新余额并写入轮询状态：host 侧唯一的余额查询点，两端从 /state 读同一份结果。
	* 失败也写进状态（reason 区分 unsupported / credential-missing / fetch-error）：余额不可用要弹
	* 文字说明，不能静默；意外异常同样落成 fetch-error。
	*
	* @param manual - 这次刷新是否由用户触发（/balance 命令、桌面「查看余额」菜单）；标记随数据写进
	*   叶子，前端据此决定余额不可用时是否必弹文字说明（周期刷新只在原因变化时弹一次）。
	*/
	const refreshBalance = async (manual = false) => {
		log.info(`[dsh-pet] 余额刷新开始（${manual ? "手动" : "周期"}）`);
		const mark = (v) => manual ? {
			...v,
			manual: true
		} : v;
		try {
			const sel = ctx.agentDefaultModel.currentSelection();
			const result = await queryBalance(
				sel.provider,
				async (ref) => {
					const rc = await ctx.credentials.resolve(credentialRef(ref));
					return rc?.value;
				},
				// `deepseek-account`（免费额度 / 平台登录）没有 API Key：它的凭证是 DSH 账号服务
				// 持有的授权记录，只能经 getBalance 查询。账号服务是可选服务（软取，不放进 inject）
				// ——没装账号插件时它不在场，此时该路由报 credential-missing 而不是崩。
				async () => {
					const account = ctx.get("deepseekAccount", false);
					if (!account) return void 0;
					return account.getBalance(accountClientMetadata());
				}
);
			state.writeSection("balance", mark(result));
			if (result.ok) log.info(`[dsh-pet] 余额刷新成功 provider=${result.provider}（${result.shape}）`);
			else log.warn(`[dsh-pet] 余额刷新失败 provider=${result.provider} reason=${result.reason}` + (result.message ? " " + result.message : ""));
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			state.writeSection("balance", mark({
				ok: false,
				provider: "unknown",
				reason: "fetch-error",
				message
			}));
			log.warn("[dsh-pet] 余额刷新异常：" + message);
		}
	};
	/** 当前交互桌宠 id：/pet 已选且仍存在 → 该宠物；未选/已失效 → 有效宠物列表第一只（进程内，重启回默认） */
	const resolveActivePetId = () => {
		try {
			const eff = effectivePetList();
			if (eff.length === 0) return "";
			if (getActivePetId() && eff.some((p) => String(p.id) === getActivePetId())) return getActivePetId();
			return String(eff[0].id);
		} catch {
			return getActivePetId();
		}
	};
	/** 宠物的显示名（name，缺失回落 id）——命令文案用 */
	const petDisplayName = (pet) => {
		const n = String(pet.name ?? "").trim();
		return n || String(pet.id ?? "");
	};
	return {
		effectivePetList,
		balancePeriodSec,
		whisperPeriodSec,
		refreshBalance,
		resolveActivePetId,
		petDisplayName
	};
}

//#endregion
//#region src/standalone/shims/dsh-llm.ts
function createUserMessage(input) {
	return {
		role: "user",
		content: input.content,
		source: input.source
	};
}
function createAssistantMessage(input) {
	return {
		role: "assistant",
		content: input.content,
		source: input.source
	};
}
var BlockAssembler = class {
	/** 已收集的文本片段。 */
	chunks = [];
	/** 收集一个文本块；其他类型忽略。 */
	push(chunk) {
		if (chunk !== null && typeof chunk === "object" && chunk.type === "text") {
			const text = chunk.text;
			if (typeof text === "string") this.chunks.push(text);
		}
	}
	/** 返回当前拼装结果。 */
	blocks() {
		const text = this.chunks.join("");
		return text === "" ? [] : [{
			type: "text",
			text
		}];
	}
};
function ReasoningEffortId(id) {
	return id;
}

//#endregion
//#region src/host/chat-action.ts
function chatActionNames(animations) {
	const a = animations && typeof animations === "object" ? animations : {};
	if (!Array.isArray(a.categories)) return [];
	const out = [];
	for (const category of a.categories) {
		if (!category || typeof category !== "object") continue;
		const actions = category.actions;
		if (!Array.isArray(actions)) continue;
		for (const name of actions) {
			if (typeof name !== "string" || name === "") continue;
			if (!out.includes(name)) out.push(name);
		}
	}
	return out;
}
function actionInstruction(names) {
	return "\n\n[动作] 回复结尾可选做一个动作给用户看，从下列清单里挑最贴合当前语境的：\n" + names.map((name) => "- " + name).join("\n") + "\n挑中就在回复最后另起一行写 [动作:名称]（名称原样照抄）；没有合适的就完全不要写这个标记。";
}
function extractChatAction(text, names) {
	const tag = /\[动作[:：]\s*([^\]\n]+?)\s*\]/g;
	let action;
	let tagged = false;
	const cleaned = text.replace(tag, (_tag, raw) => {
		tagged = true;
		const name = raw.trim();
		if (action === void 0 && names.includes(name)) action = name;
		return "";
	});
	if (!tagged) return { text };
	const body = cleaned.replace(/[ \t]+$/gm, "").replace(/\n{2,}/g, "\n").trim();
	return action === void 0 ? { text: body } : {
		text: body,
		action
	};
}

//#endregion
//#region src/host/llm-call.ts
const PET_CALL_IDENTITY = "dsh-pet";
function noTextReason(finish) {
	const { kind, failure } = finish ?? {};
	if (kind === "aborted") return "生成已取消";
	if (kind === "max-tokens") return "输出达到上限，未产出正文";
	if (kind !== "error") return "模型未返回文本";
	const { message, code } = failure ?? {};
	if (typeof message === "string" && message.trim() !== "") return message;
	if (typeof code === "string" && code.trim() !== "") return code;
	return "未提供失败原因";
}

//#endregion
//#region src/host/llm-reasoning.ts
async function supportsReasoningOff(ctx, provider, model) {
	const llm = ctx.llm;
	if (!llm || typeof llm.resolveModelInfo !== "function") return false;
	try {
		const info = await llm.resolveModelInfo(provider, model);
		return info?.reasoning?.efforts?.some((e) => e.id === "off") ?? false;
	} catch {
		return false;
	}
}

//#endregion
//#region src/host/model-selection.ts
function configuredModel(conf, key) {
	const raw = conf?.[key];
	if (!raw || typeof raw !== "object") return void 0;
	const m = raw;
	if (typeof m.provider !== "string" || typeof m.model !== "string") return void 0;
	const provider = m.provider.trim();
	const model = m.model.trim();
	return provider && model ? {
		provider,
		model
	} : void 0;
}
function currentModel(ctx) {
	try {
		const sel = ctx.agentDefaultModel?.currentSelection();
		return sel?.provider && sel?.model ? {
			provider: sel.provider,
			model: sel.model
		} : void 0;
	} catch {
		return void 0;
	}
}
function modelCandidates(ctx, preferred) {
	const out = [];
	const push = (m) => {
		if (!m) return;
		if (out.some((x) => x.provider === m.provider && x.model === m.model)) return;
		out.push(m);
	};
	push(preferred);
	push(currentModel(ctx));
	return out;
}
function modelLabel(m) {
	return m.provider + "/" + m.model;
}

//#endregion
//#region src/host/chat.ts
/** 单次生成超时（ms）：对话等 LLM 回复，60s 足够。 */
const TIMEOUT_MS$1 = 6e4;
/** 配图指令：附在 user 正文之后（紧邻回答位置，模型更容易遵守）。
*  交给模型选而不是随机抽：对话有真实上下文（用户输入 + 历史），按语境挑才贴合。 */
function imageInstruction(pool) {
	return "\n\n[配图] 回复结尾可选附一张表情包给用户看，从下列清单里挑最贴合当前语境的：\n" + memeCatalog(pool) + "\n挑中就在回复最后另起一行写 [图:名称]（名称原样照抄）；没有合适的就完全不要写这个标记。";
}
async function generateChat(input) {
	const { ctx, system, history, userText, preferred, image } = input;
	const pool = [...input.pool ?? []];
	const actions = [...input.actions ?? []];
	const candidates = modelCandidates(ctx, preferred);
	if (candidates.length === 0) return {
		ok: false,
		reason: "provider-missing",
		message: "当前对话未配置模型"
	};
	const llm = ctx.llm;
	if (!llm || typeof llm.stream !== "function") return {
		ok: false,
		reason: "generate-error",
		message: "LLM 服务不可用"
	};
	let last = {
		ok: false,
		reason: "generate-error",
		message: noTextReason(void 0)
	};
	for (const [i, sel] of candidates.entries()) {
		const result = await generateWith$1(ctx, {
			llm,
			sel,
			system,
			history,
			userText,
			pool,
			actions,
			image
		});
		if (result.ok) return result;
		last = result;
		if (i + 1 < candidates.length) defaultLog("warn", `dsh-pet: 对话用 ${modelLabel(sel)} 生成失败（${result.message ?? result.reason}），回落到 ${modelLabel(candidates[i + 1])}`);
	}
	return last;
}
/** 用一个确定的 provider/model 跑一次对话生成（失败原样返回结构化原因，不吞）。 */
async function generateWith$1(ctx, once) {
	const { llm, sel, system, history, userText, pool, actions, image } = once;
	const historyMessages = history.map((m) => m.role === "user" ? createUserMessage({
		content: [{
			type: "text",
			text: m.content
		}],
		source: { kind: "user" }
	}) : createAssistantMessage({
		content: [{
			type: "text",
			text: m.content
		}],
		source: {
			provider: sel.provider,
			model: sel.model
		}
	}));
	const deadline = AbortSignal.timeout(TIMEOUT_MS$1);
	const supportsOff = await supportsReasoningOff(ctx, sel.provider, sel.model);
	const wantImage = pool.length > 0;
	const wantAction = actions.length > 0;
	const instruction = (wantImage ? imageInstruction(pool) : "") + (wantAction ? actionInstruction(actions) : "");
	const content = [{
		type: "text",
		text: instruction === "" ? userText : userText + instruction
	}];
	if (image !== void 0) content.push({
		type: "image",
		attachment: image
	});
	const options = {
		provider: sel.provider,
		model: sel.model,
		sessionId: PET_CALL_IDENTITY,
		messages: [...historyMessages, createUserMessage({
			content,
			source: { kind: "user" }
		})],
		system,
		temperature: 1,
		...supportsOff ? { reasoningEffort: ReasoningEffortId("off") } : {},
		signal: deadline
	};
	const assembler = new BlockAssembler();
	try {
		for await (const chunk of llm.stream(options)) assembler.push(chunk);
	} catch (e) {
		return {
			ok: false,
			reason: "generate-error",
			message: e instanceof Error ? e.message : String(e)
		};
	}
	const text = assembler.blocks().filter((b) => b.type === "text").map((b) => "text" in b ? b.text : "").join("").trim();
	if (!text) return {
		ok: false,
		reason: "generate-error",
		message: noTextReason(assembler.finish)
	};
	if (!wantImage && !wantAction) return {
		ok: true,
		text
	};
	const acted = wantAction ? extractChatAction(text, actions) : { text };
	const picked = wantImage ? extractChatImage(acted.text, pool) : { text: acted.text };
	return {
		ok: true,
		text: picked.text,
		...picked.image ? { image: picked.image } : {},
		...acted.action ? { action: acted.action } : {}
	};
}

//#endregion
//#region src/host/time-context/constants.ts
/**
* 时段划分表：[起始小时, 时段]，按起始小时从晚到早排列——匹配时取第一个不超过当前小时的档。
* 口径含起始小时（0–23 全覆盖、不重叠）：凌晨 0–4、清晨 5–6、早上 7–8、上午 9–10、中午 11–12、
* 下午 13–16、傍晚 17–18、晚上 19–22、深夜 23。
*/
const SLOTS = [
	[23, "深夜"],
	[19, "晚上"],
	[17, "傍晚"],
	[13, "下午"],
	[11, "中午"],
	[9, "上午"],
	[7, "早上"],
	[5, "清晨"],
	[0, "凌晨"]
];
const WEEKDAYS = [
	"星期日",
	"星期一",
	"星期二",
	"星期三",
	"星期四",
	"星期五",
	"星期六"
];
const DAY_MS$1 = 864e5;
const DEFAULT_AHEAD = 3;
const DEFAULT_SPAN = 1;
const DEFAULT_AFTER = 3;
const SEASON_AHEAD = 3;
const SEASON_ENDING_AHEAD = 3;
const SEASON_AFTER = 3;
function pad2(n) {
	return String(n).padStart(2, "0");
}
function timeSlotOf(hour) {
	for (const [start, slot] of SLOTS) if (hour >= start) return slot;
	return "凌晨";
}
function dayKindOf(day) {
	return day === 0 || day === 6 ? "周末" : "工作日";
}

//#endregion
//#region src/host/time-context/entries.ts
/**
* 顺序 = 优先级（靠前的先说话）。一天只出一个从句，所以同一天被多个节日/假期覆盖时，谁在数组里
* 靠前就由谁说；想改优先级就挪那几行，不必动逻辑。几条硬约束：只有当天值得说的小节排在邻座之前
* 并掐掉回味；除夕、元宵必须排在春节之前；寒暑假排在传统节日之后、纪念日之前——假期里的节日仍由
* 节日说话，7/1 这类与纪念日撞车的日子则由暑假说话。`ahead / span / after` 缺省 3 / 1 / 3。
*/
const PRIORITY = [
	{
		kind: "solar",
		key: "2-14",
		name: "情人节",
		after: 0
	},
	{
		kind: "solar",
		key: "12-31",
		name: "跨年夜",
		after: 0
	},
	{
		kind: "solar",
		key: "4-1",
		name: "愚人节",
		after: 0
	},
	{
		kind: "solar",
		key: "5-4",
		name: "青年节",
		ahead: 0,
		after: 0
	},
	{
		kind: "lunarEve",
		name: "除夕",
		ahead: 1,
		after: 0
	},
	{
		kind: "lunar",
		key: "1-15",
		name: "元宵节"
	},
	{
		kind: "lunar",
		key: "1-1",
		name: "春节",
		spoken: "大年初一",
		span: 15
	},
	{
		kind: "lunar",
		key: "8-15",
		name: "中秋节",
		span: 3,
		after: 2
	},
	{
		kind: "solar",
		key: "10-1",
		name: "国庆节",
		span: 7
	},
	{
		kind: "solar",
		key: "1-1",
		name: "元旦",
		spoken: "新年第一天",
		span: 3
	},
	{
		kind: "lunar",
		key: "5-5",
		name: "端午节",
		span: 3
	},
	{
		kind: "solar",
		key: "4-4",
		name: "清明节",
		span: 3,
		ahead: 1
	},
	{
		kind: "solar",
		key: "5-1",
		name: "劳动节",
		span: 3
	},
	{
		kind: "solar",
		key: "6-1",
		name: "儿童节"
	},
	{
		kind: "lunar",
		key: "7-7",
		name: "七夕"
	},
	{
		kind: "lunar",
		key: "7-15",
		name: "中元节"
	},
	{
		kind: "lunar",
		key: "2-2",
		name: "龙抬头"
	},
	{
		kind: "lunar",
		key: "9-9",
		name: "重阳节"
	},
	{
		kind: "lunar",
		key: "12-8",
		name: "腊八节"
	},
	{
		kind: "lunar",
		key: "12-23",
		name: "小年"
	},
	{
		kind: "season",
		from: "1-20",
		to: "2-18",
		name: "寒假"
	},
	{
		kind: "season",
		from: "7-1",
		to: "8-29",
		name: "暑假"
	},
	{
		kind: "solar",
		key: "3-8",
		name: "妇女节"
	},
	{
		kind: "solar",
		key: "9-10",
		name: "教师节"
	},
	{
		kind: "solar",
		key: "7-1",
		name: "建党节"
	},
	{
		kind: "solar",
		key: "8-1",
		name: "建军节"
	},
	{
		kind: "solar",
		key: "10-31",
		name: "万圣夜"
	},
	{
		kind: "solar",
		key: "12-24",
		name: "平安夜",
		after: 0
	},
	{
		kind: "solar",
		key: "12-25",
		name: "圣诞节"
	}
];
const SOLAR_INDEX = new Map();
const LUNAR_INDEX = new Map();
const SEASON_ENTRIES = [];
let LUNAR_EVE;
PRIORITY.forEach((entry, priority) => {
	if (entry.kind === "solar") SOLAR_INDEX.set(entry.key, {
		entry,
		priority
	});
	else if (entry.kind === "lunar") LUNAR_INDEX.set(entry.key, {
		entry,
		priority
	});
	else if (entry.kind === "lunarEve") LUNAR_EVE = {
		entry,
		priority
	};
	else SEASON_ENTRIES.push({
		entry,
		priority,
		from: entry.from,
		to: entry.to
	});
});
/** 条目里最长的预热天数与回看距离（长假 15 天 + 回味 3 天），据此决定扫描窗口。 */
const HOLIDAY_ENTRIES = PRIORITY.filter((e) => e.kind !== "season");
const MAX_AHEAD = Math.max(...HOLIDAY_ENTRIES.map((e) => e.ahead ?? DEFAULT_AHEAD));
const MAX_LOOKBACK = Math.max(...HOLIDAY_ENTRIES.map((e) => (e.span ?? DEFAULT_SPAN) - 1 + (e.after ?? DEFAULT_AFTER)));

//#endregion
//#region src/host/time-context/lunar.ts
/** ICU 中国农历格式器；null = 已判定本环境不可用（不重试、不抛错）。 */
let lunarFormatter;
/**
* 取 ICU 农历格式器。Intl 在缺少该日历时不会抛错，而是静默退回公历——那会让每个月都被当成农历
* 同月同日，所以用 resolvedOptions().calendar 确认它真的解析成了 'chinese'，否则一律判不可用。
*/
function getLunarFormatter() {
	if (lunarFormatter === null) return void 0;
	if (!lunarFormatter) {
		const fmt = new Intl.DateTimeFormat("en-u-ca-chinese", {
			month: "numeric",
			day: "numeric",
			year: "numeric"
		});
		lunarFormatter = fmt.resolvedOptions().calendar === "chinese" ? fmt : null;
	}
	return lunarFormatter ?? void 0;
}
function dayOfYear(date) {
	return (Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(date.getFullYear(), 0, 1)) / DAY_MS$1;
}
function dayOfYearOf(year, monthDay) {
	const [month, day] = monthDay.split("-").map(Number);
	return (Date.UTC(year, (month ?? 1) - 1, day ?? 1) - Date.UTC(year, 0, 1)) / DAY_MS$1;
}
/**
* 公历日期 → 农历月日。
*
* 已知精度边界（已评估并接受）：朔时刻贴近 UTC+8 午夜时 ICU 会把农历初一放错一天——2025–2060 的
* 445 个月起点里错 2 个，都是正月（2027-02-06 距午夜 8 分钟、2030-02-03 距午夜 5 分钟），表现为那
* 两年春节与元宵各差一天；2027 一例已与香港天文台官方对照表核对。要绝对准确只需换掉本函数实现
* （换库或加修正表），下游逻辑一行不用动。
* @returns 农历月/日（闰月 month 为负）；环境不支持农历、取不到月日，或农历年与公历年不吻合
*   （自洽校验：农历年只可能是当年或前一年，挡住 ICU 退化时把公历当农历返回）→ undefined。
*/
function lunarPartsOf(date) {
	const fmt = getLunarFormatter();
	if (!fmt) return void 0;
	const parts = fmt.formatToParts(date);
	const pick = (type) => parts.find((p) => p.type === type)?.value;
	const rawMonth = pick("month");
	const rawDay = pick("day");
	const rawYear = pick("relatedYear") ?? pick("year");
	if (!rawMonth || !rawDay || !rawYear) return void 0;
	const month = Number.parseInt(rawMonth, 10);
	const day = Number.parseInt(rawDay, 10);
	const year = Number.parseInt(rawYear, 10);
	if (!Number.isFinite(month) || !Number.isFinite(day) || !Number.isFinite(year)) return void 0;
	const gregorianYear = date.getFullYear();
	if (year !== gregorianYear && year !== gregorianYear - 1) return void 0;
	return {
		month: /bis/i.test(rawMonth) ? -month : month,
		day
	};
}
/** 当天是否是除夕（腊月最后一天：次日为正月初一即成立，廿九/三十都能认）。 */
function isLunarEve(date) {
	const today = lunarPartsOf(date);
	if (!today || today.month !== 12) return false;
	const next = lunarPartsOf(new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1));
	return Boolean(next && next.month === 1 && next.day === 1);
}
function entriesAt(date) {
	const out = [];
	const solar = SOLAR_INDEX.get(date.getMonth() + 1 + "-" + date.getDate());
	if (solar) out.push(solar);
	const lunar = lunarPartsOf(date);
	if (lunar && lunar.month > 0) {
		const hit = LUNAR_INDEX.get(lunar.month + "-" + lunar.day);
		if (hit) out.push(hit);
	}
	if (LUNAR_EVE && isLunarEve(date)) out.push(LUNAR_EVE);
	return out;
}

//#endregion
//#region src/host/time-context/context.ts
/**
* 相位 → 从句措辞。
* @param entry - 节日条目；`name`/`spoken`/`span` 决定措辞与默认窗口。
* @param delta - 相对节日起始日的天数：> 0 = 还有这么多天；0 = 起始当天；< 0 = 已在节期内或过后。
*/
function phraseOf(entry, delta) {
	const span = entry.span ?? DEFAULT_SPAN;
	if (delta > 0) return delta === 1 ? "明天就是" + entry.name : "快要过" + entry.name + "了";
	if (delta === 0) return "今天是" + (entry.spoken ?? entry.name);
	const daysIn = -delta;
	if (daysIn < span) return span - daysIn === 1 ? entry.name + "假期最后一天了" : "还在" + entry.name + "假期里";
	const rest = daysIn - span;
	return rest <= 1 ? entry.name + "刚过完" : entry.name + "这么快就过完了";
}
/**
* 条目 → 候选从句（不在自身窗口内则返回 undefined）。
* @param ranked - 已排序条目；`priority` 高者先出候选。
* @param delta - 相对节日起始日的天数。
*/
function candidateOf(ranked, delta) {
	const { entry, priority } = ranked;
	const ahead = entry.ahead ?? DEFAULT_AHEAD;
	const span = entry.span ?? DEFAULT_SPAN;
	const after = entry.after ?? DEFAULT_AFTER;
	const daysIn = -delta;
	if (delta > 0) {
		if (delta > ahead) return void 0;
	} else if (delta < 0) {
		if (daysIn >= span + after) return void 0;
	}
	return {
		clause: phraseOf(entry, delta),
		priority
	};
}
/** 假期区间 → 候选从句（不在窗口内返回 undefined）。 */
function seasonCandidateOf(date) {
	const year = date.getFullYear();
	const today = dayOfYear(date);
	for (const ranked of SEASON_ENTRIES) {
		const { entry, priority, from: fromMd, to: toMd } = ranked;
		const name = entry.name;
		const from = dayOfYearOf(year, fromMd);
		const to = dayOfYearOf(year, toMd);
		if (today < from) {
			const ahead = from - today;
			if (ahead > SEASON_AHEAD) continue;
			return {
				clause: ahead === 1 ? "明天就放" + name + "了" : "快要放" + name + "了",
				priority
			};
		}
		if (today <= to) {
			if (today === from) return {
				clause: name + "开始了",
				priority
			};
			if (to - today < SEASON_ENDING_AHEAD) return {
				clause: name + "快结束了",
				priority
			};
			return {
				clause: "正在放" + name,
				priority
			};
		}
		const rest = today - to - 1;
		if (rest >= SEASON_AFTER) continue;
		return {
			clause: rest <= 1 ? name + "刚结束" : name + "这么快就过完了",
			priority
		};
	}
	return void 0;
}
/**
* 节日从句：扫描窗口内枚举每一天命中的条目、算出各自相位与措辞，取优先级最小（数组里最靠前）的那个。
* @returns 如「今天是大年初一」「快要过国庆节了」「还在春节假期里」「正在放暑假」；无节日时 ''。
*/
function holidayClauseOf(date) {
	let best;
	const keep = (candidate) => {
		if (candidate && (!best || candidate.priority < best.priority)) best = candidate;
	};
	for (let delta = -MAX_LOOKBACK; delta <= MAX_AHEAD; delta++) {
		const day = new Date(date.getFullYear(), date.getMonth(), date.getDate() + delta);
		for (const ranked of entriesAt(day)) keep(candidateOf(ranked, delta));
	}
	keep(seasonCandidateOf(date));
	return best ? best.clause : "";
}
function timeContextOf(date) {
	if (Number.isNaN(date.getTime())) return "";
	const day = date.getDay();
	const hour = date.getHours();
	const holiday = holidayClauseOf(date);
	return "【当下】现在是" + date.getFullYear() + "年" + (date.getMonth() + 1) + "月" + date.getDate() + "日" + (WEEKDAYS[day] ?? "星期?") + " " + pad2(hour) + ":" + pad2(date.getMinutes()) + "，" + timeSlotOf(hour) + "，" + dayKindOf(day) + (holiday ? "，" + holiday : "") + "。这只是背景，不必刻意报时，也别句句都提节日——多数时候正常说话就好，真贴切时才顺口带一句。";
}

//#endregion
//#region src/host/persona.ts
function petPersona(conf, pet) {
	const own$1 = pet.whisperPrompt;
	if (typeof own$1 === "string" && own$1.trim() !== "") return own$1;
	const entry = conf.whisperPrompt;
	return typeof entry === "string" ? entry : "";
}
function composeSystemPrompt(parts) {
	const name = String(parts.name || parts.id);
	const nameLine = name ? "你的名字是“" + name + "”。" : "";
	const lines = [parts.prompt, nameLine].filter((line) => line !== "");
	const time = timeContextOf(parts.now);
	if (time) lines.push(time);
	return lines.join("\n");
}

//#endregion
//#region src/host/whisper.ts
/** 单次生成超时（ms）：碎碎念不需要长输出，30s 足够。 */
const TIMEOUT_MS = 3e4;
/** 碎碎念指令：纯文本（没有配图时的原样请求）。 */
const USER_TEXT = "随便说一句日常碎碎念，一句就好，20 字以内。";
/** 梦话指令：睡觉期间嘟囔一句。与碎碎念指令同属「功能指令」，不进配置（配置里只有人设）。 */
const SLEEP_TALK_TEXT = "你正在睡觉，随便嘟囔一句梦话，一句就好，20 字以内；含糊、半梦半醒，不要清醒地回应任何人。";
const SLEEP_TALK_INSTRUCTION = SLEEP_TALK_TEXT;
/**
* 碎碎念指令：带表情包时要求模型配合作画说一句。
*
* 明确「正文仍是一句话」：图是配图，不是让模型描述画面本身。
* 图由调用方随机抽而不是让模型选：碎碎念没有上下文可依（人设固定、无用户输入），
* 交模型选只能盲选，还多一层幻觉风险。
*/
function userTextWithMeme(meme) {
	return "随便说一句日常碎碎念，一句就好，20 字以内。\n这次会配一张表情包一起显示，图的内容是：" + meme.name + "（" + meme.desc + "）。\n请让这句话和这张图的情绪/场景自然契合，像是配合画面说出来的；不要描述画面本身。";
}
async function generateWhisper(ctx, request) {
	const candidates = modelCandidates(ctx, request.preferred);
	if (candidates.length === 0) return {
		ok: false,
		reason: "provider-missing",
		message: "当前对话未配置模型"
	};
	const llm = ctx.llm;
	if (!llm || typeof llm.stream !== "function") return {
		ok: false,
		reason: "generate-error",
		message: "LLM 服务不可用"
	};
	let last = {
		ok: false,
		reason: "generate-error",
		message: noTextReason(void 0)
	};
	for (const [i, sel] of candidates.entries()) {
		const result = await generateWith(ctx, llm, sel, request);
		if (result.ok) return result;
		last = result;
		if (i + 1 < candidates.length) defaultLog("warn", `dsh-pet: 碎碎念用 ${modelLabel(sel)} 生成失败（${result.message ?? result.reason}），回落到 ${modelLabel(candidates[i + 1])}`);
	}
	return last;
}
/** 用一个确定的 provider/model 跑一次生成（候选链的一环；失败原样返回结构化原因，不吞）。 */
async function generateWith(ctx, llm, sel, request) {
	const deadline = AbortSignal.timeout(TIMEOUT_MS);
	const supportsOff = await supportsReasoningOff(ctx, sel.provider, sel.model);
	const options = {
		provider: sel.provider,
		model: sel.model,
		sessionId: PET_CALL_IDENTITY,
		messages: [createUserMessage({
			content: [{
				type: "text",
				text: request.instruction ?? (request.meme ? userTextWithMeme(request.meme) : USER_TEXT)
			}],
			source: { kind: "user" }
		})],
		system: request.system,
		temperature: 1,
		...supportsOff ? { reasoningEffort: ReasoningEffortId("off") } : {},
		signal: deadline
	};
	const assembler = new BlockAssembler();
	try {
		for await (const chunk of llm.stream(options)) assembler.push(chunk);
	} catch (e) {
		return {
			ok: false,
			reason: "generate-error",
			message: e instanceof Error ? e.message : String(e)
		};
	}
	const text = assembler.blocks().filter((b) => b.type === "text").map((b) => "text" in b ? b.text : "").join("").trim();
	if (!text) return {
		ok: false,
		reason: "generate-error",
		message: noTextReason(assembler.finish)
	};
	return request.meme ? {
		ok: true,
		text,
		image: request.meme.name
	} : {
		ok: true,
		text
	};
}

//#endregion
//#region src/host/plugin/memory-orphans.ts
function createMemoryOrphans(deps) {
	const { configPaths, readMemory, writeMemory, withLock } = deps;
	/** 读出配置里已不存在的宠物分桶；只看条数与最后时间，不带正文。 */
	const orphanHistory = async () => {
		const cfg = readAllConfig(configPaths);
		const mem = await readMemory();
		const out = [];
		for (const [entry, byPet] of Object.entries(mem)) {
			if (!byPet || typeof byPet !== "object") continue;
			for (const [petId, leaf] of Object.entries(byPet)) {
				if (findPetInstance(cfg, petId)) continue;
				const list = Array.isArray(leaf?.messages) ? leaf.messages : [];
				out.push({
					entry,
					petId,
					messages: list.length,
					lastTs: Number(list[list.length - 1]?.ts ?? 0)
				});
			}
		}
		return out;
	};
	/** 清掉所有残留分桶；空条目一并摘除。 */
	const deleteOrphans = async () => withLock(async () => {
		const cfg = readAllConfig(configPaths);
		const mem = await readMemory();
		let pets = 0;
		let messages = 0;
		for (const [entry, byPet] of Object.entries(mem)) {
			if (!byPet || typeof byPet !== "object") continue;
			for (const [petId, leaf] of Object.entries(byPet)) {
				if (findPetInstance(cfg, petId)) continue;
				messages += Array.isArray(leaf?.messages) ? leaf.messages.length : 0;
				pets += 1;
				delete byPet[petId];
			}
			if (Object.keys(byPet).length === 0) delete mem[entry];
		}
		if (pets > 0) await writeMemory(mem);
		deps.log.info(`[dsh-pet] 清理已删宠物的历史 pets=${pets}，messages=${messages}`);
		return {
			ok: true,
			pets,
			messages
		};
	});
	return {
		orphanHistory,
		deleteOrphans
	};
}

//#endregion
//#region src/host/plugin/chat-memory.ts
/** 这一句该由哪一端念：取宠物实例的 display 推导（桌面优先）；两端都不显示时为 `undefined`。 */
function voiceTargetFor(pet) {
	return pickVoiceSurface(String(pet.display ?? "")) ?? void 0;
}
function createChatMemory(deps) {
	const { ctx, configPaths, log, memeDirsFor, playback, state, userRoot } = deps;
	let activePetId = "";
	const lastWhisperAt = new Map();
	const memoryPath = join(userRoot, "memory.json");
	let chatQueue = Promise.resolve();
	/** 读记忆文件：不存在 → 空；解析失败/根不是对象 → 记日志 + 空记忆（不备份、不改写源文件） */
	const readMemory = async () => {
		let raw;
		try {
			raw = await readFile(memoryPath, "utf8");
		} catch {
			return {};
		}
		try {
			const parsed = JSON.parse(raw);
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
			return parsed;
		} catch (e) {
			log.error(`dsh-pet: 记忆文件无法解析（对话将从头开始）：${memoryPath}（${e instanceof Error ? e.message : String(e)}）`);
			return {};
		}
	};
	const writeMemory = async (mem) => {
		await mkdir(userRoot, { recursive: true });
		await writeFile(memoryPath, JSON.stringify(mem, null, 2), "utf8");
	};
	/** 把一次读写封进串行队列（同进程内防交错），返回 fn 的结果 */
	const withMemoryLock = (fn) => {
		const run$1 = chatQueue.then(fn, fn);
		chatQueue = run$1.then(() => void 0, () => void 0);
		return run$1;
	};
	/** 某宠物的最终人设 system：实例级 `pets[].whisperPrompt` 优先，没写回落到所属条目的那份。
	*  拼装在 ./persona（纯函数）：人设正文 + 名字声明 + 一行时间背景，时间每次现算。
	*  收 `findPetInstance` 的命中结果而不是 (petId, cfg)：调用方都已解析过，再查只会多一处
	*  「查不到就兜底 main」的不可达分支。 */
	const petSystemPrompt = (found) => composeSystemPrompt({
		prompt: petPersona(found.conf, found.pet),
		name: String(found.pet.name ?? ""),
		id: String(found.pet.id ?? ""),
		now: new Date()
	});
	/** 对话记忆轮数（1 轮 = 1 问 1 答）：该宠物所属条目的 chatMemoryRounds（合并器已填默认）。
	*  收已解析的条目配置：调用方都已拿到 `findPetInstance` 的结果。 */
	const memoryRounds = (conf) => {
		const v = Number(conf.chatMemoryRounds);
		return Number.isFinite(v) && v >= 0 ? Math.floor(v) : 5;
	};
	/** 生成并返回某宠物的一句碎碎念（周期调度、菜单手动触发与命令行共用）：人设取它自己的 whisperPrompt，
	*  没写回落到所属条目；成功写进 S 的 pets.<id>.say——碎碎念 / 命令气泡 / 对话回复在前端是同一条
	*  展示链路，所以共用一个叶子。配图开关开启时从表情包池随机抽 1 张。
	*  失败带回真实 reason（含 unknown-pet / unknown-image），成功带回生成的文本——调用方不必再拉一拍 /state。
	*
	*  @param petId - 目标宠物实例 id。
	*  @param image - 指定配图的名称：给了就只用这张（不受 whisperImageEnabled 门控，手动点图是显式意图），
	*  不在池内返回 unknown-image；缺省 = 按开关随机抽或纯文本。
	*  @param voiceTo - 这一句该由哪一端念；缺省按它自己的 display 推导（桌面优先，见 {@link pickVoiceSurface}）。
	*  路由层带 `?surface=` 的会显式传请求面，其余调用点留空即可。
	*  @param kind - 这次生成的来源：`whisper` = 周期调度，受 `voiceWhisperEnabled` 管；`manual` = 菜单、
	*  斜杠命令、路由主动触发，不看那个开关（用户主动点的就是这一句）。缺省 `manual`。
	*/
	const publishWhisper = async (petId, image, voiceTo, kind = "manual") => {
		const cfg = readAllConfig(configPaths);
		const found = findPetInstance(cfg, petId);
		if (!found) return {
			ok: false,
			reason: "unknown-pet",
			message: "没有这只桌宠：" + petId
		};
		const whisperVoiceOn = cfg.main?.voiceWhisperEnabled === true;
		const target = kind === "whisper" && !whisperVoiceOn ? void 0 : voiceTo ?? voiceTargetFor(found.pet);
		const system = petSystemPrompt(found);
		const pool = readMemePool(found.conf.memes, memeDirsFor(found.entry));
		const forced = image === void 0 ? void 0 : matchMeme(pool, image);
		if (image !== void 0 && forced === void 0) return {
			ok: false,
			reason: "unknown-image",
			message: "表情包不在池内：" + image
		};
		const meme = forced ?? (found.conf.whisperImageEnabled === true ? pickMeme(pool) : void 0);
		const result = await generateWhisper(ctx, {
			system,
			meme,
			preferred: configuredModel(found.conf, "whisperModel")
		});
		if (!result.ok) {
			log.warn("[dsh-pet] 碎碎念生成失败 pet=" + petId + " reason=" + result.reason + (result.message ? " " + result.message : ""));
			return result;
		}
		state.writePet(petId, "say", {
			text: result.text,
			...result.image ? { image: result.image } : {},
			...target ? { voiceTo: target } : {}
		});
		log.info(`[dsh-pet] 碎碎念生成成功 pet=${petId}，${result.text.length} 字` + (result.image ? `，配图=${result.image}` : ""));
		return {
			ok: true,
			text: result.text,
			...result.image ? { image: result.image } : {}
		};
	};
	/** 生成并写一句梦话：system 只用人设，功能指令在 whisper（与碎碎念同属代码常量）；不配图、不念、不换动画。
	*  睡着时「换动画」本身就是打扰，所以写 `say` 显式 `anim: false`，也不写 `voiceTo`。
	*  @returns 是否真的生成并写进了 S；失败只留一行日志，调度下一拍再试。 */
	const publishSleepTalk = async (petId) => {
		const cfg = readAllConfig(configPaths);
		const found = findPetInstance(cfg, petId);
		if (!found) return false;
		const system = petSystemPrompt(found);
		const result = await generateWhisper(ctx, {
			system,
			preferred: configuredModel(found.conf, "whisperModel"),
			instruction: SLEEP_TALK_INSTRUCTION
		});
		if (!result.ok) {
			log.warn("[dsh-pet] 梦话生成失败 pet=" + petId + " reason=" + result.reason + (result.message ? " " + result.message : ""));
			return false;
		}
		state.writePet(petId, "say", {
			text: result.text,
			anim: false
		});
		log.info(`[dsh-pet] 梦话生成成功 pet=${petId}，${result.text.length} 字`);
		return true;
	};
	/** 与某只宠物对话：截取最近记忆 → 生成回复 → 写入记忆 → 写进 S 的 pets.<id>.say。
	*  供 POST /chat 与 /chat 命令共用（锁内读写，防两端交错写盘）；成功带回回复文本。 */
	const chatWithPet = async (petId, text, image) => withMemoryLock(async () => {
		const cfg = readAllConfig(configPaths);
		const found = findPetInstance(cfg, petId);
		if (!found) return {
			ok: false,
			reason: "unknown-pet",
			message: "没有这只桌宠：" + petId
		};
		const rounds = memoryRounds(found.conf);
		const system = petSystemPrompt(found);
		const pool = found.conf.chatImageEnabled === true ? limitPool(readMemePool(found.conf.memes, memeDirsFor(found.entry)), Number(found.conf.chatImageLimit)) : [];
		const actions = found.conf.chatAnimationEnabled === true ? chatActionNames(found.conf.animations) : [];
		const mem = await readMemory();
		const bucket = mem[found.entry] && typeof mem[found.entry] === "object" && !Array.isArray(mem[found.entry]) ? mem[found.entry] : mem[found.entry] = {};
		const existing = bucket[petId];
		if (existing !== void 0 && (!existing || !Array.isArray(existing.messages))) log.error(`[dsh-pet] 记忆结构异常（messages 不是数组）pet=${petId}，按新会话处理：${memoryPath}`);
		const entry = existing && Array.isArray(existing.messages) ? existing : bucket[petId] = { messages: [] };
		const list = sliceMemoryRounds(entry.messages, rounds);
		if (image !== void 0) log.info(`[dsh-pet] 对话附带图片 pet=${petId}，${image.width}x${image.height}，${image.bytes} 字节（模型不支持读图时内核会以占位文本代替）`);
		const generated = await generateChat({
			ctx,
			system,
			history: list,
			userText: text,
			pool,
			actions,
			preferred: configuredModel(found.conf, "chatModel"),
			image
		});
		if (!generated.ok) return generated;
		const now = Date.now();
		entry.messages.push({
			role: "user",
			content: text,
			ts: now,
			...image ? { image } : {}
		});
		entry.messages.push({
			role: "assistant",
			content: generated.text,
			ts: now,
			...generated.image ? { meme: generated.image } : {},
			...generated.action ? { action: generated.action } : {}
		});
		await writeMemory(mem);
		if (generated.action !== void 0) {
			const record = playback.create(petId, generated.action);
			state.writePet(petId, "anim", {
				name: generated.action,
				playbackId: record.playbackId
			});
		}
		const replyVoiceTo = voiceTargetFor(found.pet);
		if (generated.text !== "") state.writePet(petId, "say", {
			text: generated.text,
			...generated.image ? { image: generated.image } : {},
			...generated.action !== void 0 ? { anim: false } : {},
			...replyVoiceTo ? { voiceTo: replyVoiceTo } : {}
		});
		return {
			ok: true,
			text: generated.text,
			...generated.image ? { image: generated.image } : {}
		};
	});
	/** 删除某只宠物的对话记忆：`ts` 缺省 = 清空全部，给了 ts = 只删命中的轮（一轮两条共享 ts，成对删）。
	*  与对话共用同一条串行队列——删除不会插进一次回复的读-改-写中间，也不会被它覆盖写回。
	*  删空的宠物连叶子与空条目一起摘掉：否则 memory.json 里会永久堆着空对象，看不出这里曾有历史。 */
	const deleteHistory = async (petId, ts) => withMemoryLock(async () => {
		const cfg = readAllConfig(configPaths);
		const found = findPetInstance(cfg, petId);
		if (!found) return {
			ok: false,
			reason: "unknown-pet",
			message: "没有这只桌宠：" + petId
		};
		const mem = await readMemory();
		const byPet = mem[found.entry];
		const before = byPet?.[petId]?.messages;
		const list = Array.isArray(before) ? before : [];
		const kept = ts === void 0 ? [] : removeRoundsByTs(list, ts).messages;
		const removed = list.length - kept.length;
		if (removed > 0) {
			const leaf = byPet?.[petId];
			if (kept.length > 0 && leaf !== void 0) leaf.messages = kept;
			else if (byPet !== void 0) {
				delete byPet[petId];
				if (Object.keys(byPet).length === 0) delete mem[found.entry];
			}
			await writeMemory(mem);
		}
		log.info(`[dsh-pet] 删除对话记忆 pet=${petId}，removed=${removed}` + (ts === void 0 ? "（清空）" : ""));
		return {
			ok: true,
			removed
		};
	});
	/** 已删宠物残留历史的查询与清理（判定与读写细节见 ./memory-orphans）。 */
	const { orphanHistory, deleteOrphans } = createMemoryOrphans({
		configPaths,
		readMemory,
		writeMemory,
		withLock: withMemoryLock,
		log
	});
	/** 当前活跃宠物 id（会话事件写入，余额与碎念读取）。 */
	const getActivePetId = () => activePetId;
	/** 改写当前活跃宠物 id。 */
	const setActivePetId = (id) => {
		activePetId = id;
	};
	return {
		lastWhisperAt,
		memoryPath,
		readMemory,
		memoryRounds,
		publishWhisper,
		publishSleepTalk,
		chatWithPet,
		deleteHistory,
		orphanHistory,
		deleteOrphans,
		getActivePetId,
		setActivePetId
	};
}

//#endregion
//#region src/host/plugin/session-notify.ts
function createSessionNotify(deps) {
	const { ctx, publishWorkStatus, state, workStatus } = deps;
	const pushNotifyFrame = (frame) => {
		state.writeSection("notify", frame);
	};
	const turnFlags = new Map();
	/** 终态（success/error）展示窗口定时器：约 60s 后清掉该会话条目，陈旧完成态不再浮上来。 */
	const terminalTimers = new Map();
	const TERMINAL_KEEP_MS = 60 * 1e3;
	/**
	* 每会话最近一条 todo 文案：工具跑完要把气泡「还」给它。没有这份缓存，`tool/result` 写 null
	* 就只能回落到通用档位文案，用户刚看到的清单进度会被抹掉。
	*/
	const lastTodoText = new Map();
	/**
	* 每会话最后一段回复文本：完成通知的正文靠它。排活动门定时器时取用即出队——活动门会把它延后
	* 1.5s，但待确认期间文本不会再变；留到定时器里再删，遇到「判定还有活」提前返回就成了长期残留。
	*/
	const lastReplyText = new Map();
	/**
	* 每会话在途调用的详情：键为调用标识（缺标识时用临时 `Symbol`），值为气泡文案。
	* 结果事件只删自己那一条，并行调用因此不会互相顶掉，全部删完才回落 todo 文案。
	*/
	const toolsInFlight = new Map();
	/** 取消某会话待执行的终态清理：会话已回到非终态，那次清理到点后既不清理也不重排，留着只会误导 */
	const cancelTerminalCleanup = (sessionId) => {
		const t = terminalTimers.get(sessionId);
		if (t === void 0) return;
		clearTimeout(t);
		terminalTimers.delete(sessionId);
	};
	/** 排一个终态清理定时器（每会话一个，已排则跳过） */
	const scheduleTerminalCleanup = (sessionId) => {
		if (terminalTimers.has(sessionId)) return;
		const t = setTimeout(() => {
			terminalTimers.delete(sessionId);
			const sessionState = workStatus.stateOf(sessionId);
			if (sessionState === "success" || sessionState === "error") {
				workStatus.clear(sessionId);
				turnFlags.delete(sessionId);
				lastTodoText.delete(sessionId);
				toolsInFlight.delete(sessionId);
				publishWorkStatus();
			}
		}, TERMINAL_KEEP_MS);
		terminalTimers.set(sessionId, t);
	};
	const NOTIFY_ACTIVITY_DELAY_MS = 1500;
	/** 每会话一个待查定时器（同会话连续收尾只保留最后一次：后到覆盖先到，与单槽帧同语义） */
	const notifyActivityTimers = new Map();
	/** 这条会话是否还有在跑的活；判据不可用一律 false＝放行 */
	const sessionHasRunningWork = async (sessionId) => {
		const waterfall = ctx.waterfall;
		if (typeof waterfall !== "function") return false;
		try {
			const activity = await waterfall.call(ctx, "workspace/session-activity", { sessionId }, () => Promise.resolve([]));
			return hasBlockingActivity(activity);
		} catch {
			return false;
		}
	};
	/** 排一个活动门定时器：到点确认空闲才推这一帧 */
	const scheduleCompletionNotify = (sessionId, event) => {
		const replyText = lastReplyText.get(sessionId);
		lastReplyText.delete(sessionId);
		const prev = notifyActivityTimers.get(sessionId);
		if (prev !== void 0) clearTimeout(prev);
		notifyActivityTimers.set(sessionId, setTimeout(() => {
			notifyActivityTimers.delete(sessionId);
			(async () => {
				if (await sessionHasRunningWork(sessionId)) return;
				const frame = reduceNotifyFrame(event, replyText);
				if (frame) pushNotifyFrame(withSessionId(frame, sessionId));
			})();
		}, NOTIFY_ACTIVITY_DELAY_MS));
	};
	return {
		pushNotifyFrame,
		turnFlags,
		terminalTimers,
		lastTodoText,
		lastReplyText,
		toolsInFlight,
		cancelTerminalCleanup,
		scheduleTerminalCleanup,
		notifyActivityTimers,
		scheduleCompletionNotify
	};
}

//#endregion
//#region src/host/lock.ts
const LOCK_DEFAULT_TTL_MS = 2 * 60 * 1e3;
const LOCK_MIN_TTL_MS = 1 * 1e3;
const LOCK_MAX_TTL_MS = 30 * 60 * 1e3;
/** cause → 给人看的一句话（回执里的 message；reason 才是机器读的那个）。 */
const CAUSE_TEXT = {
	expired: "占用已过期（没有及时续期）",
	released: "占用已被释放",
	preempted: "占用已被用户接管（拖拽/点击/隐藏/关闭）",
	unknown: "lock 不是当前生效的占用编号"
};
/** ttl 合法性说明（路由与决策层共用同一条规则，免得两处走样）。 */
const TTL_TEXT = `ttl 必须是 ${LOCK_MIN_TTL_MS}~${LOCK_MAX_TTL_MS} 之间的有限数字（毫秒）`;
function normalizeLockTtl(ttl, fallback) {
	if (ttl === void 0 || ttl === null) return fallback;
	if (typeof ttl !== "number" || !Number.isFinite(ttl)) return null;
	if (ttl < LOCK_MIN_TTL_MS || ttl > LOCK_MAX_TTL_MS) return null;
	return ttl;
}
/** lockId 规范化：缺省 / null → 空串（= 没给，走新建那条路）；非字符串 → null（非法）。
*  空串按「没给」处理是有意的（与 image / url 的宽松口径一致）。 */
function normalizeLockId(v) {
	if (v === void 0 || v === null) return "";
	if (typeof v !== "string") return null;
	return v.trim();
}
var LockStore = class {
	constructor(opts) {
		this.locks = new Map();
		this.tombstones = new Map();
		this.seq = 0;
		this.now = opts?.now ?? Date.now;
		this.onChange = opts?.onChange ?? (() => {});
	}
	/**
	* 当前占用（懒判过期）。到点即视为没有：清记录、记墓碑、同步一次叶子。
	*
	* 读方法带一次副作用是有意的：叶子是渲染端唯一能看到的信号，而宿主这一侧没有任何定时器——
	* 任一动作端点或内部来源调一次本方法，过期的锁就会被清掉并如实写进 S；即便一次都没人调，
	* 渲染端也会按叶子里的 expiresAt 自己解除静止。
	*/
	current(petId) {
		const rec = this.locks.get(petId);
		if (rec === void 0) return null;
		if (this.now() < rec.expiresAt) return rec;
		this.drop(petId, rec, "expired");
		return null;
	}
	/** 这只宠物此刻是否被占用（宿主内部自动来源用它决定跳过；同样懒判过期）。 */
	locked(petId) {
		return this.current(petId) !== null;
	}
	/**
	* 当前是否有任意宠物被占用（测试 / 观测用，同 ./state 的 waiterCount）。
	*
	* 生产路径上没有人调它：占用期间要挡的两个全局段（sections.balance / sections.workStatus）是
	* 所有宠物共用一份，宿主跳过写入会连带静音别的宠物，所以那两处改由渲染端按宠物自己忽略。
	*/
	anyLocked() {
		for (const petId of [...this.locks.keys()]) if (this.current(petId) !== null) return true;
		return false;
	}
	/**
	* 动作端点的门禁（/anim、/broadcast、/position、/throw、/bubble/clear 共用）。
	*
	* 无锁时按有没有带编号分两条：没带 → 放行（没有占用的常态下，既有调用方一个字都不用改）；
	* 带了编号却查不到锁 → lock-lost。带了编号就说明调用方以为自己还持有，这时放行等于把「你把锁
	* 丢了」悄悄抹掉，它会以为演出还在继续。cause 从墓碑里取，从没建过锁就是 unknown。
	*/
	gate(petId, provided) {
		const rec = this.current(petId);
		if (rec !== null) {
			if (provided && provided === rec.lockId) return { ok: true };
			if (!provided) return {
				ok: false,
				reason: "lock-required",
				message: "这只桌宠正被占用，必须带 lock=<lockId>"
			};
			return {
				ok: false,
				reason: "lock-lost",
				cause: "unknown",
				message: CAUSE_TEXT.unknown
			};
		}
		if (!provided) return { ok: true };
		const cause = this.causeOf(petId, provided);
		return {
			ok: false,
			reason: "lock-lost",
			cause,
			message: CAUSE_TEXT[cause]
		};
	}
	/**
	* 取锁 / 续期（二合一：`lockId` 给了就是续期，没给就是新建；真值表见 openapi.yaml）。
	*
	* 「有 id + 当前无锁」一律报错，不复活：过期 / 被释放 / 被抢占之后拿旧编号来续期，不能借这条路
	* 把锁重新建起来——否则「我丢了锁」这件事会被悄悄抹掉，持锁者会以为演出还在继续。
	*/
	acquire(args) {
		const { petId } = args;
		const renewId = normalizeLockId(args.lockId);
		if (renewId === null) return {
			ok: false,
			reason: "bad-request",
			message: "lockId 必须是字符串"
		};
		const rec = this.current(petId);
		if (renewId) {
			if (rec === null || rec.lockId !== renewId) {
				const cause = rec === null ? this.causeOf(petId, renewId) : "unknown";
				return {
					ok: false,
					reason: "lock-lost",
					cause,
					message: CAUSE_TEXT[cause]
				};
			}
			const ttl$1 = normalizeLockTtl(args.ttl, rec.ttl);
			if (ttl$1 === null) return {
				ok: false,
				reason: "bad-request",
				message: TTL_TEXT
			};
			rec.ttl = ttl$1;
			rec.expiresAt = this.now() + ttl$1;
			this.onChange(petId, {
				locked: true,
				expiresAt: rec.expiresAt
			});
			return {
				ok: true,
				petId,
				lockId: rec.lockId,
				expiresAt: rec.expiresAt,
				renewed: true
			};
		}
		if (rec !== null) return {
			ok: false,
			reason: "locked",
			expiresAt: rec.expiresAt,
			message: "这只桌宠已被占用"
		};
		const ttl = normalizeLockTtl(args.ttl, LOCK_DEFAULT_TTL_MS);
		if (ttl === null) return {
			ok: false,
			reason: "bad-request",
			message: TTL_TEXT
		};
		const record = {
			lockId: this.newId(),
			ttl,
			expiresAt: this.now() + ttl
		};
		this.locks.set(petId, record);
		this.tombstones.delete(petId);
		this.onChange(petId, {
			locked: true,
			expiresAt: record.expiresAt
		});
		return {
			ok: true,
			petId,
			lockId: record.lockId,
			expiresAt: record.expiresAt,
			renewed: false
		};
	}
	/**
	* 释放。两种形态二选一：`lockId` = 持锁者收工（cause: released），
	* `force: true` = 渲染端在用户拖拽 / 点击 / 隐藏 / 关闭时调（cause: preempted）。
	*
	* 幂等：当前没有锁时回 ok（released: false）——「让锁消失」这个意图在空状态下已经成立；
	* 但有锁而 lockId 不匹配时必须报错（不许误放别人的锁），那是唯一一条释放也会失败的路。
	* force 只认严格 true：宽松口径会把误传当真，代价是撤掉别人的锁。
	*/
	release(args) {
		const { petId } = args;
		const force = args.force === true;
		const releaseId = normalizeLockId(args.lockId);
		if (releaseId === null) return {
			ok: false,
			reason: "bad-request",
			message: "lockId 必须是字符串"
		};
		if (force && releaseId) return {
			ok: false,
			reason: "bad-request",
			message: "lockId 与 force 只能给一个"
		};
		if (!force && !releaseId) return {
			ok: false,
			reason: "bad-request",
			message: "lockId 或 force 必须给一个"
		};
		const rec = this.current(petId);
		if (rec === null) return {
			ok: true,
			petId,
			released: false
		};
		if (!force && rec.lockId !== releaseId) return {
			ok: false,
			reason: "lock-lost",
			cause: "unknown",
			message: CAUSE_TEXT.unknown
		};
		this.drop(petId, rec, force ? "preempted" : "released");
		return {
			ok: true,
			petId,
			released: true
		};
	}
	/** 撤掉全部占用（插件卸载路径）：不这样做的话，渲染端要等 TTL 到点才解除静止。 */
	releaseAll() {
		for (const petId of [...this.locks.keys()]) {
			const rec = this.locks.get(petId);
			if (rec !== void 0) this.drop(petId, rec, "released");
		}
	}
	/** 撤锁并记墓碑（唯一改状态的出口：释放 / 抢占 / 过期都走它，保证叶子与墓碑不漏写）。 */
	drop(petId, rec, cause) {
		this.locks.delete(petId);
		this.tombstones.set(petId, {
			lockId: rec.lockId,
			cause
		});
		this.onChange(petId, { locked: false });
	}
	/** 墓碑查询：编号对得上就回它当初的 cause，否则 unknown（拿错编号 / 从来没有过）。 */
	causeOf(petId, lockId) {
		const stone = this.tombstones.get(petId);
		return stone !== void 0 && stone.lockId === lockId ? stone.cause : "unknown";
	}
	/** 新编号：`lk-<时间36>-<自增36>`（与 ./playback 的 playbackId 同一套，只保证一次运行内唯一）。 */
	newId() {
		return "lk-" + this.now().toString(36) + "-" + (++this.seq).toString(36);
	}
};

//#endregion
//#region src/host/plugin/pet-lookup.ts
function createPetLookup(deps) {
	const { configPaths, state } = deps;
	const lock = new LockStore({ onChange: (petId, data) => state.writePet(petId, "lock", data) });
	const pose = new PoseStore();
	const sleep = new SleepStore({ onChange: (petId, data) => state.writePet(petId, "sleep", data) });
	/** 该条目的睡觉拒绝台词。台词只有配置一个来源（默认值在 assets/config.jsonc，合并层负责回落）；
	*  池为空说明配置损坏，这时返回 undefined，宁可不说话也不在代码里另抄一份文案。 */
	const refuseText = (petId) => {
		try {
			const found = findPetInstance(readAllConfig(configPaths), petId);
			return pickSleepText(sleepTextsOf(found?.conf ?? {}).refuse);
		} catch {
			return void 0;
		}
	};
	/**
	* 睡觉闸门（手动触发与第三方调用共用）：在睡 → 弹一句拒绝台词并返回 `sleeping`；否则放行回 null。
	*
	* 持锁时让路：取锁时会先把宠物叫醒，正常情况下走不到这里；留着它是「锁叶子回到渲染端之前」
	* 那一小段竞态的兜底（宿主已受理锁、渲染端状态还没跟上）。
	* 拒绝台词写进 `say` 且 `anim: false`——睡觉期间不换动画，只弹气泡。
	*/
	const sleepBlocked = (petId) => {
		if (!sleep.sleeping(petId)) return null;
		if (lock.locked(petId)) return null;
		const text = refuseText(petId);
		if (text !== void 0) state.writePet(petId, "say", {
			text,
			anim: false
		});
		return failResult("sleeping", "桌宠正在睡觉，先叫醒它");
	};
	/**
	* `?surface=` 的参数级校验（缺省 / 非法 → `bad-request`）。放在读盘之前：必然失败的请求不碰磁盘；
	* 通过则给出收窄后的取值。
	*/
	const surfaceParam = (params) => {
		const want = normalizeSurface(params.get("surface"));
		if (want !== null) return {
			ok: true,
			want
		};
		return {
			ok: false,
			res: failResult("bad-request", SURFACE_TEXT)
		};
	};
	/**
	* `?surface=` 与该宠物 `display` 的对齐校验：不满足 → `pet-not-displayed`，并把实际 display
	* 原样回给调用方；放行回 null。
	* 这是前置校验，不是按面分发——指令照旧写进同一个叶子、两端内容完全一致。
	*/
	const surfaceMismatch = (pet, petId, want) => {
		const display = String(pet.display ?? "");
		if (displayCovers(want, display)) return null;
		return failResult("pet-not-displayed", petId + " 的显示模式是 " + display + "，不满足 surface=" + want, { display });
	};
	/**
	* 决策函数之后的 surface 校验（/anim、/broadcast、/bubble/clear、/position、/throw 共用）：
	* 这几条的 pet 解析住在各自决策模块里，所以按 petId 再查一次实例取 display。
	* 位置与 lockBlocked 一致——都在决策函数之后、任何副作用之前，顺序是「body → pet → surface → 锁」。
	*/
	const surfaceBlocked = (cfg, petId, params) => {
		const p = surfaceParam(params);
		if (!p.ok) return p.res;
		return surfaceMismatch(findPetInstance(cfg, petId)?.pet ?? {}, petId, p.want);
	};
	/**
	* 路由层的 pet 参数解析（/lock、/lock/release、/whisper、/chat 用；其余动作端点的同一套校验
	* 住在各自决策模块里，口径一致）：必填且必须真实存在。
	*
	* 两种失败分开报：没给 / 空串 → `pet-required`；给了但配置里没有 → `unknown-pet`。
	* 绝不默认退到列表第一只——落点会随用户 /pet 操作漂移，失败也不报，第三方无从预期。
	*
	* `cfg` 传惰性读取：pet 空串时不必碰磁盘（routes.test.ts 的「配置不可达」断言靠这个顺序钉住）。
	* `opts.surface` 只对会产生渲染端可见效果的端点开；/lock/release 与 /chat 的 GET 不开——
	* 释放必须永远能成功，读记忆与显示在哪一端无关。
	*/
	const requirePet = (params, cfg, opts) => {
		const fail$1 = (reason, message) => ({
			ok: false,
			res: failResult(reason, message)
		});
		const petId = String(params.get("pet") ?? "").trim();
		if (!petId) return fail$1("pet-required", "pet 必填：要指定操作哪只桌宠");
		let want = null;
		if (opts?.surface === true) {
			const p = surfaceParam(params);
			if (!p.ok) return {
				ok: false,
				res: p.res
			};
			want = p.want;
		}
		const found = findPetInstance(cfg(), petId);
		if (!found) return fail$1("unknown-pet", "没有这只桌宠：" + petId);
		if (want !== null) {
			const mismatch = surfaceMismatch(found.pet, petId, want);
			if (mismatch) return {
				ok: false,
				res: mismatch
			};
		}
		return {
			ok: true,
			petId,
			entry: found.entry,
			conf: found.conf,
			pet: found.pet
		};
	};
	/**
	* 动作端点的占用门禁（/anim、/broadcast、/position、/throw、/bubble/clear 共用）：放行回 null。
	* 无锁时按「有没有带 lock」分流：没带 → 放行（既有调用方零改动）；带了但查不到 → `lock-lost`。
	* 位置在决策函数之后：petId 要先解析出来才知道问哪只宠物的锁，而那时还没有任何副作用。
	*/
	const lockBlocked = (petId, params) => {
		const g = lock.gate(petId, String(params.get("lock") ?? ""));
		if (g.ok) return null;
		return failResult(g.reason, g.message, g.reason === "lock-lost" ? { cause: g.cause } : void 0);
	};
	return {
		lock,
		pose,
		sleep,
		sleepBlocked,
		sleepRefusalText: refuseText,
		surfaceBlocked,
		requirePet,
		lockBlocked
	};
}

//#endregion
//#region src/host/plugin/download-report.ts
function createDownloadReport(deps) {
	const { EXTERNAL_WORK_SESSION, nextExternalWorkSeq, publishWorkStatus, workStatus } = deps;
	/** Electron 下载日志的收尾槽位保留时长（ms）：够看清「就绪 / 失败」，又不让这条日志一直盖住
	*  随后真实的工作状态（终态档在渲染端本来也会 10s 自动收起气泡）。 */
	const DOWNLOAD_SLOT_CLEAR_MS = 12 * 1e3;
	let downloadSlotTimer = null;
	/**
	* 写一条 Electron 下载日志进工作状态：桌面版用户没有控制台，这是唯一能看到「后台在下什么」的地方。
	* 借外部写入槽 `api`（不新增 section）；先 setState 再 setTask（条目不存在时 setTask 直接返回 false），
	* seq 必须递增（同档位且 seq 未更新时 setState 短路），文案按 TASK_TEXT_MAX 截断。
	*/
	const reportDownload = (text, state, terminal = false) => {
		const points = Array.from(text);
		const task = points.length > TASK_TEXT_MAX ? `${points.slice(0, TASK_TEXT_MAX).join("")}…` : text;
		workStatus.setState(EXTERNAL_WORK_SESSION, state, nextExternalWorkSeq());
		workStatus.setTask(EXTERNAL_WORK_SESSION, task);
		publishWorkStatus();
		if (!terminal) return;
		if (downloadSlotTimer !== null) clearTimeout(downloadSlotTimer);
		downloadSlotTimer = setTimeout(() => {
			downloadSlotTimer = null;
			if (workStatus.clear(EXTERNAL_WORK_SESSION)) publishWorkStatus();
		}, DOWNLOAD_SLOT_CLEAR_MS);
		downloadSlotTimer.unref?.();
	};
	/** 停掉挂起的清槽定时器（插件卸载时调用）。 */
	const stopDownloadSlotTimer = () => {
		if (downloadSlotTimer !== null) {
			clearTimeout(downloadSlotTimer);
			downloadSlotTimer = null;
		}
	};
	return {
		reportDownload,
		stopDownloadSlotTimer
	};
}

//#endregion
//#region src/host/plugin/work-status-bridge.ts
function createWorkStatusBridge(deps) {
	const { state, workStatus } = deps;
	const WORK_STATE_GAP_MS = 5e3;
	let publishedWork = "\0";
	let publishedState = null;
	let publishedWorkAt = 0;
	let workFlushTimer = null;
	const publishWorkStatus = () => {
		const snap = workStatus.snapshot();
		const key = String(snap.state) + "\0" + String(snap.task);
		if (key === publishedWork) return;
		const busyFlip = publishedState === "working" && snap.state === "result";
		const wait = WORK_STATE_GAP_MS - (Date.now() - publishedWorkAt);
		if (busyFlip && wait > 0) {
			workFlushTimer ??= setTimeout(() => {
				workFlushTimer = null;
				publishWorkStatus();
			}, wait);
			return;
		}
		if (workFlushTimer !== null) {
			clearTimeout(workFlushTimer);
			workFlushTimer = null;
		}
		publishedWork = key;
		publishedState = snap.state;
		publishedWorkAt = Date.now();
		state.writeSection("workStatus", {
			state: snap.state,
			task: snap.task
		});
	};
	/** 停掉挂起的补写定时器（插件卸载时调用）。 */
	const stopWorkStatusFlush = () => {
		if (workFlushTimer !== null) {
			clearTimeout(workFlushTimer);
			workFlushTimer = null;
		}
	};
	return {
		publishWorkStatus,
		stopWorkStatusFlush
	};
}

//#endregion
//#region src/host/todo/policy.ts
const MINUTE_MS = 60 * 1e3;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
/** 到期前的提醒档位：`[至少还剩多少毫秒, 提醒间隔]`，从宽到窄匹配。 */
const AHEAD_STEPS = [
	[3 * DAY_MS, DAY_MS],
	[DAY_MS, 12 * HOUR_MS],
	[6 * HOUR_MS, 4 * HOUR_MS],
	[HOUR_MS, HOUR_MS],
	[15 * MINUTE_MS, 20 * MINUTE_MS],
	[0, 5 * MINUTE_MS]
];
/** 逾期后的提醒间隔：1 天内 30 分钟一次，一周内 6 小时一次，再久就不再打扰。 */
const OVERDUE_FRESH_INTERVAL_MS = 30 * MINUTE_MS;
const OVERDUE_OLD_INTERVAL_MS = 6 * HOUR_MS;
/** 逾期超过这么久就不再提醒（待办仍留在清单里，等用户自己处理）。 */
const OVERDUE_STOP_MS = 7 * DAY_MS;
/** 距离到期还有这么久之前完全不提醒：一个月的远期事项不值得天天念。 */
const AHEAD_START_MS = 7 * DAY_MS;
/** 提醒文案里引用正文的长度上限（码点）：气泡放不下整条待办。 */
const REMINDER_TEXT_MAX = 18;
function reminderIntervalMs(remainingMs) {
	if (remainingMs <= 0) {
		const overdueBy = -remainingMs;
		if (overdueBy >= OVERDUE_STOP_MS) return Number.POSITIVE_INFINITY;
		return overdueBy >= DAY_MS ? OVERDUE_OLD_INTERVAL_MS : OVERDUE_FRESH_INTERVAL_MS;
	}
	if (remainingMs > AHEAD_START_MS) return Number.POSITIVE_INFINITY;
	for (const [minRemaining, interval] of AHEAD_STEPS) if (remainingMs >= minRemaining) return interval;
	return 5 * MINUTE_MS;
}
function nextReminderAt(todo, now) {
	if (todo.done || todo.dueAt === null) return null;
	const intervalNow = reminderIntervalMs(todo.dueAt - now);
	if (!Number.isFinite(intervalNow)) return null;
	if (todo.lastRemindedAt !== null) return todo.lastRemindedAt + intervalNow;
	const remainingAtCreation = todo.dueAt - todo.createdAt;
	if (remainingAtCreation > AHEAD_START_MS) return todo.createdAt + intervalNow;
	const intervalAtCreation = reminderIntervalMs(remainingAtCreation);
	const step = Math.min(Number.isFinite(intervalAtCreation) ? intervalAtCreation : 0, Math.max(0, remainingAtCreation));
	return todo.createdAt + step;
}
function pickReminder(todos, now) {
	let best = null;
	for (const todo of todos) {
		const at = nextReminderAt(todo, now);
		if (at === null || at > now) continue;
		if (best === null || at < best.at) {
			best = {
				todo,
				at
			};
			continue;
		}
		if (at === best.at) {
			const todoDue = todo.dueAt ?? Number.POSITIVE_INFINITY;
			const bestDue = best.todo.dueAt ?? Number.POSITIVE_INFINITY;
			if (todoDue < bestDue) best = {
				todo,
				at
			};
		}
	}
	return best;
}
function spanText(ms) {
	const minutes = Math.max(1, Math.round(Math.abs(ms) / MINUTE_MS));
	if (minutes < 60) return `${minutes}分钟`;
	const hours = Math.max(1, Math.round(minutes / 60));
	if (hours < 24) return `${hours}小时`;
	return `${Math.max(1, Math.round(hours / 24))}天`;
}
function truncateTodoText(text, max) {
	const chars = Array.from(text);
	return chars.length <= max ? text : chars.slice(0, max).join("") + "…";
}
function reminderText(todo, now) {
	const label = truncateTodoText(todo.text, REMINDER_TEXT_MAX);
	const dueAt = todo.dueAt ?? now;
	if (dueAt <= now) {
		if (now - dueAt < MINUTE_MS) return `「${label}」到点啦，记得处理`;
		return `「${label}」已经逾期${spanText(now - dueAt)}啦，记得处理`;
	}
	return `「${label}」还有${spanText(dueAt - now)}就到点啦`;
}

//#endregion
//#region src/host/plugin/todo-reminders.ts
/** 巡检查找间隔（ms）：比最短提醒间隔（5 分钟）小一档即可，不必更密。 */
const TICK_MS = 60 * 1e3;
/** 提醒气泡停留时长（ms）：比默认 10 秒久一点，欠着的事值得多看两眼。 */
const BUBBLE_DURATION_MS = 15 * 1e3;
function pickReminderSpeaker(pets, isLocked, isSleeping = () => false) {
	let desktopOnly = null;
	for (const pet of pets) {
		const petId = String(pet.id ?? "");
		if (petId === "") continue;
		if (pet.display === "none") continue;
		if (isLocked(petId)) continue;
		if (isSleeping(petId)) continue;
		if (pet.display === "web" || pet.display === "both") return petId;
		desktopOnly ??= petId;
	}
	return desktopOnly;
}
async function tickTodoReminders(deps) {
	if (deps.hasListener !== void 0 && !deps.hasListener()) return;
	const now = deps.now?.() ?? Date.now();
	const due = pickReminder(await deps.todos.list(), now);
	if (due === null) return;
	const pets = deps.effectivePetList();
	const speaker = pickReminderSpeaker(pets, (petId) => deps.lock.locked(petId), (petId) => deps.isSleeping?.(petId) ?? false);
	if (speaker === null) return;
	const display = String(pets.find((pet) => String(pet.id ?? "") === speaker)?.display ?? "");
	const voiceTo = deps.isVoiceTodoEnabled() ? pickVoiceSurface(display) : null;
	deps.state.writePet(speaker, "say", {
		text: reminderText(due.todo, now),
		duration: BUBBLE_DURATION_MS,
		...voiceTo ? { voiceTo } : {}
	});
	await deps.todos.markReminded(due.todo.id, now);
	const remainingSec = due.todo.dueAt === null ? 0 : Math.round((due.todo.dueAt - now) / 1e3);
	deps.log.info(`[dsh-pet] 待办提醒 todo=${due.todo.id} pet=${speaker} 剩余=${remainingSec}s`);
}
function registerTodoReminders(deps) {
	const { ctx, effectivePetList, isVoiceTodoEnabled, lock, log, sleep, state, todos, waiterCount } = deps;
	/** 一拍：失败只打日志，不让循环停摆。 */
	const tick = async () => {
		try {
			await tickTodoReminders({
				effectivePetList,
				hasListener: () => waiterCount() > 0,
				isSleeping: (petId) => sleep.sleeping(petId),
				isVoiceTodoEnabled,
				lock,
				log,
				state,
				todos
			});
		} catch (error) {
			log.warn("[dsh-pet] 待办提醒失败：" + (error instanceof Error ? error.message : String(error)));
		}
	};
	ctx.effect(() => {
		let disposed = false;
		let timer = null;
		/** 排下一拍；已卸载就不再排。 */
		function arm() {
			if (disposed) return;
			timer = setTimeout(() => void run$1(), TICK_MS);
		}
		/** 跑一拍再排下一拍：启动即检查一次，不等第一个周期。 */
		async function run$1() {
			timer = null;
			await tick();
			arm();
		}
		run$1();
		return () => {
			disposed = true;
			if (timer !== null) clearTimeout(timer);
		};
	}, "dsh-pet: todo reminders");
}

//#endregion
//#region src/host/voice/cache.ts
const CACHE_MAX_BYTES = 20 * 1024 * 1024;
const CACHE_MAX_FILES = 200;
function cachePath(userRoot, key) {
	return join(userRoot, "voice-cache", `${key}.mp3`);
}
function cacheKey(source, voice, rate, text) {
	return createHash("sha1").update(`${source}\n${voice}\n${rate}\n${text}`).digest("hex");
}
async function ensureCacheDir(userRoot) {
	const dir = join(userRoot, "voice-cache");
	await mkdir(dir, { recursive: true });
	return dir;
}
async function pruneCache(dir, limits = {}) {
	const maxBytes = limits.maxBytes ?? CACHE_MAX_BYTES;
	const maxFiles = limits.maxFiles ?? CACHE_MAX_FILES;
	let names;
	try {
		names = await readdir(dir);
	} catch {
		return 0;
	}
	const entries = [];
	for (const name of names) {
		if (!name.endsWith(".mp3")) continue;
		const file = join(dir, name);
		try {
			const info = await stat(file);
			entries.push({
				file,
				size: info.size,
				mtimeMs: info.mtimeMs
			});
		} catch {}
	}
	entries.sort((a, b) => a.mtimeMs - b.mtimeMs);
	let totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
	let totalFiles = entries.length;
	let removed = 0;
	for (const entry of entries) {
		if (totalBytes <= maxBytes && totalFiles <= maxFiles) break;
		try {
			await rm(entry.file, { force: true });
			removed += 1;
			totalBytes -= entry.size;
			totalFiles -= 1;
		} catch {}
	}
	return removed;
}

//#endregion
//#region src/host/voice/edge.ts
/**
* 按需加载可选依赖用的 CommonJS require。
*
* 不用动态 `import()`：宿主产物按单文件加载，动态 import 会被打包器拆成 chunk；这个依赖是 CJS，
* require 既能在包缺失时抛出可捕获的错误，也不会把可选依赖拖进启动路径。
*/
const requireOptional = createRequire(import.meta.url);
/** 单次合成超时（ms）：上游长时间无响应就判失败，不拖住串行队列。 */
const SYNTHESIS_TIMEOUT_MS = 15e3;
var VoiceSynthError = class extends Error {
	constructor(message) {
		super(message);
		this.name = "VoiceSynthError";
	}
};
async function synthesize({ text, voice, rate, target }) {
	const staging = `${target}.part`;
	try {
		const { EdgeTTS } = requireOptional("@andresaya/edge-tts");
		const tts = new EdgeTTS();
		const result = await tts.generate(text, voice, {
			rate,
			timeout: SYNTHESIS_TIMEOUT_MS
		});
		await writeFile(staging, result.audio);
		await rename(staging, target);
	} catch (error) {
		await rm(staging, { force: true }).catch(() => void 0);
		throw new VoiceSynthError(error instanceof Error ? error.message : String(error));
	}
}

//#endregion
//#region src/host/voice/speak.ts
const MAX_TEXT_CHARS = 500;
const MAX_QUEUE = 3;
/** 语速表达式：`+N%` 或 `-N%`。 */
const RATE_PATTERN = /^[+-]\d{1,3}%$/;
/** 语速下界（百分比）。 */
const RATE_MIN_PERCENT = -50;
/** 语速上界（百分比）。 */
const RATE_MAX_PERCENT = 100;
/** 第三方实现的单次合成上限（ms）：与内置同口径，避免一句卡住串行队列。 */
const PROVIDER_TIMEOUT_MS = 15e3;
/** 校验请求体；只认 `text` / `voice` / `rate` 三个字段，其余忽略。 */
function parseSpeakInput(raw) {
	const body = raw && typeof raw === "object" ? raw : {};
	const text = typeof body.text === "string" ? body.text.trim() : "";
	if (!text) return {
		ok: false,
		message: "text is required"
	};
	if (text.length > MAX_TEXT_CHARS) return {
		ok: false,
		message: `text too long (max ${MAX_TEXT_CHARS} chars)`
	};
	const voice = body.voice === void 0 ? DEFAULT_VOICE : body.voice;
	if (typeof voice !== "string" || !isKnownVoice(voice)) return {
		ok: false,
		message: `unknown voice; allowed: ${VOICES.map((item) => item.id).join(", ")}`
	};
	const rate = body.rate === void 0 ? "+0%" : body.rate;
	if (typeof rate !== "string" || !RATE_PATTERN.test(rate)) return {
		ok: false,
		message: "rate must look like +0% or -10%"
	};
	const percent = Number(rate.slice(1, -1));
	if (!Number.isFinite(percent) || percent < RATE_MIN_PERCENT || percent > RATE_MAX_PERCENT) return {
		ok: false,
		message: `rate out of range (${RATE_MIN_PERCENT}%..+${RATE_MAX_PERCENT}%)`
	};
	return {
		ok: true,
		value: {
			text,
			voice,
			rate
		}
	};
}
function createVoiceService(options) {
	const { userRoot, log } = options;
	const synthesizeImpl = options.synthesize ?? synthesize;
	/** 已占用的队列名额（含正在跑的那个）。 */
	let queueUsed = 0;
	/** 串行链：上一件事收尾（成功或失败）后才轮到下一件。 */
	let chain = Promise.resolve();
	/** 把一次合成排进串行链；无论成败都释放名额。 */
	function enqueue(task) {
		queueUsed += 1;
		const run$1 = chain.then(task, task);
		chain = run$1.then(() => void 0, () => void 0);
		return run$1.finally(() => {
			queueUsed -= 1;
		});
	}
	/** 缓存命中返回文件路径；不存在或空文件返回 undefined。 */
	async function findCached(target) {
		try {
			const info = await stat(target);
			return info.isFile() && info.size > 0 ? target : void 0;
		} catch {
			return void 0;
		}
	}
	async function speak(raw) {
		const parsed = parseSpeakInput(raw);
		if (!parsed.ok) return {
			ok: false,
			reason: "bad-request",
			message: parsed.message
		};
		const { text, voice, rate } = parsed.value;
		const provider = activeVoiceProvider();
		const source = provider ? provider.id : BUILTIN_VOICE_ID;
		const target = cachePath(userRoot, cacheKey(source, provider ? "" : voice, rate, text));
		const startedMs = Date.now();
		const cached = await findCached(target);
		if (cached) {
			log?.info?.(`[dsh-pet] voice speak: cache=hit chars=${text.length} voice=${source}`);
			return {
				ok: true,
				file: cached
			};
		}
		if (queueUsed >= MAX_QUEUE) {
			log?.warn?.(`[dsh-pet] voice speak: queue full (max ${MAX_QUEUE}) chars=${text.length} voice=${source}`);
			return {
				ok: false,
				reason: "voice-busy",
				message: "voice queue is full, retry later"
			};
		}
		try {
			await enqueue(async () => {
				const dir = await ensureCacheDir(userRoot);
				if (provider) await synthesizeWithProvider(provider, {
					text,
					voice,
					rate,
					target
				});
				else await synthesizeImpl({
					text,
					voice,
					rate,
					target
				});
				await pruneCache(dir);
			});
		} catch (error) {
			log?.warn?.(`[dsh-pet] voice speak: failed chars=${text.length} voice=${source} ms=${Date.now() - startedMs} reason=${error instanceof VoiceSynthError ? error.message : String(error)}`);
			return {
				ok: false,
				reason: "generate-error",
				message: "voice synthesis failed"
			};
		}
		log?.info?.(`[dsh-pet] voice speak: cache=miss chars=${text.length} voice=${source} ms=${Date.now() - startedMs}`);
		return {
			ok: true,
			file: target
		};
	}
	return {
		listVoices: () => VOICES,
		speak
	};
}
/** 给一个 Promise 套超时；超时 reject，原 Promise 不被取消（provider 自己该处理放弃）。 */
function withTimeout(task, timeoutMs) {
	return new Promise((resolve$1, reject) => {
		const timer = setTimeout(() => reject(new Error("voice provider timed out")), timeoutMs);
		timer.unref?.();
		task.then((value) => {
			clearTimeout(timer);
			resolve$1(value);
		}, (error) => {
			clearTimeout(timer);
			reject(error);
		});
	});
}
/**
* 用第三方实现合成并落盘。
*
* 空字节按失败处理：0 字节文件会被 {@link findCached} 的 `size > 0` 跳过，
* 于是每次请求都重新合成、每次又得到空文件，白烧上游。
*/
async function synthesizeWithProvider(provider, input) {
	let bytes;
	try {
		bytes = await withTimeout(provider.synthesize({
			text: input.text,
			rate: input.rate
		}), PROVIDER_TIMEOUT_MS);
	} catch (error) {
		throw new VoiceSynthError(error instanceof Error ? error.message : String(error));
	}
	if (bytes.length === 0) throw new VoiceSynthError("voice provider returned empty audio");
	await writeFile(input.target, bytes);
}

//#endregion
//#region src/host/voice/hear.ts
const MAX_AUDIO_BYTES = 768 * 1024;
const TRANSCRIBE_TIMEOUT_MS = 3e4;
/** base64 字面量：`Buffer.from` 解码很宽松，先按字母表与补齐规则挡掉脏数据。 */
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;
/**
* 校验请求体；只认 `audio` 与 `language` 两个字段，其余忽略。
*
* @param raw - 已解析的请求体。
* @returns 已解码的音频字节；任何字段不合法时给出可直接回给调用方的说明。
*/
function parseHearInput(raw) {
	const body = raw && typeof raw === "object" ? raw : {};
	const encoded = typeof body.audio === "string" ? body.audio.trim() : "";
	if (encoded === "") return {
		ok: false,
		message: "audio is required"
	};
	if (!BASE64_PATTERN.test(encoded) || encoded.replace(/=+$/, "").length % 4 === 1) return {
		ok: false,
		message: "audio must be base64"
	};
	const audio = new Uint8Array(Buffer.from(encoded, "base64"));
	if (audio.byteLength === 0) return {
		ok: false,
		message: "audio is empty"
	};
	if (audio.byteLength > MAX_AUDIO_BYTES) return {
		ok: false,
		message: `audio too large (max ${MAX_AUDIO_BYTES} bytes)`
	};
	const language = body.language;
	if (language !== void 0 && (typeof language !== "string" || language.trim() === "")) return {
		ok: false,
		message: "language must be a non-empty string"
	};
	return {
		ok: true,
		value: {
			audio,
			...language === void 0 ? {} : { language: language.trim() }
		}
	};
}
/**
* 给一次识别套上超时与调用方中止，把结论收敛成「值或一句说明」。
*
* 两个来源（第三方、宿主）都只认一个 signal，所以在这里合并，调用方不必各写一遍。
*
* @param signal - 调用方中止信号（连接断开）。
* @param timeoutMs - 超时上限。
* @param task - 真正执行识别的函数。
* @returns 成功给任务的值；超时或抛错给原始错误说明。
*/
async function withDeadline(signal, timeoutMs, task) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	timer.unref();
	const onAbort = () => controller.abort();
	signal?.addEventListener("abort", onAbort, { once: true });
	try {
		return {
			ok: true,
			value: await task(controller.signal)
		};
	} catch (error) {
		return {
			ok: false,
			message: error instanceof Error ? error.message : String(error)
		};
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener("abort", onAbort);
	}
}
function createHearService(options) {
	const timeoutMs = options.timeoutMs ?? TRANSCRIBE_TIMEOUT_MS;
	return { async hear(raw, signal) {
		const parsed = parseHearInput(raw);
		if (!parsed.ok) return {
			ok: false,
			reason: "bad-request",
			message: parsed.message
		};
		const provider = activeSpeechProvider();
		if (provider !== null) {
			const run$2 = await withDeadline(signal, timeoutMs, (inner) => provider.transcribe(parsed.value, inner));
			if (!run$2.ok) return {
				ok: false,
				reason: "generate-error",
				message: run$2.message
			};
			if (typeof run$2.value !== "string") return {
				ok: false,
				reason: "generate-error",
				message: "invalid transcript from provider"
			};
			return {
				ok: true,
				text: run$2.value
			};
		}
		const speech = options.speechToText();
		if (speech === void 0 || typeof speech.transcribe !== "function") return {
			ok: false,
			reason: "unsupported",
			message: "host has no speech-to-text service"
		};
		if (speech.listProviders().length === 0) return {
			ok: false,
			reason: "unsupported",
			message: "host has no speech provider enabled"
		};
		const run$1 = await withDeadline(signal, timeoutMs, async (inner) => (await speech.transcribe(speech.resolve(parsed.value), inner)).text);
		if (!run$1.ok) return {
			ok: false,
			reason: "generate-error",
			message: run$1.message
		};
		return {
			ok: true,
			text: run$1.value
		};
	} };
}

//#endregion
//#region src/host/index.ts
function apply(ctx) {
	const setup = createHostSetup(ctx);
	const { userRoot, log, configPaths, thumbUserRoot, memeDirsFor, standaloneAiPolicy, state, playback, workStatus, EXTERNAL_WORK_SESSION, nextExternalWorkSeq } = setup;
	const workStatusBridge = createWorkStatusBridge({
		state,
		workStatus
	});
	const { publishWorkStatus, stopWorkStatusFlush } = workStatusBridge;
	const downloadReport = createDownloadReport({
		EXTERNAL_WORK_SESSION,
		nextExternalWorkSeq,
		publishWorkStatus,
		workStatus
	});
	const { reportDownload, stopDownloadSlotTimer } = downloadReport;
	const petLookup = createPetLookup({
		state,
		configPaths
	});
	const { lock, sleep, sleepRefusalText } = petLookup;
	const sessionNotify = createSessionNotify({
		ctx,
		publishWorkStatus,
		state,
		workStatus
	});
	const { pushNotifyFrame, turnFlags, terminalTimers, lastTodoText, lastReplyText, toolsInFlight, cancelTerminalCleanup, scheduleTerminalCleanup, notifyActivityTimers, scheduleCompletionNotify } = sessionNotify;
	const chatMemory = createChatMemory({
		ctx,
		configPaths,
		log,
		memeDirsFor,
		playback,
		state,
		userRoot
	});
	const { lastWhisperAt, publishWhisper, publishSleepTalk, chatWithPet, getActivePetId, setActivePetId } = chatMemory;
	const balancePoll = createBalancePoll({
		ctx,
		configPaths,
		getActivePetId,
		log,
		state
	});
	const { effectivePetList, balancePeriodSec, whisperPeriodSec, refreshBalance, resolveActivePetId, petDisplayName } = balancePoll;
	const todos = new TodoStore({
		file: join(userRoot, TODO_FILE_NAME),
		log
	});
	const desktopHelper = createDesktopHelper({
		ctx,
		configPaths,
		effectivePetList,
		log,
		reportDownload,
		thumbUserRoot,
		getHandlePetRoute: () => httpRoute.handlePetRoute
	});
	const { startHelper, stopHelper, markDisposed } = desktopHelper;
	const deps = {
		...setup,
		...petLookup,
		...workStatusBridge,
		...chatMemory,
		...balancePoll,
		...desktopHelper,
		...sessionNotify,
		ctx,
		todos,
		voice: createVoiceService({
			userRoot,
			log
		}),
		speech: createHearService({ speechToText: () => setup.optionalService("speechToText") })
	};
	const httpRoute = createHttpRoute(deps);
	registerHttpRoute(ctx, httpRoute.handlePetRoute);
	registerSessionWatch({
		ctx,
		cancelTerminalCleanup,
		lastTodoText,
		lastReplyText,
		notifyActivityTimers,
		publishWorkStatus,
		pushNotifyFrame,
		scheduleCompletionNotify,
		scheduleTerminalCleanup,
		terminalTimers,
		toolsInFlight,
		turnFlags,
		workStatus
	});
	registerBalanceCommand({
		ctx,
		effectivePetList,
		refreshBalance,
		sleep,
		sleepRefusalText
	});
	registerLoops({
		ctx,
		balancePeriodSec,
		configPaths,
		lastWhisperAt,
		lock,
		log,
		publishWhisper,
		publishSleepTalk,
		refreshBalance,
		sleep,
		standaloneAiPolicy,
		whisperPeriodSec
	});
	registerPetCommand({
		ctx,
		effectivePetList,
		petDisplayName,
		resolveActivePetId,
		setActivePetId
	});
	registerChatCommand({
		ctx,
		chatWithPet,
		log,
		publishWhisper,
		resolveActivePetId,
		sleep,
		sleepRefusalText
	});
	registerTodoReminders({
		ctx,
		effectivePetList,
		isVoiceTodoEnabled: () => readAllConfig(configPaths).main?.voiceTodoEnabled === true,
		lock,
		log,
		sleep,
		state,
		todos,
		waiterCount: () => state.waiterCount()
	});
	registerLifecycle({
		ctx,
		lock,
		markDisposed,
		playback,
		state,
		stopDownloadSlotTimer,
		stopHelper,
		stopWorkStatusFlush
	});
	startHelper();
}

//#endregion
//#region src/standalone/server/options.ts
const DEFAULT_STANDALONE_PORT = 3080;
const PORT_SCAN_LIMIT = 25;

//#endregion
//#region src/standalone/settings.ts
/** 接口地址的校验：只允许干净的 HTTP 或 HTTPS 地址，凭据不放进 URL。 */
const endpoint = z.string().max(2048).refine((value) => {
	if (value === "") return true;
	try {
		const url = new URL(value);
		return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
	} catch {
		return false;
	}
}, "接口地址必须是 HTTP(S) 地址，且不能含账号、查询参数或片段");
/** 设置补丁的契约：未知字段一律拒绝。 */
const settingsSchema = z.object({
	protocol: z.enum(["openai-compatible", "anthropic"]).optional(),
	baseUrl: endpoint.optional(),
	model: z.string().max(200).optional(),
	apiKey: z.string().max(8192).optional(),
	clearApiKey: z.boolean().optional(),
	enabled: z.boolean().optional(),
	automaticWhispers: z.boolean().optional(),
	whisperIntervalSec: z.number().int().min(60).max(86400).optional(),
	maxTokens: z.number().int().min(128).max(4096).optional(),
	timeoutMs: z.number().int().min(1e3).max(6e4).optional()
}).strict();
function validateSettings$1(input) {
	const result = settingsSchema.safeParse(input);
	if (!result.success) throw new Error("设置无效：请检查协议、接口地址、间隔（至少 60 秒）和输出上限（128–4096）");
	return result.data;
}
/** 可出现在响应里的字段白名单。 */
const publicNames = [
	"protocol",
	"baseUrl",
	"model",
	"enabled",
	"automaticWhispers",
	"whisperIntervalSec",
	"maxTokens",
	"timeoutMs",
	"hasKey"
];
function publicSettings(input) {
	if (input === null || typeof input !== "object") return {};
	const record = input;
	return Object.fromEntries(publicNames.filter((name) => Object.prototype.hasOwnProperty.call(record, name)).map((name) => [name, record[name]]));
}

//#endregion
//#region src/standalone/request-security.ts
function rejectRequest(res, status, error) {
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store"
	});
	res.end(JSON.stringify({ error }));
	return false;
}
/** 无需令牌的只读路径；写操作与敏感路径必须带令牌。 */
function publicRead(req) {
	const path = decodeURIComponent(new URL(req.url ?? "/", "http://127.0.0.1").pathname);
	if (req.method !== "GET" && req.method !== "HEAD") return false;
	if (["/standalone-ai/settings", "/shutdown"].includes(path)) return false;
	if (/^\/dsh-pet-\d+\/(?:whisper|chat)(?:\/|$)/.test(path)) return false;
	return [
		"/",
		"/health",
		"/standalone-ai/",
		"/standalone-ai/settings.js",
		"/standalone-ai/settings.css"
	].includes(path) || /^\/dsh-pet-\d+\//.test(path);
}
function createRequestSecurity() {
	const token = randomBytes(32).toString("base64url");
	return {
		token,
		authenticatedUrl(baseUrl) {
			const base = new URL(baseUrl);
			if (base.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(base.hostname) || base.username || base.password) throw new Error("设置地址必须是本机 HTTP 地址");
			return `${base.origin}/standalone-ai/#token=${token}`;
		},
		authorize(req, res, allowFileOrigin = false) {
			const host = req.headers.host;
			const port = req.socket.localPort;
			if (!port || host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return rejectRequest(res, 403, "仅允许当前本机地址");
			const fileOrigin = allowFileOrigin && (req.headers.origin === "null" || req.headers.origin === void 0);
			if (!fileOrigin && (req.headers.origin !== void 0 && req.headers.origin !== `http://${host}` || req.headers["sec-fetch-site"] === "cross-site")) return rejectRequest(res, 403, "不允许跨站请求");
			try {
				if (publicRead(req) && !fileOrigin) return true;
			} catch {
				return rejectRequest(res, 400, "请求地址无效");
			}
			const supplied = req.headers["x-dsh-pet-token"];
			if (typeof supplied !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(supplied) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) return rejectRequest(res, 403, "请从桌宠菜单重新打开设置");
			return true;
		}
	};
}
function secureResponse(res, pathname) {
	const writeHead = res.writeHead.bind(res);
	const isPublicOp = pathname === "/" || pathname === "/health";
	res.writeHead = (status, ...args) => {
		const filtered = isPublicOp ? args : args.map((value) => {
			if (Array.isArray(value)) return value.reduce((result, item, index) => {
				if (index % 2 === 0 && !String(item).toLowerCase().startsWith("access-control-")) return [
					...result,
					String(item),
					String(value[index + 1])
				];
				return result;
			}, []);
			if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([name]) => !name.toLowerCase().startsWith("access-control-")));
			return value;
		});
		if (!isPublicOp) {
			for (const name of res.getHeaderNames()) if (name.toLowerCase().startsWith("access-control-")) res.removeHeader(name);
		}
		res.setHeader("x-content-type-options", "nosniff");
		res.setHeader("referrer-policy", "no-referrer");
		res.setHeader("cache-control", "no-store");
		return Reflect.apply(writeHead, res, [status, ...filtered]);
	};
}

//#endregion
//#region src/standalone/server/respond.ts
function matches(route, pathname) {
	if (route.kind === "exact") return pathname === route.path;
	return pathname === route.path || pathname.startsWith(`${route.path}/`);
}
function sendJson(res, status, body, cors = false) {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"content-length": Buffer.byteLength(payload),
		...cors ? { "access-control-allow-origin": "*" } : {}
	});
	res.end(payload);
}
function sendAsset(res, body, type) {
	res.writeHead(200, {
		"content-type": `${type}; charset=utf-8`,
		"content-length": Buffer.byteLength(body),
		"content-security-policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
		"x-frame-options": "DENY"
	});
	res.end(body);
}
function fail(res, _error, logger) {
	logger.error("独立模式路由处理失败（详细内容已省略以保护凭据）");
	if (res.headersSent) res.destroy();
	else sendJson(res, 500, { error: "本机服务暂时无法处理请求" });
}

//#endregion
//#region src/standalone/server/handlers.ts
function settingsHandler(ai) {
	let windowStart = Date.now();
	let count = 0;
	return async (req, res) => {
		if (!ai) {
			rejectRequest(res, 503, "本机 AI 设置尚未就绪");
			return;
		}
		if (req.method === "GET") {
			sendJson(res, 200, publicSettings(ai.getSettings()));
			return;
		}
		if (req.method !== "POST") {
			rejectRequest(res, 405, "仅支持 GET 或 POST");
			return;
		}
		if (Date.now() - windowStart >= 6e4) {
			windowStart = Date.now();
			count = 0;
		}
		count += 1;
		if (count > 20) {
			rejectRequest(res, 429, "保存过于频繁，请稍后再试");
			return;
		}
		if (req.headers["content-type"]?.split(";")[0].trim().toLowerCase() !== "application/json") {
			rejectRequest(res, 415, "请使用 JSON 保存设置");
			return;
		}
		try {
			const chunks = [];
			await new Promise((resolve$1, reject) => {
				req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
				req.once("end", resolve$1);
				req.once("error", reject);
			});
			const input = validateSettings$1(JSON.parse(Buffer.concat(chunks).toString("utf8")));
			sendJson(res, 200, publicSettings(await ai.saveSettings(input)));
		} catch {
			rejectRequest(res, 400, "设置未保存：请检查接口地址、模型名称、密钥和数值范围");
		}
	};
}
function testHandler(ai) {
	return async (req, res) => {
		if (req.method !== "POST") {
			rejectRequest(res, 405, "仅支持 POST");
			return;
		}
		try {
			const chunks = [];
			await new Promise((resolve$1, reject) => {
				req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
				req.once("end", resolve$1);
				req.once("error", reject);
			});
			const bodyStr = Buffer.concat(chunks).toString("utf8");
			const input = bodyStr ? JSON.parse(bodyStr) : {};
			if (ai?.testConnection) {
				const result = await ai.testConnection(input);
				sendJson(res, 200, result);
			} else sendJson(res, 200, {
				ok: false,
				message: "当前环境未配置测试能力"
			});
		} catch {
			sendJson(res, 400, {
				ok: false,
				message: "请求格式无效"
			});
		}
	};
}

//#endregion
//#region src/standalone/settings-page.ts
const settingsPage = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>桌宠 AI 设置</title><link rel="stylesheet" href="/standalone-ai/settings.css">
<script src="/standalone-ai/settings.js" defer></script></head><body>
<main><header><span class="fish" aria-hidden="true">🐾</span><p class="local">独立桌宠 / 本机设置</p>
<h1>桌宠 AI 设置</h1><p class="intro">配置你的大模型 API 接口，开启桌面聊天与碎碎念。<br>所有设置仅保存在本机，支持即时测试连接。</p></header>
<form id="settings" aria-describedby="privacy">
<fieldset><legend>模型连接</legend>
<label for="protocol">接口协议</label><select id="protocol" name="protocol"><option value="openai-compatible">OpenAI 兼容</option><option value="anthropic">Anthropic</option></select>
<label for="baseUrl">接口地址（Base URL）</label><input id="baseUrl" name="baseUrl" type="url" placeholder="https://example.com/v1" maxlength="2048" spellcheck="false" aria-describedby="endpoint-note"><p class="hint" id="endpoint-note">填写服务商提供的基础接口地址（支持 HTTP 与 HTTPS，通常以 /v1 结尾）。不要把密钥放进地址。</p>
<label for="model">模型名称</label><input id="model" name="model" type="text" maxlength="200" placeholder="填写服务商的模型 ID，例如 deepseek-chat" spellcheck="false">
<div class="key-heading"><label for="apiKey">API 密钥</label><span id="key-state" class="hint">尚未读取</span></div>
<input id="apiKey" name="apiKey" type="password" autocomplete="new-password" maxlength="8192" placeholder="留空保留已保存的密钥" aria-describedby="key-note">
<p id="key-note" class="hint">密钥只写入本机配置，不会回显。留空不会删除旧密钥。</p>
<label class="check clear"><input id="clearApiKey" type="checkbox">清除已保存的密钥，并关闭 AI</label>
<label class="check enabled"><input id="enabled" type="checkbox">启用 AI 对话</label>
<div class="test-row"><button id="test-btn" type="button">测试连接</button><span id="test-result" class="test-result" role="status" aria-live="polite"></span></div>
</fieldset>
<fieldset><legend>定时自动碎碎念</legend>
<label class="check"><input id="automaticWhispers" type="checkbox" aria-describedby="cost">开启自动碎碎念</label>
<p id="cost" class="notice">开启后，桌宠会按设定间隔定时调用模型并在桌面上说话冒泡（产生 API 费用）。默认关闭；右键菜单中的手动对话与手动碎碎念不受此开关限制。</p>
<div class="pair"><div><label for="whisperIntervalSec">碎碎念间隔（秒）</label><input id="whisperIntervalSec" type="number" min="60" max="86400" step="1" value="300" required></div>
<div><label for="maxTokens">单次输出上限（tokens）</label><input id="maxTokens" type="number" min="128" max="4096" step="1" value="1024" required></div></div>
<p class="hint">间隔至少 60 秒，默认 300 秒。输出上限越小，单次回复越简短。</p>
</fieldset>
<footer><p id="privacy">所有配置与密钥仅保存在当前机器。<br>关闭 AI 后，桌宠仍可正常显示、移动与互动。</p><button id="save" type="submit" disabled>保存到本机</button></footer>
<p id="status" role="status" aria-live="polite">正在读取本机设置…</p>
</form><noscript>需要启用 JavaScript 才能保存设置。请从桌宠菜单打开本页。</noscript></main></body></html>`;
const settingsStyle = `
:root{color-scheme:light;--ink:#203b4b;--muted:#526a78;--blue:#12618b;--line:#cbdce5;--paper:#fff;--water:#edf5fa}
*{box-sizing:border-box}body{margin:0;background:var(--water);color:var(--ink);font:16px/1.6 "Microsoft YaHei UI","PingFang SC",sans-serif}
main{max-width:720px;margin:48px auto;padding:0 24px 32px}header{padding:0 12px 28px}.fish{display:block;font:700 29px/1.3 Georgia,serif;color:var(--blue);letter-spacing:2px;margin-bottom:24px}.local{font-size:13px;color:var(--muted);margin:0 0 10px}h1{font-size:32px;line-height:1.3;letter-spacing:-1px;margin:0 0 16px;font-weight:700}.intro{margin:0;color:var(--muted)}
form{background:var(--paper);border:1px solid var(--line);border-radius:16px 16px 6px 6px;padding:28px 32px 20px}fieldset{padding:0 0 28px;margin:0 0 24px;border:0;border-bottom:1px solid var(--line);min-width:0}legend{font-size:19px;font-weight:700;margin-bottom:18px;padding:0}label{display:block;font-weight:600;font-size:14px;margin:14px 0 6px}input:not([type=checkbox]),select{display:block;width:100%;min-height:44px;border:1px solid #a5bdcb;border-radius:6px;background:#fff;color:var(--ink);padding:9px 12px;font:inherit;font-size:15px}input::placeholder{color:#6a7e8b}input[type=checkbox]{accent-color:var(--blue);width:18px;height:18px;flex-shrink:0;margin:0}.check{display:flex;align-items:center;gap:10px;min-height:32px;cursor:pointer}.enabled{margin-top:24px}.clear{font-weight:400;color:var(--muted);font-size:13px}.hint{font-size:12px;line-height:1.6;color:var(--muted);margin:7px 0 0}.key-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:14px}.key-heading label{margin:0 0 6px}.key-heading .hint{margin:0 0 6px}.notice{font-size:13px;color:#704b13;background:#fff7e7;border-left:3px solid #c18e36;margin:12px 0 16px;padding:12px 14px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:20px}footer{display:flex;align-items:center;justify-content:space-between;gap:18px}footer p{font-size:12px;color:var(--muted);margin:0}button{border:0;border-radius:7px;min-height:44px;padding:10px 20px;background:var(--blue);color:#fff;font:600 15px/1.5 inherit;white-space:nowrap;cursor:pointer}button:hover{background:#0b4e73}button:disabled{opacity:.55;cursor:wait}:focus-visible{outline:3px solid #3a94c4;outline-offset:3px}#status{font-size:13px;min-height:24px;margin:18px 0 0;color:var(--blue)}#status[data-error=true]{color:#a13b30}
.test-row{display:flex;align-items:center;gap:14px;margin:20px 0 6px;flex-wrap:wrap}#test-btn{background:#fff;color:var(--blue);border:1.5px solid var(--blue);min-height:38px;padding:6px 18px;font-size:14px;border-radius:6px;cursor:pointer;font-weight:600}#test-btn:hover{background:#edf5fa}#test-btn:disabled{opacity:.6;cursor:wait}.test-result{font-size:13px;line-height:1.5;min-height:22px;flex:1 1 200px}.test-success{color:#1a7f37;font-weight:600}.test-error{color:#cf222e}.reply-preview{display:block;color:var(--muted);font-weight:normal;font-size:12px;margin-top:4px;word-break:break-all}
@media(max-width:560px){main{margin:24px auto;padding:0 14px 24px}header{padding:0 8px 24px}h1{font-size:28px}form{padding:24px 20px 16px}.pair{grid-template-columns:1fr;gap:0}footer{align-items:stretch;flex-direction:column}button{width:100%}.fish{margin-bottom:18px}}
`;
const settingsScript = `
'use strict';
(() => {
  const token = new URLSearchParams(location.hash.slice(1)).get('token') || '';
  history.replaceState(null, '', location.pathname);
  const get = id => document.getElementById(id);
  const form = get('settings');
  const status = get('status');
  const save = get('save');
  const testBtn = get('test-btn');
  const testResult = get('test-result');
  function message(text, error = false) { status.textContent = text; status.dataset.error = String(error); }
  async function request(method, body) {
    const response = await fetch('/standalone-ai/settings', {
      method, credentials: 'omit', cache: 'no-store', redirect: 'error',
      headers: { 'X-DSH-Pet-Token': token, ...(body ? {'Content-Type': 'application/json'} : {}) },
      ...(body ? {body: JSON.stringify(body)} : {})
    });
    if (!response.ok) {
      if (response.status === 403) throw new Error('打开凭据已失效。请从桌宠菜单重新打开设置。');
      if (response.status === 429) throw new Error('保存过于频繁，请稍等一分钟再试。');
      throw new Error('设置未保存。请检查接口地址、模型名称与密钥，再重试。');
    }
    return response.json();
  }
  function populate(data) {
    for (const id of ['protocol','baseUrl','model','whisperIntervalSec','maxTokens']) {
      if (data[id] !== undefined) get(id).value = String(data[id]);
    }
    for (const id of ['enabled','automaticWhispers']) get(id).checked = data[id] === true;
    get('key-state').textContent = data.hasKey ? '已保存 · 不回显' : '尚未设置';
    get('apiKey').value = '';
    get('clearApiKey').checked = false;
  }
  get('clearApiKey').addEventListener('change', () => {
    get('apiKey').disabled = get('clearApiKey').checked;
    if (get('clearApiKey').checked) {
      get('apiKey').value = '';
      get('enabled').checked = false;
      get('automaticWhispers').checked = false;
    }
  });
  if (testBtn && testResult) {
    testBtn.addEventListener('click', async () => {
      testBtn.disabled = true;
      testResult.className = 'test-result';
      testResult.textContent = '正在测试连接，请稍候…';
      const input = {
        protocol: get('protocol').value,
        baseUrl: get('baseUrl').value.trim(),
        model: get('model').value.trim(),
        apiKey: get('apiKey').value.trim(),
      };
      try {
        const response = await fetch('/standalone-ai/test', {
          method: 'POST',
          credentials: 'omit',
          cache: 'no-store',
          headers: {
            'X-DSH-Pet-Token': token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(input),
        });
        const data = await response.json();
        if (data.ok) {
          testResult.className = 'test-result test-success';
          testResult.textContent = '✓ ' + data.message;
          if (data.reply) {
            const preview = document.createElement('span');
            preview.className = 'reply-preview';
            preview.textContent = '回复: ' + data.reply;
            testResult.appendChild(preview);
          }
        } else {
          testResult.className = 'test-result test-error';
          testResult.textContent = '✗ ' + (data.message || data.error || '测试失败');
        }
      } catch (error) {
        testResult.className = 'test-result test-error';
        testResult.textContent = '✗ 请求异常：' + (error && error.message ? error.message : String(error));
      } finally {
        testBtn.disabled = false;
      }
    });
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    save.disabled = true;
    message('正在保存到本机…');
    const input = {
      protocol: get('protocol').value, baseUrl: get('baseUrl').value.trim(), model: get('model').value.trim(),
      apiKey: get('apiKey').value, clearApiKey: get('clearApiKey').checked,
      enabled: get('enabled').checked, automaticWhispers: get('automaticWhispers').checked,
      whisperIntervalSec: Number(get('whisperIntervalSec').value), maxTokens: Number(get('maxTokens').value)
    };
    get('apiKey').value = '';
    try {
      populate(await request('POST', input));
      get('apiKey').disabled = false;
      message('已保存到本机。');
    } catch (error) { message(error.message, true); }
    finally { save.disabled = false; }
  });
  if (!token) { message('请从桌宠菜单或本机启动器打开设置，以获得本次运行的访问凭据。', true); return; }
  request('GET').then(data => { populate(data); save.disabled = false; message('设置只在本机保存。'); })
    .catch(error => message(error.message, true));
})();
`;

//#endregion
//#region src/standalone/request-body.ts
const MAX_REQUEST_BYTES = 1024 * 1024;
const MAX_SETTINGS_BYTES = 16 * 1024;
const BODY_TIMEOUT_MS = 5e3;
async function boundedRequest(req, res, limit, timeoutMs = BODY_TIMEOUT_MS) {
	const length = req.headers["content-length"];
	if (length !== void 0 && (!/^\d+$/.test(length) || Number(length) > limit)) {
		rejectRequest(res, 413, "请求正文过大");
		return void 0;
	}
	const chunks = [];
	const body = await new Promise((resolve$1) => {
		let size = 0;
		const finish = (status) => {
			clearTimeout(timer);
			req.off("data", onData);
			req.off("end", onEnd);
			req.off("error", onError);
			req.off("aborted", onError);
			if (status !== void 0) {
				req.pause();
				if (!res.writableEnded && !res.destroyed) rejectRequest(res, status, status === 408 ? "读取请求超时" : "请求正文无效或过大");
				resolve$1(void 0);
			} else resolve$1(Buffer.concat(chunks));
		};
		const onData = (chunk) => {
			size += chunk.length;
			if (size > limit) finish(413);
			else chunks.push(Buffer.from(chunk));
		};
		const onEnd = () => finish();
		const onError = () => finish(400);
		const timer = setTimeout(() => finish(408), timeoutMs);
		timer.unref();
		req.on("data", onData);
		req.once("end", onEnd);
		req.once("error", onError);
		req.once("aborted", onError);
	});
	if (body === void 0) return void 0;
	return Object.assign(Readable.from([body]), {
		method: req.method,
		url: req.url,
		headers: req.headers,
		rawHeaders: req.rawHeaders,
		socket: req.socket,
		httpVersion: req.httpVersion
	});
}

//#endregion
//#region src/standalone/server/listener.ts
/** 组装请求分发器：先处理探针、设置页与停机，再交给插件路由。 */
function dispatch(options, shutdownSecurity) {
	const settings = settingsHandler(options.ai);
	const tester = testHandler(options.ai);
	return (req, res, pathname) => {
		const method = req.method ?? "GET";
		if (method === "OPTIONS") {
			res.writeHead(204);
			res.end();
			return;
		}
		if (pathname === "/" || pathname === "/health") {
			if (method !== "GET" && method !== "HEAD") {
				rejectRequest(res, 405, "仅支持 GET");
				return;
			}
			sendJson(res, 200, options.status?.() ?? { name: "dsh-pet-standalone" }, true);
			return;
		}
		if (pathname === "/shutdown") {
			if (method !== "POST") {
				rejectRequest(res, 405, "停机请使用 POST");
				return;
			}
			if (shutdownSecurity) {
				const supplied = req.headers["x-dsh-pet-token"];
				if (typeof supplied !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(supplied) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(shutdownSecurity.token))) {
					rejectRequest(res, 403, "停机需要提供令牌");
					return;
				}
			}
			sendJson(res, 200, {
				ok: true,
				stopping: true
			});
			queueMicrotask(() => options.onShutdown?.());
			return;
		}
		const assets = {
			"/standalone-ai/": [settingsPage, "text/html"],
			"/standalone-ai/settings.js": [settingsScript, "text/javascript"],
			"/standalone-ai/settings.css": [settingsStyle, "text/css"]
		};
		const asset = assets[pathname];
		if (asset) {
			if (method !== "GET" && method !== "HEAD") {
				rejectRequest(res, 405, "仅支持 GET");
				return;
			}
			sendAsset(res, asset[0], asset[1]);
			return;
		}
		if (pathname === "/standalone-ai/settings") {
			settings(req, res).catch((error) => fail(res, error, options.logger));
			return;
		}
		if (pathname === "/standalone-ai/test") {
			tester(req, res).catch((error) => fail(res, error, options.logger));
			return;
		}
		const route = options.routes.find((candidate) => matches(candidate, pathname));
		if (!route) {
			res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
			res.end(`dsh-pet-standalone: 没有匹配的路由（已注册：${options.routes.map((item) => item.path).join(", ") || "无"}）`);
			return;
		}
		try {
			Promise.resolve(route.handler(req, res)).catch((error) => fail(res, error, options.logger));
		} catch (error) {
			fail(res, error, options.logger);
		}
	};
}
function createRequestListener(options, injectedSecurity) {
	const security = options.security ?? injectedSecurity;
	const route = dispatch(options, security);
	return (req, res) => {
		let pathname;
		try {
			pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
		} catch {
			rejectRequest(res, 400, "请求地址无效");
			return;
		}
		secureResponse(res, pathname);
		if (security && !security.authorize(req, res)) return;
		options.logger.debug("收到本机 HTTP 请求");
		const hasBody = req.headers["transfer-encoding"] !== void 0 || Number(req.headers["content-length"] ?? 0) > 0;
		const bodyMethod = [
			"POST",
			"PUT",
			"PATCH",
			"DELETE"
		].includes(req.method ?? "");
		if ((hasBody || bodyMethod) && typeof req.on === "function") {
			const limit = pathname === "/standalone-ai/settings" ? MAX_SETTINGS_BYTES : MAX_REQUEST_BYTES;
			boundedRequest(req, res, limit, options.bodyTimeoutMs).then((bounded) => {
				if (bounded) route(bounded, res, pathname);
			}).catch((error) => fail(res, error, options.logger));
		} else route(req, res, pathname);
	};
}
/** 从首选端口起逐个尝试，只接受 EADDRINUSE 后继续。 */
async function bindFirstFree(server, preferred, logger) {
	for (let port = preferred; port < preferred + PORT_SCAN_LIMIT; port += 1) try {
		await new Promise((accept, reject) => {
			const onError = (error) => {
				server.off("listening", onListening);
				reject(error);
			};
			const onListening = () => {
				server.off("error", onError);
				accept();
			};
			server.once("error", onError);
			server.once("listening", onListening);
			server.listen(port, "127.0.0.1");
		});
		const address = server.address();
		const bound = typeof address === "object" && address !== null ? address.port : port;
		if (preferred > 0 && bound !== preferred) logger.warn(`端口 ${preferred} 被占用，改用 ${bound}`);
		return bound;
	} catch (error) {
		if (error.code !== "EADDRINUSE") throw error;
	}
	throw new Error(`从 ${preferred} 起连续 ${PORT_SCAN_LIMIT} 个端口都被占用`);
}
async function listenStandaloneServer(options) {
	const security = options.security;
	const server = createServer(createRequestListener(options, security));
	server.requestTimeout = 1e4;
	server.headersTimeout = 1e4;
	server.on("clientError", (_error, socket) => socket.destroy());
	const port = await bindFirstFree(server, options.port ?? DEFAULT_STANDALONE_PORT, options.logger);
	options.logger.info(`独立模式服务已监听 http://127.0.0.1:${port}/`);
	return {
		port,
		security: security ?? createRequestSecurity(),
		async close() {
			server.closeAllConnections();
			await new Promise((accept) => server.close(() => accept()));
		}
	};
}

//#endregion
//#region src/standalone/options.ts
const USAGE = `dsh-pet 独立模式（不需要 DSH）

用法：dsh-pet-standalone [选项]

选项：
  --port <端口>   监听端口（默认 ${DEFAULT_STANDALONE_PORT}；被占用时自动向后顺延）
  --check         只体检：打印配置来源、宠物清单与 Electron 状态，不启动窗口
  -h, --help      显示本帮助

说明：
  桌宠在独立模式下以「透明置顶小窗」运行；浏览器内浮层需要有 DSH 网页，独立模式不提供。
  对话与碎碎念可在本机 AI 设置页配置 API 后显式启用；未配置时不发送模型请求。
  余额 / DSH 会话工作状态 / 系统通知仍需要 DSH 宿主。
`;
function parseArgs(argv) {
	const options = {
		port: DEFAULT_STANDALONE_PORT,
		check: false,
		help: false
	};
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index] ?? "";
		if (arg === "--check") options.check = true;
		else if (arg === "-h" || arg === "--help") options.help = true;
		else if (arg === "--port" || arg.startsWith("--port=")) {
			const raw = arg === "--port" ? String(argv[index + 1] ?? "") : arg.slice(7);
			if (arg === "--port") index += 1;
			const value = Number(raw);
			if (!Number.isInteger(value) || value < 1 || value > 65535) return { error: `--port 需要 1..65535 的整数端口，收到 ${JSON.stringify(raw)}` };
			options.port = value;
		} else return { error: `未知参数：${arg}` };
	}
	return { options };
}
function configPathsFor(root, home) {
	const userRoot = join(home, "dsh-pet");
	return {
		defaultFile: join(root, "assets", "config.jsonc"),
		userFile: join(userRoot, "main-config.jsonc"),
		legacyUserFile: join(userRoot, "main-config.json"),
		petDir: join(userRoot, "pet")
	};
}
function describePets(pets) {
	if (pets.length === 0) return "（没有宠物：配置里 pets 为空）";
	return pets.map((pet) => `${String(pet.id ?? "?")}(size=${String(pet.size ?? "?")}, display=${String(pet.display ?? "?")})`).join("  ");
}
function isDesktopVisible(pet) {
	const display = pet.display;
	return display === "desktop" || display === "both";
}

//#endregion
//#region src/standalone/check.ts
function packageVersion(root) {
	try {
		const parsed = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
		return typeof parsed.version === "string" ? parsed.version : "unknown";
	} catch {
		return "unknown";
	}
}
function runCheck(logger) {
	const home = dshHomeDir();
	const paths = configPathsFor(packageRoot, home);
	const electron = resolveElectronPath();
	const lines = [
		`Node            ${process.version}（${process.platform}-${process.arch}）`,
		`插件            dsh-pet@${packageVersion(packageRoot)}  ${packageRoot}`,
		`DSH_HOME        ${home}`,
		`用户配置        ${paths.userFile}${existsSync(paths.userFile) ? "" : "（不存在 → 用包内默认）"}`,
		`文件宠物目录    ${paths.petDir}${existsSync(paths.petDir) ? "" : "（不存在）"}`,
		`内置默认配置    ${paths.defaultFile}${existsSync(paths.defaultFile) ? "" : "  ✗ 缺失"}`,
		`Electron        ${electron ?? `未发现（首次运行会下载到 ${electronLandingDir()}）`}`,
		`图形显示环境    ${hasGraphicalDisplay() ? "有" : "无（桌面小窗会跳过；远程桌面/Xvfb 可设 DSH_PET_DESKTOP_FORCE=1）"}`
	];
	const fail$1 = (message) => {
		for (const line of lines) logger.info(line);
		logger.error(message);
		return 1;
	};
	if (!existsSync(paths.defaultFile)) return fail$1("包内默认配置读不到：很可能是在**直接跑源码**（包根被解析成了 src/）。独立模式请用构建产物：npm run bundle 后 node lib/standalone.js，或 npm run standalone。");
	try {
		const merged = readAllConfig(paths);
		const entries = Object.keys(merged);
		lines.push(`配置条目        ${entries.length} 个：${entries.join(", ") || "（空）"}`);
		for (const entry of entries) {
			const conf = merged[entry] ?? {};
			const pets = Array.isArray(conf.pets) ? conf.pets : [];
			const animations = conf.animations;
			const idle = Array.isArray(animations?.idle) ? animations.idle.length : 0;
			lines.push(`  条目 ${entry}：宠物 ${pets.length} 只  ${describePets(pets)}｜idle 动画 ${idle} 个`);
		}
		const desktopVisible = flattenPetList(merged).filter(isDesktopVisible);
		lines.push(`桌面小窗        ${desktopVisible.length} 只${desktopVisible.length === 0 ? "（display 需要 desktop 或 both，否则独立模式没有可显示的宠物）" : ""}`);
		for (const line of lines) logger.info(line);
		logger.info("结论：配置与 Electron 就绪，可以直接启动（npm run standalone）。");
		return 0;
	} catch (error) {
		return fail$1(`读配置失败：${error instanceof Error ? error.message : String(error)}`);
	}
}

//#endregion
//#region src/standalone/ai-storage.ts
/** 配置文件的字节上限。 */
const MAX_CONFIG_BYTES = 32768;
/** 只把权限授给当前用户；绝不把 shell 命令、账户名或未校验的 SID 交给 icacls。 */
function restrictFile(path) {
	if (process.platform !== "win32") {
		chmodSync(path, 384);
		return;
	}
	const identity = execFileSync(join(process.env.SystemRoot ?? "C:\\Windows", "System32", "whoami.exe"), [
		"/user",
		"/fo",
		"csv",
		"/nh"
	], {
		encoding: "utf8",
		windowsHide: true
	});
	const sid = identity.match(/\bS-1-\d+(?:-\d+)+\b/)?.[0];
	if (!sid) throw new Error("Cannot identify file owner");
	execFileSync(join(process.env.SystemRoot ?? "C:\\Windows", "System32", "icacls.exe"), [
		path,
		"/inheritance:r",
		"/grant:r",
		`*${sid}:F`
	], {
		stdio: "pipe",
		windowsHide: true
	});
}
/** 解析并准备配置目录，拒绝符号链接。 */
function configPath(home) {
	const directory = join(home, "dsh-pet");
	if (!existsSync(directory)) mkdirSync(directory, {
		recursive: true,
		mode: 448
	});
	const info = lstatSync(directory);
	if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Unsafe settings directory");
	return join(directory, "standalone-ai.json");
}
function readAiSettings(home) {
	const path = configPath(home);
	if (!existsSync(path)) return void 0;
	const stat$1 = lstatSync(path);
	if (!stat$1.isFile() || stat$1.isSymbolicLink() || stat$1.size > MAX_CONFIG_BYTES) throw new Error("Unsafe settings file");
	if (process.platform === "win32") {
		const acl = execFileSync(join(process.env.SystemRoot ?? "C:\\Windows", "System32", "icacls.exe"), [path], {
			encoding: "utf8",
			windowsHide: true
		});
		if (/\b(?:Everyone|BUILTIN\\Users|Authenticated Users)\s*:/i.test(acl)) throw new Error("Unsafe settings permissions");
	}
	restrictFile(path);
	const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
	try {
		if (fstatSync(fd).size > MAX_CONFIG_BYTES) throw new Error("Settings file too large");
		return JSON.parse(readFileSync(fd, "utf8"));
	} finally {
		closeSync(fd);
	}
}
function writeAiSettings(home, settings) {
	writePrivateJson(configPath(home), settings);
}
function writePrivateJson(path, settings) {
	const directory = lstatSync(dirname(path));
	if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error("Unsafe private file directory");
	if (existsSync(path) && (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink())) throw new Error("Unsafe settings file");
	const temporary = `${path}.${randomUUID()}.tmp`;
	const fd = openSync(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 384);
	try {
		restrictFile(temporary);
		writeFileSync(fd, JSON.stringify(settings), { encoding: "utf8" });
		fsyncSync(fd);
		closeSync(fd);
	} catch (error) {
		closeSync(fd);
		unlinkSync(temporary);
		throw error;
	}
	try {
		renameSync(temporary, path);
	} catch (error) {
		unlinkSync(temporary);
		throw error;
	}
}

//#endregion
//#region src/standalone/ai-config.ts
const DEFAULT_AI_SETTINGS = Object.freeze({
	protocol: "openai-compatible",
	baseUrl: "",
	model: "",
	enabled: false,
	automaticWhispers: false,
	whisperIntervalSec: 300,
	maxTokens: 1024,
	timeoutMs: 3e4,
	apiKey: ""
});
/** 只接受空值或干净的 HTTP 或 HTTPS 地址；账号、查询参数与片段都不允许。 */
function safeEndpoint(value) {
	if (!value) return true;
	if (value !== value.trim() || /[\s\\]/.test(value)) return false;
	try {
		const url = new URL(value);
		if (url.username || url.password || url.search || url.hash || value.includes("?") || value.includes("#")) return false;
		return ["http:", "https:"].includes(url.protocol);
	} catch {
		return false;
	}
}
/** 检查控制字符，避免不可见字符写进配置。 */
function containsControlChar(s) {
	for (let i = 0; i < s.length; i++) {
		const code = s.charCodeAt(i);
		if (code >= 0 && code <= 31 || code === 127) return true;
	}
	return false;
}
/** 成品配置的字段契约：长度、范围与字符集在这里一次定死。 */
const fields = {
	protocol: z.enum(["openai-compatible", "anthropic"]),
	baseUrl: z.string().max(2048).refine(safeEndpoint),
	model: z.string().trim().max(200).refine((s) => !containsControlChar(s)),
	enabled: z.boolean(),
	automaticWhispers: z.boolean(),
	whisperIntervalSec: z.number().int().min(60).max(86400),
	maxTokens: z.number().int().min(128).max(4096),
	timeoutMs: z.number().int().min(1e3).max(6e4),
	apiKey: z.string().max(4096).refine((s) => !containsControlChar(s) && !/\s/.test(s))
};
/** 落盘内容的完整校验。 */
const persistedSchema = z.object(fields).strict();
/** 设置页提交的补丁校验，允许额外带一个清空密钥标记。 */
const patchSchema = persistedSchema.partial().extend({ clearApiKey: z.boolean().optional() }).strict();
function validateSettings(input, previous) {
	try {
		const patch = patchSchema.parse(input);
		if (patch.clearApiKey && patch.apiKey) throw new Error("Conflicting key changes");
		const { clearApiKey,...values } = patch;
		const apiKey = clearApiKey ? "" : values.apiKey || previous.apiKey;
		const next = persistedSchema.parse({
			...previous,
			...values,
			apiKey
		});
		if (next.enabled && (!next.model || !next.baseUrl || !next.apiKey)) throw new Error("Incomplete settings");
		return next;
	} catch {
		throw new Error("Invalid standalone AI settings.");
	}
}
/** 去掉密钥，只保留是否已保存。 */
function redact(settings) {
	const { apiKey,...publicFields } = settings;
	return {
		...publicFields,
		hasKey: apiKey.length > 0
	};
}
function createAiConfig(home) {
	let settings = DEFAULT_AI_SETTINGS;
	try {
		const loaded = readAiSettings(home);
		if (loaded !== void 0) settings = Object.freeze(validateSettings(persistedSchema.parse(loaded), DEFAULT_AI_SETTINGS));
	} catch {
		throw new Error("Cannot securely load standalone AI settings.");
	}
	return {
		current: () => settings,
		publicSettings: () => redact(settings),
		async save(input) {
			const next = validateSettings(input, settings);
			try {
				writeAiSettings(home, next);
			} catch {
				throw new Error("Cannot securely save standalone AI settings.");
			}
			settings = Object.freeze(next);
			return redact(settings);
		}
	};
}

//#endregion
//#region src/standalone/ai-provider/limits.ts
const PROVIDER = "standalone";
const MAX_INPUT_CHARS = 32768;
const MAX_OUTPUT_CHARS = 16384;
const MAX_EVENTS = 4096;
const REQUESTS_PER_MINUTE = 6;
const RATE_WINDOW_MS = 6e4;
const textBlock = z.object({
	type: z.literal("text"),
	text: z.string().max(MAX_INPUT_CHARS)
});
/** 消息契约：只保留角色与受限内容。 */
const messageSchema = z.object({
	role: z.enum(["user", "assistant"]),
	content: z.union([z.string().max(MAX_INPUT_CHARS), z.array(z.unknown()).max(128)])
});
const inputSchema = z.object({
	provider: z.literal(PROVIDER),
	model: z.string().max(200),
	system: z.string().max(MAX_INPUT_CHARS).optional(),
	messages: z.array(messageSchema).min(1).max(64),
	signal: z.custom((value) => value instanceof AbortSignal).optional()
});

//#endregion
//#region src/standalone/ai-transport.ts
/** SDK 的静默 logger，避免把请求细节写进日志。 */
const quiet = {
	debug() {},
	info() {},
	warn() {},
	error() {}
};
function isolatedFetch(settings, fetcher) {
	const base = settings.baseUrl.replace(/\/+$/, "");
	const expected = base + (settings.protocol === "anthropic" ? "/v1/messages" : "/chat/completions");
	return async (url, init) => {
		const beta = settings.protocol === "anthropic" && new URL(base).origin === "https://api.anthropic.com" && settings.model === "claude-opus-5-5";
		const urlStr = String(url);
		const validOpenAi = settings.protocol === "openai-compatible" && (urlStr === expected || urlStr === base + "/chat/completions" || urlStr === base + "/v1/chat/completions");
		const validAnthropic = settings.protocol === "anthropic" && (urlStr === expected + (beta ? "?beta=true" : "") || urlStr === base + "/messages" || urlStr === base + "/v1/messages" + (beta ? "?beta=true" : ""));
		if (!validOpenAi && !validAnthropic) throw new Error("Unexpected standalone AI endpoint.");
		const headers = new Headers({
			"content-type": "application/json",
			accept: "application/json"
		});
		if (settings.protocol === "anthropic") {
			headers.set("x-api-key", settings.apiKey);
			headers.set("anthropic-version", "2023-06-01");
			if (new URL(base).origin === "https://api.anthropic.com" && settings.model === "claude-opus-5-5") headers.set("anthropic-beta", "server-side-fallback-2026-07-01");
		} else headers.set("authorization", `Bearer ${settings.apiKey}`);
		return fetcher(url, {
			method: "POST",
			body: init?.body,
			headers,
			signal: init?.signal,
			redirect: "error"
		});
	};
}
async function* sdkTextStream(settings, request, signal, fetcher) {
	const shared = {
		apiKey: settings.apiKey,
		baseURL: settings.baseUrl.replace(/\/+$/, ""),
		maxRetries: 0,
		timeout: settings.timeoutMs,
		fetch: isolatedFetch(settings, fetcher),
		logger: quiet,
		logLevel: "off"
	};
	if (settings.protocol === "openai-compatible") {
		const client$1 = new OpenAI({
			...shared,
			organization: null,
			project: null,
			webhookSecret: null
		});
		const messages = [...request.system ? [{
			role: "system",
			content: request.system
		}] : [], ...request.messages];
		const stream$1 = await client$1.chat.completions.create({
			model: settings.model,
			messages,
			stream: true,
			max_tokens: settings.maxTokens,
			n: 1
		}, { signal });
		for await (const event of stream$1) {
			const delta = event.choices.find((choice) => choice.index === 0)?.delta;
			if (delta?.refusal) yield { refusal: true };
			if (delta?.content) yield { text: delta.content };
		}
		return;
	}
	const client = new Anthropic({
		...shared,
		authToken: null,
		webhookKey: null
	});
	const opus = settings.model === "claude-opus-5-5";
	const firstParty = new URL(settings.baseUrl).origin === "https://api.anthropic.com";
	const parameters = {
		model: settings.model,
		max_tokens: settings.maxTokens,
		system: request.system,
		messages: request.messages,
		stream: true,
		...opus ? {
			thinking: { type: "adaptive" },
			output_config: { effort: "low" }
		} : {}
	};
	const stream = opus && firstParty ? await client.beta.messages.create({
		...parameters,
		betas: ["server-side-fallback-2026-07-01"],
		fallbacks: "default"
	}, { signal }) : await client.messages.create(parameters, { signal });
	for await (const event of stream) {
		if (event.type === "message_delta" && event.delta.stop_reason === "refusal") yield { refusal: true };
		if (event.type === "content_block_delta" && event.delta.type === "text_delta") yield { text: event.delta.text };
	}
}
function isAuthenticationFailure(error) {
	return error instanceof OpenAI.AuthenticationError || error instanceof OpenAI.PermissionDeniedError || error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError;
}
function isRateLimitFailure(error) {
	return error instanceof OpenAI.RateLimitError || error instanceof Anthropic.RateLimitError;
}

//#endregion
//#region src/standalone/ai-provider/request.ts
function parseRequest(options, model) {
	const parsed = inputSchema.safeParse(options);
	if (!parsed.success || parsed.data.model !== model) throw new Error("Invalid standalone AI model selection or input.");
	const { data } = parsed;
	const messages = data.messages.map((message) => ({
		role: message.role,
		content: typeof message.content === "string" ? message.content : message.content.map((block) => {
			if (typeof block !== "object" || block === null || !("type" in block) || block.type !== "text") return "";
			const result = textBlock.safeParse(block);
			if (!result.success) throw new Error("Invalid standalone AI text input.");
			return result.data.text;
		}).join("")
	})).filter((message) => message.content.trim().length > 0);
	const system = data.system ?? "";
	const size = system.length + messages.reduce((sum, message) => sum + message.content.length, 0);
	if (size > MAX_INPUT_CHARS || messages.length === 0 || messages[0].role !== "user" || messages[messages.length - 1]?.role !== "user") throw new Error("Standalone AI input is empty or exceeds limits.");
	return {
		request: {
			system,
			messages
		},
		signal: data.signal
	};
}
function abortable(promise, signal) {
	if (signal.aborted) return Promise.reject(new Error("Standalone AI request cancelled."));
	return new Promise((resolve$1, reject) => {
		const abort = () => reject(new Error("Standalone AI request cancelled."));
		signal.addEventListener("abort", abort, { once: true });
		promise.then(resolve$1, reject).finally(() => signal.removeEventListener("abort", abort));
	});
}

//#endregion
//#region src/standalone/ai-provider/stream.ts
/** 本层自己写的固定文案：只有这些能原样透出给调用方。 */
const OWN_MESSAGES = [
	"Standalone AI could not answer this request.",
	"Standalone AI returned no text.",
	"Standalone AI response exceeds limits."
];
/** 把传输层异常归一成可示人的错误；鉴权失败顺带置位暂停，等用户重新保存设置。 */
function normalizeFailure(runtime, controller, error) {
	if (isAuthenticationFailure(error)) {
		runtime.paused = true;
		runtime.logger.warn("Standalone AI authentication failed; save settings again to resume.");
		return new Error("Standalone AI authentication failed. Check credentials and save settings again.", { cause: error });
	}
	if (controller.signal.aborted) return new Error("Standalone AI request cancelled or timed out.", { cause: error });
	if (isRateLimitFailure(error)) return new Error("Standalone AI provider rate limit reached. Please wait.", { cause: error });
	if (error instanceof Error && OWN_MESSAGES.includes(error.message)) return error;
	runtime.logger.warn("Standalone AI request failed.");
	return new Error("Standalone AI request failed. Check the endpoint and model settings.", { cause: error });
}
function createTextStream(runtime) {
	return async function* stream(options) {
		if (!runtime.ready()) throw new Error("Standalone AI is not ready. Configure and enable the model first.");
		const settings = runtime.store.current();
		const { request, signal: callerSignal } = parseRequest(options, settings.model);
		if (callerSignal?.aborted) throw new Error("Standalone AI request cancelled.");
		if (runtime.active) throw new Error("Standalone AI is busy. Please wait.");
		const recent = runtime.requests.filter((time) => runtime.now() - time < RATE_WINDOW_MS);
		if (recent.length >= REQUESTS_PER_MINUTE) throw new Error("Standalone AI rate limit reached. Please wait.");
		runtime.requests = [...recent, runtime.now()];
		const controller = new AbortController();
		runtime.active = controller;
		const abort = () => controller.abort();
		callerSignal?.addEventListener("abort", abort, { once: true });
		const timer = setTimeout(abort, settings.timeoutMs);
		const iterator = sdkTextStream(settings, request, controller.signal, runtime.fetcher)[Symbol.asyncIterator]();
		let emitted = 0;
		let events = 0;
		try {
			while (true) {
				const part = await abortable(iterator.next(), controller.signal);
				if (controller.signal.aborted || !runtime.ready()) throw new Error("Standalone AI request cancelled.");
				if (part.done) break;
				if (++events > MAX_EVENTS) throw new Error("Standalone AI response exceeds limits.");
				if (part.value.refusal) throw new Error("Standalone AI could not answer this request.");
				const text = part.value.text;
				if (!text) continue;
				emitted += text.length;
				if (emitted > MAX_OUTPUT_CHARS) throw new Error("Standalone AI response exceeds limits.");
				yield {
					type: "text",
					text
				};
			}
			if (emitted === 0) throw new Error("Standalone AI returned no text.");
		} catch (error) {
			throw normalizeFailure(runtime, controller, error);
		} finally {
			clearTimeout(timer);
			callerSignal?.removeEventListener("abort", abort);
			controller.abort();
			if (runtime.active === controller) runtime.active = void 0;
			iterator.return?.().catch(() => runtime.logger.debug("Standalone AI transport closed."));
		}
	};
}

//#endregion
//#region src/standalone/ai-provider/test-connection.ts
/** 探测请求的封顶时长：与正式通道的设置超时无关，固定 15 秒。 */
const PROBE_TIMEOUT_MS = 15e3;
/** 收到这么多字符就认为连通，不再等模型把话说完。 */
const PROBE_MAX_CHARS = 40;
/** 三项必填的提示文案；都填了返回 null。 */
function missingField(baseUrl, model, apiKey) {
	if (!baseUrl) return "请先填写接口地址（Base URL）";
	if (!model) return "请先填写模型名称";
	if (!apiKey) return "请先填写 API 密钥";
	return null;
}
/** 把探测失败翻成可操作的一句话；原始 message 只在兜底分支透出。 */
function describeFailure(error, controller) {
	if (controller.signal.aborted) return "连接超时（15 秒未响应）：请检查网络连通性或服务器状态";
	if (isAuthenticationFailure(error)) return "身份验证失败 (HTTP 401/403)：请检查 API 密钥是否正确";
	if (isRateLimitFailure(error)) return "请求受限或配额超限 (HTTP 429)：请检查 API 账户余额或调用频率";
	const raw = error instanceof Error ? error.message : String(error);
	if (raw.includes("404")) return "接口路径或模型不存在 (HTTP 404)：请检查接口地址（通常以 /v1 结尾）与模型名称";
	if (raw.includes("ECONNREFUSED") || raw.includes("fetch failed")) return "无法连接到目标服务器：请检查地址与端口是否正确、服务器是否正在运行";
	return `连接失败：${raw}`;
}
async function testAiConnection(fetcher, current$2, input) {
	const protocol = input.protocol === "anthropic" ? "anthropic" : input.protocol ?? current$2.protocol;
	const baseUrl = (input.baseUrl !== void 0 ? input.baseUrl : current$2.baseUrl).trim();
	const model = (input.model !== void 0 ? input.model : current$2.model).trim();
	const apiKey = (input.apiKey !== void 0 && input.apiKey !== "" ? input.apiKey : current$2.apiKey).trim();
	const missing = missingField(baseUrl, model, apiKey);
	if (missing !== null) return {
		ok: false,
		message: missing
	};
	const settings = {
		protocol,
		baseUrl,
		model,
		apiKey,
		enabled: true,
		automaticWhispers: false,
		whisperIntervalSec: 300,
		maxTokens: 32,
		timeoutMs: PROBE_TIMEOUT_MS
	};
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
	try {
		const probe = sdkTextStream(settings, {
			system: "",
			messages: [{
				role: "user",
				content: "hi"
			}]
		}, controller.signal, fetcher);
		let reply = "";
		for await (const chunk of probe) {
			if (chunk.refusal) return {
				ok: false,
				message: "模型拒绝回答该测试请求"
			};
			if (!chunk.text) continue;
			reply += chunk.text;
			if (reply.length >= PROBE_MAX_CHARS) break;
		}
		return reply.trim() ? {
			ok: true,
			message: "连接成功！模型响应正常。",
			reply: reply.trim()
		} : {
			ok: true,
			message: "连接成功！接口已成功响应。",
			reply: "(模型返回了空白内容)"
		};
	} catch (error) {
		return {
			ok: false,
			message: describeFailure(error, controller)
		};
	} finally {
		clearTimeout(timer);
	}
}

//#endregion
//#region src/standalone/ai-provider/create.ts
/**
* 保存设置：单飞、先中止在途请求，失败即暂停，等下一次保存成功才恢复。
* @throws 服务已释放、另一次保存正在进行，或存储层校验/落盘失败时。
*/
async function saveSettings(runtime, store, input) {
	if (runtime.disposed) throw new Error("Standalone AI is disposed.");
	if (runtime.saving) throw new Error("Standalone AI settings are being saved.");
	runtime.saving = true;
	runtime.active?.abort();
	try {
		const result = await store.save(input);
		if (!runtime.disposed) runtime.paused = false;
		return result;
	} catch (error) {
		runtime.paused = true;
		throw error;
	} finally {
		runtime.saving = false;
	}
}
function createStandaloneAi(home, logger, dependencies = {}) {
	let store;
	try {
		store = createAiConfig(home);
	} catch {
		logger.error("Cannot securely load standalone AI settings.");
		throw new Error("Cannot securely load standalone AI settings.");
	}
	const runtime = {
		store,
		logger,
		fetcher: dependencies.fetch ?? globalThis.fetch.bind(globalThis),
		now: dependencies.now ?? Date.now,
		disposed: false,
		paused: false,
		saving: false,
		requests: [],
		active: void 0,
		ready() {
			return !runtime.disposed && !runtime.paused && !runtime.saving && store.current().enabled && !!store.current().model && !!store.current().baseUrl && !!store.current().apiKey;
		}
	};
	const modelOf = () => store.current().model;
	return {
		currentSelection: () => ({
			provider: PROVIDER,
			model: runtime.ready() ? modelOf() : ""
		}),
		listProviders: () => runtime.ready() ? [{
			id: PROVIDER,
			name: "Standalone AI"
		}] : [],
		listModels: async (provider) => runtime.ready() && provider === PROVIDER ? [{
			id: modelOf(),
			name: modelOf()
		}] : [],
		resolveModelInfo: async (provider = PROVIDER, model = modelOf(), signal) => runtime.ready() && !signal?.aborted && provider === PROVIDER && model === modelOf() ? {
			id: model,
			name: model
		} : void 0,
		stream: createTextStream(runtime),
		getSettings: () => store.publicSettings(),
		saveSettings: (input) => saveSettings(runtime, store, input),
		isReady: () => runtime.ready(),
		testConnection: (input) => runtime.disposed ? Promise.resolve({
			ok: false,
			message: "服务已关闭"
		}) : testAiConnection(runtime.fetcher, store.current(), input),
		canWhisper: () => runtime.ready() && store.current().automaticWhispers,
		dispose() {
			runtime.disposed = true;
			runtime.active?.abort();
		}
	};
}

//#endregion
//#region src/standalone/runtime-state.ts
function writeStandaloneRuntime(home, details) {
	const directory = join(home, "dsh-pet");
	mkdirSync(directory, { recursive: true });
	const file = join(directory, "standalone-runtime.json");
	try {
		writePrivateJson(file, {
			name: "dsh-pet-standalone",
			pid: process.pid,
			startedAt: new Date().toISOString(),
			...details
		});
	} catch (error) {
		throw new Error("无法安全写入桌宠运行状态，请检查数据目录的访问权限。", { cause: error });
	}
	let released = false;
	return () => {
		if (released) return;
		released = true;
		try {
			const current$2 = JSON.parse(readFileSync(file, "utf8"));
			if (current$2.pid === process.pid && current$2.token === details.token) unlinkSync(file);
		} catch (error) {
			if (error.code === "ENOENT") return;
			throw new Error("清理桌宠运行状态失败；请检查数据目录，未删除其他进程的状态。", { cause: error });
		}
	};
}

//#endregion
//#region src/standalone/llm-facade.ts
function createLlmFacade(ai) {
	return {
		listProviders: () => ai.listProviders(),
		listModels: (provider) => ai.listModels(provider),
		resolveModelInfo: (provider, model, signal) => ai.resolveModelInfo(provider, model, signal),
		stream: (request) => ai.stream(request)
	};
}
function createOfflineLlm() {
	return {
		listProviders: () => [],
		listModels: async () => [],
		resolveModelInfo: async () => void 0,
		stream: () => ({ [Symbol.asyncIterator]() {
			return { next: async () => {
				throw new Error("dsh-pet standalone: 独立模式未接入模型（碎碎念/对话不可用）");
			} };
		} })
	};
}

//#endregion
//#region src/standalone/context.ts
const STANDALONE_PROVIDER = "standalone";
/**
* webServer 替身：插件按前缀注册路由，独立模式的 server 再按同一份数组匹配。
*
* 端口用 getter 读取：服务先监听、端口确定之后才 apply，构造时取值会固定成 0。
*/
function createWebServer(routes, portOf) {
	return {
		get port() {
			return portOf();
		},
		register(spec) {
			routes.push({
				kind: spec.kind,
				path: spec.path,
				handler: spec.handler
			});
			return () => {
				const index = routes.findIndex((route) => route.handler === spec.handler);
				if (index >= 0) routes.splice(index, 1);
			};
		}
	};
}
/**
* Cordis 的 effect 语义：跑一次注册函数并收集它返回的释放函数。
* 单项失败只记录并打日志，不让整个插件起不来。
*/
function createEffectRunner(disposers, failures, logger) {
	return (fn) => {
		try {
			const dispose = fn();
			if (typeof dispose === "function") disposers.push(dispose);
			return dispose;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			failures.push(message);
			logger.error(`初始化某项失败（已跳过）：${message}`);
			return void 0;
		}
	};
}
/**
* Cordis 的 provide / get 语义：先查注册表，再回落到伪 ctx 自身的属性。
* 独立模式把可选能力直接挂在伪 ctx 上，不回落会把本来就有的能力判成没有。
*/
function createServiceRegistry(services, attrs) {
	return {
		provide(name, value) {
			services.set(name, value);
			return () => {
				if (services.get(name) === value) services.delete(name);
			};
		},
		get(name) {
			const registered = services.get(name);
			if (registered !== void 0) return registered;
			return attrs()[name];
		}
	};
}
function createStandaloneContext(options) {
	const { logger, ai } = options;
	const routes = options.routes ?? [];
	const failures = [];
	/** effect 释放函数，后注册先释放。 */
	const disposers = [];
	/** 通过 provide 挂出去的服务。 */
	const services = new Map();
	let disposed = false;
	const portOf = () => typeof options.port === "function" ? options.port() : options.port;
	const webServer = createWebServer(routes, portOf);
	const context = {
		effect: createEffectRunner(disposers, failures, logger),
		...createServiceRegistry(services, () => context),
		on() {
			return () => {};
		},
		logger,
		webServer,
		connection: { authenticatedUrl: options.authenticatedUrl ?? ((baseUrl) => baseUrl) },
		...ai ? { standaloneAi: {
			isReady: () => ai.isReady(),
			canWhisper: () => ai.canWhisper(),
			whisperIntervalSec: () => ai.getSettings().whisperIntervalSec
		} } : {},
		...options.shutdown ? { shutdownApp: options.shutdown } : {},
		commands: { register: () => () => {} },
		agentDefaultModel: { currentSelection: () => ai?.currentSelection() ?? {
			provider: STANDALONE_PROVIDER,
			model: ""
		} },
		credentials: { resolve: async () => void 0 },
		llm: ai ? createLlmFacade(ai) : createOfflineLlm()
	};
	return {
		ctx: context,
		routes,
		failures,
		async dispose() {
			if (disposed) return;
			disposed = true;
			ai?.dispose();
			for (const dispose of disposers.splice(0).reverse()) try {
				await dispose();
			} catch (error) {
				logger.warn(`释放某项失败：${error instanceof Error ? error.message : String(error)}`);
			}
		}
	};
}

//#endregion
//#region src/standalone/logger.ts
function createStandaloneLogger(options = {}) {
	if (options.file) return createFileLogger({
		file: options.file,
		base: console,
		debugEnabled: process.env.DSH_PET_LOG_DEBUG === "1"
	});
	const stamp = () => new Date().toISOString().replace("T", " ").slice(0, 19);
	const write = (level, message) => {
		console.log(`[dsh-pet-standalone ${stamp()}] ${level} ${message}`);
	};
	return {
		info: (message) => write("INFO ", message),
		warn: (message) => write("WARN ", message),
		error: (message) => write("ERROR", message),
		debug: (message) => {
			if (process.env.DSH_PET_STANDALONE_DEBUG === "1") write("DEBUG", message);
		}
	};
}

//#endregion
//#region src/standalone/cli.ts
/** 启动独立模式：先起服务拿到端口，再 apply。 */
async function run(logger, options) {
	const home = dshHomeDir();
	const paths = configPathsFor(packageRoot, home);
	if (!existsSync(paths.defaultFile)) {
		logger.error(`包内默认配置缺失：${paths.defaultFile}。若你是在直接跑源码（包根被解析成了 src/），请改用构建产物：npm run bundle 后 node lib/standalone.js（或 npm run standalone）。`);
		process.exitCode = 1;
		return;
	}
	const routes = [];
	let forwardShutdown = () => {};
	const portRef = { value: options.port };
	const ai = createStandaloneAi(home, logger);
	const security = createRequestSecurity();
	const context = createStandaloneContext({
		port: () => portRef.value,
		logger,
		routes,
		ai,
		authenticatedUrl: security.authenticatedUrl,
		shutdown: (reason) => forwardShutdown(reason)
	});
	const server = await listenStandaloneServer({
		routes,
		logger,
		port: options.port,
		security,
		ai,
		status: () => ({
			name: "dsh-pet-standalone",
			pid: process.pid,
			pluginRoot: packageRoot,
			plugin: {
				root: packageRoot,
				version: packageVersion(packageRoot)
			},
			port: portRef.value,
			uptimeSec: Math.round(process.uptime())
		}),
		onShutdown: () => forwardShutdown("POST /shutdown")
	});
	portRef.value = server.port;
	let releaseRuntime;
	try {
		releaseRuntime = writeStandaloneRuntime(home, {
			port: server.port,
			token: security.token,
			settingsUrl: security.authenticatedUrl(`http://127.0.0.1:${server.port}`),
			pluginRoot: packageRoot
		});
	} catch (error) {
		await context.dispose();
		await server.close();
		throw error;
	}
	let shuttingDown = false;
	const shutdown = async (reason) => {
		if (shuttingDown) return;
		shuttingDown = true;
		logger.info(`收尾（${reason}）…`);
		try {
			await context.dispose();
		} finally {
			await server.close();
			releaseRuntime();
		}
		logger.info("已退出。");
	};
	const requestShutdown = (reason) => {
		shutdown(reason).then(() => process.exit(0)).catch((error) => {
			logger.error(`收尾失败：${error instanceof Error ? error.message : String(error)}`);
			process.exit(1);
		});
	};
	forwardShutdown = (reason) => requestShutdown(reason);
	process.on("SIGINT", () => requestShutdown("SIGINT"));
	process.on("SIGTERM", () => requestShutdown("SIGTERM"));
	apply(context.ctx);
	let pets = [];
	let configSource = paths.userFile;
	try {
		pets = flattenPetList(readAllConfig(paths));
		if (!existsSync(paths.userFile)) configSource = `${paths.userFile}（不存在 → 用包内默认）`;
	} catch (error) {
		logger.warn(`读配置失败（服务照常运行，相关端点会显式报错）：${error instanceof Error ? error.message : String(error)}`);
	}
	const desktopVisible = pets.filter(isDesktopVisible);
	for (const line of [
		"",
		"===== dsh-pet 独立模式（不需要 DSH）=====",
		`  插件        dsh-pet@${packageVersion(packageRoot)}  ${packageRoot}`,
		`  路由        http://127.0.0.1:${server.port}${ROUTE_SEGMENT}/`,
		`  配置        ${configSource}`,
		`  宠物        ${describePets(pets)}`,
		desktopVisible.length === 0 ? "  桌面小窗    0 只：display 需要 desktop 或 both 才会出现透明小窗（服务仍在运行）" : `  桌面小窗    ${desktopVisible.length} 只`,
		ai.isReady() ? "  AI          本机 API 已启用；自动碎碎念遵循设置页开关" : "  AI          未配置或未启用，不发送模型请求；右键“打开 AI 设置”后在本机填写",
		"  不可用      余额 / 会话工作状态 / DSH 系统通知",
		"  退出        Ctrl+C、POST /shutdown，或桌面托盘菜单的「退出」",
		""
	]) logger.info(line);
	if (context.failures.length > 0) logger.warn(`初始化期间有 ${context.failures.length} 项失败（见上方日志）；路由仍可用，相关端点会显式报错`);
}
/** CLI 入口，返回进程退出码。 */
async function main() {
	const parsed = parseArgs(process.argv.slice(2));
	if ("error" in parsed) {
		console.error(`dsh-pet-standalone: ${parsed.error}\n`);
		console.error(USAGE);
		return 2;
	}
	const { options } = parsed;
	if (options.help) {
		console.log(USAGE);
		return 0;
	}
	const logger = createStandaloneLogger({ file: join(dshHomeDir(), "dsh-pet", "logs.txt") });
	setDefaultLogger(logger);
	if (options.check) return runCheck(logger);
	await run(logger, options);
	return 0;
}
main().then((code) => {
	if (code !== 0) process.exit(code);
}).catch((error) => {
	defaultLog("error", `dsh-pet-standalone: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
	process.exit(1);
});

//#endregion