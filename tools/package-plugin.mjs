#!/usr/bin/env node
/**
 * 大肥魚家族（WorkBuddy 版）· 打包腳本
 *
 * 把 WorkBuddy 插件壓成 zip。純 Node、零 npm 依賴：自帶最小 ZIP 寫入器
 * （deflate + CRC-32 + DOS 時間戳），不需要 `zip` 指令、不需要外部壓縮工具。
 *
 * ── 支援多插件 ──────────────────────────────────────────────────
 *   目前有兩個插件共用這支腳本：
 *     · wbdy-fatfish-pet   （桌寵）—— 根目錄 wbdy-fatfish-pet/
 *     · wbdy-fatfish-usage （記賬）—— 根目錄 wbdy-fatfish-usage/
 *   一次可以全部打，也可以用 --only 指定其中一個。
 *
 * ── 用法 ───────────────────────────────────────────────────────
 *   node tools/package-plugin.mjs                       # 打出所有插件（到 <工作區>/dist/）
 *   node tools/package-plugin.mjs --only pet            # 只打桌寵
 *   node tools/package-plugin.mjs --only usage          # 只打記賬
 *   node tools/package-plugin.mjs --only pet --out x.zip # 指定輸出路徑（只能搭配 --only）
 *   node tools/package-plugin.mjs --dry-run             # 只列檔案，不壓縮
 *   node tools/package-plugin.mjs --list                # 列出插件清單與狀態
 *   node tools/package-plugin.mjs --quiet               # 只印摘要
 *   node tools/package-plugin.mjs --include-backups     # 連 *.bak / *.with15-45 開發殘留一起打包
 *   node tools/package-plugin.mjs --include-lib-extras  # 連 lib/app.js、lib/standalone.js 等一起打包（僅 pet）
 *   node tools/package-plugin.mjs --skip-branding       # 跳過打包前的改名步驟（不建議）
 *
 * ── 每個插件的打包流程（三道閘門）──────────────────────────────
 *   ① branding   —— 跑該插件的改名腳本（冪等；沒有就略過，不中斷）
 *   ② 必備條目   —— 少了任何一個必備檔就不產出 zip
 *   ③ 語法閘門   —— 每個 JS 檔跑 node --check，不通過就不產出 zip
 *   然後才寫 zip（deflate + CRC-32）。
 *
 *   三道閘門都是為了擋「壞掉的中間版本被打包出去」：
 *     ① 重新從上游複製會蓋掉改名；
 *     ② teammates 還在寫的插件可能少檔；
 *     ③ teammates 存檔中的中間版本可能有語法錯誤。
 *   這三種問題**在本機原始碼目錄都看不出來，只有解壓後才炸**。
 *
 * ── 排除規則 ───────────────────────────────────────────────────
 *   · 目錄：node_modules / .git / logs / __pycache__ / dist
 *   · 檔名：*.bak、*.with15-45（開發殘留；--include-backups 可保留）
 *   · 雜項：.DS_Store、Thumbs.db、*.pyc、*.log
 *   · 輸出 zip 本身（避免把自己打進去）
 *   · pet 專用：lib/ 底下 WorkBuddy 用不到的檔案（lib/app.js、lib/standalone.js、
 *     那 4 個只有 app.js 會 import 的 chunk、lib/types/** 的 .d.ts）
 *     → --include-lib-extras 可保留
 *
 * ── 壓縮策略 ───────────────────────────────────────────────────
 *   已壓縮的格式（webm / png / gif / woff / ttf / zip）走 store（不壓），
 *   其餘（js / mjs / json / jsonc / md / wav）走 deflate。
 *   理由：deflate 對已經壓縮過的資料幾乎沒收益，還多花 CPU 與體積。
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** 桌寵插件根（tools/ 的上一層）。 */
const PET_ROOT = path.resolve(HERE, '..');
/** 工作區（所有插件的父目錄）—— dist/ 放在這裡。 */
const WORKSPACE = path.resolve(PET_ROOT, '..');

// ─────────────────────────────────────────────────────────────
// 排除規則（共用部分）
// ─────────────────────────────────────────────────────────────

