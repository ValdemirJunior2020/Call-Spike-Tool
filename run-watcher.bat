@echo off
cd /d "C:\Users\Valdemir Goncalves\Downloads\call-queue-spike-monitor\call-queue-spike-monitor"

if not exist "data" mkdir "data"

echo ======================================== >> "data\watcher-startup-log.txt"
echo Started at %date% %time% >> "data\watcher-startup-log.txt"

echo Starting server/watcher... >> "data\watcher-startup-log.txt"
start "Call Queue Server" cmd /k "cd /d C:\Users\Valdemir Goncalves\Downloads\call-queue-spike-monitor\call-queue-spike-monitor\server && node src/index.js"

timeout /t 10 /nobreak > nul

echo Starting React dashboard... >> "data\watcher-startup-log.txt"
start "Call Queue Dashboard" cmd /k "cd /d C:\Users\Valdemir Goncalves\Downloads\call-queue-spike-monitor\call-queue-spike-monitor\client && npm run dev"

timeout /t 10 /nobreak > nul

echo Opening dashboard... >> "data\watcher-startup-log.txt"
start http://127.0.0.1:5173