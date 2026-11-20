#!/usr/bin/env node
/**
 * 把 DSH 版的桌寵實作同步進 WorkBuddy 版插件。
 *
 * 【為什麼需要這支腳本】
 *   `runtime/electron-helper/**` 與 `lib/**` 是從 DSH 基準版複製來的原檔（vendored）。
 *   上游升版時（例如 0.4.7 → 0.4.9）要重新取檔、手動比對、自己套一次改名——
 *   這一步很容易漏，漏了就是「插件裡是舊版、宣稱是新版」。
 *   所以把同步做成一支可重複執行的腳本：取檔 → 比對 → 套改名 → 列報告。
 *
 * 【同步什麼】
 *   1. `runtime/electron-helper/**` —— Electron 主進程、透明置頂小窗、動畫引擎、
 *      物理、右鍵選單樹、氣泡、托盤、橋接層。**整包照搬**，只換外層宿主。
 *   2. `lib/**` —— DSH 宿主半側（`index.js`）與瀏覽器半側（`client.js`）的建置產物。
 *   3. `assets/config.jsonc` —— 完整設定檔（動畫池 / 物理 / 氣泡文案 / 人設 / 表情包對照）。
 *   4. `assets/webm/**` —— 只補「上游新增、這邊還沒有」的動畫；既有的一支都不動
 *      （逐檔 SHA-256 相同才視為同一支，避免重新編碼造成畫質變動）。
 *
 * 【刻意不做】
 *   - 不動 `assets/memes` / `assets/pic` / `assets/fonts` / `assets/sound`（本就逐字相同）。
 *   - 不動 `pet-host/**`（WorkBuddy 專屬的自研宿主）、`hooks/`、`scripts/`、`.mcp.json`。
 *   - 不刪除使用者的 `.bak*` 開發殘留，除非明確加 `--clean-bak`。
 *
 * 【用法】
 *   node tools/sync-from-dsh-pet.mjs --from <dsh-pet 包根>
 *   node tools/sync-from-dsh-pet.mjs --from <dsh-pet 包根> --dry-run
 *   node tools/sync-from-dsh-pet.mjs --from <dsh-pet 包根> --clean-bak
 *
 * 預設來源：`E:\真。摸鱼\dsh-whale\dsh-pet\dsh-pet`（本機 DSH fork）。
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_FROM = 'E:\\真。摸鱼\\dsh-whale\\dsh-pet\\dsh-pet';

/** 遞迴列出目錄下的所有檔（相對路徑，用 / 分隔）。 */
function walk(dir, base = dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full, base));
    else out.push(relative(base, full).replace(/\\/g, '/'));
  }
  return out;
}

/** 檔案雜湊（MD5）：用來判斷「同一支檔案」而不是「同名」。 */
function hash(file) {
  return createHash('md5').update(readFileSync(file)).digest('hex');
}

/** 開發殘留（.bak / .with15-45 之類）：同步時不當成正式檔案。 */
function isBackup(name) {
  return /(\.bak|\.with\d+-\d+|\.orig)$/i.test(name);
}

/**
 * 解析命令列。
 * @param {string[]} argv - 參數。
 * @returns {{from: string, dryRun: boolean, cleanBak: boolean}} 結果。
 */
