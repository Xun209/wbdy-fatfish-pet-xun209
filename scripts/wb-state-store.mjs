/**
 * 大肥魚寵物 — 狀態檔共用儲存層
 *
 * 為什麼抽成共用模組：hook 執行體（wb-state-hook.mjs）與 MCP 伺服器（wb-pet-mcp.mjs）
 * 都要寫同一個狀態檔，seq 的高水位與冪等規則必須一致，
 * 否則兩邊各自遞增 seq 會讓寵物主機看到 seq 倒退或跳號。
 *
 * 【狀態檔契約】（與寵物主機 dsh-reference 共用，欄位不可增減）
 *   { schema: 1, seq: <嚴格遞增整數>, ts: <Date.now() 毫秒>,
 *     state: "thinking"|"working"|"result"|"waiting"|"success"|"error"|null,
 *     task: <字串或 null>, session_id: <字串或 null> }
 *
 *   state 允許 null：DSH 版 src/shared/work-status.ts 的 WorkStatusSnapshot 定義
 *   "state: null = 空閒"，toWorkStatus() 也明確接受 null。會話結束就是寫 null。
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const SIX_STATES = ['thinking', 'working', 'result', 'waiting', 'success', 'error'];

/**
 * task 文案長度上限（依碼點計）。
 * 為什麼是 40：DSH 版 src/host/work-status.ts 的 TASK_TEXT_MAX = 40，
 * 理由是氣泡最大寬度只有 0.5x 寵物寬（約 231px、字號 21px ≈ 一行 11 個漢字），
 * 不截斷會把氣泡撐成好幾行、蓋住寵物。兩邊一致才不會各截各的。
 */
export const TASK_TEXT_MAX = 40;

/**
 * 狀態檔所在目錄。優先序：
 *   1. WORKBUDDY_WHALE_STATE_DIR  —— 明確覆寫（測試 / 多實例並存時用）
 *   2. %LOCALAPPDATA%\workbuddy-whale —— 確定性預設（hook 與寵物主機都算同一個）
 *   3. ~/.workbuddy-whale
 *   4. CODEBUDDY_PLUGIN_DATA / CLAUDE_PLUGIN_DATA —— 插件資料目錄（當上面都不存在時的備援）
 *
 * ★ 為什麼把「插件資料目錄」降到最後：
 *   hook 行程帶著 CODEBUDDY_PLUGIN_DATA，寵物主機卻沒有 —— 若照舊讓插件目錄優先，
 *   兩邊就會各寫各的（主機啟動早於指路牌出現時尤甚）。
 *   改成「兩邊都用同一個確定性預設」後，啟動先後完全不影响對齊；
 *   要用插件資料目錄時請設 WORKBUDDY_WHALE_STATE_DIR 明確指定。
 */
export function resolveStateDir(env = process.env) {
  const override = (env.WORKBUDDY_WHALE_STATE_DIR || '').trim();
  if (override) return override;

  const localAppData = (env.LOCALAPPDATA || '').trim();
  if (localAppData) return path.join(localAppData, 'workbuddy-whale');

  const home = path.join(os.homedir(), '.workbuddy-whale');
  const pluginData = (env.CODEBUDDY_PLUGIN_DATA || env.CLAUDE_PLUGIN_DATA || '').trim();
  if (pluginData) return pluginData;

  return home;
}

export function stateFilePath(dir) {
  return path.join(dir, 'state.json');
}

/**
 * 把 task 文字壓成單行並依碼點截斷（避免切壞代理對，例如 emoji）。
 * 與 DSH 版 currentTaskFromTodo() 的截斷方式一致。
 */
export function compactTask(text, limit = TASK_TEXT_MAX) {
  if (typeof text !== 'string') return null;
  const oneLine = text.replace(/\s+/g, ' ').trim();
  if (!oneLine) return null;
  const points = Array.from(oneLine);
  if (points.length <= limit) return oneLine;
  return `${points.slice(0, limit).join('')}…`;
}

export function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * 以「先寫暫存再 rename」的方式寫入，寵物主機永遠讀不到半截 JSON。
 * Windows 上 fs.renameSync 會覆寫既有檔案（MoveFileEx + REPLACE_EXISTING）。
 */
export function writeFileAtomic(file, content) {
  const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
  fs.writeFileSync(tmp, content, 'utf8');
  try {
    fs.renameSync(tmp, file);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* 清理失敗不影響主流程 */ }
    throw err;
  }
}

/**
 * 取檔案鎖：確保並行 hook（平行工具呼叫會同時 spawn 幾個 hook）不會讓 seq 撞號。
 * 拿不到鎖就退而求其次直接寫（seq 最多跳號一次，不會倒退）。
 */
