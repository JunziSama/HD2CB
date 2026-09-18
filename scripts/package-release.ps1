param([string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -LiteralPath (Join-Path $projectRoot 'app/package.json') -Raw | ConvertFrom-Json
$sourceDirectory = Join-Path $projectRoot "Releases/HD2CB-v$($manifest.version)-win32-x64"
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $projectRoot 'Releases' }
$OutputDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$zipName = "HD2CB-v$($manifest.version)-win32-x64.zip"
$zipPath = Join-Path $OutputDirectory $zipName
if (Test-Path -LiteralPath $zipPath) { throw "Archive already exists; choose another output directory: $zipPath" }
foreach ($required in @('ChargeBar.exe', 'resources/electron.asar', 'resources/app/native/FocusMonitor.exe', 'resources/app/node_modules/iohook/index.js')) {
    if (-not (Test-Path -LiteralPath (Join-Path $sourceDirectory $required))) { throw "Missing runtime file: $required" }
}
$privateFiles = Get-ChildItem -LiteralPath $sourceDirectory -File -Recurse -Force | Where-Object {
    $_.Name -match '^(settings\.json|\.env.*|\.npmrc|.*\.log|.*\.pem|.*\.key)$' -or
    $_.FullName -match '[\\/](\.git|\.qa|userData)[\\/]'
}
if ($privateFiles) { throw 'Runtime folder contains local configuration, logs or private files; inspect before packaging.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($sourceDirectory, $zipPath, [System.IO.Compression.CompressionLevel]::Optimal, $true)
$hash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
[System.IO.File]::WriteAllText((Join-Path $OutputDirectory 'SHA256SUMS.txt'), "$hash  $zipName`n", (New-Object System.Text.UTF8Encoding $false))
Write-Output "Archive: $zipPath"
Write-Output "SHA256: $hash"