@echo off
setlocal

cd /d "%~dp0"

echo Starting STELA Photo Production V1...
echo.
echo Backend  : http://localhost:3001
echo Frontend : http://localhost:5174
echo.

start "STELA Backend API" cmd /k "cd /d %~dp0backend && npm start"
start "STELA Frontend" cmd /k "cd /d %~dp0frontend && npm run dev -- --host 127.0.0.1 --port 5174"

echo Two terminal windows were opened.
echo Open http://localhost:5174 in the browser.
pause