const COMMON_EXCLUDE = {
  dirs: new Set(['node_modules', '.git', 'logs', '__pycache__', 'dist', '.DS_Store']),
  names: new Set(['.DS_Store', 'Thumbs.db']),
  ext: new Set(['.bak', '.pyc', '.log', '.tmp']),
  /** DSH 版的開發殘留副檔名（events.js.with15-45 之類）。 */
  backupExt: /(\.bak|\.with\d+-\d+)$/i,
  /** 依相對路徑排除的檔案 → 理由。 */
  files: new Map(),
  /** 依相對路徑前綴排除的整個目錄 → 理由。 */
  dirPrefixes: new Map(),
};

/**
 * pet 專用：lib/ 底下「WorkBuddy 用不到」的檔案。鍵是相對路徑，值是排除理由。
 *
 * lib/app.js（2.26 MiB）—— DSH 的 Electron 應用模式主進程。本來看起來是
 *   最理想的桌面殼（唯一零 DSH peer 依賴的檔案），但有兩個硬傷：
 *     ① src/app/router.ts:116 的埠號寫死 server.listen(0, '127.0.0.1')
 *        → 無法指定 --port N，只能從 stdout 抓「本机服务 http://127.0.0.1:PORT」再解析；
 *     ② 它的令牌只出現在設定頁 URL 的 fragment 裡，外部行程讀不到
 *        → POST /dsh-pet-7340/work-status 會被 403，而這條正是寵物主機
 *          把 WorkBuddy 狀態送進去的唯一接縫。
 *
 * lib/standalone.js（369 KB）—— 需要 zod / openai / @anthropic-ai/sdk 三個第三方套件，
 *   發佈包裡沒有 → 直接 ERR_MODULE_NOT_FOUND。
 *
 * 那 4 個 chunk（node-*.js / promise-DxjFfmXm.js，合計 105 KB）—— 排除 app.js 後
 *   就不可達了：逐檔查過相對 import，只有 app.js 與 chunk 彼此互相引用，
 *   而 lib/index.js 與 lib/client.js 都是「零相對 import」、完全自足。
 *   留著不只是浪費體積 —— promise-DxjFfmXm.js 是 @anthropic-ai/sdk 的打包產物，
 *   放在發佈包裡會讓人以為這個插件依賴 Anthropic SDK，而它實際上不需要
 *   （workStatus 的產生端是 WorkBuddy 自己的 hook）。留著是誤導，不是備份。
 *
 * lib/types/**（310 檔 / 610 KB）—— 全部是 .d.ts 型別宣告。Node 的 ESM/CJS 解析器
 *   不認 .d.ts副檔 → 執行期不可能被 import；全庫掃過也沒有任何 .js 引用它們。
 *   純建置產物（API 介面的說明文件），對執行毫無影響，原始檔仍留在 lib/ 裡。
 *
 * lib/client.js（瀏覽器半側 React overlay）**保留** —— 日後要做網頁版浮層時還能用。
 */
const PET_LIB_EXCLUDE = new Map([
  ['lib/app.js', 'WorkBuddy 用不了'],
  ['lib/standalone.js', 'WorkBuddy 用不了'],
  ['lib/node-CKdwitJ-.js', '排除 app.js 後不可達'],
  ['lib/node-DbKTBV3f.js', '排除 app.js 後不可達'],
  ['lib/node-SuG7cu54.js', '排除 app.js 後不可達'],
  ['lib/promise-DxjFfmXm.js', '排除 app.js 後不可達'],
]);

// ─────────────────────────────────────────────────────────────
// 插件清單
// ─────────────────────────────────────────────────────────────

/**
 * 一個插件的打包設定。
 *
 * @typedef {object} PluginSpec
 * @property {string} name      短名（--only 用它選）
 * @property {string} slug      插件目錄名（zip 內的根目錄名）
 * @property {string} dir       插件根目錄的絕對路徑
 * @property {string|null} branding  改名腳本（相對插件根）；null = 沒有這道步驟
 * @property {string[]} required 必備條目（相對插件根）；缺任一個就不產出 zip
 * @property {object} exclude   該插件額外的排除規則
 */

