#!/usr/bin/env node
/**
 * 大肥魚寵物 — WorkBuddy 狀態橋接（hook 執行體）
 *
 * 【為什麼需要這支】
 * WorkBuddy 沒有第三方可註冊的「查詢 Agent 狀態」API：
 *   - workbuddy.db 的 sessions 表要人工開過對話才會有資料；
 *   - WBIPC 具名管道實測只有 3 條 pipe（entitlement / request / wecom-a2a），沒有任何事件流；
 *   - session:event:<id> 通道是宿主內部 pub/sub，外部訂閱不到。
 * 但它「完整支援 Claude Code 相容 hook」：事件發生的當下就會 spawn hook 行程，
 * stdin 送事件 JSON —— 這是唯一真正即時、零輪詢、免權限的狀態來源。
 *
 * 【輸出契約】（與寵物主機 dsh-reference 共用，欄位不可增減）
 *   { schema: 1, seq: <嚴格遞增整數>, ts: <Date.now() 毫秒>,
 *     state: "thinking"|"working"|"result"|"waiting"|"success"|"error"|null,
 *     task: <字串或 null>, session_id: <字串或 null> }
 *   - seq：狀態「實際變化」時才 +1（冪等：同一事件重複觸發不會讓 seq 亂跳）
 *   - ts ：狀態最後一次變化的時間戳
 *   - state=null 代表「空閒」（與 DSH 版 WorkStatusSnapshot 的 null 語意一致）
 *
 * 【執行器行為】（實測自 app.asar 的 HookExecutor.parseHookOutput）
 *   - exit 0            → allowed=true，不阻斷
 *   - exit 2            → 阻斷整個操作！絕對不能回 2
 *   - 其他非 0          → 不阻斷，但 stderr 會被轉成 systemMessage 顯示給使用者（很吵）
 *   - stdout 非空且不是 JSON object → 會被當成 message 顯示（很吵）
 *   → 所以本檔「成功完全靜默 + exit 0；失敗也靜默 + exit 0」，錯誤只寫進 state-hook.log。
 */

import fs from 'node:fs';
import path from 'node:path';
import { resolveStateDir, persistState, compactTask, withLock, publishStateDirPointer } from './wb-state-store.mjs';

/**
 * 通知類型 → 狀態。
 * 依據 app.asar 內的 NotificationType enum：
 *   permission_prompt / idle_prompt / elicitation_dialog / agent_needs_input 都是「要人回應」→ waiting
 *   agent_completed                                            → success
 *   auth_success / 其他                                         → thinking（流程還在往下走）
 */
const NOTIFICATION_STATE = {
  permission_prompt: 'waiting',
  idle_prompt: 'waiting',
  elicitation_dialog: 'waiting',
  agent_needs_input: 'waiting',
  agent_completed: 'success',
  auth_success: 'thinking',
};

/**
 * 會「問使用者」的工具 → waiting。
 * DSH 版對 ask_user_question 做了特判，WorkBuddy 這邊用寬鬆一點的規則涵蓋同類工具。
 */
const ASKING_TOOL_RE = /ask[_-]?(user[_-]?)?question|ask_followup|request[_-]?user[_-]?input/i;

/** 讀完 stdin（hook 執行器會寫完 JSON 後 end()）。 */
function readStdin() {
  return new Promise((resolve) => {
    let buf = '';
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      resolve(value);
    };
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { buf += chunk; });
    process.stdin.on('end', () => finish(buf));
    process.stdin.on('error', () => finish(buf));
    // 保險：某些環境 stdin 不會 end（例如父行程沒關），最多等 3 秒就當作空輸入。
    const timer = setTimeout(() => finish(buf), 3000);
    if (typeof timer.unref === 'function') timer.unref();
  });
}

/**
 * 事件 → 六檔 映射。
 * @param {object} evt hook 輸入 JSON
 * @returns {{state:string, task:string|null, session_id:string|null}|null}
 *          null = 這個事件不屬於對映表 → 不動狀態檔
 */
