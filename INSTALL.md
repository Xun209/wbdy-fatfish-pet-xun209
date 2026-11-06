# 安裝說明 —— 請交給 WorkBuddy 裡的 AI 執行

> 這份文件是寫給 **AI 助手** 的操作指令。人類用戶可只讀第 0 節。

---

## 0. 這是什麼

一個 WorkBuddy 插件（外加一個獨立的桌面寵物主機），讓一隻藍髮鯨魚娘「**藍毛小女僕**」
住在你的桌面上。她會自己讀 WorkBuddy Agent 的工作狀態（剛開工 / 工作中 / 等你按確認 /
完成收工 / 出錯），並切換對應的動畫與氣泡台詞；你也可以讓她說話。

寵物本體是 **DeepSeek Harness 官方桌寵（dsh-pet）的 Electron 桌面殼原封沿用**：
109 支 640×360 透明 webm 動畫、完整的物理引擎（重力 / 迴彈 / 拋擲 / 寵物互撞）、
右鍵選單樹、氣泡、表情包、六檔工作狀態與完整設定檔。

---

## 1. 安裝前檢查（AI 必須先做）

依序檢查，**任何一項不通過就停下來告訴使用者**，不要自行猜測路徑：

```bash
# ① Node 22+（狀態橋與 MCP 伺服器都要用）
node --version

# ② WorkBuddy 有跑過會話嗎？（hook 事件要 WorkBuddy 在跑才會觸發）
#    WorkBuddy 資料目錄：國內版 ~/.workbuddy / 國際版 ~/.workbuddy-ai
#    （沒有這個目錄通常代表還沒跑過會話）

# ③ 磁碟空間：素材約 62 MiB ＋ 首次啟動下載 Electron 約 100 MiB
#    請確認系統碟還有 500 MiB 以上可用空間
```

> **關於 Electron**：寵物主機**不要求使用者手動安裝 Electron**。
> 首次啟動若本機找不到 Electron，會自動下載一份到 `~/.dsh/electron`
> （走 npmmirror 鏡像，約 100 MiB，**只下一次**），進度寫在主機日誌裡。
> 下載期間視窗還沒出現是正常的 —— **請耐心等待，不要重複啟動**。

---

## 2. 安裝插件

把插件目錄（含 `.codebuddy-plugin/`）放進 **WorkBuddy 的本地技能市集目錄**：

- 國內版：`~/.workbuddy/skills-marketplace/`
- 國際版：`~/.workbuddy-ai/skills-marketplace/`

目錄結構（`.codebuddy-plugin/marketplace.json` 是市集清單，`plugins[]` 指向插件）：

```json
{
  "name": "my-local-pets",
  "description": "Local marketplace for personal plugins.",
  "owner": { "name": "You" },
  "plugins": [
    {
      "name": "fatfish-pet",
      "description": "Blue fatfish (whale girl) desktop pet for WorkBuddy.",
      "version": "1.0.0",
      "source": "./fatfish-pet",
      "category": "skill"
    }
  ]
}
```

然後到 **WorkBuddy → 設定 → 插件**，把 `fatfish-pet` 啟用。

> 啟用後 WorkBuddy 會掛上兩道機制：
> - **hook**（`hooks/hooks.json`）→ `scripts/wb-state-hook.mjs`：把 Agent 事件即時寫成狀態檔
> - **MCP 工具**（`.mcp.json` → `scripts/wb-pet-mcp.mjs`）：提供 `pet_say` / `pet_state`
>
> 桌寵本身是**獨立進程**，不依賴 WorkBuddy 的插件機制 —— 兩種做法可以只選一種。

---

## 3. 啟動寵物主機

```bash
node "<plugin-root>/pet-host/main.mjs"
```

`<plugin-root>` = 插件目錄的絕對路徑（即 `.../skills-marketplace/fatfish-pet`）。

主機必須**常駐**。可選參數（都有預設值，可全部省略）：

| 參數 | 預設 | 說明 |
|---|---|---|
| `--port N` | 3080 | 本機 HTTP 埠；被占用會往後順延最多 25 個 port。 |
| `--state-file PATH` | 見第 5 節 | 覆寫狀態檔路徑。 |
| `--config PATH` | `assets/config.jsonc` | 指定設定檔；不給就自動沿用 DSH 預設設定。 |
| `--headless` | 關 | 只跑服務與狀態橋，**不**開桌面透明小窗（無 GUI 環境用）。 |
| `--selftest` | — | 自我驗證後自動退出（診斷用）。 |
| `--dsh-pet-root PATH` | 插件根 | DSH pet 套件根（見第 6 節）。 |
| `-h` / `--help` | — | 說明。 |

環境變數：

