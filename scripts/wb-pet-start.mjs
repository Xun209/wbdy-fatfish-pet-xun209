#!/usr/bin/env node
/**
 * 大肥魚寵物主機啟動器（供 WorkBuddy 斜杠命令 / 排程任務呼叫）
 *
 * 【為什麼需要這個檔】
 * 寵物主機是**獨立行程**，WorkBuddy 沒有「啟動桌面小窗」的按鈕，
 * 這個腳本就是把「啟動她」變成一行可重複呼叫、冪等的指令。
 *
 * 【冪等】
 * 先問主機自己還活著沒有（讀 pet-host-runtime.json + 打 /health）：
 * 活著就回報現況、不重複開；死了才真的啟動。
 * 避免「說了三遍打開大肥魚 → 桌面上三隻大肥魚互相打架」。
 *
 * 【為什麼 detached】
 * 用 spawn 的 detached:true 讓主機脫離本行程的生命週期：
 * 命令結束、WorkBuddy 收工，主機照樣活著（這是 INSTALL.md 要求的常駐語意）。
 *
 * 用法：
 *   node scripts/wb-pet-start.mjs           # 啟動（已在跑就回報現況）
 *   node scripts/wb-pet-start.mjs --status  # 只查狀態
 *   node scripts/wb-pet-start.mjs --stop    # 關掉她
 */

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(HERE, '..');
const MAIN = path.join(PLUGIN_ROOT, 'pet-host', 'main.mjs');

/** 狀態目錄：與 host / hook 端同一口徑（見 pet-host/lib/paths.mjs）。 */
function resolveStateDir() {
  const override = (process.env.WORKBUDDY_WHALE_STATE_DIR || '').trim();
  if (override) return override;
  const localAppData = (process.env.LOCALAPPDATA || '').trim();
  if (localAppData) return path.join(localAppData, 'workbuddy-whale');
  return path.join(homedir(), '.workbuddy-whale');
}

const STATE_DIR = resolveStateDir();
const RUNTIME_FILE = path.join(STATE_DIR, 'pet-host', 'pet-host-runtime.json');

/** 讀目前這個實例的指標檔；沒有就回 null。 */
function readRuntime() {
  try {
    if (!existsSync(RUNTIME_FILE)) return null;
    return JSON.parse(readFileSync(RUNTIME_FILE, 'utf8'));
  } catch {
    return null;
  }
}

/** 行程還活著嗎（Windows 用 tasklist 判斷，避免只信 pid 號碼）。 */
function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    const out = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    return out.includes(String(pid));
  } catch {
    return false;
  }
}

