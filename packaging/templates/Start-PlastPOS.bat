@echo off
title PlastPOS - do not close this window while using the app
cd /d "%~dp0app\backend"
start "" cmd /c "timeout /t 2 >nul && start http://localhost:4000"
"%~dp0node\node.exe" server.js
pause
