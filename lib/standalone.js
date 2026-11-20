#!/usr/bin/env node
import { appendFileSync, chmodSync, closeSync, constants, createReadStream, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, normalize, resolve, sep } from "node:path";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
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
const DEFAULT_FONT = {
	family: "candy",
	size: 21,
	followPet: true
};
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
/** 本地时间的 ISO 形式（尾带偏移，如 `2026-11-11T16:40:58.123+08:00`）：日志要按用户所在时区读。 */
function localIso(now) {
	const pad = (value, width = 2) => String(Math.abs(Math.floor(value))).padStart(width, "0");
	const offsetMin = -now.getTimezoneOffset();
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(now.getMilliseconds(), 3)}${offsetMin >= 0 ? "+" : "-"}${pad(offsetMin / 60)}:${pad(offsetMin % 60)}`;
}
function formatLogLine(level, message, now) {
	return `${localIso(now)} [${level}] ${message}\n`;
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
	let dropped$1 = 0;
	/** 已离开 pending、尚未提交到文件的文本；退出与 dispose 靠它补写。 */
	let activeChunk = "";
	let flushing = null;
	let disposed = false;
	/** 目录只建一次（首次 flush 时）；失败后不再重试，日志静默降级 */
	let dirReady = null;
	const ensureDir = () => dirReady ??= mkdir(dirname(file), { recursive: true }).then(() => void 0).catch(() => void 0);
	/** 取走当前缓冲（含溢出提示）；取出后 pending 为空，文本改由调用方保管。 */
	const takePending = () => {
		const note = dropped$1 > 0 ? formatLogLine("warn", `日志缓冲溢出，丢弃 ${dropped$1} 条`, now()) : "";
		const chunk = note + pending.join("");
		pending = [];
		dropped$1 = 0;
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
			dropped$1 += pending.length - maxPending;
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
	"animationWeights",
	"font",
	"confineToScreen",
	"voiceEnabled",
	"voiceName",
	"voiceVolume",
	"voiceWhisperEnabled",
	"voiceTodoEnabled",
	"voiceNotifyEnabled",
	"speechProvider",
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
//#region src/host/voice/types.ts
const VOICE_ID_SEPARATOR = "/";
/** provider id 的形状：kebab-case，避免配置里出现空白、斜杠这类需要转义的形态。 */
const PROVIDER_ID_PATTERN$1 = /^[a-z0-9][a-z0-9-]*$/;
const VOICE_ID_PATTERN = /^[a-z0-9][a-z0-9-]*\/[^\s/]+$/;
const DEFAULT_PROVIDER_TIMEOUT_MS = 15e3;
function limitedVoiceId(providerId, voiceId) {
	return providerId + VOICE_ID_SEPARATOR + voiceId;
}
function splitVoiceId(limitedId) {
	const separatorAt = limitedId.indexOf(VOICE_ID_SEPARATOR);
	if (separatorAt <= 0) return void 0;
	const providerId = limitedId.slice(0, separatorAt);
	const voiceId = limitedId.slice(separatorAt + 1);
	if (voiceId.length === 0 || voiceId.includes(VOICE_ID_SEPARATOR)) return void 0;
	return {
		providerId,
		voiceId
	};
}
/** 非空字符串：`trim` 之后仍有内容。 */
function isFilledString$1(value) {
	return typeof value === "string" && value.trim().length > 0;
}
function validateVoiceProvider(def) {
	if (!def || typeof def !== "object") throw new TypeError("语音 provider 定义必须是对象");
	const provider = def;
	if (typeof provider.id !== "string" || !PROVIDER_ID_PATTERN$1.test(provider.id)) throw new TypeError(`provider id 必须是小写 kebab-case，收到 ${JSON.stringify(provider.id)}`);
	if (!isFilledString$1(provider.name)) throw new TypeError(`provider ${provider.id} 的 name 必须是非空字符串`);
	if (typeof provider.synthesize !== "function") throw new TypeError(`provider ${provider.id} 的 synthesize 必须是函数`);
	const format = provider.format;
	if (format !== void 0 && format !== "mp3" && format !== "wav") throw new TypeError(`provider ${provider.id} 的 format 必须是 mp3 或 wav，收到 ${JSON.stringify(format)}`);
	const timeoutMs = provider.timeoutMs;
	if (timeoutMs !== void 0 && (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0)) throw new TypeError(`provider ${provider.id} 的 timeoutMs 必须是正有限数，收到 ${JSON.stringify(timeoutMs)}`);
	const voices = provider.voices;
	if (!Array.isArray(voices) || voices.length === 0) throw new TypeError(`provider ${provider.id} 的 voices 必须是非空数组`);
	const seen = new Set();
	for (const rawVoice of voices) {
		if (!rawVoice || typeof rawVoice !== "object") throw new TypeError(`provider ${provider.id} 的 voices 项必须是对象`);
		const voice = rawVoice;
		if (!isFilledString$1(voice.id) || voice.id.includes(VOICE_ID_SEPARATOR)) throw new TypeError(`provider ${provider.id} 的音色 id 必须是非空且不含 '/' 的字符串，收到 ${JSON.stringify(voice.id)}`);
		if (!isFilledString$1(voice.name)) throw new TypeError(`provider ${provider.id} 的音色 ${voice.id} 缺少 name`);
		if (seen.has(voice.id)) throw new TypeError(`provider ${provider.id} 的音色 id 重复: ${voice.id}`);
		seen.add(voice.id);
	}
}

//#endregion
//#region src/host/config/validate.ts
/** 内置玩法动画的槽位数：`animations.baifan` 必须恰好这么多个（顺序是玩法契约，见 shared/types 的 Animations）。 */
const ACTIVITY_SLOTS = 5;
/** 天气城市覆盖的最大长度：再长不可能是个地名。 */
const ENVIRONMENT_CITY_MAX_LENGTH = 32;
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
	if (anims.baifan !== void 0 && !activitySlotsValid(anims.baifan)) return false;
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
/** baifan 段校验：恰好 {@link ACTIVITY_SLOTS} 个非空动画名。
*  写少写多都算非法——槽位按索引取，缺一个就是那个时机没有动画可播。 */
function activitySlotsValid(value) {
	if (!Array.isArray(value) || value.length !== ACTIVITY_SLOTS) return false;
	return value.every((name) => typeof name === "string" && name.length > 0);
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
		case "notifyWhenFocused": return typeof value === "boolean";
		case "clickSoundEnabled": return typeof value === "boolean";
		case "whisperImageEnabled": return typeof value === "boolean";
		case "voiceEnabled": return typeof value === "boolean";
		case "voiceName": return typeof value === "string" && VOICE_ID_PATTERN.test(value);
		case "voiceVolume": return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
		case "voiceWhisperEnabled": return typeof value === "boolean";
		case "voiceTodoEnabled": return typeof value === "boolean";
		case "voiceNotifyEnabled": return typeof value === "boolean";
		case "speechProvider": return typeof value === "string" && value.trim().length > 0;
		case "environmentCity": return typeof value === "string" && value.trim().length <= ENVIRONMENT_CITY_MAX_LENGTH;
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
	const nwf = o.notifyWhenFocused;
	if (nwf !== void 0 && typeof nwf !== "boolean") return null;
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
	const sp = o.speechProvider;
	if (sp !== void 0 && !topFieldValid("speechProvider", sp)) return null;
	const ec = o.environmentCity;
	if (ec !== void 0 && !topFieldValid("environmentCity", ec)) return null;
	const vv = o.voiceVolume;
	if (vv !== void 0 && !topFieldValid("voiceVolume", vv)) return null;
	const vwe = o.voiceWhisperEnabled;
	if (vwe !== void 0 && !topFieldValid("voiceWhisperEnabled", vwe)) return null;
	const vte = o.voiceTodoEnabled;
	if (vte !== void 0 && !topFieldValid("voiceTodoEnabled", vte)) return null;
	const vne = o.voiceNotifyEnabled;
	if (vne !== void 0 && !topFieldValid("voiceNotifyEnabled", vne)) return null;
	const te = o.trayEnabled;
	if (te !== void 0 && typeof te !== "boolean") return null;
	const ph = o.physics;
	if (ph !== void 0 && !physicsValid(ph)) return null;
	const aw = o.animationWeights;
	if (aw !== void 0 && !topFieldValid("animationWeights", aw)) return null;
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
	const cleanWeights = (v) => ({
		idle: Number(v.idle),
		turn: Number(v.turn),
		move: Number(v.move)
	});
	const outConfig = { pets: out };
	if (ne !== void 0) outConfig.notificationsEnabled = ne;
	if (nwf !== void 0) outConfig.notifyWhenFocused = nwf;
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
	if (vne !== void 0) outConfig.voiceNotifyEnabled = vne;
	if (sp !== void 0) outConfig.speechProvider = sp;
	if (ec !== void 0) outConfig.environmentCity = String(ec).trim();
	if (te !== void 0) outConfig.trayEnabled = te;
	if (ph !== void 0) outConfig.physics = ph;
	if (aw !== void 0) outConfig.animationWeights = cleanWeights(aw);
	if (fo !== void 0) outConfig.font = fo;
	if (wm !== void 0) outConfig.whisperModel = cleanModel(wm);
	if (cm !== void 0) outConfig.chatModel = cleanModel(cm);
	if (cmr !== void 0) outConfig.chatMemoryRounds = Number(cmr);
	if (cil !== void 0) outConfig.chatImageLimit = Number(cil);
	const bodyOwned = new Set(["pets"]);
	if (ne !== void 0) bodyOwned.add("notificationsEnabled");
	if (nwf !== void 0) bodyOwned.add("notifyWhenFocused");
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
	if (vne !== void 0) bodyOwned.add("voiceNotifyEnabled");
	if (sp !== void 0) bodyOwned.add("speechProvider");
	if (ec !== void 0) bodyOwned.add("environmentCity");
	if (te !== void 0) bodyOwned.add("trayEnabled");
	if (ph !== void 0) bodyOwned.add("physics");
	if (aw !== void 0) bodyOwned.add("animationWeights");
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
const packageRoot = PACKAGE_ROOT;
const defaultHelperMain = resolve(packageRoot, "runtime", "electron-helper", "main.js");
const DESKTOP_DEBUG_PORT = 0;
/** 强制 XWayland 的 Chromium 开关：Wayland 原生下小窗的定位/置顶/穿透都不可用。 */
const OZONE_X11_SWITCH = "--ozone-platform=x11";
function shouldForceXWayland(env = process.env, platform = process.platform) {
	return platform === "linux" && Boolean(env.WAYLAND_DISPLAY) && Boolean(env.DISPLAY);
}
function helperLaunchArgs$1(helperPath, options = {}) {
	const debugPort = options.debugPort ?? DESKTOP_DEBUG_PORT;
	const switches = [];
	if (options.forceX11 === true) switches.push(OZONE_X11_SWITCH);
	if (debugPort > 0) switches.push("--remote-debugging-port=" + debugPort);
	return [...switches, helperPath];
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
		args: helperLaunchArgs$1(helperPath, { forceX11: shouldForceXWayland() })
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
function helperOutputIsMeaningful(chunk) {
	return Boolean(chunk.trim());
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
		if (!this.options.command && shouldForceXWayland()) this.logger.info?.("dsh-pet desktop helper: Wayland 会话，强制 XWayland（--ozone-platform=x11）");
		else if (!this.options.command && process.platform === "linux" && process.env.WAYLAND_DISPLAY) this.logger.warn?.("dsh-pet desktop helper: 纯 Wayland 无 XWayland，桌面模式的定位/置顶/穿透不可用；请改用 X11 会话");
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
			const text = String(chunk);
			if (helperOutputIsMeaningful(text)) this.hasChildOutput = true;
			this.onStdoutChunk(text);
		});
		child.stderr.on("data", (chunk) => {
			const line = String(chunk).trim();
			if (helperOutputIsMeaningful(line)) {
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
const RETRIES$1 = 3;
/** 发起一次带超时的 fetch；失败抛错，是否重试由调用方决定。 */
async function fetchOnce$1(url, key) {
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
	for (let i = 0; i <= RETRIES$1; i++) try {
		return await fetchOnce$1(url, key);
	} catch (e) {
		last = e;
		if (i < RETRIES$1) await new Promise((r) => setTimeout(r, 800));
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
async function fetchJson$1(url, key, label) {
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
		const whoami = obj(await fetchJson$1(API_BASE + "/alpha/whoami" + queryString({ limits: "1" }), key, "/alpha/whoami"));
		const org = obj(whoami?.org);
		const orgId = typeof org?.id === "string" && org.id.length > 0 ? org.id : void 0;
		const credits = await fetchJson$1(API_BASE + "/alpha/billing/credits" + queryString({ orgId }), key, "/alpha/billing/credits");
		let subscription;
		try {
			subscription = await fetchJson$1(API_BASE + "/alpha/billing/subscriptions" + queryString({ orgId }), key, "/alpha/billing/subscriptions");
		} catch {
			subscription = void 0;
		}
		const summary = await fetchJson$1(API_BASE + "/alpha/usage/summary" + queryString({ orgId }), key, "/alpha/usage/summary");
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
const DEEPSEEK_OFFICIAL_PROVIDER_ID = "deepseek-official";
const deepseekOfficial = {
	id: DEEPSEEK_OFFICIAL_PROVIDER_ID,
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
/** 已注册的实现：provider id → 定义；Map 的插入顺序就是对外顺序。 */
const providers$1 = new Map();
function registerVoiceProvider(def) {
	validateVoiceProvider(def);
	if (providers$1.has(def.id)) throw new TypeError(`provider id 已被注册: ${def.id}`);
	providers$1.set(def.id, def);
	return () => {
		if (providers$1.get(def.id) === def) providers$1.delete(def.id);
	};
}
function resolveVoice(limitedId) {
	const parts = splitVoiceId(limitedId);
	if (!parts) return void 0;
	const provider = providers$1.get(parts.providerId);
	if (!provider) return void 0;
	const voice = provider.voices.find((item) => item.id === parts.voiceId);
	if (!voice) return void 0;
	return {
		provider,
		voice,
		limitedId
	};
}
function listCatalog() {
	return { providers: [...providers$1.values()].map((provider) => ({
		id: provider.id,
		name: provider.name,
		voices: provider.voices.map((voice) => ({
			id: limitedVoiceId(provider.id, voice.id),
			name: voice.name,
			...voice.tag === void 0 ? {} : { tag: voice.tag }
		}))
	})) };
}

//#endregion
//#region src/host/voice/speech-types.ts
var SpeechUnavailableError = class extends Error {
	constructor(message) {
		super(message);
		this.name = "SpeechUnavailableError";
	}
};
const DEFAULT_SPEECH_TIMEOUT_MS = 3e4;
/** provider id 的形状：kebab-case，避免配置里出现空白、斜杠这类需要转义的形态。 */
const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
/** 非空字符串：`trim` 之后仍有内容。 */
function isFilledString(value) {
	return typeof value === "string" && value.trim().length > 0;
}
function validateSpeechProvider(def) {
	if (!def || typeof def !== "object") throw new TypeError("语音识别 provider 定义必须是对象");
	const provider = def;
	if (typeof provider.id !== "string" || !PROVIDER_ID_PATTERN.test(provider.id)) throw new TypeError(`provider id 必须是小写 kebab-case，收到 ${JSON.stringify(provider.id)}`);
	if (!isFilledString(provider.name)) throw new TypeError(`provider ${provider.id} 的 name 必须是非空字符串`);
	if (typeof provider.transcribe !== "function") throw new TypeError(`provider ${provider.id} 的 transcribe 必须是函数`);
	const timeoutMs = provider.timeoutMs;
	if (timeoutMs !== void 0 && (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0)) throw new TypeError(`provider ${provider.id} 的 timeoutMs 必须是正有限数，收到 ${JSON.stringify(timeoutMs)}`);
}

//#endregion
//#region src/host/voice/speech-registry.ts
/** 已注册的实现：provider id → 定义；Map 的插入顺序就是对外顺序。 */
const providers = new Map();
function registerSpeechProvider(def) {
	validateSpeechProvider(def);
	if (providers.has(def.id)) throw new TypeError(`识别 provider id 已被注册: ${def.id}`);
	providers.set(def.id, def);
	return () => {
		if (providers.get(def.id) === def) providers.delete(def.id);
	};
}
function resolveSpeechProvider(id) {
	return providers.get(id);
}
function listSpeechCatalog() {
	return { providers: [...providers.values()].map((provider) => ({
		id: provider.id,
		name: provider.name
	})) };
}

//#endregion
//#region src/host/chat-memory-provider.ts
const NATIVE_MEMORY_ID = "native";
/** 当前生效的第三方实现；null = 没注册，走原生路径。 */
let current = null;
function registerChatMemoryProvider(def) {
	if (!def || typeof def !== "object") throw new TypeError("memory provider 定义必须是对象");
	if (typeof def.id !== "string" || def.id.length === 0) throw new TypeError("id 必须是非空字符串");
	if (def.id === NATIVE_MEMORY_ID) throw new TypeError("不能占用原生实现标识: " + NATIVE_MEMORY_ID);
	if (typeof def.recall !== "function" && typeof def.capture !== "function") throw new TypeError("recall 与 capture 至少要有一个是函数");
	current = def;
	return () => {
		if (current === def) current = null;
	};
}
function activeChatMemoryProvider() {
	return current;
}
function listChatMemoryProviders() {
	return {
		builtin: [NATIVE_MEMORY_ID],
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
		const current$1 = this.owners.get(owner);
		if (!current$1) return null;
		const out = {};
		for (const [label, pet] of current$1.items) {
			out[label] = pet;
			current$1.items.set(label, null);
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
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".gif": "image/gif",
	".wav": "audio/wav",
	".json": "application/json; charset=utf-8",
	".jsonc": "application/json; charset=utf-8",
	".ttf": "font/ttf",
	".woff": "font/woff",
	".woff2": "font/woff2"
};
const IMAGE_HEAD_BYTES = 16;
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
function imageExtOf(contentType) {
	if (contentType === "image/png") return ".png";
	if (contentType === "image/jpeg") return ".jpg";
	if (contentType === "image/webp") return ".webp";
	if (contentType === "image/gif") return ".gif";
	return void 0;
}
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
const MAX_BODY_BYTES = 10 * 1024 * 1024;
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
			menu: emptyLeaf(),
			focusSession: emptyLeaf(),
			env: emptyLeaf()
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
/** 回合结束原因 → 档位；null = 该会话回合已结束，由调用方清理回空闲——残留上一档会让回合被
*  打断后永远卡在 working。 */
function turnEndState(kind) {
	if (kind === "completed") return "success";
	if (kind === "error" || kind === "max-tokens" || kind === "timeout") return "error";
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
	let current$1;
	for (const t of todos) if (t?.status === "in_progress") current$1 = t;
	if (!current$1) current$1 = todos.find((t) => t?.status === "pending");
	const content = String(current$1?.content ?? "").trim();
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
			sessionId: null,
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
			task: prev?.task ?? null,
			sessionId
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
	/** 重算展示：state / task / sessionId 任一变化才更新 ts（轮询侧据此触发，两端都靠它刷新）。 */
	refresh() {
		const best = pickDisplayed(this.sessions.values());
		const nextState = best?.state ?? null;
		const nextTask = best?.task ?? null;
		const nextSession = best?.sessionId ?? null;
		if (nextState === this.snap.state && nextTask === this.snap.task && nextSession === this.snap.sessionId) return;
		this.snap.state = nextState;
		this.snap.task = nextTask;
		this.snap.sessionId = nextSession;
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
	/** 独立模式的余额凭证（可选能力）：DSH 宿主里是 undefined → 回落到模型服务商与 credential store。 */
	const standaloneAiBalance = () => {
		const service = optionalService("standaloneAi");
		return service?.balanceAuth?.();
	};
	/** 独立模式单独保存的 DeepSeek 语音密钥：对话与语音可以用不同服务商。 */
	const standaloneDeepseekKey = () => {
		const service = optionalService("standaloneAi");
		const key = service?.deepseekKey?.();
		return key ? key : void 0;
	};
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
			list: listCatalog
		},
		speech: {
			register: registerSpeechProvider,
			list: listSpeechCatalog
		},
		memory: {
			register: registerChatMemoryProvider,
			list: listChatMemoryProviders
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
		standaloneAiBalance,
		standaloneDeepseekKey,
		state,
		menuRegistry,
		playback,
		workStatus,
		EXTERNAL_WORK_SESSION,
		nextExternalWorkSeq
	};
}

//#endregion
//#region src/host/fetch-json.ts
/**
* 出站 JSON GET 的唯一入口：带超时与一次重试，非 2xx 与解析失败一律抛错。
*
* 天气与定位共用这里；余额那份自带 Bearer 头，不强行合并。
* 始终成立：成功时返回已解析的 JSON 值；错误文案只带端点名与状态码，不带完整 URL 与响应体。
* @module dsh-pet/src/host/fetch-json
*/
/** 单次请求超时（ms）：境外接口冷启动实测 3~6s，留足余量。 */
const TIMEOUT_MS$2 = 15e3;
/** 失败重试次数：只补一次网络抖动，再多会把一次查询拖到半分钟。 */
const RETRIES = 1;
/** 重试前的等待（ms）。 */
const RETRY_DELAY_MS = 400;
var FetchJsonError = class extends Error {
	/**
	* @param code - 失败分类。
	* @param message - 给日志与用户看的一句话，不得含查询参数与响应体。
	* @param cause - 原始异常，便于排查。
	*/
	constructor(code, message, cause) {
		super(message, { cause });
		this.name = "FetchJsonError";
		this.code = code;
	}
};
async function fetchJson(url, options) {
	const fetchImpl = options.fetchImpl ?? fetch;
	const sleep = options.sleep ?? delayOf;
	const timeoutMs = options.timeoutMs ?? TIMEOUT_MS$2;
	let last;
	for (let attempt = 0; attempt <= RETRIES; attempt++) try {
		return await fetchOnce(fetchImpl, url, timeoutMs, options.label);
	} catch (e) {
		last = e instanceof FetchJsonError ? e : new FetchJsonError("network", options.label + " 请求失败", e);
		if (last.code !== "timeout" && last.code !== "network" || attempt === RETRIES) break;
		await sleep(RETRY_DELAY_MS);
	}
	throw last ?? new FetchJsonError("network", options.label + " 请求失败");
}
/** 单次抓取：区分超时、状态码、JSON 语法与传输错误。 */
async function fetchOnce(fetchImpl, url, timeoutMs, label) {
	const signal = AbortSignal.timeout(timeoutMs);
	let response;
	try {
		response = await fetchImpl(url, {
			signal,
			headers: { "user-agent": "dsh-pet" }
		});
	} catch (e) {
		const timedOut = signal.aborted || e instanceof Error && e.name === "TimeoutError";
		throw new FetchJsonError(timedOut ? "timeout" : "network", label + (timedOut ? " 请求超时" : " 请求失败"), e);
	}
	if (!response.ok) throw new FetchJsonError("http-status", label + " 返回 HTTP " + response.status);
	try {
		return await response.json();
	} catch (e) {
		if (signal.aborted || e instanceof Error && e.name === "TimeoutError") throw new FetchJsonError("timeout", label + " 请求超时", e);
		if (e instanceof SyntaxError) throw new FetchJsonError("bad-json", label + " 返回的不是 JSON", e);
		throw new FetchJsonError("network", label + " 响应读取失败", e);
	}
}
/** 缺省等待实现。 */
function delayOf(ms) {
	return new Promise((resolve$1) => setTimeout(resolve$1, ms));
}

//#endregion
//#region src/host/ip-city.ts
/** 缓存有效期（ms）：IP 与城市的对应关系变得很慢。 */
const CACHE_TTL_MS$1 = 6 * 60 * 60 * 1e3;
/** 首选端点：免费、免 key、中文地名；代价是只能走明文 HTTP。 */
const IP_API_URL = "http://ip-api.com/json/?lang=zh-CN&fields=status,city,regionName,country";
/** 兜底端点：HTTPS、免 key，城市为英文。 */
const IP_WHO_URL = "https://ipwho.is/";
/** 最近一次成功结果；进程内单条，键就是“这台机器当前出口”。 */
let cached$3 = null;
/** 进行中的请求；并发调用共享它，避免同时打两个端点。 */
let inFlight$1 = null;
async function locateCity(deps = {}) {
	const now = deps.now ?? Date.now;
	if (deps.force !== true && cached$3 !== null && now() - cached$3.at < CACHE_TTL_MS$1) return cached$3.value;
	if (inFlight$1 !== null) return inFlight$1;
	const pending = locateFresh(deps).finally(() => {
		inFlight$1 = null;
	});
	inFlight$1 = pending;
	return pending;
}
/** 依次问两个端点，任一成功即写缓存。 */
async function locateFresh(deps) {
	const now = deps.now ?? Date.now;
	const value = await askIpApi(deps) ?? await askIpWho(deps);
	if (value !== null) cached$3 = {
		value,
		at: now()
	};
	return value;
}
/** ip-api.com：`status` 不是 success 视作没查到。 */
async function askIpApi(deps) {
	try {
		const body = recordOf$2(await fetchJson(IP_API_URL, {
			label: "ip-api",
			fetchImpl: deps.fetchImpl,
			sleep: deps.sleep
		}));
		if (body === void 0 || body.status !== "success") return null;
		const city = textOf$2(body.city);
		if (city === void 0) return null;
		return {
			city,
			region: textOf$2(body.regionName) ?? "",
			country: textOf$2(body.country) ?? ""
		};
	} catch {
		return null;
	}
}
/** ipwho.is：`success` 不为 true 或没有城市时视作没查到。 */
async function askIpWho(deps) {
	try {
		const body = recordOf$2(await fetchJson(IP_WHO_URL, {
			label: "ipwho.is",
			fetchImpl: deps.fetchImpl,
			sleep: deps.sleep
		}));
		if (body === void 0 || body.success !== true) return null;
		const city = textOf$2(body.city);
		if (city === void 0) return null;
		return {
			city,
			region: textOf$2(body.region) ?? "",
			country: textOf$2(body.country) ?? ""
		};
	} catch {
		return null;
	}
}
/** 取普通对象；数组、null 与其它类型返回 undefined。 */
function recordOf$2(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? value : void 0;
}
/** 取非空字符串；其它类型或空串返回 undefined。 */
function textOf$2(value) {
	return typeof value === "string" && value.trim() !== "" ? value : void 0;
}

//#endregion
//#region src/host/uapi.ts
/** 端点：不带 city 时上游按客户端 IP 自动定位（实测比 ip-api 准，教育网 IP 能落到南昌）。 */
const UAPI_URL = "https://uapis.cn/api/v1/misc/weather?extended=true";
/** 结果缓存有效期（ms）：上游是站点数据、5~10 分钟一刷，且对话是高频路径，1 小时太旧。 */
const CACHE_TTL_MS = 10 * 60 * 1e3;
/** 蒲福风级 0–12 级的风速区间中值（km/h）；表外的级别按 12 级兜底。 */
const WIND_KPH_BY_LEVEL = [
	.5,
	3,
	8.5,
	15.5,
	24.5,
	34.5,
	44.5,
	55.5,
	68,
	81,
	94,
	108,
	118
];
/**
* UAPI 图标码 → 既有 WMO 码；前端那 27 个图标按 WMO 画，所以换算在宿主完成。
*
* 上游沿用和风那套 100–999 的编号；同义码合并到同一档（小雨与毛毛雨都按 WMO 61），
* 表外的码回落到 3（阴），不让一个没见过的码把图标画空。
*/
const WMO_BY_UAPI_ICON = new Map([
	[100, 0],
	[150, 0],
	[101, 1],
	[102, 1],
	[103, 2],
	[104, 3],
	[300, 80],
	[301, 81],
	[302, 95],
	[303, 95],
	[304, 96],
	[305, 61],
	[309, 61],
	[306, 63],
	[314, 63],
	[307, 65],
	[308, 65],
	[310, 65],
	[311, 65],
	[312, 65],
	[315, 65],
	[316, 65],
	[317, 65],
	[318, 65],
	[399, 61],
	[313, 66],
	[400, 71],
	[408, 71],
	[499, 71],
	[404, 71],
	[405, 71],
	[406, 71],
	[401, 73],
	[409, 73],
	[402, 75],
	[403, 75],
	[410, 75],
	[407, 85],
	[500, 45],
	[501, 45],
	[509, 45],
	[514, 45],
	[515, 45],
	[502, 45],
	[511, 45],
	[512, 45],
	[513, 45],
	[503, 45],
	[504, 45],
	[507, 45],
	[508, 45]
]);
/** 最近一次成功结果（只有「自动定位」这一种键，进程内单条）。 */
let cached$2 = null;
/** 进行中的请求；并发调用共享它，避免同时打两次上游。 */
let inFlight = null;
function resetUapiCache() {
	cached$2 = null;
	inFlight = null;
}
async function fetchUapiWeather(deps = {}) {
	const now = deps.now ?? Date.now;
	if (deps.force !== true && cached$2 !== null && now() - cached$2.at < CACHE_TTL_MS) return cached$2.value;
	if (inFlight !== null) return inFlight;
	const pending = requestUapi(deps).then((value) => {
		if (value !== null) cached$2 = {
			value,
			at: now()
		};
		return value;
	}).finally(() => {
		inFlight = null;
	});
	inFlight = pending;
	return pending;
}
/** 真正打一次上游；任何异常都折成 null。 */
async function requestUapi(deps) {
	const city = (deps.city ?? "").trim();
	const url = city === "" ? UAPI_URL : UAPI_URL + "&city=" + encodeURIComponent(city);
	let body;
	try {
		body = recordOf$1(await fetchJson(url, {
			label: "uapis.cn",
			fetchImpl: deps.fetchImpl,
			sleep: deps.sleep
		}));
	} catch {
		return null;
	}
	return body === void 0 ? null : toEnvironment(body, (deps.now ?? Date.now)());
}
/**
* 上游报文 → 城市与快照。
*
* 必填字段（城市、天气文本、温度、湿度）缺一个就整份判失败——宁可回落，也不给前端半个天气。
* 体感缺失时按气温兜底（上游不传 extended 时才可能缺，这里始终带 expanded）。
*
* @param body - 上游 JSON 对象。
* @param nowMs - 换算相对更新时间用的当前时刻。
* @returns 归一后的结果；字段不全时 null。
*/
function toEnvironment(body, nowMs) {
	const city = textOf$1(body.city);
	const summary = textOf$1(body.weather);
	const temperatureC = numOf(body.temperature);
	const humidityPercent = numOf(body.humidity);
	if (city === void 0 || summary === void 0 || temperatureC === void 0 || humidityPercent === void 0) return null;
	const apparentC = numOf(body.feels_like) ?? temperatureC;
	return {
		region: textOf$1(body.province) ?? "",
		city,
		weather: {
			city,
			summary,
			temperatureC,
			apparentC,
			humidityPercent,
			windKph: windKphOf(textOf$1(body.wind_power)),
			code: wmoOf(numOf(body.weather_icon)),
			observedAt: observedAtOf(body.report_time, nowMs)
		}
	};
}
/** 风级文本（「2级」/「Level 3」）→ 风速（km/h 区间中值）；认不出时 0。 */
function windKphOf(text) {
	const level = text === void 0 ? void 0 : /(\d+)/.exec(text);
	if (level === void 0 || level === null) return 0;
	const index = Math.min(Number(level[1]), WIND_KPH_BY_LEVEL.length - 1);
	return WIND_KPH_BY_LEVEL[index] ?? 0;
}
/** 图标码 → WMO 码；表外一律按「阴」。 */
function wmoOf(icon) {
	if (icon === void 0) return 3;
	return WMO_BY_UAPI_ICON.get(icon) ?? 3;
}
/**
* 更新时间 → `HH:mm`。
*
* 上游两种写法：国内是「7 分钟前发布」，国外是「2026-11-13 15:00」；前者按当前时刻倒推，
* 认不出时用当前时刻——气泡脚注只用来表示「这是什么时候的数据」，不让它空着。
*/
function observedAtOf(raw, nowMs) {
	const text = typeof raw === "string" ? raw : "";
	const absolute = /(\d{1,2}):(\d{2})/.exec(text);
	if (absolute !== null) return pad2$1(Number(absolute[1])) + ":" + absolute[2];
	const relative = /(\d+)\s*分钟前/.exec(text);
	const at = relative === null ? nowMs : nowMs - Number(relative[1]) * 60 * 1e3;
	const date = new Date(at);
	return pad2$1(date.getHours()) + ":" + pad2$1(date.getMinutes());
}
/** 两位补零。 */
function pad2$1(value) {
	return String(value).padStart(2, "0");
}
/** 取普通对象；数组、null 与其它类型返回 undefined。 */
function recordOf$1(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? value : void 0;
}
/** 取非空字符串。 */
function textOf$1(value) {
	return typeof value === "string" && value.trim() !== "" ? value : void 0;
}
/** 取有限数值；字符串数字也接受（上游偶尔把温度写成字符串）。 */
function numOf(value) {
	if (typeof value !== "number" && typeof value !== "string") return void 0;
	if (typeof value === "string" && value.trim() === "") return void 0;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : void 0;
}

//#endregion
//#region src/host/wmo-code.ts
/** WMO 天气码 → 中文短语；表里没有的码返回“未知天气”，不猜。 */
/** 码 → 中文；只收 Open-Meteo 的 current / daily 会用到的那些码。 */
const TEXT_BY_CODE = {
	0: "晴",
	1: "晴间多云",
	2: "多云",
	3: "阴",
	45: "雾",
	48: "雾凇",
	51: "小毛毛雨",
	53: "毛毛雨",
	55: "大毛毛雨",
	56: "冻毛毛雨",
	57: "强冻毛毛雨",
	61: "小雨",
	63: "中雨",
	65: "大雨",
	66: "冻雨",
	67: "强冻雨",
	71: "小雪",
	73: "中雪",
	75: "大雪",
	77: "雪粒",
	80: "小阵雨",
	81: "阵雨",
	82: "强阵雨",
	85: "小阵雪",
	86: "强阵雪",
	95: "雷阵雨",
	96: "雷阵雨伴冰雹",
	99: "强雷阵雨伴冰雹"
};
function wmoText(code) {
	return TEXT_BY_CODE[code] ?? "未知天气";
}

//#endregion
//#region src/host/weather.ts
/** 坐标缓存有效期（ms）：城市不会搬家。 */
const GEO_TTL_MS = 7 * 24 * 60 * 60 * 1e3;
/** 天气缓存有效期（ms）：1 小时——闲聊里不必拿"实时"换每次请求。 */
const WEATHER_TTL_MS = 60 * 60 * 1e3;
/** 坐标缓存条目上限：对话里出现的城市数有限，32 条足够。 */
const GEO_CACHE_MAX = 32;
/** 地名搜索：只取第一条，中文名优先。 */
const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search?count=1&language=zh&format=json&name=";
/** 当前天气端点。 */
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
/** 需要的 current 字段。 */
const CURRENT_FIELDS = "temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code";
/** 城市名 → 地点，带写入时刻。 */
const geoCache = new Map();
/** 最近一次天气结果；键是坐标，坐标变了就重查。 */
let weatherCache = null;
async function queryWeather(city, deps = {}) {
	const name = city.trim();
	if (name === "") return null;
	const place = await geocode(name, deps);
	if (place === null) return null;
	const key = place.latitude.toFixed(4) + "," + place.longitude.toFixed(4);
	const now = deps.now ?? Date.now;
	if (deps.force !== true && weatherCache !== null && weatherCache.key === key && now() - weatherCache.at < WEATHER_TTL_MS) return weatherCache.value;
	const snapshot = await fetchCurrent(place, deps);
	if (snapshot !== null) weatherCache = {
		key,
		value: snapshot,
		at: now()
	};
	return snapshot;
}
/** 城市名 → 坐标；命中缓存时不再发请求；原名查不到时换另一种形态再试一次。 */
async function geocode(city, deps) {
	const now = deps.now ?? Date.now;
	const hit = geoCache.get(city);
	if (deps.force !== true && hit !== void 0 && now() - hit.at < GEO_TTL_MS) return hit.place;
	const alternate = alternateCityName(city);
	const place = await searchPlace(city, deps) ?? (alternate === null ? null : await searchPlace(alternate, deps));
	if (place === null) return null;
	rememberPlace(city, place, now());
	return place;
}
/**
* 同一个城市的另一种写法：带「市 / 县 / 区 / 旗」后缀的去掉后缀，不带后缀的补「市」。
*
* @param city - 已 trim 的城市名。
* @returns 另一种写法；去掉后缀后不足两个字时返回 null（免得把「沙市」削成「沙」再查一次）。
*/
function alternateCityName(city) {
	const bare = city.replace(/[市县区旗]$/u, "");
	if (bare !== city) return bare.length >= 2 ? bare : null;
	return city + "市";
}
/** 一次地名搜索：取第一条结果的坐标与中文名。 */
async function searchPlace(name, deps) {
	let body;
	try {
		body = recordOf(await fetchJson(GEOCODE_URL + encodeURIComponent(name), {
			label: "open-meteo-geocoding",
			fetchImpl: deps.fetchImpl,
			sleep: deps.sleep
		}));
	} catch {
		return null;
	}
	const results = body?.results;
	if (!Array.isArray(results) || results.length === 0) return null;
	const first = recordOf(results[0]);
	const latitude = numberOrUndefined(first?.latitude);
	const longitude = numberOrUndefined(first?.longitude);
	if (latitude === void 0 || longitude === void 0) return null;
	return {
		name: textOf(first?.name) ?? name,
		latitude,
		longitude
	};
}
/** 拉当前天气；任一必备字段缺失或非数值都算查询失败。 */
async function fetchCurrent(place, deps) {
	const url = FORECAST_URL + "?latitude=" + place.latitude + "&longitude=" + place.longitude + "&current=" + CURRENT_FIELDS + "&timezone=auto";
	let body;
	try {
		body = recordOf(await fetchJson(url, {
			label: "open-meteo-forecast",
			fetchImpl: deps.fetchImpl,
			sleep: deps.sleep
		}));
	} catch {
		return null;
	}
	const current$1 = recordOf(body?.current);
	if (current$1 === void 0) return null;
	const temperatureC = numberOrUndefined(current$1.temperature_2m);
	const apparentC = numberOrUndefined(current$1.apparent_temperature);
	const humidityPercent = numberOrUndefined(current$1.relative_humidity_2m);
	const windKph = numberOrUndefined(current$1.wind_speed_10m);
	const code = numberOrUndefined(current$1.weather_code);
	const observedAt = textOf(current$1.time);
	if (temperatureC === void 0 || apparentC === void 0 || humidityPercent === void 0 || windKph === void 0 || code === void 0 || observedAt === void 0) return null;
	return {
		city: place.name,
		temperatureC,
		apparentC,
		humidityPercent,
		windKph,
		code,
		summary: wmoText(code),
		observedAt
	};
}
/** 写坐标缓存；超过上限时先丢最旧的一条。 */
function rememberPlace(city, place, at) {
	if (geoCache.size >= GEO_CACHE_MAX && !geoCache.has(city)) {
		let oldestKey;
		let oldestAt = Number.POSITIVE_INFINITY;
		for (const [key, entry] of geoCache) if (entry.at < oldestAt) {
			oldestAt = entry.at;
			oldestKey = key;
		}
		if (oldestKey !== void 0) geoCache.delete(oldestKey);
	}
	geoCache.set(city, {
		place,
		at
	});
}
/** 取普通对象；数组、null 与其它类型返回 undefined。 */
function recordOf(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? value : void 0;
}
/** 取非空字符串；其它类型或空串返回 undefined。 */
function textOf(value) {
	return typeof value === "string" && value.trim() !== "" ? value : void 0;
}
/** 取有限数值；字符串也接受（上游偶尔把数字写成字符串）。 */
function numberOrUndefined(value) {
	if (typeof value !== "number" && typeof value !== "string") return void 0;
	if (typeof value === "string" && value.trim() === "") return void 0;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : void 0;
}

//#endregion
//#region src/host/environment.ts
/** 配置里的天气城市读取口；宿主启动时注入一次，两条取数路径因此自动一致。 */
let cityProvider = () => void 0;
function setCityProvider(provider) {
	cityProvider = provider;
}
async function currentEnvironment(deps = {}) {
	const city = (deps.city ?? cityProvider() ?? "").trim();
	try {
		const uapi = await fetchUapiWeather(city === "" ? deps : {
			...deps,
			city
		});
		if (uapi !== null) return {
			...uapi.region === "" ? {} : { region: uapi.region },
			city: uapi.city,
			weather: uapi.weather
		};
		if (city !== "") {
			const weather$1 = await queryWeather(city, deps);
			return weather$1 === null ? { city } : {
				city: weather$1.city,
				weather: weather$1
			};
		}
		const located = await locateCity(deps);
		if (located === null) return {};
		const weather = await queryWeather(located.city, deps);
		return {
			...located.region === "" ? {} : { region: located.region },
			city: located.city,
			...weather === null ? {} : { weather }
		};
	} catch {
		return {};
	}
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
//#region src/host/pet-avatar.ts
/** 探测顺序：正常情况下同一素材根只有一个头像文件，顺序只影响同时存在多份时的遍历次序。 */
const AVATAR_EXTS = [
	".png",
	".jpg",
	".jpeg",
	".webp",
	".gif"
];
function petAvatarFile(avatarDir, petId) {
	let best;
	let bestMtime = -Infinity;
	for (const ext of AVATAR_EXTS) {
		const file = resolveAsset(avatarDir, petId + "-avatar" + ext);
		if (file === void 0 || !existsSync(file)) continue;
		let mtime;
		try {
			mtime = statSync(file).mtimeMs;
		} catch {
			continue;
		}
		if (mtime > bestMtime) {
			bestMtime = mtime;
			best = {
				file,
				contentType: MIME[ext] ?? "application/octet-stream"
			};
		}
	}
	return best;
}
function savePetAvatar(avatarDir, petId, bytes) {
	const contentType = imageTypeOf(bytes, Math.min(bytes.length, IMAGE_HEAD_BYTES));
	const ext = contentType === void 0 ? void 0 : imageExtOf(contentType);
	if (ext === void 0) return {
		ok: false,
		reason: "not-image"
	};
	const file = resolveAsset(avatarDir, petId + "-avatar" + ext);
	if (file === void 0) return {
		ok: false,
		reason: "write-failed"
	};
	for (const other of AVATAR_EXTS) {
		if (other === ext) continue;
		const stale = resolveAsset(avatarDir, petId + "-avatar" + other);
		if (stale === void 0) continue;
		try {
			unlinkSync(stale);
		} catch {}
	}
	try {
		writeFileSync(file, bytes);
	} catch {
		return {
			ok: false,
			reason: "write-failed"
		};
	}
	return { ok: true };
}

//#endregion
//#region src/host/routes/assets.ts
async function handleAssetsRoutes(deps, input) {
	const { assetRootFor, memeDirsFor, petConfigDir, userRoot, userRootFor } = deps;
	const { rest, url } = input;
	const [scope, ...restParts] = rest.split("/");
	if (scope === "logo") {
		if (restParts.length > 0) return {
			kind: "text",
			status: 400,
			body: "dsh-pet: expected /dsh-pet-7340/logo"
		};
		const assetRoot = (url.searchParams.get("root") ?? "").trim();
		if (assetRoot !== "" && assetRoot !== "main") {
			if (!isValidPetId(assetRoot)) return {
				kind: "text",
				status: 400,
				body: "dsh-pet: invalid asset root"
			};
			const own$1 = petAvatarFile(petConfigDir, assetRoot);
			if (own$1 !== void 0) return {
				kind: "file",
				file: own$1.file,
				contentType: own$1.contentType
			};
		}
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
		const picRel = restParts.join("/");
		const picFile = resolveExisting(join(userRoot, "pic"), picRel) ?? resolveExisting(join(PACKAGE_ROOT, "assets", "pic"), picRel);
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
			const head = Buffer.alloc(IMAGE_HEAD_BYTES);
			return imageTypeOf(head, readSync(fd, head, 0, IMAGE_HEAD_BYTES, 0));
		} finally {
			closeSync(fd);
		}
	} catch {
		return void 0;
	}
}

//#endregion
//#region src/host/routes/avatar.ts
/** 解码后的字节上限：按头像尺寸独立定，与请求体上限无关。 */
const MAX_AVATAR_BYTES = 768 * 1024;
async function handleAvatarRoutes(deps, input) {
	if (input.rest === "pet-avatar") return acceptUpload(deps, input);
	return void 0;
}
/**
* 受理一次上传。
*
* @param deps - 路由层依赖（只用到文件宠物目录）。
* @param input - 已解析的请求（方法、URL、请求体）。
* @returns 成功，或按原因分档的业务/协议失败。
*/
async function acceptUpload(deps, input) {
	if (input.method !== "POST") return methodNotAllowed();
	const assetRoot = (input.url.searchParams.get("root") ?? "").trim();
	if (assetRoot === "") return failResult("bad-request", "缺少 root 参数（素材根）");
	if (!isValidPetId(assetRoot)) return failResult("bad-request", "素材根不合法");
	if (assetRoot === "main") return failResult("bad-request", "内置条目不能换头像：main 不写入 pet/ 目录");
	let raw;
	try {
		raw = JSON.parse(input.body ?? "");
	} catch {
		return invalidJson();
	}
	const base64 = typeof raw === "object" && raw !== null ? raw.base64 : void 0;
	if (typeof base64 !== "string" || base64 === "") return failResult("bad-request", "base64 必须是非空字符串");
	const bytes = Buffer.from(base64, "base64");
	if (bytes.length === 0 || bytes.toString("base64") !== base64) return failResult("bad-request", "base64 不合法");
	if (bytes.length > MAX_AVATAR_BYTES) return payloadTooLarge("头像超过 768 KiB");
	const saved = savePetAvatar(deps.petConfigDir, assetRoot, bytes);
	if (!saved.ok) return saved.reason === "not-image" ? failResult("unsupported", "只支持 PNG / JPEG / WebP / GIF") : failResult("internal-error", "头像写入失败");
	return okResult({ ok: true });
}

//#endregion
//#region src/host/routes/balance.ts
async function handleBalanceRoutes(deps, input) {
	const { configPaths, lockBlocked, refreshBalance, requirePet, surfaceBlocked } = deps;
	const { method, rest, url } = input;
	if (rest !== "balance") return void 0;
	if (method !== "POST") return methodNotAllowed();
	const requested = String(url.searchParams.get("pet") ?? "").trim();
	if (requested === "") {
		await refreshBalance(true);
		return okResult({ ok: true });
	}
	try {
		const cfg = readAllConfig(configPaths);
		const who = requirePet(url.searchParams, () => cfg, { surface: true });
		if (!who.ok) return who.res;
		const noSurface = surfaceBlocked(cfg, who.petId, url.searchParams);
		if (noSurface) return noSurface;
		const blocked = lockBlocked(who.petId, url.searchParams);
		if (blocked) return blocked;
		await refreshBalance(true, who.petId);
		return okResult({ ok: true });
	} catch (e) {
		return failResult("generate-error", e instanceof Error ? e.message : String(e));
	}
}

//#endregion
//#region src/host/routes/character.ts
/** 包内 assets 根：角色图按 `<素材根>-character.<ext>` 平铺在这里，与 `logo.png` 同层。 */
const PACKAGE_ASSETS_DIR = join(PACKAGE_ROOT, "assets");
/** 探测顺序：正常只有一份，顺序只影响多份并存时取哪一份。 */
const CHARACTER_EXTS = [
	".png",
	".jpg",
	".jpeg",
	".webp",
	".gif"
];
async function handleCharacterRoutes(deps, input) {
	if (input.rest !== "character") return void 0;
	const assetRoot = (input.url.searchParams.get("root") ?? "").trim();
	if (assetRoot === "") return {
		kind: "text",
		status: 400,
		body: "dsh-pet: expected /dsh-pet-7340/character?root=<素材根>"
	};
	if (!isValidPetId(assetRoot)) return {
		kind: "text",
		status: 400,
		body: "dsh-pet: invalid asset root"
	};
	const found = findCharacter(deps.petConfigDir, assetRoot);
	if (found === void 0) return {
		kind: "text",
		status: 404,
		body: "dsh-pet: character not found"
	};
	return {
		kind: "file",
		file: found.file,
		contentType: found.contentType
	};
}
/**
* 按素材根找角色图：`pet/` 优先，包内兜底。
*
* 扩展名只走白名单，不按目录扫描：用户目录里可能有别的文件，扫描会把无关文件当成角色图。
* @param petDir - `pet/` 目录（pet pack 素材根所在处）。
* @param assetRoot - 已校验的素材根。
* @returns 命中的文件；都没有时 undefined。
*/
function findCharacter(petDir, assetRoot) {
	const name = assetRoot + "-character";
	for (const dir of [petDir, PACKAGE_ASSETS_DIR]) for (const ext of CHARACTER_EXTS) {
		const hit = resolveExisting(dir, name + ext);
		if (hit !== void 0) return {
			file: hit,
			contentType: MIME[ext] ?? "application/octet-stream"
		};
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
/** base64 字符上限：按对话配图本身的需要定，不随请求体上限放大。 */
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
		if (!clean) return failResult("bad-request", "invalid pet config: expected { pets:[{name?,id,size,sizePercent?,balanceEnabled,display,position:{corner,marginX,marginY}}] }（id 为非空字符串且去除首尾空白后唯一；sizePercent 可选，不小于 1 的数字；display 为 web/desktop/both/none 之一；可选顶层 notificationsEnabled / notifyWhenFocused / whisperImageEnabled / chatImageEnabled / chatAnimationEnabled / trayEnabled 布尔；可选宠物布尔 whisperEnabled / workStatusEnabled / fixedEnabled）");
		if (input.url.searchParams.get("force") !== "1" && userConfigUnparsable(configPaths)) return failResult("user-config-unparsable", "用户配置无法解析，需确认后重建", {
			needConfirm: true,
			userFile: userConfigPath
		});
		await mkdir(userRoot, { recursive: true });
		await writeFile(userConfigPath, JSON.stringify(clean, null, 2), "utf8");
		resetUapiCache();
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
//#region src/host/routes/environment.ts
async function handleEnvironmentRoutes(deps, input) {
	const { configPaths, environment, lockBlocked, requirePet, state, surfaceBlocked } = deps;
	const { method, rest, url } = input;
	if (rest !== "environment") return void 0;
	if (method !== "POST") return methodNotAllowed();
	const requested = String(url.searchParams.get("pet") ?? "").trim();
	let petId;
	if (requested !== "") try {
		const cfg = readAllConfig(configPaths);
		const who = requirePet(url.searchParams, () => cfg, { surface: true });
		if (!who.ok) return who.res;
		petId = who.petId;
		const noSurface = surfaceBlocked(cfg, petId, url.searchParams);
		if (noSurface) return noSurface;
		const blocked = lockBlocked(petId, url.searchParams);
		if (blocked) return blocked;
	} catch (e) {
		return failResult("generate-error", e instanceof Error ? e.message : String(e));
	}
	const fresh = url.searchParams.get("fresh") === "1";
	const byIp = url.searchParams.get("ip") === "1";
	const facts = await environment({
		fresh,
		...byIp ? { city: "" } : {}
	});
	const body = { ok: true };
	if (facts.region !== void 0) body.region = facts.region;
	if (facts.city !== void 0) body.city = facts.city;
	if (facts.weather !== void 0) body.weather = facts.weather;
	if (petId === void 0) return okResult(body);
	state.writeSection("env", {
		...facts.region !== void 0 ? { region: facts.region } : {},
		...facts.city !== void 0 ? { city: facts.city } : {},
		...facts.weather !== void 0 ? { weather: facts.weather } : {},
		petId,
		ts: Date.now()
	});
	deps.log.info(`[dsh-pet] 环境查询 pet=${petId}${fresh ? "（强制刷新）" : ""}`);
	return okResult({
		...body,
		petId
	});
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
	push(strings$1(a.baifan));
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
function normalizeBroadcastVoice(speak) {
	return speak === true;
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
		const speak = normalizeBroadcastVoice(o.speak);
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
				...speak && voiceTo ? { voiceTo } : {}
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
//#region src/host/routes/session.ts
/** 会话 id 上限：DSH 的 id 形如 `session-<uuid>`（44 字符），128 已足够，更长的视为伪造输入。 */
const MAX_SESSION_ID_CHARS = 128;
/** 宿主在「还没有会话」时写进快照的哨兵值，不能当作跳转目标。 */
const UNKNOWN_SESSION_ID = "unknown";
async function handleSessionRoutes(deps, input) {
	const isFocusSession = input.rest === "focus-session";
	if (!isFocusSession) return void 0;
	if (input.method !== "POST") return methodNotAllowed();
	let payload;
	try {
		payload = JSON.parse(input.body ?? "");
	} catch {
		return invalidJson();
	}
	const sessionId = typeof payload?.sessionId === "string" ? payload.sessionId.trim() : "";
	if (sessionId === "" || sessionId === UNKNOWN_SESSION_ID) return failResult("bad-request", "sessionId 必填");
	if (sessionId.length > MAX_SESSION_ID_CHARS) return failResult("bad-request", `sessionId 超过 ${MAX_SESSION_ID_CHARS} 字符`);
	const ts = Date.now();
	deps.state.writeSection("focusSession", {
		sessionId,
		ts
	});
	return okResult({
		ok: true,
		sessionId,
		ts
	});
}

//#endregion
//#region src/host/plugin/soft-ctx.ts
function serviceOf(ctx, name) {
	if (!ctx) return void 0;
	const get = ctx.get;
	if (typeof get === "function") try {
		const value$1 = get.call(ctx, name, false);
		return value$1 ?? void 0;
	} catch {
		return void 0;
	}
	const value = ctx[name];
	return value ?? void 0;
}
function softCtx(ctx) {
	return new Proxy(ctx, { get(target, prop, receiver) {
		try {
			return Reflect.get(target, prop, receiver);
		} catch {
			return void 0;
		}
	} });
}
function whenService(ctx, name, onReady, options = {}) {
	const timeoutMs = options.timeoutMs ?? 2e4;
	const intervalMs = options.intervalMs ?? 250;
	const startedAt = Date.now();
	let done = false;
	const timer = setInterval(() => {
		if (done) return;
		const service = serviceOf(ctx, name);
		if (service !== void 0) {
			done = true;
			clearInterval(timer);
			onReady(service);
			return;
		}
		if (Date.now() - startedAt >= timeoutMs) {
			done = true;
			clearInterval(timer);
			options.onTimeout?.();
		}
	}, intervalMs);
	timer.unref?.();
	return () => {
		if (done) return;
		done = true;
		clearInterval(timer);
	};
}

//#endregion
//#region src/host/routes/state.ts
async function handleStateRoutes(deps, input) {
	const { EXTERNAL_WORK_SESSION, ctx, nextExternalWorkSeq, publishWorkStatus, state, workStatus } = deps;
	const { body, method, rest, signal, url } = input;
	if (rest === "models") {
		if (method !== "GET") return methodNotAllowed();
		try {
			const llm = serviceOf(ctx, "llm");
			const named = (id, name) => {
				const pid = String(id ?? "");
				return {
					id: pid,
					name: String(name ?? "") || pid
				};
			};
			let providers$2 = (typeof llm?.listProviders === "function" ? llm.listProviders() : []).map((p) => named(p?.id, p?.name));
			if (providers$2.length === 0 && typeof llm?.listConfigurableProviders === "function") providers$2 = llm.listConfigurableProviders().map((p) => named(p?.provider, p?.displayName));
			providers$2 = providers$2.filter((p) => p.id);
			const catalog = await Promise.all(providers$2.map(async (p) => {
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
		const current$1 = state.read();
		if (parsed.kind === "none" || current$1.counter !== parsed.since) return okResult(current$1, headers);
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
			...deps.voice.list()
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
			contentType: result.contentType
		};
	}
	if (rest === "voice/hear-providers") {
		if (method !== "GET") return methodNotAllowed();
		return okResult({
			ok: true,
			...deps.speech.list()
		});
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
	handleSessionRoutes,
	handleBalanceRoutes,
	handleEnvironmentRoutes,
	handleInteractionRoutes,
	handleMotionRoutes,
	handlePlaybackRoutes,
	handleSleepRoutes,
	handleChatRoutes,
	handleAttachmentRoutes,
	handleTodoRoutes,
	handleVoiceRoutes,
	handleAvatarRoutes,
	handleCharacterRoutes,
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
	return rest === "anim" || rest === "whisper" || rest === "balance" || rest === "environment" || rest === "broadcast" || rest === "bubble/clear" || rest === "menu/click" || rest === "voice";
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
	const register = (webServer) => {
		ctx.effect(() => webServer.register({
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
	};
	const current$1 = serviceOf(ctx, "webServer");
	if (current$1 !== void 0) {
		register(current$1);
		return;
	}
	ctx.effect(() => whenService(ctx, "webServer", (service) => register(service), {
		timeoutMs: 2e4,
		onTimeout: () => {
			ctx.logger?.warn?.("[dsh-pet] 宿主 webServer 服务迟迟未就绪，本插件的 HTTP 路由未注册（不影响 DSH 启动）");
		}
	}), "dsh-pet: wait for webServer");
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
//#region src/host/plugin/host-command.ts
function registerCommand(ctx, spec, label) {
	ctx.effect(() => {
		const commands = serviceOf(ctx, "commands");
		if (commands === void 0) {
			ctx.logger?.warn?.(`[dsh-pet] 宿主 commands 服务不可用，${spec.name} 命令未注册（不影响其它功能）`);
			return () => {};
		}
		return commands.register(spec);
	}, label);
}

//#endregion
//#region src/host/plugin/command-chat.ts
function registerChatCommand(deps) {
	const { ctx, chatWithPet, log, publishWhisper, resolveActivePetId, sleep, sleepRefusalText } = deps;
	registerCommand(ctx, {
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
	}, "dsh-pet: /chat command");
}

//#endregion
//#region src/host/plugin/command-pet.ts
function registerPetCommand(deps) {
	const { ctx, effectivePetList, petDisplayName, resolveActivePetId, setActivePetId } = deps;
	registerCommand(ctx, {
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
	}, "dsh-pet: /pet command");
}

//#endregion
//#region src/host/whisper-policy.ts
function automaticWhisperSchedule(policy, petEnabled, configuredPeriodSec) {
	if (!policy) return {
		enabled: petEnabled,
		periodSec: configuredPeriodSec
	};
	return {
		enabled: petEnabled && policy.isReady(),
		periodSec: configuredPeriodSec
	};
}

//#endregion
//#region src/host/plugin/period.ts
/**
* 事件周期（秒）的解析：把配置里的原始值收窄成能安全交给 setTimeout 的秒数。
*
* 不读配置、不排定时器：兜底值由调用方各自决定（余额 1800、碎碎念 300、梦话 60）。
* 上限来自 setTimeout 的延时上限 2^31-1 ms——超过它的延时会被 Node 当成 1 ms，
* 于是「周期设得太大」反而变成每秒一次，比不设还糟。
* @module dsh-pet/src/host/plugin/period
*/
/** setTimeout 能接受的最大延时（ms）。 */
const MAX_TIMEOUT_MS = 2147483647;
const MAX_PERIOD_SEC = Math.floor(MAX_TIMEOUT_MS / 1e3);
function clampPeriodSec(raw, fallbackSec) {
	const sec = Number(raw);
	if (!Number.isFinite(sec) || sec <= 0) return fallbackSec;
	return Math.min(sec, MAX_PERIOD_SEC);
}

//#endregion
//#region src/host/plugin/loops.ts
/** 梦话周期的兜底值（秒）：配置里 eventsRefreshSec.sleepTalk 缺失/非法时用它。 */
const SLEEP_TALK_DEFAULT_SEC = 60;
/** 错峰队列里相邻两只之间的间隔（ms）：同拍到点的宠物依次开口，才会错开冒泡与语音。 */
const WHISPER_STAGGER_MS = 1e4;
/** 错峰队列上限：6 只 × 10s = 60s，正好覆盖最短周期，队列不会追着拍跑。 */
const WHISPER_QUEUE_MAX = 6;
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
		/** 待发布的宠物（FIFO）；一次只发一只，两只之间隔 {@link WHISPER_STAGGER_MS}。 */
		const pending = [];
		/** 队列内相邻两只之间的等待句柄；与拍定时器分开计，两者都要在卸载时清掉。 */
		let drainTimer = null;
		/** 是否已经有一只正在生成；同一时刻只允许一只，否则两只仍会同时写出气泡。 */
		let pumping = false;
		/**
		* 从队列取下一只发布，等它写完再隔一个间隔发下一只。
		*
		* 间隔从「文字真的写进状态」算起，而不是从发起点算：单次生成耗时在 3–15 秒之间波动，
		* 从发起点算的固定间隔会被慢的那只吃掉，两只又撞到一起。
		*/
		async function pump() {
			if (disposed || pumping || drainTimer !== null) return;
			const petId = pending.shift();
			if (petId === void 0) return;
			pumping = true;
			try {
				await publishWhisper(petId, void 0, void 0, "whisper");
			} catch {} finally {
				pumping = false;
			}
			if (disposed || pending.length === 0) return;
			drainTimer = setTimeout(() => {
				drainTimer = null;
				pump();
			}, WHISPER_STAGGER_MS);
		}
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
						skipped.push(petId + ": " + (pet.whisperEnabled === true ? "独立模式 AI 未就绪" : "whisperEnabled=false"));
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
					if (pending.length >= WHISPER_QUEUE_MAX) {
						skipped.push(petId + ": 错峰队列已满");
						continue;
					}
					due += 1;
					lastWhisperAt.set(petId, now);
					log.info(`[dsh-pet] 碎碎念到点 pet=${petId}（周期 ${sec}s），入队待发`);
					pending.push(petId);
				}
				pump();
				if (Number.isFinite(min)) next = min;
				log.info(`[dsh-pet] 碎碎念调度：检查 ${checked} 只 → 到点 ${due}、未到点 ${notDue}、跳过 ${skipped.length}` + (due > 1 ? `；${due} 只按 ${WHISPER_STAGGER_MS / 1e3}s 间隔依次说` : "") + (skipped.length > 0 ? `（${skipped.join("；")}）` : "") + `；下一拍 ${next}s`);
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
			if (drainTimer !== null) clearTimeout(drainTimer);
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
					if (!shouldSleepTalk(found.pet)) continue;
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
function shouldSleepTalk(pet) {
	if (pet.whisperEnabled !== true) return false;
	return isDisplayed(String(pet.display ?? ""));
}
/** 梦话周期（秒）：条目级 eventsRefreshSec.sleepTalk，读不到按 60 兜底（与配置注释同一口径）。 */
function sleepTalkPeriodSec(conf) {
	const table = conf.eventsRefreshSec;
	return clampPeriodSec(table?.sleepTalk, SLEEP_TALK_DEFAULT_SEC);
}

//#endregion
//#region src/host/plugin/command-balance.ts
function registerBalanceCommand(deps) {
	const { ctx, effectivePetList, refreshBalance, sleep, sleepRefusalText } = deps;
	registerCommand(ctx, {
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
	}, "dsh-pet: /balance command");
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
	let current$1 = "";
	let quote = null;
	for (const ch of command) {
		if (quote !== null) {
			if (ch === quote) quote = null;
			else current$1 += ch;
			continue;
		}
		if (ch === "\"" || ch === "'" || ch === "`") {
			quote = ch;
			continue;
		}
		if (/\s/.test(ch) || ch === ";" || ch === "|") {
			if (current$1 !== "") tokens.push(current$1);
			current$1 = "";
			continue;
		}
		current$1 += ch;
	}
	if (current$1 !== "") tokens.push(current$1);
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
//#region src/host/plugin/desktop/site-url.ts
/** 宿主的入口收集事件名；新版 WebServer 以自身为 subject 同步分发。 */
const ENTRY_URL_EVENT = "webserver/entry-url";
function resolveDesktopSiteUrl(ctx, origin) {
	const connection = serviceOf(ctx, "connection");
	if (typeof connection?.authenticatedUrl === "function") return connection.authenticatedUrl(origin);
	const webServer = serviceOf(ctx, "webServer");
	const entries = [];
	try {
		ctx.emit?.(webServer, ENTRY_URL_EVENT, origin, entries);
	} catch {}
	return entries.find((entry) => entry.open)?.url ?? origin;
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
		const webServer = serviceOf(ctx, "webServer");
		const port = typeof webServer?.port === "number" ? webServer.port : 0;
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
			const hostOrigin = webServer?.getOrigin?.();
			if (typeof hostOrigin === "string" && hostOrigin !== "") origin = hostOrigin;
		} catch {}
		const siteUrl = resolveDesktopSiteUrl(ctx, origin);
		const configUrl = `${origin}${ROUTE_SEGMENT}/config`;
		const hostTokenValue = serviceOf(ctx, "hostToken")?.hostToken;
		const hostToken = typeof hostTokenValue === "string" && hostTokenValue !== "" ? hostTokenValue : "";
		helper = new HelperProcess({
			electronPath,
			env: {
				DSH_PET_CONFIG_URL: configUrl,
				DSH_PET_SITE_URL: siteUrl,
				DSH_PET_OPEN_TARGET: resolveOpenTarget(siteUrl, isDesktopHost()),
				DSH_PET_SCALE: "1",
				DSH_PET_BRIDGE: "1",
				DSH_PET_PETS: JSON.stringify(desktopPetList()),
				...hostToken ? { DSH_PET_TOKEN: hostToken } : {}
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
				log.info("[dsh-pet] 无桌面宠物（display 均为 web/none）且本次运行未启用过桌面模式，已跳过桌面 Helper 启动（托盘图标随 Helper 一起不出现：要把桌宠叫回桌面，请在浏览器设置页把它的显示位置改成「仅桌面」或「两者」）");
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
	const { log, logDesktopDecision, desktopPetList, startHelper, stopHelperAndWait } = deps;
	/** 同进程内跑 helper（打包应用）：没有子进程可重启，只能让 helper 自己重建窗口。 */
	const inProcessHost = process.env.DSH_PET_IN_PROCESS === "1";
	let desktopSyncQueue = Promise.resolve();
	const restartDesktop = () => {
		desktopSyncQueue = desktopSyncQueue.then(async () => {
			logDesktopDecision();
			if (inProcessHost) {
				process.env.DSH_PET_PETS = JSON.stringify(desktopPetList());
				await globalThis.__dshPetRebuildUi?.();
				return;
			}
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
	const { ctx, configPaths, getActivePetId, log, state, standaloneAiBalance } = deps;
	/** 当前生效宠物列表：成品配置拍平（合并器已保证 id 唯一、字段填满），命令与桌面模式共用。 */
	const effectivePetList = () => flattenPetList(readAllConfig(configPaths));
	/** 余额刷新周期（秒）：成品 main 条目的 eventsRefreshSec.balance（合并器已填默认；非法兜底 1800） */
	const balancePeriodSec = (cfg) => {
		const ers = cfg.main?.eventsRefreshSec;
		return clampPeriodSec(ers?.balance, 1800);
	};
	/** 碎碎念周期（秒）：该宠物所属条目的 eventsRefreshSec.whisper（合并器已填默认；非法兜底 300）。
	*  收已解析的条目配置：唯一调用方是周期调度，它的 petId 就是从同一份 cfg 拍平出来的。 */
	const whisperPeriodSec = (conf) => {
		const ers = conf.eventsRefreshSec;
		return clampPeriodSec(ers?.whisper, 300);
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
	* @param petId - 这次刷新「给谁看」（右键菜单点的那只）。缺省 = 不写归属，
	*   所有开了余额的宠物都照常显示；周期刷新与 /balance 命令都走这条。
	*/
	const refreshBalance = async (manual = false, petId) => {
		log.info(`[dsh-pet] 余额刷新开始（${manual ? "手动" : "周期"}${petId === void 0 ? "" : " pet=" + petId}）`);
		const mark = (v) => ({
			...v,
			...manual ? { manual: true } : {},
			...petId === void 0 ? {} : { petId }
		});
		try {
			const standalone = standaloneAiBalance();
			const defaultModel = serviceOf(ctx, "agentDefaultModel");
			const provider = standalone?.provider || defaultModel?.currentSelection()?.provider;
			const result = provider ? await queryBalance(
				provider,
				async (ref) => {
					if (standalone?.apiKey) return standalone.apiKey;
					const credentials = serviceOf(ctx, "credentials");
					const rc = credentials ? await credentials.resolve(credentialRef(ref)) : void 0;
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
) : {
				ok: false,
				provider: "unknown",
				reason: "unsupported",
				message: "当前对话未配置模型服务商"
			};
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
	const { kind, failure: failure$1 } = finish ?? {};
	if (kind === "aborted") return "生成已取消";
	if (kind === "max-tokens") return "输出达到上限，未产出正文";
	if (kind !== "error") return "模型未返回文本";
	const { message, code } = failure$1 ?? {};
	if (typeof message === "string" && message.trim() !== "") return message;
	if (typeof code === "string" && code.trim() !== "") return code;
	return "未提供失败原因";
}

//#endregion
//#region src/host/llm-reasoning.ts
async function supportsReasoningOff(ctx, provider, model) {
	const llm = serviceOf(ctx, "llm");
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
		const sel = serviceOf(ctx, "agentDefaultModel")?.currentSelection();
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
/** 数值转口语：整数不带小数点，非整数留一位。 */
function numText(value) {
	return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
/**
* 地点短语：省 + 市。
*
* 省市互相包含时只留一个（“北京市 / 北京”不该写成“北京市北京”），拉丁文地名之间补空格。
* 拼装留给提示词这一层：宿主的 /environment 只给两段原始数据。
*
* @param region - 省 / 州；空串或缺省表示没有这一段。
* @param city - 市；空串或缺省表示不知道在哪。
* @returns 展示用地点；城市未知时 undefined。
*/
function placeTextOf(region, city) {
	if (city === void 0 || city === "") return void 0;
	if (region === void 0 || region === "" || region === city) return city;
	if (region.includes(city)) return region;
	if (city.includes(region)) return city;
	return /[\u4e00-\u9fa5]$/u.test(region) ? region + city : region + " " + city;
}
/** 天气从句：有数据时拼一句口语，没有时给出“别编”的交代。 */
function weatherClauseOf(weather) {
	if (weather === void 0) return "外面的天气这次没查到，主人问起就说不知道、别编";
	return "外面" + weather.summary + "，气温 " + numText(weather.temperatureC) + "°C，体感 " + numText(weather.apparentC) + "°C，湿度 " + numText(weather.humidityPercent) + "%，风速 " + numText(weather.windKph) + " km/h";
}
function timeContextOf(date, env) {
	if (Number.isNaN(date.getTime())) return "";
	const day = date.getDay();
	const hour = date.getHours();
	const holiday = holidayClauseOf(date);
	const placeName = placeTextOf(env?.region, env?.city);
	const place = placeName === void 0 ? "" : "你在" + placeName + "（按网络粗估，不一定准），";
	const weather = env === void 0 ? "" : "，" + weatherClauseOf(env.weather);
	return "【当下】" + place + "现在是" + date.getFullYear() + "年" + (date.getMonth() + 1) + "月" + date.getDate() + "日" + (WEEKDAYS[day] ?? "星期?") + " " + pad2(hour) + ":" + pad2(date.getMinutes()) + "，" + timeSlotOf(hour) + "，" + dayKindOf(day) + (holiday ? "，" + holiday : "") + weather + "。这只是背景，不必刻意报时，也别句句都提节日" + (env === void 0 ? "" : "或天气") + "——多数时候正常说话就好，真贴切时才顺口带一句。";
}
function historyStampOf(ts, now) {
	const at = new Date(ts);
	if (Number.isNaN(at.getTime()) || Number.isNaN(now.getTime())) return "";
	const date = (at.getFullYear() === now.getFullYear() ? "" : at.getFullYear() + "年") + (at.getMonth() + 1) + "月" + at.getDate() + "日";
	return date + " " + pad2(at.getHours()) + ":" + pad2(at.getMinutes());
}

//#endregion
//#region src/host/chat.ts
/** 单次生成超时（ms）：对话等 LLM 回复，60s 足够。 */
const TIMEOUT_MS$1 = 6e4;
/** 历史消息打时间前缀的阈值（ms）：30 分钟内的连续对话不加，避免每句都多几个 token。 */
const HISTORY_STAMP_GAP_MS = 30 * 60 * 1e3;
/**
* user 历史消息的正文：距现在超过阈值时，前面加 `[10月31日 22:53]`。
*
* 只给 user 打：同一轮 user / assistant 共享同一个 ts，标一条就够；标在 assistant 上时，
* 模型会把这行当成自己的说话格式照抄（实际出现过回复以 `[11:54]` 开头）。
* 阈值内的连续对话不加前缀——否则一段正常闲聊会变成每句一个时间戳。
*
* @param message - 历史消息（带 ts）。
* @param nowMs - 本次生成时刻（毫秒），整批历史共用一个，避免逐条取时钟导致同批时间不一致。
* @returns 需要前缀时返回 `[时:分] 原文`，否则原样返回 `content`。
*/
function userHistoryTextOf(message, nowMs) {
	if (!Number.isFinite(message.ts)) return message.content;
	if (!(nowMs - message.ts > HISTORY_STAMP_GAP_MS)) return message.content;
	const stamp = historyStampOf(message.ts, new Date(nowMs));
	return stamp === "" ? message.content : "[" + stamp + "] " + message.content;
}
/**
* 历史里回填的配图 / 动作标记（`[动作:名称]` 与 `[图:名称]`，各占一行，顺序固定）。
*
* 记忆里只存名字、正文里的标记在落盘前已被剥掉；不回填的话模型看不到自己前几轮配过哪张图、
* 演过什么动作，用户说“换一个”时它连换的是什么都不知道，只会重复挑同一张或答非所问。
* 只回填 assistant：user 的附件引用依旧不带（旧图不重发给模型）。
* 名称可能为空串（手改过记忆文件）——空值不回填，纯文本历史逐字不变。
*
* @param message - 历史消息。
* @returns 需要回填时返回 `\n[动作:…]\n[图:…]`，否则空串。
*/
function historyMarkersOf(message) {
	if (message.role !== "assistant") return "";
	const lines = [];
	if (typeof message.action === "string" && message.action !== "") lines.push("[动作:" + message.action + "]");
	if (typeof message.meme === "string" && message.meme !== "") lines.push("[图:" + message.meme + "]");
	return lines.length === 0 ? "" : "\n" + lines.join("\n");
}
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
	const llm = serviceOf(ctx, "llm");
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
	const nowMs = Date.now();
	const historyMessages = history.map((m) => m.role === "user" ? createUserMessage({
		content: [{
			type: "text",
			text: userHistoryTextOf(m, nowMs)
		}],
		source: { kind: "user" }
	}) : createAssistantMessage({
		content: [{
			type: "text",
			text: m.content + historyMarkersOf(m)
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
//#region src/host/persona.ts
/**
* 历史时间说明：历史里 user 消息带 `[月日 时:分]` 前缀时追加，让模型知道那些时刻可以用来算跨度。
*
* 措辞把前缀限定为「对话记录里的时间标注」而不是「回复格式」；前缀只标在 user 消息上——
* 标在 assistant 上时模型会照抄成自己的说话格式（出现过回复以 `[11:54]` 开头）。
*/
const HISTORY_TIMES_LINE = "【历史】对话记录里，主人的话前面标着 [月日 时:分]，那是那句话发生的时刻；它只是记录里的时间标注，不是你的说话格式。判断“多久以前”“隔了几天”时按它换算，别把隔了很久的话当成刚说过的。你的回复直接从正文开始，不要写时间、不要加方括号前缀。";
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
	const time = timeContextOf(parts.now, parts.env);
	if (time) {
		lines.push(time);
		if (parts.historyTimes === true) lines.push(HISTORY_TIMES_LINE);
	}
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
	const llm = serviceOf(ctx, "llm");
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
/** 第三方召回的硬超时（ms）：到点按“不修改内容”继续生成，不拖住这一轮对话。 */
const RECALL_TIMEOUT_MS = 1500;
/** 校验召回补丁里的历史项：形状不对的整段丢弃，避免坏数据把生成打崩。 */
function isChatTurn(value) {
	const turn = value;
	return (turn?.role === "user" || turn?.role === "assistant") && typeof turn?.content === "string" && typeof turn?.ts === "number";
}
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
	*  拼装在 ./persona（纯函数）：人设正文 + 名字声明 + 一行时间背景，时间每次现算；
	*  对话路径传 `{ historyTimes: true }` 追加【历史】说明，碎碎念没有历史，不传。
	*  `env` 是城市与天气：对话、碎碎念、梦话都传——它们说的是同一只宠物此刻的处境。
	*  收 `findPetInstance` 的命中结果而不是 (petId, cfg)：调用方都已解析过，再查只会多一处
	*  「查不到就兜底 main」的不可达分支。 */
	const petSystemPrompt = (found, options = {}) => composeSystemPrompt({
		prompt: petPersona(found.conf, found.pet),
		name: String(found.pet.name ?? ""),
		id: String(found.pet.id ?? ""),
		now: new Date(),
		...options.historyTimes === true ? { historyTimes: true } : {},
		...options.env !== void 0 ? { env: options.env } : {}
	});
	/** 对话记忆轮数（1 轮 = 1 问 1 答）：该宠物所属条目的 chatMemoryRounds（合并器已填默认）。
	*  收已解析的条目配置：调用方都已拿到 `findPetInstance` 的结果。 */
	const memoryRounds = (conf) => {
		const v = Number(conf.chatMemoryRounds);
		return Number.isFinite(v) && v >= 0 ? Math.floor(v) : 5;
	};
	/**
	* 对话前修改内容：召回钩子返回要覆盖的字段，核心合并后再交给模型。
	*
	* 超时、抛错、返回非法形状都当“不修改”，只记提供者 id 与原因。
	*
	* @param petId - 目标宠物；第三方按它区分记忆空间。
	* @param content - 本轮将要发给模型的 system/history/userText。
	* @returns 合法的覆盖字段；没有可应用的字段时 undefined。
	*/
	const recallPatch = async (petId, content) => {
		const provider = activeChatMemoryProvider();
		const recall = provider?.recall;
		if (!provider || !recall) return void 0;
		let timer;
		try {
			const timeout = new Promise((resolve$1) => {
				timer = setTimeout(() => resolve$1(void 0), RECALL_TIMEOUT_MS);
				timer.unref?.();
			});
			const result = await Promise.race([Promise.resolve(recall.call(provider, {
				petId,
				...content
			})), timeout]);
			if (!result || typeof result !== "object") return void 0;
			const patch = {};
			if (typeof result.system === "string") patch.system = result.system;
			if (typeof result.userText === "string") patch.userText = result.userText;
			if (Array.isArray(result.history) && result.history.every(isChatTurn)) patch.history = result.history;
			return Object.keys(patch).length === 0 ? void 0 : patch;
		} catch (error) {
			log.warn("[dsh-pet] 记忆召回失败 id=" + provider.id + "：" + (error instanceof Error ? error.message : String(error)));
			return void 0;
		} finally {
			if (timer !== void 0) clearTimeout(timer);
		}
	};
	/**
	* 落盘后接收这一轮问答：核心不等待，失败只记提供者 id 与原因。
	*
	* @param petId - 目标宠物。
	* @param turn - 本轮问答与元信息；action/image 只是名字，不含素材本体。
	*/
	const captureTurn = (petId, turn) => {
		const provider = activeChatMemoryProvider();
		const capture = provider?.capture;
		if (!provider || !capture) return;
		Promise.resolve().then(() => capture.call(provider, {
			petId,
			...turn
		})).catch((error) => {
			log.warn("[dsh-pet] 记忆接收失败 id=" + provider.id + "：" + (error instanceof Error ? error.message : String(error)));
		});
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
		const manualVoiceOn = cfg.main?.voiceEnabled === true;
		const voiceOff = kind === "whisper" ? !whisperVoiceOn : !manualVoiceOn;
		const target = voiceOff ? void 0 : voiceTo ?? voiceTargetFor(found.pet);
		const system = petSystemPrompt(found, { env: await currentEnvironment() });
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
		const system = petSystemPrompt(found, { env: await currentEnvironment() });
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
	const chatWithPet = async (petId, text, image) => {
		const env = await currentEnvironment();
		return withMemoryLock(async () => {
			const cfg = readAllConfig(configPaths);
			const found = findPetInstance(cfg, petId);
			if (!found) return {
				ok: false,
				reason: "unknown-pet",
				message: "没有这只桌宠：" + petId
			};
			const rounds = memoryRounds(found.conf);
			const pool = found.conf.chatImageEnabled === true ? limitPool(readMemePool(found.conf.memes, memeDirsFor(found.entry)), Number(found.conf.chatImageLimit)) : [];
			const actions = found.conf.chatAnimationEnabled === true ? chatActionNames(found.conf.animations) : [];
			const mem = await readMemory();
			const bucket = mem[found.entry] && typeof mem[found.entry] === "object" && !Array.isArray(mem[found.entry]) ? mem[found.entry] : mem[found.entry] = {};
			const existing = bucket[petId];
			if (existing !== void 0 && (!existing || !Array.isArray(existing.messages))) log.error(`[dsh-pet] 记忆结构异常（messages 不是数组）pet=${petId}，按新会话处理：${memoryPath}`);
			const entry = existing && Array.isArray(existing.messages) ? existing : bucket[petId] = { messages: [] };
			const list = sliceMemoryRounds(entry.messages, rounds);
			const system = petSystemPrompt(found, {
				historyTimes: list.length > 0,
				env
			});
			if (image !== void 0) log.info(`[dsh-pet] 对话附带图片 pet=${petId}，${image.width}x${image.height}，${image.bytes} 字节（模型不支持读图时内核会以占位文本代替）`);
			const patch = await recallPatch(petId, {
				system,
				history: list.map(({ role, content, ts }) => ({
					role,
					content,
					ts
				})),
				userText: text
			});
			const generated = await generateChat({
				ctx,
				system: patch?.system ?? system,
				history: patch?.history ?? list,
				userText: patch?.userText ?? text,
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
			captureTurn(petId, {
				userText: text,
				replyText: generated.text,
				ts: now,
				...generated.action !== void 0 ? { action: generated.action } : {},
				...generated.image !== void 0 ? { image: generated.image } : {}
			});
			if (generated.action !== void 0) {
				const record = playback.create(petId, generated.action);
				state.writePet(petId, "anim", {
					name: generated.action,
					playbackId: record.playbackId
				});
			}
			const replyVoiceTo = cfg.main?.voiceEnabled === true ? voiceTargetFor(found.pet) : void 0;
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
	};
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
	const { state, workStatus, EXTERNAL_WORK_SESSION } = deps;
	const WORK_STATE_GAP_MS = 5e3;
	let publishedWork = "\0";
	let publishedState = null;
	let publishedWorkAt = 0;
	let workFlushTimer = null;
	const publishWorkStatus = () => {
		const snap = workStatus.snapshot();
		const key = String(snap.state) + "\0" + String(snap.task) + "\0" + String(snap.sessionId ?? "");
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
		const sessionId = snap.sessionId === null || snap.sessionId === EXTERNAL_WORK_SESSION ? null : snap.sessionId;
		state.writeSection("workStatus", {
			state: snap.state,
			task: snap.task,
			sessionId
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
//#region src/host/voice/builtin-deepseek-asr.ts
const DEEPSEEK_ASR_PROVIDER_ID = "deepseek";
/** 官方接口地址；整段上传、整段返回，不支持流式。 */
const ASR_ENDPOINT = "https://api.deepseek.com/v1/tools/asr";
function createDeepseekAsrProvider(deps) {
	return {
		id: DEEPSEEK_ASR_PROVIDER_ID,
		name: "DeepSeek",
		timeoutMs: 6e4,
		async transcribe({ audio, signal }) {
			const key = await deps.resolveKey();
			if (!key) throw new SpeechUnavailableError("DEEPSEEK_API_KEY is not configured");
			const form = new FormData();
			form.append("file", new Blob([audio], { type: "audio/wav" }), "speech.wav");
			const res = await fetch(ASR_ENDPOINT, {
				method: "POST",
				headers: { authorization: `Bearer ${key}` },
				body: form,
				signal
			});
			if (!res.ok) throw new Error(`deepseek asr HTTP ${res.status}`);
			const body = await res.json();
			if (typeof body?.text !== "string") throw new Error("deepseek asr returned invalid body");
			return body.text;
		}
	};
}
function ensureDeepseekAsrProvider(deps) {
	if (resolveSpeechProvider(DEEPSEEK_ASR_PROVIDER_ID)) return;
	registerSpeechProvider(createDeepseekAsrProvider(deps));
}

//#endregion
//#region src/host/voice/builtin-deepseek-tts.ts
const DEEPSEEK_TTS_PROVIDER_ID = "deepseek";
/** 官方接口地址；音频随着合成流式返回，这里整段收下再交给缓存层。 */
const TTS_ENDPOINT = "https://api.deepseek.com/v1/tools/tts";
/** 官方声明的音色：`id` 就是请求里的 `voice_id`，其余字段只用于展示。 */
const VOICES$1 = [{
	id: "stella",
	name: "海星",
	tag: "女声"
}, {
	id: "tide",
	name: "暗潮",
	tag: "男声"
}];
function createDeepseekTtsProvider(deps) {
	return {
		id: DEEPSEEK_TTS_PROVIDER_ID,
		name: "DeepSeek",
		voices: VOICES$1,
		format: "wav",
		timeoutMs: 6e4,
		async synthesize({ text, voice, signal }) {
			const key = await deps.resolveKey();
			if (!key) throw new Error("DEEPSEEK_API_KEY is not configured");
			const res = await fetch(TTS_ENDPOINT, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					authorization: `Bearer ${key}`
				},
				body: JSON.stringify({
					text,
					voice_id: voice,
					format: "wav"
				}),
				signal
			});
			if (!res.ok) throw new Error(`deepseek tts HTTP ${res.status}`);
			return new Uint8Array(await res.arrayBuffer());
		}
	};
}
function ensureDeepseekTtsProvider(deps) {
	if (resolveVoice(limitedVoiceId(DEEPSEEK_TTS_PROVIDER_ID, VOICES$1[0].id))) return;
	registerVoiceProvider(createDeepseekTtsProvider(deps));
}

//#endregion
//#region src/host/voice/builtin-dsh.ts
const DSH_SPEECH_PROVIDER_ID = "dsh";
/** 宿主 `transcribe` 的 signal 是必填的，而契约里可选：没有时用这个永不中止的信号。 */
const NEVER_ABORT = new AbortController().signal;
/**
* 可用的就绪阶段。
*
* `standby` 是资源已就绪、等录音时才唤醒引擎——和 `ready` 一样能立刻用；
* 其余（unprepared / downloading / failed / cancelled）才是真的不可用。
*/
const USABLE_PHASES = new Set(["ready", "standby"]);
function createDshSpeechProvider(deps) {
	return {
		id: DSH_SPEECH_PROVIDER_ID,
		name: "DSH 语音插件",
		async transcribe({ audio, signal }) {
			const speech = deps.speechToText();
			if (speech === void 0 || typeof speech.transcribe !== "function") throw new SpeechUnavailableError("host has no speech-to-text service");
			if (speech.listProviders().length === 0) throw new SpeechUnavailableError("host has no speech provider enabled");
			const providers$2 = speech.snapshot?.()?.providers ?? [];
			const isAnyUsable = providers$2.length === 0 || providers$2.some((item) => USABLE_PHASES.has(String(item.preparation?.phase)));
			if (!isAnyUsable) throw new SpeechUnavailableError("speech provider is not ready");
			const result = await speech.transcribe(speech.resolve({ audio }), signal ?? NEVER_ABORT);
			if (typeof result?.text !== "string") throw new Error("invalid transcript from host speech service");
			return result.text;
		}
	};
}
function ensureDshSpeechProvider(deps) {
	if (resolveSpeechProvider(DSH_SPEECH_PROVIDER_ID)) return;
	registerSpeechProvider(createDshSpeechProvider(deps));
}

//#endregion
//#region src/host/voice/edge.ts
/** 依赖自带的静默超时（ms）：每来一帧就重置，只能防卡死，不能当总时限用。 */
const SYNTHESIS_TIMEOUT_MS = 15e3;
var VoiceSynthError = class extends Error {
	constructor(message) {
		super(message);
		this.name = "VoiceSynthError";
	}
};
async function synthesize({ signal, text, voice, rate }) {
	try {
		const mod = await import("@andresaya/edge-tts");
		const EdgeTTS = mod.EdgeTTS ?? mod.default?.EdgeTTS;
		if (!EdgeTTS) throw new VoiceSynthError("依赖未导出 EdgeTTS");
		const tts = new EdgeTTS();
		const result = await tts.generate(text, voice, {
			rate,
			signal,
			timeout: SYNTHESIS_TIMEOUT_MS
		});
		return result.audio;
	} catch (error) {
		throw new VoiceSynthError(error instanceof Error ? error.message : String(error));
	}
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

//#endregion
//#region src/host/voice/builtin-edge.ts
const EDGE_PROVIDER_ID = "edge";
/**
* 内置实现的单次合成上限（ms）。
*
* 比依赖自带的 15s 静默超时更宽：那个超时每来一帧就重置，只能防卡死，
* 长文本在正常网络下也可能超过 15s。
*/
const EDGE_TIMEOUT_MS = 28e3;
const EDGE_PROVIDER = {
	id: EDGE_PROVIDER_ID,
	name: "Edge",
	voices: VOICES.map((voice) => ({
		id: voice.id,
		name: voice.name,
		tag: voice.tag
	})),
	format: "mp3",
	timeoutMs: EDGE_TIMEOUT_MS,
	synthesize
};
function ensureEdgeProvider() {
	if (resolveVoice(limitedVoiceId(EDGE_PROVIDER_ID, DEFAULT_VOICE))) return;
	registerVoiceProvider(EDGE_PROVIDER);
}

//#endregion
//#region src/host/voice/cache.ts
const CACHE_MAX_BYTES = 20 * 1024 * 1024;
const CACHE_MAX_FILES = 200;
const FORMAT_INFO = {
	mp3: {
		ext: ".mp3",
		mime: "audio/mpeg"
	},
	wav: {
		ext: ".wav",
		mime: "audio/wav"
	}
};
/** 淘汰时要统计的扩展名；漏掉一种，那种文件就永远删不掉。 */
const CACHED_EXTENSIONS = Object.values(FORMAT_INFO).map((info) => info.ext);
function cachePath(userRoot, key, format) {
	return join(userRoot, "voice-cache", key + FORMAT_INFO[format].ext);
}
function cacheKey(voiceId, rate, text) {
	return createHash("sha1").update(`${voiceId}\n${rate}\n${text}`).digest("hex");
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
		if (!CACHED_EXTENSIONS.some((ext) => name.endsWith(ext))) continue;
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
//#region src/host/voice/speak.ts
const MAX_TEXT_CHARS = 500;
const MAX_QUEUE = 3;
/** 语速表达式：`+N%` 或 `-N%`。 */
const RATE_PATTERN = /^[+-]\d{1,3}%$/;
/** 语速下界（百分比）。 */
const RATE_MIN_PERCENT = -50;
/** 语速上界（百分比）。 */
const RATE_MAX_PERCENT = 100;
/** 排队超过这么久还没轮到就丢弃（ms）：比客户端等合成结果的上限（30s）略短，超了它早已放弃。 */
const STALE_WAIT_MS = 28e3;
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
	const voice = body.voice;
	if (voice !== void 0 && typeof voice !== "string") return {
		ok: false,
		message: "voice must be a string"
	};
	const rate = body.rate === void 0 ? "+0%" : body.rate;
	if (typeof rate !== "string" || !RATE_PATTERN.test(rate)) return {
		ok: false,
		message: "rate must look like +0% or -10%"
	};
	const percent = Number(rate.slice(0, -1));
	if (!Number.isFinite(percent) || percent < RATE_MIN_PERCENT || percent > RATE_MAX_PERCENT) return {
		ok: false,
		message: `rate out of range (${RATE_MIN_PERCENT}%..+${RATE_MAX_PERCENT}%)`
	};
	const ratePercent = percent === 0 ? 0 : percent;
	return {
		ok: true,
		value: {
			text,
			rate: ratePercent,
			...voice === void 0 ? {} : { voice }
		}
	};
}
/** 断言用：丢弃分支只经这里构造，避免各处手写同一句文案。 */
function dropped() {
	return {
		ok: false,
		reason: "voice-busy",
		message: "queued too long, dropped"
	};
}
function isQueueStale(queuedMs, nowMs, waitMs = STALE_WAIT_MS) {
	return nowMs - queuedMs > waitMs;
}
/** 给一个 Promise 套超时；超时 reject，原 Promise 不被取消（实现自己该处理放弃）。 */
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
* 先写 `<target>.part` 再改名：`target` 一旦出现就是完整文件。
*
* 不这样做的话，写盘中途失败会留下非空半截文件，而缓存命中只判「文件存在且非空」，
* 那半截音频会被当成有效结果一直命中。
*/
async function writeAtomically(target, bytes) {
	const staging = `${target}.part`;
	try {
		await writeFile(staging, bytes);
		await rename(staging, target);
	} catch (error) {
		await rm(staging, { force: true }).catch(() => void 0);
		throw error;
	}
}
function createVoiceService(options) {
	const { userRoot, log, configuredVoice } = options;
	const staleWaitMs = options.staleWaitMs ?? STALE_WAIT_MS;
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
	/** 校验请求、解析音色、算出落盘目标；任何一步不成立都直接给出可回给调用方的结论。 */
	function prepareCall(raw) {
		const parsed = parseSpeakInput(raw);
		if (!parsed.ok) return {
			ok: false,
			result: {
				ok: false,
				reason: "bad-request",
				message: parsed.message
			}
		};
		const { text, rate } = parsed.value;
		const limitedId = parsed.value.voice ?? configuredVoice?.();
		if (!limitedId) return {
			ok: false,
			result: {
				ok: false,
				reason: "bad-request",
				message: "voice is required"
			}
		};
		const resolved = resolveVoice(limitedId);
		if (!resolved) return {
			ok: false,
			result: {
				ok: false,
				reason: "bad-request",
				message: `voice not found: ${limitedId}`
			}
		};
		const format = resolved.provider.format ?? "mp3";
		return {
			ok: true,
			text,
			rate,
			resolved,
			format,
			target: cachePath(userRoot, cacheKey(limitedId, rate, text), format),
			contentType: FORMAT_INFO[format].mime
		};
	}
	/** 排队、合成、原子落盘；失败已归一成结论，不向外抛。 */
	async function runSynthesis(call) {
		const { text, rate, resolved, target } = call;
		const { provider, voice } = resolved;
		const queue = { dropped: false };
		const queuedMs = Date.now();
		const startedMs = queuedMs;
		try {
			await enqueue(async () => {
				if (isQueueStale(queuedMs, Date.now(), staleWaitMs)) {
					queue.dropped = true;
					return;
				}
				const dir = await ensureCacheDir(userRoot);
				const timeoutMs = provider.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;
				const bytes = await withTimeout(provider.synthesize({
					text,
					voice: voice.id,
					rate,
					signal: AbortSignal.timeout(timeoutMs)
				}), timeoutMs);
				if (bytes.length === 0) throw new Error("voice provider returned empty audio");
				await writeAtomically(target, bytes);
				await pruneCache(dir);
			});
		} catch (error) {
			log?.warn?.(`[dsh-pet] voice speak: failed chars=${text.length} voice=${resolved.limitedId} ms=${Date.now() - startedMs} reason=${error instanceof Error ? error.message : String(error)}`);
			return {
				ok: false,
				reason: "generate-error",
				message: "voice synthesis failed"
			};
		}
		if (queue.dropped) {
			log?.warn?.(`[dsh-pet] voice speak: dropped chars=${text.length} voice=${resolved.limitedId} queued=${Date.now() - queuedMs}ms`);
			return dropped();
		}
		log?.info?.(`[dsh-pet] voice speak: cache=miss chars=${text.length} voice=${resolved.limitedId} ms=${Date.now() - startedMs}`);
		return {
			ok: true,
			file: target,
			contentType: call.contentType
		};
	}
	async function speak(raw) {
		const call = prepareCall(raw);
		if (!call.ok) return call.result;
		const cached$4 = await findCached(call.target);
		if (cached$4) {
			log?.info?.(`[dsh-pet] voice speak: cache=hit chars=${call.text.length} voice=${call.resolved.limitedId}`);
			return {
				ok: true,
				file: cached$4,
				contentType: call.contentType
			};
		}
		if (queueUsed >= MAX_QUEUE) {
			log?.warn?.(`[dsh-pet] voice speak: queue full (max ${MAX_QUEUE}) chars=${call.text.length} voice=${call.resolved.limitedId}`);
			return {
				ok: false,
				reason: "voice-busy",
				message: "voice queue is full, retry later"
			};
		}
		return runSynthesis(call);
	}
	return {
		list: listCatalog,
		speak
	};
}

//#endregion
//#region src/host/voice/hear.ts
const MAX_AUDIO_BYTES = 7 * 1024 * 1024;
/** base64 字面量：`Buffer.from` 解码很宽松，先按字母表与补齐规则挡掉脏数据。 */
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;
/**
* 校验请求体；只认 `audio` 与 `provider` 两个字段，其余忽略。
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
	const provider = body.provider;
	if (provider !== void 0 && (typeof provider !== "string" || provider.trim() === "")) return {
		ok: false,
		message: "provider must be a non-empty string"
	};
	return {
		ok: true,
		value: {
			audio,
			...provider === void 0 ? {} : { provider: provider.trim() }
		}
	};
}
/**
* 给一次识别套上超时与调用方中止，把结论收敛成「值或一句说明」。
*
* @param signal - 调用方中止信号（连接断开）。
* @param timeoutMs - 超时上限。
* @param task - 真正执行识别的函数。
* @returns 成功给任务的值；超时、抛错或能力缺失给分类后的说明。
*/
async function withDeadline(signal, timeoutMs, task) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	timer.unref();
	const onAbort = () => controller.abort();
	signal?.addEventListener("abort", onAbort, { once: true });
	let onDeadline;
	const deadline = new Promise((_, reject) => {
		onDeadline = () => reject(new Error("speech transcription aborted"));
		controller.signal.addEventListener("abort", onDeadline, { once: true });
	});
	try {
		return {
			ok: true,
			value: await Promise.race([task(controller.signal), deadline])
		};
	} catch (error) {
		return {
			ok: false,
			unavailable: error instanceof SpeechUnavailableError,
			message: error instanceof Error ? error.message : String(error)
		};
	} finally {
		clearTimeout(timer);
		if (onDeadline !== void 0) controller.signal.removeEventListener("abort", onDeadline);
		signal?.removeEventListener("abort", onAbort);
	}
}
function createHearService(options) {
	return {
		list: listSpeechCatalog,
		async hear(raw, signal) {
			const parsed = parseHearInput(raw);
			if (!parsed.ok) return {
				ok: false,
				reason: "bad-request",
				message: parsed.message
			};
			const providerId = parsed.value.provider ?? options.configuredProvider?.();
			if (!providerId) return {
				ok: false,
				reason: "bad-request",
				message: "provider is required"
			};
			const provider = resolveSpeechProvider(providerId);
			if (!provider) return {
				ok: false,
				reason: "bad-request",
				message: `provider not found: ${providerId}`
			};
			const timeoutMs = provider.timeoutMs ?? options.timeoutMs ?? DEFAULT_SPEECH_TIMEOUT_MS;
			const run$1 = await withDeadline(signal, timeoutMs, (inner) => provider.transcribe({
				audio: parsed.value.audio,
				signal: inner
			}));
			if (!run$1.ok) return {
				ok: false,
				reason: run$1.unavailable ? "unsupported" : "generate-error",
				message: run$1.message
			};
			if (typeof run$1.value !== "string") return {
				ok: false,
				reason: "generate-error",
				message: "invalid transcript from provider"
			};
			return {
				ok: true,
				text: run$1.value
			};
		}
	};
}

//#endregion
//#region src/host/index.ts
function apply(ctx) {
	const host = softCtx(ctx);
	try {
		applyPet(host);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		try {
			host?.logger?.error?.("[dsh-pet] 启动失败，已跳过本插件（不影响 DSH 启动）：" + message);
		} catch {}
		console.error("[dsh-pet] 启动失败，已跳过本插件（不影响 DSH 启动）：", error);
	}
}
/**
* 真正的装配流程（由 {@link apply} 兜底调用）。
* @param ctx - 软化后的宿主上下文。
*/
function applyPet(ctx) {
	const setup = createHostSetup(ctx);
	const { userRoot, log, configPaths, thumbUserRoot, memeDirsFor, standaloneAiPolicy, standaloneAiBalance, state, playback, workStatus, EXTERNAL_WORK_SESSION, nextExternalWorkSeq } = setup;
	log.info("[dsh-pet] 宿主半侧已装配（宿主服务一律软取：不声明硬依赖，避免插件行 pending 拖垮 DSH 启动）");
	const workStatusBridge = createWorkStatusBridge({
		state,
		workStatus,
		EXTERNAL_WORK_SESSION
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
	setCityProvider(() => {
		const city = readAllConfig(configPaths).main?.environmentCity;
		return typeof city === "string" && city.trim() !== "" ? city.trim() : void 0;
	});
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
		state,
		standaloneAiBalance
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
	ensureEdgeProvider();
	ensureDshSpeechProvider({ speechToText: () => setup.optionalService("speechToText") });
	const resolveDeepseekKey = async () => {
		const dedicated = setup.standaloneDeepseekKey();
		if (dedicated) return dedicated;
		const standalone = setup.standaloneAiBalance();
		if (standalone?.provider === DEEPSEEK_OFFICIAL_PROVIDER_ID && standalone.apiKey) return standalone.apiKey;
		const credentials = serviceOf(ctx, "credentials");
		if (!credentials) return void 0;
		const resolved = await credentials.resolve(credentialRef("DEEPSEEK_API_KEY"));
		return resolved?.value;
	};
	ensureDeepseekTtsProvider({ resolveKey: resolveDeepseekKey });
	ensureDeepseekAsrProvider({ resolveKey: resolveDeepseekKey });
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
		environment: (opts) => currentEnvironment({
			force: opts?.fresh === true,
			...opts?.city === void 0 ? {} : { city: opts.city }
		}),
		voice: createVoiceService({
			userRoot,
			log,
			configuredVoice: () => {
				const name = readAllConfig(configPaths).main?.voiceName;
				return typeof name === "string" && name ? name : void 0;
			}
		}),
		speech: createHearService({ configuredProvider: () => {
			const provider = readAllConfig(configPaths).main?.speechProvider;
			return typeof provider === "string" && provider ? provider : void 0;
		} })
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
	const helperTimer = setTimeout(() => {
		try {
			startHelper();
		} catch (error) {
			log.warn(`[dsh-pet] 桌面 Helper 启动失败（不影响 DSH）：${error instanceof Error ? error.message : String(error)}`);
		}
	}, 500);
	helperTimer.unref?.();
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
	balanceProvider: z.string().max(40).optional(),
	apiKey: z.string().max(8192).optional(),
	clearApiKey: z.boolean().optional(),
	deepseekApiKey: z.string().max(4096).optional(),
	clearDeepseekKey: z.boolean().optional(),
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
	"balanceProvider",
	"automaticWhispers",
	"whisperIntervalSec",
	"maxTokens",
	"timeoutMs",
	"hasKey",
	"hasDeepseekKey"
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
		"/standalone-ai/settings.css",
		"/standalone-ai/chat-panel.js",
		"/standalone-ai/icon.png"
	].includes(path) || /^\/dsh-pet-\d+\//.test(path);
}
/** 设置页凭据 cookie：首次带令牌访问后下发，刷新时替代已从地址栏清掉的令牌。 */
const TOKEN_COOKIE = "dsh_pet_token";
/** 令牌的固定形状：32 字节 base64url。形状校验先跑，定时安全比较才有等长前提。 */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;
/** 从 Cookie 头里取出本服务的凭据；没有则返回空串。 */
function readTokenCookie(req) {
	const raw = req.headers.cookie;
	if (typeof raw !== "string") return "";
	for (const part of raw.split(";")) {
		const separator = part.indexOf("=");
		if (separator < 0) continue;
		if (part.slice(0, separator).trim() !== TOKEN_COOKIE) continue;
		return part.slice(separator + 1).trim();
	}
	return "";
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
			const fileOrigin = allowFileOrigin && (req.headers.origin === "null" || req.headers.origin === void 0 || req.headers.origin === "file://");
			if (!fileOrigin && (req.headers.origin !== void 0 && req.headers.origin !== `http://${host}` || req.headers["sec-fetch-site"] === "cross-site")) return rejectRequest(res, 403, "不允许跨站请求");
			try {
				if (publicRead(req) && !fileOrigin) return true;
			} catch {
				return rejectRequest(res, 400, "请求地址无效");
			}
			const header = req.headers["x-dsh-pet-token"];
			const fromHeader = typeof header === "string" && TOKEN_SHAPE.test(header);
			const supplied = fromHeader ? header : readTokenCookie(req);
			if (!TOKEN_SHAPE.test(supplied) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) return rejectRequest(res, 403, "请从桌宠菜单重新打开设置");
			if (fromHeader && readTokenCookie(req) !== token) res.setHeader("set-cookie", `${TOKEN_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/`);
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
		"content-security-policy": "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; media-src 'self' blob:; connect-src 'self'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'",
		"x-frame-options": "DENY"
	});
	res.end(body);
}
function sendIcon(res, icon) {
	res.writeHead(200, {
		"content-type": "image/png",
		"content-length": icon.length,
		"cache-control": "no-store",
		"x-content-type-options": "nosniff"
	});
	res.end(icon);
}
function fail(res, _error, logger) {
	logger.error("独立模式路由处理失败（详细内容已省略以保护凭据）");
	if (res.headersSent) res.destroy();
	else sendJson(res, 500, { error: "本机服务暂时无法处理请求" });
}

//#endregion
//#region src/standalone/server/handlers.ts
/** 读完请求体并解析成 JSON；空体当作空对象。 */
async function readJsonBody(req) {
	const chunks = [];
	await new Promise((resolve$1, reject) => {
		req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
		req.once("end", resolve$1);
		req.once("error", reject);
	});
	const text = Buffer.concat(chunks).toString("utf8");
	return text ? JSON.parse(text) : {};
}
/** 只接受对象形态的草稿；数组、标量与 null 一律当未填。 */
function asDraft(body) {
	return body !== null && typeof body === "object" && !Array.isArray(body) ? body : {};
}
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
			const input = validateSettings$1(await readJsonBody(req));
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
			const input = asDraft(await readJsonBody(req));
			if (ai?.testConnection) sendJson(res, 200, await ai.testConnection(input));
			else sendJson(res, 200, {
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
function modelsHandler(ai) {
	return async (req, res) => {
		if (req.method !== "POST") {
			rejectRequest(res, 405, "仅支持 POST");
			return;
		}
		if (!ai?.discoverModels) {
			sendJson(res, 200, {
				ok: false,
				code: "input",
				message: "当前环境未配置模型清单能力"
			});
			return;
		}
		try {
			sendJson(res, 200, await ai.discoverModels(asDraft(await readJsonBody(req))));
		} catch {
			sendJson(res, 400, {
				ok: false,
				code: "input",
				message: "请求格式无效"
			});
		}
	};
}
function balanceHandler(ai) {
	return async (req, res) => {
		if (req.method !== "POST") {
			rejectRequest(res, 405, "仅支持 POST");
			return;
		}
		if (!ai?.queryBalance) {
			sendJson(res, 200, {
				ok: false,
				provider: "",
				reason: "unsupported"
			});
			return;
		}
		try {
			sendJson(res, 200, await ai.queryBalance());
		} catch {
			sendJson(res, 200, {
				ok: false,
				provider: "",
				reason: "fetch-error",
				message: "余额查询失败"
			});
		}
	};
}

//#endregion
//#region src/shared/avatar.ts
const LOGO_URL = ROUTE_PATH + "/logo";

//#endregion
//#region src/shared/physics/constants.ts
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
	tiltGravity: true,
	shakeThrow: true
};

//#endregion
//#region src/shared/weights.ts
const DEFAULT_WEIGHTS = {
	idle: 10,
	turn: 5,
	move: 5
};

//#endregion
//#region src/standalone/settings-page/script/ai.ts
function aiScript() {
	return `
const AI_SETTINGS_URL = '/standalone-ai/settings';
const AI_TEST_URL = '/standalone-ai/test';
const AI_BALANCE_URL = '/standalone-ai/balance';

async function aiRequest(method, body) {
  const response = await fetch(AI_SETTINGS_URL, {
    method: method,
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
    headers: body
      ? { 'X-DSH-Pet-Token': TOKEN, 'Content-Type': 'application/json' }
      : { 'X-DSH-Pet-Token': TOKEN },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    if (response.status === 403) throw new Error('打开凭据已失效。请从桌宠菜单重新打开设置。');
    if (response.status === 429) throw new Error('保存过于频繁，请稍等一分钟再试。');
    throw new Error('设置未保存。请检查接口地址、模型名称与密钥，再重试。');
  }
  return response.json();
}

function populateAi(data) {
  if (data.protocol !== undefined && protocolSelect) protocolSelect.setValue(String(data.protocol));
  for (const id of ['baseUrl', 'model']) {
    if (data[id] !== undefined && byId(id)) byId(id).value = String(data[id]);
  }
  if (data.balanceProvider !== undefined && balanceSelect) balanceSelect.setValue(String(data.balanceProvider));
  byId('balance-btn').disabled = !balanceSelect || balanceSelect.getValue() === '';
  byId('key-state').textContent = data.hasKey ? '已保存 · 不回显' : '尚未设置';
  byId('key-actions').hidden = data.hasKey !== true;
  byId('apiKey').value = '';
  byId('apiKey').disabled = false;
  byId('deepseek-key-state').textContent = data.hasDeepseekKey ? '已保存 · 不回显' : '尚未设置';
  byId('deepseek-key-actions').hidden = data.hasDeepseekKey !== true;
  byId('deepseekApiKey').value = '';
  byId('deepseekApiKey').disabled = false;
}

/** 把余额结果翻成一行可读文案；失败一律说明原因，不显示伪造数字。 */
function describeBalance(data) {
  if (!data || data.ok !== true) {
    if (data && data.reason === 'credential-missing') return '缺少密钥：请先保存所选服务商的 API 密钥。';
    if (data && data.reason === 'unsupported') return '该服务商不提供余额查询。';
    return data && data.message ? '查询失败：' + data.message : '查询失败，请稍后重试。';
  }
  const payload = data.data || {};
  if (data.shape === 'money' && payload.wallets) {
    return payload.wallets
      .map(function (wallet) {
        return wallet.currency + ' ' + wallet.total;
      })
      .join(' / ');
  }
  if (data.shape === 'points') return payload.total + ' ' + payload.unit;
  if (data.shape === 'windows') return '月度已用 ' + payload.monthly + '%';
  return '已取到余额数据。';
}

function wireBalanceQuery() {
  const button = byId('balance-btn');
  const result = byId('balance-result');
  button.addEventListener('click', async () => {
    button.disabled = true;
    result.className = 'status';
    result.dataset.ok = '';
    result.dataset.error = '';
    result.textContent = '正在查询余额…';
    try {
      const response = await fetch(AI_BALANCE_URL, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'X-DSH-Pet-Token': TOKEN },
      });
      if (!response.ok) throw new Error('查询被拒绝（HTTP ' + response.status + '）');
      const data = await response.json();
      const ok = data && data.ok === true;
      if (ok) result.dataset.ok = 'true';
      else result.dataset.error = 'true';
      result.textContent = (ok ? '✓ ' : '✗ ') + describeBalance(data);
    } catch (error) {
      result.dataset.error = 'true';
      result.textContent = '✗ ' + (error && error.message ? error.message : String(error));
    } finally {
      button.disabled = !balanceSelect || balanceSelect.getValue() === '';
    }
  });
}

function wireKeyDelete(status) {
  byId('key-delete').addEventListener('click', async () => {
    const confirmed = await confirmDialog({
      title: '删除已保存的密钥',
      text: '删除后桌宠将无法再调用模型，需要重新填写密钥才能恢复。',
      confirmLabel: '删除',
      danger: true,
    });
    if (!confirmed) return;
    setStatus(status, '正在删除密钥…');
    try {
      populateAi(await aiRequest('POST', { clearApiKey: true }));
      setStatus(status, '已删除保存的密钥。', 'ok');
    } catch (error) {
      setStatus(status, error && error.message ? error.message : String(error), 'error');
    }
  });
}

function wireDeepseekKeyDelete(status) {
  byId('deepseek-key-delete').addEventListener('click', async () => {
    const confirmed = await confirmDialog({
      title: '删除已保存的语音密钥',
      text: '删除后 DeepSeek 语音将不可用，直到重新填写密钥。',
      confirmLabel: '删除',
      danger: true,
    });
    if (!confirmed) return;
    setStatus(status, '正在删除语音密钥…');
    try {
      populateAi(await aiRequest('POST', { clearDeepseekKey: true }));
      setStatus(status, '已删除保存的语音密钥。', 'ok');
    } catch (error) {
      setStatus(status, error && error.message ? error.message : String(error), 'error');
    }
  });
}

function wireTest(testBtn, testResult) {
  testBtn.addEventListener('click', async () => {
    testBtn.disabled = true;
    testResult.className = 'status';
    testResult.textContent = '正在测试连接，请稍候…';
    const input = {
      protocol: protocolSelect ? protocolSelect.getValue() : 'openai-compatible',
      baseUrl: byId('baseUrl').value.trim(),
      model: byId('model').value.trim(),
      apiKey: byId('apiKey').value.trim(),
    };
    try {
      const response = await fetch(AI_TEST_URL, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'X-DSH-Pet-Token': TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const data = await response.json();
      if (data.ok) {
        testResult.className = 'status';
        testResult.dataset.ok = 'true';
        testResult.textContent = '✓ ' + data.message;
        if (data.reply) testResult.textContent += '；回复：' + data.reply;
      } else {
        testResult.className = 'status';
        testResult.dataset.error = 'true';
        testResult.textContent = '✗ ' + (data.message || data.error || '测试失败');
      }
    } catch (error) {
      testResult.className = 'status';
      testResult.dataset.error = 'true';
      testResult.textContent = '✗ 请求异常：' + (error && error.message ? error.message : String(error));
    } finally {
      testBtn.disabled = false;
    }
  });
}

function wireSave(form, save, status) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    save.disabled = true;
    setStatus(status, '正在保存到本机…');
    const input = {
      protocol: protocolSelect ? protocolSelect.getValue() : 'openai-compatible',
      baseUrl: byId('baseUrl').value.trim(),
      model: byId('model').value.trim(),
      balanceProvider: balanceSelect ? balanceSelect.getValue() : '',
      apiKey: byId('apiKey').value,
      deepseekApiKey: byId('deepseekApiKey').value,
    };
    byId('apiKey').value = '';
    byId('deepseekApiKey').value = '';
    try {
      populateAi(await aiRequest('POST', input));
      setStatus(status, '已保存到本机。', 'ok');
    } catch (error) {
      setStatus(status, error && error.message ? error.message : String(error), 'error');
    } finally {
      save.disabled = false;
    }
  });
}

function wireAiPanel() {
  wireModelPicker();
  const status = byId('status');
  wireKeyDelete(status);
  wireDeepseekKeyDelete(status);
  wireTest(byId('test-btn'), byId('test-result'));
  wireBalanceQuery();
  wireSave(byId('settings'), byId('save'), status);
}
`;
}

//#endregion
//#region src/standalone/settings-page/script/avatar.ts
function avatarScript(consts) {
	return `
const AVATAR_LOGO_URL = ${JSON.stringify(consts.logoUrl)};
const AVATAR_MAX_SIDE = ${consts.maxSide};
let avatarVersion = Date.now();

function avatarSrc(assetRoot) {
  const root = String(assetRoot || '').trim();
  const query = root === '' ? '' : 'root=' + encodeURIComponent(root) + '&';
  return AVATAR_LOGO_URL + '?' + query + 'v=' + avatarVersion;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result || '');
      resolve(url.slice(url.indexOf(',') + 1));
    };
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}

async function encodeAvatar(file) {
  const bitmap = await createImageBitmap(file);
  const longest = Math.max(bitmap.width, bitmap.height);
  if (longest <= AVATAR_MAX_SIDE) return fileToBase64(file);
  const scale = AVATAR_MAX_SIDE / longest;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('浏览器不支持缩放这张图');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/png');
  return dataUrl.slice(dataUrl.indexOf(',') + 1);
}

/**
 * 取头像并渲染。
 *
 * 不能把地址直接放进 img src：同源图片请求不带 Origin，打包版会把它判成文件来源而要令牌，结果是 403 裂图。
 * 所以带令牌 fetch 成 blob 再挂上去；取不到就留空白，预览失败不该挡住其它字段。
 */
async function loadAvatar(image, assetRoot) {
  try {
    const response = await fetch(avatarSrc(assetRoot), {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'X-DSH-Pet-Token': TOKEN },
    });
    if (!response.ok) return;
    const blob = await response.blob();
    const previous = image.dataset.blobUrl;
    if (previous) URL.revokeObjectURL(previous);
    const url = URL.createObjectURL(blob);
    image.dataset.blobUrl = url;
    image.src = url;
  } catch {
    // 预览失败保持空白。
  }
}

async function uploadAvatar(assetRoot, file, result, image) {
  setStatus(result, '正在上传…');
  try {
    const base64 = await encodeAvatar(file);
    const response = await fetch(API + '/pet-avatar?root=' + encodeURIComponent(assetRoot), {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'X-DSH-Pet-Token': TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64: base64 }),
    });
    if (response.status === 403) throw new Error('打开凭据已失效。请从桌宠菜单重新打开设置。');
    const data = await response.json().catch(() => null);
    if (!data) throw new Error('本机接口没有返回结果，请重试。');
    if (data.ok !== true) throw new Error(data.message || '上传失败');
    // 用自增而不是 Date.now()：同一毫秒内连着传两张时，版本号必须仍然变化。
    avatarVersion += 1;
    await loadAvatar(image, assetRoot);
    setStatus(result, '头像已更新。', 'ok');
  } catch (error) {
    setStatus(result, error && error.message ? error.message : String(error), 'error');
  }
}

function avatarRow(pet) {
  // 条目名就是素材根（/config 的 pets 上没有 assetRoot，那是客户端拍平时补的）。
  const assetRoot = pet.assetRoot || state.entry;
  // pet/ 只归 pet pack：内置条目用包内 logo，只给预览不给上传，与服务端的拒绝保持一致。
  const editable = assetRoot !== 'main';
  const image = make('img', { class: 'avatarImg', alt: '头像' });
  void loadAvatar(image, editable ? assetRoot : '');
  const result = make('p', { class: 'status' });
  const children = [
    make('p', {
      class: 'fieldHint',
      text: editable
        ? '头像按素材根保存，同一素材根的宠物共用一张；支持 PNG / JPEG / WebP / GIF，超过长边 ' + AVATAR_MAX_SIDE + ' 会自动缩小。'
        : '内置条目固定用包里的 logo，不能单独换；要给文件宠物换头像，请切到它所在的条目。',
    }),
  ];
  if (editable) {
    const input = make('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', hidden: true });
    const upload = make('button', { class: 'btn', type: 'button', text: '上传头像' });
    upload.addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      input.value = '';
      if (file) void uploadAvatar(assetRoot, file, result, image);
    });
    children.push(upload, input);
  }
  children.push(result);
  return make('div', { class: 'avatarRow' }, [image, make('div', { class: 'avatarBox' }, children)]);
}
`;
}

//#endregion
//#region src/standalone/settings-page/script/boot.ts
function bootScript() {
	return `
let protocolSelect = null;
let balanceSelect = null;

function mountProtocolSelect() {
  const host = byId('protocol-host');
  if (!host) return;
  protocolSelect = createSelect(
    [
      { value: 'openai-compatible', label: 'OpenAI 兼容' },
      { value: 'anthropic', label: 'Anthropic' },
    ],
    'openai-compatible',
    () => forgetModelOptions(),
  );
  protocolSelect.root.firstElementChild.setAttribute('aria-labelledby', 'protocol-label');
  host.append(protocolSelect.root);
}

function mountBalanceSelect() {
  const host = byId('balance-provider-host');
  if (!host) return;
  balanceSelect = createSelect(
    [
      { value: '', label: '不查询余额' },
      { value: 'deepseek-official', label: 'DeepSeek 官方' },
      { value: 'opencode-go', label: 'opencode Go' },
      { value: 'commandcode', label: 'commandcode' },
    ],
    '',
    (picked) => {
      const button = byId('balance-btn');
      if (button) button.disabled = picked === '';
      const result = byId('balance-result');
      if (result) {
        result.textContent = '';
        result.dataset.ok = '';
        result.dataset.error = '';
      }
    },
  );
  balanceSelect.root.firstElementChild.setAttribute('aria-labelledby', 'balance-provider-label');
  host.append(balanceSelect.root);
}

function selectTab(name) {
  for (const cell of document.querySelectorAll('[data-tab]')) {
    const active = cell.dataset.tab === name;
    cell.setAttribute('aria-selected', active ? 'true' : 'false');
    const panel = byId('panel-' + cell.dataset.tab);
    if (panel) panel.hidden = !active;
    if (active && cell.dataset.title) {
      const title = byId('page-title');
      if (title) title.textContent = cell.dataset.title;
    }
  }
}

function wireTabs() {
  const cells = Array.prototype.slice.call(document.querySelectorAll('.navCell'));
  cells.forEach((cell, index) => {
    cell.addEventListener('click', () => selectTab(cell.dataset.tab));
    cell.addEventListener('keydown', (event) => {
      const forward = event.key === 'ArrowDown' || event.key === 'ArrowRight';
      const backward = event.key === 'ArrowUp' || event.key === 'ArrowLeft';
      if (!forward && !backward) return;
      event.preventDefault();
      const step = forward ? 1 : -1;
      const next = cells[(index + step + cells.length) % cells.length];
      next.focus();
      selectTab(next.dataset.tab);
    });
  });
}

async function loadVoiceCatalog() {
  // 音色与识别实现都是宿主目录：注册了哪些实现，页面就列哪些。
  // 拉不到就回落构建期注入的内置清单，至少内置实现还能选。
  try {
    const body = await callApi('GET', '/voice/voices');
    if (body && Array.isArray(body.providers)) {
      state.voiceOptions = body.providers.flatMap((group) =>
        (group.voices || []).map((voice) => ({
          id: voice.id,
          name: voice.name,
          tag: voice.tag || '',
          provider: group.name,
        })),
      );
    }
  } catch {
    /* 回落内置清单 */
  }
  try {
    const body = await callApi('GET', '/voice/hear-providers');
    if (body && Array.isArray(body.providers)) state.speechProviders = body.providers;
  } catch {
    /* 回落空列表：下拉只显示当前值 */
  }
}

async function loadPets() {
  const status = byId('pet-status');
  setStatus(status, '正在读取本机配置…');
  try {
    const config = await callApi('GET', '/config');
    const meta = await callApi('GET', '/config/meta').catch(() => null);
    if (!config || config.ok === false || !config.main) throw new Error('读取配置失败：宿主没有返回可用的配置。');
    state.meta = meta;
    initDrafts(config);
    renderPetsPanel();
    byId('pet-save').disabled = false;
    setStatus(status, '');
  } catch (error) {
    setStatus(status, (error && error.message) || String(error), 'error');
  }
}

async function loadAi() {
  const status = byId('status');
  try {
    populateAi(await aiRequest('GET'));
    byId('save').disabled = false;
    setStatus(status, '设置只在本机保存。');
  } catch (error) {
    setStatus(status, (error && error.message) || String(error), 'error');
  }
}

function boot() {
  wireTabs();
  selectTab('chat');
  // 刷新后地址栏里的令牌已被清掉，此时靠首次访问换来的 HttpOnly cookie 继续；
  // cookie 也没了的时候，各面板自己的请求会失败并显示重新打开设置的提示。
  mountProtocolSelect();
  mountBalanceSelect();
  wireAiPanel();
  byId('pet-save').addEventListener('click', savePets);
  window.addEventListener('beforeunload', (event) => {
    if (!state.dirty) return;
    event.preventDefault();
    event.returnValue = '';
  });
  // 目录先于配置渲染：voiceCard 要用它决定下拉里有哪些音色与识别实现
  loadVoiceCatalog().then(loadPets);
  loadAi();
}
`;
}

//#endregion
//#region src/standalone/settings-page/script/core.ts
function coreScript(routePath, consts) {
	return `
const TOKEN = new URLSearchParams(location.hash.slice(1)).get('token') || '';
history.replaceState(null, '', location.pathname);
const API = ${JSON.stringify(routePath)};
const VOICES = ${JSON.stringify(consts.voices)};
const DEFAULT_VOICE_ID = ${JSON.stringify(consts.defaultVoice)};
const FONT_IDS = ${JSON.stringify(consts.fonts)};
const DISPLAYS = ${JSON.stringify(consts.displays)};
const CORNERS = ${JSON.stringify(consts.corners)};
const FALLBACK_PHYSICS = ${JSON.stringify(consts.physics)};
const FALLBACK_FONT = ${JSON.stringify(consts.font)};
const FALLBACK_WEIGHTS = ${JSON.stringify(consts.weights)};
const FALLBACK_INTERVAL_SEC = 300;
const state = { config: null, meta: null, globals: null, pets: {}, prompts: {}, entry: 'main', petIndex: 0, dirty: false, voiceOptions: null, speechProviders: null };

function byId(id) {
  return document.getElementById(id);
}

function make(tag, props, kids) {
  const node = document.createElement(tag);
  if (props) {
    for (const key of Object.keys(props)) {
      const value = props[key];
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'value') node.value = value;
      else if (key === 'checked' || key === 'disabled' || key === 'hidden') node[key] = value === true;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
      else node.setAttribute(key, String(value));
    }
  }
  if (kids) {
    for (const kid of kids) {
      if (kid === null || kid === undefined || kid === false) continue;
      node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
  }
  return node;
}

function setStatus(node, text, kind) {
  if (!node) return;
  node.textContent = text;
  node.dataset.error = kind === 'error' ? 'true' : 'false';
  node.dataset.ok = kind === 'ok' ? 'true' : 'false';
}

function markDirty(value) {
  state.dirty = value;
  const badge = byId('dirty');
  if (badge) badge.hidden = !value;
}

async function callApi(method, path, body) {
  const response = await fetch(API + path, {
    method: method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: body
      ? { 'X-DSH-Pet-Token': TOKEN, 'Content-Type': 'application/json' }
      : { 'X-DSH-Pet-Token': TOKEN },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 403) throw new Error('打开凭据已失效，请从桌宠菜单重新打开设置。');
    if (response.status === 429) throw new Error('保存过于频繁，请稍等一分钟再试。');
    throw new Error((data && (data.message || data.error)) || '本机接口暂时无法处理请求');
  }
  return data;
}
`;
}

//#endregion
//#region src/standalone/settings-page/script/globals.ts
function globalsScript() {
	return `
function globalCards() {
  return [globalFlagsCard, voiceCard, fontCard, physicsCard, motionCard, modelCard, environmentCard, advancedCard];
}

function setGlobal(key, value) {
  state.globals[key] = value;
}

function globalFlagsCard() {
  const g = state.globals;
  return card('全局开关', '对所有宠物生效；保存后立即写盘。', [
    toggleRow('g-notify', '系统通知', '对话完成、生成失败、权限申请等事件弹出系统通知。', g.notificationsEnabled, (value) => setGlobal('notificationsEnabled', value)),
    toggleRow('g-notify-focused', '前台聚焦时也提醒', '开着本页、窗口在前台时照样弹通知、照样播报工作状态语音。默认关闭。', g.notifyWhenFocused, (value) => setGlobal('notifyWhenFocused', value)),
    toggleRow('g-click', '点击音效', '点击宠物时播放内置音效。', g.clickSoundEnabled, (value) => setGlobal('clickSoundEnabled', value)),
    toggleRow('g-whisper-image', '碎碎念配图', '碎碎念时允许模型挑一张表情包。', g.whisperImageEnabled, (value) => setGlobal('whisperImageEnabled', value)),
    toggleRow('g-chat-image', '对话配图', '对话时把表情包清单交给模型按语境选图。', g.chatImageEnabled, (value) => setGlobal('chatImageEnabled', value)),
    toggleRow('g-chat-anim', '对话动作联动', '对话时让模型挑一个动作当场表演。', g.chatAnimationEnabled, (value) => setGlobal('chatAnimationEnabled', value)),
    toggleRow('g-confine', '锁定在当前屏幕', '抛掷与自主漫游只在当前所在的这块屏幕里活动。', g.confineToScreen, (value) => setGlobal('confineToScreen', value)),
    toggleRow('g-tray', '系统托盘图标', '桌面模式常驻托盘；关掉后只能从任务栏找回。', g.trayEnabled, (value) => setGlobal('trayEnabled', value)),
  ]);
}

function environmentCard() {
  const g = state.globals;
  const feedback = make('p', { class: 'fieldHint', text: '', hidden: true });
  const show = (text) => {
    feedback.textContent = text;
    feedback.hidden = false;
  };
  const input = make('input', { type: 'text', id: 'g-env-city', value: g.environmentCity || '' });
  input.placeholder = '留空 = 自动定位';
  input.addEventListener('input', () => {
    setGlobal('environmentCity', input.value);
    markDirty(true);
    feedback.hidden = true;
  });
  // 检测走宿主已有的环境查询（不带 pet = 纯查询，不点亮气泡），把 IP 定位结果回填。
  // 必带 fresh=1：不带就会读到 10 分钟内的缓存定位，用户点了检测却拿到旧城市。
  // 必带 ip=1：不带就会把配置里已填的城市原样回显，检测按钮等于没作用。
  // 回填后不自动保存——用户可能还要改，统一走页面底部的保存。
  const detect = button('检测', () => {
    detect.textContent = '检测中…';
    detect.disabled = true;
    callApi('POST', '/environment?fresh=1&ip=1')
      .then((facts) => {
        if (!facts || typeof facts.city !== 'string' || !facts.city) {
          show('宿主没有返回城市（IP 定位失败），请手动填写。');
          return;
        }
        input.value = facts.city;
        setGlobal('environmentCity', facts.city);
        markDirty(true);
        show('已填入：' + facts.city + '（点保存生效）');
      })
      .catch((error) => show('检测失败：' + (error && error.message ? error.message : String(error))))
      .finally(() => {
        detect.textContent = '检测';
        detect.disabled = false;
      });
  });
  return card('环境与定位', '天气查哪座城市。留空 = 按出口 IP 自动定位；填了城市名就按它查。', [
    fieldRow('g-env-city', '城市', make('div', { class: 'row' }, [input, detect]), '填城市名即可，「扬州」和「扬州市」都行。'),
    feedback,
  ]);
}

function voiceCard() {
  const g = state.globals;
  // 运行时目录优先：宿主注册了 Edge / DeepSeek 就都列出来；拉不到回落构建期的内置清单
  const voices = state.voiceOptions && state.voiceOptions.length > 0
    ? state.voiceOptions
    : VOICES.map((voice) => ({ id: voice.id, name: voice.name, tag: voice.tag, provider: voice.provider }));
  const speechProviders = state.speechProviders || [];
  return card('语音', '四类语音各一个开关，互不从属；音色、识别实现与音量共用。', [
    toggleRow('g-voice', '手动播报', '右键菜单与斜杠命令触发的碎碎念、对话回复念出来。', g.voiceEnabled, (value) => setGlobal('voiceEnabled', value)),
    selectField('g-voice-name', '音色', g.voiceName, voices.map((voice) => ({ value: voice.id, label: voice.name + (voice.tag ? ' · ' + voice.tag : ''), group: voice.provider })), (value) => setGlobal('voiceName', value)),
    numberField('g-voice-volume', '音量（0–1）', g.voiceVolume, (value) => setGlobal('voiceVolume', clampNumber(value, 0, 1, 1)), { min: 0, max: 1, step: 0.05 }),
    toggleRow('g-voice-whisper', '周期碎碎念也念出来', '定时生成的那句碎碎念念出来。', g.voiceWhisperEnabled, (value) => setGlobal('voiceWhisperEnabled', value)),
    toggleRow('g-voice-todo', '待办提醒也念出来', '到点的待办提醒念出来。', g.voiceTodoEnabled, (value) => setGlobal('voiceTodoEnabled', value)),
    toggleRow('g-voice-notify', '通知播报', '任务完成、出错、等你确认时念一句配置的工作状态文案；页面被藏起来也照样念。', g.voiceNotifyEnabled, (value) => setGlobal('voiceNotifyEnabled', value)),
    selectField('g-speech-provider', '语音识别', g.speechProvider, speechProviders.map((item) => ({ value: item.id, label: item.name })), (value) => setGlobal('speechProvider', value), '按住录音后交给哪个实现转写。装了对应插件才会出现多个选项；选中的实现不可用时识别会明确报错，不会自动换一个。'),
  ]);
}

function fontCard() {
  const g = state.globals;
  return card('外观与字体', '气泡、悬浮提示与对话窗共用的字体。', [
    selectField('g-font-family', '字体', g.font.family, FONT_IDS.map((id) => ({ value: id, label: id })), (value) => { g.font = Object.assign({}, g.font, { family: value }); }),
    numberField('g-font-size', '字号（px）', g.font.size, (value) => { g.font = Object.assign({}, g.font, { size: clampNumber(value, 4, 200, 21) }); }, { min: 4, max: 200, step: 1, hint: '只影响气泡与悬浮提示，对话窗字号不变。' }),
    toggleRow('g-font-follow', '字号随宠物大小缩放', '关掉后恒为上面的字号，不随窗口尺寸变化。', g.font.followPet, (value) => { g.font = Object.assign({}, g.font, { followPet: value }); }),
  ]);
}

function physicsCard() {
  const g = state.globals;
  return card('拖拽与抛掷手感', '所有宠物共用；数值改动保存后生效。', [
    make('div', { class: 'grid2' }, [
      numberField('g-gravity', '重力加速度（px/s²）', g.physics.gravity, (value) => { g.physics = Object.assign({}, g.physics, { gravity: clampNumber(value, 0, 10000, 1400) }); }, { min: 0, max: 10000, step: 10 }),
      numberField('g-restitution', '碰壁弹性（0–1）', g.physics.restitution, (value) => { g.physics = Object.assign({}, g.physics, { restitution: clampNumber(value, 0, 1, 0.78) }); }, { min: 0, max: 1, step: 0.01 }),
    ]),
    make('div', { class: 'grid2' }, [
      numberField('g-friction', '接触面摩擦（/s）', g.physics.groundFriction, (value) => { g.physics = Object.assign({}, g.physics, { groundFriction: clampNumber(value, 0, 30, 2.5) }); }, { min: 0, max: 30, step: 0.1 }),
      numberField('g-power', '总力度', g.physics.throwPower, (value) => { g.physics = Object.assign({}, g.physics, { throwPower: clampNumber(value, 0.1, 5, 1) }); }, { min: 0.1, max: 5, step: 0.1 }),
    ]),
    toggleRow('g-ceiling', '顶部反弹', '关掉后上方没有边界，抛掷可以飞出屏幕顶部。', g.physics.ceilingBounce !== false, (value) => { g.physics = Object.assign({}, g.physics, { ceilingBounce: value }); }),
    toggleRow('g-collide', '宠物互相碰撞', '飞行中的宠物撞到其它宠物时按动量弹开。', g.physics.petCollision !== false, (value) => { g.physics = Object.assign({}, g.physics, { petCollision: value }); }),
  ]);
}

function motionCard() {
  const g = state.globals;
  const weights = g.animationWeights;
  const actionId = 'g-motion-action';
  const actionValue = () => String(Math.max(0, 100 - weights.idle - weights.turn - weights.move));
  const syncAction = () => {
    const node = byId(actionId);
    if (node) node.value = actionValue();
  };
  const weightField = (key, label) =>
    numberField('g-motion-' + key, label, weights[key], (value) => {
      const others = weights.idle + weights.turn + weights.move - weights[key];
      const max = Math.max(0, 100 - others);
      weights[key] = Math.round(Math.min(Math.max(value, 0), max));
      syncAction();
    }, { min: 0, max: 100, step: 1 });
  return card('动作频率', '四个框：待机 / 转向 / 移动可改，随机动作自动算（= 100 − 其余三项）。所有宠物共用；pet pack 可在自己种类文件里覆盖。', [
    make('div', { class: 'grid2' }, [
      weightField('idle', '待机（%）'),
      weightField('turn', '转向（%）'),
      weightField('move', '移动（%）'),
      numberField(actionId, '随机动作（%，自动）', actionValue(), () => {}, { min: 0, max: 100, step: 1, readOnly: true }),
    ]),
  ]);
}

function modelCard() {
  const g = state.globals;
  return card('对话上下文', '模型与接入方式在「AI 服务商」页配置；这里只管对话保留多少上下文。', [
    make('div', { class: 'grid2' }, [
      numberField('g-memory', '对话记忆轮数', g.chatMemoryRounds, (value) => setGlobal('chatMemoryRounds', Math.round(clampNumber(value, 0, 100, 0))), { min: 0, max: 100, step: 1, hint: '0 表示不带历史。' }),
      numberField('g-image-limit', '配图张数上限', g.chatImageLimit, (value) => setGlobal('chatImageLimit', Math.round(clampNumber(value, 0, 50, 0))), { min: 0, max: 50, step: 1, hint: '0 表示不限制。' }),
    ]),
  ]);
}

function pathRows() {
  const meta = state.meta || {};
  const rows = [];
  const pairs = [['用户配置', meta.user], ['内置默认', meta.default], ['动画配置', meta.animations], ['表情包', meta.memes], ['待办数据', meta.todos], ['日志', meta.logs]];
  for (const pair of pairs) {
    if (!pair[1]) continue;
    rows.push(make('div', { class: 'pathRow' }, [
      make('span', { class: 'pathKey', text: pair[0] }),
      make('span', { class: 'pathValue', text: String(pair[1]), title: String(pair[1]) }),
    ]));
  }
  if (Array.isArray(meta.storage)) {
    for (const item of meta.storage) {
      if (!item || !item.path) continue;
      rows.push(make('div', { class: 'pathRow' }, [
        make('span', { class: 'pathKey', text: item.exists === false ? '未生成' : '已存在' }),
        make('span', { class: 'pathValue', text: String(item.path), title: String(item.path) }),
      ]));
    }
  }
  return rows.length ? rows : [make('p', { class: 'empty', text: '读不到落盘位置信息。' })];
}

function advancedCard() {
  return card('高级', '手改配置文件时可以从这里找到位置；「同步」会用内置默认覆盖用户配置。', [
    make('div', {}, pathRows()),
    make('div', { class: 'testRow' }, [button('用内置默认覆盖用户配置', syncFromDefault)]),
  ]);
}

async function syncFromDefault() {
  const confirmed = await confirmDialog({
    title: '用内置默认覆盖用户配置',
    text: '现有的用户配置会被整份替换，这个操作不能撤销。',
    confirmLabel: '覆盖',
    danger: true,
  });
  if (!confirmed) return;
  const status = byId('pet-status');
  setStatus(status, '正在同步…');
  try {
    const merged = await callApi('POST', '/config');
    initDrafts(merged);
    markDirty(false);
    renderPetsPanel();
    setStatus(status, '已用内置默认覆盖用户配置。', 'ok');
  } catch (error) {
    setStatus(status, error && error.message ? error.message : String(error), 'error');
  }
}
`;
}

//#endregion
//#region src/standalone/settings-page/script/model-picker.ts
function modelPickerScript() {
	return `
const AI_MODELS_URL = '/standalone-ai/models';

/** 上一次拉到的候选；null 表示还没拉过，需要先请求。 */
let modelOptions = null;

function modelLabel(model) {
  return model.name && model.name !== model.id ? model.name + '（' + model.id + '）' : model.id;
}

function openModelMenu(trigger) {
  if (!modelOptions) return;
  openSelectMenu(
    trigger,
    modelOptions,
    byId('model').value.trim(),
    (picked) => {
      byId('model').value = picked;
      markDirty(true);
      setStatus(byId('model-result'), '已填入模型名称，记得保存。', 'ok');
    },
    byId('model-combo'),
  );
}

function forgetModelOptions() {
  modelOptions = null;
  setStatus(byId('model-result'), '');
}

async function fetchModelOptions(trigger) {
  const result = byId('model-result');
  trigger.disabled = true;
  setStatus(result, '正在向端点请求模型列表…');
  try {
    const response = await fetch(AI_MODELS_URL, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'X-DSH-Pet-Token': TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        protocol: protocolSelect ? protocolSelect.getValue() : 'openai-compatible',
        baseUrl: byId('baseUrl').value.trim(),
        apiKey: byId('apiKey').value,
      }),
    });
    if (response.status === 403) throw new Error('打开凭据已失效。请从桌宠菜单重新打开设置。');
    const data = await response.json().catch(() => null);
    if (!data) throw new Error('本机接口没有返回结果，请重试。');
    if (!data.ok) throw new Error(data.message || '拉取失败');
    const models = data.models || [];
    if (!models.length) {
      setStatus(result, '端点没有返回任何模型，请手动填写。', 'error');
      return;
    }
    modelOptions = models.map((model) => ({ value: model.id, label: modelLabel(model) }));
    setStatus(result, '已拉取 ' + models.length + ' 个模型，选中即可填入。', 'ok');
    openModelMenu(trigger);
  } catch (error) {
    setStatus(result, error && error.message ? error.message : String(error), 'error');
  } finally {
    trigger.disabled = false;
  }
}

function wireModelPicker() {
  const toggle = byId('model-toggle');
  if (!toggle) return;
  toggle.append(chevron());
  toggle.addEventListener('click', () => {
    if (modelOptions) openModelMenu(toggle);
    else void fetchModelOptions(toggle);
  });
  byId('baseUrl').addEventListener('input', forgetModelOptions);
}
`;
}

//#endregion
//#region src/standalone/settings-page/script/overlay.ts
function overlayScript() {
	return `
let openMenu = null;

function closeMenu() {
  if (!openMenu) return;
  const dispose = openMenu;
  openMenu = null;
  dispose();
}

function chevron() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('class', 'selectChevron');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M4 6.5 8 10.5 12 6.5');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.4');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}

function placeMenu(menu, trigger, widthOf) {
  const rect = trigger.getBoundingClientRect();
  const span = widthOf ? widthOf.getBoundingClientRect() : rect;
  const below = window.innerHeight - rect.bottom;
  const height = Math.min(260, Math.max(120, below > 200 ? below - 16 : rect.top - 16));
  menu.style.left = Math.round(span.left) + 'px';
  menu.style.width = Math.round(span.width) + 'px';
  menu.style.maxHeight = Math.round(height) + 'px';
  if (below > 200 || rect.top < 220) menu.style.top = Math.round(rect.bottom + 4) + 'px';
  else menu.style.top = Math.round(rect.top - height - 4) + 'px';
}

/**
 * 打开一个下拉菜单。
 * @param trigger - 触发按钮，用来定位、判断「点外面」与标记展开状态。
 * @param options - 候选项，每项 { value, label }。
 * @param current - 当前值。
 * @param onPick - 选中回调。
 * @param widthOf - 菜单对齐宽度的参照元素；缺省与 trigger 同宽，用于触发按钮比菜单窄的组合框。
 */
function openSelectMenu(trigger, options, current, onPick, widthOf) {
  closeMenu();
  const menu = make('ul', { class: 'selectMenu' });
  menu.setAttribute('role', 'listbox');
  const items = [];
  // 分组标题只是分隔行：不进 items，键盘索引与高亮完全不受影响
  let prevGroup = null;
  for (const option of options) {
    if (option.group && option.group !== prevGroup) {
      const title = make('li', { class: 'selectGroup', text: option.group });
      title.setAttribute('role', 'presentation');
      menu.append(title);
      prevGroup = option.group;
    }
    const item = make('li', { class: 'selectItem', text: option.label });
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', option.value === current ? 'true' : 'false');
    item.addEventListener('click', () => pick(option.value));
    menu.append(item);
    items.push({ node: item, value: option.value });
  }
  document.body.append(menu);
  placeMenu(menu, trigger, widthOf);
  trigger.setAttribute('aria-expanded', 'true');
  let active = Math.max(0, options.findIndex((option) => option.value === current));
  highlight(active);

  function highlight(index) {
    active = (index + items.length) % items.length;
    items.forEach((entry, position) => {
      const on = position === active;
      entry.node.classList.toggle('active', on);
      if (on) entry.node.scrollIntoView({ block: 'nearest' });
    });
  }

  function pick(value) {
    dispose();
    onPick(value);
  }

  function onKey(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      dispose();
      trigger.focus();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      highlight(active + (event.key === 'ArrowDown' ? 1 : -1));
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      pick(items[active].value);
      trigger.focus();
    } else if (event.key === 'Tab') {
      dispose();
    }
  }

  function onPointer(event) {
    if (menu.contains(event.target) || trigger.contains(event.target)) return;
    dispose();
  }

  function onReflow() {
    placeMenu(menu, trigger, widthOf);
  }

  function dispose() {
    if (!menu.isConnected) return;
    menu.remove();
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('pointerdown', onPointer, true);
    window.removeEventListener('scroll', onReflow, true);
    window.removeEventListener('resize', onReflow);
    if (openMenu === dispose) openMenu = null;
  }

  document.addEventListener('keydown', onKey, true);
  document.addEventListener('pointerdown', onPointer, true);
  window.addEventListener('scroll', onReflow, true);
  window.addEventListener('resize', onReflow);
  openMenu = dispose;
}

/**
 * 造一个下拉选择器。
 * @param options - 候选项，每项 { value, label }。
 * @param value - 初始值。
 * @param onChange - 用户选择后回调。
 * @returns 根节点与读写当前值的方法。
 */
function createSelect(options, value, onChange) {
  const root = make('div', { class: 'select' });
  const trigger = make('button', { type: 'button', class: 'selectTrigger' });
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  const label = make('span', { class: 'selectValue' });
  trigger.append(label, chevron());
  root.append(trigger);
  let current = value;

  function paint() {
    const hit = options.find((option) => option.value === current);
    label.textContent = hit ? hit.label : current;
    trigger.disabled = options.length <= 1;
  }

  trigger.addEventListener('click', () => {
    if (openMenu) {
      closeMenu();
      return;
    }
    openSelectMenu(trigger, options, current, (picked) => {
      current = picked;
      paint();
      onChange(picked);
    });
  });

  paint();
  return {
    root: root,
    getValue: () => current,
    setValue: (next) => {
      current = next;
      paint();
    },
    redraw: paint,
  };
}

/**
 * 弹出确认框。
 * @param options - 标题、正文、按钮文案与是否危险操作。
 * @returns 用户确认时为 true。
 */
function confirmDialog(options) {
  const config = options || {};
  return new Promise((resolve) => {
    const mask = make('div', { class: 'dialogMask' });
    const panel = make('div', { class: 'dialog' });
    panel.setAttribute('role', 'alertdialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', config.title || '确认');
    const text = make('p', { class: 'dialogText', text: config.text || '' });
    // cancelLabel 传 null 表示只提示、不给取消：用于「不能删除最后一只」这类纯说明。
    const cancel =
      config.cancelLabel === null
        ? null
        : make('button', { type: 'button', class: 'btn', text: config.cancelLabel || '取消' });
    const confirm = make('button', {
      type: 'button',
      class: 'btn ' + (config.danger ? 'danger' : 'primary'),
      text: config.confirmLabel || '确定',
    });
    const actions = make('div', { class: 'dialogActions' }, cancel ? [cancel, confirm] : [confirm]);
    panel.append(make('h2', { class: 'dialogTitle', text: config.title || '确认' }), text, actions);
    mask.append(panel);
    document.body.append(mask);

    function close(result) {
      document.removeEventListener('keydown', onKey, true);
      mask.remove();
      resolve(result);
    }

    function onKey(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close(false);
        return;
      }
      if (event.key !== 'Tab' || !cancel) return;
      event.preventDefault();
      (document.activeElement === confirm ? cancel : confirm).focus();
    }

    if (cancel) cancel.addEventListener('click', () => close(false));
    confirm.addEventListener('click', () => close(true));
    mask.addEventListener('pointerdown', (event) => {
      if (event.target === mask) close(false);
    });
    document.addEventListener('keydown', onKey, true);
    confirm.focus();
  });
}
`;
}

//#endregion
//#region src/standalone/settings-page/script/pet-card.ts
function petCardScript() {
	return `
function petBar() {
  const list = currentPets();
  const options = list.map((pet, index) => ({ value: String(index), label: (pet.name || pet.id) + '（' + pet.id + '）' }));
  const picker = createSelect(options, String(state.petIndex), (value) => {
    state.petIndex = Number(value);
    renderPetsPanel();
  });
  picker.root.id = 'pet-picker';
  picker.root.firstElementChild.setAttribute('aria-label', '选择宠物');
  return make('div', { class: 'petBar' }, [
    picker.root,
    button('新增', addPet),
    button('删除', removePet, { danger: true }),
  ]);
}

function addPet() {
  const list = currentPets();
  let index = list.length + 1;
  let id = (state.entry === 'main' ? 'pet-' : '') + index;
  while (list.some((pet) => pet.id === id)) {
    index += 1;
    id = (state.entry === 'main' ? 'pet-' : '') + index;
  }
  list.push({
    id: id,
    name: '新宠物',
    size: 462,
    display: 'none',
    balanceEnabled: true,
    whisperEnabled: true,
    workStatusEnabled: true,
    fixedEnabled: false,
    position: { corner: 'bottom-right', marginX: 40, marginY: 40 },
  });
  state.petIndex = list.length - 1;
  markDirty(true);
  renderPetsPanel();
}

async function removePet() {
  const list = currentPets();
  const pet = list[state.petIndex];
  if (!pet) return;
  if (list.length <= 1) {
    await confirmDialog({
      title: '不能删除最后一只',
      text:
        state.entry === 'main'
          ? '默认条目至少要留一只宠物：删到 0 会被宿主按非法拒绝，重开时还会退回内置的默认列表。'
          : '每个条目至少要留一只宠物：删到 0 会被宿主按非法拒绝。',
      confirmLabel: '知道了',
      cancelLabel: null,
    });
    return;
  }
  const confirmed = await confirmDialog({
    title: '删除宠物',
    text: '删除「' + (pet.name || pet.id) + '」？点保存后才会写盘。',
    confirmLabel: '删除',
    danger: true,
  });
  if (!confirmed) return;
  list.splice(state.petIndex, 1);
  state.petIndex = Math.max(0, Math.min(state.petIndex, list.length - 1));
  markDirty(true);
  renderPetsPanel();
}

function petCard() {
  const list = currentPets();
  const pet = list[state.petIndex];
  if (!pet) {
    return card('宠物', null, [
      make('p', { class: 'empty', text: '这个条目下还没有实例，点「新增」加一只。' }),
      make('div', { class: 'testRow' }, [button('新增', addPet)]),
    ]);
  }
  if (!pet.position) pet.position = { corner: 'bottom-right', marginX: 40, marginY: 40 };
  const sizePercent = typeof pet.sizePercent === 'number' ? String(pet.sizePercent) : '';
  const children = [
    petBar(),
    avatarRow(pet),
    textField('pet-name', '显示名', pet.name || '', (value) => { pet.name = value; }),
    textField('pet-id', '标识（id）', pet.id, (value) => { pet.id = value.trim(); }, { disabled: true, hint: '标识决定素材目录与记忆文件，建好之后不能在这里改。' }),
    make('div', { class: 'grid2' }, [
      numberField('pet-size', '画框大小（px）', pet.size, (value) => { pet.size = value; }, { min: 1, step: 1 }),
      textField('pet-size-percent', '占屏宽度（%）', sizePercent, (value) => {
        if (value.trim() === '') delete pet.sizePercent;
        else pet.sizePercent = Number(value);
      }, { hint: '留空表示按 px 显示。' }),
    ]),
    selectField('pet-display', '显示位置', pet.display, DISPLAYS.map((value) => ({ value: value, label: displayLabel(value) })), (value) => { pet.display = value; }, 'web=仅浏览器 / desktop=仅桌面 / both=两者都显示 / none=都不显示'),
    make('div', { class: 'grid2' }, [
      selectField('pet-corner', '停靠角落', pet.position.corner, CORNERS.map((value) => ({ value: value, label: cornerLabel(value) })), (value) => { pet.position.corner = value; }),
      numberField('pet-margin-x', '水平边距（px）', pet.position.marginX, (value) => { pet.position.marginX = value; }, { step: 1 }),
    ]),
    numberField('pet-margin-y', '垂直边距（px）', pet.position.marginY, (value) => { pet.position.marginY = value; }, { step: 1 }),
    toggleRow('pet-balance', '余额功能', '开启后这只宠物会在余额变化时播动画并显示气泡。', pet.balanceEnabled !== false, (value) => { pet.balanceEnabled = value; }),
    toggleRow('pet-whisper', '碎碎念', '按周期让模型生成一句话并播放；不需要就关掉，省调用额度。', pet.whisperEnabled !== false, (value) => { pet.whisperEnabled = value; }),
    toggleRow('pet-work', '工作状态联动', '跟随会话状态切换动画与气泡，不调用模型。', pet.workStatusEnabled !== false, (value) => { pet.workStatusEnabled = value; }),
    toggleRow('pet-fixed', '固定不动', '开启后随机链不再抽转向与移动；手动点播与拖拽照常。', pet.fixedEnabled === true, (value) => { pet.fixedEnabled = value; }),
    make('div', { class: 'field' }, [
      make('label', { for: 'pet-persona', text: '这只的人设（可选）' }),
      personaWrap(pet),
      make('p', { class: 'fieldHint', text: personaHint() }),
      make('p', { class: 'fieldHint', text: '发给模型的 system = 这段 + 自动追加的名字与时间背景，别在这里重复写。' }),
    ]),
  ];
  return card('宠物', '这里编辑的是 ' + (state.entry === 'main' ? '默认条目' : state.entry) + ' 的实例；改动在点保存后写盘。', children);
}

/** 条目人设提示：占位符里放的就是条目人设正文，这里只说规则。 */
function personaHint() {
  if (state.prompts[state.entry]) return '留空 = 跟随所属条目的人设，输入框里的灰色文字就是那份内容。';
  return '这个条目还没写人设；留空表示这只宠物没有系统提示词。';
}

/** 人设输入框连同右下角的字数统计；占位符用条目人设全文。 */
function personaWrap(pet) {
  const wrap = make('div', { class: 'personaWrap' });
  const area = make('textarea', { id: 'pet-persona' });
  area.value = typeof pet.whisperPrompt === 'string' ? pet.whisperPrompt : '';
  area.maxLength = 4000;
  area.rows = 4;
  const entryPrompt = state.prompts[state.entry] || '';
  area.placeholder = entryPrompt || '留空则没有系统提示词';
  const count = make('span', { class: 'personaCount', text: area.value.length + ' 字' });
  area.addEventListener('input', () => {
    const text = area.value.trim();
    if (text) pet.whisperPrompt = area.value;
    else delete pet.whisperPrompt;
    count.textContent = area.value.length + ' 字';
    markDirty(true);
  });
  wrap.append(area, count);
  return wrap;
}
`;
}

//#endregion
//#region src/standalone/settings-page/script/pets.ts
function petsScript() {
	return `
function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

/** 原配置里的 physics 段，用来判断哪些可选键「本来就有」。 */
let physicsSource = null;

/** 动作频率权重：缺字段或非法项回落到内置默认，三项各自独立判定。 */
function pickWeights(raw) {
  const base = Object.assign({}, FALLBACK_WEIGHTS);
  if (!raw || typeof raw !== 'object') return base;
  for (const key of ['idle', 'turn', 'move']) {
    const value = Number(raw[key]);
    if (Number.isFinite(value) && value >= 0) base[key] = value;
  }
  return base;
}

function pickGlobals(main) {
  const source = main || {};
  const physics = source.physics && typeof source.physics === 'object' ? source.physics : null;
  physicsSource = physics;
  return {
    notificationsEnabled: source.notificationsEnabled !== false,
    // 与 voiceNotifyEnabled 同理：本项默认关，字段缺失时不能显示成已勾选，
    // 否则设置页显示「开」而消费端拿到 undefined 当成「关」，两边打架。
    notifyWhenFocused: source.notifyWhenFocused === true,
    clickSoundEnabled: source.clickSoundEnabled !== false,
    whisperImageEnabled: source.whisperImageEnabled === true,
    chatImageEnabled: source.chatImageEnabled === true,
    chatAnimationEnabled: source.chatAnimationEnabled === true,
    confineToScreen: source.confineToScreen === true,
    trayEnabled: source.trayEnabled !== false,
    voiceEnabled: source.voiceEnabled === true,
    voiceName: typeof source.voiceName === 'string' && source.voiceName ? source.voiceName : DEFAULT_VOICE_ID,
    // 识别实现：独立模式只有内置几家，缺值时留空——空值不提交，服务端保留原值
    speechProvider: typeof source.speechProvider === 'string' ? source.speechProvider : '',
    // 天气城市覆盖：空串是有效值（= 跟随 IP 自动定位），与上面 speechProvider 的空值语义不同，照常提交
    environmentCity: typeof source.environmentCity === 'string' ? source.environmentCity : '',
    voiceVolume: typeof source.voiceVolume === 'number' ? source.voiceVolume : 1,
    voiceWhisperEnabled: source.voiceWhisperEnabled !== false,
    voiceTodoEnabled: source.voiceTodoEnabled !== false,
    // 与 voiceTodo/voiceWhisper 的 !== false 写法不同：本项默认关，字段缺失时不能显示成已勾选，
    // 否则设置页显示「开」而播放端拿到 undefined 当成「关」，两边打架。
    voiceNotifyEnabled: source.voiceNotifyEnabled === true,
    physics: Object.assign({}, FALLBACK_PHYSICS, source.physics || {}),
    font: Object.assign({}, FALLBACK_FONT, source.font || {}),
    chatMemoryRounds: Number.isFinite(Number(source.chatMemoryRounds)) ? Number(source.chatMemoryRounds) : 0,
    chatImageLimit: Number.isFinite(Number(source.chatImageLimit)) ? Number(source.chatImageLimit) : 0,
    animationWeights: pickWeights(source.animationWeights),
  };
}

function initDrafts(config) {
  state.config = config;
  state.globals = pickGlobals(config.main);
  state.pets = {};
  state.prompts = {};
  for (const key of Object.keys(config)) {
    const conf = config[key];
    if (!conf || !Array.isArray(conf.pets)) continue;
    state.pets[key] = cloneJson(conf.pets);
    if (typeof conf.whisperPrompt === 'string') state.prompts[key] = conf.whisperPrompt;
  }
  if (!state.pets.main) state.pets.main = [];
  if (!state.pets[state.entry]) state.entry = 'main';
}

function currentPets() {
  return state.pets[state.entry] || [];
}

function currentPet() {
  return currentPets()[state.petIndex];
}

function entryTabs(keys) {
  const tabs = keys.map((key) => tabButton(key === 'main' ? '默认条目' : key, key === state.entry, () => {
    state.entry = key;
    state.petIndex = 0;
    renderPetsPanel();
  }));
  return make('div', { class: 'tabs' }, tabs);
}

function packNote() {
  return card('条目说明', null, [
    make('p', { class: 'cardHint', text: '这个条目来自文件宠物，只保存它自己的实例；全局开关与语音外观在「默认条目」里改。' }),
  ]);
}

function renderPetsPanel() {
  const host = byId('pet-cards');
  if (!host) return;
  host.textContent = '';
  const keys = Object.keys(state.pets);
  if (keys.length > 1) host.append(entryTabs(keys));
  host.append(petCard());
  if (state.entry === 'main') {
    for (const builder of globalCards()) host.append(builder());
  } else {
    host.append(packNote());
  }
}

/** 提交用的 physics 段：原配置没写过的可选键不带出去，避免保存时凭空补键。 */
function physicsBody() {
  const out = Object.assign({}, state.globals.physics);
  for (const key of ['tiltGravity', 'shakeThrow', 'hapticEnabled']) {
    if (!physicsSource || !(key in physicsSource)) delete out[key];
  }
  return out;
}

function petsBody() {
  return Object.assign({ pets: state.pets.main }, {
    notificationsEnabled: state.globals.notificationsEnabled,
    notifyWhenFocused: state.globals.notifyWhenFocused,
    clickSoundEnabled: state.globals.clickSoundEnabled,
    whisperImageEnabled: state.globals.whisperImageEnabled,
    chatImageEnabled: state.globals.chatImageEnabled,
    chatAnimationEnabled: state.globals.chatAnimationEnabled,
    confineToScreen: state.globals.confineToScreen,
    trayEnabled: state.globals.trayEnabled,
    voiceEnabled: state.globals.voiceEnabled,
    voiceName: state.globals.voiceName,
    voiceVolume: state.globals.voiceVolume,
    voiceWhisperEnabled: state.globals.voiceWhisperEnabled,
    voiceTodoEnabled: state.globals.voiceTodoEnabled,
    voiceNotifyEnabled: state.globals.voiceNotifyEnabled,
    // 空串 = 还没读到成品值：不提交，免得用一个本地猜的实现覆盖配置
    ...(state.globals.speechProvider ? { speechProvider: state.globals.speechProvider } : {}),
    // 城市覆盖与上面不同：空串是有效值（= 恢复自动定位），必须照常提交
    environmentCity: state.globals.environmentCity || '',
    physics: physicsBody(),
    font: state.globals.font,
    chatMemoryRounds: state.globals.chatMemoryRounds,
    chatImageLimit: state.globals.chatImageLimit,
    animationWeights: state.globals.animationWeights,
  });
}

async function savePets() {
  const status = byId('pet-status');
  const saveBtn = byId('pet-save');
  if (state.entry === 'main' && currentPets().length === 0) {
    setStatus(status, '默认条目至少要保留一只宠物，否则宿主会拒绝保存。', 'error');
    return;
  }
  saveBtn.disabled = true;
  setStatus(status, '正在保存…');
  try {
    let merged;
    if (state.entry === 'main') {
      merged = await callApi('PUT', '/config', petsBody());
      if (merged && merged.ok === false && merged.reason === 'user-config-unparsable') {
        const file = merged.userFile ? String(merged.userFile) : '用户配置';
        const confirmed = await confirmDialog({
          title: '配置文件无法解析',
          text: file + '\\n继续保存会按白名单重建这个文件，里面其它内容会丢失。',
          confirmLabel: '覆盖保存',
          danger: true,
        });
        if (!confirmed) {
          setStatus(status, '已取消保存。', 'error');
          return;
        }
        merged = await callApi('PUT', '/config?force=1', petsBody());
      }
    } else {
      merged = await callApi('POST', '/pet-config', { entry: state.entry, pets: currentPets() });
    }
    if (!merged || merged.ok === false) {
      setStatus(status, (merged && (merged.message || merged.reason)) || '宿主拒绝了这次保存。', 'error');
      return;
    }
    initDrafts(merged);
    markDirty(false);
    renderPetsPanel();
    setStatus(status, '已保存到本机。', 'ok');
  } catch (error) {
    setStatus(status, error && error.message ? error.message : String(error), 'error');
  } finally {
    saveBtn.disabled = false;
  }
}
`;
}

//#endregion
//#region src/standalone/settings-page/script/widgets.ts
function widgetsScript() {
	return `
function fieldRow(id, label, control, hint) {
  return make('div', { class: 'field' }, [
    make('label', { for: id, text: label }),
    control,
    hint ? make('p', { class: 'fieldHint', text: hint }) : null,
  ]);
}

function textField(id, label, value, onChange, opts) {
  const input = make('input', { type: 'text', id: id, value: value });
  if (opts && opts.maxLength) input.maxLength = opts.maxLength;
  if (opts && opts.disabled) input.disabled = true;
  if (opts && opts.placeholder) input.placeholder = opts.placeholder;
  input.addEventListener('input', () => {
    onChange(input.value);
    markDirty(true);
  });
  return fieldRow(id, label, input, opts && opts.hint);
}

function numberField(id, label, value, onChange, opts) {
  const input = make('input', { type: 'number', id: id, value: String(value) });
  if (opts) {
    if (opts.min !== undefined) input.min = String(opts.min);
    if (opts.max !== undefined) input.max = String(opts.max);
    if (opts.step !== undefined) input.step = String(opts.step);
    if (opts.disabled) input.disabled = true;
    if (opts.readOnly) {
      input.readOnly = true;
      input.tabIndex = -1;
    }
  }
  input.addEventListener('input', () => {
    const parsed = Number(input.value);
    if (input.value === '' || !Number.isFinite(parsed)) return;
    onChange(parsed);
    markDirty(true);
  });
  return fieldRow(id, label, input, opts && opts.hint);
}

function selectField(id, label, value, options, onChange, hint) {
  const select = createSelect(options, value, (picked) => {
    onChange(picked);
    markDirty(true);
  });
  select.root.id = id;
  const labelId = id + '-label';
  select.root.firstElementChild.setAttribute('aria-labelledby', labelId);
  return make('div', { class: 'field' }, [
    make('span', { class: 'fieldLabel', id: labelId, text: label }),
    select.root,
    hint ? make('p', { class: 'fieldHint', text: hint }) : null,
  ]);
}

function toggleRow(id, title, hint, checked, onChange) {
  const box = make('input', { type: 'checkbox', id: id, checked: checked });
  box.addEventListener('change', () => {
    onChange(box.checked);
    markDirty(true);
  });
  return make('label', { class: 'rowCheck' }, [
    box,
    make('span', { class: 'rowCheckText' }, [
      make('span', { class: 'rowCheckTitle', text: title }),
      hint ? make('span', { class: 'rowCheckHint', text: hint }) : null,
    ]),
  ]);
}

function card(title, hint, kids) {
  return make('div', { class: 'card' }, [
    make('div', { class: 'cardHead' }, [make('h2', { class: 'cardTitle', text: title })]),
    hint ? make('p', { class: 'cardHint', text: hint }) : null,
  ].concat(kids || []));
}

function button(text, onClick, opts) {
  const node = make('button', { type: 'button', class: opts && opts.danger ? 'btn ghost' : 'btn', text: text });
  node.addEventListener('click', onClick);
  return node;
}

function tabButton(text, selected, onClick) {
  const node = make('button', { type: 'button', class: 'tab', text: text });
  node.setAttribute('role', 'tab');
  node.setAttribute('aria-selected', selected ? 'true' : 'false');
  node.addEventListener('click', onClick);
  return node;
}

function cornerLabel(corner) {
  if (corner === 'top-left') return '左上角';
  if (corner === 'top-right') return '右上角';
  if (corner === 'bottom-left') return '左下角';
  return '右下角';
}

function displayLabel(display) {
  if (display === 'web') return '仅浏览器';
  if (display === 'desktop') return '仅桌面';
  if (display === 'both') return '两者都显示';
  return '都不显示';
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
`;
}

//#endregion
//#region src/standalone/settings-page/chrome.ts
const settingsPage = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><base href="/"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>桌宠设置</title><link rel="icon" type="image/png" href="/standalone-ai/icon.png"><link rel="stylesheet" href="/standalone-ai/settings.css">
<script src="/standalone-ai/settings.js" defer></script><script src="/standalone-ai/chat-panel.js" defer></script></head><body>
<main class="shell">
<aside class="side">
<div class="brand"><img class="brandLogo" src="/standalone-ai/icon.png" alt=""><span>桌宠</span></div>
<nav class="nav" aria-label="设置分区"><div class="navList" role="tablist">
<button type="button" class="navCell" role="tab" id="tab-chat" data-tab="chat" data-title="对话" aria-controls="panel-chat" aria-selected="true"><svg class="navGlyph" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3.4h10a1.1 1.1 0 0 1 1.1 1.1v5.6A1.1 1.1 0 0 1 13 11.2H8.2L5 13.6v-2.4H3a1.1 1.1 0 0 1-1.1-1.1V4.5A1.1 1.1 0 0 1 3 3.4Z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg><span class="navLabel">对话</span></button>
<button type="button" class="navCell" role="tab" id="tab-config" data-tab="config" data-title="配置" aria-controls="panel-config" aria-selected="false"><svg class="navGlyph" viewBox="0 0 16 16" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"><path d="M2.6 4.6h10.8M2.6 11.4h10.8"/><circle cx="6.2" cy="4.6" r="1.6" fill="currentColor" stroke="none"/><circle cx="9.8" cy="11.4" r="1.6" fill="currentColor" stroke="none"/></g></svg><span class="navLabel">配置</span></button>
</div></nav>
<div class="sideFoot">独立模式</div>
</aside>
<div class="main">
<div class="topbar"><h1 class="pageTitle" id="page-title">对话</h1><span class="dirty" id="dirty" hidden>有未保存的改动</span></div>
<div class="options">
<section class="panel" id="panel-config" role="tabpanel" aria-labelledby="tab-config" hidden>
<div class="scroll">
<div id="pet-cards"><p class="empty">正在读取本机配置…</p></div>
<div class="footer"><p class="status" id="pet-status" role="status" aria-live="polite"></p><button class="btn primary" id="pet-save" type="button" disabled>保存</button></div>
<form id="settings" aria-describedby="privacy">
<div class="card"><div class="cardHead"><h2 class="cardTitle">模型连接</h2></div>
<p class="cardHint">独立模式自己连服务商，不经过 DSH；所有配置只保存在当前机器。</p>
<div class="field"><span class="fieldLabel" id="protocol-label">接口协议</span><div id="protocol-host"></div></div>
<div class="field"><label for="baseUrl">接口地址（Base URL）</label><input id="baseUrl" name="baseUrl" type="url" placeholder="https://example.com/v1" maxlength="2048" spellcheck="false" aria-describedby="endpoint-note"><p class="fieldHint" id="endpoint-note">服务商提供的基础接口地址，支持 HTTP 与 HTTPS，通常以 /v1 结尾。不要把密钥放进地址。</p></div>
<div class="field"><label for="model">模型名称</label><div class="combo" id="model-combo"><input id="model" name="model" type="text" maxlength="200" placeholder="填写或拉取服务商的模型 ID，例如 deepseek-chat" spellcheck="false" aria-describedby="model-note"><button id="model-toggle" class="comboToggle" type="button" aria-label="拉取并选择模型" aria-haspopup="listbox" aria-expanded="false"></button></div><p class="fieldHint" id="model-note">可以直接手填；点右侧箭头向端点拉取可用列表后选择。拉取只用本次填写的地址与密钥，不会保存。</p><p class="status" id="model-result" role="status" aria-live="polite"></p></div>
<div class="field"><label for="apiKey">API 密钥 <span class="hintInline" id="key-state">尚未读取</span></label><input id="apiKey" name="apiKey" type="password" autocomplete="new-password" maxlength="8192" placeholder="留空保留已保存的密钥" aria-describedby="key-note"><div class="keyActions" id="key-actions" hidden><button id="key-delete" class="btn ghost" type="button">删除已保存的密钥</button></div><p id="key-note" class="fieldHint">密钥只写入本机配置，不会回显。留空会保留旧密钥，要彻底删除请点上面的按钮。</p></div>
<div class="field"><label for="deepseekApiKey">DeepSeek 语音密钥 <span class="hintInline" id="deepseek-key-state">尚未读取</span></label><input id="deepseekApiKey" name="deepseekApiKey" type="password" autocomplete="new-password" maxlength="4096" placeholder="留空保留已保存的密钥" aria-describedby="deepseek-key-note"><div class="keyActions" id="deepseek-key-actions" hidden><button id="deepseek-key-delete" class="btn ghost" type="button">删除已保存的语音密钥</button></div><p id="deepseek-key-note" class="fieldHint">只给 DeepSeek 语音合成与识别用，和上面的对话密钥分开存——对话走别家服务商时也能单独用 DeepSeek 语音。留空则依次沿用「余额选 DeepSeek 时的那把密钥」。</p></div>
<div class="field"><span class="fieldLabel" id="balance-provider-label">余额查询服务商</span><div id="balance-provider-host"></div><p class="fieldHint" id="balance-provider-note">可选：选定后可用上面保存的密钥查询余额，不选则不查询。余额接口只有 DeepSeek 官方、opencode Go 与 commandcode 提供，且密钥必须属于所选服务商。</p><div class="testRow"><button id="balance-btn" class="btn ghost" type="button" disabled>查询余额</button><span id="balance-result" class="status" role="status" aria-live="polite"></span></div></div>
<div class="testRow"><button id="test-btn" class="btn" type="button">测试连接</button><span id="test-result" class="status" role="status" aria-live="polite"></span></div>
</div>
<p id="privacy" class="fineprint">所有配置与密钥仅保存在当前机器。</p>
<div class="footer"><p class="status" id="status" role="status" aria-live="polite">正在读取本机设置…</p><button id="save" class="btn primary" type="submit" disabled>保存</button></div>
</form>
</div>
</section>
<section class="panel" id="panel-chat" role="tabpanel" aria-labelledby="tab-chat">
<div class="pet-chat-host" id="pet-chat-root"></div>
</section>
</div>
</div>
</main>
<noscript>需要启用 JavaScript 才能保存设置。请从桌宠右键菜单打开本页。</noscript>
</body></html>`;

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

/* 人设卷帘：展开时把消息列表顶下去，而不是浮在对话上——人设可以很长，浮层会挡住内容。
   0fr → 1fr 是唯一不用量高度的展开过渡；夹层负责裁剪，正文层才放内边距与边框，
   否则收起时 padding 与 border 仍在，留下一道缝。 */
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
  /* 人设正文自己带换行与缩进：保留排版，长单词与 URL 也要能断开 */
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

/* 指南页卡片图标：框架给的槽位只按图标尺寸排版，所以让 logo 铺满它 */
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

/* 线本身用伪元素画，文字居中：视觉上是「一条带说明的分隔线」 */
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

/* 多选模式：整轮是一张可点卡片；选中给浅底，未选中透明（与豆包的选中样式一致） */
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

/* 时间右边的播报 / 动作按钮：与时间同字号，靠透明度与颜色表意，不占额外行高 */
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

/* 动作键图标：内联 SVG 单色三角，颜色跟行内文字走。
   换成 emoji（▶️）会渲染成一块彩色方块，和喇叭放在一起就是两种风格。 */
.pet-chat-action-icon {
  display: block;
  width: ${px(SIZE.hairline * 5)};
  height: ${px(SIZE.hairline * 5)};
}

/* 生成中：只有上半圈带色的细环，靠旋转表达「在生成」。
   尺寸与时间文字同高；border-box + flex:none 是必须的：默认 content-box 会把描边算在尺寸外，
   而在 flex 行里被压缩时环会变成椭圆，看着就是个「奇怪的圆角方块」。 */
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

/* 播放中：主色 + 满不透明，和「可播放」明显区分 */
.pet-chat-speak.is-playing {
  opacity: 1;
  color: var(--dsw-alias-state-business-primary);
  cursor: default;
}

/* 失败：压暗表示没成，但仍可点（重试），所以指针保持手型 */
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
  /* 与宠物气泡左沿对齐：让时间明显属于这一轮的回答，而不是下一轮提问的开头 */
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

/* 生成中：输入的文字压成三级色，与转圈一起说明「这句已经发出去了，在等回复」。
   输入框本身仍可编辑（可以先把下一句打好），所以只改颜色、不 pointer-events: none。 */
.pet-chat-composer.is-busy .pet-chat-input {
  color: var(--dsw-alias-label-tertiary);
}

/* 发送键里的转圈：与播报按钮共用 pet-chat-spin，只画半圈弧。
   box-sizing 必须 border-box，否则 1.5px 描边会把 12px 撑大，在 34px 的圆钮里显得偏大。 */
.pet-chat-send-spinner {
  box-sizing: border-box;
  width: ${px(SIZE.spinner)};
  height: ${px(SIZE.spinner)};
  border: 1.5px solid transparent;
  border-top-color: currentColor;
  border-right-color: currentColor;
  border-radius: 50%;
  animation: pet-chat-spin 0.8s linear infinite;
}

/* 悬浮提示气泡：挂在 body 上按光标定位（见 ./tooltip），不在 .pet-chat 里，
   所以字体与颜色全部自带——气泡是深色底，两种主题下都靠白字与背景的对比度读。 */
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
//#region src/standalone/settings-page/style.ts
const settingsStyle = `:root{
  color-scheme:light;
  --dsw-static-neutral-bluish-00:#fff;--dsw-static-neutral-bluish-50:#f9fafb;--dsw-static-neutral-bluish-75:#f1f3f5;
  --dsw-static-neutral-bluish-100:#ebeef2;--dsw-static-neutral-bluish-200:#e1e5ee;--dsw-static-neutral-bluish-300:#cfd3d6;
  --dsw-static-neutral-bluish-600:#81858c;--dsw-static-neutral-bluish-700:#61666b;--dsw-static-neutral-bluish-1000:#0f1115;
  --dsw-static-blue-500:#3b82f6;--dsw-static-red-500:#ef4444;--dsw-static-green-600:#15803d;
  --dsw-alias-bg-base:var(--dsw-static-neutral-bluish-50);--dsw-alias-bg-layer-2:var(--dsw-static-neutral-bluish-00);
  --dsw-alias-label-primary:var(--dsw-static-neutral-bluish-1000);--dsw-alias-label-secondary:var(--dsw-static-neutral-bluish-700);
  --dsw-alias-label-tertiary:var(--dsw-static-neutral-bluish-600);
  --dsw-alias-border-l1:#0000000a;--dsw-alias-border-l2:#0000001a;--dsw-alias-border-l3:#0000001f;--dsw-alias-border-l4:#00000029;
  --dsw-alias-interactive-bg-hover:#2631480f;--dsw-alias-interactive-bg-active:#2631481a;
  --dsw-alias-settings-card-fill:var(--dsw-alias-bg-layer-2);--dsw-alias-settings-card-stroke:var(--dsw-alias-border-l4);
  --dsw-specific-sidebar-nav-item-active:var(--dsw-static-neutral-bluish-100);
  --dsw-elevation-prominent:0 0 0 .5px var(--dsw-alias-border-l4),0 3px 8px 0 #0000000a,0 0 20px 0 #0000000d;
  --dsw-alias-bg-mask-1:#0000003d;
  --dsw-radius-xs:4px;--dsw-radius-sm:8px;--dsw-radius-md:12px;--dsw-radius-lg:16px;--dsw-radius-panel:28px;
  --dsw-font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei UI",sans-serif;
  --dsh-scrollbar-thumb:var(--dsw-alias-border-l4);--dsh-scrollbar-thumb-hover:var(--dsw-alias-border-l3);
  --dsh-sidebar-width:208px;--dsh-content-width:880px;
  --dsw-static-neutral-00:#fff;--dsw-alias-bg-layer-1:var(--dsw-static-neutral-bluish-00);
  --dsw-font-s-14:14px/1.55 var(--dsw-font-family);--dsw-font-xxs-12:12px/1.55 var(--dsw-font-family);
  --dsw-font-xxxs-11:11px/1.45 var(--dsw-font-family);
  --dsw-radius-xl:20px;
  --dsw-specific-bubble:#e8f0fe;--dsw-specific-input-major:var(--dsw-alias-bg-layer-2);
  --dsw-alias-bg-module-platform:var(--dsw-static-neutral-bluish-75);--dsw-alias-bg-multi-select:#3b82f61a;
  --dsw-alias-button-info-fill:var(--dsw-static-blue-500);--dsw-alias-button-info-hover:#2f6fe0;
  --dsw-alias-interactive-bg-hover-danger:#ef44441a;
  --dsw-alias-label-caption:var(--dsw-static-neutral-bluish-600);
  --dsw-alias-label-primary-foreground:var(--dsw-static-neutral-bluish-00);
  --dsw-alias-state-business-primary:var(--dsw-static-blue-500);
  --dsw-alias-state-error-primary:var(--dsw-static-red-500);--dsw-alias-state-error-secondary:var(--dsw-static-red-500);
  --dsw-alias-tooltip-bg:#1f2329;
  --ds-ease-in-out:cubic-bezier(.4,0,.2,1);--ds-transition-duration-fast:.12s;
}
*{box-sizing:border-box}
[hidden]{display:none!important}
html,body{height:100%}
body{margin:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:14px/1.55 var(--dsw-font-family);-webkit-font-smoothing:antialiased}
a{color:var(--dsw-static-blue-500)}
::-webkit-scrollbar{width:10px;height:10px}::-webkit-scrollbar-thumb{background:var(--dsh-scrollbar-thumb);border-radius:99px;border:3px solid transparent;background-clip:content-box}::-webkit-scrollbar-thumb:hover{background:var(--dsh-scrollbar-thumb-hover);background-clip:content-box}
.shell{display:grid;grid-template-columns:var(--dsh-sidebar-width) minmax(0,1fr);width:100vw;height:100vh;overflow:hidden;background:var(--dsw-alias-bg-base)}
.side{display:flex;flex-direction:column;min-width:0;min-height:0;padding:14px 10px 10px;background:var(--dsw-alias-bg-layer-2);border-right:1px solid var(--dsw-alias-border-l2)}
.brand{display:flex;align-items:center;gap:9px;padding:2px 8px 14px;font-size:14px;font-weight:600;line-height:22px;color:var(--dsw-alias-label-primary)}
.brandLogo{flex:none;width:24px;height:24px;border-radius:var(--dsw-radius-sm);object-fit:cover;background:var(--dsw-alias-bg-layer-1)}
.nav{display:flex;flex:1;flex-direction:column;min-width:0;min-height:0}
.navList{display:flex;flex-direction:column;gap:2px;min-height:0;overflow-y:auto}
.navCell{display:flex;align-items:center;gap:9px;height:36px;padding:0 10px;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:20px;text-align:left;cursor:pointer}
.navCell:hover{background:var(--dsw-alias-interactive-bg-hover)}
.navCell[aria-selected=true]{background:var(--dsw-specific-sidebar-nav-item-active);color:var(--dsw-alias-label-primary);font-weight:500}
.navGlyph{flex:none;width:16px;height:16px;display:block}
.navLabel{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sideFoot{flex:none;margin-top:10px;padding:9px 10px 2px;border-top:1px solid var(--dsw-alias-border-l1);font-size:11px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.main{display:flex;flex-direction:column;min-width:0;min-height:0}
.topbar{flex:none;display:flex;align-items:center;justify-content:space-between;gap:16px;height:56px;padding:0 30px;background:var(--dsw-alias-bg-layer-2);border-bottom:1px solid var(--dsw-alias-border-l1)}
.pageTitle{margin:0;font-size:15px;font-weight:600;line-height:24px;color:var(--dsw-alias-label-primary)}
.dirty{font-size:12px;color:var(--dsw-alias-label-tertiary)}
.options{display:flex;flex:1;flex-direction:column;min-width:0;min-height:0}
.panel{display:flex;flex:1;flex-direction:column;min-height:0;overflow:hidden}
.scroll{flex:1;min-height:0;overflow-y:auto;padding:22px 30px 4px}
.scroll>*{width:100%;max-width:var(--dsh-content-width);margin-left:auto;margin-right:auto}
/* 对话面板自己管内边距与滚动，这里只负责给它一个确定高度的容器；宽度与配置页对齐。 */
.pet-chat-host{display:flex;flex:1;flex-direction:column;min-height:0;overflow:hidden;width:100%;max-width:var(--dsh-content-width);margin-left:auto;margin-right:auto}
.card{background:var(--dsw-alias-settings-card-fill);border:1px solid var(--dsw-alias-settings-card-stroke);border-radius:var(--dsw-radius-lg);padding:18px 20px;margin-bottom:14px}
.card:first-child{margin-top:2px}
.cardHead{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin:0 0 4px}
.cardTitle{margin:0;font-size:15px;font-weight:600;line-height:22px}
.cardHint{margin:0 0 12px;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-tertiary)}
.field{margin:12px 0 0}
.field>label,.fieldLabel{display:block;margin:0 0 6px;font-size:13px;font-weight:500;color:var(--dsw-alias-label-secondary)}
.fieldHint{margin:6px 0 0;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-tertiary)}
.row{display:flex;gap:8px;align-items:center}
.row>input{flex:1;min-width:0}
input[type=text],input[type=url],input[type=password],input[type=number],select,textarea{display:block;width:100%;min-height:36px;padding:7px 10px;border:1px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:14px}
textarea{min-height:72px;resize:vertical;line-height:1.6}
input:hover,select:hover,textarea:hover{border-color:var(--dsw-static-neutral-bluish-300)}
/* :where() 把元素选择器权重降到 0：对话面板用「外层容器 focus-within 变色」代替逐控件焦点环，
   保持 input:focus-visible 的 (0,1,1) 会压过面板里的 .pet-chat-input{outline:none}，把焦点环画进输入框。 */
:where(input,select,textarea,button):focus-visible,.navCell:focus-visible{outline:2px solid var(--dsw-static-blue-500);outline-offset:1px}
input:disabled,select:disabled,textarea:disabled{background:var(--dsw-static-neutral-bluish-50);color:var(--dsw-alias-label-tertiary);cursor:not-allowed}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.rowCheck{display:flex;align-items:flex-start;gap:10px;padding:9px 0;border-top:1px solid var(--dsw-alias-border-l1);cursor:pointer}
.rowCheck:first-of-type{border-top:0}
.rowCheck input{width:16px;height:16px;margin:3px 0 0;accent-color:var(--dsw-static-blue-500);flex:none}
.rowCheckText{min-width:0}
.rowCheckTitle{display:block;font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary);line-height:1.5}
.rowCheckHint{display:block;font-size:12px;line-height:1.55;color:var(--dsw-alias-label-tertiary)}
.btn{height:32px;padding:0 14px;border:1px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:500 13px/1 var(--dsw-font-family);cursor:pointer;white-space:nowrap}
.btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.btn:active{background:var(--dsw-alias-interactive-bg-active)}
.btn.primary{background:var(--dsw-alias-label-primary);border-color:transparent;color:#fff}
.btn.primary:hover{opacity:.88}
.btn.ghost{border-color:transparent;color:var(--dsw-alias-label-secondary)}
.btn:disabled{opacity:.5;cursor:not-allowed}
.tabs{display:flex;gap:4px;flex-wrap:wrap;margin:0 0 12px}
.tab{height:30px;padding:0 12px;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);font:500 13px/1 var(--dsw-font-family);cursor:pointer}
.tab:hover{background:var(--dsw-alias-interactive-bg-hover)}
.tab[aria-selected=true]{background:var(--dsw-specific-sidebar-nav-item-active);color:var(--dsw-alias-label-primary)}
.footer{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 0;border-top:1px solid var(--dsw-alias-border-l1)}
.status{margin:0;min-height:20px;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-tertiary)}
.status[data-error=true]{color:var(--dsw-static-red-500)}
.status[data-ok=true]{color:var(--dsw-static-green-600)}
.pathRow{display:flex;align-items:center;gap:8px;padding:6px 0;font-size:12px;color:var(--dsw-alias-label-secondary);border-top:1px solid var(--dsw-alias-border-l1)}
.pathRow:first-child{border-top:0}
.pathKey{flex:none;width:80px;color:var(--dsw-alias-label-tertiary)}
.pathValue{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,"SF Mono",Consolas,monospace;font-size:11.5px}
.hintInline{font-weight:400;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.testRow{display:flex;align-items:center;gap:12px;margin-top:14px;flex-wrap:wrap}
.combo{position:relative;display:flex;align-items:center}
.combo input{padding-right:40px}
.comboToggle{position:absolute;right:4px;display:flex;align-items:center;justify-content:center;width:28px;height:28px;border:0;border-radius:var(--dsw-radius-xs);background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.comboToggle:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.comboToggle:disabled{opacity:.45;cursor:not-allowed}
.keyActions{display:flex;justify-content:flex-end;margin-top:8px}
.keyActions .btn{height:26px;padding:0 10px;font-size:12px}
.avatarRow{display:flex;align-items:center;gap:12px;margin:0 0 14px}
.avatarImg{flex:none;width:56px;height:56px;border-radius:var(--dsw-radius-md);border:1px solid var(--dsw-alias-border-l2);object-fit:cover;background:var(--dsw-alias-bg-layer-1)}
.avatarBox{display:flex;flex-direction:column;gap:6px;min-width:0;align-items:flex-start}
.avatarBox .fieldHint{margin:0}
.avatarBox .status{margin:0;min-height:0}
.gridTight{margin-top:14px}
.fieldTight{margin:0}
.fineprint{margin:8px 0 0;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.petBar{display:flex;align-items:center;gap:8px;margin:0 0 10px}
.select{position:relative}
.selectTrigger{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;min-height:36px;padding:7px 10px;border:1px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;text-align:left;cursor:pointer}
.selectTrigger:hover:not(:disabled){border-color:var(--dsw-static-neutral-bluish-300)}
.selectTrigger:disabled{background:var(--dsw-static-neutral-bluish-50);color:var(--dsw-alias-label-tertiary);cursor:not-allowed}
.selectValue{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.selectChevron{flex:none;width:16px;height:16px;color:var(--dsw-alias-label-tertiary);transition:transform .1s ease}
.selectTrigger[aria-expanded=true] .selectChevron{transform:rotate(180deg)}
.selectMenu{position:fixed;-webkit-app-region:no-drag!important;z-index:60;margin:0;padding:4px;list-style:none;overflow-y:auto;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);box-shadow:var(--dsw-elevation-prominent)}
.selectGroup{padding:6px 10px 2px;font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
.selectItem{padding:7px 10px;border-radius:var(--dsw-radius-sm);font-size:14px;line-height:20px;color:var(--dsw-alias-label-primary);cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.selectItem:hover,.selectItem.active{background:var(--dsw-alias-interactive-bg-hover)}
.selectItem[aria-selected=true]{background:var(--dsw-specific-sidebar-nav-item-active);font-weight:500}
.dialogMask{position:fixed;-webkit-app-region:no-drag!important;inset:0;z-index:80;display:flex;align-items:center;justify-content:center;padding:24px;background:var(--dsw-alias-bg-mask-1)}
.dialog{width:min(420px,100%);padding:20px 22px 16px;border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-elevation-prominent)}
.dialogTitle{margin:0 0 8px;font-size:15px;font-weight:600;line-height:22px}
.dialogText{margin:0;font-size:13px;line-height:1.65;color:var(--dsw-alias-label-secondary);white-space:pre-line;word-break:break-word}
.dialogActions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}
.personaWrap{position:relative}
.personaCount{position:absolute;right:10px;bottom:8px;padding:2px 5px;border-radius:var(--dsw-radius-xs);background:var(--dsw-alias-bg-layer-2);font-size:11px;line-height:1.2;color:var(--dsw-alias-label-tertiary);pointer-events:none}
.btn.danger{background:var(--dsw-static-red-500);border-color:transparent;color:#fff}
.btn.danger:hover{opacity:.9}
.petBar .select{flex:1;min-width:0}
.empty{padding:16px 0;font-size:13px;color:var(--dsw-alias-label-tertiary)}
@media(max-width:767px){
  .shell{grid-template-columns:minmax(0,1fr);grid-template-rows:auto minmax(0,1fr)}
  .side{padding:10px 8px 8px;border-right:0;border-bottom:1px solid var(--dsw-alias-border-l2)}
  .brand{padding:0 6px 10px}
  .nav{flex:none}
  .navList{flex-direction:row;gap:4px;padding-bottom:2px;overflow-x:auto;overflow-y:hidden}
  .navCell{flex:0 0 auto;padding:0 12px}
  .navLabel{flex:none}
  .sideFoot{display:none}
  .topbar{height:48px;padding:0 16px}
  .scroll{padding:16px 16px 4px}
  .grid2,.grid3{grid-template-columns:1fr}
}
@media(prefers-reduced-motion:no-preference){.navCell,.btn,.tab{transition:background-color .1s ease}}
${PANEL_CSS}
`;

//#endregion
//#region src/standalone/settings-page.ts
const AVATAR_MAX_SIDE_PX = 512;
const settingsScript = [
	"(function () {",
	coreScript(ROUTE_SEGMENT, {
		voices: VOICES.map((voice) => ({
			id: limitedVoiceId(EDGE_PROVIDER_ID, voice.id),
			name: voice.name,
			tag: voice.tag,
			provider: EDGE_PROVIDER.name
		})),
		defaultVoice: limitedVoiceId(EDGE_PROVIDER_ID, DEFAULT_VOICE),
		fonts: FONT_PRESETS.map((preset) => preset.id),
		displays: PET_DISPLAYS,
		corners: [...CORNER_SET],
		physics: DEFAULT_PHYSICS,
		font: DEFAULT_FONT,
		weights: DEFAULT_WEIGHTS
	}),
	widgetsScript(),
	overlayScript(),
	avatarScript({
		logoUrl: LOGO_URL,
		maxSide: AVATAR_MAX_SIDE_PX
	}),
	petCardScript(),
	petsScript(),
	globalsScript(),
	modelPickerScript(),
	aiScript(),
	bootScript(),
	"boot();",
	"})();"
].join("\n");

//#endregion
//#region src/standalone/chat-panel-asset.ts
let cached$1;
function readChatPanelScript() {
	if (cached$1 !== void 0) return cached$1;
	try {
		cached$1 = readFileSync(join(PACKAGE_ROOT, "lib", "chat-panel.js"), "utf8");
		return cached$1;
	} catch {
		return void 0;
	}
}

//#endregion
//#region src/standalone/icon.ts
let cached;
function readSettingsIcon() {
	if (cached) return cached;
	try {
		cached = readFileSync(join(PACKAGE_ROOT, "assets", "logo.png"));
		return cached;
	} catch {
		return void 0;
	}
}

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
	const models = modelsHandler(options.ai);
	const balance = balanceHandler(options.ai);
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
		if (pathname === "/standalone-ai/icon.png") {
			if (method !== "GET" && method !== "HEAD") {
				rejectRequest(res, 405, "仅支持 GET");
				return;
			}
			const icon = readSettingsIcon();
			if (!icon) {
				rejectRequest(res, 404, "图标缺失");
				return;
			}
			sendIcon(res, icon);
			return;
		}
		if (pathname === "/standalone-ai/chat-panel.js") {
			if (method !== "GET" && method !== "HEAD") {
				rejectRequest(res, 405, "仅支持 GET");
				return;
			}
			const chatPanel = readChatPanelScript();
			if (chatPanel === void 0) {
				rejectRequest(res, 404, "对话面板脚本缺失，请重新构建（npm run bundle）");
				return;
			}
			sendAsset(res, chatPanel, "text/javascript");
			return;
		}
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
		if (pathname === "/standalone-ai/models") {
			models(req, res).catch((error) => fail(res, error, options.logger));
			return;
		}
		if (pathname === "/standalone-ai/balance") {
			balance(req, res).catch((error) => fail(res, error, options.logger));
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
const BALANCE_PROVIDERS = [
	"",
	"deepseek-official",
	"opencode-go",
	"commandcode"
];
const DEFAULT_AI_SETTINGS = Object.freeze({
	protocol: "openai-compatible",
	baseUrl: "",
	model: "",
	balanceProvider: "",
	enabled: true,
	automaticWhispers: false,
	whisperIntervalSec: 300,
	maxTokens: 1024,
	timeoutMs: 3e4,
	apiKey: "",
	deepseekApiKey: ""
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
	balanceProvider: z.enum(BALANCE_PROVIDERS),
	enabled: z.boolean(),
	automaticWhispers: z.boolean(),
	whisperIntervalSec: z.number().int().min(60).max(86400),
	maxTokens: z.number().int().min(128).max(4096),
	timeoutMs: z.number().int().min(1e3).max(6e4),
	apiKey: z.string().max(4096).refine((s) => !containsControlChar(s) && !/\s/.test(s)),
	deepseekApiKey: z.string().max(4096).refine((s) => !containsControlChar(s) && !/\s/.test(s))
};
/** 落盘内容的完整校验。 */
const persistedSchema = z.object(fields).strict();
/** 设置页提交的补丁校验，允许额外带清空密钥的标记。 */
const patchSchema = persistedSchema.partial().extend({
	clearApiKey: z.boolean().optional(),
	clearDeepseekKey: z.boolean().optional()
}).strict();
function validateSettings(input, previous) {
	try {
		const patch = patchSchema.parse(input);
		if (patch.clearApiKey && patch.apiKey || patch.clearDeepseekKey && patch.deepseekApiKey) throw new Error("Conflicting key changes");
		const { clearApiKey, clearDeepseekKey,...values } = patch;
		const apiKey = clearApiKey ? "" : values.apiKey || previous.apiKey;
		const deepseekApiKey = clearDeepseekKey ? "" : values.deepseekApiKey || previous.deepseekApiKey;
		return persistedSchema.parse({
			...previous,
			...values,
			apiKey,
			deepseekApiKey,
			enabled: true
		});
	} catch {
		throw new Error("Invalid standalone AI settings.");
	}
}
/** 去掉密钥与启用位，只保留是否已保存密钥。 */
function redact(settings) {
	const { apiKey, deepseekApiKey, enabled,...publicFields } = settings;
	return {
		...publicFields,
		hasKey: apiKey.length > 0,
		hasDeepseekKey: deepseekApiKey.length > 0
	};
}
function createAiConfig(home) {
	let settings = DEFAULT_AI_SETTINGS;
	try {
		const loaded = readAiSettings(home);
		if (loaded !== void 0) settings = Object.freeze(validateSettings(persistedSchema.parse({
			...DEFAULT_AI_SETTINGS,
			...loaded
		}), DEFAULT_AI_SETTINGS));
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
//#region src/standalone/ai-provider/list-models.ts
/** 发现请求的封顶时长：比正式通道短，用户在设置页等着看结果。 */
const DISCOVERY_TIMEOUT_MS = 1e4;
/** 响应体上限：OpenRouter 的全量清单约 300KB，留出余量又不至于被超大响应拖住。 */
const MAX_DISCOVERY_BYTES = 1e6;
/** 单页条数上限；Anthropic 的 limit 参数上限就是 1000。 */
const PAGE_LIMIT = 1e3;
/** 失败分类对应的可操作说明；响应正文与密钥一律不进文案。 */
const FAILURE_TEXT = {
	input: "请先填写接口地址与 API 密钥",
	auth: "身份验证失败 (HTTP 401/403)：请检查 API 密钥是否正确",
	"rate-limit": "请求受限或配额超限 (HTTP 429)：请检查账户余额或调用频率",
	"not-found": "该地址下没有模型列表 (HTTP 404)：请检查地址是否以 /v1 结尾",
	contract: "端点返回的不是模型列表：请确认协议选择与服务商一致",
	timeout: "连接超时（10 秒未响应）：请检查网络连通性或服务器状态",
	network: "无法连接到目标服务器：请检查地址与端口是否正确",
	http: "接口返回了错误状态：请检查地址与凭据"
};
/** 判定一个值是不是普通对象。 */
function isRecord(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
/** 组一份失败结果；文案只来自分类表或调用方给出的固定说明。 */
function failure(code, message) {
	return {
		ok: false,
		code,
		message: message ?? FAILURE_TEXT[code] ?? FAILURE_TEXT.http ?? ""
	};
}
/** 解析并校验端点：只接受不带账号、查询与片段的 HTTP(S) 地址，返回去掉结尾斜杠的前缀。 */
function parseEndpoint(value) {
	if (/[\s\\]/.test(value)) return void 0;
	try {
		const url = new URL(value);
		if (url.username || url.password || url.search || url.hash) return void 0;
		if (!["http:", "https:"].includes(url.protocol)) return void 0;
		return (url.origin + url.pathname).replace(/\/+$/, "");
	} catch {
		return void 0;
	}
}
/**
* 候选清单地址：先按协议惯例，再按「地址里有没有带版本号」容错一次。
* @param protocol - 已归一的协议。
* @param base - 已校验的端点前缀，不含结尾斜杠。
* @returns 按尝试顺序排列的地址。
*/
function candidateUrls(protocol, base) {
	const versioned = /\/v\d+$/.test(base);
	if (protocol === "anthropic") return [`${versioned ? base : `${base}/v1`}/models?limit=${PAGE_LIMIT}`];
	return versioned ? [`${base}/models`] : [`${base}/models`, `${base}/v1/models`];
}
/** 两个协议各自的鉴权头；明文密钥只在这一层出现，错误文案不会带它。 */
function authHeaders(protocol, apiKey) {
	if (protocol === "anthropic") return {
		"x-api-key": apiKey,
		"anthropic-version": "2023-06-01",
		accept: "application/json"
	};
	return {
		authorization: `Bearer ${apiKey}`,
		accept: "application/json"
	};
}
/** 把数组或「键 → 条目」映射统一成数组，两者都是兼容网关的常见写法。 */
function asList(value) {
	if (Array.isArray(value)) return value;
	if (isRecord(value)) {
		const values = Object.values(value);
		return values.length > 0 ? values : void 0;
	}
	return void 0;
}
/** 从一页响应里找出条目数组，认 `data`、`data.models` 与 `models` 三种位置。 */
function findListing(payload) {
	if (!isRecord(payload)) return void 0;
	const direct = asList(payload.data);
	if (direct) return direct;
	if (isRecord(payload.data)) {
		const nested = asList(payload.data.models);
		if (nested) return nested;
	}
	return asList(payload.models);
}
/** 归一成「id + 展示名」，丢掉没有 id 的条目并按 id 去重，保持端点给出的顺序。 */
function normalize$1(entries) {
	const seen = new Set();
	const models = [];
	for (const entry of entries) {
		if (!isRecord(entry) || typeof entry.id !== "string") continue;
		const id = entry.id.trim();
		if (id === "" || seen.has(id)) continue;
		seen.add(id);
		const label = [entry.name, entry.display_name].find((value) => typeof value === "string" && value.trim() !== "");
		models.push({
			id,
			name: typeof label === "string" ? label.trim() : id
		});
	}
	return models;
}
/** 问一个地址要清单；非 404 的失败直接定型，404 交给调用方换下一个候选。 */
async function requestList(fetcher, url, headers, controller) {
	let response;
	try {
		response = await fetcher(url, {
			method: "GET",
			headers,
			signal: controller.signal,
			redirect: "error"
		});
	} catch {
		return failure(controller.signal.aborted ? "timeout" : "network");
	}
	if (!response.ok) {
		const code = response.status === 401 || response.status === 403 ? "auth" : "http";
		return failure(response.status === 404 ? "not-found" : code);
	}
	let text;
	try {
		text = await response.text();
	} catch {
		return failure("contract");
	}
	if (text.length > MAX_DISCOVERY_BYTES) return failure("contract", "端点返回的模型列表过大，请改用支持分页的地址");
	let payload;
	try {
		payload = JSON.parse(text);
	} catch {
		return failure("contract");
	}
	const entries = findListing(payload);
	return entries ? {
		ok: true,
		models: normalize$1(entries)
	} : failure("contract");
}
async function discoverModels(fetcher, current$1, input) {
	const protocol = input.protocol === "anthropic" || input.protocol === "openai-compatible" ? input.protocol : current$1.protocol;
	const rawBase = (input.baseUrl !== void 0 ? input.baseUrl : current$1.baseUrl).trim();
	const apiKey = (input.apiKey !== void 0 && input.apiKey !== "" ? input.apiKey : current$1.apiKey).trim();
	if (rawBase === "") return failure("input", "请先填写接口地址（Base URL）");
	if (apiKey === "") return failure("input", "请先填写 API 密钥");
	const base = parseEndpoint(rawBase);
	if (base === void 0) return failure("input", "接口地址必须是 HTTP(S) 地址，且不能含账号、查询参数或片段");
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS);
	try {
		let last = failure("http");
		for (const url of candidateUrls(protocol, base)) {
			const attempt = await requestList(fetcher, url, authHeaders(protocol, apiKey), controller);
			if (attempt.ok || attempt.code !== "not-found") return attempt;
			last = attempt;
		}
		return last;
	} finally {
		clearTimeout(timer);
	}
}

//#endregion
//#region src/standalone/ai-provider/balance.ts
async function queryStandaloneBalance(provider, apiKey) {
	if (!provider) return {
		ok: false,
		provider: "",
		reason: "unsupported"
	};
	return queryBalance(provider, async () => apiKey ? apiKey : void 0);
}

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
async function testAiConnection(fetcher, current$1, input) {
	const protocol = input.protocol === "anthropic" ? "anthropic" : input.protocol ?? current$1.protocol;
	const baseUrl = (input.baseUrl !== void 0 ? input.baseUrl : current$1.baseUrl).trim();
	const model = (input.model !== void 0 ? input.model : current$1.model).trim();
	const apiKey = (input.apiKey !== void 0 && input.apiKey !== "" ? input.apiKey : current$1.apiKey).trim();
	const missing = missingField(baseUrl, model, apiKey);
	if (missing !== null) return {
		ok: false,
		message: missing
	};
	const settings = {
		...DEFAULT_AI_SETTINGS,
		protocol,
		baseUrl,
		model,
		apiKey,
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
		disposed: false,
		paused: false,
		saving: false,
		active: void 0,
		ready() {
			return !runtime.disposed && !runtime.paused && !runtime.saving && !!store.current().model && !!store.current().baseUrl && !!store.current().apiKey;
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
		balanceAuth: () => ({
			provider: store.current().balanceProvider,
			apiKey: store.current().apiKey
		}),
		deepseekKey: () => store.current().deepseekApiKey,
		testConnection: (input) => runtime.disposed ? Promise.resolve({
			ok: false,
			message: "服务已关闭"
		}) : testAiConnection(runtime.fetcher, store.current(), input),
		discoverModels: (input) => runtime.disposed ? Promise.resolve({
			ok: false,
			code: "input",
			message: "服务已关闭"
		}) : discoverModels(runtime.fetcher, store.current(), input),
		queryBalance: async () => runtime.disposed ? {
			ok: false,
			provider: "",
			reason: "unsupported"
		} : queryStandaloneBalance(store.current().balanceProvider, store.current().apiKey),
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
			const current$1 = JSON.parse(readFileSync(file, "utf8"));
			if (current$1.pid === process.pid && current$1.token === details.token) unlinkSync(file);
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
			balanceAuth: () => ai.balanceAuth(),
			deepseekKey: () => ai.deepseekKey()
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
		ai.getSettings().balanceProvider ? `  余额        已选 ${ai.getSettings().balanceProvider}，设置页点「查询余额」取数` : "  余额        未选服务商；设置页「AI 服务商」→「余额查询服务商」里选一家",
		"  不可用      会话工作状态 / DSH 系统通知",
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