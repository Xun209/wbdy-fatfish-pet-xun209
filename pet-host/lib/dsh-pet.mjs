/**
 * 載入 DSH pet 的宿主半側，並偽造一份 Cordis 上下文給它。
 *
 * 為什麼是「偽 ctx」而不是自己重寫宿主半側：DSH pet 的宿主半側（`lib/index.js`）已經包含
 * 路由、狀態倉、工作狀態機、餘額輪詢、聊天記錄、桌面 Helper 排程等全部邏輯，
 * 而其中最關鍵的一塊——**工作狀態的外部寫入端點** `POST /dsh-pet-7340/work-status`——
 * 正是我們要的接縫。重寫等於把這份邏輯再抄一遍，日後兩邊一定會漂移。
 *
 * 偽 ctx 補的每一個能力與「為什麼需要它」：
 * - effect      → 插件用它登記副作用與清理函式；
 * - provide/get → 插件用它掛出 `petApi7340` 服務（餘額／語音／識別的註冊槽）；
 * - on          → 監聽 DSH 會話事件；WorkBuddy 沒有這套事件，回空實作；
 * - webServer   → 插件把 `/dsh-pet-7340` 前綴路由註冊上來，我們自己掛到 HTTP 服務；
 * - logger      → 插件的日誌出口；
 * - llm/credentials/agentDefaultModel → 碎碎念與對話用；WorkBuddy 沒有模型後端，明確降級。
 * @module wbdy-fatfish-pet/pet-host/lib/dsh-pet
 */

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** DSH pet 的路由前綴；宿主半側的 ROUTE_SEGMENT 與之一致。 */
export const ROUTE_SEGMENT = '/dsh-pet-7340';

/**
 * 動態載入 DSH pet 的宿主半側。
 *
 * 必須是「動態」import：載入前要先註冊 loader（轉接三個 DSH 專用套件），
 * 靜態 import 會在模組圖求值期就觸發那三個 import，來不及轉接。
 *
 * @param {string} dshPetRoot - DSH pet 套件根（含 lib/、assets/、runtime/）。
 * @returns {Promise<{apply: Function, inject: string[], name: string}>} 插件模組。
 */
export async function loadDshPet(dshPetRoot) {
  const entry = join(dshPetRoot, 'lib', 'index.js');
  const mod = await import(pathToFileURL(entry).href);
  if (typeof mod.apply !== 'function') {
    throw new Error(`DSH pet 宿主半側載入失敗（${entry} 沒有匯出 apply）`);
  }
  return mod;
}

/**
 * 建立偽 ctx。
 *
 * @param {object} options - 選項。
 * @param {object} options.logger - 日誌出口（介面同 DSH 的 ctx.logger）。
 * @param {Array} options.routes - 插件註冊路由的收集陣列（與服務共用同一份）。
 * @param {{value: number}} options.portRef - 目前綁定的 port（服務先起、插件後套用，port 要能後填）。
 * @param {{value: string}} options.originRef - 服務 origin（同上，埠號順延時要跟著換）。
 * @param {object} options.ai - 模型後端（OpenAI 相容的 ctx.llm 實作；未接金鑰時為 null）。
 * @param {string} [options.token] - 寫端點令牌：宿主半側要拿它啟動桌面 Helper，
 *   否則 Helper 的 bridge 轉發不帶令牌 → 宿主守門一律 403（症狀：桌面寵物右鍵
 *   「顯示位置」等寫操作點了沒反應）。獨立 Helper 進程不是 APP 模式，拿不到
 *   DSH_PET_APP_TOKEN，所以這裡把主機的令牌原樣傳下去。
 * @returns {object} 偽 ctx。
 */
