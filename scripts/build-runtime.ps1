param()
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content (Join-Path $root 'app/package.json') -Raw | ConvertFrom-Json
$target = Join-Path $root "Releases/HD2CB-v$($manifest.version)-win32-x64"
if (Test-Path -LiteralPath $target) { throw "Version directory already exists: $target" }
$template = Join-Path $root '.runtime'
foreach ($file in @('ChargeBar.exe','resources/electron.asar')) {
 if (-not (Test-Path (Join-Path $template $file))) { throw "Missing runtime template: $file" }
}
New-Item -ItemType Directory -Path $target -Force | Out-Null
Copy-Item "$template/*" $target -Recurse
$appTarget = Join-Path $target 'resources/app'
New-Item -ItemType Directory $appTarget -Force | Out-Null
foreach ($name in @('src','native','node_modules','package.json','package-lock.json','README.md','VALIDATION.md')) {
 Copy-Item (Join-Path $root "app/$name") $appTarget -Recurse
}
foreach ($name in @('LICENSE','THIRD_PARTY_NOTICES.md')) {
 if (Test-Path (Join-Path $root $name)) { Copy-Item (Join-Path $root $name) $target }
}
Write-Output "Runtime: $target"
