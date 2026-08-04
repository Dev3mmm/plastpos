@echo off
title PlastPOS - do not close this window while using the app
cd /d "%~dp0backend"
start "" cmd /c "timeout /t 2 >nul && start http://localhost:4000"
node server.js
pause
