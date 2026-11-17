@echo off
setlocal
cd /d "%~dp0"
echo Checking Ippo to Read 0.3.2 without opening your library...
call npm.cmd test
if errorlevel 1 goto failed
call npm.cmd run typecheck
if errorlevel 1 goto failed
call npm.cmd run test:native
if errorlevel 1 goto failed
call npm.cmd run check:native
if errorlevel 1 goto failed
echo.
echo Checks passed on this machine. Back up your app-data before launching the update.
echo To launch: npm.cmd run desktop
pause
exit /b 0
:failed
echo.
echo A check failed. The app was not launched and your real library was not opened.
echo Keep this window open and copy the error above.
pause
exit /b 1
