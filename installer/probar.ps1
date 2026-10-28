<#
  Prueba el instalador en el CI:
    1. Lo instala en silencio en una carpeta temporal y verifica los archivos. Sin /ABRIR=si no debe dejar la app abierta.
    2. Arranca la app instalada (sin abrir ventana) y comprueba que responde, sirve la interfaz y crea su configuración.
    3. Lo vuelve a instalar como lo hace la app al actualizarse (/ABRIR=si) y comprueba que la app se vuelve a abrir.
  Pensado para los runners de GitHub Actions, que se descartan al terminar.
#>
param([Parameter(Mandatory = $true)][string]$Instalador)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$temporal = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }
$dir = Join-Path $temporal 'claude-archivo-instalada'
$env:CLAUDE_ARCHIVO_DATOS = Join-Path $temporal 'claude-archivo-datos'

function Instalar([string[]]$Extra = @()) {
  $argumentos = @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', "/DIR=`"$dir`"", '/TASKS=""') + $Extra
  # Sin -Wait: Start-Process -Wait espera también a los procesos que el instalador deja abiertos.
  $p = Start-Process -FilePath $Instalador -ArgumentList $argumentos -PassThru
  $null = $p.Handle # sin esto, ExitCode puede quedar vacío
  if (-not $p.WaitForExit(180000)) { throw 'El instalador no terminó en 3 minutos' }
  if ($p.ExitCode -ne 0) { throw "El instalador terminó con código $($p.ExitCode)" }
}
function Responde {
  try { (Invoke-RestMethod -Uri 'http://127.0.0.1:47821/api/ping' -TimeoutSec 2).app -eq 'claude-archivo' } catch { $false }
}
function EsperarQueResponda {
  for ($i = 0; $i -lt 30; $i++) {
    if (Responde) { return $true }
    Start-Sleep -Seconds 1
  }
  $false
}
function CerrarApp {
  Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$dir\*" } | Stop-Process -Force
}

# 1. Instalación silenciosa
Instalar
foreach ($f in 'node\node.exe', 'src\servidor.js', 'ui\index.html', 'ui\js\main.js', 'config.predeterminado.json', 'CHANGELOG.md', 'unins000.exe') {
  if (-not (Test-Path -LiteralPath (Join-Path $dir $f))) { throw "La instalación no tiene $f" }
}
Start-Sleep -Seconds 5
if (Responde) {
  CerrarApp
  throw 'La instalación silenciosa dejó la app abierta: solo tiene que abrirla cuando la app se actualiza (/ABRIR=si)'
}
Write-Host 'Archivos instalados, sin abrir la app: OK'

# 2. La app instalada arranca
$servidor = Start-Process -FilePath (Join-Path $dir 'node\node.exe') -ArgumentList "`"$(Join-Path $dir 'src\servidor.js')`"" -WorkingDirectory $dir -PassThru -NoNewWindow
try {
  if (-not (EsperarQueResponda)) { throw 'La app instalada no respondió' }
  $html = (Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:47821/').Content
  if ($html -notmatch '<title>Claude Archivo</title>') { throw 'La app instalada no sirvió la interfaz' }
  $config = Join-Path $env:CLAUDE_ARCHIVO_DATOS 'config.json'
  if (-not (Test-Path -LiteralPath $config)) { throw 'La app no creó la configuración del usuario' }
  if ((Get-Content -LiteralPath $config -Raw | ConvertFrom-Json).destinos.Count -ne 0) { throw 'La configuración nueva no debería traer destinos' }
  Write-Host 'La app instalada arranca, responde y crea su configuración: OK'
} finally {
  Stop-Process -Id $servidor.Id -Force -ErrorAction SilentlyContinue
}

# 3. Actualización: el instalador vuelve a abrir la app
Start-Sleep -Seconds 2
Instalar '/ABRIR=si'
try {
  if (-not (EsperarQueResponda)) { throw 'Después de actualizar, la app no se volvió a abrir' }
  Write-Host 'Al actualizar, la app se vuelve a abrir: OK'
} finally {
  CerrarApp
}
