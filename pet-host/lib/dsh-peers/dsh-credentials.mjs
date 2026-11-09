/**
 * DSH 專用套件的「獨立模式降級替身」——`@deepseek-ai/dsh-credentials`。
 *
 * WorkBuddy 沒有 DSH 的憑據服務，餘額查詢一律走明確失敗分支。
 * 這個替身只保證模組圖能載入：引用原樣返回，解析恆為空。
 *
 * 來源：DSH pet 的 `src/standalone/shims/dsh-credentials.ts`（MIT），
 * 這裡只把 TS 換成純 JS 並補上說明。
 * @module wbdy-fatfish-pet/pet-host/lib/dsh-peers/dsh-credentials
 */

/**
 * 原樣返回憑據引用。
 *
 * 為什麼不拋錯：DSH pet 的餘額輪詢會先 `credentialRef(ref)` 再 `ctx.credentials.resolve(...)`；
 * 替身裡沒有 DSH 服務，解析路徑自然走不到，這裡只需要「不炸」。
 *
 * @param {unknown} ref - 引用。
 * @returns {unknown} 原樣的引用。
 */
export function credentialRef(ref) {
  return ref;
}

export default { credentialRef };
