# Claude Archivo

Respaldo y visor local de tus conversaciones de **Claude Code**, de la **app de escritorio de Claude** y de **Cowork**, para Windows.

Las conversaciones de Claude Code se guardan solo en tu PC. Si borrás un chat desde la app, si Claude Code limpia sesiones viejas o si se rompe el disco, se pierden. Claude Archivo las copia a los lugares que elijas (otro disco, Google Drive, OneDrive, un NAS) y te deja leerlas, buscarlas y devolverlas a Claude.

**Solo copia: nunca borra nada.** Ni de Claude ni de tus copias.

> Proyecto independiente, sin relación con Anthropic.

## Instalar

1. Bajá **Claude-Archivo-Setup-….exe** de la [última versión](https://github.com/FSichi/Claude-Sync-App/releases/latest).
2. Windows puede mostrar "Windows protegió tu PC", porque el instalador no está firmado. Tocá **Más información → Ejecutar de todas formas**.
3. Se instala para tu usuario, sin permisos de administrador, y crea el acceso directo **Claude Archivo**.
4. La primera vez, elegí dónde guardar las copias y apretá **Sincronizar ahora**.

Requisitos: Windows 10 u 11 de 64 bits. No hace falta instalar Node.js: viene incluido.

## Qué hace

- **Copia** las conversaciones de Claude Code (con sus subagentes, memorias y checkpoints), los títulos de la app de escritorio, Cowork, tus skills y tu `CLAUDE.md`.
- **Conserva lo que Claude borra:** si un chat desaparece de Claude, en la copia queda marcado *Borrada en Claude*.
- **Guarda versiones:** si Claude reescribe una conversación de una forma que no es agregar al final, la versión anterior queda en `_versiones\`.
- **Visor:** tus mensajes, las respuestas, las herramientas que se usaron (con lo que recibieron y devolvieron), las imágenes y los subagentes.
- **Búsqueda** por título y en el texto completo de todas las conversaciones.
- **Restaurar en Claude:** devuelve una conversación a Claude Code para retomarla con `claude --resume`.
- **Texto legible:** cada destino tiene las conversaciones en Markdown y un índice (`texto\INDICE.md`), para leerlas sin la app.
- **Varios destinos:** detecta Google Drive, OneDrive, Dropbox e iCloud. Si el destino es una carpeta sincronizada, la copia se sube sola a la nube.

El manual completo está en [LEEME.md](LEEME.md).

## Privacidad

- La app no manda nada a internet. Todo queda en tu PC y en los destinos que elijas. Si elegís una carpeta de Google Drive u OneDrive, ese servicio sube la copia a tu cuenta.
- La interfaz corre en un servidor local que escucha solo en `127.0.0.1` y pide un token por sesión.
- No copia credenciales (`.credentials.json`) ni `~\.claude.json`.
- Las conversaciones son texto plano y pueden tener cualquier cosa que haya aparecido en un chat. Tratá las copias con el mismo cuidado que tu carpeta `.claude`.

## Limitaciones

- Por ahora funciona solo en Windows.
- La sincronización es manual: lo que se borre antes de sincronizar no se puede rescatar.
- El formato de las conversaciones es interno de Claude Code y puede cambiar entre versiones. El lector es tolerante, pero algo nuevo podría verse incompleto hasta actualizar la app.

## Desarrollo

No tiene dependencias externas: solo Node.js 20 o más nuevo.

```
npm test                  # tests
npm run servidor          # servidor sin abrir ventana (muestra la URL)
npm start                 # abre la app
npm run simular           # muestra qué copiaría, sin escribir nada
npm run sincronizar       # sincroniza desde la terminal
```

Cada usuario tiene su configuración en `%LOCALAPPDATA%\Claude-Archivo\config.json`. Se crea la primera vez a partir de [`config.predeterminado.json`](config.predeterminado.json). Para probar con otra carpeta de datos, usá la variable `CLAUDE_ARCHIVO_DATOS`.

### Instalador y versiones

- `installer\armar.ps1 -Version X.Y.Z` arma `dist\Claude-Archivo-Setup-X.Y.Z.exe` con [Inno Setup 6](https://jrsoftware.org/isinfo.php) (`winget install JRSoftware.InnoSetup`). Incluye el Node.js oficial, verificado con su SHA-256.
- En cada pull request, el CI corre los tests, arma el instalador, lo instala y comprueba que la app arranca.
- **Publicar una versión:** subí `version` en `package.json`, mergealo a `main` y creá el tag: `git tag vX.Y.Z` y `git push origin vX.Y.Z`. El workflow *Release* publica el instalador en GitHub Releases.

## Licencia

[MIT](LICENSE). Incluye [Node.js](https://nodejs.org), que tiene su propia licencia (en `node\LICENSE` dentro de la instalación).