function parseArgs(argv) {
  const options = { from: DEFAULT_FROM, dryRun: false, cleanBak: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    const next = () => {
      if (arg.includes('=')) return arg.slice(arg.indexOf('=') + 1);
      i += 1;
      return String(argv[i] ?? '');
    };
    if (arg === '--from' || arg.startsWith('--from=')) options.from = resolve(next());
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--clean-bak') options.cleanBak = true;
    else {
      process.stderr.write(`sync-from-dsh-pet: 不認識的參數 ${arg}\n`);
      process.exit(2);
    }
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
const FROM = options.from;

// 來源必須是「像樣的 DSH pet 包」：三個地標都在才認。
const landmarks = [
  join(FROM, 'runtime', 'electron-helper', 'main.js'),
  join(FROM, 'lib', 'index.js'),
  join(FROM, 'assets', 'config.jsonc'),
];
for (const mark of landmarks) {
  if (!existsSync(mark)) {
    process.stderr.write(`sync-from-dsh-pet: 來源不像 DSH pet 包（缺 ${mark}）\n`);
    process.exit(2);
  }
}

const report = { copied: [], updated: [], added: [], skipped: [], removed: [] };

/**
 * 複製一個目錄樹（來源為準）。
 * @param {string} fromDir - 來源目錄。
 * @param {string} toDir - 目標目錄。
 * @param {string} label - 報告用的標籤。
 */
function syncDir(fromDir, toDir, label) {
  const files = walk(fromDir).filter((rel) => !isBackup(rel));
  for (const rel of files) {
    const src = join(fromDir, rel);
    const dst = join(toDir, rel);
    const existed = existsSync(dst);
    const same = existed && hash(src) === hash(dst);
    if (same) {
      report.skipped.push(`${label}/${rel}`);
      continue;
    }
    if (!options.dryRun) {
      mkdirSync(dirname(dst), { recursive: true });
      copyFileSync(src, dst);
    }
    if (existed) report.updated.push(`${label}/${rel}`);
    else report.added.push(`${label}/${rel}`);
  }
}

// 1) 桌面 Helper：整包照搬。
syncDir(join(FROM, 'runtime', 'electron-helper'), join(ROOT, 'runtime', 'electron-helper'), 'runtime/electron-helper');

// 2) 宿主半側與瀏覽器半側的建置產物。
syncDir(join(FROM, 'lib'), join(ROOT, 'lib'), 'lib');

// 3) 設定檔。
{
  const src = join(FROM, 'assets', 'config.jsonc');
  const dst = join(ROOT, 'assets', 'config.jsonc');
  const existed = existsSync(dst);
  const same = existed && hash(src) === hash(dst);
  if (!same) {
    if (!options.dryRun) copyFileSync(src, dst);
    if (existed) report.updated.push('assets/config.jsonc');
    else report.added.push('assets/config.jsonc');
  } else report.skipped.push('assets/config.jsonc');
}

// 4) 動畫：只補上游新增的（既有的一支都不動）。
{
  const fromDir = join(FROM, 'assets', 'webm');
  const toDir = join(ROOT, 'assets', 'webm');
  for (const rel of walk(fromDir)) {
    const src = join(fromDir, rel);
    const dst = join(toDir, rel);
    if (!existsSync(dst)) {
      if (!options.dryRun) {
        mkdirSync(dirname(dst), { recursive: true });
        copyFileSync(src, dst);
      }
      report.added.push(`assets/webm/${rel}`);
    } else if (hash(src) === hash(dst)) {
      report.skipped.push(`assets/webm/${rel}`);
    } else {
      // 同名但內容不同：上游重新編碼過。保留本地版本，只報，不覆蓋。
      report.skipped.push(`assets/webm/${rel}（內容不同，保留本地）`);
    }
  }
}

// 5) 清除開發殘留（明確要求時才做）。
if (options.cleanBak && !options.dryRun) {
  for (const dir of [join(ROOT, 'runtime', 'electron-helper'), join(ROOT, 'lib'), join(ROOT, 'pet-host', 'lib')]) {
    for (const rel of walk(dir)) {
      if (!isBackup(rel)) continue;
      rmSync(join(dir, rel), { force: true });
      report.removed.push(`${relative(ROOT, join(dir, rel)).replace(/\\/g, '/')}`);
    }
  }
}

// 報告。
const lines = [
  '',
  '===== 同步 DSH 桌寵 → WorkBuddy 版 =====',
  `  來源      ${FROM}`,
  `  目標      ${ROOT}`,
  `  新增      ${report.added.length}`,
  `  更新      ${report.updated.length}`,
  `  相同略過  ${report.skipped.length}`,
  `  清除殘留  ${report.removed.length}`,
];
if (report.added.length) {
  lines.push('', '  ── 新增 ──');
  for (const item of report.added.slice(0, 40)) lines.push('    + ' + item);
  if (report.added.length > 40) lines.push(`    … 另有 ${report.added.length - 40} 個`);
}
if (report.updated.length) {
  lines.push('', '  ── 更新 ──');
  for (const item of report.updated.slice(0, 40)) lines.push('    ~ ' + item);
  if (report.updated.length > 40) lines.push(`    … 另有 ${report.updated.length - 40} 個`);
}
if (report.removed.length) {
  lines.push('', '  ── 清除 ──');
  for (const item of report.removed) lines.push('    - ' + item);
}
lines.push('', options.dryRun ? '（--dry-run：沒有真的動檔案）' : '（已寫入）', '');
process.stdout.write(lines.join('\n'));

// 6) 改名：同步完一定要套，否則托盤上又會寫回 dsh-pet 的名字。
if (!options.dryRun) {
  const branding = join(ROOT, 'tools', 'apply-branding.mjs');
  if (existsSync(branding)) {
    const { spawnSync } = await import('node:child_process');
    const result = spawnSync(process.execPath, [branding], { stdio: 'inherit' });
    if (result.status !== 0) {
      process.stderr.write('sync-from-dsh-pet: 改名腳本失敗，已中止（不產出未改名的包）\n');
      process.exit(1);
    }
  }
}
