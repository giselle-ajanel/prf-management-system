@echo off
REM Purchase Request Hub - double-click launcher for Windows.
setlocal
cd /d "%~dp0"

cls
echo ======================================================
echo   Purchase Request Hub
echo ======================================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo   Node.js is not installed on this PC.
  echo.
  echo   Install it from https://nodejs.org ^(choose the LTS
  echo   download^), then double-click this launcher again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo   First run - setting things up. This takes a minute.
  echo.
  call npm install --silent
  if errorlevel 1 (
    echo   Setup failed.
    pause
    exit /b 1
  )
)

echo   Starting up...
start "Purchase Request Hub server" /min cmd /c "npm run dev > .launcher.log 2>&1"

REM Give the server a moment, then open the browser.
timeout /t 8 /nobreak >nul
start http://localhost:3000

echo.
echo   Purchase Request Hub is running!
echo   Your browser should have opened automatically.
echo   If not, go to:  http://localhost:3000
echo.
echo   Sign-in details are in HOW_TO_OPEN.md
echo.
echo ------------------------------------------------------
echo   Close this window when finished.
echo ------------------------------------------------------
echo.
pause