/** 主機的 health 端點還在嗎。 */
async function healthOk(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * 掃描一段連續埠號，找回正在跑的寵物主機。
 *
 * 【為什麼要掃埠而不是只讀指標檔】
 * 指標檔（pet-host-runtime.json）只記錄「最後一個啟動的實例」。
 * 若曾經同時啟動兩個實例（例：舊的還在跑，新的搶不到首選埠而順延），
 * 後啟動的那個會覆寫指標檔；它若之後退出，指標檔就指向一個死掉的埠，
 * 而真正活著的舊實例還在另一個埠上——只讀指標檔會誤判成「沒在跑」，
 * 然後又開一隻，桌面���變成兩隻。
 *
 * 所以：先看指標檔（快速路徑），再看它不對就掃一段埠號（保底路徑）。
 * 埠號範圍與主機的 PORT_SCAN_LIMIT 一致（3080 起、最多 25 個）。
 */
async function scanRunningPorts() {
  const runtime = readRuntime();
  const candidates = [];
  if (runtime?.port) candidates.push(runtime.port);
  for (let port = 3080; port < 3080 + 25; port += 1) {
    if (!candidates.includes(port)) candidates.push(port);
  }
  // 併發問所有埠號：最多 25 個埠，但只花一個 timeout 的時間。
  const results = await Promise.all(candidates.map(async (port) => ({ port, health: await healthOk(port) })));
  const hit = results.find((item) => item.health);
  return hit ? { port: hit.port, health: hit.health } : null;
}

/**
 * 目前這個實例是不是真的活著。
 *
 * 回傳 running:true 時，runtime 欄位一律由「實際活著的實例」重建，
 * 這樣呼叫端拿到的 pid / port / token 一定是對的那一份。
 */
async function probe() {
  const runtime = readRuntime();
  if (!runtime) {
    const found = await scanRunningPorts();
    if (found) {
      return {
        running: true,
        runtime: { ...runtimeOf(found.port, found.health), ...runtime, pid: found.health.pid, port: found.port },
        health: found.health,
        recovered: true,
      };
    }
    return { running: false, reason: 'no-runtime-file' };
  }

  // 先問端點：主機活著就一定有回應。這是最可靠的判斷。
  const health = await healthOk(runtime.port);
  if (health) return { running: true, runtime, health };

  // 指標檔指向的埠沒回應 → 掃一段埠號找回真正活著的實例
  const found = await scanRunningPorts();
  if (found) {
    return {
      running: true,
      runtime: { ...runtime, pid: found.health.pid, port: found.port, token: found.health.token ?? runtime.token },
      health: found.health,
      recovered: true,
    };
  }

  if (!processAlive(runtime.pid)) return { running: false, reason: 'process-dead', runtime };
  return { running: false, reason: 'health-unreachable', runtime };
}

/** 從 health 回應重建一份 runtime 形狀的資料（指標檔不存在時的退路）。 */
function runtimeOf(port, health) {
  return {
    name: health?.name ?? 'wbdy-fatfish-pet-host',
    pid: health?.pid ?? 0,
    port,
    stateFile: health?.stateFile ?? path.join(STATE_DIR, 'state.json'),
  };
}

/**
 * 結束某個行程（及其子行程）。
 *
 * 【為什麼需要】
 * /shutdown 端點要令牌，而令牌只寫在指標檔裡。若指標檔指向的是**另一個**
 * 實例（多實例時後啟動者覆寫了指標檔），手上這張令牌就對不上活著那隻，
 * 守門會回 403 —— 表面像「關不掉」，實際是關錯對象。
 * 這時直接結束行程是唯一可靠的做法。
 */
function killHost(pid) {
  try {
    // /T 連子行程一起收（Electron helper 是主機的子行程）
    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
      encoding: 'utf8',
      windowsHide: true,
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

async function stop() {
  const runtime = readRuntime();
  if (!runtime) {
    console.log('大肥魚目前沒有在跑（找不到實例指標檔）。');
    return 0;
  }
  // 先試關閉端點；主機活著才能關。
  if (await healthOk(runtime.port)) {
    try {
      const res = await fetch(`http://127.0.0.1:${runtime.port}/shutdown`, {
        method: 'POST',
        headers: { 'x-dsh-pet-token': runtime.token },
        signal: AbortSignal.timeout(8000),
      });
      console.log(`已送出關閉要求（HTTP ${res.status}）。`);
    } catch (error) {
      console.error(`關閉失敗：${error?.message ?? error}`);
      return 1;
    }
    return 0;
  }

  // 指標檔指向的埠沒回應，但別處可能還有活著的實例 → 掃埠找出來一起關掉。
  const found = await scanRunningPorts();
  if (found) {
    const pid = found.health.pid;
    if (killHost(pid)) {
      console.log(`已結束在 ${found.port} 埠上的實例（pid ${pid}）。`);
      return 0;
    }
    console.error(`無法結束實例（pid ${pid}）。`);
    return 1;
  }

  if (!processAlive(runtime.pid)) {
    console.log(`大肥魚的主機行程（pid ${runtime.pid}）已經不在了，順手清掉指標檔。`);
    try {
      const { unlinkSync } = await import('node:fs');
      if (existsSync(RUNTIME_FILE)) unlinkSync(RUNTIME_FILE);
    } catch {
      /* 清不掉就算了，下次啟動會覆寫 */
    }
    return 0;
  }

  console.log(`主機行程（pid ${runtime.pid}）還在，但健康端點沒回應；請手動結束該行程。`);
  return 1;
}

async function start() {
  if (!existsSync(MAIN)) {
    console.error(`找不到寵物主機入口：${MAIN}`);
    return 1;
  }

  const before = await probe();
  if (before.running) {
    console.log('大肥魚已經在跑了，不用重複啟動。');
    console.log(`  主機 pid=${before.runtime.pid}  埠號=${before.runtime.port}`);
    console.log(`  狀態檔：${before.runtime.stateFile}`);
    console.log(`  主頁：http://127.0.0.1:${before.runtime.port}/`);
    return 0;
  }

  // 【先清場再開新】殘留的舊實例會搶走首選埠（3080），新實例只能順延到 3081，
  // 兩隻同時在跑、指標檔又指向後啟動的那隻 —— 桌面變兩隻、狀態還會打架。
  // 所以啟動前把所有還活著的實例都收掉，確保桌面永遠只有一隻大肥魚。
  const stale = await scanRunningPorts();
  if (stale) {
    const pid = stale.health.pid;
    if (killHost(pid)) {
      console.log(`已結束殘留的舊實例（pid ${pid}，埠號 ${stale.port}）。`);
      await new Promise((done) => setTimeout(done, 1500));
    }
  }

  console.log('正在啟動大肥魚桌寵主機……');

  // 【怎麼讓她活過 WorkBuddy 收工】
  // detached:true 讓主機脫離本行程的工作階段，WorkBuddy 收工時不會
  // 把它當成「本次任務的子行程」一起收掉；windowsHide 讓它不彈視窗。
  //
  // 【為什麼直接 spawn node，不繞 shell】
  // 試過的兩條路都不可靠：
  //   - cmd /c start "" /b  → 引號轉義在不同 shell 下會失敗，指令根本沒被執行；
  //   - powershell Start-Process → spawn 傳參時 Windows 會把含空格的字串
  //     再拆一次，路徑被拆成兩段、實際跑到別的副本；
  //   - wscript + .vbs → 屬於 LOLBin，許多環境（含本機的資安策略）會攔截。
  //
  // 直接 spawn node.exe 是唯一不經過任何 shell 引號解析的路徑：
  // 引數是獨立的 argv 元素，路徑含中文、空白、句點都不會被拆。
  // 【2026-11-05 修正：改用 WMI 建立行程，才真的活得過 WorkBuddy 收工】
  // 舊版用 spawn(detached:true)：Windows 上 detached 只脫離主控台、**不改父子關係**，
  // 她仍在 WorkBuddy 的行程樹裡 → 收工時 taskkill /T 連坐收掉。
  //
  // WMI Win32_Process::Create：新行程的父行程是 WmiPrvSE.exe
  // （→svchost→services→wininit），不在任何使用者行程的樹裡 → taskkill /T 掃不到。
  //
  // 用 cmd 包一層是為了設定工作目錄（cd /d），cmd 本身也掛在 WmiPrvSE 底下，一樣安全。
  //
  // 命令列走環境變數：含中文路徑時，直接內嵌進 powershell -Command 會被依 ANSI 解碼而亂碼。
  const quotedNode = '"' + String(process.execPath).replace(/"/g, '""') + '"';
  const quotedMain = '"' + String(MAIN).replace(/"/g, '""') + '"';
  const quotedRoot = '"' + String(PLUGIN_ROOT).replace(/"/g, '""') + '"';
  // 不包 cmd：main.mjs 不依賴 cwd（paths.mjs 用 import.meta.url 定位絕對路徑），
  // 包 cmd 只會留下一個常駐黑視窗。
  const commandLine = quotedNode + ' ' + quotedMain;

  const psScript = [
    '$c = $env:WB_PET_CMD;',
    '$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine=$c};',
    'if ($r.ReturnValue -ne 0) { Write-Error ("Create failed: " + $r.ReturnValue); exit 1 }',
    '$r.ProcessId',
  ].join(' ');

  let childPid = 0;
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', psScript], {
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, WB_PET_CMD: commandLine },
      timeout: 30000,
    });
    childPid = Number(String(out).trim()) || 0;
  } catch (e) {
    console.error('WMI 建立行程失敗：' + (e instanceof Error ? e.message : String(e)));
    return 1;
  }
  console.log('  （已用 WMI 建立行程，父行程 = WmiPrvSE.exe，不在 WorkBuddy 行程樹內）pid=' + childPid);

  // 等主機把指標檔寫好（最多 20 秒）
  let last = null;
  for (let i = 0; i < 40; i += 1) {
    await new Promise((done) => setTimeout(done, 500));
    last = await probe();
    if (last.running) break;
  }

  if (!last?.running) {
    console.error(`啟動未成功（${last?.reason ?? 'timeout'}）。請看日誌：${path.join(STATE_DIR, 'pet-host', 'pet-host.log')}`);
    return 1;
  }

  console.log('大肥魚起來了！');
  console.log(`  主機 pid=${last.runtime.pid}  埠號=${last.runtime.port}`);
  console.log(`  狀態檔：${last.runtime.stateFile}`);
  console.log(`  主頁：http://127.0.0.1:${last.runtime.port}/`);
  return 0;
}

// ─────────────────────────────────────────────────────────────
// 進入點
// ─────────────────────────────────────────────────────────────

const mode = process.argv[2] ?? '';

try {
  if (mode === '--status') {
    const state = await probe();
    if (state.running) {
      console.log('大肥魚正在跑。');
      console.log(`  主機 pid=${state.runtime.pid}  埠號=${state.runtime.port}`);
      console.log(`  狀態檔：${state.runtime.stateFile}`);
      console.log(`  主頁：http://127.0.0.1:${state.runtime.port}/`);
    } else {
      console.log(`大肥魚沒在跑（${state.reason}）。`);
      console.log('要啟動她請執行：node scripts/wb-pet-start.mjs');
    }
  } else if (mode === '--stop') {
    process.exit(await stop());
  } else {
    process.exit(await start());
  }
} catch (error) {
  console.error(`啟動器失敗：${error?.stack ?? error}`);
  process.exit(1);
}
