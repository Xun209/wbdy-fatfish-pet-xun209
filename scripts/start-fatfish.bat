@echo off
chcp 65001 >nul
title 大肥魚桌寵啟動器

REM 這個 .bat 是「固定路徑」的入口 —— 請把它的捷徑放進 Win+R -> shell:startup
REM 放進啟動資料夾後，它由 Explorer 啟動，不在 WorkBuddy 的行程樹內，也不受 taskkill /T 影響。
REM 實際啟動邏輯在同目錄的 start-fatfish.mjs（會動態解析最新的插件版本）。

set "LAUNCHER=%LOCALAPPDATA%\workbuddy-whale\launcher"
set "NODE=D:\node.js\node.exe"
if not exist "%NODE%" set "NODE=node"

if not exist "%LAUNCHER%\start-fatfish.mjs" (
  echo [錯誤] 找不到啟動器：%LAUNCHER%\start-fatfish.mjs
  pause
  exit /b 1
)

"%NODE%" "%LAUNCHER%\start-fatfish.mjs"
exit /b 0
