@echo off
title DECAN XMD - Install
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js 20.6 or newer is required. Install from https://nodejs.org/ & pause & exit /b 1)
where npm >nul 2>nul || (echo npm was not found. Reinstall Node.js and ensure it is on PATH. & pause & exit /b 1)
node --version
node -e "process.exit(Number(process.versions.node.split('.')[0]) > 20 || (Number(process.versions.node.split('.')[0]) === 20 && Number(process.versions.node.split('.')[1]) >= 6) ? 0 : 1)"
if errorlevel 1 (echo Node.js 20.6 or newer is required to load the local .env file. & pause & exit /b 1)
npm install
if errorlevel 1 (echo Installation failed. Check internet and Node.js version. & pause & exit /b 1)
if not exist data mkdir data
echo Installation complete. Run START.bat.
pause
