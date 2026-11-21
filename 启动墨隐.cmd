@echo off
cd /d "%~dp0"
"%~dp0runtime\node.exe" "%~dp0app.cjs"
if errorlevel 1 pause
