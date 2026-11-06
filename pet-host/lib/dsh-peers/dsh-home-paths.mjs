/**
 * DSH 專用套件的「獨立模式降級替身」——`@deepseek-ai/dsh-home-paths`。
 *
 * 為什麼需要它：DSH pet 的宿主半側（`lib/index.js`）在 DSH 內部 static import 了三個
 * `@deepseek-ai/*` 套件；在沒有 DSH 的機器上這些套件不存在，import 會直接
 * ERR_MODULE_NOT_FOUND，整個寵物主機起不來。
 *
 * DSH 自己處理過同一個問題：`src/standalone/shims/dsh-home-paths.ts` 就是它的降級替身
 * （轉調插件自己的 `dshHomeDir`）。本檔是同一個思路的獨立實作，
 * 行為與官方套件 `resolveDshHome()` 一致：顯式路徑 > $DSH_HOME > ~/.dsh。
 *
 * 這個套件只提供路徑解析，不做任何 I/O。
 * @module wbdy-fatfish-pet/pet-host/lib/dsh-peers/dsh-home-paths
 */

import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/** DSH 主目錄的環境變數名（與官方套件同名，行為才對得上）。 */
export const DSH_HOME_ENV = 'DSH_HOME';

/** 預設主目錄名（~/.dsh）。 */
export const DSH_HOME_DIR_NAME = '.dsh';

/**
 * 解析 DSH 主目錄。
 *
 * @param {string} [configured] - 顯式指定的路徑（優先度最高）。
 * @param {Record<string,string|undefined>} [env] - 環境變數映射（測試可注入）。
 * @returns {string} 絕對路徑。
 */
export function resolveDshHome(configured, env = process.env) {
  const fromEnv = env[DSH_HOME_ENV];
  const chosen =
    configured ?? (fromEnv !== undefined && fromEnv.trim().length > 0 ? fromEnv : join(homedir(), DSH_HOME_DIR_NAME));
  return resolve(chosen);
}

/** 主目錄下的路徑拼接（與官方套件同名函式同義）。 */
export function dshHomePath(...segments) {
  return join(resolveDshHome(), ...segments);
}

export default { resolveDshHome, dshHomePath, DSH_HOME_ENV, DSH_HOME_DIR_NAME };
