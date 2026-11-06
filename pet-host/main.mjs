#!/usr/bin/env node
/**
 * WorkBuddy 大肥魚寵物主機（pet-host）入口。
 *
 * 【它是什麼】
 * 一個沒有任何第三方相依的 Node 程式，把 DSH pet 的「宿主半側」搬到 WorkBuddy 裡跑：
 * 寵物本體（109 支 webm 動畫、物理、右鍵選單、氣泡、表情包）完全沿用 DSH 的實作，
 * 桌面上是一個 Electron 透明置頂小窗；本機同時提供 `/dsh-pet-7340` 前綴的 HTTP 介面。
 *
 * 【與 WorkBuddy 的接縫】
 * WorkBuddy 沒有 DSH 的會話事件，所以 Agent 的狀態改由「狀態檔」帶進來：
 * hook 端把 `{schema,seq,ts,state,task,session_id}` 寫進 JSON 檔，
 * 本主機讀它並寫進寵物的 workStatus 葉子（見 lib/work-status.mjs）。
 *
 * 【為什麼不自己重寫一份宿主半側】
 * 因為工作狀態的「外部寫入端點」是 DSH 公開的接縫：
 * `POST /dsh-pet-7340/work-status` 與 DSH 自己的會話狀態一起參與優先級仲裁。
 * 重寫等於把那份邏輯抄一遍，兩邊一定會漂移。
 *
 * 【用法】
 *   node pet-host/main.mjs [選項]
 *   node pet-host/main.mjs --selftest
 *
 * @module wbdy-fatfish-pet/pet-host/main
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { register, registerHooks } from 'node:module';
import { join, resolve } from 'node:path';

import { createLogger } from './lib/logger.mjs';
import { createAi } from './lib/ai.mjs';
import {
  ensureVoiceEnabled,
  listSapiVoices,
  pickSapiVoice,
  runVoiceSelfTest,
} from './lib/tts.mjs';
import { resolve as resolveDshPeer } from './lib/dsh-peers/loader.mjs';
import {
  classicDshHome,
  dshHome as deriveDshHome,
  electronCandidates,
  petHostHome,
  resolveDshPetRoot,
  resolveStateDir,
  sessionBindingFile,
  stateFilePath,
} from './lib/paths.mjs';
import { createHostContext, loadDshPet } from './lib/dsh-pet.mjs';
import { DEFAULT_PORT, createGuard, createToken, listen } from './lib/server.mjs';
import { createBridge } from './lib/work-status.mjs';
import { createSessionBinder, loadPetList } from './lib/multipet.mjs';
import { runSelftest } from './lib/selftest.mjs';

const USAGE = `大肥魚寵物主機（WorkBuddy 版）

用法：
  node pet-host/main.mjs [選項]

選項：
  --port <埠號>          監聽埠號（預設 ${DEFAULT_PORT}；被占用會往後順延最多 25 個）
  --state-file <路徑>     WorkBuddy 狀態檔（預設 <狀態目錄>/state.json）
  --config <路徑>         寵物設定檔（JSONC）；首次啟動會複製成使用者設定，之後以使用者設定為準
  --config-force          強制用 --config 覆蓋使用者設定（舊版會留一份 .bak）
  --headless              只跑服務與狀態橋，不開桌面透明小窗（無 GUI 環境用）
  --selftest             自我驗證後自動退出
  --selftest-voice       語音自檢（Windows SAPI 實際說一句話）後自動退出
  --selftest-multipet    多寵物自檢（兩隻寵物 + session 指派）後自動退出
  --dsh-pet-root <路徑>   workbuddy-pet 套件根（含 lib/、assets/、runtime/）
  --debug                輸出除錯級日誌
  -h, --help             顯示本說明

環境變數：
  WORKBUDDY_WHALE_STATE_DIR   狀態目錄（優先序最高）
  CODEBUDDY_PLUGIN_DATA       WorkBuddy 注入的插件資料目錄（次選）
  DSH_PET_PACKAGE_ROOT        workbuddy-pet 套件根
  DSH_PET_ELECTRON_PATH       Electron 可執行檔
`;

/**
 * 解析命令列。
 *
 * @param {string[]} argv - 去掉 node 與腳本路徑後的參數。
 * @returns {{options: object} | {error: string}} 解析結果。
 */
