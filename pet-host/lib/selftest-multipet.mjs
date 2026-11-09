/**
 * 多寵物自檢：兩隻寵物 → 兩個透明小窗 → 狀態分派到「正在工作」的那一隻。
 *
 * 【為什麼要獨立一支自檢，而不是併進既有的 --selftest】
 * 既有 --selftest 驗的是**單寵物**那條路（全域工作狀態 → /state 的 sections.workStatus）。
 * 多寵物走的是**完全不同的投遞路徑**（逐寵物葉子 + session 綁定），
 * 兩者要能同時成立，就必須各自有自檢；否則「為了測多寵物把單寵物弄壞」這種事沒人擋得住。
 *
 * 【這支自檢怎麼跑】
 * 它自己起一個**獨立的主機**（獨立的 DSH_HOME、獨立的設定、獨立的埠號），
 * 跑完就收掉，不碰使用者的真實資料。
 * 兩種執行方式：
 * - `node pet-host/lib/selftest-multipet.mjs`（獨立跑，開發時最方便）
 * - 由 main.mjs 的 `--selftest-multipet` 呼叫（對使用者友善的入口）
 *
 * @module wbdy-fatfish-pet/pet-host/lib/selftest-multipet
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerHooks } from 'node:module';

import { createLogger } from './logger.mjs';
import { resolve as resolveDshPeer } from './dsh-peers/loader.mjs';
import { PLUGIN_ROOT, resolveDshPetRoot } from './paths.mjs';
import { createHostContext, loadDshPet } from './dsh-pet.mjs';
import { createGuard, createToken, listen } from './server.mjs';
import { createBridge } from './work-status.mjs';
import { createSessionBinder, loadPetList } from './multipet.mjs';

/** 兩隻寵物的設定（使用者層；其餘欄位由包內預設補齊 —— 頂層欄位是整段替換）。 */
const TWO_PETS_CONFIG = {
  pets: [
    {
      name: '测试鲸一号',
      id: 'main',
      size: 420,
      balanceEnabled: false,
      whisperEnabled: false,
      workStatusEnabled: true,
      display: 'both',
      position: { corner: 'top-right', marginX: 24, marginY: 100 },
    },
    {
      name: '测试鲸二号',
      id: 'second',
      size: 360,
      balanceEnabled: false,
      whisperEnabled: false,
      // 兩隻都開啟工作狀態：自檢要驗「session 綁定能把不同對話分給不同寵物」。
      // 預設設定檔裡的第二隻是關的（見 assets/config.jsonc）——那是給一般使用者的選擇。
      workStatusEnabled: true,
      display: 'both',
      position: { corner: 'bottom-left', marginX: 24, marginY: 24 },
    },
  ],
};

/**
 * 等到某個條件成立（或逾時）。
 *
 * @param {() => boolean} predicate - 判定條件。
 * @param {number} [timeoutMs] - 逾時（毫秒）。
 * @returns {Promise<boolean>} 是否在逾時前成立。
 */
async function waitUntil(predicate, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((done) => setTimeout(done, 100));
  }
  return predicate();
}

/**
 * 執行多寵物自檢。
 *
 * @param {object} [options] - 選項。
 * @param {number} [options.port] - 首選埠號（被占用會往後順延）。
 * @param {string} [options.dshPetRoot] - DSH pet 套件根（不給就自動找）。
 * @returns {Promise<{passed: boolean, lines: string[]}>} 結果與逐項說明。
 */
