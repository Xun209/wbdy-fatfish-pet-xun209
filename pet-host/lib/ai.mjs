/**
 * 寵物的模型後端：OpenAI 相容的 `/chat/completions` 串流客戶端。
 *
 * 為什麼要自己寫而不是沿用 DSH 那套：
 *   DSH pet 的模型接法是 `ctx.llm`（DSH 自己的模型抽象層），WorkBuddy 沒有這一層；
 *   DSH 版自帶的獨立模式 AI（`src/standalone/ai-*`）綁死在 standalone 入口與設定頁上，
 *   搬過來等於搬一整套設定頁 + 憑據儲存 + 限流。
 *   寵物實際只需要一件事：「給我一段提示詞，回我一句話」。
 *   所以這裡只做那一件事，零第三方相依（用 Node 內建的 fetch）。
 *
 * 金鑰從哪來（依序）：
 *   1. 環境變數 WORKBUDDY_PET_AI_BASE_URL / _API_KEY / _MODEL / _PROVIDER
 *   2. 設定檔 <狀態目錄>/pet-host/ai.json
 *   3. DSH 的憑據庫 ~/.dsh/.credentials.yaml 的 refs（MiniMax 金鑰）
 *      —— 這是「沿用使用者本機已有的金鑰」，不是另找來源；
 *      DSH 換金鑰時寵物跟著換，不用改兩處。
 *
 * 對齊 DSH 的 `ctx.llm` 契約（寵物宿主半側就是照這個形狀呼叫的）：
 *   stream(options) → AsyncIterable<{type:'text', text}>
 *   options = { provider, model, messages, system?, temperature?, signal? }
 *   messages[].content 可能是字串或 [{type:'text',text}, …] 的區塊陣列。
 *
 * @module wbdy-fatfish-pet/pet-host/lib/ai
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** 預設的 OpenAI 相容端點（MiniMax 國內版）。 */
const DEFAULT_BASE_URL = 'https://api.minimaxi.com/v1';
/** 預設模型（對應 DSH profile 裡的 llm-pi-ai 模型清單）。 */
const DEFAULT_MODEL = 'MiniMax-M3.1-Flash';
/** 預設服務商名（寵物只認 provider+model 這個組合，用來做選擇鏈的鍵）。 */
const DEFAULT_PROVIDER = 'minimax-cn';
/** 單次請求逾時（毫秒）。DSH 版的碎碎念是 30s；聊天要等使用者回覆，給寬一點。 */
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * 讀 DSH 憑據庫的 refs 區塊。
 *
 * 只做「淺層 key: value」掃描 —— 不引入 YAML 相依，且這個檔的 refs 區塊本來就是平鋪的。
 *
 * @param {string} file - 憑據檔路徑。
 * @returns {Record<string, string>} refs 的鍵值對（值為空字串者略過）。
 */
function readDshRefs(file) {
  const out = {};
  if (!existsSync(file)) return out;
  let raw = '';
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return out;
  }
  let inRefs = false;
  for (const line of raw.split(/\r?\n/)) {
    if (/^refs:\s*$/.test(line)) {
      inRefs = true;
      continue;
    }
    if (!inRefs) continue;
    // refs 區塊結束（回到頂層鍵）
    if (/^\S/.test(line) && !/^refs:/.test(line)) break;
    const m = line.match(/^\s{2}([A-Za-z0-9_]+):\s*(.+?)\s*$/);
    if (m && m[2] && m[2] !== "''" && m[2] !== '""') out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return out;
}

/**
 * 把寵物宿主半側給的訊息轉成 OpenAI 相容格式。
 *
 * @param {unknown} system - system 提示（字串或 undefined）。
 * @param {unknown} messages - 訊息陣列。
 * @returns {Array<{role: string, content: string}>} OpenAI 格式的訊息。
 */
function toOpenAiMessages(system, messages) {
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
  return out;
}

/**
 * 建立 AI 服務。
 *
 * @param {object} options - 選項。
 * @param {string} options.stateDir - 狀態目錄（設定檔放這裡）。
 * @param {object} options.logger - 日誌出口。
 * @param {object} [options.env] - 環境變數（測試可注入）。
 * @returns {object} AI 服務（介面與 DSH 的 ctx.llm 一致）。
 */