/** @type {PluginSpec[]} */
const PLUGINS = [
  {
    name: 'pet',
    slug: 'wbdy-fatfish-pet',
    dir: PET_ROOT,
    branding: 'tools/apply-branding.mjs',
    required: [
      'pet-host/lib/ai.mjs',
      'pet-host/check-alignment.mjs',
      'tools/apply-branding.mjs',
      'tools/package-plugin.mjs',
      '.codebuddy-plugin/plugin.json',
      '.mcp.json',
      'hooks/hooks.json',
      'skills/fatfish-pet/SKILL.md',
      'assets/config.jsonc',
    ],
    exclude: {
      files: PET_LIB_EXCLUDE,
      dirPrefixes: new Map([['lib/types/', '型別宣告（.d.ts），執行期用不到']]),
    },
  },
  {
    name: 'usage',
    slug: 'wbdy-fatfish-usage',
    dir: path.join(WORKSPACE, 'wbdy-fatfish-usage'),
    branding: null, // 記賬插件沒有改名步驟 —— 沒有就略過，不中斷
    required: [
      '.codebuddy-plugin/plugin.json',
      '.mcp.json',
      'scripts/usage.mjs',
      'scripts/accounting.mjs',
      'scripts/wb-usage-mcp.mjs',
      'skills/model-usage/SKILL.md',
    ],
    exclude: {},
  },
];

/** 已經壓縮過的格式：deflate 沒收益，直接 store。 */
const STORE_EXT = new Set(['.webm', '.png', '.gif', '.jpg', '.jpeg', '.webp', '.zip', '.gz', '.woff', '.woff2', '.ttf', '.otf']);

// ─────────────────────────────────────────────────────────────
// CRC-32（ZIP 格式要求；用查表法，1 MiB/s 級別對 62 MB 足夠）
// ─────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

/** 算一段 buffer 的 CRC-32。 */
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ─────────────────────────────────────────────────────────────
// DOS 時間戳（ZIP 用；2 秒精度，且 DOS 最小年份是 1980）
// ─────────────────────────────────────────────────────────────

function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (Math.floor(date.getSeconds() / 2) & 0x1f),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

// ─────────────────────────────────────────────────────────────
// 走訪目錄
// ─────────────────────────────────────────────────────────────

/**
 * 列出某個插件要打包的檔案。
 *
 * @param {PluginSpec} plugin 插件設定。
 * @param {{includeBackups: boolean, includeLibExtras: boolean}} opts 開關。
 * @returns {{files: {rel: string, abs: string, size: number, mtime: Date}[], excluded: {rel: string, size: number, reason: string}[]}}
 */
function collectFiles(plugin, opts) {
  const out = [];
  const excluded = [];
  // 注意：Map 不能用物件展開合併（會得到空物件），必須逐項 set。
  const excludeFiles = new Map(COMMON_EXCLUDE.files);
  for (const [k, v] of plugin.exclude.files || []) excludeFiles.set(k, v);
  const excludePrefixes = new Map(COMMON_EXCLUDE.dirPrefixes);
  for (const [k, v] of plugin.exclude.dirPrefixes || []) excludePrefixes.set(k, v);

  const walk = (dir, relBase) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (COMMON_EXCLUDE.dirs.has(entry.name)) continue;
        walk(abs, rel);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      let reason = null;
      if (COMMON_EXCLUDE.names.has(entry.name)) reason = '系統雜項';
      else if (COMMON_EXCLUDE.ext.has(ext)) reason = `副檔名 ${ext}`;
      else if (COMMON_EXCLUDE.backupExt.test(entry.name) && !opts.includeBackups) reason = '開發殘留';
      else if (!opts.includeLibExtras && excludeFiles.has(rel)) reason = excludeFiles.get(rel);
      else if (!opts.includeLibExtras) {
        for (const [prefix, why] of excludePrefixes) {
          if (rel.startsWith(prefix)) { reason = why; break; }
        }
      }
      if (reason) {
        let size = 0;
        try { size = fs.statSync(abs).size; } catch { /* 讀不到就當 0 */ }
        excluded.push({ rel, size, reason });
        continue;
      }
      let st;
      try {
        st = fs.statSync(abs);
      } catch {
        continue;
      }
      out.push({ rel, abs, size: st.size, mtime: st.mtime });
    }
  };
  walk(plugin.dir, '');
  out.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  excluded.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  return { files: out, excluded };
}

// ─────────────────────────────────────────────────────────────
// ZIP 寫入
// ─────────────────────────────────────────────────────────────

/** 4 個位元組小端序。 */
function u32(v) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v >>> 0, 0);
  return b;
}

/** 2 個位元組小端序。 */
function u16(v) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(v & 0xffff, 0);
  return b;
}

