#!/usr/bin/env node
/**
 * 大肥魚寵物 — MCP 伺服器（讓 Agent 能直接跟她說話）
 *
 * 【為什麼自己刻一個 MCP server 而不用 SDK】
 * 插件不能假設有 npm 網路（skill 腳本可能在離線環境跑），
 * 而 MCP stdio 的 wire protocol 其實只是「換行分隔的 JSON-RPC 2.0」，
 * 零依賴手刻反而最不會出包。
 *
 * 【協定】
 *   stdin  ：一行一個 JSON-RPC 2.0 訊息（request 或 notification）
 *   stdout ：一行一個 JSON-RPC 2.0 回應
 *   stderr ：日誌（MCP 規範允許；stdout 只能走協定，否則會污染回應）
 *
 * 支援的方法：
 *   initialize / notifications/initialized / ping
 *   tools/list / tools/call
 *   resources/list（空）/ prompts/list（空）
 *
 * 協定版本：app.asar 內的 MCP SDK 宣告 LATEST = 2025-11-25，
 * 支援清單 = 2025-11-25 / 2025-06-18 / 2025-03-26 / 2024-11-05 / 2024-10-07。
 * initialize 時若客戶端要的是清單內的版本就原樣回傳（相容性最好），否則回最新版本。
 */

import { resolveStateDir, persistState, readState, compactTask, withLock, SIX_STATES } from './wb-state-store.mjs';
import path from 'node:path';

const SERVER_NAME = 'fatfish-pet';
const SERVER_VERSION = '1.0.0';
const LATEST_PROTOCOL_VERSION = '2025-11-25';
const SUPPORTED_PROTOCOL_VERSIONS = [
  '2025-11-25',
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
  '2024-10-07',
];

