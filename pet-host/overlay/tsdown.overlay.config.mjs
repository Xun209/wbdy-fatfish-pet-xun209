/**
 * standalone overlay 的打包設定（tsdown）。
 *
 * 【為什麼要自己打包，而不是直接用 DSH 已編譯的 lib/client.js】
 * lib/client.js 是「DSH ModuleLoader 版」：啟動時必須已有 `window.__ModuleLoader__`，
 * 而它的 apply(ctx) 會去掛 slot（shell.overlay / settings.section）與右側欄對話頁，
 * 那些都要 DSH 的 slot / locale / commandUi 服務。要在一般網頁裡跑就得模擬整套 runtime。
 * 這裡改成「只含寵物」的 entry：沒有 DSH 依賴、沒有 shim、體積更小、行為更好預期。
 *
 * 【為什麼 react 也要打包進去】
 * 目標是「零第三方相依」：插件不帶 node_modules，頁面也不該再去 CDN 取 React。
 * react / react-dom 一起打進產物 → 產物是單一自足檔，離線可用、沒有版本漂移。
 *
 * 【DSH 基準版的位置】
 * 這個檔案引用 DSH 的**原始碼**（唯讀）。位置可用 DSH_PET_SOURCE_ROOT 覆寫，
 * 否則依序試幾個常見位置。找不到就直接報錯 —— 寧可打包失敗，也不要默默產出一個空 bundle。
 *
 * 用法（產物會落在 pet-host/overlay/）：
 *   cd <dsh-pet checkout>
 *   node node_modules/tsdown/dist/run.js --config <此檔案>
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 刻意**不** import { defineConfig } from 'tsdown'：
// 這個設定檔放在插件裡（插件沒有 node_modules），tsdown 載入設定檔時是從設定檔所在位置
// 解析 import 的 → 在這裡 import tsdown 會 ERR_MODULE_NOT_FOUND。
// defineConfig 只是型別輔助，匯出純物件完全等價。

/** 本檔所在目錄（pet-host/overlay）。 */
const HERE = fileURLToPath(new URL('.', import.meta.url));

/** DSH pet 基準版的候選位置（第一個存在的就用）。 */
const SOURCE_CANDIDATES = [
  process.env.DSH_PET_SOURCE_ROOT,
  'E:/真。摸鱼/dsh-whale/dsh-pet/dsh-pet',
  resolve(HERE, '..', '..', '..', '..', 'dsh-whale', 'dsh-pet', 'dsh-pet'),
].filter(Boolean);

/** 找到 DSH pet 基準版；找不到就拋錯。 */
function resolveSourceRoot() {
  for (const candidate of SOURCE_CANDIDATES) {
    const root = resolve(candidate);
    if (existsSync(join(root, 'src', 'client', 'pet.ts'))) return root;
  }
  throw new Error(
    `找不到 DSH pet 基準版（需要 src/client/pet.ts）。已試：\n  ${SOURCE_CANDIDATES.join('\n  ')}\n` +
      '請設 DSH_PET_SOURCE_ROOT 指向 dsh-pet 目錄。',
  );
}

const SOURCE_ROOT = resolveSourceRoot();
const NODE_MODULES = join(SOURCE_ROOT, 'node_modules');

export default {
  entry: {
    // 產物檔名：fatfish-overlay.js（與 overlay.html 配對）
    'fatfish-overlay': join(HERE, 'standalone-entry.ts'),
  },
  outDir: HERE,
  // ESM：頁面用 <script type="module"> 載入，支援 top-level await 與嚴格模式。
  format: ['es'],
  platform: 'browser',
  target: 'es2020',
  dts: false,
  clean: false,
  // 全部打包（包含 react / react-dom）：產物必須自足。
  external: [],
  // 但 tsdown 預設會把「最近的 package.json 裡的 dependencies / peerDependencies」視為外部。
  // 這個設定檔在插件裡，最近的 package.json 是 DSH 基準版的 —— 它的 react / react-dom 是 peerDependencies，
  // 會被 externalize 成 `import ... from "react"`（瀏覽器裡就抓不到模組了）。
  // noExternal 把它們強制拉進打包圖。
  noExternal: [/^react$/, /^react\//, /^react-dom$/, /^react-dom\//],
  // react 的 CJS 產物會讀 process.env.NODE_ENV；瀏覽器裡沒有 process。
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  // alias 用**物件**形式（tsdown 0.8 的介面，跟 DSH 自己的 tsdown.config.mjs 同款）。
  // 比對順序有意義：'react' 是前綴匹配，更長的鍵必須排在前面，否則 'react/jsx-runtime'
  // 會被換成 '<...>/react/index.js/jsx-runtime'。
  alias: {
    '@dsh-pet-client/pet': join(SOURCE_ROOT, 'src', 'client', 'pet.ts'),
    'react/jsx-runtime': join(NODE_MODULES, 'react', 'jsx-runtime.js'),
    'react/jsx-dev-runtime': join(NODE_MODULES, 'react', 'jsx-dev-runtime.js'),
    'react-dom/client': join(NODE_MODULES, 'react-dom', 'client.js'),
    'react-dom': join(NODE_MODULES, 'react-dom', 'index.js'),
    react: join(NODE_MODULES, 'react', 'index.js'),
  },
  // 提示用的註解：產物不該有 sourcemap（會暴露本機路徑），也不需要。
  sourcemap: false,
  minify: true,
};
