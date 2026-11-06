# WorkBuddy 大肥魚桌寵 · 勛

WorkBuddy 桌面版寵物版大肥魚：WorkBuddy 沒有可註冊的 lifecycle hook，改用輪詢本機 workbuddy.db 的 sessions 表推斷狀態。

> 本倉庫為 **勛** 的版本，改編自
> [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)（DeepSeek Harness 的大肥魚桌寵，MIT）與
> [MeteorNOX/DeepSeek-Balance-Whale-Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget)（小鯨魚記賬掛件，MIT）。
> 角色形象為社群二創的 DeepSeek「大肥魚」（鯨魚娘），非官方形象，美術素材 CC BY-NC-SA 4.0（禁止商用）。
> 詳見 [LICENSE](LICENSE)。

---

# 大肥魚桌寵 · WorkBuddy 版（fatfish-pet）

一隻住在 Windows 桌面上的藍髮鯨魚娘「**藍毛小女僕**」。她不聊天、只陪著你，
但會**自己看懂 WorkBuddy 的 Agent 正在幹嘛**，並切換待機 / 跑動 / 揮手 / 思考 / 撒嬌等動畫。

本版**完全基於 DSH 官方桌寵**（[PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)）
的 Electron 桌面寵物 Helper 重寫而來 —— 109 支 640×360 VP9-alpha webm 動畫、
完整的物理引擎（重力 / 迴彈 / 拋擲 / 寵物互撞）、右鍵選單樹、氣泡、表情包、
六檔工作狀態與設定檔，**全部沿用**。

```
WorkBuddy Agent ──hook──▶ scripts/wb-state-hook.mjs ──▶ 狀態檔 ──▶ 寵物主機 ──▶ Electron Helper ──▶ 動畫
                             （六檔：thinking/working/result/waiting/success/error）
```

---

## 目錄結構

```
wbdy-fatfish-pet/
├── .codebuddy-plugin/       WorkBuddy 插件清單（manifest）
├── hooks/                   Claude Code 相容 hook 宣告（狀態橋的觸發點）
├── scripts/                 狀態橋接腳本（hook 執行體 + 狀態儲存）
├── skills/                  讓 Agent 會跟大肥魚說話的技能
├── .mcp.json                MCP 伺服器（pet_say / pet_state 兩個工具）
├── pet-host/                寵物主機（讀狀態檔、拉起 Electron Helper、供素材）
├── lib/                     ★ DSH 版宿主半側 / Electron 應用模式（318 檔 / 4.10 MiB）
├── runtime/
│   └── electron-helper/     ★ DSH 版桌面寵物 Helper（Electron 主進程 + 視窗 + 動畫引擎）
├── assets/
│   ├── webm/                ★ 109 支動畫（640×360 VP9-alpha）
│   ├── memes/               ★ 27 張表情包（384×384）
│   ├── pic/                 ★ 8 張通知圖示 / 游標（192×192）
│   ├── fonts/               ★ 上首软糖体.ttf
│   ├── sound/               ★ 點擊音效
│   ├── config.jsonc         ★ 完整設定檔（動畫池 / 物理 / 氣泡文案 / 人設 / 表情包對照）
│   └── logo.png             插件圖示
├── tools/
│   └── package-plugin.mjs   打包腳本（壓成 zip）
├── README.md                ← 你在看的這份
├── INSTALL.md               ← 給 AI 讀的安裝指令
└── LICENSE                  程式 MIT ＋ 素材 CC BY-NC-SA 4.0（禁止商用）
```

★ = **自 DSH 版原樣沿用**（逐檔 SHA-256 一致）

> **布局契約（重要，別隨意搬動）**
> DSH 的素材路徑全部由 `PACKAGE_ROOT` 派生，而 `PACKAGE_ROOT` = `lib/` 的父目錄。
> 因此 `lib/` 必須放在**插件根**，而 `assets/` 與 `runtime/electron-helper/`
> 必須是它的兄弟目錄。這個布局下以下路徑全部自動成立，一行都不用改：
>
> | 誰算的 | 路徑 |
> |---|---|
> | `lib/app.js` | `resolve(PACKAGE_ROOT, "runtime", "electron-helper", "main.js")` |
> | `lib/app.js` | `join(PACKAGE_ROOT, "runtime/electron-helper/index.html")` |
> | `lib/index.js` | `join(PACKAGE_ROOT, "assets", "config.jsonc")` |
> | `lib/routes/assets.ts` | `join(PACKAGE_ROOT, "assets", "fonts" / "pic" / "memes" / "sound")` |
> | `lib/spawn.ts` | `join(PACKAGE_ROOT, "assets", "webm")` |
> | `runtime/…/main/windows.js`、`main/tray.js` | `path.join(helperDir, "..", "..", "assets", "logo.png")` |
>
> 換句話說：**寵物主機的 `DSH_PET_PACKAGE_ROOT` 就是插件根**。

