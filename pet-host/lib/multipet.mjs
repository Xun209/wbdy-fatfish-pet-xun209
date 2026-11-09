/**
 * 多寵物：寵物清單、session→寵物綁定、工作狀態的目標寵物解析。
 *
 * 【DSH 端對多寵物的真實要求】(2026-11 實測，檔案行號為 DSH pet v0.3.8)
 *
 * 1. `/state` 的 pets 區塊**本來就是 per-pet 的**：
 *    `PollStateStore.pets` 是 `Map<petId, {say,anim,position,throw,lock,sleep}>`，
 *    每個葉子都是 `{counter,data}`（src/host/state.ts:136-151、:24-31）。
 *    但**每隻寵物只有六種葉子，沒有 workStatus** —— workStatus 是**全局段**
 *    `sections.workStatus`（src/host/state.ts:24）。
 *
 * 2. `POST /dsh-pet-7340/work-status` **沒有 pet 參數**：
 *    它寫進的是固定會話 id `api` 的**外部槽**（src/host/routes/state.ts:110-152、
 *    src/host/plugin/setup.ts:207），落到全局的 sections.workStatus。
 *    → 「多隻的狀態要怎麼分」在 DSH 的答案是：**不分**。
 *
 * 3. 桌面渲染端把全局工作狀態**廣播給所有寵物**：
 *    `applyWorkStatusLeaf` 對每個 sprite 都呼叫（runtime/electron-helper/events.js:313-319），
 *    每隻寵物只用自己的 `workStatusEnabled` 開關門控（events.js:15）。
 *    註解寫得很直白：「sections.workStatus 是所有宠物共用一份」。
 *
 * 4. 但**逐寵物的葉子是逐寵物分發的**：applySayLeaf / applyAnimLeaf / applyPositionLeaf /
 *    applyThrowLeaf / applyLockLeaf / applySleepLeaf 都按 `s.pet.id !== petId` 過濾
 *    （events.js:295-393）。→ 這是本專案「指派」模式唯一可用的通道。
 *
 * 5. 桌面 Helper **本來就支援多寵物**：`DSH_PET_PETS`（[{id,size}]）→ 每隻一個透明置頂小窗
 *    （runtime/electron-helper/main/windows.js:94-108 petsFromEnv、:285-289 createPetWindows）。
 *
 * 【本模組的定位】
 * DSH 的模型是「一份工作狀態、所有寵物共用」。WorkBuddy 想要的是「哪隻寵物正在工作」。
 * 兩者的差別由這裡決定：**單寵物時完全不動現有行為**（走全局，與 DSH 一模一樣）；
 * 多寵物時才啟用「指派」，把狀態投遞到指定的那一隻，其餘不動。
 *
 * @module wbdy-fatfish-pet/pet-host/lib/multipet
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** DSH 的六個工作狀態檔位；索引與 `animations.events.workStatus` 陣列順序嚴格一致。 */
export const WORK_STATUS_STATES = ['thinking', 'working', 'result', 'waiting', 'success', 'error'];

/** 檔位 → 動畫池索引（與 DSH 的 shared/work-status.ts:14-21 相同）。 */
export const WORK_STATUS_INDEX = {
  thinking: 0,
  working: 1,
  result: 2,
  waiting: 3,
  success: 4,
  error: 5,
};

/**
 * 一隻寵物在多寵物視角下的樣子（只帶我們用得到的欄位）。
 *
 * 用 JSDoc 而不是 TypeScript 的 interface：這個目錄全是 .mjs（Node 直接執行），
 * `interface` / `type` 宣告在 .mjs 裡是語法錯誤（打包腳本的語法閘門會擋下來）。
 *
 * @typedef {object} PetInfo
 * @property {string} id 寵物 id（設定檔裡的識別碼）。
 * @property {string} name 顯示名。
 * @property {number} size 寬度 px。
 * @property {string} display 顯示位置：web / desktop / both / none。
 * @property {boolean} workStatusEnabled 是否跟隨工作狀態（DSH 的 per-pet 開關）。
 * @property {string} entry 所屬條目 key（= 素材根）。
 * @property {unknown[]} pool 該條目的工作狀態動畫池（槽位可能是字串或候選陣列）。
 * @property {string[][]} texts 該條目的工作狀態氣泡文案（六檔，每檔多個候選）。
 */

