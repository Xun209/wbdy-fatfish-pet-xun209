/**
 * 寵物主機的本機 HTTP 服務：把 DSH pet 註冊上來的路由掛出去，並管住「誰能寫」。
 *
 * 為什麼自己寫服務而不用 DSH 的 standalone 服務：standalone 的 listen 埠號是寫死的
 * （`server.listen(0)` 隨機埠），而我們需要 `--port N` 與「佔用時往後順延」；
 * 而且它把路由匹配寫死在 listener 裡，插不了自己的 `/health`、`/shutdown`。
 * 業務邏輯（路由本體）仍然是 DSH 的同一份 `handlePetRoute`，我們只負責「門」。
 *
 * 安全策略（比 DSH standalone 寬鬆一處、嚴格一處）：
 * - 寬鬆：桌面渲染端的「內部回報」端點（位姿、播放回執）不需要令牌。
 *   DSH standalone 對所有寫操作都要令牌，但它的桌面 Helper 走 bridge 管道、
 *   應答由主進程轉發，所以令牌能帶；我們的 Helper 走直連 HTTP 且不帶令牌，
 *   若沿用嚴格策略，位姿與播放回執會全被 403 掉（症狀是「寵物不動、不報位置」）。
 * - 嚴格：會動到模型的端點（/whisper、/chat）仍然要令牌——它們會花使用者的錢。
 * @module wbdy-fatfish-pet/pet-host/lib/server
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

import { PLUGIN_ROOT } from './paths.mjs';

/** 預設監聽埠號（與 DSH standalone 一致，避免與既有服務打架）。 */
export const DEFAULT_PORT = 3080;

/** 埠號被佔用時最多往後順延幾個。 */
export const PORT_SCAN_LIMIT = 25;

/**
 * 不需要令牌的寫端點：桌面渲染端的「內部回報」通道。
 *
 * 這些端點只更新宿主端的內部狀態（目前位姿、播放回執），不會動到模型、不會改設定。
 */
const INTERNAL_REPORT_PATTERNS = [
  /^\/dsh-pet-\d+\/work-status$/,
  /^\/dsh-pet-\d+\/pose\/report$/,
  /^\/dsh-pet-\d+\/playback\/[^/]+\/report$/,
  /^\/dsh-pet-\d+\/menu\/click$/,
];

/** 需要令牌的寫端點前綴：會呼叫模型，會花錢。 */
const LLM_WRITE_PATTERNS = [/^\/dsh-pet-\d+\/whisper(\/|$)/, /^\/dsh-pet-\d+\/chat(\/|$)/];

/**
 * 建立存取守門。
 *
 * @param {object} options - 選項。
 * @param {{value: number}} options.portRef - 目前綁定的埠號（用 ref 是因為服務可能往後順延，
 *   守門必須跟著換，否則 Host 標頭比對會全部失配）。
 * @param {string} options.token - 能力令牌。
 * @returns {{authorize: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => boolean}} 守門。
 */
