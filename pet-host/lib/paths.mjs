/**
 * pet-host 的路徑推導：狀態目錄、插件根、DSH pet 套件根、Electron 候選。
 *
 * 為什麼把路徑集中在這裡：同一個路徑在多處拼出來，改了一處另一處沒改，
 * 症狀是「設定寫進 A 目錄、讀的却是 B 目錄」——這種 bug 最難查，所以只留這一份推導。
 *
 * 與 `scripts/wb-state-store.mjs` 的關係：狀態目錄的優先序由那份定義（hook 與 MCP 也用同一份），
 * 這裡優先 import 它；拿不到時（打包遺漏）退回本地的同口徑實作，並在日誌裡說明。
 * @module wbdy-fatfish-pet/pet-host/lib/paths
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** 本檔案所在目錄（pet-host/lib）。 */
const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * WorkBuddy 插件根（wbdy-fatfish-pet）。
 *
 * 推導自本檔案位置而不是環境變數：插件可能被複製到任何位置，
 * 寫死絕對路徑只會在別的機器上壞掉。
 */
export const PLUGIN_ROOT = resolve(HERE, '..', '..');

/**
 * 本地同口徑的狀態目錄推導（僅在拿不到 scripts/wb-state-store.mjs 時使用）。
 *
 * 必須與 wb-state-store.mjs 的 resolveStateDir **完全同序**：
 * WORKBUDDY_WHALE_STATE_DIR → %LOCALAPPDATA%\workbuddy-whale → ~/.workbuddy-whale
 * → CODEBUDDY_PLUGIN_DATA / CLAUDE_PLUGIN_DATA。
 *
 * 注意「插件資料目錄排在最後」：hook 行程帶著 CODEBUDDY_PLUGIN_DATA、寵物主機卻沒有，
 * 若讓它優先，兩邊就會各寫各的。把它放到最後，兩邊才會落在同一個確定性預設上。
 */
function fallbackStateDir(env = process.env) {
  const override = (env.WORKBUDDY_WHALE_STATE_DIR || '').trim();
  if (override) return override;
  const localAppData = (env.LOCALAPPDATA || '').trim();
  if (localAppData) return join(localAppData, 'workbuddy-whale');
  const pluginData = (env.CODEBUDDY_PLUGIN_DATA || env.CLAUDE_PLUGIN_DATA || '').trim();
  if (pluginData) return pluginData;
  return join(homedir(), '.workbuddy-whale');
}

/**
 * 讀「指路牌」：hook 行程會把實際使用的狀態目錄寫進 fallback 目錄的 state-dir.txt。
 *
 * 為什麼需要：預設情況下兩邊都落在「確定性預設」目錄，指路牌用不到；
 * 但若使用者把 WORKBUDDY_WHALE_STATE_DIR 指到別處，hook 會寫那裡、
 * 而手動啟動的寵物主機（沒有那個環境變數）就只能靠指路牌找回來。
 *
 * 指路牌可能過期（使用者改回預設後，指路牌不會被清掉），所以只認「它的狀態檔比
 * fallback 目錄的更新」的那一個 —— hook 現在寫在哪個目錄，那個目錄的 state.json 就是最新的。
 *
 * @param {string} fallbackDir - fallback 目錄（指路牌就寫在這裡）。
 * @returns {string} 指路牌指向的目錄；不可信或不存在時回空字串。
 */
function readStateDirPointer(fallbackDir) {
  try {
    const pointerFile = join(fallbackDir, 'state-dir.txt');
    if (!existsSync(pointerFile)) return '';
    const pointed = readFileSync(pointerFile, 'utf8').trim();
    if (!pointed || !existsSync(pointed)) return '';
    // 指路牌要「比 fallback 新」才可信：hook 正在寫的那個目錄，狀態檔一定是最新的。
    const pointedState = statSync(join(pointed, 'state.json'), { throwIfNoEntry: false });
    const fallbackState = statSync(join(fallbackDir, 'state.json'), { throwIfNoEntry: false });
    if (fallbackState && (!pointedState || fallbackState.mtimeMs >= pointedState.mtimeMs)) return '';
    return pointed;
  } catch {
    return '';
  }
}

