/**
 * `@andresaya/edge-tts` 的本機替身：用 Windows SAPI 合成。
 *
 * 為什麼要做這個替身：
 *   DSH 宿主半側的語音走 `requireOptional("@andresaya/edge-tts")`（見 lib/index.js 的
 *   `src/host/voice/edge.ts`）。那個套件要連微軟的 websocket，在大陸常常連不上，
 *   而且得另外裝一個 npm 相依。
 *   把這個相依轉接到本機替身，宿主半側**一行都不用改**，卻能用離線的 SAPI 說話。
 *
 * 為什麼保留原來那個介面（`new EdgeTTS()` / `generate(text, voice, opts)`）：
 *   宿主半側是照這個形狀呼叫的；而且走這條路（而不是註冊外部 voice provider）
 *   才會保留 voice id 與 rate —— 外部 provider 契約不傳 voice id，選音色會失效。
 *
 * ⚠️ 音訊內容是 WAV，但宿主半側的 `/voice/speak` 固定回 `content-type: audio/mpeg`。
 *   實測 Chromium 會嗅探內容，WAV 一樣能解碼播放，所以不需要自製 MP3 編碼器。
 *
 * @module wbdy-fatfish-pet/pet-host/lib/dsh-peers/edge-tts
 */

import { listSapiVoices, pickSapiVoice, synthesizeSapi } from '../tts.mjs';

/** 本機音色清單（第一次用到時才查，之後一直快取）。 */
let voiceCache = null;

/**
 * 取本機音色清單（快取）。
 *
 * @returns {Promise<Array<{name: string, culture: string, gender: string}>>} 音色清單。
 */
async function voices() {
  if (voiceCache === null) {
    try {
      voiceCache = await listSapiVoices({});
    } catch {
      voiceCache = [];
    }
  }
  return voiceCache;
}

/**
 * edge-tts 的相容外觀。
 *
 * 名字沿用 EdgeTTS 是為了讓宿主半側「以為」自己還在用 edge-tts；
 * 實際上底下是 Windows SAPI。
 */
export class EdgeTTS {
  /**
   * 合成一段語音。
   *
   * @param {string} text - 要念的內容。
   * @param {string} voice - 音色 id（DSH 的白名單，如 zh-CN-XiaoyiNeural）。
   * @param {object} [options] - 選項。
   * @param {string} [options.rate] - 語速（`+0%` / `-10%`）。
   * @param {number} [options.timeout] - 逾時（毫秒）。
   * @returns {Promise<{audio: Buffer}>} 音訊位元組（WAV）。
   */
  async generate(text, voice, options = {}) {
    const list = await voices();
    const picked = pickSapiVoice(list, voice);
    const audio = await synthesizeSapi({
      text,
      voice: picked ? picked.name : '',
      rate: options?.rate,
      timeoutMs: Number(options?.timeout) > 0 ? Number(options.timeout) : undefined,
    });
    return { audio };
  }
}

export default { EdgeTTS };