function parseArgs(argv) {
  const options = {
    port: DEFAULT_PORT,
    stateFile: '',
    config: '',
    configForce: false,
    headless: false,
    selftest: false,
    selftestVoice: false,
    selftestMultipet: false,
    dshPetRoot: '',
    debug: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    const next = () => {
      if (arg.includes('=')) return arg.slice(arg.indexOf('=') + 1);
      index += 1;
      return String(argv[index] ?? '');
    };
    if (arg === '--port' || arg.startsWith('--port=')) {
      const raw = next();
      const value = Number(raw);
      if (!Number.isInteger(value) || value < 1 || value > 65535) {
        return { error: `--port 需要 1..65535 的整數，收到「${raw}」` };
      }
      options.port = value;
    } else if (arg === '--state-file' || arg.startsWith('--state-file=')) {
      options.stateFile = resolve(next());
    } else if (arg === '--config' || arg.startsWith('--config=')) {
      options.config = resolve(next());
    } else if (arg === '--config-force') {
      options.configForce = true;
    } else if (arg === '--headless') {
      options.headless = true;
    } else if (arg === '--selftest') {
      options.selftest = true;
    } else if (arg === '--selftest-voice') {
      options.selftestVoice = true;
    } else if (arg === '--selftest-multipet') {
      options.selftestMultipet = true;
    } else if (arg === '--dsh-pet-root' || arg.startsWith('--dsh-pet-root=')) {
      options.dshPetRoot = resolve(next());
    } else if (arg === '--debug') {
      options.debug = true;
    } else if (arg === '-h' || arg === '--help') {
      options.help = true;
    } else {
      return { error: `不认识的參數：${arg}` };
    }
  }
  return { options };
}

/**
 * 準備 WorkBuddy 專用的設定層。
 *
 * DSH pet 的設定分三層：包內預設 → 使用者層（$DSH_HOME/dsh-pet/main-config.jsonc）→ 種類檔。
 * 我們只碰使用者層：把 --config 指定的檔案放進去，其餘讓 DSH 自己合併。
 *
 * @param {object} options - 選項。
 * @param {string} dshHome - 注入給 DSH 的主目錄。
 * @param {object} logger - 日誌。
 * @returns {{userFile: string, applied: boolean, note: string}} 結果。
 */
function prepareConfig({ config, configForce }, dshHome, logger) {
  const userRoot = join(dshHome, 'dsh-pet');
  const userFile = join(userRoot, 'main-config.jsonc');
  if (!config) {
    return { userFile, applied: false, note: '沿用包內預設設定（未指定 --config）' };
  }
  if (!existsSync(config)) {
    throw new Error(`--config 指定的設定檔不存在：${config}`);
  }
  mkdirSync(userRoot, { recursive: true });
  const wanted = readFileSync(config, 'utf8');
  const current = existsSync(userFile) ? readFileSync(userFile, 'utf8') : null;
  if (current === wanted) {
    return { userFile, applied: true, note: '使用者設定已是指定內容，未變更' };
  }
  if (current !== null && !configForce) {
    logger.warn(
      `使用者設定已存在且與 --config 不同，未覆蓋（要強制覆蓋請加 --config-force）：${userFile}`,
    );
    return { userFile, applied: false, note: '保留既有的使用者設定' };
  }
  if (current !== null) {
    const backup = `${userFile}.bak`;
    try {
      renameSync(userFile, backup);
      logger.info(`舊的使用者設定已備份到：${backup}`);
    } catch {
      logger.warn(`舊的使用者設定備份失敗（仍會覆蓋）：${userFile}`);
    }
  }
  writeFileSync(userFile, wanted, 'utf8');
  logger.info(`已套用寵物設定：${config} → ${userFile}`);
  return { userFile, applied: true, note: `已套用 ${config}` };
}

/**
 * 讀出寵物清單（用 /config 這個唯一入口，而不是自己解析設定檔）。
 *
 * 為什麼走 HTTP 而不是直接讀檔：/config 回的是「合併並填滿後的成品」，
 * 與寵物本體看到的是同一份；自己解析 JSONC 會有一份第二口徑，兩邊一定會漂移。
 *
 * @param {string} origin - 服務 origin。
 * @returns {Promise<Array<{id: string, name: string, size: number, display: string}>>} 寵物清單。
 */