const TOOLS = [
  {
    name: 'pet_say',
    description:
      '讓桌面寵物「藍色大肥魚」說一句話。會把這句話寫進寵物狀態檔的 task 欄位，寵物主機會立刻把牠說的話顯示出來。適合在需要安撫使用者、回報進度或讓氣氛輕鬆時呼叫。',
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: '要讓大肥魚說的話。建議一句、30 字以內，語氣可愛。',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'pet_state',
    description:
      '回報桌面寵物「藍色大肥魚」目前的狀態（thinking／working／result／waiting／success／error）與 seq、task、session_id。可用來確認狀態橋接是否正常運作。',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

function log(message) {
  process.stderr.write(`[fatfish-pet-mcp] ${message}\n`);
}

/** 寫一行 JSON-RPC 回應到 stdout。 */
function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function sendResult(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function sendError(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  send({ jsonrpc: '2.0', id, error });
}

function textContent(text) {
  return { content: [{ type: 'text', text }] };
}

// ─────────────────────────────────────────────────────────────
// 工具實作
// ─────────────────────────────────────────────────────────────

/**
 * pet_say：讓她說一句話。
 * 刻意「不」改變六檔 state —— 使用者的工作狀態不該被寵物講話污染；
 * 只把 task 換成這句話，寵物主機就會把它當成要顯示的內容。
 * force=true：就算話語跟上一句一模一樣也要重寫，否則「再說一次」會沒有反應。
 */
function toolPetSay(args) {
  const text = compactTask(args && args.text, 120);
  if (!text) {
    return { isError: true, ...textContent('pet_say 需要 text 參數（要讓大肥魚說的話）。') };
  }

  const dir = resolveStateDir();
  const current = readState(dir);
  // 沿用目前的工作狀態（null = 空閒也是合法值），不要讓「寵物講話」污染使用者的工作狀態。
  const state = current && typeof current === 'object'
    ? (current.state === null || SIX_STATES.includes(current.state) ? current.state : 'result')
    : 'result';
  const sessionId = current && typeof current.session_id === 'string' ? current.session_id : null;

  let result;
  withLock(path.join(dir, 'state.lock'), () => {
    result = persistState(dir, { state, task: text, session_id: sessionId }, { force: true });
  });

  return {
    ...textContent(
      `大肥魚說：「${text}」\n（狀態檔已更新：state=${state}, seq=${result.seq}）`,
    ),
    isError: false,
  };
}

/** pet_state：回報她現在的狀態。 */
function toolPetState() {
  const dir = resolveStateDir();
  const current = readState(dir);
  if (!current) {
    return {
      ...textContent(
        `大肥魚還沒有狀態紀錄（狀態檔不存在）。\n預期路徑：${path.join(dir, 'state.json')}`,
      ),
      isError: false,
    };
  }
  return {
    ...textContent(
      `大肥魚目前的狀態：\n${JSON.stringify(current, null, 2)}\n\n狀態檔：${path.join(dir, 'state.json')}`,
    ),
    isError: false,
  };
}

/** 依工具名稱分派。 */
function callTool(name, args) {
  try {
    if (name === 'pet_say') return toolPetSay(args);
    if (name === 'pet_state') return toolPetState();
    return { isError: true, ...textContent(`未知的工具：${name}`) };
  } catch (err) {
    // 工具失敗要回 isError，而不是讓整個 MCP 連線掛掉。
    log(`tool ${name} failed: ${err && err.stack ? err.stack : String(err)}`);
    return { isError: true, ...textContent(`工具 ${name} 執行失敗：${err && err.message ? err.message : String(err)}`) };
  }
}

// ─────────────────────────────────────────────────────────────
// JSON-RPC 分派
// ─────────────────────────────────────────────────────────────

function handleMessage(msg) {
  if (!msg || typeof msg !== 'object') return;
  const { id, method, params } = msg;

  // notification（沒有 id）→ 不回應。
  const isNotification = id === undefined || id === null;

  switch (method) {
    case 'initialize': {
      const requested = params && typeof params.protocolVersion === 'string' ? params.protocolVersion : null;
      const protocolVersion = requested && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
        ? requested
        : LATEST_PROTOCOL_VERSION;
      if (!isNotification) {
        sendResult(id, {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        });
      }
      return;
    }

    case 'notifications/initialized':
    case 'notifications/cancelled':
    case 'notifications/progress':
      return; // 通知類，無需回應

    case 'ping':
      if (!isNotification) sendResult(id, {});
      return;

    case 'tools/list':
      if (!isNotification) sendResult(id, { tools: TOOLS });
      return;

    case 'tools/call': {
      if (isNotification) return;
      const name = params && typeof params.name === 'string' ? params.name : '';
      const args = params && params.arguments && typeof params.arguments === 'object' ? params.arguments : {};
      // ★ 工具可能是非同步的（要 spawn 子行程、讀檔案…）。
      //   兩件事會壞掉：
      //   ① 直接 sendResult(promise) → 把 Promise 當結果送出去；
      //   ② stdin 關掉後行程立刻退 → 回應還沒產出來。
      //   所以非同步的話掛 inflight，等它回來再送，並且擋住提早退出。
      const outcome = callTool(name, args);
      if (outcome && typeof outcome.then === 'function') {
        inflight += 1;
        outcome.then(
          (value) => {
            inflight -= 1;
            sendResult(id, value);
            maybeExit();
          },
          (err) => {
            inflight -= 1;
            sendError(id, -32603, String(err && err.message ? err.message : err));
            maybeExit();
          },
        );
        return;
      }
      sendResult(id, outcome);
      return;
    }

    case 'resources/list':
      if (!isNotification) sendResult(id, { resources: [] });
      return;

    case 'prompts/list':
      if (!isNotification) sendResult(id, { prompts: [] });
      return;

    default:
      if (!isNotification) {
        sendError(id, -32601, `Method not found: ${method}`);
      }
  }
}

// ─────────────────────────────────────────────────────────────
// 主迴圈：stdin 一行一個 JSON
// ─────────────────────────────────────────────────────────────

let buffer = '';
/** 進行中的非同步呼叫數；>0 時不准退出（否則回應會被砍掉）。 */
let inflight = 0;
/** stdin 是否已結束；結束後要等進行中的呼叫收尾才退。 */
let stdinEnded = false;

/**
 * stdin 結束後的退出閘門。
 *
 * 為什麼要等：客戶端常在送完 request 後就關 stdin。若那時行程立刻退出，
 * 正在跑的工具（spawn 子行程、讀檔）還沒回應，客戶端就只收到半套訊息。
 */
function maybeExit() {
  if (!stdinEnded || inflight > 0) return;
  process.exit(0);
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let index = buffer.indexOf('\n');
  while (index >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line) {
      try {
        handleMessage(JSON.parse(line));
      } catch (err) {
        log(`failed to parse message: ${err && err.message ? err.message : String(err)}`);
      }
    }
    index = buffer.indexOf('\n');
  }
});

process.stdin.on('end', () => {
  const line = buffer.trim();
  if (line) {
    try {
      handleMessage(JSON.parse(line));
    } catch { /* 收尾殘留資料解析失敗就忽略 */ }
  }
  stdinEnded = true;
  maybeExit();
  // 保險：進行中的呼叫若卡住（例如子行程不收尾），5 秒後強制退出，不讓 MCP 主程序吊死。
  setTimeout(() => process.exit(0), 5000).unref?.();
});

process.stdin.on('error', (err) => {
  log(`stdin error: ${err && err.message ? err.message : String(err)}`);
  process.exit(0);
});
