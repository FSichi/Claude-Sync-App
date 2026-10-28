# Claude Archivo: manual

Cómo usar la app, qué protege y dónde queda cada cosa. Para instalarla, mirá el [README](README.md).

## Cómo se usa

- **Abrir:** acceso directo **Claude Archivo** (Escritorio o menú Inicio). Se abre una ventana propia. El servidor corre oculto y se apaga solo unos minutos después de que la cerrás.
- **Primera vez:** elegí dónde guardar las copias (*Ajustes → Destinos*). Conviene uno en otro disco y otro en la nube.
- **Sincronizar:** botón **Sincronizar**, abajo a la izquierda. La primera vez copia todo y puede tardar varios minutos. Las siguientes copian solo lo nuevo. El inicio te dice cuántas conversaciones tienen cambios sin respaldar.
- **Buscar:** el buscador del inicio (`Ctrl+K` o `/`) busca en el texto de todas las conversaciones. En *Conversaciones*, el cuadro filtra por título o carpeta y Enter busca en el contenido. Al abrir un resultado, las coincidencias quedan resaltadas y **Siguiente** salta a cada una.
- **Filtrar:** en *Conversaciones*, el botón **Filtros** abre un panel con fecha (hoy, 7 días, 30 días, este año o un rango), estado, origen y carpeta. Cada filtro activo queda como una etiqueta arriba de la lista: con la X lo sacás.
- **Leer:** clic en una conversación. Las herramientas que Claude usó seguidas se agrupan: clic en el grupo para verlas y en cada una para ver qué recibió y qué devolvió. Arriba podés ocultar las herramientas o el razonamiento.
- **Cerrar:** la X de la conversación o `Esc` la cierra. Otro `Esc` vuelve al inicio.
- **Restaurar en Claude:** en una conversación que ya no está en Claude, copia su `.jsonl` (y sus subagentes) a `%USERPROFILE%\.claude\projects` para retomarla con `claude --resume`. Nunca pisa nada.
- **Exportar .md:** baja la conversación como Markdown legible.
- **Tu nombre y el tema:** *Ajustes → General*.

### Actualizaciones

Cada vez que se abre, la app busca versiones nuevas en la lista pública de versiones de GitHub. Si hay una, te muestra qué trae y **Actualizar** baja el instalador, comprueba su SHA-256, lo instala y vuelve a abrir la app. Tu configuración y tus copias no se tocan. Mientras sincroniza no se puede actualizar.

En *Ajustes → App* ves tu versión, el historial de cambios y un botón para buscar ahora. Ahí también se apaga la búsqueda automática: la app deja de conectarse a internet.

### Destinos

En *Ajustes → Destinos* podés:

- **Agregar** una carpeta. La app detecta Google Drive, OneDrive, Dropbox e iCloud, o elegís cualquier otra con el explorador (otro disco, un NAS con `\\servidor\carpeta`).
- **Elegir el principal**, que es desde donde la app te muestra las conversaciones.
- **Quitar** un destino de la lista. No borra nada: la carpeta queda como está y solo deja de actualizarse.
- **Crear un acceso directo** en el Escritorio a la carpeta de cada destino.

La app no acepta carpetas que ya tienen otros archivos, que están dentro de otro destino o que contienen lo que se copia. Antes de cada cambio guarda una copia del `config.json` anterior.

Si un destino no está disponible (un disco desconectado, Google Drive cerrado), la app lo saltea sin crear nada y lo pone al día en la próxima sincronización.

### Google Drive

Agregá como destino una carpeta dentro de Google Drive, por ejemplo `G:\Mi unidad\Claude-Archivo`, y sincronizá. Lo que la app guarda ahí, Google Drive lo sube solo.

- **Modo "Transmitir archivos"** (unidad `G:`): después de la primera copia, en el Explorador, clic derecho en `Claude-Archivo` → *Acceso sin conexión* → *Disponible sin conexión*. Así esa carpeta queda también en tu disco y la app no depende de internet para comparar.
- **Modo "Duplicar archivos"** (Mi unidad completa en tu disco): no hay que hacer nada más.
- Ojo con el espacio: la cuenta gratis tiene 15 GB y el archivo crece con cada conversación larga.

## Qué protege

