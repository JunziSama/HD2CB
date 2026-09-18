$ErrorActionPreference = 'Stop'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { throw '.NET Framework 4 的 C# 编译器未安装。' }
$outputFile = Join-Path $PSScriptRoot 'FocusMonitor.exe'
$sourceFile = Join-Path $PSScriptRoot 'FocusMonitor.cs'
& $compiler /nologo /target:exe /platform:x64 /optimize+ /r:System.Web.Extensions.dll "/out:$outputFile" $sourceFile
if ($LASTEXITCODE -ne 0) { throw 'FocusMonitor 编译失败。' }
