/**
 * WorkBuddy 桌面端的模型接入：讓寵物直接用使用者**已經登入**的 WorkBuddy 帳號。
 *
 * 【為什麼需要這一支】
 *   寵物原本只能靠自己的金鑰（環境變數 / ai.json / DSH 憑據庫）說話。使用者明明
 *   已經在 WorkBuddy 裡登入了、額度就在那裡，卻要寵物另外找一把鑰匙 —— 這不合理。
 *   這一支讓寵物「自動接入」：偵測到本機 WorkBuddy 且已登入就直接用它。
 *
 * 【上游是什麼】
 *   WorkBuddy 的聊天上游 `copilot.tencent.com/v2/chat/completions`（國際版
 *   `www.workbuddy.ai`）講的是 OpenAI 協議，只是沒有公開入口，鑑權靠桌面端的登入會話。
 *
 * 【憑據怎麼拿（AtRest）】
 *   WorkBuddy 5.6.0 起，登入檔裡的 `accessToken` 是 AES-256-GCM 信封
 *   （`{"$wbEncrypted":1,"envelope":"<base64>"}`），而解密金鑰**不落盤**、只存在於
 *   客戶端行程裡。做法是請客戶端自己交出那把金鑰：以 `ELECTRON_RUN_AS_NODE=1` 跑
 *   `WorkBuddy.exe`，呼叫它自己的原生綁定 `loggerGet()`，再由我們用同一套演算法解信封。
 *   ★ 這裡**只讀**：登入檔從不被寫回（寫回會破壞客戶端的加密憑據儲存）。
 *   ★ 金鑰每次都從客戶端行程現取，程式裡不含任何金鑰材料。
 *
 * 【與 DSH 寵物那邊的關係】
 *   上游比 OpenAI 規範嚴：首條訊息必須是 system（否則 400 code 11128）。
 *   寵物的碎碎念本來就帶 system 人設，所以這裡仍主動補一條 system 保險。
 *
 * @module wbdy-fatfish-pet/pet-host/lib/workbuddy-llm
 */