function mapEventToState(evt) {
  const event = typeof evt.hook_event_name === 'string' ? evt.hook_event_name : '';
  const sessionId = typeof evt.session_id === 'string' && evt.session_id ? evt.session_id : null;
  const toolName = typeof evt.tool_name === 'string' && evt.tool_name ? evt.tool_name : null;

  switch (event) {
    case 'SessionStart':
      // 剛開工：會話起了還沒做事。
      return { state: 'thinking', task: null, session_id: sessionId };

    case 'UserPromptSubmit':
      // 剛開工：使用者剛送出 prompt，模型開始動腦。
      return { state: 'thinking', task: compactTask(evt.prompt), session_id: sessionId };

    case 'PreToolUse': {
      // 工作中；但「要問使用者」的工具其實是在等人 → waiting。
      if (toolName && ASKING_TOOL_RE.test(toolName)) {
        return { state: 'waiting', task: toolName, session_id: sessionId };
      }
      // plan 權限模式下 Agent 只在規劃、不真正做事 → 歸為 thinking。
      if (evt.permission_mode === 'plan') {
        return { state: 'thinking', task: toolName, session_id: sessionId };
      }
      return { state: 'working', task: toolName, session_id: sessionId };
    }

    case 'PostToolUse':
      // 工具跑完、產出結果。
      return { state: 'result', task: toolName, session_id: sessionId };

    case 'PostToolUseFailure':
      // 出錯。
      return { state: 'error', task: toolName, session_id: sessionId };

    case 'PermissionRequest':
      // 等你按確認。
      return { state: 'waiting', task: toolName, session_id: sessionId };

    case 'Notification': {
      // 通知類型細化判斷；認不出來就當「流程還在走」。
      const type = typeof evt.notification_type === 'string' ? evt.notification_type : '';
      const state = NOTIFICATION_STATE[type] || 'thinking';
      return { state, task: type ? compactTask(type) : null, session_id: sessionId };
    }

    case 'Stop':
    case 'FinalStop':
      // 完成收工。
      return { state: 'success', task: null, session_id: sessionId };

    case 'SessionEnd':
      // 會話結束 → 清除狀態。
      // 為什麼 state 寫 null 而不是 success：DSH 版 src/shared/work-status.ts 明訂
      // 「state: null = 空閒」，toWorkStatus() 也接受 null；回合收工（success）是 Stop 的語意，
      // 會話真的結束了就是沒有進行中的工作，寵物該回待機而不是一直顯示「完成收工」。
      return { state: null, task: null, session_id: null };

    case 'PreCompact':
      // 上下文壓縮中，Agent 還在做事。
      return { state: 'thinking', task: 'compact', session_id: sessionId };

    default:
      return null;
  }
}

function logError(dir, err) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const line = `[${new Date().toISOString()}] ${err && err.stack ? err.stack : String(err)}\n`;
    fs.appendFileSync(path.join(dir, 'state-hook.log'), line, 'utf8');
  } catch { /* 連 log 都寫不進去就算了：寧可什麼都不做，也不要吵到使用者 */ }
}

async function main() {
  let dir = null;
  try {
    const raw = await readStdin();
    if (!raw || !raw.trim()) return; // 沒有輸入 → 什麼都不做

    let evt;
    try {
      evt = JSON.parse(raw);
    } catch {
      return; // 輸入不是 JSON → 靜默放行，不阻斷使用者
    }
    if (!evt || typeof evt !== 'object' || Array.isArray(evt)) return;

    const next = mapEventToState(evt);
    if (!next) return; // 不在對映表 → 不動狀態

    dir = resolveStateDir();
    fs.mkdirSync(dir, { recursive: true });
    // 先把「實際用哪個目錄」公佈出去：寵物主機是獨立行程、沒有 CODEBUDDY_PLUGIN_DATA，
    // 靠這支指路牌才找得到 hook 寫的狀態檔。
    publishStateDirPointer(dir);

    withLock(path.join(dir, 'state.lock'), () => {
      persistState(dir, next);
    });
  } catch (err) {
    // 失敗也要靜默 exit 0：hook 失敗絕對不能擋住使用者的操作。
    if (dir) logError(dir, err);
  }
}

await main();

// 成功路徑：stdout 保持全空、exit code 0 → 宿主視為「hook 通過且無訊息」。
process.exit(0);
