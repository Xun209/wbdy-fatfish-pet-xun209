/**
 * WorkBuddy 桌面端的存活判定：桌寵要不要跟著它一起退出。
 *
 * 【為什麼要偵測】
 *   桌寵是 WorkBuddy 的「隨身寵物」：WorkBuddy 徹底關閉時，桌寵不該繼續留在桌面上
 *   （使用者看到的應該是「連同 WorkBuddy 一起收工」）。
 *   但「窗口關掉 ≠ WorkBuddy 關了」——它可以縮到托盤／背景繼續跑，
 *   這種情況下桌寵**必須活著**（Agent 還在工作，寵物還要報狀態）。
 *   所以判定的對象是**行程**，不是視窗。
 *
 * 【怎麼判】
 *   用 tasklist 查 `WorkBuddy.exe` 這個影像名：視窗關不影響它，行程結束才會消失。
 *   刻意不用「視窗是否存在」那套 API —— 那會把「縮到背景」誤判成關閉。
 *
 * 【查詢失敗 ≠ 關閉】
 *   tasklist 偶爾會逾時或被權限擋住。那種情況回「查不到」而不是「沒在跑」，
 *   否則一次抽風就讓桌寵跟著退出去了。
 *
 * @module wbdy-fatfish-pet/pet-host/lib/workbuddy-liveness
 */

import { execFile } from 'node:child_process';

/** 查詢逾時（毫秒）：逾時回「查不到」，不判定為已關閉。 */
const PROBE_TIMEOUT_MS = 8000;

/**
 * 從 tasklist 的輸出裡判斷「有沒有這個行程」。
 *
 * ★ 為什麼不能用「有沒有匹配項」那行文字來判：
 *   tasklist 的輸出**跟隨系統語言**（簡體中文系統回「信息: 没有运行的任务匹配指定标准。」），
 *   而且那行是 GBK 編碼 —— Node 預設按 UTF-8 解碼，得到的是亂碼，比對字串必然出錯
 *   （簡體中文機器上會把「沒有匹配」誤判成「有行程」，於是這個功能等於失效）。
 *   所以改用**結構**判斷：匹配到時 tasklist 會印出以行程名開頭的一行表格
 *   （「<影像名> <PID> ...」），沒有匹配時只印一行提示。
 *   → 判「輸出行裡有沒有出現影像名本身」就與語言無關了。
 *
 * @param {string} text - tasklist 的輸出（編碼可能是 GBK，但影像名是 ASCII，不受影響）。
 * @param {string} imageName - 目標影像名。
 * @returns {boolean} 有匹配項為 true。
 */
function hasProcessLine(text, imageName) {
  return text
    .split(/\r?\n/)
    .some((line) => line.trim().toLowerCase().startsWith(imageName.toLowerCase()));
}

/**
 * 目標影像名：預設 WorkBuddy.exe。
 *
 * 環境變數 `WORKBUDDY_PET_LIVENESS_IMAGE` 可覆寫 —— 測試要用一份「複製出來的
 * cmd.exe」假冒 WorkBuddy（tasklist 只認影像名），走真行程才能驗到行為。
 */
const IMAGE_NAME = process.env.WORKBUDDY_PET_LIVENESS_IMAGE || 'WorkBuddy.exe';

/**
 * 查一次 WorkBuddy 是否還在跑。
 *
 * @param {object} [options] - 選項。
 * @param {string} [options.imageName] - 目標影像名（預設 WorkBuddy.exe）。
 * @returns {Promise<boolean | undefined>} true=在跑；false=確定沒在跑；undefined=查不到（不當成沒在跑）。
 */
export function probeWorkBuddy(options = {}) {
  const imageName = options.imageName || IMAGE_NAME;
  return new Promise((resolve) => {
    execFile(
      'tasklist',
      ['/FI', `IMAGENAME eq ${imageName}`, '/NH'],
      { timeout: PROBE_TIMEOUT_MS, windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        const text = String(stdout || '');
        if (error && !text) {
          // 查詢失敗（逾時 / 權限 / tasklist 不可用）：回 undefined，別當成「沒在跑」。
          resolve(undefined);
          return;
        }
        // 結構判斷（與系統語言無關）：輸出行裡出現影像名本身才算有這個行程。
        resolve(hasProcessLine(text, imageName));
      },
    );
  });
}

/**
 * 等 WorkBuddy 起來。
 *
 * 為什麼要等而不是直接退出：使用者常常是「先開 WorkBuddy、再啟動寵物」，
 * 順序反了一下就讓他重來一次很彆扭。等它出現就繼續，���用者不用管順序。
 * 超時才放棄（回 false）。
 *
 * @param {object} options - 選項。
 * @param {number} [options.timeoutMs] - 最長等待（毫秒）。
 * @param {number} [options.intervalMs] - 輪詢間隔（毫秒）。
 * @param {object} [options.logger] - 日誌出口。
 * @returns {Promise<boolean>} WorkBuddy 已在跑為 true；逾時為 false。
 */
export async function waitForWorkBuddy({ timeoutMs = 600000, intervalMs = 3000, logger, imageName } = {}) {
  const startedAt = Date.now();
  let announced = false;
  for (;;) {
    const alive = await probeWorkBuddy(imageName ? { imageName } : {});
    if (alive === true) return true;
    if (!announced) {
      announced = true;
      logger?.warn?.('還沒偵測到 WorkBuddy 在執行 → 等它啟動（最多 10 分鐘）…');
    }
    if (Date.now() - startedAt >= timeoutMs) return false;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/**
 * 建立一個「跟著 WorkBuddy 生死」的管理器。
 *
 * 判定策略（避免誤殺）：
 *   - 只有**確定**查不到行程才算它關了；
 *   - 連續兩次確定沒在跑才退出（單次查詢異常不致於讓桌寵跟著收工）；
 *   - 查詢失敗（undefined）不計入「沒在跑」的次數。
 *
 * @param {object} options - 選項。
 * @param {number} [options.intervalMs] - 輪詢間隔（毫秒）。
 * @param {() => void} options.onClosed - 判定 WorkBuddy 已關閉時的回呼（桌寵據此退出）。
 * @param {object} [options.logger] - 日誌出口。
 * @returns {{stop: () => void, checkNow: () => Promise<boolean | undefined>}} 管理器。
 */
export function createWorkBuddyWatcher({ intervalMs = 3000, onClosed, logger, imageName } = {}) {
  let stopped = false;
  let missingCount = 0;
  let timer = null;

  /**
   * 查一次並更新狀態。
   * @returns {Promise<boolean | undefined>} WorkBuddy 是否在跑。
   */
  const checkNow = async () => {
    if (stopped) return undefined;
    const alive = await probeWorkBuddy(imageName ? { imageName } : {});
    if (alive === true) {
      missingCount = 0;
      return true;
    }
    if (alive === false) {
      missingCount += 1;
      // 連續兩次都確定沒在跑 → 判定它真的關了（單次可能是剛好在重啟的縫隙）
      if (missingCount >= 2) {
        stopped = true;
        if (timer) {
          clearInterval(timer);
          timer = null;
        }
        logger?.info?.('偵測到 WorkBuddy 已關閉 → 寵物主機跟著退出');
        onClosed?.();
        return false;
      }
      return false;
    }
    // undefined = 查不到：維持原狀，不累加計數
    return undefined;
  };

  timer = setInterval(() => {
    void checkNow();
  }, intervalMs);
  // 不吊住宿主行程
  timer.unref?.();

  return {
    stop() {
      stopped = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    checkNow,
  };
}
