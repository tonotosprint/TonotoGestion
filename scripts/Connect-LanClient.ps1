$ErrorActionPreference = "Stop"

$serverAddress = (Read-Host "Ingresa la IPv4 de la PC servidor").Trim()
$parsedAddress = $null
if (-not [System.Net.IPAddress]::TryParse($serverAddress, [ref]$parsedAddress) -or
  $parsedAddress.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) {
  throw "Ingresa una IPv4 válida, por ejemplo 192.168.1.25."
}

$certificatePath = Join-Path $env:TEMP ("tonotos-lan-{0}.cer" -f [guid]::NewGuid().ToString("N"))
$httpRoot = "http://{0}:3000" -f $serverAddress
$httpsRoot = "https://{0}:3443" -f $serverAddress

try {
  Invoke-WebRequest -Uri "$httpRoot/tls-cert.cer" -OutFile $certificatePath -UseBasicParsing -TimeoutSec 10
  $certificate = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($certificatePath)
  $fingerprint = (Get-FileHash -LiteralPath $certificatePath -Algorithm SHA256).Hash
  $existingCertificate = Get-ChildItem Cert:\CurrentUser\Root |
    Where-Object { $_.Thumbprint -eq $certificate.Thumbprint } |
    Select-Object -First 1

  if (-not $existingCertificate) {
    Write-Host ""
    Write-Host "Verifica la huella con la que aparece en la consola de la PC servidor:" -ForegroundColor Yellow
    Write-Host $fingerprint -ForegroundColor Yellow
    $confirmation = Read-Host "Si coincide exactamente, escribe SI para confiar en el certificado"
    if ($confirmation -cne "SI") {
      throw "No se instaló el certificado. Compara la huella y vuelve a intentarlo."
    }
    Import-Certificate -FilePath $certificatePath -CertStoreLocation Cert:\CurrentUser\Root | Out-Null
    Write-Host "Certificado de confianza instalado para tu usuario de Windows."
  }

  $response = Invoke-WebRequest -Uri $httpsRoot -UseBasicParsing -TimeoutSec 10
  if ($response.StatusCode -ne 200) {
    throw "El servidor respondió con el estado HTTP $($response.StatusCode)."
  }
  Start-Process $httpsRoot
  Write-Host "Tonotos Gestión se abrió por HTTPS; el navegador ya puede usar el modo offline."
} catch {
  Write-Host ""
  Write-Host "No se pudo conectar a $httpsRoot." -ForegroundColor Red
  Write-Host "Comprueba que el servidor esté iniciado, que ambas PC estén en la misma red y que Windows permita los puertos TCP 3000 y 3443."
  Write-Host $_.Exception.Message -ForegroundColor Red
  exit 1
} finally {
  if (Test-Path -LiteralPath $certificatePath) {
    Remove-Item -LiteralPath $certificatePath -Force
  }
}