| 變數 | 說明 |
|---|---|
| `WORKBUDDY_WHALE_STATE_DIR` | 狀態目錄。未設時依序退回 `CODEBUDDY_PLUGIN_DATA` → **指路牌** → `%LOCALAPPDATA%\workbuddy-whale` → `~/.workbuddy-whale`（詳見第 5 節）。 |
| `DSH_PET_PACKAGE_ROOT` | DSH pet 套件根（見第 6 節）。 |
| `DSH_PET_ELECTRON_PATH` | 指定 Electron 執行檔（可選）。 |

### 開機自啟（可選）

若使用者想讓寵物跟著電腦開機：

- Windows：把 `node "<plugin-root>/pet-host/main.mjs"` 做成捷徑放進
  「shell:startup」資料夾（`Win + R` → `shell:startup`）
- macOS / Linux：`~/.config/autistart/*.desktop` 或 launchd

> 桌寵主機與 WorkBuddy 沒有父子關係 —— WorkBuddy 關了它也活著，反之亦然。
> 要跟 WorkBuddy 一起啟動，就把啟動項放進 WorkBuddy 的啟動項。

---

## 4. 讓她說話

### 4.1 Agent 端（日常用法）

Agent 端透過 MCP 工具（`.mcp.json` 已註冊）：

| 工具 | 用途 |
|---|---|
| `pet_say` | 讓她冒出台詞（文字會出現在她的氣泡裡）。 |
| `pet_state` | 查她現在知道什麼（狀態、任務文字、會話 id）。 |

手動測試（不經 Agent）：

```bash
# 查狀態檔
node "<plugin-root>/scripts/wb-state-hook.mjs" --get   # 若支援此旗標；否則直接讀 state.json

# 強制寫一個狀態（手動指令 5 秒內優先於 hook 寫入）
#   實作見 scripts/wb-state-store.mjs
```

### 4.2 她自己的對話窗（AI 對話 / 碎碎念）

這兩個功能要有一個 OpenAI 相容的模型後端。主機啟動時會自己找，依序：

| 順位 | 來源 | 怎麼設定 |
|---|---|---|
| 1 | 環境變數 | `WORKBUDDY_PET_AI_BASE_URL`、`WORKBUDDY_PET_AI_API_KEY`、`WORKBUDDY_PET_AI_MODEL`、`WORKBUDDY_PET_AI_PROVIDER` |
| 2 | 設定檔 | `<狀態目錄>\pet-host\ai.json`，內容 `{"baseUrl":"…","apiKey":"…","model":"…","provider":"…"}` |
| 3 | **DSH 憑據庫**（預設會用到） | `~/.dsh/.credentials.yaml` 裡 `refs` 的 `MINIMAX_CN_API_KEY`／`MINIMAX_API_KEY`；端點預設 `https://api.minimaxi.com/v1`，模型預設 `MiniMax-M3.1-Flash` |

> 第 3 順位是「沿用本機已有的金鑰」：DSH 換金鑰，寵物跟著換，不用改兩處。
> 想完全獨立，就用第 1 或第 2 順位指定自己的金鑰。

主機啟動日誌會寫明實際用的是哪一個：

```
模型後端：minimax-cn/MiniMax-M3.1-Flash（https://api.minimaxi.com/v1）← DSH 憑據庫 …
```

沒接上時不會假裝成功，碎碎念與對話會明確失敗（主機其他功能照常）。

### 4.3 直接呼叫她的對話端點

對話路由需要令牌（標頭名是 **`x-dsh-pet-token`**，不是 `Authorization`）：

```bash
# 令牌在 <狀態目錄>\pet-host\pet-host-runtime.<pid>.json
curl -X POST "http://127.0.0.1:3080/dsh-pet-7340/chat?pet=main&surface=both" \
  -H "content-type: application/json; charset=utf-8" \
  -H "x-dsh-pet-token: <token>" \
  --data-binary '{"text":"你好呀，今天累不累？"}'
# → {"ok":true,"text":"不累呀，被你一问就精神啦～","image":"可爱"}
```

> `surface` 必填：`web` / `desktop` / `both` / `any`。
> **body 必須是 UTF-8 位元組**（`curl --data-binary` 或在 Node/Python 裡指定編碼）——
> 用 GBK 送出會讓她看到一串問號，然後回「全是问号呀」。

---

## 5. 狀態檔