/**
 * 從 `GET /dsh-pet-7340/config` 組出寵物清單。
 *
 * 為什麼走 HTTP 而不是自己解析設定檔：/config 回的是「合併並填滿後的成品」，
 * 與寵物本體看到的是同一份；自己解析 JSONC 會多出一份第二口徑，兩邊一定會漂移。
 *
 * @param {string} origin - 寵物服務 origin。
 * @returns {Promise<PetInfo[]>} 寵物清單（設定讀不到時回空陣列，不讓主機因此起不來）。
 */
export async function loadPetList(origin) {
  try {
    const response = await fetch(`${origin}/dsh-pet-7340/config`);
    if (!response.ok) return [];
    const merged = await response.json();
    const out = [];
    for (const [entry, conf] of Object.entries(merged ?? {})) {
      if (!conf || typeof conf !== 'object') continue;
      const animations = conf.animations ?? {};
      const pool = Array.isArray(animations.events?.workStatus) ? animations.events.workStatus : [];
      const texts = Array.isArray(conf.workStatusTexts) ? conf.workStatusTexts : [];
      for (const pet of Array.isArray(conf.pets) ? conf.pets : []) {
        if (!pet || typeof pet !== 'object') continue;
        out.push({
          id: String(pet.id ?? ''),
          name: String(pet.name ?? pet.id ?? ''),
          size: Number(pet.size ?? 462),
          display: String(pet.display ?? 'both'),
          workStatusEnabled: pet.workStatusEnabled !== false,
          entry: String(entry),
          pool,
          texts,
        });
      }
    }
    return out.filter((pet) => pet.id !== '');
  } catch {
    return [];
  }
}

/**
 * session → 寵物的綁定表。
 *
 * 【為什麼需要綁定，而不是「誰在工作就給誰」】
 * WorkBuddy 同一時間通常只有一個 Agent 在干活，但使用者可能同時開好幾個對話（多個 session）。
 * 若不綁定，多隻寵物時「哪隻該表現忙碌」就只能靠猜（第一隻？隨機？輪流？），
 * 使用者會看到寵物反覆換邊做同一件事。
 * 綁定把「session → 哪隻寵物」固定下來：**同一個對話永遠由同一隻寵物陪著**，
 * 重啟主機也不會洗牌（綁定落盤）。
 *
 * 【綁定規則：先到先得】
 * 某個 session 第一次出現時，依設定檔順序指派**第一隻還沒被綁定的**寵物。
 * 為什麼是先到先得而不是輪流：輪流會讓寵物在你講話講到一半時換人接���，
 * 語意上錯亂；先到先得則是「第一個對話配第一隻寵物」，可預期、可記憶。
 *
 * 【綁不滿時的退路】
 * 所有能綁的寵物都被綁走了 → 綁到**主寵物**（第一隻 workStatusEnabled 的）並記一次告警。
 * 寧可讓兩隻寵物陪同一個對話，也不要讓新對話完全沒有寵物反應。
 *
 * @param {object} options - 選項。
 * @param {string} options.file - 綁定檔路徑（落盤，位於插件自己的家目錄下）。
 * @param {object} options.logger - 日誌。
 * @returns {object} 綁定器。
 */
