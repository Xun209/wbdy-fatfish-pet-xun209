/**
 * 寵物語音：用 Windows SAPI 合成，零第三方相依、可離線。
 *
 * 為什麼不用 DSH 那條 edge-tts：
 *   DSH 版走 `@andresaya/edge-tts` —— 那是一個要連微軟 websocket 的外部服務，
 *   在中國大陸常常連不上，而且要另外裝一個 npm 相依。
 *   Windows SAPI（System.Speech）是作業系統內建的語音合成器���離線、音色是系統裝的。
 *
 * 為什麼做成「edge-tts 的替身」而不是註冊外部 voice provider：
 *   DSH 宿主半側的 voice provider 契約（`synthesizeWithProvider`）**不傳 voice id**，
 *   只給 `{ text, rate }` → 註冊外部 provider 會讓「選哪個音色」這個功能消失。
 *   走內建 edge 路徑（把 `@andresaya/edge-tts` 這個相依轉接到本機替身）則：
 *   voice id、rate、快取鍵（`cacheKey(source, voice, rate, text)`）全部原樣保留，
 *   而且 `lib/index.js` 一行都不用改。
 *
 * 音訊格式：SAPI 產出 WAV，但宿主半側的 `/voice/speak` 路由固定回 `content-type: audio/mpeg`
 *   且快取檔名固定是 `.mp3`。實測 Chromium 的媒體管線會**嗅探內容**，
 *   WAV 內容即使標成 audio/mpeg 也能正常解碼播放（duration 正確、onended 有觸發），
 *   所以不需要自製 MP3 編碼器。
 *
 * @module wbdy-fatfish-pet/pet-host/lib/tts
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** DSH 版的音色白名單（4 個中文音色）→ SAPI 音色偏好。 */
export const EDGE_VOICES = {
  'zh-CN-XiaoxiaoNeural': { gender: 'female', prefer: 'zh-CN' },
  'zh-CN-XiaoyiNeural': { gender: 'female', prefer: 'zh-CN' },
  'zh-CN-YunxiNeural': { gender: 'male', prefer: 'zh-CN' },
  'zh-CN-YunjianNeural': { gender: 'male', prefer: 'zh-CN' },
};

/** 單次合成逾時（毫秒）。DSH 宿主半側包的是 15s，這裡留一點餘裕給 PowerShell 啟動。 */
export const SYNTH_TIMEOUT_MS = 12000;

/**
 * 列出本機 SAPI 音色。
 *
 * 用 `-EncodedCommand`（UTF-16LE base64）傳腳本：PowerShell 的引號規則太多，
 * 走編碼參數就不會有任何轉義問題。
 *
 * @param {object} options - 選項。
 * @param {object} options.logger - 日誌出口。
 * @returns {Promise<Array<{name: string, culture: string, gender: string}>>} 音色清單。
 */