import { execFile, execFileSync } from 'node:child_process';
import { createDecipheriv, createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** 取金鑰的逾時（毫秒）：要拉起一個 Electron 行程，約 340ms。 */
const KEY_FETCH_TIMEOUT_MS = 20000;
/** 金鑰快取的有效期（毫秒）：客戶端升版會換金鑰，過期後重取。 */
const KEY_CACHE_TTL_MS = 10 * 60 * 1000;
/** 單次請求逾時（毫秒）。 */
const REQUEST_TIMEOUT_MS = 120_000;
/** 預設模型：上游最便宜的一支常規 Flash（x0.03 積分），夠碎碎念用。 */
export const DEFAULT_WORKBUDDY_MODEL = 'hy4flash';
/** 找不到可用模型時的兜底 id。 */
const FALLBACK_MODEL = 'glm-5.3-flash';

/**
 * 從積分倍率字串裡取數值（"x0.03 credits" → 0.03；"x2.00 credits" → 2；讀不到回 undefined）。
 * @param {string} credits - 積分倍率字串。
 * @returns {number|undefined} 倍率。
 */
function creditsValue(credits) {
  const match = /x\s*([0-9]+(?:\.[0-9]+)?)/i.exec(String(credits || ''));
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * 從目錄裡挑一支最便宜的模型（寵物的碎碎念是短句：要快、要省積分）。
 *
 * ★ 排序規則：有倍率的按倍率升序；沒倍率的（例如 "auto"，倍率隨任務浮動）排最後。
 * ★ **但倍率不代表「這個帳號能用」**：實測同一帳號下 `hy3` 倍率最低卻回
 *   「not allowed for user type [personal_free_user]」。
 *   所以挑完之後仍要經過 {@link probeModelUsable} 實測，確認能調才敢用。
 * @param {Array<{id: string, name: string, credits: string}>} models - 模型目錄。
 * @returns {string} 模型 id；目錄是空回空字串。
 */
export function pickCheapestModel(models) {
  if (!Array.isArray(models) || models.length === 0) return '';
  const scored = models
    .map((model) => ({ id: model.id, value: creditsValue(model.credits) }))
    .filter((model) => model.id);
  const withCredits = scored.filter((model) => model.value !== undefined).sort((a, b) => a.value - b.value);
  if (withCredits.length > 0) return withCredits[0].id;
  return scored[0]?.id || '';
}

/**
 * 實測一支模型在**這個帳號**下能不能用。
 *
 * 為什麼要實測：上游的目錄列的是「產品支援的模型」，不是「這個帳號能調的」。
 * 實測發現兩類失敗：
 *   - `model [hy3] is not allowed for user type [personal_free_user]`（帳號等級不允許）
 *   - `model [glm-5.0] service info not found`（這個帳號沒有這個服務）
 * 兩種都是 4xx，所以「問一次」就能分辨「不可用」與「暫時故障」。
 *
 * @param {string} model - 模型 id。
 * @param {object} context - 上下文（憑據與客戶端）。
 * @returns {Promise<{ok: boolean, reason: string}>} 結果。
 */
export async function probeModelUsable(model, context) {
  const { credentials, client } = context;
  try {
    const response = await fetch(`${credentials.upstream}/v2/chat/completions`, {
      method: 'POST',
      headers: buildHeaders({ credentials, client, model, flow: 'chat' }),
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: 'ping' }],
        stream: true,
        max_tokens: 4,
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (response.ok) {
      // 讀掉回應串流（避免連線懸著），內容不重要 —— 問得到就算能用。
      await response.text().catch(() => '');
      return { ok: true, reason: '' };
    }
    const body = await response.text().catch(() => '');
    let reason = body.slice(0, 160);
    try {
      const parsed = JSON.parse(body);
      reason = parsed?.msg || parsed?.message || reason;
    } catch {
      /* 非 JSON */
    }
    return { ok: false, reason: String(reason) };
  } catch (error) {
    // 連線層的問題：不能判定「不可用」（可能只是網路抖）→ 當成可用，交給真實請求去處理。
    return { ok: true, reason: `（無法實測：${error instanceof Error ? error.message : String(error)}）` };
  }
}

/**
 * 從目錄裡挑一支**這個帳號真的能調**的模型。
 *
 * 做法：先按倍率排序（省積分），再逐一實測；第一支能用的就是答案。
 * 最多試 6 支 —— 再多就是上游出問題了，不該讓啟動等太久。
 *
 * @param {Array<{id: string, name: string, credits: string}>} models - 模型目錄。
 * @param {object} context - 上下文（憑據與客戶端）。
 * @param {object} [options] - 選項。
 * @param {object} [options.logger] - 日誌出口。
 * @param {string} [options.preferred] - 使用者指定的模型（優先試它）。
 * @returns {Promise<{model: string, candidates: string[], rejected: Array<{model: string, reason: string}>}>} 結果。
 */
export async function pickUsableModel(models, context, options = {}) {
  // ★ 順序 = 「依倍率從便宜到貴」，不是目錄順序。
  //   目錄順序是上游排的（auto、hy4std、hy4flash…），但裡面混著不可用的；
  //   依倍率排序才能在試第二支時就挑到便宜又可用的那支。
  const ranked = models
    .map((model) => ({ id: model.id, value: creditsValue(model.credits) }))
    .filter((item) => item.id)
    .sort((a, b) => {
      // 沒倍率的排最後（倍率隨任務浮動，不能當成免費）
      if (a.value === undefined && b.value === undefined) return 0;
      if (a.value === undefined) return 1;
      if (b.value === undefined) return -1;
      return a.value - b.value;
    })
    .map((item) => item.id);

  const ordered = [];
  if (options.preferred) ordered.push(options.preferred);
  for (const id of ranked) {
    if (!ordered.includes(id)) ordered.push(id);
  }

  const candidates = [];
  const rejected = [];
  for (const id of ordered) {
    // ★ 試到能用就停，不要一路試到底：
    //   每一支都要真的打一次上游（一兩秒），全試一輪會讓啟動慢十幾秒。
    //   依倍率排序保證「第二支」已經是便宜又可用的那一支。
    if (candidates.length > 0) break;
    const result = await probeModelUsable(id, context);
    if (result.ok) {
      candidates.push(id);
    } else {
      rejected.push({ model: id, reason: result.reason });
      options.logger?.warn?.(`[workbuddy-llm] 模型 ${id} 這個帳號用不了：${result.reason}`);
    }
  }
  return { model: candidates[0] || '', candidates, rejected };
}

/** AtRest 信封的固定結構（見 workbuddy-to-dsh 的公開演算法）。 */
const AAD_DOMAIN = Buffer.from('WB-AAD\0', 'ascii');
const FRAMING_FIELD = 2;

/**
 * 4 位元組大端長度前綴。
 * @param {number} value - 長度。
 * @returns {Buffer} 4 ���節組成的長度前綴。
 */
function encodeUint32(value) {
  const bytes = Buffer.allocUnsafe(4);
  bytes.writeUInt32BE(value);
  return bytes;
}

/**
 * 長度前綴的字串。
 * @param {string} value - 字串。
 * @returns {Buffer} 長度前綴 + 位元組。
 */
function lengthPrefixed(value) {
  const bytes = Buffer.from(value, 'utf8');
  return Buffer.concat([encodeUint32(bytes.length), bytes]);
}

/**
 * FIELD 框的 AAD（附加認證資料）。
 * @param {string} keyId - 信封的金鑰 id（16 位十六進位）。
 * @param {number} suite - 信封格式版本。
 * @returns {Buffer} AAD 位元組。
 */
function fieldAad(keyId, suite) {
  if (!/^[0-9a-f]{16}$/.test(keyId)) throw new Error('AtRest 信封的 keyId 格式不對');
  return Buffer.concat([
    AAD_DOMAIN,
    Buffer.from([1]),
    lengthPrefixed('WBEV1'),
    lengthPrefixed('sym-v1'),
    encodeUint32(suite),
    lengthPrefixed(keyId),
    Buffer.from([FRAMING_FIELD]),
    Buffer.from([0]),
    Buffer.from([0]),
  ]);
}

/** 客戶端行程交出來的金鑰載荷快取：exe 路徑 → { key, payloadJson, at }。 */
const keyCache = new Map();

/**
 * 讀 Windows 登錄項。
 * @param {string} key - 登錄鍵路徑。
 * @param {string[]} args - 額外參數。
 * @returns {string} 輸出；讀不到回空字串。
 */
function regQuery(key, args = []) {
  try {
    return execFileSync('reg', ['query', key, ...args], {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 15000,
    });
  } catch {
    return '';
  }
}

/**
 * 從登錄檔的 DisplayIcon 取出 exe 路徑。
 * @param {string} value - DisplayIcon 的值（`路徑,0`）。
 * @returns {string} exe 路徑；取不到回空字串。
 */
function exeFromIcon(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const withoutIconIndex = text.replace(/,\s*-?\d+$/, '');
  return withoutIconIndex.trim();
}

/**
 * 從登錄檔的「已安裝程式」清單裡找 WorkBuddy。
 *
 * 為什麼走登錄檔而不是硬編路徑：使用者可能裝在 D:\、E:\ 或使用者目錄下，
 * 登錄檔裡的 DisplayIcon 一定指著真正的那個 exe。
 * @returns {string} exe 路徑；找不到回空字串。
 */
function findExeInRegistry() {
  const roots = [
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  ];
  for (const root of roots) {
    const dump = regQuery(root, ['/s']);
    if (!dump) continue;
    // reg query /s 的輸出是一段一段的：每段一個子鍵，裡面有 DisplayName 與 DisplayIcon。
    let name = '';
    let icon = '';
    const flush = () => {
      if (name && /workbuddy|codebuddy|genie/i.test(name) && icon) {
        const exe = exeFromIcon(icon);
        if (exe && existsSync(exe)) return exe;
      }
      name = '';
      icon = '';
      return '';
    };
    for (const line of dump.split(/\r?\n/)) {
      const trimmed = line.trim();
      const displayName = /^\s*DisplayName\s+REG_SZ\s+(.*)$/.exec(line);
      if (displayName) {
        name = displayName[1];
        continue;
      }
      const displayIcon = /^\s*DisplayIcon\s+REG_SZ\s+(.*)$/.exec(line);
      if (displayIcon) {
        icon = displayIcon[1];
        const found = flush();
        if (found) return found;
        continue;
      }
      if (trimmed === '' && (name || icon)) {
        const found = flush();
        if (found) return found;
      }
    }
    const found = flush();
    if (found) return found;
  }
  return '';
}

/**
 * 常見安裝位置（登錄檔讀不到時的兜底）。
 * @returns {string[]} 可能的 exe 路徑。
 */
function commonExeCandidates() {
  const local = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  return [
    join(local, 'Programs', 'WorkBuddy', 'WorkBuddy.exe'),
    join(programFiles, 'WorkBuddy', 'WorkBuddy.exe'),
    join(homedir(), 'AppData', 'Local', 'CodeBuddyExtension', 'WorkBuddy.exe'),
  ];
}

/** 找到的客戶端資訊快取。 */
let clientCache = null;

/**
 * 找出本機的 WorkBuddy 客戶端。
 *
 * 依序：環境變數 → 登錄檔「已安裝程式」→ 常見位置。
 * 找到後讀出 app / CLI 版本（出站身分頭要用；版本不對上游會拒收）。
 * @returns {{exe: string, dir: string, appVersion: string, cliVersion: string}|null} 客戶端；沒有回 null。
 */
export function findWorkBuddyClient() {
  if (clientCache) return clientCache;

  const override = (process.env.WORKBUDDY_APP_EXECUTABLE || '').trim();
  const candidates = [];
  if (override) candidates.push(override);
  const fromRegistry = findExeInRegistry();
  if (fromRegistry) candidates.push(fromRegistry);
  candidates.push(...commonExeCandidates());

  for (const exe of candidates) {
    if (!exe || !existsSync(exe)) continue;
    const dir = join(exe, '..');
    clientCache = {
      exe,
      dir,
      appVersion: readAppVersion(dir),
      cliVersion: readCliVersion(dir),
    };
    return clientCache;
  }
  return null;
}

/**
 * 讀桌面端版本（`resources/install-manifest.json` 的 appVersion）。
 * @param {string} dir - 安裝目錄。
 * @returns {string} 版本號；讀不到回空字串。
 */
function readAppVersion(dir) {
  try {
    const raw = readFileSync(join(dir, 'resources', 'install-manifest.json'), 'utf8');
    const parsed = JSON.parse(raw);
    return typeof parsed.appVersion === 'string' ? parsed.appVersion : '';
  } catch {
    return '';
  }
}

/**
 * 讀內建 CLI 版本（`resources/app.asar.unpacked/cli/package.json` 的 version）。
 * @param {string} dir - 安裝目錄。
 * @returns {string} 版本號；讀不到回空字串。
 */
function readCliVersion(dir) {
  try {
    const raw = readFileSync(join(dir, 'resources', 'app.asar.unpacked', 'cli', 'package.json'), 'utf8');
    const parsed = JSON.parse(raw);
    return typeof parsed.version === 'string' ? parsed.version : '';
  } catch {
    return '';
  }
}

/**
 * 請客戶端交出它的 AtRest 金鑰載荷。
 * @param {string} exe - WorkBuddy.exe 路徑。
 * @returns {Promise<string>} 載荷 JSON。
 */
function fetchKeyPayload(exe) {
  const script =
    "try{process.stdout.write(process._linkedBinding('electron_browser_workbuddy_storage').loggerGet())}" +
    'catch(e){process.exitCode=3;process.stderr.write(String((e&&e.message)||e))}';
  return new Promise((resolve, reject) => {
    execFile(
      exe,
      ['-e', script],
      {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        timeout: KEY_FETCH_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) reject(new Error('取 WorkBuddy 金鑰失敗：' + (String(stderr || '').trim() || error.message)));
        else resolve(stdout);
      },
    );
  });
}

/**
 * 從客戶端金鑰載荷派生欄位金鑰（32 位元組）。
 * @param {string} payloadJson - 載荷 JSON。
 * @returns {Buffer} 金鑰。
 */
function deriveKey(payloadJson) {
  const secret = JSON.parse(payloadJson).atRestSecretKey;
  if (typeof secret !== 'string' || secret === '') throw new Error('WorkBuddy 金鑰載荷裡沒有 atRestSecretKey');
  // 客戶端雜湊的是 base64 **字串**，不是解碼後的位元組。
  return createHash('sha256').update(secret, 'utf8').digest();
}

/**
 * 取欄位金鑰（帶快取）。
 * @param {string} exe - WorkBuddy.exe 路徑。
 * @returns {Promise<Buffer>} 32 位元組金鑰。
 */
async function fetchKey(exe) {
  const cached = keyCache.get(exe);
  const now = Date.now();
  if (cached && now - cached.at < KEY_CACHE_TTL_MS) return cached.key;
  const payloadJson = await fetchKeyPayload(exe);
  const key = deriveKey(payloadJson);
  keyCache.set(exe, { key, at: now });
  return key;
}

/**
 * 解開一個 `$wbEncrypted` 欄位。
 * @param {unknown} field - 欄位值（字串＝明文；物件＝信封）。
 * @param {Buffer} key - 欄位金鑰。
 * @returns {string} 明文。
 */
function openField(field, key) {
  if (typeof field === 'string') return field;
  if (!field || typeof field !== 'object' || typeof field.envelope !== 'string') {
    throw new Error('AtRest 欄位格式不對');
  }
  const envelope = JSON.parse(Buffer.from(field.envelope, 'base64').toString('utf8'));
  if (typeof envelope.keyId !== 'string' || typeof envelope.suite !== 'number') {
    throw new Error('AtRest 信封缺少 suite 或 keyId');
  }
  const expected = createHash('sha256').update(key).digest('hex').slice(0, 16);
  if (envelope.keyId !== expected) {
    throw new Error(`AtRest 信封屬於另一把金鑰（${envelope.keyId} ≠ ${expected}）——本機可能裝了多個 WorkBuddy 版本`);
  }
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.nonce, 'base64'), { authTagLength: 16 });
  decipher.setAAD(fieldAad(envelope.keyId, envelope.suite));
  decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/**
 * 找出登入檔。
 * @returns {string} 路徑；沒有回空字串。
 */