export function createGuard({ portRef, token }) {
  const reject = (res, status, message) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ ok: false, reason: 'forbidden', message }));
    return false;
  };

  return {
    authorize(req, res) {
      const port = portRef.value;
      const host = req.headers.host;
      // 主機名必須是本機回環：這是「只給本機用」的第一道關，
      // 也擋掉「把服務反代到公網」時的 Host 偽造。
      if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
        return reject(res, 403, '僅允許本機回環地址存取');
      }
      const method = (req.method ?? 'GET').toUpperCase();
      const isRead = method === 'GET' || method === 'HEAD' || method === 'OPTIONS';

      // 【iframe 導覽要放行】
      // WorkBuddy 的擴充用 <iframe> 掛這個頁面。Chromium 對「iframe 文件導覽」送的是
      //   Sec-Fetch-Site: cross-site  +  Sec-Fetch-Dest: iframe
      // 照一般的跨站規則擋掉，等於我們自己把 WorkBuddy 的 iframe 擋在門外（實測 403）。
      //
      // 放行條件（刻意收窄，不是「整個放行 cross-site」）：
      //   1. Sec-Fetch-Dest 必須是 iframe —— 代表「瀏覽器把這次請求當成 iframe 的文件導覽」，
      //      而不是頁面內的 fetch / XHR（那些的 Dest 會是 empty、script、style…）。
      //   2. 必須是讀取（GET/HEAD）—— 寫操作一律仍要令牌。
      //   3. 目標必須是 overlay 的頁面或它的靜態資源 —— 不然 cross-site 的 iframe 就能讀到
      //      /state、/config 等內部資料。
      // 其餘 cross-site 請求維持 403。
      const isIframeNav = req.headers['sec-fetch-dest'] === 'iframe';
      if (isIframeNav && isRead && isOverlayAsset(pathnameOf(req))) {
        // 放行：iframe 的文件導覽（頁面本身）。
        // 它接下來在**同源**下取資源（iframe 的 origin 就是本機），不需要再過跨站檢查。
        return true;
      }

      // 跨站防護：瀏覽器發起的跨站請求會帶 Origin 或 Sec-Fetch-Site: cross-site，
      // 兩者任一不對就擋掉。沒有 Origin 的請求（Node fetch、桌面主進程）放行。
      const isCrossSite = req.headers['sec-fetch-site'] === 'cross-site';
      const origin = req.headers.origin;
      if (origin !== undefined && origin !== `http://${host}`) {
        return reject(res, 403, '不允許跨站請求');
      }
      if (isCrossSite) {
        return reject(res, 403, '不允許跨站請求');
      }

      if (isRead) return true;

      let path = '';
      try {
        path = decodeURIComponent(new URL(req.url ?? '/', 'http://127.0.0.1').pathname);
      } catch {
        return reject(res, 400, '請求地址無效');
      }
      // 內部回報通道：桌面渲染端要能回報，否則寵物不會跟著滑鼠走。
      //
      // 為什麼這條通道不用令牌：桌面 Helper 走 bridge 管道轉發請求時**不會**帶令牌
      // （只有同進程的 APP 模式才注入 DSH_PET_APP_TOKEN），若這裡要令牌，
      // 桌面寵物的位姿回報與播放回執會全被 403（症狀：寵物不跟著滑鼠走）。
      //
      // 為什麼**跨站時不適用**：這條通道是給「本機的桌面 Helper」用的。
      // 若跨站請求也能用，任何網站把 overlay 框起來就能藉它改動寵物的狀態。
      // 所以只在**非跨站**時免令牌，跨站一律要令牌（令牌是我們自己發的、外人拿不到）。
      if (!isCrossSite && INTERNAL_REPORT_PATTERNS.some((pattern) => pattern.test(path))) return true;

      const supplied = req.headers['x-dsh-pet-token'];
      const ok =
        typeof supplied === 'string' &&
        supplied.length === token.length &&
        timingSafeEqual(Buffer.from(supplied), Buffer.from(token));
      if (!ok) {
        // 讀操作本來就放行；走到這裡的都是寫操作。
        const llm = LLM_WRITE_PATTERNS.some((pattern) => pattern.test(path));
        return reject(res, 403, llm ? '此端點會呼叫模型，需要令牌' : '此寫入端點需要令牌');
      }
      return true;
    },
  };
}

/** 取請求的路徑（解碼後）；解析不了回空字串。 */
function pathnameOf(req) {
  try {
    return decodeURIComponent(new URL(req.url ?? '/', 'http://127.0.0.1').pathname);
  } catch {
    return '';
  }
}

/**
 * 這個路徑是不是 overlay 的頁面或它的靜態資源。
 *
 * 為什麼要限在這些路徑：iframe 導覽是「別的頁面把這個頁面框起來」，
 * 如果任何路徑都放行，等於讓任何網站都能用 iframe 讀取本機的 /state、/config。
 * 只放行 overlay 自己的檔案，既有「寵物長在 WorkBuddy 介面裡」的效果，又不多開一條路。
 */
export function isOverlayAsset(pathname) {
  return OVERLAY_PATHS.some((prefix) => pathname === prefix || pathname.startsWith(prefix));
}

/** overlay 的頁面與靜態資源路徑前綴（與主機實際發送的檔案對應）。 */
export const OVERLAY_PATHS = ['/fatfish-overlay.html', '/fatfish-overlay/'];

