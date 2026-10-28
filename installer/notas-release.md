## Cómo instalar

1. Bajá **Claude-Archivo-Setup-….exe** (abajo, en *Assets*) y abrilo.
2. Windows puede mostrar "Windows protegió tu PC", porque el instalador no está firmado. Tocá **Más información → Ejecutar de todas formas**.
3. Se instala para tu usuario, sin permisos de administrador, y crea el acceso directo **Claude Archivo**.
4. La primera vez, elegí dónde guardar las copias (otro disco, Google Drive, OneDrive o un NAS) y apretá **Sincronizar ahora**.

Si ya tenías la app, este instalador la actualiza. Tu configuración y tus copias no se tocan.

Para verificar el archivo, compará su SHA-256 con el del `.sha256` (en PowerShell: `Get-FileHash .\Claude-Archivo-Setup-….exe`).