export async function listSapiVoices({ logger } = {}) {
  const script = [
    '$ErrorActionPreference = "Stop"',
    'Add-Type -AssemblyName System.Speech',
    '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    'foreach ($v in $s.GetInstalledVoices()) {',
    '  $i = $v.VoiceInfo',
    '  if ($v.Enabled) { Write-Output ($i.Name + "|" + $i.Culture.Name + "|" + $i.Gender) }',
    '}',
    '$s.Dispose()',
  ].join('\n');
  const raw = await runPowerShell(script, {}, { logger, timeoutMs: 15000 });
  const voices = [];
  for (const line of raw.split(/\r?\n/)) {
    const text = line.trim();
    if (!text) continue;
    const [name, culture = '', gender = ''] = text.split('|');
    if (name) voices.push({ name, culture, gender });
  }
  return voices;
}

/**
 * 依 DSH 的音色 id 挑一個 SAPI 音色。
 *
 * 挑選順序（可讀性優先，性別次之）：
 *   1. 同文化的音色（zh-CN 最優先，其次 zh-TW）—— 中文的發音正確性比性別重要；
 *   2. 任一中文化音色；
 *   3. 沒有中文音色時回 null（由呼叫端決定要不要用英文音色硬念）。
 *
 * @param {Array<{name: string, culture: string, gender: string}>} voices - 本機音色。
 * @param {string} edgeVoice - DSH 音色 id（不在白名單也無妨，只影響偏好）。
 * @returns {{name: string, culture: string, gender: string}|null} 選中的音色。
 */
export function pickSapiVoice(voices, edgeVoice) {
  if (!Array.isArray(voices) || voices.length === 0) return null;
  const hint = EDGE_VOICES[edgeVoice] || { gender: '', prefer: 'zh-CN' };
  const zh = voices.filter((v) => /^zh/i.test(v.culture));
  const pool = zh.length > 0 ? zh : voices;
  const wanted = hint.prefer || 'zh-CN';
  const sameCulture = pool.filter((v) => v.culture.toLowerCase() === wanted.toLowerCase());
  if (sameCulture.length > 0) return sameCulture[0];
  const zhCn = pool.filter((v) => /^zh[-_]CN/i.test(v.culture));
  if (zhCn.length > 0) return zhCn[0];
  if (hint.gender) {
    const sameGender = pool.filter((v) => v.gender.toLowerCase() === hint.gender);
    if (sameGender.length > 0) return sameGender[0];
  }
  return pool[0];
}

/**
 * 合成一句話，回傳 WAV 位元組。
 *
 * @param {object} options - 選項。
 * @param {string} options.text - 要念的內容。
 * @param {string} [options.voice] - SAPI 音色名（空 = 用系統預設）。
 * @param {string} [options.rate] - 語速，DSH 格式（`+0%` / `-10%`）。
 * @param {number} [options.timeoutMs] - 逾時。
 * @param {object} [options.logger] - 日誌出口。
 * @returns {Promise<Buffer>} WAV 位元組。
 */
export async function synthesizeSapi({ text, voice, rate, timeoutMs = SYNTH_TIMEOUT_MS, logger } = {}) {
  const content = String(text ?? '').trim();
  if (content === '') throw new Error('synthesizeSapi: text 為空');
  const percent = parseRatePercent(rate);
  const script = [
    '$ErrorActionPreference = "Stop"',
    'Add-Type -AssemblyName System.Speech',
    '$text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:WORKBUDDY_TTS_TEXT_B64))',
    '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    'if ($env:WORKBUDDY_TTS_VOICE) { $s.SelectVoice($env:WORKBUDDY_TTS_VOICE) }',
    '$s.Rate = [int]$env:WORKBUDDY_TTS_RATE',
    '$ms = New-Object System.IO.MemoryStream',
    '$s.SetOutputToWaveStream($ms)',
    '$s.Speak($text)',
    '$s.SetOutputToNull()',
    '$s.Dispose()',
    '[Convert]::ToBase64String($ms.ToArray())',
  ].join('\n');
  const raw = await runPowerShell(script, {
    WORKBUDDY_TTS_TEXT_B64: Buffer.from(content, 'utf8').toString('base64'),
    WORKBUDDY_TTS_VOICE: voice || '',
    WORKBUDDY_TTS_RATE: String(percentToSapiRate(percent)),
  }, { logger, timeoutMs });
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '');
  if (lines.length === 0) throw new Error('synthesizeSapi: PowerShell 沒有回傳音訊');
  const audio = Buffer.from(lines[lines.length - 1], 'base64');
  if (audio.length === 0) throw new Error('synthesizeSapi: 合成結果為空');
  return audio;
}

/**
 * DSH 語速字串（`+N%` / `-N%`）→ 百分比數字。
 *
 * @param {string} rate - 語速字串。
 * @returns {number} 百分比（-50..100）。
 */
export function parseRatePercent(rate) {
  const match = /^([+-])(\d{1,3})%$/.exec(String(rate ?? '').trim());
  if (!match) return 0;
  const percent = Number(match[2]) * (match[1] === '-' ? -1 : 1);
  return Math.max(-50, Math.min(100, percent));
}

/**
 * 百分比 → SAPI 的 Rate（SAPI 是 -10..10 的整數，10 = 十倍速）。
 *
 * @param {number} percent - 百分比。
 * @returns {number} SAPI Rate。
 */
export function percentToSapiRate(percent) {
  const rate = Math.round(Number(percent || 0) / 10);
  return Math.max(-10, Math.min(10, rate));
}

/**
 * 在「使用者層設定」把 voiceEnabled 打開。
 *
 * 為什麼寫在使用者層而不是 `assets/config.jsonc`：
 *   套件預設是「語音關閉」，那是 DSH 那邊的預設；WorkBuddy 版要能用本機 SAPI，
 *   所以在使用者層開啟 —— 套件預設值保持原樣（更新套件時不會被蓋掉）。
 *
 * 為什麼是「複製預設檔再改一個字串」而不是解析 JSON 再寫回：
 *   設定檔是 JSONC（有註解）。解析後寫回會把註解洗掉；
 *   直接改字串可以保留註解與排版。
 *
 * @param {object} options - 選項。
 * @param {string} options.configFile - 使用者層設定檔路徑。
 * @param {string} options.packageConfigFile - 套件預設設定檔（使用者層不存在時用來起頭）。
 * @param {object} options.logger - 日誌出口。
 * @returns {Promise<{changed: boolean, path: string, note: string}>} 結果。
 */