/**
 * overlay 檔案所在目錄（插件根下的 pet-host/overlay）。
 *
 * 為什麼從插件根推導而不是寫死絕對路徑：插件會被複製到任何位置，
 * 寫死絕對路徑只會在別的機器上壞掉。
 */
const OVERLAY_DIR = join(PLUGIN_ROOT, 'pet-host');

/** overlay 靜態檔的 MIME（只有兩種：頁面與 bundle）。 */
const OVERLAY_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/**
 * 把 overlay 的 URL 路徑對應到實際檔案。
 *
 * 對應表是**寫死**的，不是把路徑直接接到目錄上：
 * 直接接會有路徑穿越風險（`/fatfish-overlay/../../secret`），而且會讓任何副檔名都能被讀。
 * 寫死則「這個頁面要哪幾個檔案」變成看得見的事實。
 *
 * @param {string} pathname - 請求路徑。
 * @returns {string | null} 絕對路徑；對不上回 null。
 */
export function overlayFileFor(pathname) {
  const dir = join(OVERLAY_DIR, 'overlay');
  if (pathname === '/fatfish-overlay.html') return join(dir, 'overlay.html');
  const rest = pathname.slice('/fatfish-overlay/'.length);
  if (rest === '' || rest.includes('/') || rest.includes('\\')) return null;
  if (rest !== 'fatfish-overlay.js') return null;
  return join(dir, 'fatfish-overlay.js');
}

/**
 * 發送 overlay 的靜態檔。
 *
 * @param {string} pathname - 請求路徑。
 * @param {import('node:http').ServerResponse} res - 回應。
 * @returns {boolean} 是否成功發送。
 */
function serveOverlayFile(pathname, res) {
  const file = overlayFileFor(pathname);
  if (!file || !existsSync(file)) return false;
  const body = readFileSync(file);
  const ext = file.slice(file.lastIndexOf('.'));
  res.writeHead(200, {
    'content-type': OVERLAY_MIME[ext] ?? 'application/octet-stream',
    'content-length': Buffer.byteLength(body),
    // bundle 內容會隨建置變動，但頁面 HTML 很少變；都不快取 → 改了立刻生效。
    'cache-control': 'no-store',
  });
  res.end(body);
  return true;
}

/**
 * 依路徑找到對應的插件路由。
 *
 * @param {Array<{kind: string, path: string, handler: Function}>} routes - 插件註冊的路由。
 * @param {string} pathname - 請求路徑。
 * @returns {{kind: string, path: string, handler: Function} | undefined} 命中的路由。
 */
export function matchRoute(routes, pathname) {
  return routes.find((candidate) =>
    candidate.kind === 'exact'
      ? pathname === candidate.path
      : pathname === candidate.path || pathname.startsWith(`${candidate.path}/`),
  );
}

/**
 * 啟動本機服務。
 *
 * @param {object} options - 選項。
 * @param {number} [options.port] - 首選埠號。
 * @param {Array} options.routes - 插件路由表（與服務共用同一份陣列，插件稍後才註冊）。
 * @param {object} options.guard - 存取守門。
 * @param {object} options.logger - 日誌。
 * @param {() => unknown} options.status - `/health` 的回應內容。
 * @param {() => string} options.landing - `/` 的落地頁內容。
 * @param {(reason: string) => void} options.onShutdown - 停機回呼。
 * @returns {Promise<{port: number, close: () => Promise<void>}>} 服務。
 */