| 項目 | 值 |
|---|---|
| 位置 | `<狀態目錄>/state.json` |
| 狀態目錄 | `WORKBUDDY_WHALE_STATE_DIR` → `%LOCALAPPDATA%\workbuddy-whale` → `~/.workbuddy-whale` → `CODEBUDDY_PLUGIN_DATA` / `CLAUDE_PLUGIN_DATA`（**插件資料目錄排在最後**） |
| 內容 | `{ schema:1, seq:<嚴格遞增>, ts:<epoch ms>, state:"…"|null, task:"…"|null, session_id:"…"|null }` |
| `state` 六檔 | `thinking` / `working` / `result` / `waiting` / `success` / `error`（與 DSH 版一致）；**`null` = 閒置**（會話結束時寫入，DSH 的 `WorkStatusSnapshot` 也是這樣定義的） |
| `task` | 氣泡文案（工具名或事件摘要）。**上限 40 字元**（依碼點計，含截斷後的 `…`）—— 與 DSH 版的 `TASK_TEXT_MAX = 40` 一致，因為氣泡最大寬度只有約 0.5 倍寵物寬（約 231px、字號 21px ≈ 一行 11 個漢字），不截斷會把氣泡撐成好幾行蓋住寵物。 |
| 其他檔案 | 同目錄下 `state.lock`（寫入鎖）、`state-hook.log`（橋接錯誤日誌） |

### 兩邊怎麼保證算出同一個狀態目錄

**這是整條狀態鏈最關鍵的一環** —— 兩邊算得不同，症狀是「狀態檔明明存在、hook 明明有寫，
寵物卻完全不反應」，非常難查。

做法是**兩邊呼叫同一個函式**：`scripts/wb-state-store.mjs` 的 `resolveStateDir()`。
寵物主機的 `pet-host/lib/paths.mjs` 直接 `import` 它，不另訂一套優先序。

> ⚠️ **要改狀態目錄的優先序，請改共用模組**（`scripts/wb-state-store.mjs`），
> **不要讓寵物主機自己另訂一套** —— 那會讓兩邊分道揚鑣。

**為什麼插件資料目錄排在最後？**
hook 行程帶著 `CODEBUDDY_PLUGIN_DATA`，寵物主機卻沒有。若讓插件目錄優先，
兩邊就會各寫各的。改成「兩邊都用同一個**確定性預設**」後，**啟動先後完全不影響對齊**；
要用插件資料目錄時，請設 `WORKBUDDY_WHALE_STATE_DIR` 明確指定。

### 指路牌（`state-dir.txt`）—— 只在少數情況才用得上

若使用者把 `WORKBUDDY_WHALE_STATE_DIR` 指到別處，hook 會寫那裡、
而手動啟動的寵物主機（沒有那個環境變數）就需要靠指路牌找回來：

```
<確定性預設目錄>\state-dir.txt   ← 一行文字，內容是真正在用的狀態目錄
```

指路牌**只在它的 `state.json` 比確定性預設目錄更新時才被採信**（避免過期指路牌劫持）。
要驗證兩邊確實對齊，跑這個（它會把四種環境變數組合各跑一遍、逐一比對，不一致就 exit 1）：

```bash
node "<plugin-root>/pet-host/check-alignment.mjs"
```

預期輸出「全部對齊。」、exit 0。

---

## 6. DSH pet 套件根（素材與桌面殼）

寵物主機需要三樣東西，全部**已經在本插件內**，不需要另外下載：

| 需要的東西 | 插件內的位置 |
|---|---|
| 桌面透明窗執行殼 | `runtime/electron-helper/`（34 檔） |
| 動畫 / 表情包 / 設定檔 | `assets/`（webm 109 + memes 27 + pic 8 + fonts + sound + config.jsonc + logo.png） |
| 宿主半側 | `lib/`（`lib/index.js` ＋ `lib/client.js` ＋ `lib/types/**`） |

主機的查找順序：
`--dsh-pet-root` / `DSH_PET_PACKAGE_ROOT` → `<插件根>` → 開發期相對路徑 → 開發期絕對路徑。

> **注意**：`<插件根>` 就是 `DSH_PET_PACKAGE_ROOT`（`lib/` 的父目錄）。
> 這個位置不是隨便挑的 —— DSH 的素材路徑全部由 `PACKAGE_ROOT` 派生，
> 放對了才不用改任何一行路徑常數。

> **`lib/index.js` 的 `@deepseek-ai/*` 依賴怎麼解決？**
> 發佈包裡沒有 `node_modules`。寵物主機用 `pet-host/lib/dsh-peers/` 的三個小檔
> （合計約 5 KB）＋ Node 官方的 `module.registerHooks()` 在執行期做解析轉接 ——
> 不需要真的安裝 DSH 的套件。**這個目錄一定要在發佈包裡**（打包腳本預設會包含）。

---

## 7. 驗證

```bash
# ① 主機自我檢查（驗證完自動退出）
node "<plugin-root>/pet-host/main.mjs" --selftest
echo "exit=$?"     # exit 0 = 全部通過；非 0 = 有項目沒過，看輸出的診斷
```

