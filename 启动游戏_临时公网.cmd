@echo off
setlocal
cd /d "%~dp0"

set "NODE_EXE=node"
set "NPM_EXE=npm"
set "PNPM_EXE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\pnpm.cmd"
set "CODEX_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

where node >nul 2>nul
if errorlevel 1 (
  if exist "%CODEX_NODE%" (
    set "NODE_EXE=%CODEX_NODE%"
    set "NPM_EXE="
  ) else (
    echo Node.js was not found.
    echo Please install Node.js 18 or newer from https://nodejs.org/
    pause
    exit /b 1
  )
)

if not exist node_modules (
  echo Installing dependencies, please wait...
  if defined NPM_EXE (
    npm install
  ) else (
    if exist "%PNPM_EXE%" (
      call "%PNPM_EXE%" install
    ) else (
      echo npm was not found, and bundled pnpm was not found.
      pause
      exit /b 1
    )
  )
  if errorlevel 1 (
    echo Dependency install failed.
    pause
    exit /b 1
  )
)

set "CLOUDFLARED=cloudflared"
if exist "%~dp0cloudflared.exe" set "CLOUDFLARED=%~dp0cloudflared.exe"

where "%CLOUDFLARED%" >nul 2>nul
if errorlevel 1 (
  echo cloudflared was not found.
  echo.
  echo Please download cloudflared.exe and put it in this folder:
  echo %~dp0
  echo.
  echo Download page:
  echo https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
  echo.
  pause
  exit /b 1
)

echo Starting local game server...
start "Direction Memory Local Server" cmd /k ""%NODE_EXE%" server.js"

echo.
echo Starting public temporary link...
echo Wait for a URL like: https://xxxx.trycloudflare.com
echo Open that URL in WeChat or send it to friends.
echo Keep BOTH black windows open while playing.
echo.
"%CLOUDFLARED%" tunnel --url http://localhost:3000
pause
