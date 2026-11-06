/**
 * WorkBuddy 狀態橋：把「狀態檔」裡的狀態寫進 DSH pet 的工作狀態葉子。
 *
 * 【這是整個方案的接縫】
 * DSH 版的寵物靠監聽 DSH 的會話事件知道「Agent 現在幹嘛」；WorkBuddy 沒有那套事件，
 * 但插件的 hook 端（`scripts/wb-state-hook.mjs`）會把狀態寫進一個 JSON 檔。
 * 這裡就做那條轉換：讀檔 → 映射檔位 → 寫進寵物的 workStatus 葉子。
 *
 * 【兩種投遞模式】
 * 1. **共享（單寵物 / 狀態檔要求共享）**：走 DSH 公開的 `POST /dsh-pet-7340/work-status`
 *    端點（外部槽 `api`）。它寫進去後會與 DSH 自己的會話狀態一起參與優先級仲裁
 *    （waiting > error > working > thinking > result > success）。
 *    用公開端點而不是直接改內部狀態倉，是為了不複製 DSH 的那份邏輯——兩份寫入路徑一定會漂移。
 *    **單寵物時只有這一條路，行為與既有版本逐位元組一致。**
 * 2. **指派（多寵物）**：走 DSH 的**逐寵物**葉子（`pets.<id>.anim` + `pets.<id>.say`），
 *    只投遞給「正在工作」的那一隻，其餘寵物完全不動。
 *    為什麼要分兩條路、逐寵物通道有哪些限制，見 lib/multipet.mjs 的實測筆記。
 *
 * 【抖動抑制】
 * 照 DSH 的 `src/host/plugin/work-status-bridge.ts`：只壓「working → result」這一個方向
 * （工具秒回時會來回切十幾次，每切一次前端就從第 0 幀重播動畫）；
 * 反向不壓（開工遲到比多換一次片更糟），終態不壓。窗口 5 秒。
 * @module wbdy-fatfish-pet/pet-host/lib/work-status
 */

import { existsSync, readFileSync } from 'node:fs';

import { deliverySurface, pickWorkAnimation, pickWorkText, resolveWorkTarget } from './multipet.mjs';

/** DSH 的六個工作狀態檔位；順序即動畫池索引，不可增減。 */
export const SIX_STATES = ['thinking', 'working', 'result', 'waiting', 'success', 'error'];

/**
 * WorkBuddy 舊狀態名 → DSH 六檔的映射。
 *
 * 為什麼需要這一層：舊版 hook 端寫的是 `hello/received/done/goodbye/idle/say` 這種
 * 「事件語意」的名字，而 DSH 的動畫池是按「工作階段」分檔的。
 * 若生產端已經直接寫六檔（新版 hook 就是這樣），映射表不會被用到。
 */
const LEGACY_MAP = new Map([
  ['hello', 'thinking'], // 剛開工 → 思考
  ['thinking', 'thinking'],
  ['received', 'thinking'], // 收到指令 → 先想
  ['working', 'working'],
  ['say', 'working'], // 說話中 → 仍在工作
  ['result', 'result'],
  ['waiting', 'waiting'], // 等你按確認 → 等待
  ['done', 'success'], // 完成收工 → 成功
  ['success', 'success'],
  ['goodbye', 'success'], // 道別＝這一輪收尾 → 成功
  ['error', 'error'],
  ['idle', null], // 待機 → 空閒（不是任何檔位）
]);

/** 工作狀態抖動抑制窗口（毫秒）；與 DSH 的 WORK_STATE_GAP_MS 同值。 */
export const WORK_STATE_GAP_MS = 5000;

/**
 * 任務詳情文案的長度上限（碼點）。
 *
 * 為什麼要在這裡截：DSH 的 `/work-status` 端點會拒絕超過 40 碼點的 task
 * （回 bad-request），截斷規則必須與 DSH 端一致（`src/host/work-status.ts` 的
 * TASK_TEXT_MAX = 40），否則會出現「短任務寫得進去、長任務被退回」的怪現象。
 */