/**
 * 把檔案清單寫成 zip。
 * @param {{rel:string, abs:string, size:number, mtime:Date}[]} files 檔案清單。
 * @param {string} outPath 輸出路徑。
 * @param {string} zipRoot zip 內的根目錄名（解開後會多一層這個資料夾）。
 * @returns {{entries:number, rawBytes:number, zipBytes:number, stored:number, deflated:number}}
 */
function writeZip(files, outPath, zipRoot) {
  const chunks = [];
  const central = [];
  let offset = 0;
  let rawBytes = 0;
  let stored = 0;
  let deflated = 0;

  for (const file of files) {
    const data = fs.readFileSync(file.abs);
    rawBytes += data.length;
    const nameBuf = Buffer.from(`${zipRoot}/${file.rel}`, 'utf8');
    const ext = path.extname(file.rel).toLowerCase();
    const useStore = STORE_EXT.has(ext);

    let method = 0; // 0 = store
    let payload = data;
    if (!useStore && data.length > 0) {
      const packed = zlib.deflateRawSync(data, { level: 9 });
      // 壓不小就別壓了（已壓縮或高熵資料）
      if (packed.length < data.length) {
        method = 8;
        payload = packed;
      }
    }
    if (method === 0) stored += 1;
    else deflated += 1;

    const crc = crc32(data);
    const { time, date } = dosDateTime(file.mtime);

    // ── 本地檔案標頭 ──
    const local = Buffer.concat([
      u32(0x04034b50),
      u16(20), // version needed
      u16(0x0800), // flags：檔名用 UTF-8
      u16(method),
      u16(time),
      u16(date),
      u32(crc),
      u32(payload.length),
      u32(data.length),
      u16(nameBuf.length),
      u16(0), // extra length
      nameBuf,
    ]);
    chunks.push(local, payload);

    // ── 中央目錄標頭 ──
    central.push(
      Buffer.concat([
        u32(0x02014b50),
        u16(20), // version made by
        u16(20), // version needed
        u16(0x0800),
        u16(method),
        u16(time),
        u16(date),
        u32(crc),
        u32(payload.length),
        u32(data.length),
        u16(nameBuf.length),
        u16(0), // extra
        u16(0), // comment
        u16(0), // disk number start
        u16(0), // internal attrs
        u32(0o644 << 16), // external attrs（Unix 權位 644）
        u32(offset), // 本地標頭偏移
        nameBuf,
      ]),
    );

    offset += local.length + payload.length;
  }

  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.concat([
    u32(0x06054b50),
    u16(0), // disk number
    u16(0), // disk with cd
    u16(files.length),
    u16(files.length),
    u32(cdBuf.length),
    u32(offset),
    u16(0), // comment length
  ]);

  const out = Buffer.concat([...chunks, cdBuf, eocd]);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, out);
  return { entries: files.length, rawBytes, zipBytes: out.length, stored, deflated };
}

// ─────────────────────────────────────────────────────────────
// 三道閘門
// ─────────────────────────────────────────────────────────────

/**
 * 閘門①：打包前跑該插件的改名腳本（冪等）。
 *
 * 為什麼打包腳本要主動做這件事（pet 專用）：
 *   `runtime/electron-helper/**` 與 `lib/**` 是從 DSH 基準版複製來的原樣檔案。
 *   任何一次「重新從上游複製」都會把改名蓋回去 —— 症狀是托盤上又寫回「dsh-pet」，
 *   而且 Electron 又跟 DSH 自己那隻寵物共用同一份 Chromium profile（會互踢）。
 *   把改名做成冪等腳本、並由打包流程自動呼叫，改名就變成**可重現**的，
 *   不會出現「這次忘了套」的無聲回歸。
 *
 * 冪等性：apply-branding.mjs 對已套用的檔案不會再改，重跑無副作用。
 *
 * 沒有改名腳本的插件（記賬）→ 略過這道步驟，**不中斷**。
 *
 * @returns {{ran: boolean, ok: boolean}}
 */