export async function ensureVoiceEnabled({ configFile, packageConfigFile, logger } = {}) {
  const enabled = process.env.WORKBUDDY_PET_VOICE !== '0';
  if (!enabled) {
    return { changed: false, path: configFile, note: 'WORKBUDDY_PET_VOICE=0：語音保持關閉' };
  }
  let text = existsSync(configFile) ? readFileSync(configFile, 'utf8') : null;
  let note = '';
  if (text === null) {
    if (!existsSync(packageConfigFile)) {
      return { changed: false, path: configFile, note: '找不到套件預設設定檔，語音未開啟' };
    }
    text = readFileSync(packageConfigFile, 'utf8');
    note = '使用者層設定不存在 → 以套件預設起頭';
  }
  if (/"voiceEnabled"\s*:\s*true/.test(text)) {
    return { changed: false, path: configFile, note: 'voiceEnabled 已經是 true' };
  }
  const replaced = text.replace(/"voiceEnabled"\s*:\s*false/, '"voiceEnabled": true');
  if (replaced === text) {
    // 沒有這個鍵 → 插到第一個 pet 物件裡（main 就在最前面）
    const anchor = /"main"\s*:\s*\{/.exec(text);
    if (!anchor) {
      return { changed: false, path: configFile, note: '設定檔裡找不到 voiceEnabled 與 main，語音未開啟' };
    }
    const at = anchor.index + anchor[0].length;
    text = `${text.slice(0, at)}\n    "voiceEnabled": true,${text.slice(at)}`;
  } else {
    text = replaced;
  }
  mkdirSync(dirname(configFile), { recursive: true });
  writeFileSync(configFile, text, 'utf8');
  logger?.info?.(`語音已在使用者層開啟（voiceEnabled: true）：${configFile}`);
  return { changed: true, path: configFile, note: note || '已把 voiceEnabled 改成 true' };
}

/**
 * 語音自測：真的念一句話，回報結果。
 *
 * @param {object} options - 選項。
 * @param {object} options.logger - 日誌出口。
 * @returns {Promise<{ok: boolean, message: string, bytes: number, voice: string}>} 結果。
 */
export async function runVoiceSelfTest({ logger } = {}) {
  const voices = await listSapiVoices({ logger });
  const zhVoices = voices.filter((v) => /^zh/i.test(v.culture));
  if (voices.length === 0) {
    return {
      ok: false,
      message: '本機沒有可用的 SAPI 音色（System.Speech 沒裝或沒有語音）',
      bytes: 0,
      voice: '',
    };
  }
  const voice = pickSapiVoice(voices, 'zh-CN-XiaoyiNeural');
  const audio = await synthesizeSapi({
    text: '語音自測：你好，我是大肥魚。',
    voice: voice.name,
    rate: '+0%',
    logger,
  });
  return {
    ok: true,
    message: zhVoices.length > 0
      ? `已用中文音色「${voice.name}」（${voice.culture}）合成`
      : `本機沒有中文音色，改用「${voice.name}」（${voice.culture}）—— 中文會念得不准，` +
        '可到「設定 → 时间和语言 → 语音」新增中文语音',
    bytes: audio.length,
    voice: voice.name,
  };
}

/**
 * 跑一段 PowerShell 腳本並取回 stdout。
 *
 * @param {string} script - 腳本內容。
 * @param {Record<string, string>} extraEnv - 額外環境變數。
 * @param {object} options - 選項。
 * @param {object} [options.logger] - 日誌出口。
 * @param {number} [options.timeoutMs] - 逾時。
 * @returns {Promise<string>} stdout。
 */
function runPowerShell(script, extraEnv, { logger, timeoutMs = 12000 } = {}) {
  return new Promise((resolve, reject) => {
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const child = spawn(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { env: { ...process.env, ...extraEnv }, windowsHide: true },
    );
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`PowerShell 逾時（${timeoutMs}ms）`));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { out += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { err += chunk.toString('utf8'); });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        logger?.warn?.(`PowerShell 結束碼 ${code}：${err.slice(0, 300)}`);
        reject(new Error(`PowerShell 失敗（${code}）：${err.trim().slice(0, 300)}`));
        return;
      }
      resolve(out);
    });
  });
}
