param([string]$ServerAddress)

$ErrorActionPreference = "Stop"

$projectDirectory = Split-Path -Parent $PSScriptRoot
$availableAddresses = @(
  Get-NetIPAddress -AddressFamily IPv4 -AddressState Preferred |
    Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } |
    Select-Object -ExpandProperty IPAddress -Unique
)

if ($availableAddresses.Count -eq 0) {
  throw "No se encontró una dirección IPv4 de red para emitir el certificado HTTPS."
}

$defaultAddress = $availableAddresses[0]
if ([string]::IsNullOrWhiteSpace($ServerAddress)) {
  Write-Host "Direcciones IPv4 disponibles en esta PC:"
  for ($index = 0; $index -lt $availableAddresses.Count; $index += 1) {
    Write-Host ("  {0}. {1}" -f ($index + 1), $availableAddresses[$index])
  }
  $selectedAddress = Read-Host "Ingresa el número o la IPv4 que usarán las otras PC (Enter para $defaultAddress)"
  if ([string]::IsNullOrWhiteSpace($selectedAddress)) {
    $serverAddress = $defaultAddress
  } elseif ($selectedAddress -match "^\d+$" -and [int]$selectedAddress -ge 1 -and
    [int]$selectedAddress -le $availableAddresses.Count) {
    $serverAddress = $availableAddresses[[int]$selectedAddress - 1]
  } else {
    $parsedAddress = $null
    if (-not [System.Net.IPAddress]::TryParse($selectedAddress, [ref]$parsedAddress) -or
      $parsedAddress.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork -or
      $selectedAddress -notin $availableAddresses) {
      throw "Selecciona una de las IPv4 disponibles en esta PC."
    }
    $serverAddress = $selectedAddress
  }
} else {
  $parsedAddress = $null
  if (-not [System.Net.IPAddress]::TryParse($ServerAddress, [ref]$parsedAddress) -or
    $parsedAddress.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork -or
    $ServerAddress -notin $availableAddresses) {
    throw "Selecciona una de las IPv4 disponibles en esta PC."
  }
  $serverAddress = $ServerAddress
}

$tlsDirectory = Join-Path $projectDirectory "data\tls"
$certificatePath = Join-Path $tlsDirectory "server.cer"
$pfxPath = Join-Path $tlsDirectory "server.pfx"
$environmentPath = Join-Path $projectDirectory ".env"
New-Item -ItemType Directory -Path $tlsDirectory -Force | Out-Null

foreach ($store in @("Cert:\CurrentUser\My", "Cert:\CurrentUser\Root")) {
  Get-ChildItem $store |
    Where-Object { $_.FriendlyName -eq "Tonotos Gestion LAN HTTPS" } |
    Remove-Item -Force
}

$secureRandom = New-Object byte[] 32
$randomGenerator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try {
  $randomGenerator.GetBytes($secureRandom)
} finally {
  $randomGenerator.Dispose()
}
$pfxPassphrase = [BitConverter]::ToString($secureRandom).Replace("-", "")
$pfxPassword = ConvertTo-SecureString -String $pfxPassphrase -Force -AsPlainText

$certificate = New-SelfSignedCertificate `
  -Type SSLServerAuthentication `
  -Subject "CN=Tonotos Gestion LAN" `
  -FriendlyName "Tonotos Gestion LAN HTTPS" `
  -CertStoreLocation "Cert:\CurrentUser\My" `
  -KeyAlgorithm RSA `
  -KeyLength 2048 `
  -HashAlgorithm SHA256 `
  -KeyExportPolicy Exportable `
  -KeyUsage DigitalSignature, KeyEncipherment `
  -NotAfter (Get-Date).AddYears(3) `
  -TextExtension @("2.5.29.17={text}IPAddress=$serverAddress")

Export-Certificate -Cert $certificate -FilePath $certificatePath -Force | Out-Null
Export-PfxCertificate -Cert $certificate -FilePath $pfxPath -Password $pfxPassword -Force | Out-Null
Import-Certificate -FilePath $certificatePath -CertStoreLocation "Cert:\CurrentUser\Root" | Out-Null

$environment = [System.Collections.Generic.List[string]]::new()
if (Test-Path -LiteralPath $environmentPath) {
  foreach ($line in [System.IO.File]::ReadAllLines($environmentPath)) {
    $environment.Add($line)
  }
}

$settings = [ordered]@{
  HTTPS_PORT = "3443"
  HTTPS_PFX_PATH = "data/tls/server.pfx"
  HTTPS_CERT_PATH = "data/tls/server.cer"
  HTTPS_PFX_PASSPHRASE = $pfxPassphrase
  HTTPS_HOST = $serverAddress
}

foreach ($setting in $settings.GetEnumerator()) {
  $pattern = "^\s*" + [regex]::Escape($setting.Key) + "\s*=.*$"
  $existingIndex = -1
  for ($index = 0; $index -lt $environment.Count; $index += 1) {
    if ($environment[$index] -match $pattern) {
      $existingIndex = $index
      break
    }
  }
  $settingLine = "{0}={1}" -f $setting.Key, $setting.Value
  if ($existingIndex -ge 0) {
    $environment[$existingIndex] = $settingLine
  } else {
    $environment.Add($settingLine)
  }
}

$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllLines($environmentPath, $environment, $utf8WithoutBom)

$fingerprint = (Get-FileHash -LiteralPath $certificatePath -Algorithm SHA256).Hash
Write-Host ""
Write-Host "HTTPS LAN quedó configurado." -ForegroundColor Green
Write-Host "Dirección del servidor: https://$serverAddress`:3443"
Write-Host "Huella SHA-256 del certificado: $fingerprint"
Write-Host "Guarda esta huella: cada PC cliente deberá compararla antes de confiar en el certificado."
Write-Host "Ahora vuelve a iniciar Tonotos Gestión con Iniciar Tonotos Gestion.bat."
Write-Host "Si Windows bloquea la conexión, permite el puerto TCP 3443 en redes privadas."