export function createSessionBinder({ file, logger }) {
  /** session_id → petId。 */
  let bindings = {};
  /** 落盤過的檔案是否存在（不存在就不寫，避免產生空檔）。 */
  let loaded = false;

  try {
    if (file && existsSync(file)) {
      const parsed = JSON.parse(readFileSync(file, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        bindings = Object.fromEntries(
          Object.entries(parsed).filter(([, petId]) => typeof petId === 'string' && petId !== ''),
        );
      }
      loaded = true;
    }
  } catch {
    // 綁定檔壞掉：當成沒有綁定，重新指派即可（不該讓主機因此起不來）。
    bindings = {};
  }

  /** 把綁定寫回磁碟（先寫暫存再 rename，避免半截 JSON）。 */
  const persist = () => {
    if (!file) return;
    try {
      mkdirSync(dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, `${JSON.stringify(bindings, null, 2)}\n`, 'utf8');
      renameSync(tmp, file);
    } catch (error) {
      logger.warn(`工作狀態綁定寫入失敗（不影響本回合）：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return {
    /**
     * 查出某個 session 綁到哪隻寵物；沒有就指派一隻並記下來。
     *
     * @param {string} sessionId - session id（空字串視為「沒有 session」）。
     * @param {PetInfo[]} pets - 可綁定的寵物（已過濾掉不能綁的）。
     * @returns {string} 寵物 id；沒有可用寵物時回空字串。
     */
    bind(sessionId, pets) {
      const eligible = pets.filter((pet) => pet.workStatusEnabled);
      const pool = eligible.length > 0 ? eligible : pets;
      if (pool.length === 0) return '';
      if (!sessionId) return pool[0].id;

      const existing = bindings[sessionId];
      // 已經綁的那隻還在配置裡 → 沿用（使用者刪了寵物才會落到這裡）。
      if (existing && pool.some((pet) => pet.id === existing)) return existing;

      // 先到先得：挑第一隻還沒被別的 session 綁走的。
      const taken = new Set(Object.values(bindings));
      const free = pool.find((pet) => !taken.has(pet.id));
      if (free) {
        bindings[sessionId] = free.id;
        if (!loaded) {
          loaded = true;
        }
        persist();
        logger.info(`工作狀態綁定：session ${sessionId} → 寵物 ${free.id}`);
        return free.id;
      }

      // 綁滿了：退到主寵物，並記一次告警（避免每拍刷一次）。
      const primary = pool[0];
      logger.warn(
        `所有可綁定的寵物都已被其他 session 綁走，session ${sessionId} 改由主寵物 ${primary.id} 陪同`,
      );
      return primary.id;
    },

    /** 目前某個 session 綁到哪（沒有則空字串）；不指派。 */
    peek(sessionId) {
      return (sessionId && bindings[sessionId]) || '';
    },

    /** 全部綁定（自檢與觀察用）。 */
    snapshot() {
      return { ...bindings };
    },
  };
}

/**
 * 決定這一拍的狀態要投遞給哪隻寵物。
 *
 * 優先序（由高到低）：
 * 1. 狀態檔的 `pet` 欄位 —— 使用者或 hook 端直接点名，最明確；
 * 2. session 綁定 —— 同一個對話固定由同一隻寵物陪（理由見 createSessionBinder）；
 * 3. 主寵物 —— 第一隻 workStatusEnabled 的（沒有綁定時的預設）。
 *
 * 【explicit 這個欄位為什麼重要】
 * 「沒有明確對象」與「有明確對象」要走**不同的投遞方式**：
 * - 沒有明確對象（狀態檔沒點名、也沒有 session）→ 維持 DSH 的**共享**行為
 *   （所有寵物一起反應）。這是最保守的選擇：沒有對象就不擅自挑一隻。
 * - 有明確對象（點了名、或有 session 可綁）→ **指派**給那隻，其餘不動。
 *
 * 這樣分的另外一個好處：既有��自檢（狀態檔不帶 session）走的仍是全域路徑，
 * 單寵物與多寵物下的既有行為都不會被這次改動影響。
 *
 * @param {object} options - 選項。
 * @param {object} options.snapshot - 狀態檔的原始內容（讀 `pet` / `session_id` 欄位）。
 * @param {PetInfo[]} options.pets - 寵物清單。
 * @param {object} options.binder - 綁定器。
 * @returns {{petId: string, reason: string, explicit: boolean}} 目標寵物、選擇理由與是否明確指定。
 */
export function resolveWorkTarget({ snapshot, pets, binder }) {
  const eligible = pets.filter((pet) => pet.workStatusEnabled);
  const pool = eligible.length > 0 ? eligible : pets;
  if (pool.length === 0) return { petId: '', reason: '沒有可用寵物', explicit: false };

  const record = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const named = typeof record.pet === 'string' ? record.pet.trim() : '';
  if (named) {
    const hit = pool.find((pet) => pet.id === named);
    if (hit) return { petId: hit.id, reason: '狀態檔的 pet 欄位指定', explicit: true };
    // 指定了但配置裡沒有這隻：別靜默改投別人，明說。
    return {
      petId: pool[0].id,
      reason: `狀態檔指定的寵物「${named}」不存在，改由主寵物陪同`,
      explicit: false,
    };
  }

  const sessionId = typeof record.session_id === 'string' ? record.session_id.trim() : '';
  if (sessionId && binder) {
    const bound = binder.bind(sessionId, pool);
    if (bound) return { petId: bound, reason: `session ${sessionId} 的綁定`, explicit: true };
  }

  return { petId: pool[0].id, reason: '主寵物（沒有指定也沒有綁定）', explicit: false };
}

/**
 * 從動畫池裡挑一支工作狀態動畫。
 *
 * 池的槽位可能是字串或候選陣列（DSH 的 events.workStatus 兩種都允許）。
 * 這裡固定取**第一個候選**而不是隨機：同一個狀態持續期間不能換動畫，
 * 否則渲染端會不停換源、動畫看起來在跳。
 *
 * @param {PetInfo} pet - 寵物（帶動畫池）。
 * @param {string} state - 六檔之一。
 * @returns {string} 動畫名；沒有對應動畫時回空字串。
 */
export function pickWorkAnimation(pet, state) {
  const index = WORK_STATUS_INDEX[state];
  if (index === undefined) return '';
  const slot = pet?.pool?.[index];
  if (typeof slot === 'string') return slot;
  if (Array.isArray(slot)) {
    for (const candidate of slot) {
      if (typeof candidate === 'string' && candidate !== '') return candidate;
    }
  }
  return '';
}

/**
 * 工作狀態氣泡文字：任務詳情優先，否則取條目裡該檔的備選句。
 *
 * @param {PetInfo} pet - 寵物（帶文案表）。
 * @param {string} state - 六檔之一。
 * @param {string|null} task - 狀態檔帶來的任務詳情。
 * @returns {string} 文字；沒有可顯示的內容時回空字串。
 */
export function pickWorkText(pet, state, task) {
  const trimmed = typeof task === 'string' ? task.trim() : '';
  if (trimmed !== '') return trimmed;
  const index = WORK_STATUS_INDEX[state];
  if (index === undefined) return '';
  const group = pet?.texts?.[index];
  if (!Array.isArray(group) || group.length === 0) return '';
  const usable = group.filter((line) => typeof line === 'string' && line.trim() !== '');
  if (usable.length === 0) return '';
  return usable[Math.floor(Math.random() * usable.length)];
}

/**
 * 這隻寵物該用哪個 surface 參數去投遞指令。
 *
 * 【為什麼一定要帶 surface】
 * DSH 的 /anim、/broadcast、/bubble/clear、/position、/throw 這幾個端點**強制要求** `?surface=`
 * （src/host/plugin/pet-lookup.ts:97-105、src/host/surface.ts:28-31）：
 * 沒帶或帶錯值會直接回錯，指令根本不會寫進葉子。
 *
 * 【為什麼用 any 而不是 desktop】
 * `any` = 「我不關心是哪一端」，顯示檢查一律放行（src/host/surface.ts:33-41）；
 * 而且它**不會**把 say 葉子的 voiceTo 指向某一端 → 工作狀態氣泡**不會被念出來**，
 * 這與 DSH 的全域路徑一致（全域工作狀態氣泡本來就不念，只有碎碎念／對話才念）。
 *
 * @param {PetInfo} pet - 寵物。
 * @returns {string|null} surface 值；`display: none` 的寵物回 null（不投遞，沒有窗戶可顯示）。
 */
export function deliverySurface(pet) {
  if (!pet || pet.display === 'none') return null;
  return 'any';
}

/**
 * 寵物清單的展示字串（啟動摘要用）。
 *
 * @param {PetInfo[]} pets - 寵物清單。
 * @returns {string} 一行摘要。
 */
export function describePets(pets) {
  if (!pets || pets.length === 0) return '（沒讀到寵物清單）';
  return pets
    .map((pet) => `${pet.name}(id=${pet.id}, size=${pet.size}, display=${pet.display})`)
    .join('  ');
}