/**
 * 狀態目錄。
 *
 * 優先序（由高到低）：
 * 1. WORKBUDDY_WHALE_STATE_DIR —— 明確覆寫（hook 端的第一條規則，必須一致）；
 * 2. 指路牌 <fallback>/state-dir.txt —— 只在它確實比 fallback 新時才採信；
 * 3. scripts/wb-state-store.mjs 的 resolveStateDir() —— **單一真實來源**，
 *    與 hook 端呼叫的是同一個函式 → 兩邊不可能算出不同結果；
 * 4. 本檔的同口徑實作（共用模組不可用時的兜底）。
 *
 * 【為什麼第 3 步是主體、第 2 步只是補充】
 * 共用模組把「確定性預設」定成 %LOCALAPPDATA%\workbuddy-whale（不依賴環境變數），
 * 就是為了讓 hook 與寵物主機「各自算也必定相同」。本檔若自己另訂一套優先序
 * （例如讓 CODEBUDDY_PLUGIN_DATA 優先），就會與 hook 分道揚鑣 —— 症狀是
 * 「狀態檔明明存在，寵物卻完全不反應」，而且非常難查。
 *
 * @returns {Promise<{dir: string, source: string}>} 目錄與來源說明（來源要寫進日誌，
 *   否則使用者會困惑「為什麼我的 WORKBUDDY_WHALE_STATE_DIR 沒生效」）。
 */
export async function resolveStateDir() {
  const fallback = fallbackStateDir({
    ...process.env,
    WORKBUDDY_WHALE_STATE_DIR: '',
  });
  const explicit = (process.env.WORKBUDDY_WHALE_STATE_DIR || '').trim();
  if (explicit) return { dir: explicit, source: '環境變數 WORKBUDDY_WHALE_STATE_DIR' };

  // 指路牌：只有當它指向的目錄「確實正在被寫」時才採信（狀態檔比 fallback 新）。
  const pointed = readStateDirPointer(fallback);
  if (pointed) {
    return { dir: pointed, source: `指路牌 ${join(fallback, 'state-dir.txt')}（hook 行程實際寫入的位置）` };
  }

  // 單一真實來源：與 hook 端呼叫同一個函式，兩邊不可能算出不同結果。
  try {
    const mod = await import(pathToFileURL(join(PLUGIN_ROOT, 'scripts', 'wb-state-store.mjs')).href);
    if (typeof mod.resolveStateDir === 'function') {
      const dir = mod.resolveStateDir(process.env);
      if (dir) return { dir, source: 'scripts/wb-state-store.mjs（與 hook 端同一口徑）' };
    }
  } catch {
    /* 打包遺漏或檔案損毀：退回本地實作，功能不減 */
  }

  return { dir: fallback, source: 'pet-host 內建推導（找不到 scripts/wb-state-store.mjs）' };
}

/** 狀態檔路徑：<狀態目錄>/state.json（與 hook / MCP 端同名同位置）。 */
export function stateFilePath(dir) {
  return join(dir, 'state.json');
}

/**
 * pet-host 自己的家目錄：<狀態目錄>/pet-host。
 *
 * 與 WorkBuddy 的狀態檔放在一起但不混在根目錄：主機會寫不少自己的東西
 * （設定副本、日誌、臨時檔），跟 hook 共用根目錄會讓兩邊互相踩。
 */
export function petHostHome(stateDir) {
  return join(stateDir, 'pet-host');
}

/**
 * 注入給 DSH pet 宿主半側的 DSH_HOME。
 *
 * 為什麼要獨立一份：DSH pet 會在 $DSH_HOME/dsh-pet 下放設定、日誌、對話記憶、待辦。
 * 用 WorkBuddy 的狀態目錄會讓這些東西和 hook 的狀態檔混在一起；
 * 獨立一份則「刪掉 pet-host 目錄」就等於「把桌寵恢復出厂設定」。
 */
export function dshHome(stateDir) {
  return join(petHostHome(stateDir), 'dsh-home');
}

/**
 * session → 寵物的綁定檔路徑。
 *
 * 放在 pet-host 自己的家目錄（不跟 hook 的狀態檔混在一起）：
 * 這是**主機側**的推論結果（哪個對話配哪隻寵物），不是 hook 寫的狀態。
 * 落盤的理由：主機重啟後綁定不該洗牌 —— 使用者期待「那個對話一直是那隻鯨魚在陪」。
 *
 * @param {string} stateDir - 狀態目錄。
 * @returns {string} 綁定檔的絕對路徑。
 */
export function sessionBindingFile(stateDir) {
  return join(petHostHome(stateDir), 'pet-sessions.json');
}