function applyBranding(plugin) {
  if (!plugin.branding) return { ran: false, ok: true };
  const script = path.join(plugin.dir, plugin.branding);
  if (!fs.existsSync(script)) {
    process.stdout.write(`[${plugin.name}] 找不到 ${plugin.branding}，略過改名步驟\n`);
    return { ran: false, ok: true };
  }
  const result = spawnSync(process.execPath, [script], { cwd: plugin.dir, encoding: 'utf8' });
  const out = `${result.stdout || ''}${result.stderr || ''}`.trim();
  if (out) {
    for (const line of out.split('\n')) process.stdout.write(`[${plugin.name}][branding] ${line}\n`);
  }
  if (result.status !== 0) {
    process.stderr.write(`[${plugin.name}] 改名腳本失敗（exit ${result.status}），中止打包\n`);
    return { ran: true, ok: false };
  }
  return { ran: true, ok: true };
}

/**
 * 閘門②：必備條目檢查 —— 少了任何一個必備檔就不該產出 zip。
 *
 * 為什麼需要：插件被拆成多個作者的目錄（manifest / hook / MCP / skill / 核心程式），
 * 少任何一個使用者端都會壞掉（WorkBuddy 讀不到 manifest → 插件不認；
 * 少 SKILL.md → Agent 不知道怎麼用）。而這些檔案是**別人正在寫的**，
 * 打包的當下很可能只到位一部分。
 *
 * 檢查的是**收集後的檔案清單**（排除規則生效後），所以「被排除掉」也算缺。
 *
 * @param {PluginSpec} plugin 插件設定。
 * @param {{rel: string}[]} files 收集到的檔案清單。
 * @returns {{ok: boolean, missing: string[]}}
 */
function checkRequired(plugin, files) {
  const present = new Set(files.map((f) => f.rel));
  const missing = plugin.required.filter((r) => !present.has(r));
  if (missing.length) {
    process.stderr.write(`[${plugin.name}] ✗ 缺少 ${missing.length} 個必備條目，不產出 zip：\n`);
    for (const m of missing) process.stderr.write(`    ${m}\n`);
    return { ok: false, missing };
  }
  return { ok: true, missing: [] };
}

/**
 * 閘門③：對每個 JS 檔跑 `node --check`（語法檢查）。
 *
 * 為什麼需要：插件裡有十幾支 .mjs / .js 是 teammates 正在改的，
 * 中途可能留下一個語法錯誤的版本。這種錯誤的後果很嚴重 ——
 * 發佈包解壓後 `node pet-host/main.mjs` 直接 SyntaxError、寵物起不來，
 * 而且**在本機原始碼目錄是看不出來的**（只要 teammates 在你打包之後又存檔就會中招）。
 *
 * 所以把語法檢查變成打包的**閘門**：有任何一個檔過不了 → 不產出 zip。
 *
 * 註：`node --check` 只做語法解析，不會執行程式碼，所以沒有副作用。
 *
 * @param {PluginSpec} plugin 插件設定。
 * @param {{rel: string, abs: string}[]} files 檔案清單。
 * @returns {{ok: boolean, checked: number, broken: {rel: string, msg: string}[]}}
 */
function checkSyntax(plugin, files) {
  const scripts = files.filter((f) => /\.(js|mjs|cjs)$/i.test(f.rel));
  const broken = [];
  for (const file of scripts) {
    const r = spawnSync(process.execPath, ['--check', file.abs], { encoding: 'utf8' });
    if (r.status !== 0) {
      const msg = `${r.stderr || ''}`.split('\n').filter((l) => /SyntaxError|^\s+\^|^\s{2}\w/.test(l)).slice(0, 4).join('\n');
      broken.push({ rel: file.rel, msg: msg.trim() });
    }
  }
  if (broken.length) {
    process.stderr.write(`[${plugin.name}] ✗ 語法檢查未通過（${broken.length} 個檔），中止打包：\n`);
    for (const b of broken) {
      process.stderr.write(`  ${b.rel}\n${b.msg.replace(/^/gm, '      ')}\n`);
    }
    return { ok: false, checked: scripts.length, broken };
  }
  return { ok: true, checked: scripts.length, broken: [] };
}

// ─────────────────────────────────────────────────────────────
// 主流程
// ─────────────────────────────────────────────────────────────

