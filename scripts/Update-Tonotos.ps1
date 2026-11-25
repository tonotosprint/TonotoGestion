param([switch]$Worker)

$ErrorActionPreference = "Stop"

$repository = "tonotosprint/TonotoGestion"
$rootDirectory = Split-Path -Parent $PSScriptRoot
$releaseMarker = Join-Path $rootDirectory ".tonotos-release"
$statusPath = Join-Path $rootDirectory ".tonotos-update-status.json"
$releaseInfoPath = Join-Path $rootDirectory ".tonotos-release-info.json"
$temporaryDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("tonotos-update-" + [guid]::NewGuid().ToString("N"))
$apiUrl = "https://api.github.com/repos/$repository/releases/latest"
$headers = @{
  Accept = "application/vnd.github+json"
  "X-GitHub-Api-Version" = "2022-11-28"
  "User-Agent" = "Tonotos-Gestion-Updater"
}

if (-not $Worker) {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  [System.Windows.Forms.Application]::EnableVisualStyles()
  Remove-Item -LiteralPath $statusPath -Force -ErrorAction SilentlyContinue

  $form = New-Object System.Windows.Forms.Form
  $form.Text = "Tonotos Gestión · Actualización"
  $form.StartPosition = "CenterScreen"
  $form.Size = New-Object System.Drawing.Size(560, 285)
  $form.MinimumSize = $form.Size
  $form.MaximumSize = $form.Size
  $form.FormBorderStyle = "FixedDialog"
  $form.MaximizeBox = $false
  $form.MinimizeBox = $false
  $form.ControlBox = $false
  $form.BackColor = [System.Drawing.Color]::FromArgb(247, 248, 252)
  $form.Font = New-Object System.Drawing.Font("Segoe UI", 10)

  $title = New-Object System.Windows.Forms.Label
  $title.Text = "Actualizando Tonotos Gestión"
  $title.Font = New-Object System.Drawing.Font("Segoe UI", 18, [System.Drawing.FontStyle]::Bold)
  $title.ForeColor = [System.Drawing.Color]::FromArgb(29, 39, 84)
  $title.Location = New-Object System.Drawing.Point(30, 25)
  $title.Size = New-Object System.Drawing.Size(480, 36)
  $form.Controls.Add($title)

  $statusLabel = New-Object System.Windows.Forms.Label
  $statusLabel.Text = "Buscando una nueva versión en GitHub..."
  $statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(85, 93, 115)
  $statusLabel.Location = New-Object System.Drawing.Point(32, 83)
  $statusLabel.Size = New-Object System.Drawing.Size(480, 42)
  $form.Controls.Add($statusLabel)

  $progressBar = New-Object System.Windows.Forms.ProgressBar
  $progressBar.Location = New-Object System.Drawing.Point(32, 139)
  $progressBar.Size = New-Object System.Drawing.Size(480, 19)
  $progressBar.Style = "Marquee"
  $progressBar.MarqueeAnimationSpeed = 25
  $form.Controls.Add($progressBar)

  $closeButton = New-Object System.Windows.Forms.Button
  $closeButton.Text = "Continuar"
  $closeButton.Location = New-Object System.Drawing.Point(402, 191)
  $closeButton.Size = New-Object System.Drawing.Size(110, 36)
  $closeButton.Enabled = $false
  $closeButton.Add_Click({ $form.Close() })
  $form.Controls.Add($closeButton)
  $autoCloseTimer = New-Object System.Windows.Forms.Timer
  $autoCloseTimer.Add_Tick({
    $autoCloseTimer.Stop()
    $form.Close()
  })

  $workerPath = $PSCommandPath.Replace('"', '\"')
  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = New-Object System.Diagnostics.ProcessStartInfo
  $process.StartInfo.FileName = "powershell.exe"
  $process.StartInfo.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$workerPath`" -Worker"
  $process.StartInfo.UseShellExecute = $false
  $process.StartInfo.CreateNoWindow = $true
  if (-not $process.Start()) {
    throw "No se pudo iniciar el proceso de actualización."
  }

  $timer = New-Object System.Windows.Forms.Timer
  $timer.Interval = 400
  $timer.Add_Tick({
    if (Test-Path -LiteralPath $statusPath) {
      try {
        $status = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json
        $statusLabel.Text = [string]$status.message
        if ($status.percent -ge 0 -and $status.state -eq "running") {
          $progressBar.Style = "Continuous"
          $progressBar.Value = [Math]::Max(0, [Math]::Min(100, [int]$status.percent))
        }
      } catch {
        $statusLabel.Text = "Preparando la actualización..."
      }
    }

    $process.Refresh()
    if (-not $process.HasExited) { return }
    $timer.Stop()
    $progressBar.Style = "Continuous"
    $progressBar.Value = 100
    $closeButton.Enabled = $true
    if (Test-Path -LiteralPath $statusPath) {
      try {
        $status = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json
        $statusLabel.Text = [string]$status.message
        if ($status.state -eq "error") {
          $title.Text = "No se pudo actualizar"
          $title.ForeColor = [System.Drawing.Color]::FromArgb(174, 56, 70)
          $progressBar.Value = 0
        } elseif ($status.state -eq "no_update") {
          $title.Text = "Tonotos Gestión está al día"
          $progressBar.Value = 100
        } else {
          $title.Text = "Actualización completada"
          $title.ForeColor = [System.Drawing.Color]::FromArgb(23, 119, 78)
        }
      } catch {
        $title.Text = "Actualización finalizada"
        $statusLabel.Text = "El servidor continuará con los archivos locales."
      }
    } else {
      $title.Text = "Actualización finalizada"
      $statusLabel.Text = "El servidor continuará con los archivos locales."
    }

    if ($process.ExitCode -eq 0) {
      $autoCloseTimer.Interval = if ($status.state -eq "no_update") { 1100 } else { 3500 }
      $autoCloseTimer.Start()
    }
  })
  $timer.Start()
  [void]$form.ShowDialog()
  $process.Refresh()
  $exitCode = if ($process.HasExited) { $process.ExitCode } else { 1 }
  Remove-Item -LiteralPath $statusPath -Force -ErrorAction SilentlyContinue
  exit $exitCode
}

function Set-UpdateStatus([string]$State, [string]$Message, [int]$Percent = -1) {
  $status = [ordered]@{
    state = $State
    message = $Message
    percent = $Percent
    updatedAt = [DateTime]::UtcNow.ToString("o")
  }
  $temporaryStatusPath = "$statusPath.tmp"
  $status | ConvertTo-Json -Compress | Set-Content -LiteralPath $temporaryStatusPath -Encoding UTF8
  Move-Item -LiteralPath $temporaryStatusPath -Destination $statusPath -Force
}

try {
  Set-UpdateStatus "running" "Buscando una nueva versión en GitHub..." 5
  try {
    $release = Invoke-RestMethod -Uri $apiUrl -Headers $headers -TimeoutSec 20
  } catch {
    $statusCode = 0
    if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
      $statusCode = [int]$_.Exception.Response.StatusCode
    }
    if ($statusCode -eq 404) {
      Write-Host "GitHub todavía no tiene una versión estable publicada. Se iniciará la instalación actual."
      Set-UpdateStatus "no_update" "No hay versiones publicadas en GitHub. Se iniciará la instalación actual." 100
      exit 0
    }
    throw "No se pudo consultar la última versión de GitHub: $($_.Exception.Message)"
  }

  $tag = [string]$release.tag_name
  if ($tag -notmatch '^v\d+\.\d+\.\d+$') {
    throw "La versión publicada tiene una etiqueta no válida: $tag"
  }
  $installedTag = ""
  if (Test-Path -LiteralPath $releaseMarker) {
    $installedTag = (Get-Content -LiteralPath $releaseMarker -Raw).Trim()
  }
  if ($installedTag -eq $tag) {
    Write-Host "Tonotos Gestión ya está actualizado ($tag)."
    Set-UpdateStatus "no_update" "Tonotos Gestión ya está actualizado ($tag)." 100
    exit 0
  }
  if ($installedTag -match '^v\d+\.\d+\.\d+$') {
    $installedVersion = [version]::Parse($installedTag.Substring(1))
    $releaseVersion = [version]::Parse($tag.Substring(1))
    if ($installedVersion -ge $releaseVersion) {
      Write-Host "La versión instalada ($installedTag) es igual o más reciente que la publicada ($tag)."
      Set-UpdateStatus "no_update" "La versión instalada ($installedTag) ya está al día." 100
      exit 0
    }
  }

  $asset = @($release.assets | Where-Object { $_.name -eq "tonotos-gestion.zip" }) | Select-Object -First 1
  if (-not $asset -or $asset.digest -notmatch '^sha256:[a-f0-9]{64}$') {
    throw "La versión $tag no incluye el paquete ZIP esperado con su huella SHA-256."
  }

  Set-UpdateStatus "running" "Reuniendo las notas y los commits de la versión $tag..." 12
  $releaseNotes = ([string]$release.body).Trim()
  $commits = @()
  $previousTag = ""
  $commitLookupMessage = ""
  try {
    $releases = @(Invoke-RestMethod -Uri "https://api.github.com/repos/$repository/releases?per_page=100" -Headers $headers -TimeoutSec 20)
    $currentReleaseIndex = -1
    for ($index = 0; $index -lt $releases.Count; $index += 1) {
      if ($releases[$index].tag_name -eq $tag) {
        $currentReleaseIndex = $index
        break
      }
    }
    if ($installedTag -match '^v\d+\.\d+\.\d+$' -and
      @($releases | Where-Object { $_.tag_name -eq $installedTag }).Count -gt 0) {
      $previousTag = $installedTag
    } elseif ($currentReleaseIndex -ge 0 -and $currentReleaseIndex + 1 -lt $releases.Count) {
      $previousTag = [string]$releases[$currentReleaseIndex + 1].tag_name
    }

    $commitUrl = if ($previousTag) {
      "https://api.github.com/repos/$repository/compare/$previousTag...$tag"
    } else {
      "https://api.github.com/repos/$repository/commits?sha=$tag&per_page=20"
    }
    $commitResponse = Invoke-RestMethod -Uri $commitUrl -Headers $headers -TimeoutSec 20
    $commitEntries = if ($previousTag) { @($commitResponse.commits) } else { @($commitResponse) }
    $commits = @($commitEntries | Select-Object -First 20 | ForEach-Object {
      $message = ([string]$_.commit.message -split "`r?`n")[0].Trim()
      if ($message.Length -gt 300) { $message = $message.Substring(0, 297) + "..." }
      [ordered]@{
        sha = ([string]$_.sha).Substring(0, [Math]::Min(7, ([string]$_.sha).Length))
        message = $message
        url = "https://github.com/$repository/commit/$($_.sha)"
      }
    })
  } catch {
    $commitLookupMessage = "No se pudo consultar la lista de commits; se muestran las notas publicadas de la versión."
    Write-Warning "$commitLookupMessage $($_.Exception.Message)"
  }

  Set-UpdateStatus "running" "Descargando la versión $tag..." 18
  New-Item -ItemType Directory -Path $temporaryDirectory | Out-Null
  $archivePath = Join-Path $temporaryDirectory "tonotos-gestion.zip"
  Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $archivePath -Headers @{ "User-Agent" = $headers["User-Agent"] } -TimeoutSec 120
  Set-UpdateStatus "running" "Verificando la integridad del paquete..." 35
  $downloadDigest = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($downloadDigest -ne $asset.digest.Substring(7).ToLowerInvariant()) {
    throw "La huella SHA-256 del paquete descargado no coincide con la publicada por GitHub."
  }

  Set-UpdateStatus "running" "Preparando los archivos de la actualización..." 48
  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $stageDirectory = Join-Path $temporaryDirectory "stage"
  $backupDirectory = Join-Path $temporaryDirectory "backup"
  New-Item -ItemType Directory -Path $stageDirectory, $backupDirectory | Out-Null
  $archive = [System.IO.Compression.ZipFile]::OpenRead($archivePath)
  try {
    foreach ($entry in $archive.Entries) {
      $relativePath = $entry.FullName.Replace("\", "/")
      if ([string]::IsNullOrWhiteSpace($relativePath) -or $relativePath.StartsWith("/") -or
        $relativePath -match '(^|/)\.\.?(/|$)' -or $relativePath.Contains(":")) {
        throw "El paquete contiene una ruta no permitida: $relativePath"
      }

      $parts = $relativePath.Split("/")
      $allowed = $parts[0] -in @("public", "scripts", "android") -or
        $relativePath -in @("server.js", "package.json", "package-lock.json", "README.md", ".env.example",
          "Iniciar Tonotos Gestion.bat", "Conectar Tonotos Gestion.bat", "Configurar HTTPS LAN.bat")
      if (-not $allowed -or $parts -contains "node_modules" -or $parts -contains "data" -or
        $parts -contains "build" -or $parts -contains ".gradle" -or
        $relativePath -match '(^|/)(ignore|local\.properties)(/|$)' -or
        $relativePath -match '\.hprof$') {
        throw "El paquete contiene un archivo no permitido: $relativePath"
      }

      if ($entry.Name -eq "") { continue }
      $destination = Join-Path $stageDirectory ($relativePath.Replace("/", [System.IO.Path]::DirectorySeparatorChar))
      $destinationDirectory = Split-Path -Parent $destination
      New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
      [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $destination, $true)
    }
  } finally {
    $archive.Dispose()
  }

  $updatedFiles = @()
  try {
    $files = Get-ChildItem -LiteralPath $stageDirectory -File -Recurse
    if ($files.Count -eq 0) { throw "El paquete de actualización está vacío." }
    Set-UpdateStatus "running" "Instalando los archivos de la versión $tag..." 65
    foreach ($file in $files) {
      $relativePath = $file.FullName.Substring($stageDirectory.Length).TrimStart("\")
      $destination = Join-Path $rootDirectory $relativePath
      $backup = Join-Path $backupDirectory $relativePath
      $destinationDirectory = Split-Path -Parent $destination
      New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
      if (Test-Path -LiteralPath $destination) {
        $backupDirectoryPath = Split-Path -Parent $backup
        New-Item -ItemType Directory -Path $backupDirectoryPath -Force | Out-Null
        Copy-Item -LiteralPath $destination -Destination $backup
      }
      $updatedFiles += $relativePath
      Copy-Item -LiteralPath $file.FullName -Destination $destination -Force
    }

    Set-UpdateStatus "running" "Instalando dependencias y finalizando..." 85
    Push-Location $rootDirectory
    try {
      & npm install --no-package-lock --no-audit --no-fund
      if ($LASTEXITCODE -ne 0) { throw "npm install terminó con código $LASTEXITCODE." }
    } finally {
      Pop-Location
    }

    Set-Content -LiteralPath $releaseMarker -Value $tag -NoNewline
    $releaseInfo = [ordered]@{
      tag = $tag
      name = [string]$release.name
      publishedAt = [string]$release.published_at
      htmlUrl = [string]$release.html_url
      releaseNotes = $releaseNotes
      previousTag = $previousTag
      commits = $commits
      commitLookupMessage = $commitLookupMessage
      installedAt = [DateTime]::UtcNow.ToString("o")
    }
    $releaseInfo | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath "$releaseInfoPath.tmp" -Encoding UTF8
    Move-Item -LiteralPath "$releaseInfoPath.tmp" -Destination $releaseInfoPath -Force
    Set-UpdateStatus "complete" "La versión $tag se instaló correctamente. El sistema ya puede iniciarse." 100
    Write-Host "Tonotos Gestión se actualizó a $tag."
  } catch {
    foreach ($relativePath in $updatedFiles) {
      $destination = Join-Path $rootDirectory $relativePath
      $backup = Join-Path $backupDirectory $relativePath
      if (Test-Path -LiteralPath $backup) {
        Copy-Item -LiteralPath $backup -Destination $destination -Force
      } elseif (Test-Path -LiteralPath $destination) {
        Remove-Item -LiteralPath $destination -Force
      }
    }
    throw
  }
} catch {
  Set-UpdateStatus "error" "La actualización no se completó: $($_.Exception.Message)"
  Write-Error "No se aplicó la actualización de Tonotos Gestión: $($_.Exception.Message)"
  exit 1
} finally {
  if (Test-Path -LiteralPath $temporaryDirectory) {
    Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force
  }
}
