/**
 * 自我驗證：啟動後真的寫一次工作狀態、真的讀回來、真的看到葉子變了。
 *
 * 為什麼要自檢而不是「看起來對就行」：這條接縫（狀態檔 → POST /work-status → /state 葉子）
 * 中間有三個可能壞掉的點——映射寫錯、端點不接受、葉子沒更新。
 * 沒有自檢的話，使用者只會看到「寵物不動」，而我們連壞在哪一段都不知道。
 *
 * 檢查項目（全部要 PASS 才算通過）：
 * 1. GET /state 打得開，且形狀是預期的（counter + sections）；
 * 2. POST /work-status 回 200；
 * 3. workStatus 葉子的 counter 真的變大了（這是 DSH 约定的「變了沒有」唯一判據）；
 * 4. 葉子的 data.state 與 data.task 與送出去的一致；
 * 5. 狀態橋：狀態檔寫成 done 之後，葉子會自己變成 success（端到端）。
 * @module wbdy-fatfish-pet/pet-host/lib/selftest
 */

import { writeFileSync } from 'node:fs';

/** 等候葉子變化的輪詢間隔（毫秒）。 */
const STEP_MS = 120;

/** 最多等多久（毫秒）。 */
const TIMEOUT_MS = 4000;

/**
 * 讀一次 /state。
 *
 * @param {string} origin - 服務 origin。
 * @returns {Promise<any>} 狀態快照。
 */
async function readState(origin) {
  const response = await fetch(`${origin}/dsh-pet-7340/state`, { headers: { 'cache-control': 'no-cache' } });
  if (!response.ok) throw new Error(`GET /state 回 ${response.status}`);
  return response.json();
}

/**
 * 等到 workStatus 葉子滿足條件為止。
 *
 * @param {string} origin - 服務 origin。
 * @param {(leaf: any) => boolean} predicate - 判定條件。
 * @returns {Promise<any>} 符合條件的葉子（逾時回 null）。
 */
async function waitForLeaf(origin, predicate) {
  const deadline = Date.now() + TIMEOUT_MS;
  let last = null;
  while (Date.now() < deadline) {
    const state = await readState(origin);
    last = state?.sections?.workStatus ?? null;
    if (predicate(last)) return last;
    await new Promise((done) => setTimeout(done, STEP_MS));
  }
  return last;
}

/**
 * 執行自檢。
 *
 * @param {object} options - 選項。
 * @param {string} options.origin - 服務 origin。
 * @param {string} options.token - 能力令牌。
 * @param {string} options.stateFile - 狀態橋正在讀的狀態檔（端到端檢查要用）。
 * @param {object} options.logger - 日誌。
 * @returns {Promise<{passed: boolean, lines: string[]}>} 結果與逐項說明。
 */
export async function runSelftest({ origin, token, stateFile, logger }) {
  const lines = [];
  let passed = true;
  const record = (ok, label, detail) => {
    if (!ok) passed = false;
    lines.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
    logger.info(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  };

  // 1) /state 形狀
  let before;
  try {
    before = await readState(origin);
    const ok = typeof before?.counter === 'number' && typeof before?.sections === 'object';
    record(ok, 'GET /state 回應形狀正確', `counter=${before?.counter}`);
  } catch (error) {
    record(false, 'GET /state 可讀', error instanceof Error ? error.message : String(error));
    return { passed, lines };
  }

  const beforeLeaf = before?.sections?.workStatus ?? { counter: 0, data: null };

  // 2) POST /work-status
  let postOk = false;
  let postBody = '';
  try {
    const response = await fetch(`${origin}/dsh-pet-7340/work-status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dsh-pet-token': token },
      body: JSON.stringify({ state: 'working', task: '寵物主機自檢' }),
    });
    postBody = await response.text();
    postOk = response.ok;
    record(postOk, 'POST /work-status 被接受', `HTTP ${response.status} ${postBody.slice(0, 120)}`);
  } catch (error) {
    record(false, 'POST /work-status 可呼叫', error instanceof Error ? error.message : String(error));
  }

  // 3) + 4) 葉子更新且內容一致
  if (postOk) {
    const leaf = await waitForLeaf(origin, (item) => item?.counter > (beforeLeaf?.counter ?? 0));
    const counterGrew = (leaf?.counter ?? 0) > (beforeLeaf?.counter ?? 0);
    record(counterGrew, 'workStatus 葉子的 counter 變大', `${beforeLeaf?.counter} → ${leaf?.counter}`);
    const data = leaf?.data ?? null;
    record(
      data?.state === 'working' && data?.task === '寵物主機自檢',
      '葉子內容與送出的狀態一致',
      JSON.stringify(data),
    );
  }

  // 5) 端到端：狀態檔變了 → 葉子自己跟著變
  try {
    // 任務文案帶唯一值：橋的「有沒有變」判定是 (檔位, 文案) 整對比較，
    // 若沿用與上次相同的文案，橋會判定「沒變」而不重發——那是正確行為，
    // 但會讓這項檢查測不到東西。
    const nonce = `端到端自檢 ${Date.now()}`;
    writeFileSync(
      stateFile,
      `${JSON.stringify(
        { schema: 1, seq: 999001, ts: Date.now(), state: 'done', task: nonce, session_id: null },
        null,
        2,
      )}\n`,
      'utf8',
    );
    const leaf = await waitForLeaf(origin, (item) => item?.data?.state === 'success');
    record(
      leaf?.data?.state === 'success' && leaf?.data?.task === nonce,
      '狀態檔 → 橋 → 葉子 端到端生效',
      JSON.stringify(leaf?.data ?? null),
    );
  } catch (error) {
    record(false, '狀態檔可寫入', error instanceof Error ? error.message : String(error));
  }

  return { passed, lines };
}