/** 命令列參數（手動解析，不引入任何套件）。 */
function parseArgs(argv) {
  const out = {
    out: null, dryRun: false, quiet: false, list: false,
    includeBackups: false, includeLibExtras: false, skipBranding: false,
    only: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--out' || a === '-o') { out.out = argv[i + 1]; i += 1; }
    else if (a.startsWith('--out=')) out.out = a.slice('--out='.length);
    else if (a === '--dry-run' || a === '-n') out.dryRun = true;
    else if (a === '--quiet' || a === '-q') out.quiet = true;
    else if (a === '--list' || a === '-l') out.list = true;
    else if (a === '--include-backups') out.includeBackups = true;
    else if (a === '--include-lib-extras') out.includeLibExtras = true;
    else if (a === '--skip-branding') out.skipBranding = true;
    else if (a === '--only') { out.only = argv[i + 1]; i += 1; }
    else if (a.startsWith('--only=')) out.only = a.slice('--only='.length);
    else if (a === '--help' || a === '-h') out.help = true;
    else {
      process.stderr.write(`不认识的參數：${a}\n`);
      process.exit(2);
    }
  }
  return out;
}

const HELP = `大肥魚家族（WorkBuddy 版）· 打包腳本

  node tools/package-plugin.mjs [選項]

選項：
      --only <名稱>       只打指定的插件（pet / usage）。不給就全部打。
  -o, --out <路徑>       輸出 zip 路徑（預設 <工作區>/dist/<插件名>.zip；只能搭配 --only）
  -n, --dry-run          只列出會被打包的檔案，不實際壓縮
  -l, --list             列出插件清單與目前狀態
  -q, --quiet            只印摘要
      --include-backups  連 *.bak / *.with15-45 開發殘留一起打包
      --include-lib-extras  連 lib/app.js、lib/standalone.js、那 4 個 chunk、lib/types/** 一起打包（僅 pet）
      --skip-branding       跳過打包前的改名步驟（不建議）
  -h, --help             顯示本說明

插件：
  pet    wbdy-fatfish-pet    桌寵（runtime/ + assets/ + lib/）
  usage  wbdy-fatfish-usage  記賬掛件
`;

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  process.stdout.write(HELP);
  process.exit(0);
}

/** 依 --only 選出要處理的插件。 */
function selectPlugins() {
  if (!args.only) return PLUGINS.slice();
  const hit = PLUGINS.filter((p) => p.name === args.only);
  if (!hit.length) {
    process.stderr.write(`找不到插件「${args.only}」。可用的：${PLUGINS.map((p) => p.name).join(' / ')}\n`);
    process.exit(2);
  }
  return hit;
}

if (args.list) {
  process.stdout.write('插件清單：\n');
  for (const p of PLUGINS) {
    const exists = fs.existsSync(p.dir);
    let files = 0;
    if (exists) {
      for (const dp of fs.readdirSync(p.dir, { withFileTypes: true })) {
        if (dp.isFile()) files += 1;
      }
    }
    process.stdout.write(`  ${p.name.padEnd(6)} ${p.slug.padEnd(22)} ${exists ? '存在' : '（尚未建立）'}  ${p.dir}\n`);
    process.stdout.write(`         必備條目 ${p.required.length} 個${p.branding ? `、改名腳本 ${p.branding}` : '、無改名步驟'}\n`);
  }
  process.exit(0);
}

const selected = selectPlugins();
if (args.out && selected.length > 1) {
  process.stderr.write('--out 只能搭配 --only（一次只能指定一個輸出路徑）\n');
  process.exit(2);
}

const results = [];