/**
 * 候選的 DSH pet 套件根。
 *
 * 順序即優先序：
 * 1. 明確指定（--dsh-pet-root / DSH_PET_PACKAGE_ROOT）；
 * 2. 插件根本身——插件已經把 assets/ 與 runtime/electron-helper/ 放在根目錄，
 *    只要再放一份 lib/ 進去，整個插件就是一個「可運行的 dsh-pet 套件」；
 * 3. 插件根下的 vendor/dsh-pet（另一種常見擺法）；
 * 4. 開發期的相對/絕對路徑（沒打包時的救命繩）。
 */
export function dshPetRootCandidates(explicit) {
  const fromEnv = (process.env.DSH_PET_PACKAGE_ROOT || '').trim();
  const list = [];
  if (explicit) list.push(explicit);
  if (fromEnv) list.push(fromEnv);
  list.push(PLUGIN_ROOT);
  list.push(join(PLUGIN_ROOT, 'vendor', 'dsh-pet'));
  list.push(resolve(PLUGIN_ROOT, '..', '..', '..', 'dsh-whale', 'dsh-pet', 'dsh-pet'));
  list.push('E:\\真。摸鱼\\dsh-whale\\dsh-pet\\dsh-pet');
  return list;
}

/**
 * 判定一個目錄是不是可用的 DSH pet 套件根。
 *
 * 三樣東西缺一不可：宿主入口（lib/index.js）、預設設定（assets/config.jsonc）、
 * 桌面執行殼（runtime/electron-helper/main.js）。少了 runtime 只能跑服務不能開小窗，
 * 但那種情況應該報錯而不是靜默降級——使用者要的是「桌寵」，不是「一個 HTTP 服務」。
 */
export function isDshPetRoot(root) {
  if (!root) return false;
  return (
    existsSync(join(root, 'lib', 'index.js')) &&
    existsSync(join(root, 'assets', 'config.jsonc')) &&
    existsSync(join(root, 'runtime', 'electron-helper', 'main.js'))
  );
}

/**
 * 找出可用的 DSH pet 套件根。
 *
 * @param {string} [explicit] - 使用者明確指定的路徑。
 * @returns {{root: string, checked: string[]}} 命中的根與檢查過的候選（錯誤訊息要能列出來）。
 */
export function resolveDshPetRoot(explicit) {
  const checked = dshPetRootCandidates(explicit);
  for (const candidate of checked) {
    if (isDshPetRoot(candidate)) return { root: resolve(candidate), checked };
  }
  return { root: '', checked };
}

/**
 * Electron 可執行檔的候選路徑（依序取第一個存在的）。
 *
 * 為什麼不自己下載：DSH pet 的 `ensureElectronDownload` 已經把下載與解壓寫好了
 * （含鏡像、SHA 校驗、npmmirror 預設），重複實作只會多一份 100MB 的下載邏輯。
 * 找不到時 DSH 會自己下載到「本次注入的 DSH_HOME/electron」並把進度寫進日誌。
 *
 * 為什麼要列多個 home：我們把 DSH_HOME 指到 WorkBuddy 自己的目錄（避免與使用者的
 * ~/.dsh 混在一起），但 Electron 早就躺在 ~/.dsh/electron 裡了——不先找它就會重下 100MB。
 *
 * @param {string} dshPetRoot - DSH pet 套件根。
 * @param {string[]} homes - 依序搜尋的家目錄（~/.dsh、WorkBuddy 自己的 home）。
 * @returns {string[]} 候選路徑。
 */
export function electronCandidates(dshPetRoot, homes) {
  const platform = process.platform;
  const exe =
    platform === 'win32'
      ? join('electron', 'electron.exe')
      : platform === 'darwin'
        ? join('electron', 'Electron.app', 'Contents', 'MacOS', 'Electron')
        : join('electron', 'electron');
  const list = [];
  const fromEnv = (process.env.DSH_PET_ELECTRON_PATH || '').trim();
  if (fromEnv) list.push(fromEnv);
  for (const home of homes) list.push(join(home, exe));
  list.push(join(dshPetRoot, 'node_modules', 'electron', 'dist', platform === 'win32' ? 'electron.exe' : 'electron'));
  return list;
}

/** 使用者家目錄下的 DSH 主目錄（~/.dsh）；Electron 與舊資料都在這裡。 */
export function classicDshHome() {
  return join(homedir(), '.dsh');
}
