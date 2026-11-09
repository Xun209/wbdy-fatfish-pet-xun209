/**
 * 驗證 standalone overlay 頁面：開瀏覽器 → 等寵物渲染 → 檢查 DOM/影片 → 截圖。
 *
 * 為什麼需要真的開瀏覽器：這個頁面的所有依賴都在執行期（React 掛載、fetch /state、
 * <video> 載 webm），靜態檢查看不出「寵物到底會不會動」。
 *
 * 用法：node verify-overlay.mjs <overlay 網址> [截圖路徑]
 * 需要 playwright（用 DSH 基準版 checkout 的 node_modules 跑）。
 */
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://127.0.0.1:3081/fatfish-overlay.html';
const shot = process.argv[3] ?? '';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 640 } });

const logs = [];
page.on('console', (message) => logs.push(`[${message.type()}] ${message.text()}`));
page.on('pageerror', (error) => logs.push(`[pageerror] ${error.message}`));
const requests = [];
page.on('request', (request) => requests.push(`${request.method()} ${request.url()}`));

await page.goto(url, { waitUntil: 'domcontentloaded' });

// 等寵物的 root 出現（容器元件掛上後才有 .dsh-pet-root）
await page
  .waitForSelector('.dsh-pet-root', { timeout: 15000 })
  .catch(() => logs.push('[warn] 15 秒內沒有出現 .dsh-pet-root'));

// 等影片真的開始播（currentTime > 0 表示 webm 已經載入並在播）
const video = await page
  .waitForFunction(
    () => {
      const element = document.querySelector('.dsh-pet-video');
      return element && element.readyState >= 2 ? element : null;
    },
    { timeout: 15000 },
  )
  .catch(() => null);

await page.waitForTimeout(2500);

const info = await page.evaluate(() => {
  const root = document.querySelector('.dsh-pet-root');
  const videos = [...document.querySelectorAll('.dsh-pet-video')];
  const front = videos.find((v) => v.classList.contains('is-front')) ?? videos[0];
  return {
    rootPresent: Boolean(root),
    rootRect: root ? root.getBoundingClientRect().toJSON() : null,
    videoCount: videos.length,
    frontSrc: front ? front.getAttribute('src') : null,
    frontReadyState: front ? front.readyState : null,
    frontCurrentTime: front ? Number(front.currentTime.toFixed(2)) : null,
    frontPaused: front ? front.paused : null,
    bubbleText: document.querySelector('.dsh-pet-bubble')?.textContent?.trim() ?? null,
    bodyText: document.body.innerText.trim().slice(0, 200),
  };
});

if (shot) await page.screenshot({ path: shot });

console.log('=== 頁面資訊 ===');
console.log(JSON.stringify(info, null, 2));
console.log('=== console ===');
for (const line of logs.slice(0, 20)) console.log('  ' + line);
console.log('=== 請求（前 12 筆）===');
for (const line of requests.slice(0, 12)) console.log('  ' + line);

await browser.close();

// 判定：root 有掛上、影片在播（currentTime > 0）才算通過
const ok = info.rootPresent && info.videoCount > 0 && (info.frontCurrentTime ?? 0) > 0;
console.log(ok ? '\nPASS：寵物已渲染且影片在播。' : '\nFAIL：寵物沒有正常渲染或播放。');
process.exit(ok ? 0 : 1);