---

## 特色

- **真·DSH 版血統**：不是重寫的「類似版」，而是 DSH 官方桌寵的 Helper 原封搬過來。
  物理手感、動畫節奏、氣泡排版、選單樹全部一致。
- **109 支透明動畫**：待機呼吸、跑動、揮手、跳躍、撒嬌、碎碎念、睡覺、吃東西、時節…
- **六檔工作狀態聯動**：`thinking` / `working` / `result` / `waiting` / `success` / `error`
  各對應一支專屬動畫與一組氣泡文案。
- **可對話**：Agent 透過 MCP 工具 `pet_say` 直接讓她冒出台詞；`pet_state` 查她現在知道什麼。
- **零設定檔依賴**：預設設定直接吃 `assets/config.jsonc`，使用者想改再覆寫。

---

## 安裝

見 [INSTALL.md](INSTALL.md)（那份是寫給 AI 讀的，可以直接丟給 WorkBuddy 的 AI 執行）。

手動三步：

```bash
# 1) 把插件目錄（含 .codebuddy-plugin/）放進 WorkBuddy 的本地技能市集
cp -r wbdy-fatfish-pet ~/.workbuddy/skills-marketplace/    # 國際版 ~/.workbuddy-ai/

# 2) 在 WorkBuddy → 設定 → 插件 啟用 fatfish-pet

# 3) 啟動寵物主機（見 INSTALL.md 的「啟動寵物主機」一節）
```

---

## 素材規格

| 項目 | 值 |
|---|---|
| 動畫數量 | **109 支**（`assets/webm/`） |
| 動畫解析度 | **640 × 360**（VP9-alpha webm，透明背景） |
| 腳底線 / 命中框 | 腳底 Y=330；命中框 `x0:200 y0:50 x1:440 y1:335` |
| 播放引擎 | HTML5 `<video>` + A/B 雙緩衝（不用 canvas 逐幀） |
| 表情包 | 27 張，384×384 PNG |
| 字型 | 上首软糖体（`candy` 預設） |
| 播放相容性 | Chromium / Edge / Firefox ✅；**Safari ❌**（不認 webm alpha，會黑底） |

> **注意**：這是 **DSH 版的素材體系**（640×360 / 109 支 / webm-alpha）。
> 舊的 PySide6 版走的是 241 幀 / 42ms / WebP sheet，兩套**不可混用**。

---

## 素材與授權

