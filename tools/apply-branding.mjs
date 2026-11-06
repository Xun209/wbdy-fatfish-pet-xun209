#!/usr/bin/env node
/**
 * 把桌面 Helper 的「對外身分」從 dsh-pet 改成 workbuddy-pet。
 *
 * 為什麼需要這個腳本（而不是直接改檔案就好）：
 *   `runtime/electron-helper/**` 是從 DSH 基準版複製來的原樣檔案。
 *   任何一次「重新從上游複製」都會把改名蓋回去，改名就悄悄失效了。
 *   所以把改名做成一支冪等腳本，排在複製之後執行 —— 這樣改名是可重現的。
 *
 * 改什麼、為什麼改：
 *   1. 托盤提示文字 / 視窗標題 / 錯誤前綴 —— 使用者看得到的名稱。
 *      托盤上寫「dsh-pet」會跟 DSH 自己那隻寵物混淆。
 *   2. Electron 應用名（app.setName）與 userData 目錄 —— 分成自己的資料目錄，
 *      才不會跟 DSH Desktop 的那隻寵物搶同一份 Chromium profile
 *      （症狀是 "Unable to move the cache" 與 "Gpu Cache Creation failed"）。
 *   3. 附帶把日誌前綴 [dsh-pet] / [dsh-pet-desktop-helper] 一併換掉，
 *      免得主機主控台看起來像在跑 DSH 的寵物。
 *
 * ★ 不動的（內部協定，改了會壞）：
 *   - 路由前綴 /dsh-pet-7340、bridge scheme dsh-pet-bridge://
 *   - CSS class / dataset（.dsh-pet-menu、data-plugin="dsh-pet" 等）
 *   - 環境變數名（DSH_PET_*）與協定常數
 *   這些是 DSH 宿主半側（lib/）與 Helper 之間的契約，兩邊必須一致。
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HELPER_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'runtime', 'electron-helper')
const HOST_LIB = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'index.js')

/** 逐字替換：每組是 [要換的字串, 換成什麼]。 */
const REPLACEMENTS = [
  // 使用者可見的名稱
  ["'dsh-pet 桌面宠物'", "'workbuddy-pet 桌面宠物'"],
  ['<title>dsh-pet 桌宠（桌面模式）</title>', '<title>workbuddy-pet 桌宠（桌面模式）</title>'],
  ["'dsh-pet 配置错误：'", "'workbuddy-pet 配置错误：'"],
  // 應用名與資料目錄（分開就不會跟 DSH 那隻搶 profile）
  ["app.setName('dsh-pet-electron-helper')", "app.setName('workbuddy-pet-electron-helper')"],
  ["app.setPath('userData', path.join(app.getPath('appData'), 'dsh-pet'))",
   "app.setPath('userData', path.join(app.getPath('appData'), APP_MODE ? 'workbuddy-pet' : 'workbuddy-pet-electron-helper'))"],
  // 日誌前綴
  ['[dsh-pet-desktop-helper]', '[workbuddy-pet-desktop-helper]'],
  ['[dsh-pet helper]', '[workbuddy-pet helper]'],
  ['[dsh-pet]', '[workbuddy-pet]'],
]

/**
 * DSH 宿主半側（lib/index.js）裡要換的字串。
 *
 * 與 Helper 分開處理：這是 vendored 的 DSH 程式碼，能動的只有「日誌／錯誤訊息前綴」，
 * 路由前綴 /dsh-pet-7340、bridge scheme、User-Agent 一律不動（是兩邊的契約）。
 */
const HOST_REPLACEMENTS = [
  ['[dsh-pet desktop helper]', '[workbuddy-pet desktop helper]'],
  // 宿主半側管理桌面 Helper 的那幾句日誌／錯誤訊息
  ['dsh-pet desktop helper', 'workbuddy-pet desktop helper'],
  ['dsh-pet desktop helper started', 'workbuddy-pet desktop helper started'],
  ['[dsh-pet]', '[workbuddy-pet]'],
  ['dsh-pet: ', 'workbuddy-pet: '],
]

/**
 * 寵物主機自己的摘要文字（使用者會在主控台看到）。
 *
 * 只換「這隻寵物是誰」的部分；「沿用 DSH pet 實作」那類描述血緣的說明保留 ——
 * 那是在講架構來歷，不是產品名稱。
 */
const HOST_APP_REPLACEMENTS = [
  ['DSH pet 套件根', 'workbuddy-pet 套件根'],
  ['已載入 DSH pet 宿主半側', '已載入 workbuddy-pet 宿主半側'],
  ['（由 DSH pet 的桌面 Helper 托管）', '（由 workbuddy-pet 的桌面 Helper 托管）'],
  ['找不到可用的 DSH pet 套件', '找不到可用的 workbuddy-pet 套件'],
]

/** 遞迴列出目錄下的所有 .js 檔。 */
function jsFiles(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...jsFiles(full))
    else if (name.endsWith('.js')) out.push(full)
  }
  return out
}

function main() {
  let changedFiles = 0
  let changedSpots = 0

  const apply = (file, replacements) => {
    const before = readFileSync(file, 'utf8')
    let after = before
    for (const [from, to] of replacements) {
      if (!after.includes(from)) continue
      changedSpots += after.split(from).length - 1
      after = after.split(from).join(to)
    }
    if (after !== before) {
      writeFileSync(file, after, 'utf8')
      changedFiles += 1
      return true
    }
    return false
  }

  for (const file of jsFiles(HELPER_DIR)) {
    apply(file, REPLACEMENTS)
  }
  if (apply(HOST_LIB, HOST_REPLACEMENTS)) {
    console.log('[apply-branding] lib/index.js（DSH 宿主半側）已換日誌前綴')
  }
  const hostApp = join(dirname(fileURLToPath(import.meta.url)), '..', 'pet-host', 'main.mjs')
  if (apply(hostApp, HOST_APP_REPLACEMENTS)) {
    console.log('[apply-branding] pet-host/main.mjs 摘要文字已換品牌名')
  }

  console.log(`[apply-branding] 套件根：${HELPER_DIR}`)
  console.log(`[apply-branding] 改了 ${changedFiles} 個檔案、${changedSpots} 處`)
  if (changedFiles === 0) {
    console.log('[apply-branding] 已經是目標樣子（冪等，重跑無副作用）')
  }
}

main()
