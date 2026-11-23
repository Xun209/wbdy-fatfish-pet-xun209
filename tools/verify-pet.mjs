#!/usr/bin/env node
/**
 * 寵物功能驗收：安裝完之後跑一次，就知道「對話」與「碎碎念」到底通沒通。
 *
 * 【為什麼要有這一支】
 *   桌寵有兩個功能要「打模型」：右鍵「對話」（快捷鍵 L）與「碎碎念」。
 *   它們的失效方式非常安靜：桌面小窗正常、動畫正常、托盤正常，
 *   只有這兩個動作會回一句「需要令牌」或「未接」—— 使用者常常以為是模型沒配好，
 *   其實是**寫端點令牌沒到位**（宿主沒把令牌透給桌面 Helper）。
 *   這支腳本把那條鏈路一次驗完，並把結論寫成人能看的句子。
 *
 * 【驗什麼】
 *   ① 寵物主機活著嗎（埠號 / 令牌檔）
 *   ② 模型後端接上了嗎（主機日誌裡的「模型後端：」那一行）
 *   ③ 桌面 Helper 拿到寫端點令牌了嗎（日誌裡的「寫端點令牌：已取得」）
 *   ④ 右鍵「對話」通路：POST /chat（帶令牌）→ 有沒有真的回話
 *   ⑤ 碎碎念通路：POST /whisper（帶令牌）→ 有沒有真的生成一句
 *   ⑥ 守門對照：不帶令牌應該 403（證明守門在，也證明 ④⑤ 的 200 是靠令牌拿到的）
 *
 * 【用法】
 *   node tools/verify-pet.mjs            # 驗收
 *   node tools/verify-pet.mjs --json     # 機器可讀的結果
 *
 * 【退出碼】
 *   0 = 全部通過；1 = 有項目沒通過（看輸出裡的 FAIL 行）
 *
 * @module wbdy-fatfish-pet/tools/verify-pet
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const JSON_MODE = process.argv.includes('--json');

/** 候選的寵物主機執行檔位置（依 INSTALL.md 的約定）。 */
function runtimeFileCandidates() {
  const local = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
  return [
    join(local, 'workbuddy-whale', 'pet-host', 'pet-host-runtime.json'),
    join(homedir(), '.workbuddy-whale', 'pet-host', 'pet-host-runtime.json'),
  ];
}

/** 候選的主機日誌位置（啟動摘要與診斷行都在裡面）。 */
function logFileCandidates() {
  const local = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
  return [
    join(local, 'workbuddy-whale', 'pet-host', 'pet-host.log'),
    join(homedir(), '.workbuddy-whale', 'pet-host', 'pet-host.log'),
  ];
}

const results = [];
/**
 * 記一條檢查結果。
 * @param {string} name - 項目名。
 * @param {boolean} ok - 是否通過。
 * @param {string} detail - 說明。
 */
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  if (!JSON_MODE) {
    const mark = ok ? 'PASS' : 'FAIL';
    process.stdout.write(`  [${mark}] ${name}${detail ? ' — ' + detail : ''}\n`);
  }
}

if (!JSON_MODE) {
  process.stdout.write('\n===== 大肥魚寵物驗收 =====\n\n');
}

// ① 主機活著嗎
let runtime = null;
for (const file of runtimeFileCandidates()) {
  if (!existsSync(file)) continue;
  try {
    runtime = JSON.parse(readFileSync(file, 'utf8'));
    break;
  } catch {
    /* 讀壞了就看下一個 */
  }
}
if (!runtime) {
  check('寵物主機在跑', false, '找不到 pet-host-runtime.json —— 主機沒啟動？先執行 node "<插件根>/pet-host/main.mjs"');
} else {
  check('寵物主機在跑', true, `埠號 ${runtime.port}（${runtime.startedAt} 啟動）`);
}

if (!runtime) {
  if (JSON_MODE) process.stdout.write(JSON.stringify({ ok: false, results }, null, 2));
  else process.stdout.write('\n驗收未通過：主機沒起來，其餘項目無法檢查。\n');
  process.exit(1);
}

const base = `http://127.0.0.1:${runtime.port}/dsh-pet-7340`;
const token = runtime.token || '';