export function createAi({ stateDir, logger, env = process.env }) {
  const configFile = join(stateDir, 'pet-host', 'ai.json');

  /** 讀設定檔；壞掉就當沒有（不讓設定問題拖垮主機）。 */
  const readFileConfig = () => {
    if (!existsSync(configFile)) return {};
    try {
      const parsed = JSON.parse(readFileSync(configFile, 'utf8'));
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
      logger?.warn?.(`AI 設定檔讀取失敗，改用其他來源：${error instanceof Error ? error.message : String(error)}`);
      return {};
    }
  };

  /**
   * 決定這次用哪個後端。
   *
   * @returns {{provider: string, model: string, baseUrl: string, apiKey: string, source: string}|null} 後端；沒有可用金鑰回 null。
   */
  const resolve = () => {
    const file = readFileConfig();
    const envBase = (env.WORKBUDDY_PET_AI_BASE_URL || '').trim();
    const envKey = (env.WORKBUDDY_PET_AI_API_KEY || '').trim();
    const envModel = (env.WORKBUDDY_PET_AI_MODEL || '').trim();
    const envProvider = (env.WORKBUDDY_PET_AI_PROVIDER || '').trim();

    if (envBase && envKey) {
      return {
        provider: envProvider || DEFAULT_PROVIDER,
        model: envModel || DEFAULT_MODEL,
        baseUrl: envBase.replace(/\/+$/, ''),
        apiKey: envKey,
        source: '環境變數 WORKBUDDY_PET_AI_*',
      };
    }

    const fileKey = typeof file.apiKey === 'string' ? file.apiKey.trim() : '';
    if (fileKey) {
      return {
        provider: (typeof file.provider === 'string' && file.provider.trim()) || DEFAULT_PROVIDER,
        model: (typeof file.model === 'string' && file.model.trim()) || DEFAULT_MODEL,
        baseUrl: (typeof file.baseUrl === 'string' && file.baseUrl.trim().replace(/\/+$/, '')) || DEFAULT_BASE_URL,
        apiKey: fileKey,
        source: `設定檔 ${configFile}`,
      };
    }

    // 最後一哩：沿用 DSH 憑據庫裡已有的 MiniMax 金鑰。
    const refs = readDshRefs(join(homedir(), '.dsh', '.credentials.yaml'));
    const dshKey = (refs.MINIMAX_CN_API_KEY || refs.MINIMAX_API_KEY || '').trim();
    if (dshKey) {
      return {
        provider: DEFAULT_PROVIDER,
        model: DEFAULT_MODEL,
        baseUrl: DEFAULT_BASE_URL,
        apiKey: dshKey,
        source: 'DSH 憑據庫 ~/.dsh/.credentials.yaml（refs 裡的 MiniMax 金鑰）',
      };
    }

    return null;
  };

  /** 目前這次呼叫要用的後端（每次重新解析 → 換金鑰立刻生效）。 */
  const backend = () => resolve();

  /**
   * 串流生成。
   *
   * @param {object} options - 呼叫選項（形狀同 DSH 的 ctx.llm.stream）。
   * @returns {AsyncGenerator<{type: 'text', text: string}>} 文字塊。
   */
  async function* stream(options) {
    const target = backend();
    if (!target) throw new Error('沒有可用的模型後端（缺 API 金鑰）');

    const messages = toOpenAiMessages(options?.system, options?.messages);
    if (messages.length === 0) throw new Error('請求沒有任何訊息');

    const timeout = AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
    const signal = options?.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

    const response = await fetch(`${target.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${target.apiKey}`,
      },
      body: JSON.stringify({
        model: options?.model || target.model,
        messages,
        temperature: typeof options?.temperature === 'number' ? options.temperature : 1,
        stream: true,
      }),
      signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`模型後端回 ${response.status}${body ? '：' + body.slice(0, 200) : ''}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/event-stream')) {
      // 有些相容端點會忽略 stream:true 直接回整包 JSON —— 照樣收，只是沒有逐字效果。
      const data = await response.json();
      const text = data?.choices?.[0]?.message?.content ?? '';
      if (typeof text === 'string' && text !== '') yield { type: 'text', text };
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        newlineIndex = buffer.indexOf('\n');
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '' || payload === '[DONE]') continue;
        let parsed = null;
        try {
          parsed = JSON.parse(payload);
        } catch {
          continue;
        }
        const delta = parsed?.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta !== '') yield { type: 'text', text: delta };
      }
    }
  }

  return {
    /** 目前的後端描述（不曝露金鑰）。 */
    describe() {
      const target = backend();
      if (!target) return { ready: false, provider: '', model: '', baseUrl: '', source: '' };
      return {
        ready: true,
        provider: target.provider,
        model: target.model,
        baseUrl: target.baseUrl,
        source: target.source,
      };
    },

    /** 服務商清單（DSH 的 ctx.llm 契約）。 */
    listProviders() {
      const target = backend();
      return target ? [{ id: target.provider, name: target.provider }] : [];
    },

    /** 模型清單（DSH 的 ctx.llm 契約）。 */
    listModels() {
      const target = backend();
      return target ? [{ id: target.model, name: target.model }] : [];
    },

    /**
     * 模型能力查詢。
     *
     * 回空 → 寵物不會傳 reasoningEffort（避免不相容端點直接拒收請求）。
     *
     * @returns {Promise<object>} 能力描述。
     */
    async resolveModelInfo() {
      return {};
    },

    /** 串流生成（DSH 的 ctx.llm 契約）。 */
    stream,
  };
}
