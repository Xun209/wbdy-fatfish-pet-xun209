#!/usr/bin/env node
/**
 * 大肥魚桌寵 · 固定路徑啟動器
 *
 * 為什麼要有這個（而不是直接跑插件裡的 scripts/wb-pet-start.mjs）：
 *   插件在 ~/.workbuddy/plugins/cache/fatfish-local/fatfish-pet/<版本>/ 下，
 *   **版本號會隨更新變**（現在已經有 1.0.0 / 1.0.1 兩個版本），直接指路徑的啟動項
 *   一更新就失效。本啟動器放在 %LOCALAPPDATA%\workbuddy-whale\launcher\（不變），
 *   執行時動態解析最新的插件目錄 → 插件更新也不會壞。
 *
 * 做三件事：
 *   1. 找插件根（源目錄優先，因為只有它帶 scripts/wb-pet-start.mjs）
 *   2. 啟動主機（wb-pet-start.mjs 內部已改用 WMI 建立行程 → 活得過 WorkBuddy 收工）
 *   3. 啟動看門狗（主機被意外收掉時自動拉回來；看門狗自己也用 WMI 起）
 *
 * 用法：node start-fatfish.mjs [--no-guard]
 */
import { existsSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

// ⚠️ 不能用 new URL(import.meta.url).pathname：路徑含中文時會被 URL 編碼成 %E5%A5%B9…，
// existsSync 會判成不存在（看門狗就永遠起不來）。fileURLToPath 會正確解碼。
const HERE = dirname(fileURLToPath(import.meta.url))
const GUARD = join(HERE, 'wb-pet-guard.mjs')

function findPluginRoot() {
  const home = process.env.USERPROFILE || ''
  const out = []
  const mp = join(home, '.workbuddy', 'plugins', 'marketplaces')
  if (existsSync(mp)) {
    for (const d of readdirSync(mp)) {
      const p = join(mp, d, 'plugins', 'fatfish-pet')
      if (existsSync(join(p, 'scripts', 'wb-pet-start.mjs'))) out.push(p)
    }
  }
  const cache = join(home, '.workbuddy', 'plugins', 'cache', 'fatfish-local', 'fatfish-pet')
  if (existsSync(cache)) {
    for (const v of readdirSync(cache)) {
      const p = join(cache, v)
      if (existsSync(join(p, 'scripts', 'wb-pet-start.mjs'))) out.push(p)
    }
  }
  return out[0] || null
}

function wmiSpawn(commandLine) {
  const psScript = [
    '$c = $env:WB_PET_CMD;',
    '$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine=$c};',
    'if ($r.ReturnValue -ne 0) { exit 1 }',
    '$r.ProcessId',
  ].join(' ')
  const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', psScript], {
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, WB_PET_CMD: commandLine },
    timeout: 30000,
  })
  return Number(String(out).trim()) || 0
}

const root = findPluginRoot()
if (!root) {
  console.error('找不到 fatfish-pet 插件（預期在 ~/.workbuddy/plugins/marketplaces/*/plugins/fatfish-pet）')
  process.exit(1)
}
console.log('插件根: ' + root)

const starter = join(root, 'scripts', 'wb-pet-start.mjs')
try {
  execFileSync(process.execPath, [starter], { stdio: 'inherit', cwd: root, timeout: 60000 })
} catch (e) {
  console.error('啟動主機失敗: ' + (e instanceof Error ? e.message : String(e)))
}

if (!process.argv.includes('--no-guard') && existsSync(GUARD)) {
  // 直接起 node，不包 cmd（避免常駐黑視窗）
  const cmd = '"' + process.execPath.replace(/"/g, '""') + '" "' + GUARD.replace(/"/g, '""') + '"'
  try {
    const pid = wmiSpawn(cmd)
    console.log('看門狗已啟動（WMI，父=WmiPrvSE）pid=' + pid)
  } catch (e) {
    console.error('看門狗啟動失敗: ' + (e instanceof Error ? e.message : String(e)))
  }
}