// ② 模型後端
let logText = '';
for (const file of logFileCandidates()) {
  if (!existsSync(file)) continue;
  try {
    logText = readFileSync(file, 'utf8');
    break;
  } catch {
    /* 讀不到就當沒有 */
  }
}
if (logText) {
  // ★ 日誌是**追加**的，同一句話可能出現過很多次（每次啟動一行）。
  //   要取的是**最後一次**啟動的那行，否則會拿到好幾天前的舊記錄，
  //   然後誤報「模型後端是 MiniMax」（明明現在用的是 WorkBuddy）。
  const lines = logText.split(/\r?\n/);
  const backendLine = [...lines].reverse().find((line) => line.includes('模型後端：'));
  const backend = backendLine ? /模型後端：(\S+)\/(\S+)（([^）]*)）←\s*(.+)/.exec(backendLine) : null;
  check(
    '模型後端已接上',
    Boolean(backend),
    backend ? `${backend[1]}/${backend[2]} ← ${backend[4].trim()}` : '主機日誌裡沒有「模型後端：」那一行（主機可能剛啟動，還沒寫日誌）',
  );

  // ③ 桌面 Helper 的寫端點令牌（同樣取最後一行）
  // ★ Helper 的診斷行是**簡體**（「写端点令牌」）——它是 DSH 上游的程式碼，
  //   不要自己改成繁體，否則這裡永遠比對不到。
  const tokenLine = [...lines].reverse().find((line) => /写端点令牌|寫端點令牌/.test(line));
  const tokenText = tokenLine ? /写端点令牌：(.+)|寫端點令牌：(.+)/.exec(tokenLine).slice(1).filter(Boolean).join('').trim() : '';
  check(
    '桌面 Helper 拿到寫端點令牌',
    tokenText.includes('已取得'),
    tokenText || '主機日誌裡沒有「写端点令牌：」那一行（Helper 還沒啟動？重啟寵物主機讓它重啟 Helper）',
  );
} else {
  check('模型後端已接上', false, '找不到主機日誌（pet-host.log）');
  check('桌面 Helper 拿到寫端點令牌', false, '找不到主機日誌（pet-host.log）');
}

// ④⑤ 兩條打模型的通路
/**
 * 打一次宿主端點。
 * @param {string} path - 路徑（含查詢字串）。
 * @param {object} body - 請求體。
 * @param {boolean} useToken - 是否帶令牌。
 * @returns {Promise<{status: number, json: object|null, text: string}>} 結果。
 */
async function call(path, body, useToken) {
  const headers = { 'content-type': 'application/json' };
  if (useToken) headers['x-dsh-pet-token'] = token;
  try {
    const res = await fetch(base + path, { method: 'POST', headers, body: JSON.stringify(body) });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* 非 JSON */
    }
    return { status: res.status, json, text };
  } catch (error) {
    return { status: 0, json: null, text: error instanceof Error ? error.message : String(error) };
  }
}

// 右鍵「對話」與 L 快捷鍵走的就是這條
const chat = await call('/chat?pet=main&surface=desktop', { text: '用一句话打个招呼。' }, true);
const chatText = chat.json && typeof chat.json.text === 'string' ? chat.json.text : '';
check(
  '右鍵「對話」通路（POST /chat）',
  chat.status === 200 && chatText !== '',
  chat.status === 200 ? `已回話：「${chatText.slice(0, 40)}」` : `HTTP ${chat.status} ${chat.text.slice(0, 120)}`,
);

// 碎碎念走的就是這條
const whisper = await call('/whisper?pet=main&surface=desktop', {}, true);
const whisperText = whisper.json && typeof whisper.json.text === 'string' ? whisper.json.text : '';
check(
  '碎碎念通路（POST /whisper）',
  whisper.status === 200 && whisperText !== '',
  whisper.status === 200 ? `已生成：「${whisperText.slice(0, 40)}」` : `HTTP ${whisper.status} ${whisper.text.slice(0, 120)}`,
);

// ⑥ 守門對照
const noToken = await call('/chat?pet=main&surface=desktop', { text: '你好' }, false);
check(
  '守門生效（不帶令牌應 403）',
  noToken.status === 403,
  noToken.status === 403 ? '正確攔截' : `HTTP ${noToken.status}（若不是 403，說明守門沒生效，別把上面的 200 當成「令牌通了」）`,
);

const failed = results.filter((item) => !item.ok);
const ok = failed.length === 0;

if (JSON_MODE) {
  process.stdout.write(JSON.stringify({ ok, results }, null, 2));
} else {
  process.stdout.write(
    '\n' +
      (ok
        ? '全部通過：對話與碎碎念都接上了模型，桌面小窗右鍵「對話」與週期碎碎念應該都能用。\n'
        : '有項目沒通過（見上面 FAIL 行）。常見原因：\n' +
            '  · 「模型後端已接上」FAIL → WorkBuddy 沒登入，或沒裝 WorkBuddy 桌面端\n' +
            '  · 「桌面 Helper 拿到寫端點令牌」FAIL → 寵物主機沒有把令牌透給 Helper（重啟寵物主機即可）\n' +
            '  · 兩條通路都 403 → 寵物主機沒啟動，或令牌不對（重啟寵物主機）\n') +
      '\n',
  );
}
process.exit(ok ? 0 : 1);
