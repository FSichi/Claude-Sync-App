<#
  Prueba el instalador en el CI: lo instala en silencio en una carpeta temporal, verifica los archivos,
  arranca la app instalada (sin abrir ventana) y comprueba que responde y sirve la interfaz.
  Pensado para los runners de GitHub Actions, que se descartan al terminar.
#>
param([Parameter(Mandatory = $true)][string]$Instalador)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$temporal = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }
$dir = Join-Path $temporal 'claude-archivo-instalada'

$p = Start-Process -FilePath $Instalador -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', "/DIR=`"$dir`"", '/TASKS=""' -Wait -PassThru
if ($p.ExitCode -ne 0) { throw "El instalador terminó con código $($p.ExitCode)" }
foreach ($f in 'node\node.exe', 'src\servidor.js', 'ui\index.html', 'config.predeterminado.json', 'unins000.exe') {
  if (-not (Test-Path -LiteralPath (Join-Path $dir $f))) { throw "La instalación no tiene $f" }
}
Write-Host 'Archivos instalados: OK'

$env:CLAUDE_ARCHIVO_DATOS = Join-Path $temporal 'claude-archivo-datos'
$servidor = Start-Process -FilePath (Join-Path $dir 'node\node.exe') -ArgumentList "`"$(Join-Path $dir 'src\servidor.js')`"" -WorkingDirectory $dir -PassThru -NoNewWindow
try {
  $ok = $false
  for ($i = 0; $i -lt 30 -and -not $ok; $i++) {
    try { $ok = (Invoke-RestMethod -Uri 'http://127.0.0.1:47821/api/ping' -TimeoutSec 2).app -eq 'claude-archivo' } catch { Start-Sleep -Seconds 1 }
  }
  if (-not $ok) { throw 'La app instalada no respondió' }
  $html = (Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:47821/').Content
  if ($html -notmatch 'Archivo de Claude') { throw 'La app instalada no sirvió la interfaz' }
  $config = Join-Path $env:CLAUDE_ARCHIVO_DATOS 'config.json'
  if (-not (Test-Path -LiteralPath $config)) { throw 'La app no creó la configuración del usuario' }
  if ((Get-Content -LiteralPath $config -Raw | ConvertFrom-Json).destinos.Count -ne 0) { throw 'La configuración nueva no debería traer destinos' }
  Write-Host 'La app instalada arranca, responde y crea su configuración: OK'
} finally {
  Stop-Process -Id $servidor.Id -Force -ErrorAction SilentlyContinue
}
