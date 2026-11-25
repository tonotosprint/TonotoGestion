@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo No se encontro Node.js. Instala Node.js y vuelve a ejecutar este archivo.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo No se encontro npm. Reinstala Node.js y vuelve a ejecutar este archivo.
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Update-Tonotos.ps1"
if errorlevel 1 (
  echo No se pudo aplicar la actualizacion de GitHub. Se iniciara la version local.
)

if not exist "node_modules\firebase-admin" (
  echo Preparando Tonotos Gestion por primera vez. Esto requiere conexion a Internet...
  call npm install --no-package-lock
  if errorlevel 1 (
    echo No se pudieron instalar las dependencias. Revisa la conexion a Internet e intenta de nuevo.
    pause
    exit /b 1
  )
)

if not exist ".env" (
  if not exist ".env.example" (
    echo No se encontro la plantilla .env.example.
    pause
    exit /b 1
  )
  copy /Y ".env.example" ".env" >nul
  echo Se creo el archivo local .env para guardar la configuracion permanente.
  echo Completa PLATFORM_ADMIN_EMAIL y PLATFORM_ADMIN_PASSWORD en el Bloc de notas.
  echo Tambien puedes configurar GOOGLE_APPLICATION_CREDENTIALS para sincronizar con Firebase.
  notepad "%~dp0.env"
)

start "Tonotos Gestion - Servidor" /D "%~dp0" cmd /k "npm start"

echo Esperando a que Tonotos Gestion este disponible...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$url = 'http://127.0.0.1:3000'; $secureUrl = $null; if (Test-Path '.env') { $hostLine = Get-Content '.env' | Where-Object { $_ -match '^\s*HTTPS_HOST\s*=' } | Select-Object -First 1; if ($hostLine) { $secureHost = ($hostLine -replace '^\s*HTTPS_HOST\s*=\s*', '').Trim(); $portLine = Get-Content '.env' | Where-Object { $_ -match '^\s*HTTPS_PORT\s*=' } | Select-Object -First 1; $securePort = if ($portLine) { ($portLine -replace '^\s*HTTPS_PORT\s*=\s*', '').Trim() } else { '3443' }; if ($secureHost) { $secureUrl = 'https://{0}:{1}' -f $secureHost, $securePort } } }; $until = (Get-Date).AddSeconds(30); do { foreach ($candidate in @($secureUrl, $url)) { if (-not $candidate) { continue }; try { $response = Invoke-WebRequest -Uri $candidate -UseBasicParsing -TimeoutSec 2; if ($response.StatusCode -eq 200) { Start-Process $candidate; exit 0 } } catch { } }; Start-Sleep -Seconds 1 } while ((Get-Date) -lt $until); exit 1"
if errorlevel 1 (
  echo No se pudo iniciar el sistema en HTTP o HTTPS.
  echo Revisa la ventana del servidor para ver el detalle del error.
  pause
  exit /b 1
)

echo Tonotos Gestion se abrio en el navegador predeterminado.
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$addresses = Get-NetIPAddress -AddressFamily IPv4 -AddressState Preferred -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' }; if ($addresses) { Write-Host 'IPv4 de esta PC para conectar clientes por HTTPS:'; $addresses | ForEach-Object { Write-Host ('  {0}' -f $_.IPAddress) }; Write-Host 'En las otras PC ejecuta Conectar Tonotos Gestion.bat e ingresa la IPv4.' }"
endlocal
