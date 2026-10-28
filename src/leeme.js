// LEEME.md en la raíz de cada destino: explica qué hay y cómo usarlo sin la app.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { escribirAtomico } from './archivos.js';

export function textoLeeme(config) {
  const fuentes = config.fuentes.map((f) => `| \`${f.destino}/\` | ${f.nombre} | \`${f.origen}\` |`).join('\n');
  return `# Archivo de conversaciones de Claude

Esta carpeta la mantiene la app **Claude Archivo**. Es la copia de seguridad de las conversaciones de Claude Code y de la app de escritorio de Claude.

**La app solo copia y agrega: nunca borra nada de esta carpeta.** Si una conversación se borra en Claude, acá queda (marcada como "Borrada en Claude").

## Qué hay en cada carpeta

| Carpeta | Qué es | Se copia desde |
|---|---|---|
${fuentes}
| \`texto/\` | Cada conversación en Markdown legible. **Empezá por \`texto/INDICE.md\`.** | (lo genera la app) |
| \`_versiones/<fecha>/\` | Versiones anteriores de archivos que cambiaron de una forma que no era "agregar al final". | (lo genera la app) |
| \`_estado/\` | Manifiesto de lo copiado, índice de conversaciones y registro de cada sincronización. | (lo genera la app) |
| \`_configuracion/\` | Copia de la configuración de la app (destinos y fuentes). | \`${config.archivo ?? ''}\` |
| \`_app/\` | Copia de la propia app, para poder abrirla aunque se pierda la original. | (la carpeta de la app) |

## Cómo abrir la app desde esta carpeta

- Lo más simple: instalar Claude Archivo de nuevo con su instalador (https://github.com/FSichi/Claude-Sync-App/releases/latest).
- O, con Node.js 20 o más nuevo instalado (https://nodejs.org): doble clic en \`_app\\Abrir Claude Archivo.cmd\`. Así la app recupera la configuración guardada en \`_configuracion\`.

## Cómo devolverle una conversación a Claude Code

- **Desde la app:** abrí la conversación y usá "Restaurar en Claude". Solo copia, y nunca pisa una conversación que ya exista.
- **A mano:** copiá \`claude\\projects\\<carpeta>\\<id>.jsonl\` (y la carpeta \`<id>\\\` si existe) a \`%USERPROFILE%\\.claude\\projects\\<carpeta>\\\`. Después abrí una terminal en la carpeta del proyecto y corré \`claude --resume <id>\`.
- Las conversaciones de la app de escritorio no se pueden volver a ver en su barra lateral: se retoman desde la terminal.

## Si sos Claude y te pasaron esta carpeta

Empezá por \`texto/INDICE.md\` y después leé el \`.md\` de la conversación que te interese. Recurrí al \`.jsonl\` crudo solo si falta un detalle. **No borres ni muevas nada de esta carpeta.**
`;
}

export async function escribirLeeme(dest, config) {
  const ruta = path.join(dest, 'LEEME.md');
  const nuevo = textoLeeme(config);
  let actual = null;
  try {
    actual = await fsp.readFile(ruta, 'utf8');
  } catch {}
  if (actual !== nuevo) await escribirAtomico(ruta, nuevo);
}
