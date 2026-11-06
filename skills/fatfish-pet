---
name: fatfish-pet
description: |
  與桌面寵物「藍色大肥魚（鯨魚娘）」對話，並查詢她感知到的 Agent 工作狀態。
  觸發詞：大肥魚、寵物、鯨魚、鯨魚娘、fatfish、whale、寵物狀態、她在幹嘛、
  跟大肥魚說、讓寵物講話、pet_say、pet_state、桌面小助手。
  當使用者想逗寵物、想聽寵物回話、或想確認 Agent 目前是「剛開工／工作中／等你按確認／完成收工／出錯」時使用。
description_en: |
  Talk to the desktop pet "Blue Fatfish (whale girl)" and query the Agent work status she observes.
  Triggers: fatfish, whale, desktop pet, pet status, pet_say, pet_state.
allowed-tools: mcp__fatfish-pet__pet_say, mcp__fatfish-pet__pet_state
license: MIT
version: 1.0.0
---

# 大肥魚（桌面寵物）

大肥魚是跟著 WorkBuddy 一起上班的桌面寵物。她不會自己說話，但 WorkBuddy 的
每個關鍵動作都會經由插件 hook 通知她，所以她**永遠知道 Agent 現在在幹嘛**。

## 她能感知什麼

她靠本插件的 hook（`hooks/hooks.json`）監看 WorkBuddy 的 Agent 生命週期，
並把結果寫成一個狀態檔。狀態檔只有六種狀態：

| 狀態 | 意義 | 觸發時機 |
|---|---|---|
| `thinking` | 剛開工 | 會話啟動、使用者剛送出 prompt |
| `working` | 工作中 | 正在跑工具 |
| `waiting` | 等你按確認 | 需要權限批准、或在問使用者問題 |
| `result` | 有結果了 | 工具執行完畢 |
| `success` | 完成收工 | 回合結束 |
| `error` | 出錯了 | 工具執行失敗 |
| `null` | 待機（閒置） | 會話結束、沒有進行中的工作 |

## 狀態檔在哪

| 環境 | 路徑 |
|---|---|
| WorkBuddy 插件上下文（正常情況） | `%CODEBUDDY_PLUGIN_DATA%\state.json`，例如 `C:\Users\<你>\.workbuddy\plugins\data\fatfish-pet-<marketplace>\state.json` |
| 明確覆寫 | 設定環境變數 `WORKBUDDY_WHALE_STATE_DIR` |
| 沒有插件上下文時的 fallback | `%LOCALAPPDATA%\workbuddy-whale\state.json` |

檔案內容（**固定欄位，不要改**）：

```json
{
  "schema": 1,
  "seq": 42,
  "ts": 1760000000000,
  "state": "working",
  "task": "Bash",
  "session_id": "abc-123"
}
```

- `seq`：狀態每次「實際變化」就 +1，寵物主機靠它判斷是不是新狀態
- `ts`：狀態最後一次變化的時間戳（毫秒）
- `state`：上面六種之一，或 `null`（待機）
- `task`：當下在做什麼（工具名稱、或使用者的 prompt 摘要；最多 40 個字）
- `session_id`：目前會話 ID；`null` 代表沒有進行中的會話

## 怎麼跟她說話

透過本插件註冊的兩個 MCP 工具：

### `pet_say(text)`
讓她說一句話。會把這句話寫進狀態檔的 `task` 欄位，寵物主機會立刻顯示。

**什麼時候該叫：**
- 使用者焦躁、卡住、或回覆很長 → 讓她講一句輕鬆的話（例如「她正在幫你把石頭翻過來～」）
- 一個長步驟完成 → 讓她回報進度
- 使用者只是來摸魚 → 純粹陪聊

**怎麼寫：**
- 一句、30 字以內、語氣可愛但別噁心
- 不要解釋技術細節，使用者要的是「有個活人在陪著我」
- 不要每個回合都叫，會吵

### `pet_state()`
回報她現在的狀態（state / seq / task / session_id）。

**什麼時候該叫：**
- 使用者問「她現在在幹嘛」「工作到哪了」
- 需要確認狀態橋接有沒有正常運作

## 注意事項

- 狀態橋接是**單向**的：WorkBuddy → 寵物。寵物無法反過來控制 WorkBuddy。
- `pet_say` **不會**改變六檔狀態，只會換掉 `task`。她說話不會影響使用者的流程。
- 如果 `pet_state()` 回報「還沒有狀態紀錄」，代表狀態檔還沒被建立
  （通常表示 WorkBuddy 這次對話還沒觸發任何 hook，或插件還沒被重新載入）。
