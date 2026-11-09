#!/usr/bin/env node
/**
 * 對齊檢查：寵物主機（pet-host/lib/paths.mjs）與 hook 端（scripts/wb-state-store.mjs）
 * 必須在任何環境變數組合下都算出**同一個**狀態目錄。
 *
 * 為什麼要這個檢查：兩邊只要算得不同，狀態檔就會各寫各的，
 * 症狀是「狀態檔明明存在，寵物卻完全不反應」——非常難查。
 * 這個檢查把「口徑一致」變成一條可自動驗證的規則。
 *
 * 用法：node pet-host/check-alignment.mjs
 */

import { resolveStateDir } from './lib/paths.mjs';
import { resolveStateDir as hookResolveStateDir } from '../scripts/wb-state-store.mjs';

/** 要測的環境變數組合。 */
const CASES = [
  { name: '什麼都沒有', env: {} },
  { name: '只有 CODEBUDDY_PLUGIN_DATA（hook 有、主機沒有）', env: { CODEBUDDY_PLUGIN_DATA: 'C:\\fake\\plugin-data' } },
  { name: 'WORKBUDDY_WHALE_STATE_DIR 明確指定', env: { WORKBUDDY_WHALE_STATE_DIR: 'C:\\fake\\explicit' } },
  { name: '兩者都有', env: { WORKBUDDY_WHALE_STATE_DIR: 'C:\\fake\\explicit', CODEBUDDY_PLUGIN_DATA: 'C:\\fake\\plugin-data' } },
];

/** 原本的環境變數（測完要還原）。 */
const saved = { ...process.env };
let failed = 0;

for (const testCase of CASES) {
  // 還原成乾淨環境，再套上本案例的變數。
  for (const key of Object.keys(process.env)) delete process.env[key];
  for (const key of ['SystemRoot', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'SystemDrive', 'HOMEDRIVE', 'HOMEPATH']) {
    if (saved[key] !== undefined) process.env[key] = saved[key];
  }
  Object.assign(process.env, testCase.env);

  const hookDir = hookResolveStateDir(process.env);
  const host = await resolveStateDir();
  const ok = hookDir === host.dir;
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${testCase.name}`);
  console.log(`        hook → ${hookDir}`);
  console.log(`        host → ${host.dir}   (來源：${host.source})`);
}

Object.assign(process.env, saved);
console.log(failed === 0 ? '\n全部對齊。' : `\n有 ${failed} 個組合不對齊。`);
process.exit(failed === 0 ? 0 : 1);
