# Changelog

Los cambios de cada versión de Claude Archivo. La app muestra esta lista en Ajustes › App, y las novedades de cada versión cuando se actualiza. Las notas de cada release de GitHub salen de acá.

## [1.3.0] - 2026-10-28

### Nuevo
- **Archivos**: buscá cualquier archivo que Claude haya leído, escrito o editado, mirá en qué conversaciones aparece y recuperá sus versiones: los checkpoints de Claude Code, lo que escribió y lo que se reconstruye de cada edición. También muestra los que ya no están en tu PC. El índice se arma en la primera sincronización con esta versión.
- **Comprobar copias**: revisa cada destino, rápido (que esté todo y con el tamaño correcto) o a fondo (compara el contenido), y repara lo dañado con la versión buena de Claude o de otro destino, sin borrar nada.
- **Aviso de conversaciones en riesgo**: si una conversación sin respaldar está cerca del plazo en que Claude Code borra las sesiones, el inicio te avisa.
- **Recordatorio** cuando pasan varios días sin sincronizar y hay cambios. Se elige en Ajustes › General.

### Mejoras
- El inicio usa todo el ancho y suma la actividad de los últimos 30 días, los proyectos más activos y los archivos que cambió Claude.
- El encabezado de cada conversación es más simple: un menú de acciones (⋯) y los datos como etiquetas, con los archivos que tocó, los subagentes y el modelo.
- Las conversaciones se leen más anchas.
- Filtro "En riesgo" en Conversaciones.

### Arreglos
- Ajustes › Avanzado explica el borrado automático de Claude Code sin suponer qué pasa con las sesiones de la app de escritorio.

## [1.2.0] - 2026-10-28

### Nuevo
- **Diseño nuevo**, más simple y ordenado, en oscuro y en claro (o el tema del sistema).
- **Ajustes en su propia página**, con General, Destinos, Qué se copia, App y Avanzado.
- **Filtros** por estado, fecha o rango de fechas, origen, carpeta y contenido, con orden a elección.
- **Aviso de versión nueva** con las novedades y actualización en un clic: baja el instalador, lo verifica y reinicia la app.

### Mejoras
- Desde una conversación se vuelve al inicio con un clic, con la X o con Esc.
- Las herramientas que Claude usa seguidas se agrupan en un solo bloque.
- La búsqueda resalta cada palabra buscada.
- Ctrl+K lleva directo al buscador.
- La app abre más rápido: revisar qué cambió en Claude tarda un par de segundos en vez de quince.

## [1.1.0] - 2026-10-28

### Nuevo
- Instalador para Windows, con Node.js incluido y sin permisos de administrador.
- Configuración propia de cada usuario y destinos configurables desde la app: Google Drive, OneDrive, Dropbox, iCloud, otro disco o un NAS.
- Acceso directo en el Escritorio a cada destino.

### Arreglos
- Los títulos de la app de escritorio, Cowork y los espacios temporales se copian desde la ubicación nueva de la app de escritorio.
