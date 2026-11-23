#!/usr/bin/env node
/**
 * 把本插件裝進 WorkBuddy 的本地市集（零依賴、純 Node）。
 *
 * 【為什麼需要這支腳本】
 *   WorkBuddy 的「插件」不是 npm 安裝的，而是「本地市集目錄 + 幾份 JSON 註冊檔」。
 *   手動做要同時處理市集目錄、快取目錄、`known_marketplaces.json`、
 *   `installed_plugins.json`、`configured-plugins.json`、`settings.json` 的 enabledPlugins
 *   —— 六處，少一處 WorkBuddy 就認不出這個插件。
 *   把這套步驟寫成一支腳本，分享者只要跑一次，不需要理解 WorkBuddy 的內部結構。
 *
 * 【它做什麼】
 *   1. 偵測 WorkBuddy 主目錄（國內版 ~/.workbuddy / 國際版 ~/.workbuddy-ai）
 *   2. 把插件複製到市集目錄（plugins/marketplaces/<市集名>/plugins/<插件名>/）
 *   3. 把插件複製到快取目錄（plugins/cache/<市集名>/<插件名>/<版本>/）—— WorkBuddy 實際載入的是這裡
 *   4. 寫市集清單（.codebuddy-plugin/marketplace.json）
 *   5. 更新四份註冊 JSON，把插件標成已安裝且啟用
 *
 * 【用法】
 *   node tools/install-to-workbuddy.mjs              # 安裝
 *   node tools/install-to-workbuddy.mjs --dry-run    # 只看會做什麼，不動檔案
 *   node tools/install-to-workbuddy.mjs --market <名稱>   # 自訂市集名（預設：<插件名>-local）
 *   node tools/install-to-workbuddy.mjs --disable    # 從註冊檔移除（檔案保留）
 *
 * 【不做什麼】
 *   - 不動 WorkBuddy 內建的任何插件
 *   - 不寫 WorkBuddy 的登入憑據、不改它的設定項（除了 enabledPlugins 裡自己那一條）
 *   - 不啟動寵物主機（啟動是另一件事，見 INSTALL.md 第 3 節）
 *
 * @module wbdy-fatfish-pet/tools/install-to-workbuddy
 */

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const DISABLE = args.includes('--disable');
const marketArg = args.indexOf('--market');
const MARKET = marketArg >= 0 ? args[marketArg + 1] : null;

/** 不複製的檔案與目錄（依賴樹、版本庫、開發殘留、運行期產物）。 */
const SKIP_NAMES = new Set(['node_modules', '.git', '__pycache__', '.in_use', 'dist']);
const SKIP_SUFFIX = /\.(bak|log|pyc|orig)$|\.with\d+-\d+$/;

/**
 * 遞迴列出要複製的相對路徑。
 * @param {string} dir - 來源目錄。
 * @param {string} base - 基準目錄（用來算相對路徑）。
 * @returns {string[]} 相對路徑（用 / 分隔）。
 */
function listFiles(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (SKIP_NAMES.has(name)) continue;
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...listFiles(full, base));
    else if (!SKIP_SUFFIX.test(name)) out.push(full.slice(base.length + 1).replace(/\\/g, '/'));
  }
  return out;
}

/**
 * 讀一個 JSON 檔（不存在回空物件；壞掉就報錯而不是默默蓋掉使用者的設定）。
 * @param {string} file - 檔案路徑。
 * @returns {object} 解析結果。
 */
