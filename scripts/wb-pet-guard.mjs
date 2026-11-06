#!/usr/bin/env node
/**
 * 大肥魚桌寵 · 看門狗
 *
 * 每 30 秒探一次主機 /health；連續 3 次探不到就重啟她。
 * 自己本身也必須脫離 WorkBuddy 的行程樹（否則主機被連坐殺時，看門狗也一起死，
 * 没人拉她起來）。所以看門狗自己也是用 WMI 建立的。
 *
 * 用法：node wb-pet-guard.mjs [--once]
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

// ⚠️ 不能用 new URL(import.meta.url).pathname：路徑含中文時會被 URL 編碼，
// existsSync 會判成不存在。fileURLToPath 會正確解碼。
const HERE = dirname(fileURLToPath(import.meta.url))
const GUARD_LOG = join(HERE, 'guard.log')
const RUNTIME = join(process.env.LOCALAPPDATA || '', 'workbuddy-whale', 'pet-host', 'pet-host-runtime.json')
const INTERVAL_MS = 30000
const MAX_MISS = 3

function log(msg) {
  const line = `${new Date().toISOString()} ${msg}\n`
  try {
    mkdirSync(HERE, { recursive: true })
    writeFileSync(GUARD_LOG, line, { flag: 'a' })
  } catch { /* ignore */ }
  try { process.stdout.write(line) } catch { /* ignore */ }
}

function runtimePort() {
  try {
    if (!existsSync(RUNTIME)) return 3080
    const j = JSON.parse(readFileSync(RUNTIME, 'utf8'))
    return Number(j.port) || 3080
  } catch { return 3080 }
}

async function alive() {
  const port = runtimePort()
  try {
    const ctrl = AbortSignal.timeout(4000)
    const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: ctrl })
    return r.ok
  } catch { return false }
}

/** 找插件根（源目錄優先——它才有 scripts/wb-pet-start.mjs） */
function findPluginRoot() {
  const home = process.env.USERPROFILE || ''
  const candidates = []
  const mp = join(home, '.workbuddy', 'plugins', 'marketplaces')
  if (existsSync(mp)) {
    for (const d of readdirSync(mp)) {
      const p = join(mp, d, 'plugins', 'fatfish-pet')
      if (existsSync(join(p, 'scripts', 'wb-pet-start.mjs'))) candidates.push(p)
    }
  }
  const cache = join(home, '.workbuddy', 'plugins', 'cache', 'fatfish-local', 'fatfish-pet')
  if (existsSync(cache)) {
    for (const v of readdirSync(cache)) {
      const p = join(cache, v)
      if (existsSync(join(p, 'scripts', 'wb-pet-start.mjs'))) candidates.push(p)
    }
  }
  return candidates[0] || null
}

/** 用 WMI 建立行程（父=WmiPrvSE → 不在任何使用者行程樹內） */
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

function restart() {
  const root = findPluginRoot()
  if (!root) { log('restart: 找不到插件根'); return }
  const starter = join(root, 'scripts', 'wb-pet-start.mjs')
  // 直接起 node，不包 cmd（避免常駐黑視窗）
  const cmd = '"' + process.execPath.replace(/"/g, '""') + '" "' + starter.replace(/"/g, '""') + '"'
  try {
    const pid = wmiSpawn(cmd)
    log(`restart: 已用 WMI 重新啟動主機 pid=${pid}`)
  } catch (e) {
    log('restart 失敗: ' + (e instanceof Error ? e.message : String(e)))
  }
}

if (process.argv.includes('--once')) {
  const ok = await alive()
  console.log(ok ? '主機存活' : '主機不在')
  process.exit(ok ? 0 : 1)
}

log('=== 看門狗啟動（每 ' + INTERVAL_MS / 1000 + ' 秒探一次）===')
let miss = 0
let first = true
setInterval(async () => {
  const ok = await alive()
  if (ok) {
    if (miss > 0) log(`恢復：主機回來了（先前連續失敗 ${miss} 次）`)
    miss = 0
    if (first) { first = false; log('主機在線，看門狗待命') }
    return
  }
  miss += 1
  log(`探不到主機（${miss}/${MAX_MISS}）`)
  if (miss >= MAX_MISS) {
    miss = 0
    restart()
  }
}, INTERVAL_MS)