```bash
# ② 狀態檔有沒有被 hook 寫入
#    先在 WorkBuddy 裡隨便問一句讓 Agent 動起來，再看：
type "%LOCALAPPDATA%\workbuddy-whale\state.json"
```

期望看到類似：

```json
{ "schema": 1, "seq": 12, "ts": 1792728892660,
  "state": "working", "task": "Bash", "session_id": "…" }
```

> 狀態檔沒動？先確認兩邊算的是同一個目錄：
> ```bash
> node "<plugin-root>/pet-host/check-alignment.mjs"
> ```
> 預期「全部對齊。」、exit 0（見第 5 節）。
> 若使用者設了 `WORKBUDDY_WHALE_STATE_DIR`，確認 hook 與主機**都**在同一個環境變數下啟動。

```bash
# ③ 桌面窗有沒有出來
#    沒有桌面的環境改用 --headless，只驗證服務與狀態橋
```

---

## 8. 常見問題

| 現象 | 處理 |
|---|---|
| 桌寵視窗不出現 | 確認主機進程在跑；Windows 確認沒有全螢幕程式擋住置頂窗；用 `--selftest` 看診斷。 |
| 首次啟動卡住不動 | 很可能在**下載 Electron**（約 100 MiB）。看主機日誌；或手動設 `DSH_PET_ELECTRON_PATH` 指向既有的 Electron。 |
| 她一直待機不動 | 確認 WorkBuddy 有跑會話（hook 只在 Agent 活動時觸發）；檢查 `state.json` 的 `seq` 有沒有在長。 |
| **狀態檔明明有寫、寵物卻不反應** | 最可能是**兩邊算到不同的狀態目錄**。跑 `node "<plugin-root>/pet-host/check-alignment.mjs"` 驗證；不一致就檢查 `WORKBUDDY_WHALE_STATE_DIR` 是否只在一邊有設。 |
| 狀態一直停在舊值 | hook 沒觸發 → 確認插件已在「設定 → 插件」啟用並重啟 WorkBuddy。 |
| 動畫黑底 | Safari / 不支援 webm alpha 的環境會黑底。改用 Chromium 系瀏覽器。 |
| 寵物位置怪 / 拖不動 | Windows 上 DWM 分層視窗在硬體加速下有已知黑邊問題，Helper 已內建關閉硬體加速。 |
| 找不到 `workbuddy` 目錄 | WorkBuddy 還沒跑過會話，或用的是另一個資料目錄。 |
| 打包後裝不起來 | 用 `node tools/package-plugin.mjs` 重新打包；不要手動壓縮（會漏掉 `runtime/` 與 `lib/` 的相對關係）。 |

---

## 9. 素材與授權

- **程式碼**：MIT。
- **美術素材**：角色形象為社群二創的 DeepSeek「**大肥魚**（鯨魚娘 / 藍毛小女僕）」，
  **並非 DeepSeek 官方形象**；按 **CC BY-NC-SA 4.0** 授權 ——
  署名 · **禁止商用** · 相同方式共享。
  - 原型「溟月」出自 B 站 [@上善無形](https://space.bilibili.com/4456176)
  - DeepSeek 版（女僕鯨魚娘）設計出自 B 站 [@ZipZipPipe](https://space.bilibili.com/4168597)
- 動畫素材取自 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)。
- 轉發請保留 [LICENSE](LICENSE) 的兩節與署名資訊。

---

## 記賬掛件（右下角）

插件除了桌寵本體，還帶了一個**獨立的記賬掛件**：Q 版半身像釘在 **WorkBuddy 視窗右下角**，
點一下彈氣泡，顯示目前這個工作階段的真實用量 / 會員訂閱剩餘額度。

| 項目 | 內容 |
|---|---|
| 程式 | usage-overlay/usage_overlay.py（PySide6 透明置頂小窗） |
| 資料來源 | ~/.workbuddy/workbuddy.db 的 session_usage + sessions（本機只讀） |
| 跟隨 | 每 1 秒跟一次 WorkBuddy 主視窗的位置，釘在右下角（視窗沒開就自動隱藏） |
| 單例 | %LOCALAPPDATA%\workbuddy-whale\usage-overlay.lock，不會起兩個 |

啟動（固定路徑啟動器會自動帶起來）：

`powershell
node "C:\Users\夏晨茗\AppData\Local\workbuddy-whale\launcher\start-fatfish.mjs"
`

單獨啟動 / 測試：

`powershell
python usage-overlay/usage_overlay.py            # 正常啟動
python usage-overlay/usage_overlay.py --once     # 只印一次用量，不開窗
python usage-overlay/usage_overlay.py --target-exe "DeepSeek Harness.exe"   # 測試跟隨其他視窗
`

需求：Python 3.10+、PySide6。