function readJson(file) {
  if (!existsSync(file)) return {};
  const text = readFileSync(file, 'utf8');
  if (text.trim() === '') return {};
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${file} 解析失敗（請先修好或移走這個檔案）：${error.message}`);
  }
}

/**
 * 寫一個 JSON 檔。
 * @param {string} file - 檔案路徑。
 * @param {object} data - 資料。
 */
function writeJson(file, data) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

/**
 * 找出 WorkBuddy 的主目錄。
 * @returns {string} 主目錄路徑；找不到回空字串。
 */
function findWorkBuddyHome() {
  const candidates = [join(homedir(), '.workbuddy'), join(homedir(), '.workbuddy-ai')];
  for (const dir of candidates) {
    if (existsSync(join(dir, 'plugins'))) return dir;
  }
  // 還沒建立 plugins/ 的（剛安裝 WorkBuddy 的新機）也認：看父目錄存在即可
  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  return '';
}

/**
 * 找出「本插件已經被註冊在哪個市集下」。
 *
 * ★ 這是更新場景的關鍵：使用者可能已經用**別的名稱**裝過舊版
 *   （例如舊版叫 `fatfish-local`，新版預設叫 `fatfish-pet-local`）。
 *   若不理，會建出第二個市集 → WorkBuddy 裡同時掛著兩份同一個插件，
 *   舊的那份還是舊內容（使用者以為更新了，其實沒有）。
 *   所以：先找出舊市集，沿用它（內容原地覆蓋）；找不到才用預設名。
 * @param {string} pluginsDir - WorkBuddy 的 plugins 目錄。
 * @returns {string} 市集名。
 */
function findExistingMarket(pluginsDir) {
  const installedFile = join(pluginsDir, 'installed_plugins.json');
  const installed = readJson(installedFile);
  const plugins = installed.plugins || {};
  for (const [key, entries] of Object.entries(plugins)) {
    const at = key.indexOf('@');
    if (at <= 0) continue;
    if (key.slice(0, at) !== PLUGIN_NAME) continue;
    const market = key.slice(at + 1);
    // 確認這確實是本插件（而不是同名巧合）
    const first = Array.isArray(entries) ? entries[0] : null;
    if (first && typeof first.installPath === 'string' && existsSync(join(first.installPath, '.codebuddy-plugin', 'plugin.json'))) {
      return market;
    }
  }
  return '';
}

// ── 插件自己的身分（名字與版本一律以 plugin.json 為準）────────────────────────
const manifestPath = join(PLUGIN_ROOT, '.codebuddy-plugin', 'plugin.json');
if (!existsSync(manifestPath)) {
  process.stderr.write('install-to-workbuddy: 這不是 WorkBuddy 插件目錄（缺 .codebuddy-plugin/plugin.json）\n');
  process.exit(2);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const PLUGIN_NAME = String(manifest.name || 'fatfish-pet');
const PLUGIN_VERSION = String(manifest.version || '1.0.0');

const home = findWorkBuddyHome();
if (!home) {
  process.stderr.write(
    'install-to-workbuddy: 找不到 WorkBuddy 的資料目錄（~/.workbuddy 或 ~/.workbuddy-ai）。\n' +
      '  請先啟動一次 WorkBuddy（建立資料目錄）再重跑。\n',
  );
  process.exit(2);
}

const pluginsDir = join(home, 'plugins');
// 更新場景：沿用「已經裝過的那個市集名」，不要另起一個（否則會同時掛兩份同一插件）。
const existingMarket = findExistingMarket(pluginsDir);
const MARKET_NAME = MARKET || existingMarket || `${PLUGIN_NAME}-local`;
if (existingMarket && !MARKET) {
  console.log(`[install] 偵測到已安裝於市集「${existingMarket}」→ 原地更新（不另建市集）`);
}
const marketRoot = join(pluginsDir, 'marketplaces', MARKET_NAME);
const marketPluginDir = join(marketRoot, 'plugins', PLUGIN_NAME);
const cacheDir = join(pluginsDir, 'cache', MARKET_NAME, PLUGIN_NAME, PLUGIN_VERSION);

console.log(`[install] WorkBuddy 主目錄 : ${home}`);
console.log(`[install] 插件            : ${PLUGIN_NAME} v${PLUGIN_VERSION}`);
console.log(`[install] 市集            : ${MARKET_NAME}`);

if (DISABLE) {
  const installedFile = join(pluginsDir, 'installed_plugins.json');
  const installed = readJson(installedFile);
  if (installed.plugins) delete installed.plugins[`${PLUGIN_NAME}@${MARKET_NAME}`];
  const settingsFile = join(home, 'settings.json');
  const settings = readJson(settingsFile);
  if (settings.enabledPlugins) delete settings.enabledPlugins[`${PLUGIN_NAME}@${MARKET_NAME}`];
  if (!DRY_RUN) {
    writeJson(installedFile, installed);
    writeJson(settingsFile, settings);
  }
  console.log('[install] 已從註冊檔移除（檔案保留；市集與快取目錄可手動刪除）');
  process.exit(0);
}

// ── 1) 市集目錄 ────────────────────────────────────────────────────────────
const files = listFiles(PLUGIN_ROOT);
console.log(`[install] 檔案數          : ${files.length}`);

const marketManifest = {
  name: MARKET_NAME,
  description: `本機插件市集：${PLUGIN_NAME}`,
  owner: { name: 'local' },
  plugins: [
    {
      name: PLUGIN_NAME,
      description: String(manifest.description || '大肥魚桌寵（WorkBuddy 版）'),
      version: PLUGIN_VERSION,
      source: `./plugins/${PLUGIN_NAME}`,
      category: String(manifest.category || 'tool'),
      license: String(manifest.license || 'MIT'),
    },
  ],
};
const marketManifestPath = join(marketRoot, '.codebuddy-plugin', 'marketplace.json');

if (!DRY_RUN) {
  rmSync(marketPluginDir, { recursive: true, force: true });
  mkdirSync(marketPluginDir, { recursive: true });
  for (const rel of files) {
    const dest = join(marketPluginDir, rel);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(join(PLUGIN_ROOT, rel), dest);
  }
  writeJson(marketManifestPath, marketManifest);
  // 快取：WorkBuddy 實際載入的就是這一份
  rmSync(cacheDir, { recursive: true, force: true });
  mkdirSync(dirname(cacheDir), { recursive: true });
  cpSync(marketPluginDir, cacheDir, { recursive: true });
  // 清掉同一插件的**舊版快取目錄**：版本變了之後舊目錄就是垃圾，留著只會讓人困惑
  // （「我明明更新了，為什麼那個資料夾還是舊的」）。
  const cachePluginRoot = join(pluginsDir, 'cache', MARKET_NAME, PLUGIN_NAME);
  if (existsSync(cachePluginRoot)) {
    for (const name of readdirSync(cachePluginRoot)) {
      if (name === PLUGIN_VERSION) continue;
      rmSync(join(cachePluginRoot, name), { recursive: true, force: true });
      console.log(`[install] 清掉舊版快取     : ${join(cachePluginRoot, name)}`);
    }
  }
}
console.log(`[install] 市集副本        : ${marketPluginDir}`);
console.log(`[install] 快取副本        : ${cacheDir}`);

// ── 2) 註冊檔 ──────────────────────────────────────────────────────────────
const now = new Date().toISOString();
const key = `${PLUGIN_NAME}@${MARKET_NAME}`;

const knownFile = join(pluginsDir, 'known_marketplaces.json');
const known = readJson(knownFile);
known[MARKET_NAME] = {
  manifestName: MARKET_NAME,
  type: 'directory',
  source: { source: 'directory', path: marketRoot },
  installLocation: marketRoot,
  description: marketManifest.description,
  lastUpdated: now,
  autoUpdate: false,
  isBuiltIn: false,
};

const installedFile = join(pluginsDir, 'installed_plugins.json');
const installed = readJson(installedFile);
installed.version = installed.version ?? 2;
installed.plugins = installed.plugins ?? {};
installed.plugins[key] = [
  {
    scope: 'user',
    installPath: cacheDir,
    version: PLUGIN_VERSION,
    installedAt: installed.plugins[key]?.[0]?.installedAt ?? now,
    lastUpdated: now,
  },
];

const configuredFile = join(pluginsDir, 'configured-plugins.json');
const configured = readJson(configuredFile);
configured.version = configured.version ?? 1;
configured.builtInMarketPlugins = configured.builtInMarketPlugins ?? [];
if (!configured.builtInMarketPlugins.some((e) => e?.name === PLUGIN_NAME && e?.marketplaceName === MARKET_NAME)) {
  configured.builtInMarketPlugins.push({ name: PLUGIN_NAME, marketplaceName: MARKET_NAME, scope: 'user' });
}

const settingsFile = join(home, 'settings.json');
const settings = readJson(settingsFile);
settings.enabledPlugins = settings.enabledPlugins ?? {};
settings.enabledPlugins[key] = true;

if (!DRY_RUN) {
  writeJson(knownFile, known);
  writeJson(installedFile, installed);
  writeJson(configuredFile, configured);
  writeJson(settingsFile, settings);
}
console.log(`[install] 註冊檔          : known_marketplaces / installed_plugins / configured-plugins / settings.json`);

console.log('\n[install] 完成。接下來：');
console.log('  ① 在 WorkBuddy 對話框執行 /reload-plugins（不必重啟）');
console.log('  ② 啟動寵物主機（它必須常駐）：');
console.log(`     node "${join(cacheDir, 'pet-host', 'main.mjs')}"`);
if (DRY_RUN) console.log('\n[install] --dry-run：沒有真的寫入任何檔案。');
