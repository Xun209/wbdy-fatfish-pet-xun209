/**
 * ESM 解析轉接：把 `@deepseek-ai/*` 三個 DSH 專用套件指到本機的降級替身。
 *
 * 為什麼需要這個鉤子（而不是把替身放進 node_modules）：
 * 1. 插件是 zip 散發的，`tools/package-plugin.mjs` 會排除所有 `node_modules` 目錄，
 *    放進去的替身會在打包時被丟掉；
 * 2. 帶一個 node_modules 進插件會讓「這是什麼」變得不清楚——使用者看到的是插件，不是依賴樹；
 * 3. `module.register()` 是 Node 官方機制，不依賴任何第三方套件。
 *
 * 只轉接「確定不存在於 WorkBuddy 環境」的三個套件，其餘 import 一律走 Node 預設解析。
 * @module wbdy-fatfish-pet/pet-host/lib/dsh-peers/loader
 */

/** 需要轉接的 DSH 專用套件 → 本機替身檔。 */
const PEER_SHIMS = new Map([
  ['@deepseek-ai/dsh-home-paths', './dsh-home-paths.mjs'],
  ['@deepseek-ai/dsh-credentials', './dsh-credentials.mjs'],
  ['@deepseek-ai/dsh-llm', './dsh-llm.mjs'],
  // 語音：edge-tts 要連外部 websocket，改用離線的 Windows SAPI 替身。
  // 走這條（而不是註冊外部 voice provider）是為了保留 voice id 與 rate ——
  // 外部 provider 契約不傳 voice id，選音色會直接失效。
  ['@andresaya/edge-tts', './edge-tts.mjs'],
]);

/**
 * Node 的 ESM 解析鉤子。
 *
 * 必須是**同步**函式：新的 `module.registerHooks()`（同執行緒）要求 resolve 鉤子同步回傳，
 * 回傳 Promise 會讓 Node 拿到一個沒有 url 的結果而報 ERR_INVALID_RETURN_PROPERTY_VALUE。
 * 舊的 `module.register()`（worker 執行緒）則兩種都收——同步函式在兩邊都成立，所以統一寫成同步。
 *
 * @param {string} specifier - 被 import 的模組名。
 * @param {object} context - Node 提供的解析上下文。
 * @param {(specifier: string, context: object) => object} nextResolve - 後續解析器。
 * @returns {object} 解析結果。
 */
export function resolve(specifier, context, nextResolve) {
  const shim = PEER_SHIMS.get(specifier);
  if (shim) {
    // shortCircuit：命中即結束，不再問 Node 的預設解析（那裡一定找不到）。
    return { url: new URL(shim, import.meta.url).href, shortCircuit: true, format: 'module' };
  }
  return nextResolve(specifier, context);
}
