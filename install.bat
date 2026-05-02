@echo off
cd /d "%~dp0"
call npm.cmd install
if errorlevel 1 pause