export async function listen({ port = DEFAULT_PORT, routes, guard, logger, status, landing, onShutdown }) {
  const server = createServer((req, res) => {
    let pathname = '';
    try {
      pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    } catch {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('請求地址無效');
      return;
    }

    // 安全判定先於一切分發：連 /health 與 / 都要過回環檢查，
    // 否則反代或偽造 Host 的頁面也能讀到本機的路徑資訊。
    if (!guard.authorize(req, res)) return;
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // 主機自己的三個端點。放在外層，是為了讓「主機還活著嗎」不依賴插件是否載入成功。
    if (pathname === '/health') {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('僅支援 GET');
        return;
      }
      const body = JSON.stringify(status());
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(body);
      return;
    }
    if (pathname === '/') {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('僅支援 GET');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(landing());
      return;
    }
    if (pathname === '/shutdown') {
      // 停機會讓整個桌寵消失，必須要令牌：否則任何本機頁面都能關掉使用者的桌寵。
      if (req.method !== 'POST') {
        res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('停機請使用 POST');
        return;
      }
      // 診斷：誰在關桌寵？把來源寫進日誌，否則這件事查不出來。
      logger.warn(
        '收到 /shutdown：'
        + ` ua=${req.headers['user-agent'] || '(無)'}`
        + ` origin=${req.headers.origin || '(無)'}`
        + ` referer=${req.headers.referer || '(無)'}`
        + ` from=${req.socket.remoteAddress || '(無)'}`
        + ` token=${req.headers['x-dsh-pet-token'] ? '有' : '無'}`,
      );
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, stopping: true }));
      setTimeout(() => onShutdown('POST /shutdown'), 0);
      return;
    }

    // overlay 靜態檔：讓 WorkBuddy 的擴充能用 <iframe> 掛桌寵。
    // 放在插件路由之前：這個前綴與 /dsh-pet-7340 不會撞，但先擋掉比較不會誤落進素材兜底。
    if (isOverlayAsset(pathname)) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('僅支援 GET');
        return;
      }
      if (!serveOverlayFile(pathname, res)) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('pet-host：找不到 overlay 資源 ' + pathname);
      }
      return;
    }

    const route = matchRoute(routes, pathname);
    if (!route) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(
        `pet-host：沒有匹配的路由（已註冊：${routes.map((item) => item.path).join(', ') || '無'}）`,
      );
      return;
    }
    // 插件的路由處理器自帶請求體讀取與錯誤收口，這裡原樣轉交。
    try {
      void Promise.resolve(route.handler(req, res)).catch((error) => {
        logger.error(`路由處理失敗：${error instanceof Error ? error.message : String(error)}`);
        if (!res.headersSent) {
          res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, reason: 'internal-error', message: '主機內部錯誤' }));
        } else {
          res.end();
        }
      });
    } catch (error) {
      logger.error(`路由處理失敗：${error instanceof Error ? error.message : String(error)}`);
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, reason: 'internal-error', message: '主機內部錯誤' }));
      }
    }
  });

  // 長輪詢（GET /state?since=&timeout=）會把回應掛住最多 10 秒，
  // Node 預設的 requestTimeout 會在這種情況下把連線砍掉，所以兩個逾時都放寬。
  server.requestTimeout = 0;
  server.headersTimeout = 60_000;
  server.timeout = 0;
  server.on('clientError', (_error, socket) => socket.destroy());

  const bound = await bindFirstFree(server, port, logger);
  return {
    port: bound,
    async close() {
      server.closeAllConnections();
      await new Promise((done) => server.close(() => done()));
    },
  };
}

/**
 * 從首選埠號起逐個嘗試，只在 EADDRINUSE 時往後順延。
 *
 * 為什麼要順延：WorkBuddy 可能已經有別的服務佔了 3080；與其報錯讓使用者自己去猜，
 * 不如自己往後找一個空的並把實際埠號印出來。
 */
async function bindFirstFree(server, preferred, logger) {
  for (let candidate = preferred; candidate < preferred + PORT_SCAN_LIMIT; candidate += 1) {
    try {
      await new Promise((accept, reject) => {
        const onError = (error) => {
          server.off('listening', onListening);
          reject(error);
        };
        const onListening = () => {
          server.off('error', onError);
          accept();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(candidate, '127.0.0.1');
      });
      const address = server.address();
      const bound = typeof address === 'object' && address !== null ? address.port : candidate;
      if (preferred > 0 && bound !== preferred) {
        logger.warn(`埠號 ${preferred} 被占用，改用 ${bound}`);
      }
      return bound;
    } catch (error) {
      if (error?.code !== 'EADDRINUSE') throw error;
    }
  }
  throw new Error(`從 ${preferred} 起連續 ${PORT_SCAN_LIMIT} 個埠號都被占用`);
}

/**
 * 產生能力令牌。
 *
 * @returns {string} base64url 令牌（43 字元）。
 */
export function createToken() {
  return randomBytes(32).toString('base64url');
}