function findAuthFile() {
  const local = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
  const dir = join(local, 'CodeBuddyExtension', 'Data', 'Public', 'auth');
  if (!existsSync(dir)) return '';
  const files = readdirSync(dir).filter((name) => name.endsWith('.info'));
  // 多個帳號時取最近改動的那個（與客戶端「目前登入的是誰」一致）。
  let best = '';
  let bestAt = 0;
  for (const name of files) {
    const full = join(dir, name);
    try {
      const at = statSync(full).mtimeMs;
      if (at > bestAt) {
        bestAt = at;
        best = full;
      }
    } catch {
      /* 讀不到就跳過 */
    }
  }
  return best;
}

/**
 * 讀出當前 WorkBuddy 的憑據。
 *
 * 全程只讀：登入檔從不被寫回。
 * @returns {Promise<{access: string, uid: string, domain: string, region: 'cn'|'global', upstream: string, account: string}|null>} 憑據；取不到回 null。
 */
export async function readWorkBuddyCredentials() {
  const client = findWorkBuddyClient();
  if (!client) return null;
  const authFile = findAuthFile();
  if (!authFile) return null;
  let auth;
  try {
    auth = JSON.parse(readFileSync(authFile, 'utf8'));
  } catch {
    return null;
  }
  if (!auth?.auth?.accessToken) return null;
  const key = await fetchKey(client.exe);
  const access = openField(auth.auth.accessToken, key);
  const uid = openField(auth.account?.uid, key);
  const domain = typeof auth.auth.domain === 'string' ? auth.auth.domain : '';
  const region = domain.includes('workbuddy.ai') ? 'global' : 'cn';
  return {
    access,
    uid,
    domain,
    region,
    upstream: region === 'global' ? 'https://www.workbuddy.ai' : 'https://copilot.tencent.com',
    account: typeof auth.account?.nickname === 'string' ? auth.account.nickname : uid,
  };
}

