/**
 * DSH 專用套件的「獨立模式降級替身」——`@deepseek-ai/dsh-llm`。
 *
 * WorkBuddy 沒有 DSH 的模型後端，這裡只提供讓模組圖能載入的最小實作：
 * 訊息工廠、文本塊拼裝、reasoning 標識。
 *
 * 來源：DSH pet 的 `src/standalone/shims/dsh-llm.ts`（MIT），
 * 這裡只把 TS 換成純 JS、補上說明與型別註解。
 * @module wbdy-fatfish-pet/pet-host/lib/dsh-peers/dsh-llm
 */

/**
 * 建立使用者訊息。
 *
 * @param {{content: unknown, source: unknown}} input - 訊息內容與來源。
 * @returns {{role: 'user', content: unknown, source: unknown}} 訊息。
 */
export function createUserMessage(input) {
  return { role: 'user', content: input.content, source: input.source };
}

/**
 * 建立助理訊息。
 *
 * @param {{content: unknown, source: unknown}} input - 訊息內容與來源。
 * @returns {{role: 'assistant', content: unknown, source: unknown}} 訊息。
 */
export function createAssistantMessage(input) {
  return { role: 'assistant', content: input.content, source: input.source };
}

/**
 * 流式文本拼裝：只收集文字塊。
 *
 * 為什麼需要它：DSH pet 的聊天／碎碎念走 `ctx.llm.stream(...)`，
 * 沒有模型後端時那條路走不到，但模組圖仍會 import 這個類。
 */
export class BlockAssembler {
  /** 已收集的文本片段。 */
  #chunks = [];

  /**
   * 收集一個區塊；非文字型別忽略。
   *
   * @param {unknown} chunk - 區塊。
   */
  push(chunk) {
    if (chunk !== null && typeof chunk === 'object' && chunk.type === 'text') {
      const text = chunk.text;
      if (typeof text === 'string') this.#chunks.push(text);
    }
  }

  /**
   * 取回已收集的結果。
   *
   * @returns {Array<{type: 'text', text: string}>} 文字塊陣列。
   */
  blocks() {
    const text = this.#chunks.join('');
    return text === '' ? [] : [{ type: 'text', text }];
  }
}

/**
 * reasoning effort 標識工廠：原樣返回。
 *
 * @param {string} id - 標識。
 * @returns {string} 原樣的標識。
 */
export function ReasoningEffortId(id) {
  return id;
}

export default { createUserMessage, createAssistantMessage, BlockAssembler, ReasoningEffortId };
