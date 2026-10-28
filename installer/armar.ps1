<#
  Arma el instalador de Claude Archivo: dist\Claude-Archivo-Setup-<version>.exe (y su .sha256).
  1. Baja el Node.js portátil oficial y verifica su SHA-256 contra la lista publicada por nodejs.org.
  2. Compila installer\claude-archivo.iss con Inno Setup 6.
  Uso:  powershell -ExecutionPolicy Bypass -File installer\armar.ps1 -Version 1.1.0
  Solo escribe en las carpetas build\ y dist\ del repo.
#>
param(
  [Parameter(Mandatory = $true)][string]$Version,
  [string]$NodeVersion = '24.21.0'
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$raiz = Split-Path $PSScriptRoot -Parent
$build = Join-Path $raiz 'build'
$nodeDir = Join-Path $build 'node'
New-Item -ItemType Directory -Force -Path $nodeDir | Out-Null

# 1. Node.js portátil, verificado
$nombreZip = "node-v$NodeVersion-win-x64.zip"
$base = "https://nodejs.org/dist/v$NodeVersion"
$zip = Join-Path $build $nombreZip
if (-not (Test-Path -LiteralPath $zip)) {
  Write-Host "Bajando $nombreZip..."
  Invoke-WebRequest -UseBasicParsing -Uri "$base/$nombreZip" -OutFile $zip
}
$sumas = (Invoke-WebRequest -UseBasicParsing -Uri "$base/SHASUMS256.txt").Content
if ($sumas -is [byte[]]) { $sumas = [Text.Encoding]::ASCII.GetString($sumas) }
$linea = ($sumas -split "`n") | Where-Object { $_ -match "\s$([regex]::Escape($nombreZip))\s*$" } | Select-Object -First 1
if (-not $linea) { throw "No encontré $nombreZip en SHASUMS256.txt" }
$esperado = ($linea -split '\s+')[0].Trim().ToLower()
$real = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLower()
if ($real -ne $esperado) { throw "El SHA-256 de $nombreZip no coincide con el publicado por nodejs.org" }
Write-Host "Node.js $NodeVersion verificado."

$extraido = Join-Path $build "node-v$NodeVersion-win-x64"
if (-not (Test-Path -LiteralPath $extraido)) { Expand-Archive -LiteralPath $zip -DestinationPath $build }
Copy-Item -LiteralPath (Join-Path $extraido 'node.exe') -Destination $nodeDir -Force
Copy-Item -LiteralPath (Join-Path $extraido 'LICENSE') -Destination $nodeDir -Force

# 2. Inno Setup
$candidatos = @(
  (Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6\ISCC.exe'),
  (Join-Path $env:ProgramFiles 'Inno Setup 6\ISCC.exe'),
  (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe')
)
$iscc = $candidatos | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $iscc -and $env:CI) {
  Write-Host 'Instalando Inno Setup...'
  choco install innosetup -y --no-progress | Out-Host
  $iscc = $candidatos | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}
if (-not $iscc) { throw 'No encontré Inno Setup 6. Instalalo con: winget install JRSoftware.InnoSetup' }

& $iscc "/DAppVersion=$Version" "/DSourceDir=$raiz" "/DNodeDir=$nodeDir" (Join-Path $PSScriptRoot 'claude-archivo.iss')
if ($LASTEXITCODE -ne 0) { throw "Inno Setup terminó con código $LASTEXITCODE" }

$exe = Join-Path $raiz "dist\Claude-Archivo-Setup-$Version.exe"
$hash = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLower()
"$hash  $(Split-Path $exe -Leaf)" | Set-Content -LiteralPath "$exe.sha256" -Encoding ascii
Write-Host "Listo: $exe"
Write-Host "SHA-256: $hash"