- **程式碼**：MIT。
- **美術素材**：角色形象為社群二創的 DeepSeek「**大肥魚**（鯨魚娘 / 藍毛小女僕）」，
  **並非 DeepSeek 官方形象**；按 **CC BY-NC-SA 4.0** 授權 —— 署名 · **禁止商用** · 相同方式共享。
  - 原型「溟月」出自 B 站 [@上善無形](https://space.bilibili.com/4456176)
  - DeepSeek 版（女僕鯨魚娘）設計出自 B 站 [@ZipZipPipe](https://space.bilibili.com/4168597)
- 動畫素材取自 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)。
- 轉發時請保留 [LICENSE](LICENSE) 的兩節與署名資訊。

---

## 與 DSH 版的對應關係

### 直接沿用（逐檔 SHA-256 一致，未做任何修改）

| 項目 | 路徑 | 說明 |
|---|---|---|
| 桌面寵物 Helper | `runtime/electron-helper/**`（34 檔 / 507,684 B） | Electron 主進程、透明置頂小窗、sprite 動畫引擎（A/B 雙 video）、物理（重力/迴彈/拋擲/互撞）、右鍵選單樹、氣泡、托盤、橋接層。**整包照搬**，只換外層宿主。 |
| 宿主半側 | `lib/index.js`（304 KB）＋ `lib/client.js`（639 KB） | `lib/index.js` 是 Cordis 宿主半側 —— WorkBuddy 靠 `pet-host/lib/dsh-peers/` 的三個小檔用 Node 官方的 `module.registerHooks()` 在執行期轉接 `@deepseek-ai/*` peer。`lib/client.js` 是瀏覽器半側 React overlay，留著日後做網頁版浮層。<br>發佈包只含這兩個檔（見「刻意沒帶」）。 |
| 動畫素材 | `assets/webm/**`（109 支 / 52.74 MiB） | DSH 版播放引擎直接吃 webm。 |
| 表情包 | `assets/memes/**`（27 張 / 4.63 MiB） | 供碎碎念與對話配圖。 |
| 通知圖示 / 游標 | `assets/pic/**`（8 張 / 0.25 MiB） | |
| 字型 | `assets/fonts/上首软糖体.ttf`（3.89 MiB） | 氣泡與提示字型。 |
| 音效 | `assets/sound/click-duck.wav` | |
| 完整設定檔 | `assets/config.jsonc`（35,472 B） | 動畫池（idle/turn/drag/clicks/moves/categories/events/sleep）、物理 9 參數、氣泡文案 `workStatusTexts` 六檔×3 句、`whisperPrompt` 人設、表情包描述對照、`eventsRefreshSec`、`animationWeights`。 |

### 為 WorkBuddy 新寫

| 項目 | 路徑 | 說明 |
|---|---|---|
| 插件清單 | `.codebuddy-plugin/plugin.json` | WorkBuddy 插件 manifest（`hooks` / `mcpServers` / `skills` 欄位）。 |
| 狀態橋接 | `hooks/hooks.json` + `scripts/wb-state-hook.mjs` | WorkBuddy 走 Claude Code 相容 hook：事件當下 spawn hook、stdin 送 JSON。**零輪詢、免權限**。輸出六檔狀態檔。 |
| MCP 工具 | `.mcp.json` | `pet_say`（讓她說話）、`pet_state`（查狀態）。 |
| 寵物主機 | `pet-host/` | 讀狀態檔 → 拉起 Electron Helper → 提供素材路由。**取代 DSH 的 Cordis 宿主半側**。 |
| 打包腳本 | `tools/package-plugin.mjs` | 純 Node、零依賴的 zip 打包器。 |

### 刻意沒帶

| 項目 | 原因 |
|---|---|
| `assets/preview/`（109 支 GIF / 65.88 MiB） | 只給 README 展示用，不進發佈包。 |
| `lib/app.js`（2.26 MiB） | DSH 的 Electron 應用模式主進程。雖是唯一零 DSH peer 依賴的檔案，但有兩個硬傷：埠號寫死 `server.listen(0,'127.0.0.1')`（無法指定 `--port N`）；令牌只出現在設定頁 URL 的 fragment 裡，外部行程讀不到 → `POST /dsh-pet-7340/work-status` 會被 403（這條正是寵物主機送狀態的唯一接縫）。 |
| `lib/standalone.js`（369 KB） | 需要 `zod` / `openai` / `@anthropic-ai/sdk` 三個第三方套件，發佈包裡沒有 → 直接 `ERR_MODULE_NOT_FOUND`。 |
| `lib/node-*.js`、`lib/promise-DxjFfmXm.js`（4 檔 / 105 KB） | 排除 `app.js` 後就**不可達**了：逐檔查過相對 import，只有 `app.js` 與這些 chunk 彼此互相引用，而 `lib/index.js` 與 `lib/client.js` 都是零相對 import、完全自足。<br>留著不只是浪費體積 —— `promise-DxjFfmXm.js` 是 **@anthropic-ai/sdk 的打包產物**，放在發佈包裡會讓人以為這個插件依賴 Anthropic SDK，而它實際上不需要（工作狀態的產生端是 WorkBuddy 自己的 hook）。**留著是誤導，不是備份。** |
| `lib/types/**`（310 檔 / 610 KB） | 全部是 `.d.ts` 型別宣告。Node 的 ESM/CJS 解析器不認 `.d.ts` 副檔 → 執行期不可能被 `import`；全庫掃過也沒有任何 `.js` 引用它們。純建置產物（API 介面的說明文件），對執行毫無影響。 |
| DSH 的 `src/host/**`、`src/client/**`、`src/shared/**`（原始 TypeScript 原始碼） | Cordis/React 體系，與 WorkBuddy 無關；其**編譯產物**已在 `lib/`，能沿用的純邏輯也被 Helper 內的 `shared-core.js` 涵蓋。 |
| `src/standalone/**`（單機模式 CLI） | WorkBuddy 版另有寵物主機，職責重疊。 |
| 舊 PySide6 版的 `pet/assets/anim_full/`（1,299 MiB sheet） | 那是另一套素材體系（241 幀 / 42ms / WebP），與 DSH 的 webm 播放引擎不可混用。 |

> 上述 `lib/` 排除由打包腳本自動處理（`tools/package-plugin.mjs` 的 `LIB_EXCLUDE` 與 `LIB_EXCLUDE_DIRS`），
> **原始檔仍留在 `lib/` 裡**（沒有刪）；要一起打包用 `--include-lib-extras`。

---

## 已知限制

1. **Safari 不支援**：webm 的 alpha 在 Safari 會被丟掉，渲染成黑底。Windows / macOS
   用 Chromium 系（Edge / Chrome）無此問題。
2. **Windows 需關硬體加速**：DWM 分層視窗在硬體加速合成下會有黑邊與內容遺失，
   Helper 已內建 `app.disableHardwareAcceleration()`（見 `runtime/electron-helper/main.js`）。
3. **Electron 依賴**：寵物主機需要本機有 Electron 執行環境。首次啟動若找不到，
   會自動下載一份到 `~/.dsh/electron`（約 100 MiB，走 npmmirror 鏡像，只下一次）——
   **不需要使用者手動安裝**，但第一次啟動要等下載完。
4. **Helper 只能跟宿主同生死**：宿主退出 → Helper 的 stdout 管道斷 → 它自己退出，
   不留僵屍程序。

---

## 開發

```bash
# 列出插件清單與狀態（桌寵 pet / 記賬 usage）
node tools/package-plugin.mjs --list

# 打包（預設輸出到 <工作區>/dist/<slug>.zip；一次會打所有插件）
node tools/package-plugin.mjs

# 只打其中一個
node tools/package-plugin.mjs --only pet
node tools/package-plugin.mjs --only usage

# 指定輸出位置（只能搭配 --only）
node tools/package-plugin.mjs --only pet --out ../wbdy-fatfish-pet.zip

# 只列出會被打包的檔案，不實際壓縮（會一併列出被排除的檔案與原因）
node tools/package-plugin.mjs --dry-run

# 連 lib/app.js、lib/standalone.js、那 4 個 chunk、lib/types/** 一起打包
node tools/package-plugin.mjs --include-lib-extras
```

打包腳本為純 Node（無 npm 依賴），自帶最小 ZIP 寫入器（deflate + CRC-32）。
**同一支腳本服務兩個插件**（桌寵與記賬），每個插件各自走三道閘門：

1. **branding** —— 自動套用 `tools/apply-branding.mjs`（冪等；沒有這個腳本的插件會略過、不中斷）
2. **必備條目** —— 少任何一個 manifest / hook / MCP / skill / 核心程式就不產出 zip
3. **語法閘門** —— 每個 JS 檔跑 `node --check`，不通過就不產出 zip

> **打包流程會先自動套用改名**（`tools/apply-branding.mjs`，冪等）。
> `runtime/electron-helper/**` 與 `lib/**` 是從 DSH 基準版複製來的原檔，
> **任何一次「重新從上游複製」都會把 `dsh-pet` → `workbuddy-pet` 的改名蓋回去**
> （症狀：托盤上又寫回 dsh-pet、而且 Electron 又跟 DSH 自己那隻寵物搶同一份 Chromium profile）。
> 所以打包流程會在收集檔案前自動跑一次改名腳本，**失敗即中止打包** —— 不會產出未改名的包。
> 只想手動套用：`node tools/apply-branding.mjs`。

> ⚠️ **改完打包規則，務必重跑「解壓 zip 後的 selftest」** ——
> 打包誤傷相依這種問題，**在本機原始碼目錄是測不出來的，只有解壓後才炸**。
> 工作區層級有一支現成的驗證腳本（會解壓、跑 selftest 與對齊檢查、跑完自動清掉臨時目錄）：
>
> ```bash
> node "<工作區>/_verify_packages.mjs" --only wbdy-fatfish-pet
> ```
>
> 或手動：
>
> ```bash
> node tools/package-plugin.mjs
> # 解壓到乾淨目錄後
> node "<解壓目錄>/pet-host/main.mjs" --selftest --headless --port 3097
> node "<解壓目錄>/pet-host/check-alignment.mjs"
> ```
>
> `--selftest` 全部 PASS 且 exit 0、`check-alignment.mjs` 顯示「全部對齊」且 exit 0，才算通過。

---

## 參考資料

- 上游桌寵：<https://github.com/PC2005-cloud/dsh-pet>
- 小鯨魚記帳掛件（設計參考）：<https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget>
- 本專案的兩份前置研究（唯讀）：
  - `work buddy改\_research_variants.md` —— 六變體盤點
  - `work buddy改\_research_dsh_reference.md` —— DSH 版完整逆向規格
  - `work buddy改\_impl_packaging.md` —— 素材組裝與打包紀錄