export const TASK_TEXT_MAX = 40;

/**
 * 指派模式下氣泡的停留時間（毫秒）。
 *
 * 為什麼給這麼長：DSH 的全域路徑裡，工作狀態氣泡是**常駐**的（狀態切走才收起，
 * 終態則 10 秒自動收起）。逐寵物通道只有 /broadcast 的 duration 可控制，
 * 給一個長值就能得到「常駐」的行為，狀態結束時再明確清掉。
 */
const BUBBLE_DURATION_MS = 60 * 60 * 1000;

/**
 * 把狀態檔的內容映射成 DSH 檔位。
 *
 * @param {unknown} raw - 狀態檔解析出的物件。
 * @returns {{state: string|null, task: string|null, unknown: boolean}} 映射結果。
 *   `unknown` = 狀態名不在對照表內（呼叫端應該記一次告警，然後當作空閒）。
 */
export function mapSnapshot(raw) {
  if (!raw || typeof raw !== 'object') return { state: null, task: null, unknown: false };
  const record = /** @type {Record<string, unknown>} */ (raw);
  const rawState = typeof record.state === 'string' ? record.state.trim() : '';
  let state = null;
  let unknown = false;
  if (SIX_STATES.includes(rawState)) {
    state = rawState;
  } else if (LEGACY_MAP.has(rawState)) {
    state = LEGACY_MAP.get(rawState);
  } else if (rawState !== '') {
    unknown = true;
  }
  const task = typeof record.task === 'string' && record.task.trim() !== '' ? truncateTask(record.task) : null;
  return { state, task, unknown };
}

/**
 * 截斷任務文案（按碼點，避免把 emoji 截成半個字元）。
 *
 * @param {string} text - 原文。
 * @returns {string} 截斷後的文案。
 */
export function truncateTask(text) {
  const points = Array.from(text.trim());
  if (points.length <= TASK_TEXT_MAX) return points.join('');
  return points.slice(0, TASK_TEXT_MAX).join('') + '…';
}

/**
 * 狀態檔要求「共享模式」嗎？
 *
 * 狀態檔可帶 `shared: true` → 用 DSH 的全域工作狀態（所有寵物一起反應）。
 * 為什麼要留這個開關：DSH 的原生模型就是「一份狀態、所有寵物共用」，
 * 使用者若習慣那種表現，只要在狀態檔加一個欄位就能切回去，不必改程式。
 *
 * @param {unknown} raw - 狀態檔的原始內容。
 * @returns {boolean} 是否走共享模式。
 */
export function wantsShared(raw) {
  if (!raw || typeof raw !== 'object') return false;
  const record = /** @type {Record<string, unknown>} */ (raw);
  return record.shared === true;
}

/**
 * 建立狀態橋。
 *
 * @param {object} options - 選項。
 * @param {string} options.stateFile - 狀態檔絕對路徑。
 * @param {string} options.origin - 寵物服務 origin。
 * @param {string} options.token - 能力令牌。
 * @param {object} options.logger - 日誌。
 * @param {number} [options.pollMs] - 輪詢間隔（毫秒）。
 * @param {() => Promise<string>} [options.resolveStateFile] - 重新推導狀態檔位置用的函式。
 * @param {() => Promise<import('./multipet.mjs').PetInfo[]>} [options.loadPets] - 取寵物清單的函式。
 * @param {object} [options.binder] - session→寵物的綁定器（多寵物指派用）。
 * @returns {object} 橋的控制介面。
 */
