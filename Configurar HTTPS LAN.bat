@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Configure-LanHttps.ps1"
if errorlevel 1 (
  echo.
  echo No se pudo configurar HTTPS. Revisa el mensaje anterior.
)
pause
endlocal