/**
 * 亂數追蹤 id（上游要求幾個 X- 前綴與 b3 的追蹤頭都要有）。
 * @returns {string} 32 位十六進位字串。
 */
function traceId() {
  return randomUUID().replace(/-/g, '');
}

/**
 * 組出站請求頭（對齊官方桌面端形狀）。
 * @param {object} options - 選項。
 * @param {object} options.credentials - 憑據。
 * @param {object} options.client - 客戶端資訊。
 * @param {string} [options.model] - 模型 id（空＝不打 X-Model-ID）。
 * @param {'chat'|'catalog'} options.flow - 用途（兩者 UA 不同）。
 * @returns {Record<string, string>} 請求頭。
 */
function buildHeaders({ credentials, client, model, flow }) {
  const messageId = traceId();
  const requestTraceId = traceId();
  const spanId = requestTraceId.slice(0, 16);
  const parentSpanId = requestTraceId.slice(16, 32);
  const version = client.appVersion || '5.0.0';
  const cliVersion = client.cliVersion || '2.0.0';
  const headers = {
    Accept: 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
    'X-Agent-Purpose': 'conversation',
    'X-CodeBuddy-Request': '1',
    'Accept-Language': credentials.region === 'cn' ? 'zh-CN' : 'en-US',
    'X-IDE-Type': 'WorkBuddy',
    'X-IDE-Name': 'WorkBuddy',
    'X-IDE-Version': version,
    'X-Product-Version': version,
    'X-Product': 'WorkBuddy',
    'User-Agent':
      flow === 'chat'
        ? `CLI/${cliVersion} CodeBuddy/${cliVersion}`
        : `WorkBuddy/${version} ${credentials.region === 'cn' ? 'WorkBuddy' : 'WorkBuddy AI'}/${version} CLI/${cliVersion}`,
    'X-Env-ID': 'production',
    'X-Domain': credentials.domain,
    'X-Request-ID': messageId,
    'X-Conversation-ID': traceId(),
    'X-Conversation-Request-ID': messageId,
    'X-Conversation-Message-ID': messageId,
    'X-Request-Trace-Id': requestTraceId,
    b3: `${requestTraceId}-${spanId}-1-${parentSpanId}`,
    'X-B3-TraceId': requestTraceId,
    'X-B3-ParentSpanId': parentSpanId,
    'X-B3-SpanId': spanId,
    'X-B3-Sampled': '1',
    Authorization: `Bearer ${credentials.access}`,
  };
  if (credentials.uid) headers['X-User-Id'] = credentials.uid;
  if (model) headers['X-Model-ID'] = model;
  return headers;
}

