@echo off
setlocal EnableExtensions
cd /d "%~dp0"
chcp 65001 >nul
title uBobs Auto Next

echo ============================================================
echo  uBobs Auto Next
echo ============================================================
echo.

where node.exe >nul 2>&1
if errorlevel 1 goto :NO_NODE

where npm.cmd >nul 2>&1
if errorlevel 1 goto :NO_NPM

if exist "node_modules\playwright-core\package.json" goto :RUN_APP

echo [SETUP] Installing required Node module. This runs only once.
call npm.cmd install --no-fund --no-audit
if errorlevel 1 goto :NPM_FAIL
echo.

:RUN_APP
echo [RUN] Starting Chrome automation...
echo [RUN] Close the automation Chrome window or press Ctrl+C to stop.
echo.
node.exe app.js
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if not "%EXIT_CODE%"=="0" echo [EXIT] app.js returned error code %EXIT_CODE%.
if "%EXIT_CODE%"=="0" echo [EXIT] Automation stopped normally.
echo.
pause
exit /b %EXIT_CODE%

:NO_NODE
echo [ERROR] Node.js was not found.
echo Install Node.js LTS, then run start.bat again.
echo.
pause
exit /b 1

:NO_NPM
echo [ERROR] npm.cmd was not found.
echo Reinstall Node.js LTS with npm, then run start.bat again.
echo.
pause
exit /b 1

:NPM_FAIL
echo.
echo [ERROR] npm install failed.
echo Check the messages above and try start.bat again.
echo.
pause
exit /b 1
