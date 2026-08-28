@echo off
setlocal

cd /d "%~dp0"

echo Starting STELA Photo Production V1...
echo.
echo Backend + PWA : http://localhost:3001
echo.

echo Building frontend PWA...
call npm --prefix "%~dp0frontend" run build
if errorlevel 1 (
  echo.
  echo Frontend build failed. Please check the error above.
  pause
  exit /b 1
)

start "STELA Backend + PWA" cmd /k "cd /d %~dp0backend && npm start"

echo Backend terminal was opened.
echo Opening STELA PWA window...
timeout /t 5 /nobreak >nul

set "APP_URL=http://localhost:3001"
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

echo If the PWA window is blank, wait until backend finishes starting then refresh.
pause