for (const plugin of selected) {
  process.stdout.write(`\n${'='.repeat(72)}\n[${plugin.name}] ${plugin.slug}  ←  ${plugin.dir}\n${'='.repeat(72)}\n`);

  // 插件目錄還沒建立 → 略過。
  // 明確用 --only 指定的那個 → 算失敗（使用者要的就是它）；全部打時遇到 → 只略過不報錯。
  if (!fs.existsSync(plugin.dir)) {
    const explicit = args.only === plugin.name;
    process.stdout.write(`[${plugin.name}] 目錄尚未建立，${explicit ? '中止' : '略過'}\n`);
    results.push({ plugin, status: explicit ? 'failed' : 'skipped', reason: '目錄尚未建立' });
    continue;
  }

  // ── 閘門①：改名 ──
  if (args.skipBranding) {
    process.stdout.write(`[${plugin.name}] --skip-branding：略過改名步驟\n`);
  } else {
    const b = applyBranding(plugin);
    if (!b.ok) {
      results.push({ plugin, status: 'failed', reason: '改名腳本失敗' });
      continue;
    }
  }

  // ── 收集檔案 ──
  const { files, excluded } = collectFiles(plugin, {
    includeBackups: args.includeBackups,
    includeLibExtras: args.includeLibExtras,
  });
  const rawBytes = files.reduce((sum, f) => sum + f.size, 0);

  // ── 閘門②：必備條目 ──
  const req = checkRequired(plugin, files);
  if (!req.ok) {
    results.push({ plugin, status: 'failed', reason: `缺少 ${req.missing.length} 個必備條目` });
    continue;
  }
  if (!args.quiet) {
    process.stdout.write(`[${plugin.name}] 必備條目檢查通過（${plugin.required.length} 個）\n`);
  }

  // ── 閘門③：語法 ──
  const syn = checkSyntax(plugin, files);
  if (!syn.ok) {
    results.push({ plugin, status: 'failed', reason: `${syn.broken.length} 個檔語法錯誤` });
    continue;
  }
  if (!args.quiet) {
    process.stdout.write(`[${plugin.name}] 語法檢查通過（${syn.checked} 個 JS 檔）\n`);
  }

  if (!args.quiet) {
    process.stdout.write(`[${plugin.name}] 待打包 ${files.length} 檔 / ${rawBytes} bytes (${(rawBytes / 1024 / 1024).toFixed(2)} MiB)\n`);
    for (const f of files) {
      process.stdout.write(`  ${String(f.size).padStart(9)}  ${f.rel}\n`);
    }
    if (excluded.length) {
      const excludedBytes = excluded.reduce((sum, e) => sum + e.size, 0);
      process.stdout.write(`\n[${plugin.name}] 排除 ${excluded.length} 檔 / ${excludedBytes} bytes (${(excludedBytes / 1024 / 1024).toFixed(2)} MiB)\n`);
      for (const e of excluded) {
        process.stdout.write(`  ${String(e.size).padStart(9)}  ${e.rel}  （${e.reason}）\n`);
      }
    }
  }

  if (args.dryRun) {
    process.stdout.write(`[${plugin.name}] --dry-run：略過壓縮。\n`);
    results.push({ plugin, status: 'dry-run', entries: files.length, rawBytes });
    continue;
  }

  const outPath = path.resolve(args.out ?? path.join(WORKSPACE, 'dist', `${plugin.slug}.zip`));
  const result = writeZip(files, outPath, plugin.slug);

  process.stdout.write('\n');
  process.stdout.write(`[${plugin.name}] ── 打包完成 ──\n`);
  process.stdout.write(`[${plugin.name}] 輸出      ：${outPath}\n`);
  process.stdout.write(`[${plugin.name}] 條目數    ：${result.entries}\n`);
  process.stdout.write(`[${plugin.name}] 原始大小  ：${result.rawBytes} bytes (${(result.rawBytes / 1024 / 1024).toFixed(2)} MiB)\n`);
  process.stdout.write(`[${plugin.name}] zip 大小  ：${result.zipBytes} bytes (${(result.zipBytes / 1024 / 1024).toFixed(2)} MiB)\n`);
  process.stdout.write(`[${plugin.name}] 壓縮率    ：${((1 - result.zipBytes / Math.max(1, result.rawBytes)) * 100).toFixed(1)}%\n`);
  process.stdout.write(`[${plugin.name}] 壓縮方式  ：deflate ${result.deflated} 檔 / store ${result.stored} 檔\n`);
  results.push({ plugin, status: 'ok', outPath, ...result });
}

// ── 總結 ──
process.stdout.write('\n');
process.stdout.write(`${'='.repeat(72)}\n打包總結\n${'='.repeat(72)}\n`);
for (const r of results) {
  const tag = { ok: '✓ 完成', failed: '✗ 失敗', skipped: '— 略過', 'dry-run': '— dry-run' }[r.status] || r.status;
  const detail = r.status === 'ok'
    ? `${r.entries} 條目 / ${(r.zipBytes / 1024 / 1024).toFixed(2)} MiB → ${path.basename(r.outPath)}`
    : r.reason || '';
  process.stdout.write(`  ${r.plugin.name.padEnd(6)} ${tag.padEnd(10)} ${detail}\n`);
}
const failed = results.filter((r) => r.status === 'failed');
if (failed.length) {
  process.stderr.write(`\n有 ${failed.length} 個插件沒被打出來（見上面的錯誤訊息）。\n`);
  process.exit(1);
}
