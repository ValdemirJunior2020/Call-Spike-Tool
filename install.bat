@echo off
cd /d %~dp0
where node >nul 2>nul
if %errorlevel% neq 0 (
  echo Node.js is not installed. Install Node.js 20 or newer first: https://nodejs.org/
  pause
  exit /b 1
)
if not exist .env copy .env.example .env
npm install
echo.
echo Install finished.
echo Next: open the .env file and add your Apps Script Web App URL.
echo Then run start.bat.
pause