export function createBridge({
  stateFile,
  origin,
  token,
  logger,
  pollMs = 250,
  resolveStateFile,
  loadPets,
  binder,
}) {
  /** 最後一次成功發布出去的内容；用來判斷「有沒有變」。 */
  let publishedKey = ' never';
  /** 最後一次發布的檔位；抖動判定要用（working → result）。 */
  let publishedState = null;
  /** 最後一次發布的時間戳；抖動窗口的基準。 */
  let publishedAt = 0;
  /** 待執行的補寫定時器。 */
  let flushTimer = null;
  /** 輪詢定時器。 */
  let pollTimer = null;
  /** 序列化寫入佇列：避免兩次 POST 交錯。 */
  let queue = Promise.resolve();
  /** 已告警過的未知狀態名（同一個名字只告警一次，否則每 250ms 刷一次）。 */
  const warned = new Set();
  /** 重新推導狀態檔位置的進行中旗標（避免併發重推）。 */
  let resolving = false;
  let stopped = false;

  /** 目前這一轮的檔位與文案（逐寵物重播時要用）。 */
  let currentState = null;
  let currentTask = null;
  /** 最近一次讀到的寵物清單（指派與重播都要用）。 */
  let currentPets = [];
  /** 逐寵物的循環重播：petId → {playbackId, state}。 */
  const petLoops = new Map();
  /**
   * 每隻寵物目前的工作狀態（主機自己的視圖）。
   *
   * 為什麼要自己留一份：DSH 的工作狀態只有全局一份（見 multipet.mjs 的實測筆記），
   * 「哪隻寵物正在工作」這個資訊在 DSH 那邊根本不存在，必須由主機自己記。
   * 這份視圖是自檢與摘要的唯一資料來源（`/state` 裡沒有這個欄位）。
   */
  const petWorkStates = new Map();
  /** 全域工作狀態是否已清空（指派模式下要先清一次，否則單寵物時代的殘留會讓所有寵物一起反應）。 */
  let globalCleared = false;
  /** 這一輪要不要順便檢查逐寵物的循環重播。 */
  let pendingLoopCheck = false;

  /**
   * 目前該讀哪個狀態檔。
   *
   * 為什麼要能「重新推導」：寵物主機可能比 hook 的第一次執行還早啟動，
   * 那時 hook 還沒寫過指路牌，主機只能先落到 fallback 目錄；
   * 等 hook 真的跑過、狀態檔出現了，主機就該換過去讀。
   * 否則寵物會「永遠不反應」，而使用者完全看不出來（狀態檔確實存在，只是不在主機看的那個目錄）。
   *
   * 只在「目前這份檔案不存在」時才重新推導：正常情況下每拍都重推是浪費。
   *
   * @returns {Promise<string>} 目前該讀的狀態檔路徑。
   */
  const currentStateFile = async () => {
    if (existsSync(stateFile)) return stateFile;
    if (typeof resolveStateFile !== 'function' || resolving) return stateFile;
    resolving = true;
    try {
      const next = await resolveStateFile();
      if (next && next !== stateFile && existsSync(next)) {
        stateFile = next;
        logger.info(`狀態檔位置已更新：${next}`);
        return next;
      }
    } catch (error) {
      logger.warn(`重新推導狀態檔位置失敗：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      resolving = false;
    }
    return stateFile;
  };

  /** 讀狀態檔；檔案不存在或壞掉都回 null（不是錯誤，是「還沒有狀態」）。 */
  const readSnapshot = async () => {
    const file = await currentStateFile();
    let text = '';
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      return null;
    }
    try {
      return JSON.parse(text);
    } catch {
      // 半截 JSON：生產端用「先寫暫存再 rename」，理論上讀不到半截；
      // 真讀到了就當作「這一拍沒有狀態」，下一拍再讀。
      return null;
    }
  };

  /** 把映射結果送進 DSH 的外部槽（**全局**工作狀態）。 */
  const send = (snapshot) => {
    const url = `${origin}/dsh-pet-7340/work-status`;
    const headers = { 'content-type': 'application/json', 'x-dsh-pet-token': token };
    const request =
      snapshot.state === null
        ? // 清空外部槽只能用 DELETE：POST 的 state 必須是六檔之一，null 會被端點判為 bad-request。
          fetch(url, { method: 'DELETE', headers })
        : fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify({ state: snapshot.state, task: snapshot.task }),
          });
    return request
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status} ${await response.text().catch(() => '')}`);
        }
        return response;
      })
      .then(() => {
        publishedKey = keyOf(snapshot);
        publishedState = snapshot.state;
        publishedAt = Date.now();
        logger.info(
          `工作狀態已更新：${snapshot.state ?? '（空閒）'}${snapshot.task ? ` · ${snapshot.task}` : ''}`,
        );
      })
      .catch((error) => {
        // 寫不進去不推進 publishedKey：下一拍會再試，狀態不會卡在舊值。
        logger.warn(`工作狀態寫入失敗（下一拍重試）：${error instanceof Error ? error.message : String(error)}`);
      });
  };

  /** 停止某隻寵物的循環重播（狀態結束或換目標時呼叫）。 */
  const stopPetLoop = (petId) => {
    petLoops.delete(petId);
  };

  /**
   * 逐寵物投遞：把工作狀態送到**指定的那一隻**寵物，其餘不動。
   *
   * 【為什麼走 anim + broadcast 兩條 per-pet 通道】
   * DSH 的工作狀態只有全局一份，沒有 per-pet 的 workStatus 端點；能逐寵物指定的
   * 只有那六種葉子。這兩條剛好湊齊「動畫 + 氣泡」：
   * - POST /anim?pet=       → 寫 pets.<id>.anim → 渲染端播那一段動畫（events.js:325-336）；
   * - POST /broadcast?pet=  → 寫 pets.<id>.say  → 渲染端彈那段氣泡（events.js:295-310）。
   * 兩者都不需要佔用鎖（無鎖時恆放行：routes/motion.ts:51、routes/interaction.ts:141）。
   */
  const sendPerPet = async (pet, snapshot) => {
    const base = `${origin}/dsh-pet-7340`;
    const headers = { 'content-type': 'application/json', 'x-dsh-pet-token': token };
    const surface = deliverySurface(pet);
    if (surface === null) return; // display:none 的寵物沒有窗戶可顯示，不投遞
    const petQuery = `?pet=${encodeURIComponent(pet.id)}&surface=${surface}`;

    if (snapshot.state === null) {
      // 空閒：收起那一隻的氣泡（只收說話氣泡，動畫不動 —— 與 DSH 的 /bubble/clear 同義）。
      await fetch(`${base}/bubble/clear${petQuery}`, { method: 'POST', headers }).catch(() => undefined);
      stopPetLoop(pet.id);
      return;
    }

    // 動畫：點播該檔位的工作狀態動畫。
    const name = pickWorkAnimation(pet, snapshot.state);
    if (name !== '') {
      const response = await fetch(`${base}/anim${petQuery}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name }),
      }).catch(() => undefined);
      if (response && response.ok) {
        const body = await response.json().catch(() => ({}));
        // 播放編號用來知道「這一段播完了沒」→ 播完就重播，形成循環（全域路徑是影片自己 loop）。
        if (typeof body?.playbackId === 'string') {
          petLoops.set(pet.id, { playbackId: body.playbackId, state: snapshot.state });
        }
      } else if (response) {
        // 不吞掉：投遞失敗要看得見，否則「寵物不反應」的原因無從查起。
        const body = await response.text().catch(() => '');
        logger.warn(`寵物 ${pet.id} 的工作狀態動畫投遞失敗：HTTP ${response.status} ${body.slice(0, 160)}`);
      }
    }

    // 氣泡：任務詳情優先，否則取該條目該檔的備選句。duration 給長值 → 氣泡常駐到狀態切走。
    const text = pickWorkText(pet, snapshot.state, snapshot.task);
    if (text !== '') {
      const response = await fetch(`${base}/broadcast${petQuery}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ text, duration: BUBBLE_DURATION_MS, anim: false }),
      }).catch(() => undefined);
      if (response && !response.ok) {
        const body = await response.text().catch(() => '');
        logger.warn(`寵物 ${pet.id} 的工作狀態氣泡投遞失敗：HTTP ${response.status} ${body.slice(0, 160)}`);
      }
    }
  };

  /**
   * 檢查逐寵物投遞的動畫是否播完 → 播完就重播（形成循環）。
   *
   * 為什麼要自己重播：全域路徑讓影片元素自己 loop（`switchTo(name, false)`，渲染端無縫循環）；
   * 而 per-pet 的 /anim 是「選單動作」語義 —— 播一遍就結束（sprite/menu.js:165 playOnce）。
   * 不重播的話，目標寵物只在第一段動畫的長度內看起來在忙，之後就回到待機了。
   *
   * 用播放回執判斷「播完了沒」而不是定時重發：定時重發會在動畫還在播時把它打斷（看起來在跳），
   * 回執則是渲染端回報「這一段結束了」，重播的時機剛好接在動畫結束之後。
   */
  const refreshPetLoops = async () => {
    for (const [petId, loop] of [...petLoops.entries()]) {
      const response = await fetch(`${origin}/dsh-pet-7340/playback/${encodeURIComponent(loop.playbackId)}`, {
        headers: { 'x-dsh-pet-token': token },
      }).catch(() => undefined);
      if (!response || !response.ok) continue;
      const record = await response.json().catch(() => null);
      const status = String(record?.status ?? '');
      // 終態：ended / failed / cancelled（shared/playback.ts:15）
      if (status !== 'ended' && status !== 'failed' && status !== 'cancelled') continue;
      // 狀態已經變了 → 別重播（下一拍會投遞新狀態）。
      if (loop.state !== currentState) {
        petLoops.delete(petId);
        continue;
      }
      const pet = currentPets.find((item) => item.id === petId);
      if (!pet) {
        petLoops.delete(petId);
        continue;
      }
      await sendPerPet(pet, { state: currentState, task: currentTask });
    }
  };

  /** 內容鍵：檔位 + 文案。與 DSH 的 `state + '\0' + task` 同口徑。 */
  const keyOf = (snapshot) => `${snapshot.state ?? ''} ${snapshot.task ?? ''}`;

  /** 讀一次、必要時發布一次。 */
  const tick = async () => {
    if (stopped) return;
    const raw = await readSnapshot();
    const snapshot = mapSnapshot(raw);
    if (snapshot.unknown) {
      const name = String(raw && typeof raw === 'object' ? raw.state : '');
      if (!warned.has(name)) {
        warned.add(name);
        logger.warn(`狀態檔出現無法對應的狀態名「${name}」，暫時當作空閒處理`);
      }
    }
    const key = keyOf(snapshot);
    // 逐寵物模式還要檢查「動畫播完了沒」→ 就算狀態沒變也得跑這一拍。
    if (key === publishedKey && petLoops.size === 0) return;

    // 抖動抑制：只壓 working → result。整條不寫（檔位與文案一起壓住），到點再取最新快照補寫。
    const busyFlip = publishedState === 'working' && snapshot.state === 'result';
    const wait = WORK_STATE_GAP_MS - (Date.now() - publishedAt);
    if (busyFlip && wait > 0) {
      if (flushTimer === null) {
        flushTimer = setTimeout(() => {
          flushTimer = null;
          tick();
        }, wait);
        flushTimer.unref?.();
      }
      return;
    }
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }

    queue = queue.then(async () => {
      const pets = typeof loadPets === 'function' ? await loadPets() : [];
      currentPets = pets;
      const shared = wantsShared(raw);
      currentState = snapshot.state;
      currentTask = snapshot.task;

      // 先決定目標寵物：投遞方式（共享 or 指派）取決於「有沒有明確對象」。
      const target = resolveWorkTarget({ snapshot: raw, pets, binder });
      // 共享的三種情況：
      // 1. 只有一隻寵物 → 沿用 DSH 的全域路徑（單寵物行為逐位元組不變）；
      // 2. 狀態檔要求 shared → 使用者明確要 DSH 的共享行為；
      // 3. 沒有明確對象（沒點名、也沒 session）→ 保守起見維持共享，不擅自挑一隻。
      const useGlobal = pets.length <= 1 || shared || !target.explicit;

      if (useGlobal) {
        // 從指派模式切回共享模式時，先把逐寵物的殘留清掉（否則兩邊會同時反應）。
        if (petLoops.size > 0) {
          for (const petId of [...petLoops.keys()]) stopPetLoop(petId);
          globalCleared = false;
        }
        // 共享模式：所有寵物一起反應 → 每隻都記成同一個狀態（與 DSH 的廣播語意一致）。
        for (const pet of pets) {
          petWorkStates.set(pet.id, { state: snapshot.state, task: snapshot.task, at: Date.now() });
        }
        await send(snapshot);
        return;
      }

      // 指派模式：先確保全局是空的（單寵物時代留下的），再投遞給目標寵物。
      if (!globalCleared) {
        globalCleared = true;
        await fetch(`${origin}/dsh-pet-7340/work-status`, {
          method: 'DELETE',
          headers: { 'x-dsh-pet-token': token },
        }).catch(() => undefined);
      }
      // 換了目標：舊目標的循環重播要停掉（否則舊寵物會一直播工作動畫）。
      for (const petId of [...petLoops.keys()]) {
        if (petId !== target.petId) stopPetLoop(petId);
      }
      const pet = pets.find((item) => item.id === target.petId);
      if (!pet) {
        // 目標寵物不存在 → 退回全局（寧可讓所有寵物一起反應，也不要沒有反應）。
        await send(snapshot);
        return;
      }
      // 指派模式：只有目標寵物有狀態，其餘維持原狀（沒有紀錄＝不在工作）。
      petWorkStates.set(pet.id, { state: snapshot.state, task: snapshot.task, at: Date.now() });
      logger.info(`工作狀態投遞：寵物 ${pet.id}（${target.reason}）· ${snapshot.state ?? '（空閒）'}`);
      await sendPerPet(pet, snapshot);
    });

    // 逐寵物的循環重播檢查：狀態沒變也要跑（動畫可能播完了）。
    pendingLoopCheck = petLoops.size > 0;
    if (pendingLoopCheck) {
      queue = queue.then(() => refreshPetLoops());
    }
  };

  return {
    /** 開始輪詢。 */
    start() {
      if (pollTimer !== null) return;
      pollTimer = setInterval(tick, pollMs);
      pollTimer.unref?.();
      // 先打一拍：狀態檔可能已經有內容了，等第一個週期會白等 250ms。
      tick();
    },
    /** 停止輪詢（主機退出時呼叫）。 */
    stop() {
      stopped = true;
      if (pollTimer !== null) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      if (flushTimer !== null) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
    },
    /** 手動觸發一拍（自檢用）。 */
    tick,
    /** 目前已發布的內容（自檢與摘要用）。 */
    current: () => ({ key: publishedKey, state: publishedState, at: publishedAt }),
    /**
     * 每隻寵物目前的工作狀態（主機自己的視圖）。
     *
     * 為什麼需要：DSH 的工作狀態只有全局一份，「哪隻寵物正在工作」這個資訊
     * 在 DSH 那邊不存在，必須由主機自己記。形狀刻意做成葉子樣（{counter,data}），
     * 與 DSH 的 /state 葉子同構 —— 這樣消費端處理兩種來源的程式碼是同一套。
     */
    petWorkStates: () =>
      Object.fromEntries(
        [...petWorkStates.entries()].map(([petId, item]) => [
          petId,
          { counter: item.at, data: { state: item.state, task: item.task } },
        ]),
      ),
  };
}
