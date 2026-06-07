@echo off
setlocal
pushd "%~dp0" >nul
node "scripts\generate-levels.js" %*
set "exit_code=%ERRORLEVEL%"
popd >nul
exit /b %exit_code%