export function withLock(lockPath, fn) {
  let fd = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      fd = fs.openSync(lockPath, 'wx');
      break;
    } catch (err) {
      if (!err || err.code !== 'EEXIST') { fd = null; break; }
      // 別人的鎖：短暫退避再試（最多約 0.8 秒）。
      const waitUntil = Date.now() + 20;
      while (Date.now() < waitUntil) { /* busy wait：保持 hook 延遲在毫秒級 */ }
    }
  }
  try {
    return fn();
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch { /* ignore */ }
      try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
    }
  }
}

/** 讀出目前狀態檔 + seq 高水位。 */
function readCurrent(dir) {
  const file = stateFilePath(dir);
  const cur = readJsonSafe(file);
  const highWaterFile = path.join(dir, 'state.seq');

  let highWater = 0;
  try {
    const parsed = Number.parseInt(fs.readFileSync(highWaterFile, 'utf8').trim(), 10);
    if (Number.isSafeInteger(parsed) && parsed > 0) highWater = parsed;
  } catch { /* 沒有高水位檔是正常情況 */ }

  const curSeq = cur && Number.isSafeInteger(cur.seq) ? cur.seq : 0;
  return { cur, file, highWaterFile, seq: Math.max(curSeq, highWater) };
}

/**
 * 冪等鍵：狀態 + task + session_id 三者都一樣 → 視為「同一狀態的重複事件」→ 不重寫。
 * 為什麼不用 event 名稱當鍵：同一個 Bash 工具連續呼叫兩次時，
 * PreToolUse→working、PostToolUse→result 會交替出現，狀態本身會變，
 * 用 (state,task) 比較天然就會重寫；而真正的重複觸發（重試）狀態不變，就不會重寫。
 */
function idempotencyKey(next) {
  return `${next.state}${next.task ?? ''}${next.session_id ?? ''}`;
}

/**
 * 寫入狀態。
 * @param {string} dir
 * @param {{state:string|null, task:string|null, session_id:string|null}} next
 * @param {{force?:boolean}} [opts] force=true 時即使內容相同也重寫（用於 pet_say 這種「一定要有反應」的操作）
 */
export function persistState(dir, next, opts = {}) {
  // 擋掉髒狀態：寫進去的 state 必須是六檔之一或 null（null = 空閒），
  // 否則消費端 toWorkStatus() 會整個判成 null，寵物就完全沒有動畫了。
  if (next.state !== null && !SIX_STATES.includes(next.state)) {
    throw new Error(`invalid work status state: ${String(next.state)}`);
  }

  fs.mkdirSync(dir, { recursive: true });
  const { cur, file, highWaterFile, seq } = readCurrent(dir);

  if (!opts.force && cur && typeof cur === 'object' && idempotencyKey(cur) === idempotencyKey(next)) {
    return { changed: false, seq, payload: cur };
  }

  const nextSeq = seq + 1;
  const payload = {
    schema: 1,
    seq: nextSeq,
    ts: Date.now(),
    state: next.state,
    task: next.task ?? null,
    session_id: next.session_id ?? null,
  };

  writeFileAtomic(file, `${JSON.stringify(payload, null, 2)}\n`);
  // seq 高水位另外存一份：狀態檔被刪掉時 seq 仍能繼續往上，不會倒退。
  try {
    writeFileAtomic(highWaterFile, `${nextSeq}\n`);
  } catch { /* 高水位只是保險，寫不動就算了 */ }

  return { changed: true, seq: nextSeq, payload };
}

/** 讀取目前狀態（沒有檔案時回 null）。 */
export function readState(dir) {
  return readJsonSafe(stateFilePath(dir));
}

/**
 * 狀態目錄「指路牌」：把實際使用的狀態目錄寫進 fallback 目錄的 state-dir.txt。
 *
 * 為什麼需要：hook 行程有 CODEBUDDY_PLUGIN_DATA（寫到插件資料目錄），
 * 但寵物主機是獨立行程、通常沒有這個環境變數（會落到 %LOCALAPPDATA%\workbuddy-whale）——
 * 兩邊就會各寫各的、寵物永遠讀不到 hook 寫的狀態。
 * 這支指路牌讓任何一端都能在 fallback 目錄裡找到「真正在用的那個目錄」。
 * 消費端只要在 fallback 目錄讀 state-dir.txt 就能對齊（兩行）。
 */
export function publishStateDirPointer(dir) {
  try {
    const localAppData = (process.env.LOCALAPPDATA || '').trim();
    const fallback = localAppData
      ? path.join(localAppData, 'workbuddy-whale')
      : path.join(os.homedir(), '.workbuddy-whale');
    if (path.resolve(fallback) === path.resolve(dir)) return; // 本來就在 fallback，不寫
    fs.mkdirSync(fallback, { recursive: true });
    writeFileAtomic(path.join(fallback, 'state-dir.txt'), `${path.resolve(dir)}\n`);
  } catch { /* 指路牌是保險，寫不動就算了 */ }
}