export function createHostContext({ logger, routes, portRef, originRef, ai, token }) {
  /** effect 收集到的清理函式；釋放時「後註冊先釋放」（與 DSH 一致）。 */
  const disposers = [];
  /** 插件 provide 出來的服務。 */
  const services = new Map();
  /** 初始化期間的失敗（單項失敗不拖垮整個主機）。 */
  const failures = [];

  /**
   * 內建服務：宿主半側要的那些能力。
   *
   * ★ 為什麼要放進 `get()` 的查找鏈（而不是只當 ctx 的屬性）：
   *   0.4.9 的宿主半側改成**全部軟取**（`ctx.get(name, false)`）——它不再宣告
   *   `inject`，因為宣告了就會讓插件行在服務缺席時一直 pending，把 DSH 的啟動流程掛死。
   *   同一份軟取程式碼在 WorkBuddy 版也會走同一條路，所以這裡的 `get()` 必須
   *   能取到內建服務；取不到 → 路由註冊不上、碎碎念與對話全部失效。
   */
  const builtins = {
    /**
     * webServer 替身：插件把路由註冊上來，我們的 HTTP 服務再按同一份表分發。
     *
     * port 用 getter 讀：服務先監聽、端口由作業系統指派，構造 ctx 時端口還不知道。
     */
    webServer: {
      get port() {
        return portRef.value;
      },
      /** 插件用它拼桌面 Helper 的設定地址；WorkBuddy 只走回環。 */
      getOrigin() {
        return originRef.value;
      },
      register(spec) {
        routes.push({ kind: spec.kind, path: spec.path, handler: spec.handler });
        return () => {
          const index = routes.findIndex((route) => route.handler === spec.handler);
          if (index >= 0) routes.splice(index, 1);
        };
      },
    },

    /** 已鑑權地址：WorkBuddy 沒有瀏覽器頁面可開，原樣回 origin。 */
    connection: {
      authenticatedUrl: (baseUrl) => baseUrl,
    },

    /** 斜杠命令：WorkBuddy 沒有斜杠命令面板，回空實作但保持介面形狀。 */
    commands: {
      register: () => () => {},
    },

    /** 目前對話模型：接到金鑰就報出實際使用的 provider/model，沒接就回空（碎碎念／對話會明確失敗，不會假裝成功）。 */
    agentDefaultModel: {
      currentSelection: () => {
        const described = ai?.describe?.();
        return described?.ready ? { provider: described.provider, model: described.model } : { provider: '', model: '' };
      },
    },

    /** 憑據：WorkBuddy 不持有 DSH 憑據，餘額查詢恆走失敗分支。 */
    credentials: {
      resolve: async () => undefined,
    },

    /**
     * 模型服務。
     *
     * 接了金鑰 → 真的能生成（碎碎念與對話會用）。
     * 沒接金鑰 → 只給「列出服務商／模型」的空清單：設定頁的模型下拉框會是空的，
     * 但 `/models` 端點仍回 200（而不是 500），故障面最小。
     */
    llm: {
      listProviders: () => ai?.listProviders?.() ?? [],
      listConfigurableProviders: () => ai?.listProviders?.() ?? [],
      listModels: async () => ai?.listModels?.() ?? [],
      resolveModelInfo: async (provider, model, signal) => ai?.resolveModelInfo?.(provider, model, signal) ?? {},
      stream: (options) => {
        if (!ai) throw new Error('沒有可用的模型後端（缺 API 金鑰）');
        return ai.stream(options);
      },
    },
  };

  const context = {
    /**
     * Cordis 的 effect 語義：跑一次註冊函式並收集它返回的釋放函式。
     *
     * 為什麼要自己收集：插件卸載（或主機退出）時必須能一次性收乾淨，
     * 否則桌面 Helper 會變成孤兒進程。
     */
    effect(setup, label) {
      try {
        const dispose = setup();
        if (typeof dispose === 'function') disposers.push(dispose);
        return dispose;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${label ?? '未標註'}: ${message}`);
        logger.error(`初始化「${label ?? '未標註'}」失敗（已跳過，不影響其它部分）：${message}`);
        return undefined;
      }
    },

    /** 提供一個服務。 */
    provide(name, value) {
      services.set(name, value);
      return () => {
        if (services.get(name) === value) services.delete(name);
      };
    },

    /**
     * 取服務。
     *
     * 語義與 DSH 的 `ctx.get(name, required)` 一致：取不到回 undefined，不拋。
     * 查找順序：插件 provide 的 → 內建的（webServer / llm / credentials / …）。
     *
     * ★ 內建服務必須在這條鏈上：0.4.9 的宿主半側一律用 `ctx.get(name, false)` 軟取
     *   服務（不再宣告 inject），取不到就當服務不存在 → 路由註冊不上、模型功能全失效。
     */
    get(name) {
      if (services.has(name)) return services.get(name);
      return builtins[name];
    },

    /**
     * 監聽 DSH 會話事件。
     *
     * WorkBuddy 沒有 DSH 的事件系統，狀態改由「狀態檔 → POST /work-status」這條路進來。
     * 回一個可呼叫的釋放函式：插件會把它交給 effect 收集，語義不能缺。
     */
    on() {
      return () => {};
    },

    logger,

    /**
     * 寫端點令牌：主機的守門（server.mjs 的 guard）用它判斷寫請求是否放行。
     *
     * 宿主半側啟動桌面 Helper 時要把這個令牌傳下去（見 lib/index.js 的
     * DSH_PET_TOKEN）：Helper 的 bridge 轉發帶上它，寫端點才不會被 403。
     */
    hostToken: token,
  };

  // 內建服務同時掛成屬性：舊版宿主半側是直接讀 ctx.llm / ctx.webServer 的。
  // 兩種取法都留著 → 新舊兩版宿主半側都能跑。
  Object.assign(context, builtins);

  return {
    ctx: context,
    failures,
    /** 釋放全部 effect：後註冊先釋放，確保桌面 Helper 最後被停掉。 */
    async dispose() {
      for (const dispose of disposers.splice(0).reverse()) {
        try {
          await dispose();
        } catch (error) {
          logger.warn(`釋放某項副作用失敗：${error instanceof Error ? error.message : String(error)}`);
        }
      }
    },
  };
}
