@echo off
title DECAN XMD - Local
cd /d "%~dp0"
where node >nul 2>nul || (echo Install Node.js 20.6 or newer first. & pause & exit /b 1)
node -e "process.exit(Number(process.versions.node.split('.')[0]) > 20 || (Number(process.versions.node.split('.')[0]) === 20 && Number(process.versions.node.split('.')[1]) >= 6) ? 0 : 1)"
if errorlevel 1 (echo Node.js 20.6 or newer is required to load the local .env file. & pause & exit /b 1)
if not exist node_modules (echo Dependencies missing. Run INSTALL.bat first. & pause & exit /b 1)
if not exist data mkdir data
set HOST=127.0.0.1
set DATA_DIR=%CD%\data
set PORT=3000
:loop
npm start
echo.
echo DECAN XMD exited (code %errorlevel%). Restarting in 2 seconds...
echo Press CTRL+C now to stop instead of restarting.
timeout /t 2 >nul
goto loop