/**
 * 這支模型是不是「圖像／影片生成」模型（不是聊天模型）。
 *
 * ★ 千萬不要用 `supportsImages` 判斷：它的意思是「這支模型**接受**圖片輸入」
 *   （多模態），deepseek-v4-pro / glm-5.3 這些都有。用它篩會把絕大多數聊天模型誤殺。
 *   真正的生成模型要看 id 與名字。
 * @param {object} model - 目錄條目。
 * @returns {boolean} 是生成模型為 true。
 */
function isGenerationModel(model) {
  const id = typeof model?.id === 'string' ? model.id : '';
  const name = typeof model?.name === 'string' ? model.name : '';
  return /kling|image-alpha|image-v3|hunyuan-image|text2image|t2v|i2v|video/i.test(id + ' ' + name);
}

/**
 * 列出本機 WorkBuddy 客戶端知道的模型（離線讀 `cli/product.json`，不發網路請求）。
 *
 * 這是**離線兜底**：它列的是產品知道的全部模型（含帳號未必能用、也不含帳號獨有的模型），
 * 真正該給使用者看的是上游帳號目錄（{@link fetchWorkBuddyCatalog}）。
 * @returns {Array<{id: string, name: string, credits: string}>} 模型清單。
 */
export function listWorkBuddyModels() {
  const client = findWorkBuddyClient();
  if (!client) return [];
  try {
    const raw = readFileSync(join(client.dir, 'resources', 'app.asar.unpacked', 'cli', 'product.json'), 'utf8');
    const parsed = JSON.parse(raw);
    const models = Array.isArray(parsed.models) ? parsed.models : [];
    const out = [];
    for (const model of models) {
      const id = typeof model?.id === 'string' ? model.id : '';
      if (!id || isGenerationModel(model)) continue;
      out.push({
        id,
        name: typeof model.name === 'string' && model.name !== '' ? model.name : id,
        credits: typeof model.credits === 'string' ? model.credits : '',
      });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * 問上游要**這個帳號**的模型目錄（需要憑據；失敗回空陣列）。
 *
 * 為什麼以上游為準：本地 `product.json` 是產品級的清單（含別的帳號才有的模型、
 * 也含這個帳號用不了的），上游目錄才是「這個帳號現在真的能調哪些」。
 * @returns {Promise<Array<{id: string, name: string, credits: string}>>} 目錄。
 */
export async function fetchWorkBuddyCatalog() {
  const client = findWorkBuddyClient();
  if (!client) return [];
  const credentials = await readWorkBuddyCredentials();
  if (!credentials) return [];
  try {
    const response = await fetch(`${credentials.upstream}/v2/enterprises/personal/models`, {
      headers: buildHeaders({ credentials, client, flow: 'catalog' }),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) return [];
    const payload = await response.json();
    const list = Array.isArray(payload?.data?.models) ? payload.data.models : [];
    const out = [];
    for (const model of list) {
      const id = typeof model?.id === 'string' ? model.id : '';
      if (!id || isGenerationModel(model)) continue;
      out.push({
        id,
        name: typeof model.name === 'string' && model.name !== '' ? model.name : id,
        credits: typeof model.credits === 'string' ? model.credits : '',
      });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * 把訊息轉成上游要的形狀。
 *
 * ★ 首條必須是 system：上游會以 400 code 11128 拒絕純 user 開頭的請求。
 *   寵物的碎碎念本來就帶人設（system），但對話路徑未必帶 —— 這裡主動補一條。
 * @param {unknown} system - system 提示。
 * @param {unknown} messages - 訊息陣列。
 * @returns {Array<{role: string, content: string}>} 訊息。
 */
function toUpstreamMessages(system, messages) {
  const out = [];
  if (typeof system === 'string' && system.trim() !== '') out.push({ role: 'system', content: system });
  for (const message of Array.isArray(messages) ? messages : []) {
    const content = message?.content;
    let text = '';
    if (typeof content === 'string') text = content;
    else if (Array.isArray(content)) {
      text = content
        .map((block) => (typeof block === 'string' ? block : (typeof block?.text === 'string' ? block.text : '')))
        .join('');
    }
    if (text === '') continue;
    out.push({ role: message?.role === 'assistant' ? 'assistant' : 'user', content: text });
  }
  if (out.length === 0 || out[0].role !== 'system') {
    out.unshift({ role: 'system', content: '你是一个可靠的助手。' });
  }
  return out;
}

/**
 * 建立 WorkBuddy 的串流生成。
 *
 * ★ **模型不可用時自動換一支**：上游的模型目錄列的是「產品支援的模型」，
 *   不等於「這個帳號現在能調的」—— 實測同一個帳號下，
 *   `hy3` 會回 400「model [hy3] is not allowed for user type [personal_free_user]」，
 *   另有 8 支回「service info not found」。
 *   所以：模型被上游拒絕時，記下它不可用，換下一支候選重試。
 *   （否則寵物會在對話時才爆錯，而症狀看起來像「沒接模型」。）
 *
 * @param {object} options - 選項。
 * @param {string} options.model - 模型 id。
 * @param {string[]} [options.fallbacks] - 備選模型（依序嘗試）。
 * @param {unknown} options.system - system 提示。
 * @param {unknown} options.messages - 訊息陣列。
 * @param {number} [options.temperature] - 溫度。
 * @param {object} options.logger - 日誌出口。
 * @returns {AsyncGenerator<{type: 'text', text: string}>} 文字塊。
 */
export async function* streamWorkBuddy({ model, fallbacks, system, messages, temperature, logger }) {
  const client = findWorkBuddyClient();
  if (!client) throw new Error('本機沒有找到 WorkBuddy 桌面端');
  const credentials = await readWorkBuddyCredentials();
  if (!credentials) throw new Error('WorkBuddy 沒有登入（或讀不到登入憑據）');

  const candidates = [model || DEFAULT_WORKBUDDY_MODEL, ...(Array.isArray(fallbacks) ? fallbacks : [])].filter(
    (id, index, list) => typeof id === 'string' && id !== '' && list.indexOf(id) === index,
  );
  const tried = [];
  let lastError = null;

  for (const target of candidates) {
    let response = null;
    try {
      response = await fetch(`${credentials.upstream}/v2/chat/completions`, {
        method: 'POST',
        headers: buildHeaders({ credentials, client, model: target, flow: 'chat' }),
        body: JSON.stringify({
          model: target,
          messages: toUpstreamMessages(system, messages),
          temperature: typeof temperature === 'number' ? temperature : 1,
          stream: true,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      // 網路層的問題（逾時等）：換模型也救不了，直接往外丟。
      throw new Error(`WorkBuddy 上游連線失敗：${error instanceof Error ? error.message : String(error)}`);
    }

    if (response.ok) {
      if (tried.length > 0) {
        logger?.warn?.(
          `[workbuddy-llm] 模型 ${tried.join('、')} 不可用，已改用 ${target}`,
        );
      }
      const decoder = new TextDecoder();
      let buffer = '';
      for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true });
        let index;
        while ((index = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, index).trim();
          buffer = buffer.slice(index + 1);
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (payload === '' || payload === '[DONE]') continue;
          try {
            const parsed = JSON.parse(payload);
            const delta = parsed?.choices?.[0]?.delta?.content;
            if (typeof delta === 'string' && delta !== '') yield { type: 'text', text: delta };
          } catch {
            /* 不是 JSON 的行（心跳等）忽略 */
          }
        }
      }
      logger?.debug?.(`[workbuddy-llm] 回覆完成 model=${target}`);
      return;
    }

    const body = await response.text().catch(() => '');
    lastError = new Error(`WorkBuddy 上游回 ${response.status}${body ? '：' + body.slice(0, 200) : ''}`);
    // 4xx（模型不允許 / 服務不存在）→ 換一支；其他狀態碼（5xx、429）→ 直接報錯
    // （429 是額度或限流，換模型沒用，還會白白多燒幾次請求）。
    if (response.status >= 400 && response.status < 500 && response.status !== 429) {
      tried.push(target);
      logger?.warn?.(`[workbuddy-llm] 模型 ${target} 不可用（${response.status}），換下一支`);
      continue;
    }
    throw lastError;
  }

  throw lastError ?? new Error('WorkBuddy 上游沒有可用的模型');
}

export { FALLBACK_MODEL, toUpstreamMessages };