export async function runMultipetSelfTest({ port = 3095, dshPetRoot } = {}) {
  const lines = [];
  let passed = true;
  const record = (ok, label, detail) => {
    if (!ok) passed = false;
    const line = `${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`;
    lines.push(line);
    process.stdout.write(line + '\n');
  };

  // 臨時家目錄：自檢不能碰使用者的真實資料（設定、狀態檔、綁定檔都要是暫時的）。
  const tmpRoot = mkdtempSync(join(tmpdir(), 'wb-multipet-'));
  const stateDir = join(tmpRoot, 'state');
  const dshHome = join(tmpRoot, 'dsh-home');
  const stateFile = join(stateDir, 'state.json');
  mkdirSync(join(dshHome, 'dsh-pet'), { recursive: true });
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(dshHome, 'dsh-pet', 'main-config.jsonc'), `${JSON.stringify(TWO_PETS_CONFIG, null, 2)}\n`, 'utf8');

  // DSH_HOME 必須在載入宿主半側之前換掉（它是執行期讀的環境變數）。
  const savedHome = process.env.DSH_HOME;
  process.env.DSH_HOME = dshHome;
  // 桌面模式在自檢裡關掉：這支自檢驗的是「狀態分派」，不是「視窗」；
  // 開小窗會在別人桌面上彈出來，測試不該這樣。
  process.env.DSH_PET_IN_PROCESS = '1';

  const logLines = [];
  const logger = createLogger({ prefix: '[pet-host/selftest-multipet]' });
  const baseLogger = logger;
  const capture = {
    info: (message) => {
      logLines.push(String(message));
      baseLogger.info(message);
    },
    warn: (message) => {
      logLines.push(String(message));
      baseLogger.warn(message);
    },
    error: (message) => {
      logLines.push(String(message));
      baseLogger.error(message);
    },
    debug: (message) => baseLogger.debug(message),
  };

  let server = null;
  let host = null;
  let bridge = null;
  try {
    const { root } = resolveDshPetRoot(dshPetRoot);
    if (!root) throw new Error('找不到 DSH pet 套件（先跑 node pet-host/main.mjs --selftest 確認環境）');
    registerHooks({ resolve: resolveDshPeer });
    const dshPet = await loadDshPet(root);

    const routes = [];
    const portRef = { value: port };
    const originRef = { value: `http://127.0.0.1:${port}` };
    const token = createToken();
    const guard = createGuard({ portRef, token });
    host = createHostContext({ logger: capture, routes, portRef, originRef });
    server = await listen({
      port,
      routes,
      guard,
      logger: capture,
      status: () => ({ name: 'wbdy-fatfish-pet-host', mode: 'selftest-multipet' }),
      landing: () => '<html><body>selftest-multipet</body></html>',
      onShutdown: () => {},
    });
    portRef.value = server.port;
    originRef.value = `http://127.0.0.1:${server.port}`;
    const origin = originRef.value;

    dshPet.apply(host.ctx);
    record(routes.length > 0, '宿主半側註冊了路由', `${routes.length} 條`);

    // 寵物清單：從 /config 讀（與寵物本體同一份來源）。
    const pets = await loadPetList(origin);
    record(pets.length === 2, '設定裡有兩隻寵物', pets.map((pet) => pet.id).join(', '));

    // 桌面可見的寵物數：DSH 的桌面判定（display 含 desktop/both）決定開幾個小窗。
    const desktopVisible = pets.filter((pet) => pet.display === 'desktop' || pet.display === 'both');
    record(
      desktopVisible.length === 2,
      '兩隻都是桌面可見（各自一個透明小窗）',
      desktopVisible.map((pet) => pet.id).join(', '),
    );

    const binder = createSessionBinder({ file: join(tmpRoot, 'pet-sessions.json'), logger: capture });
    bridge = createBridge({
      stateFile,
      origin,
      token,
      logger: capture,
      loadPets: () => loadPetList(origin),
      binder,
    });
    bridge.start();

    /** 讀 /state 的 pets 區塊。 */
    const readPets = async () => {
      const response = await fetch(`${origin}/dsh-pet-7340/state`);
      return response.json();
    };

    /** 寫一份狀態檔（模擬 hook 端）。 */
    const writeState = (payload) => {
      writeFileSync(stateFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    };

    // ── 1) 第一個 session：綁到第一隻寵物 ──────────────────────────────
    writeState({ schema: 1, seq: 1, ts: Date.now(), state: 'working', task: '正在改檔案', session_id: 'sess-1' });
    const gotFirst = await waitUntil(() => bridge.petWorkStates().main?.data?.state === 'working');
    const view1 = bridge.petWorkStates();
    record(gotFirst, '第一個 session → 第一隻寵物', JSON.stringify(view1.main?.data ?? null));
    record(
      view1.second === undefined,
      '第二隻寵物沒有被投遞（指派生效）',
      view1.second === undefined ? '（無紀錄）' : JSON.stringify(view1.second),
    );
    record(
      binder.peek('sess-1') === 'main',
      'session sess-1 綁到 main',
      binder.peek('sess-1') || '（未綁定）',
    );

    // ── 2) 第二個 session：綁到第二隻寵物 ──────────────────────────────
    const beforeSecond = (await readPets()).pets?.main?.anim?.counter ?? 0;
    writeState({ schema: 1, seq: 2, ts: Date.now(), state: 'waiting', task: '等你按確認', session_id: 'sess-2' });
    const gotSecond = await waitUntil(() => bridge.petWorkStates().second?.data?.state === 'waiting');
    const view2 = bridge.petWorkStates();
    record(gotSecond, '第二個 session → 第二隻寵物', JSON.stringify(view2.second?.data ?? null));
    record(binder.peek('sess-2') === 'second', 'session sess-2 綁到 second', binder.peek('sess-2') || '（未綁定）');

    // ── 3) /state 的 pets 區塊：兩隻都在，且各自的葉子獨立更新 ───────────
    const state = await readPets();
    const petIds = Object.keys(state.pets ?? {}).sort();
    record(
      petIds.length === 2 && petIds.includes('main') && petIds.includes('second'),
      '/state 的 pets 區塊有兩隻',
      petIds.join(', ') || '（空）',
    );
    const mainAnim = state.pets?.main?.anim?.counter ?? 0;
    const secondAnim = state.pets?.second?.anim?.counter ?? 0;
    record(
      mainAnim > 0 && secondAnim > 0,
      '兩隻各自的動畫葉子都收到過指令',
      `main.anim=${mainAnim}  second.anim=${secondAnim}`,
    );
    record(
      mainAnim !== secondAnim,
      '兩隻的葉子計數彼此獨立（不是同一份）',
      `main=${mainAnim} second=${secondAnim}`,
    );

    // ── 4) 指派模式下全域工作狀態必須是空的 ─────────────────────────────
    // （否則其他寵物也會跟著反應 —— 那正是指派模式要避免的）
    const globalLeaf = state.sections?.workStatus;
    record(
      globalLeaf?.data?.state === null || globalLeaf?.data === null,
      '指派模式下全域工作狀態維持空閒',
      JSON.stringify(globalLeaf?.data ?? null),
    );

    // ── 5) 綁定要落盤（重啟後不洗牌）────────────────────────────────────
    const bindingFile = join(tmpRoot, 'pet-sessions.json');
    record(existsSync(bindingFile), 'session→寵物綁定已落盤', bindingFile);

    // ── 6) 狀態檔裡直接點名 pet 時要聽它的 ─────────────────────────────
    writeState({ schema: 1, seq: 3, ts: Date.now(), state: 'error', task: '出錯了', session_id: 'sess-1', pet: 'second' });
    const gotNamed = await waitUntil(() => bridge.petWorkStates().second?.data?.state === 'error');
    record(gotNamed, '狀態檔的 pet 欄位可以直接指定寵物', JSON.stringify(bridge.petWorkStates().second?.data ?? null));

    // ── 7) shared:true 回到 DSH 的共享行為 ──────────────────────────────
    writeState({ schema: 1, seq: 4, ts: Date.now(), state: 'result', task: '整理完了', session_id: 'sess-1', shared: true });
    await waitUntil(() => bridge.current().state === 'result');
    const globalAfterShared = (await readPets()).sections?.workStatus?.data;
    record(
      globalAfterShared?.state === 'result',
      'shared:true 時回到 DSH 的全域工作狀態',
      JSON.stringify(globalAfterShared ?? null),
    );

    // ── 8) 沒有明確對象時維持共享（保住既有單寵物行為）──────────────────
    // 這條是回歸閘門：既有的 --selftest 寫的狀態檔沒有 session_id，
    // 若多寵物時改成「一律指派」，那支自檢與既有單寵物行為就會壞掉。
    writeState({ schema: 1, seq: 5, ts: Date.now(), state: 'thinking', task: '沒有對象的狀態', session_id: null });
    await waitUntil(() => bridge.current().state === 'thinking');
    const globalNoTarget = (await readPets()).sections?.workStatus?.data;
    record(
      globalNoTarget?.state === 'thinking',
      '沒有明確對象（無 session）時維持 DSH 的全域行為',
      JSON.stringify(globalNoTarget ?? null),
    );
  } catch (error) {
    record(false, '多寵物自檢執行中斷', error instanceof Error ? error.message : String(error));
  } finally {
    try {
      bridge?.stop();
    } catch {
      /* 收尾失敗不影響結果 */
    }
    try {
      await host?.dispose();
    } catch {
      /* 同上 */
    }
    try {
      await server?.close();
    } catch {
      /* 同上 */
    }
    if (savedHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = savedHome;
    delete process.env.DSH_PET_IN_PROCESS;
    try {
      rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      /* 臨時目錄清不掉不影響結果 */
    }
  }

  return { passed, lines };
}

/** 檔案存在與否（不拋）。 */
function existsSyncSafe(path) {
  try {
    return readFileSync(path) !== null;
  } catch {
    try {
      // eslint-disable-next-line no-undef
      return require('node:fs').existsSync(path);
    } catch {
      return false;
    }
  }
}

/**
 * 直接執行時跑一次自檢（開發時最方便的入口）。
 *
 * 判斷「是不是被當成腳本執行」：argv[1] 的結尾是本檔名。
 * 不用 import.meta.main（要 Node 24+，而這個專案支援 Node 22.12+）。
 */
if (process.argv[1] && process.argv[1].endsWith('selftest-multipet.mjs')) {
  runMultipetSelfTest()
    .then((result) => {
      process.stdout.write(result.passed ? '\n多寵物自檢通過。\n' : '\n多寵物自檢未通過（見上方 FAIL 行）。\n');
      process.exit(result.passed ? 0 : 1);
    })
    .catch((error) => {
      process.stderr.write(`多寵物自檢失敗：${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
      process.exit(1);
    });
}