async function fetchPets(origin) {
  try {
    const response = await fetch(`${origin}/dsh-pet-7340/config`);
    if (!response.ok) return [];
    const merged = await response.json();
    const out = [];
    for (const conf of Object.values(merged ?? {})) {
      if (!conf || !Array.isArray(conf.pets)) continue;
      for (const pet of conf.pets) {
        out.push({
          id: String(pet.id ?? ''),
          name: String(pet.name ?? pet.id ?? ''),
          size: Number(pet.size ?? 462),
          display: String(pet.display ?? 'both'),
        });
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** 主流程。 */
/**
 * 語音：Windows SAPI 替身 + 使用者層設定的 voiceEnabled。
 *
 * 為什麼只動「使用者層」設定：
 *   套件預設（assets/config.jsonc）的 voiceEnabled 是 false，那是 DSH 那邊的預設；
 *   WorkBuddy 版改用離線的 Windows SAPI，所以要在使用者層開啟。
 *   套件預設值保持原樣 —— 日後更新套件不會把這裡的設定蓋掉。
 *
 * 為什麼語音後端是「轉接 edge-tts 這個相依」而不是註冊外部 provider：
 *   外部 provider 契約不傳 voice id，選音色會失效；轉接相依則 voice/rate/快取鍵全保留。
 *
 * @param {object} options - 選項。
 * @param {string} options.dshHome - 注入給 DSH 的主目錄。
 * @param {string} options.dshPetRoot - 套件根。
 * @param {object} options.logger - 日誌出口。
 * @returns {Promise<object>} 語音狀態摘要。
 */
async function setupVoice({ dshHome, dshPetRoot, logger }) {
  const userFile = join(dshHome, 'dsh-pet', 'main-config.jsonc');
  const packageConfig = join(dshPetRoot, 'assets', 'config.jsonc');
  const voices = await listSapiVoices({ logger });
  const zh = voices.filter((voice) => /^zh/i.test(voice.culture));
  const picked = pickSapiVoice(voices, 'zh-CN-XiaoyiNeural');
  const enabled = await ensureVoiceEnabled({
    configFile: userFile,
    packageConfigFile: packageConfig,
    logger,
  });
  if (voices.length === 0) {
    logger.warn('語音：本機沒有可用的 SAPI 音色（System.Speech 沒裝或沒裝語音），語音功能不可用');
  } else if (zh.length === 0) {
    logger.warn(
      `語音：本機沒有中文音色，將用「${picked.name}」（${picked.culture}）念中文 —— ` +
        '可到「設定 → 时间和语言 → 语音 → 添加语音」裝中文語音',
    );
  } else {
    logger.info(`語音：Windows SAPI，音色「${picked.name}」（${picked.culture}），共 ${voices.length} 個可用`);
  }
  logger.info(`語音設定：${enabled.note}（${userFile}）`);
  return { voices, picked, enabled, userFile };
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if ('error' in parsed) {
    process.stderr.write(`pet-host: ${parsed.error}\n\n${USAGE}`);
    process.exitCode = 2;
    return;
  }
  const options = parsed.options;
  if (options.help) {
    process.stdout.write(USAGE);
    return;
  }

  // 先把日誌開起來：後面每一步失敗都要看得見。
  const { dir: stateDir, source: stateDirSource } = await resolveStateDir();
  const hostHome = petHostHome(stateDir);
  mkdirSync(hostHome, { recursive: true });
  const logger = createLogger({
    file: join(hostHome, 'pet-host.log'),
    debug: options.debug,
  });
  logger.info('大肥魚寵物主機啟動中…');
  logger.info(`狀態目錄：${stateDir}（來源：${stateDirSource}）`);

  // 多寵物自檢：必須在主機啟動前跑（它自己會設 DSH_HOME 並起一個獨立主機）。
  if (options.selftestMultipet) {
    const { runMultipetSelfTest } = await import('./lib/selftest-multipet.mjs');
    const result = await runMultipetSelfTest({ port: options.port, dshPetRoot: options.dshPetRoot });
    process.stdout.write('\n===== pet-host 多寵物自檢 =====\n');
    for (const line of result.lines) process.stdout.write(line + '\n');
    process.stdout.write(result.passed ? '\n多寵物自檢通過。\n' : '\n多寵物自檢未通過（見上方 FAIL 行）。\n');
    process.exit(result.passed ? 0 : 1);
  }

  // workbuddy-pet 套件根：找不到就直接報錯，不要帶著「沒有寵物」繼續跑。
  const { root: dshPetRoot, checked } = resolveDshPetRoot(options.dshPetRoot);
  if (!dshPetRoot) {
    logger.error(
      '找不到可用的 workbuddy-pet 套件（需要同時有 lib/index.js、assets/config.jsonc、runtime/electron-helper/main.js）。已檢查：\n  ' +
        checked.join('\n  '),
    );
    process.exitCode = 1;
    return;
  }
  logger.info(`workbuddy-pet 套件根：${dshPetRoot}`);

  // 注入 DSH_HOME：讓 DSH 的設定、日誌、對話記憶都落在 WorkBuddy 自己的目錄下，
  // 不污染使用者的 ~/.dsh，也讓「刪掉 pet-host 目錄」等於恢復出厂設定。
  const dshHome = deriveDshHome(stateDir);
  mkdirSync(join(dshHome, 'dsh-pet'), { recursive: true });
  process.env.DSH_HOME = dshHome;

  // 語音（Windows SAPI）：在使用者層設定開啟 voiceEnabled，並回報可用音色。
  // 這一段在 Electron 之前做：語音自測不需要桌面小窗。
  const voice = await setupVoice({ dshHome, dshPetRoot, logger });
  if (options.selftestVoice) {
    process.stdout.write('\n===== 語音自檢 =====\n');
    const result = await runVoiceSelfTest({ logger });
    process.stdout.write(`${result.ok ? 'PASS' : 'FAIL'}  ${result.message}\n`);
    if (result.ok) process.stdout.write(`      音訊 ${result.bytes} bytes，音色「${result.voice}」\n`);
    process.stdout.write(`      使用者層設定：${voice.userFile}\n`);
    process.exit(result.ok ? 0 : 1);
  }

  // Electron：先找現成的（~/.dsh/electron 裡通常已經有 DSH 下載過的那份），
  // 找到了就指給 DSH，避免它在 WorkBuddy 目錄下重下 100MB。
  const candidates = electronCandidates(dshPetRoot, [classicDshHome(), dshHome]);
  const electron = candidates.find((candidate) => existsSync(candidate));
  if (electron) {
    process.env.DSH_PET_ELECTRON_PATH = electron;
    logger.info(`Electron：${electron}`);
  } else {
    logger.warn('找不到現成的 Electron，DSH 會在需要時自動下載（約 100MB，進度寫在下方日誌）');
  }

  // --headless：讓 DSH 跳過桌面 Helper 的啟動（它只在 in-process 模式下跳過）。
  // 服務、狀態橋、HTTP 介面照常運作。
  if (options.headless) {
    process.env.DSH_PET_IN_PROCESS = '1';
    logger.info('--headless：只跑服務與狀態橋，不啟動桌面透明小窗');
  }
  if (options.debug) process.env.DSH_PET_LOG_DEBUG = '1';

  // 狀態檔：hook 端寫的那一份。
  const stateFile = options.stateFile || stateFilePath(stateDir);
  logger.info(`狀態檔：${stateFile}`);

  // 設定層。
  const configInfo = prepareConfig(options, dshHome, logger);

  // 轉接三個 DSH 專用套件到本機降級替身（必須在載入 lib/index.js 之前註冊）。
  // 新一點的 Node 有 registerHooks（同步、同執行緒，不再開 worker）；舊的用 register。
  if (typeof registerHooks === 'function') {
    registerHooks({ resolve: resolveDshPeer });
  } else {
    register(new URL('./lib/dsh-peers/loader.mjs', import.meta.url).href);
  }
  const dshPet = await loadDshPet(dshPetRoot);
  logger.info(`已載入 workbuddy-pet 宿主半側（插件名 ${dshPet.name}）`);

  // 服務與偽 ctx。
  const routes = [];
  const portRef = { value: options.port };
  const originRef = { value: `http://127.0.0.1:${options.port}` };
  const token = createToken();
  const guard = createGuard({ portRef, token });
  // 模型後端：碎碎念與對話都要它。沒有金鑰時服務照常起（那兩個功能會明確失敗）。
  const ai = createAi({ stateDir, logger });
  const aiInfo = ai.describe();
  if (aiInfo.ready) {
    logger.info(`模型後端：${aiInfo.provider}/${aiInfo.model}（${aiInfo.baseUrl}）← ${aiInfo.source}`);
  } else {
    const aiConfigPath = join(stateDir, 'pet-host', 'ai.json');
    logger.warn(`模型後端未接：碎碎念與對話會明確失敗。可設環境變數 WORKBUDDY_PET_AI_API_KEY，或在 ${aiConfigPath} 寫入設定。`);
  }
  const host = createHostContext({ logger, routes, portRef, originRef, ai });

  let shuttingDown = false;
  const server = await listen({
    port: options.port,
    routes,
    guard,
    logger,
    status: () => ({
      name: 'wbdy-fatfish-pet-host',
      pid: process.pid,
      port: portRef.value,
      dshPetRoot,
      dshHome,
      stateFile,
      configFile: configInfo.userFile,
      headless: options.headless,
      uptimeSec: Math.round(process.uptime()),
    }),
    landing: () => landingPage({ origin: originRef.value, stateFile, configInfo, dshPetRoot }),
    onShutdown: (reason) => void shutdown(reason),
  });
  // 埠號可能因占用而順延；守門與 origin 都靠 ref 跟著換。
  portRef.value = server.port;
  originRef.value = `http://127.0.0.1:${server.port}`;
  const realOrigin = originRef.value;

  // 套用 DSH 的宿主半側：它會把 `/dsh-pet-7340` 路由註冊上來，並啟動桌面 Helper。
  // 順序不能反：Helper 需要埠號才能拼出設定地址，所以服務要先監聽。
  dshPet.apply(host.ctx);
  logger.info(`DSH 宿主半側已套用（註冊路由 ${routes.length} 條）`);
  if (host.failures.length > 0) {
    logger.warn(`初始化期間有 ${host.failures.length} 項失敗（見上方日誌），其餘功能照常`);
  }

  // 狀態橋：WorkBuddy 的狀態檔 → 寵物的 workStatus 葉子。
  //
  // resolveStateFile：讓橋在「現在這份狀態檔不存在」時重新推導一次位置。
  // 為什麼需要：寵物主機可能比 hook 的第一次執行還早啟動，那時指路牌還沒被寫出來，
  // 主機只能先落到 fallback 目錄；等 hook 跑過、狀態檔出現了，橋要能換過去讀。
  // 使用者用 --state-file 明確指定時則不許自動改（明確指定優先於自動對齊）。
  const resolveStateFile = options.stateFile
    ? undefined
    : async () => {
        const { dir } = await resolveStateDir();
        return stateFilePath(dir);
      };
  const bridge = createBridge({
    stateFile,
    origin: realOrigin,
    token,
    logger,
    resolveStateFile,
    // 多寵物：寵物清單要從宿主半側的設定來（/config 聚合後的寵物），
    // session→寵物的綁定則落盤在狀態目錄下，重啟不會洗牌。
    loadPets: () => loadPetList(realOrigin),
    binder: createSessionBinder({ file: sessionBindingFile(stateDir), logger }),
  });
  bridge.start();
  logger.info('狀態橋已啟動');

  // 執行狀態檔（供本機啟動器與使用者查）：令牌只在這裡出現，不進日誌。
  //
  // 寫兩份：
  // - pet-host-runtime.json        → 「目前這個實例」的指標（INSTALL.md 記載的路徑）；
  // - pet-host-runtime.<pid>.json  → 本實例自己的，永遠不會被別的實例覆寫。
  // 為什麼要兩份：兩個實例共用同一個狀態目錄時，後啟動的會蓋掉前一個的指標，
  // 前一個的令牌就找不回来了（只能用「硬殺主機」收尾）。有了 pid 檔，兩個實例的令牌都還在。
  const runtimeFile = join(hostHome, 'pet-host-runtime.json');
  const runtimeFileScoped = join(hostHome, `pet-host-runtime.${process.pid}.json`);
  const runtimePayload = {
    name: 'wbdy-fatfish-pet-host',
    pid: process.pid,
    port: server.port,
    token,
    stateFile,
    dshHome,
    dshPetRoot,
    configFile: configInfo.userFile,
    startedAt: new Date().toISOString(),
  };
  writeFileSync(runtimeFile, `${JSON.stringify(runtimePayload, null, 2)}\n`, 'utf8');
  writeFileSync(runtimeFileScoped, `${JSON.stringify(runtimePayload, null, 2)}\n`, 'utf8');

  const pets = await fetchPets(realOrigin);
  const desktop = pets.filter((pet) => pet.display === 'desktop' || pet.display === 'both');
  printSummary({
    logger,
    origin: realOrigin,
    pets,
    desktop,
    stateFile,
    configInfo,
    runtimeFile,
    dshHome,
    dshPetRoot,
    headless: options.headless,
  });

  // 收尾：先釋放插件的 effect（其中包含「停掉桌面 Helper」），再關服務。
  async function shutdown(reason) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`收尾（${reason}）…`);
    try {
      await host.dispose();
    } catch (error) {
      logger.warn(`釋放副作用時有錯誤：${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      bridge.stop();
      await server.close();
    } catch (error) {
      logger.warn(`關閉服務時有錯誤：${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      const { unlinkSync } = await import('node:fs');
      // 自己的 pid 檔一定刪（那是自己寫的）。
      if (existsSync(runtimeFileScoped)) unlinkSync(runtimeFileScoped);
      // 共用指標只在「還是自己的 pid」時才刪：別的實例正在用時不能動它。
      if (existsSync(runtimeFile)) {
        const current = JSON.parse(readFileSync(runtimeFile, 'utf8'));
        if (current.pid === process.pid) unlinkSync(runtimeFile);
      }
    } catch {
      /* 清理失敗不影響退出 */
    }
    logger.info('已退出。');
  }

  const requestShutdown = (reason) => {
    shutdown(reason)
      .then(() => process.exit(0))
      .catch((error) => {
        logger.error(`收尾失敗：${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      });
  };
  process.on('SIGINT', () => requestShutdown('SIGINT'));
  process.on('SIGTERM', () => requestShutdown('SIGTERM'));
  process.on('SIGHUP', () => requestShutdown('SIGHUP'));

  if (options.selftest) {
    const result = await runSelftest({ origin: realOrigin, token, stateFile, logger });
    process.stdout.write('\n===== pet-host 自檢結果 =====\n');
    for (const line of result.lines) process.stdout.write(line + '\n');
    process.stdout.write(result.passed ? '\n自檢通過。\n' : '\n自檢未通過（見上方 FAIL 行）。\n');
    await shutdown('--selftest');
    process.exit(result.passed ? 0 : 1);
  }
}

/**
 * 啟動摘要。
 *
 * 為什麼要印這麼多行：桌寵是「看得見但看不見過程」的東西，
 * 使用者要能靠這段輸出確認寵物在跑、狀態從哪來、要去哪裡調設定。
 */
function printSummary({ logger, origin, pets, desktop, stateFile, configInfo, runtimeFile, dshHome, dshPetRoot, headless }) {
  const lines = [
    '',
    '===== WorkBuddy 大肥魚寵物主機 =====',
    `  寵物        ${pets.length === 0 ? '（沒讀到寵物清單）' : pets.map((pet) => `${pet.name}(id=${pet.id}, size=${pet.size}, display=${pet.display})`).join('  ')}`,
    `  路由        ${origin}/dsh-pet-7340/`,
    `  主機狀態    ${origin}/health`,
    `  狀態檔      ${stateFile}`,
    `  設定        ${configInfo.userFile}（${configInfo.note}）`,
    `  桌面小窗    ${headless ? '已停用（--headless）' : `${desktop.length} 只（由 workbuddy-pet 的桌面 Helper 托管）`}`,
    `  令牌檔      ${runtimeFile}（令牌只寫在這裡，不進日誌）`,
    `  DSH 主目錄  ${dshHome}`,
    `  DSH 套件    ${dshPetRoot}`,
    '  離開        Ctrl+C 或 POST /shutdown（需令牌）',
    '',
  ];
  for (const line of lines) logger.info(line);
}

/**
 * 落地頁：讓使用者在瀏覽器打開主機時看得到關鍵資訊。
 *
 * @param {object} info - 資訊。
 * @returns {string} HTML。
 */
function landingPage({ origin, stateFile, configInfo, dshPetRoot }) {
  const escape = (value) =>
    String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch);
  return `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><title>大肥魚寵物主機</title>
<style>body{font:14px/1.8 "Segoe UI",system-ui,sans-serif;margin:0;padding:32px;background:#f6f8fa;color:#1f2328}
main{max-width:760px;margin:0 auto;background:#fff;border:1px solid #d0d7de;border-radius:12px;padding:28px 32px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:14px;margin:22px 0 6px}code{background:#f6f8fa;padding:1px 6px;border-radius:6px;font-size:12px}
ul{margin:6px 0;padding-left:20px}a{color:#0969da}</style></head>
<body><main>
<h1>大肥魚寵物主機</h1>
<div>WorkBuddy 版 · 桌寵本體沿用 DSH pet 的實作</div>
<h2>路徑</h2><ul>
<li>狀態檔：<code>${escape(stateFile)}</code></li>
<li>設定：<code>${escape(configInfo.userFile)}</code></li>
<li>DSH 套件：<code>${escape(dshPetRoot)}</code></li>
</ul>
<h2>狀態</h2><p><a href="/health">/health</a> · 寵物路由 <code>${escape(origin)}/dsh-pet-7340/</code></p>
</main></body></html>`;
}

main().catch((error) => {
  process.stderr.write(`pet-host 啟動失敗：${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exit(1);
});
