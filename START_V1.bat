@echo off
setlocal

cd /d "%~dp0"

echo Starting STELA Photo Production V1...
echo.
echo Backend  : http://localhost:3001
echo PWA      : http://localhost:5174
echo.

start "STELA Backend API" cmd /k "cd /d %~dp0backend && npm start"
start "STELA Frontend" cmd /k "cd /d %~dp0frontend && npm run dev -- --host 127.0.0.1 --port 5174"

echo Two terminal windows were opened.
echo Opening STELA PWA window...
timeout /t 5 /nobreak >nul

set "APP_URL=http://localhost:5174"
set "CHROME_EXE=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
set "CHROME_EXE_X86=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
set "EDGE_EXE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
set "EDGE_EXE_64=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"

if exist "%CHROME_EXE%" (
  start "STELA PWA" "%CHROME_EXE%" --app=%APP_URL%
) else if exist "%CHROME_EXE_X86%" (
  start "STELA PWA" "%CHROME_EXE_X86%" --app=%APP_URL%
) else if exist "%EDGE_EXE%" (
  start "STELA PWA" "%EDGE_EXE%" --app=%APP_URL%
) else if exist "%EDGE_EXE_64%" (
  start "STELA PWA" "%EDGE_EXE_64%" --app=%APP_URL%
) else (
  start "" %APP_URL%
)

echo If the PWA window is blank, wait until Vite finishes then refresh.
pause
