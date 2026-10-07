@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "WENXIANG_NODE=node"
where node >nul 2>nul
if errorlevel 1 (
  set "WENXIANG_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
)
"%WENXIANG_NODE%" --version
if errorlevel 1 (
  echo 请先安装 Node.js 24，然后重新打开本文件。
  pause
  exit /b 1
)
echo 启动后请保留此窗口，按窗口显示的局域网地址在手机上访问。
"%WENXIANG_NODE%" server\index.js
pause