| Riesgo | Qué pasa |
|---|---|
| Borrás un chat desde la app de escritorio (su `.jsonl` desaparece de la PC) | Queda en el archivo, marcado *Borrada en Claude*, si ya se había sincronizado. |
| Claude Code borra sesiones de terminal viejas (`cleanupPeriodDays`, 30 días por defecto) | Quedan en el archivo. |
| Se borra o se formatea el disco | Queda la copia en los otros destinos. |
| Se pierde o se rompe la PC | Queda la copia en la nube, si uno de los destinos es Google Drive, OneDrive o similar. |
| Claude reescribe una conversación de una forma que no es "agregar al final" | La versión anterior queda en `_versiones\<fecha>\` antes de actualizar. |

**Lo que no protege:** lo que se borra *antes* de sincronizar. Conviene apretar el botón seguido, por ejemplo al terminar el día.

## La regla de oro: solo copia

El programa no tiene ninguna instrucción que borre archivos (se puede verificar buscando `unlink`, `rm` o `rmdir` en `src\`: no aparecen). Nunca modifica los originales de Claude: solo los lee. El instalador de cada actualización queda en la carpeta temporal de Windows (`%TEMP%\Claude-Archivo-actualizacion\`). En el archivo, únicamente agrega o actualiza, y antes de actualizar algo que no sea un agregado al final, guarda la versión anterior. El desinstalador saca solo la app: no toca tu configuración ni tus copias.

## Dónde queda cada cosa

- **Configuración:** `%LOCALAPPDATA%\Claude-Archivo\config.json`. Las copias de configs anteriores, en `config-anteriores\` dentro de esa carpeta.
- **Registro de la app:** `%LOCALAPPDATA%\Claude-Archivo\servidor.log`.
- **En cada destino:**
  - `LEEME.md`: qué hay y cómo usarlo sin la app.
  - `texto\INDICE.md`: todas las conversaciones, con enlace a su versión Markdown.
  - `claude\`, `app-escritorio\`: las copias.
  - `_versiones\`: versiones anteriores de archivos que cambiaron.
  - `_estado\`: manifiesto, índice y registro de cada sincronización.
  - `_configuracion\config.json`: una copia de tu configuración.
  - `_app\`: una copia del código de la app.

## Qué se copia

Lo define `config.json` → `fuentes`. Por defecto:

- `%USERPROFILE%\.claude\projects`: conversaciones, subagentes, resultados de herramientas y memorias.
- `%USERPROFILE%\.claude\file-history`, `plans`, `tasks`, `agent-memory`, `history.jsonl`, `CLAUDE.md`, `settings.json`, `skills`, `agents`, `commands`.
- `%APPDATA%\Claude\claude-code-sessions`: títulos y estado de las sesiones de la app de escritorio.
- `%APPDATA%\Claude\local-agent-mode-sessions` (Cowork, sin la caché `rpm`) y `scratch-workspaces`.

Las versiones nuevas de la app de escritorio guardan esos datos en `%LOCALAPPDATA%\Claude-Data\claude_…\`. La app los busca primero ahí y, si no están, en `%APPDATA%\Claude\`.

**No se copian** las credenciales (`.credentials.json`) ni `~\.claude.json`.

Para sumar conversaciones de una copia vieja (por ejemplo, rescatadas de un disco), agregá una fuente con `"conversaciones": true` y `"recuperada": true`. La app las muestra como *Recuperadas* y solo las lee.

Ojo: las conversaciones son texto plano y pueden tener cualquier cosa que haya aparecido en un chat (por ejemplo, un token pegado). Las copias tienen la misma sensibilidad que tu carpeta `.claude`.

## Después de formatear o en una PC nueva

1. Instalá Claude Archivo con su instalador, o abrí `<destino>\_app\Abrir Claude Archivo.cmd` si tenés Node.js. Abierta desde `_app`, la app recupera tu configuración de `_configuracion\`.
2. Para devolverle todo a Claude Code, copiá `<destino>\claude\projects\*` a `%USERPROFILE%\.claude\projects\`, o restaurá las conversaciones de a una desde la app.

## Archivos del código

| Archivo | Qué hace |
|---|---|
| `src\sincronizar.js` | Motor de copia: nuevo, agregar al final, versionar, marcar borrados. |
| `src\parser.js` | Lee los `.jsonl` (formato interno de Claude Code, tolerante a cambios y a líneas dañadas). |
| `src\indice.js` | Índice de conversaciones y textos Markdown. |
| `src\config.js` | Configuración del usuario: dónde está, cómo se crea la primera vez y cómo se migra. |
| `src\destinos.js` | Destinos: validar, guardar en `config.json`, sugerir, explorador de carpetas y accesos directos. |
| `src\servidor.js` | Servidor local (solo `127.0.0.1`, con token por sesión) y ventana. |
| `src\actualizaciones.js` | Busca versiones nuevas en GitHub, baja el instalador, lo verifica y lo ejecuta. |
| `src\changelog.js` | Lee `CHANGELOG.md` y las notas de cada versión. |
| `ui\index.html`, `ui\estilos.css` | Estructura y diseño de la interfaz. |
| `ui\js\` | Interfaz, un módulo por parte: inicio, conversaciones, lector, filtros, ajustes, actualizaciones. |
| `CHANGELOG.md` | Los cambios de cada versión. La app los muestra y el release de GitHub los usa como notas. |
| `installer\` | Instalador (Inno Setup) y scripts para armarlo y probarlo. |
| `.github\workflows\` | CI (tests e instalador en cada PR) y publicación de versiones. |
