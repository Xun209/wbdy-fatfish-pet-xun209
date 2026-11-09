/**
 * pet-host 的日誌出口。
 *
 * 為什麼自己寫而不用 DSH 的 logger：DSH 那份是「檔案 logger + 終端 base」的組合，
 * 依賴它就等於依賴它寫死的落盤路徑（$DSH_HOME/dsh-pet/logs.txt）。
 * pet-host 的日誌要同時落到「使用者的 WorkBuddy 狀態目錄」與終端，
 * 而且必須在 DSH 套件缺失時也能單獨工作（啟動早期還沒載入 DSH）。
 *
 * 風格約束（與 DSH 一致）：
 * - 等級用 DSH 的四檔：info / warn / error / debug；
 * - 訊息一律中文，且要寫「為什麼」而不是「做了什麼」；
 * - 錯誤必須在終端看得見，不允許靜默吞掉。
 * @module wbdy-fatfish-pet/pet-host/lib/logger
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** 日誌等級；與 DSH 宿主 ctx.logger 的四檔同名，方便直接塞進偽 ctx。 */
export const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * 建立一個日誌器。
 *
 * @param {object} options - 選項。
 * @param {string} [options.file] - 落盤檔案；不給就只寫終端。
 * @param {boolean} [options.debug] - 是否輸出 debug 級。
 * @param {string} [options.prefix] - 每行前綴（預設 '[pet-host]'）。
 * @returns {object} logger，含 info/warn/error/debug 四個方法與 flush。
 */
export function createLogger({ file, debug = false, prefix = '[pet-host]' } = {}) {
  if (file) {
    try {
      mkdirSync(dirname(file), { recursive: true });
    } catch {
      /* 落盤失敗不該讓主機起不來：終端輸出仍然有效 */
    }
  }

  const emit = (level, message) => {
    if (LEVELS[level] < LEVELS.info && !debug && level === 'debug') return;
    const stamp = new Date().toISOString().slice(11, 19);
    const line = `${stamp} ${prefix} ${level.toUpperCase().padEnd(5)} ${message}`;
    // 終端永遠輸出（除 debug 外）：使用者在終端看不到的錯誤等於沒有錯誤。
    if (level !== 'debug' || debug) {
      if (level === 'error') process.stderr.write(line + '\n');
      else process.stdout.write(line + '\n');
    }
    if (!file) return;
    try {
      appendFileSync(file, new Date().toISOString() + ' ' + level + ' ' + message + '\n', 'utf8');
    } catch {
      /* 落盤失敗不影響主流程 */
    }
  };

  return {
    debug: (message) => emit('debug', message),
    info: (message) => emit('info', message),
    warn: (message) => emit('warn', message),
    error: (message) => emit('error', message),
    /** DSH 的 ctx.logger 介面只用到這四個方法；這個名字只是為了語意清楚。 */
    flush: () => {},
  };
}
