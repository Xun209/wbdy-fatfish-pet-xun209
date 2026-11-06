/**
 * WorkBuddy standalone overlay 的入口。
 *
 * 【為什麼能脫離 DSH 跑】
 * DSH 的 client 半側裡，**寵物本體（src/client/pet.ts 及其依賴）完全不碰 DSH runtime**：
 * - 沒有任何 `ctx.*` 呼叫（`ctx` 只出現在 app.ts / app-shortcut.ts / chat\/register.ts）；
 * - 唯一的 `@deepseek-ai/*` 匯入都是 `import type`（型別，編譯後消失）；
 * - React 能力由外部注入（`h` / `useState` / `useEffect` / `useRef`）；
 * - 資料全靠 `fetch(ROUTE_PATH + …)`，而 ROUTE_PATH 由 `document.baseURI` 推導。
 *
 * 所以 standalone 頁只要提供「一個 React + 一個掛載點」就能跑起來，
 * 不需要模擬 DSH 的 slot 系統、locale 服務、ModuleLoader。
 * （本檔是「自己開一條 entry」的做法；另一條做法是沿用 DSH 已編譯的 lib/client.js
 * 再用假 ModuleLoader 驅動 —— 見 _impl_overlay.md 的取捨分析。）
 *
 * 【為什麼走「自己開 entry」而不是沿用 lib/client.js】
 * lib/client.js 是 DSH ModuleLoader 版本，啟動時必須有 `window.__ModuleLoader__`，
 * 而且它的 `apply(ctx)` 會掛 slot（shell.overlay / settings.section）與右側欄對話頁 ——
 * 那些都需要 DSH 的 slot/locale/commandUi 服務。為了只顯示寵物而模擬整套 DSH runtime，
 * 反而比直接開一條只含寵物的 entry 更脆弱。
 *
 * 【注入的 h 為什麼是 react/jsx-runtime 的 jsx】
 * DSH 的 app.ts 就是 `const { jsx: h } = require('react/jsx-runtime')`，
 * 全部 `h(type, props)` 呼叫都把 children 放進 props（jsx 風格，不是 createElement 風格）。
 * 換成 createElement 會讓 children 位置全錯，所以必須用同一個 jsx。
 *
 * @module wbdy-fatfish-pet/pet-host/overlay/standalone-entry
 */

import { useEffect, useRef, useState } from 'react';
import { jsx } from 'react/jsx-runtime';
import { createRoot } from 'react-dom/client';

// @dsh-pet-client/pet 由打包設定的 alias 指到 DSH 基準版的 src/client/pet.ts（唯讀引用）。
import { makePetUI } from '@dsh-pet-client/pet';

/**
 * 掛載點的 id。
 *
 * 為什麼寫死：這個頁面由寵物主機自己發出去，HTML 與 bundle 是同一對，
 * 沒有理由做成可配的；寫死反而讓「頁面與 bundle 不匹配」這件事立刻暴露（元素不存在 → 不渲染）。
 */
const ROOT_ID = 'dsh-pet-root';

/**
 * 啟動 overlay。
 *
 * 為什麼不在這裡 try/catch 讓它靜靜失敗：這是開發期最常見的失敗點
 * （bundle 路徑錯、React 版本不合、掛載點 id 拼錯），安靜失敗會讓人完全不知道發生什麼事。
 * 所以把錯誤原樣丟到 console，並在頁面上留一行可見的字。
 */
function boot(): void {
  const container = document.getElementById(ROOT_ID);
  if (!container) {
    const message = `pet-host overlay：找不到掛載點 #${ROOT_ID}`;
    console.error('[pet-host overlay]', message);
    document.body.textContent = message;
    return;
  }
  try {
    // 寵物頁面工廠：注入 react 能力，回傳多開容器元件。
    const PetMulti = makePetUI({ h: jsx, useState, useEffect, useRef });
    // createRoot().render() 要的是 element，不是 element 陣列；jsx(PetMulti, {}) 產生 element。
    createRoot(container).render(jsx(PetMulti, {}));
    console.log('[pet-host overlay] 已啟動');
  } catch (error) {
    const message = `pet-host overlay：啟動失敗 ${error instanceof Error ? error.message : String(error)}`;
    console.error('[pet-host overlay]', error);
    document.body.textContent = message;
  }
}

// 頁面的 DOM 已經就緒（module script 預設 defer）→ 直接啟動。
boot();
