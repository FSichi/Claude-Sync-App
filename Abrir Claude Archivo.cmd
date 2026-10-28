@echo off
rem Abre Claude Archivo en su propia ventana. El servidor corre oculto y se apaga solo al cerrar la ventana.
rem Usa el Node.js que trae el instalador; si no esta, el que haya instalado en la PC.
set "NODO=%~dp0node\node.exe"
if exist "%NODO%" goto abrir
set "NODO=node"
where node >nul 2>nul
if errorlevel 1 (
  echo No se encontro Node.js. Instala Claude Archivo con su instalador, o Node.js desde https://nodejs.org
  pause
  exit /b 1
)
:abrir
start "" "%SystemRoot%\System32\conhost.exe" --headless "%NODO%" "%~dp0src\servidor.js" --abrir
