// Lee un .jsonl de Claude Code y lo convierte en: datos para el índice, eventos para el visor y texto Markdown.
// El formato del .jsonl es interno de Claude Code y cambia entre versiones: todo se lee de forma tolerante.
import fsp from 'node:fs/promises';

const TROZO = 4 * 1024 * 1024;
const MAX_TEXTO = 40000;
const MAX_DETALLE = 6000;
const RE_UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export async function* leerLineas(abs) {
  const fh = await fsp.open(abs, 'r');
  try {
    const buf = Buffer.allocUnsafe(TROZO);
    let resto = Buffer.alloc(0);
    let pos = 0; // posición en el archivo del primer byte de "resto"
    for (;;) {
      const { bytesRead } = await fh.read(buf, 0, TROZO, pos + resto.length);
      if (bytesRead === 0) break;
      const datos = resto.length ? Buffer.concat([resto, buf.subarray(0, bytesRead)]) : buf.subarray(0, bytesRead);
      let inicio = 0;
      let nl;
      while ((nl = datos.indexOf(10, inicio)) !== -1) {
        let fin = nl;
        if (fin > inicio && datos[fin - 1] === 13) fin--;
        if (fin > inicio) yield { linea: datos.toString('utf8', inicio, fin), off: pos + inicio };
        inicio = nl + 1;
      }
      resto = Buffer.from(datos.subarray(inicio));
      pos += inicio;
    }
    if (resto.length) yield { linea: resto.toString('utf8'), off: pos, ultima: true };
  } finally {
    await fh.close();
  }
}

// Lee la línea que empieza en el byte "off" (para ver un mensaje completo o una imagen).
export async function leerLineaEn(abs, off) {
  const fh = await fsp.open(abs, 'r');
  try {
    const partes = [];
    const buf = Buffer.allocUnsafe(TROZO);
    for (let pos = off; ; ) {
      const { bytesRead } = await fh.read(buf, 0, TROZO, pos);
      if (bytesRead === 0) break;
      const nl = buf.subarray(0, bytesRead).indexOf(10);
      if (nl !== -1) {
        partes.push(Buffer.from(buf.subarray(0, nl)));
        break;
      }
      partes.push(Buffer.from(buf.subarray(0, bytesRead)));
      pos += bytesRead;
    }
    return Buffer.concat(partes).toString('utf8').replace(/\r$/, '');
  } finally {
    await fh.close();
  }
}

// Imágenes de una línea, siempre en el mismo orden (lo usan el parser y el visor).
export function imagenesDeLinea(o) {
  const salida = [];
  const contenido = o?.message?.content;
  if (!Array.isArray(contenido)) return salida;
  for (const b of contenido) {
    if (b?.type === 'image' && b.source?.data) salida.push(b.source);
    if (b?.type === 'tool_result' && Array.isArray(b.content)) {
      for (const c of b.content) if (c?.type === 'image' && c.source?.data) salida.push(c.source);
    }
  }
  return salida;
}

// Quita los datos en base64 para poder mostrar una línea cruda sin mandar megas al navegador.
export function sinBase64(o) {
  return JSON.parse(JSON.stringify(o), (k, v) => (k === 'data' && typeof v === 'string' && v.length > 200 ? `[${Math.round((v.length * 3) / 4 / 1024)} KB en base64]` : v));
}

const ETIQUETAS_SISTEMA = ['task-notification', 'agent-message', 'ci-monitor-event', 'user-prompt-submit-hook', 'command-message'];

export function clasificarTextoUsuario(t) {
  if (typeof t !== 'string') return null;
  let s = t
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<ide_[a-z_]+>[\s\S]*?<\/ide_[a-z_]+>/g, '')
    .trim();
  if (!s || s.startsWith('Caveat: The messages below were generated')) return null;
  if (/^\[Request interrupted by user/.test(s)) return { tipo: 'interrupcion', texto: 'Interrumpido por el usuario' };
  const cmd = s.match(/<command-name>([\s\S]*?)<\/command-name>/);
  if (cmd) {
    const args = s.match(/<command-args>([\s\S]*?)<\/command-args>/);
    return { tipo: 'comando', texto: `${cmd[1].trim()} ${args ? args[1].trim() : ''}`.trim() };
  }
  const bash = s.match(/^<bash-input>([\s\S]*?)<\/bash-input>/);
  if (bash) return { tipo: 'comando', texto: `! ${bash[1].trim()}` };
  if (/^<(local-command-std(out|err)|bash-std(out|err))>/.test(s)) {
    return { tipo: 'salida', texto: s.replace(/<\/?(local-command-std(out|err)|bash-std(out|err))>/g, '').trim() };
  }
  const etiqueta = s.match(/^<([a-z-]+)[\s>]/);
  if (etiqueta && ETIQUETAS_SISTEMA.includes(etiqueta[1])) return { tipo: 'sistema', texto: s };
  s = s.replace(/<pasted_content[^>]*>/g, '\n[Contenido pegado]\n').replace(/<\/pasted_content>/g, '').trim();
  return { tipo: 'usuario', texto: s };
}

function recortar(texto, max) {
  if (texto.length <= max) return { texto, truncado: false };
  return { texto: texto.slice(0, max), truncado: true };
}

function textoDeResultado(contenido) {
  if (typeof contenido === 'string') return contenido;
  if (!Array.isArray(contenido)) return contenido == null ? '' : JSON.stringify(contenido);
  return contenido
    .map((c) => (c?.type === 'text' ? c.text : c?.type === 'image' ? '[imagen]' : ''))
    .filter(Boolean)
    .join('\n');
}

const primeraCadena = (o) => Object.values(o ?? {}).find((v) => typeof v === 'string' && v.length < 300) ?? '';

export function resumenHerramienta(nombre, e = {}) {
  const n = nombre ?? '';
  if (/^(Bash|PowerShell)$/.test(n)) return e.description || e.command || '';
  if (/^(Read|Write|Edit|MultiEdit|NotebookEdit)$/.test(n)) return e.file_path || e.notebook_path || '';
  if (/^(Grep|Glob)$/.test(n)) return [e.pattern, e.path].filter(Boolean).join('  en  ');
  if (n === 'WebFetch') return e.url || '';
  if (n === 'WebSearch') return e.query || '';
  if (/^(Agent|Task)$/.test(n)) return e.description || '';
  if (n === 'TodoWrite') return 'Actualiza la lista de tareas';
  if (n === 'Skill') return e.skill || '';
  return primeraCadena(e);
}

export function nombreHerramienta(n = '') {
  const m = n.match(/^mcp__(.+?)__(.+)$/);
  if (!m) return n;
  const servidor = /^[0-9a-f-]{20,}$/.test(m[1]) ? 'conector' : m[1].replace(/^plugin_|^claude_/i, '');
  return `${servidor} · ${m[2]}`;
}

// ---------- Archivos que tocó Claude y tokens usados ----------
// Se juntan por conversación (y por subagente) para el índice de archivos y las estadísticas.

const ACCIONES_ARCHIVO = { Read: 'leido', Write: 'escrito', Edit: 'editado', MultiEdit: 'editado', NotebookEdit: 'editado' };
const CAMPOS_USO = [['entrada', 'input_tokens'], ['salida', 'output_tokens'], ['cacheEscritura', 'cache_creation_input_tokens'], ['cacheLectura', 'cache_read_input_tokens']];

// La misma clave para C:\a\b.js, c:/a/b.js y C:\A\B.js: en Windows las rutas no distinguen mayúsculas.
export function claveArchivo(ruta) {
  const r = String(ruta ?? '').trim();
  return /^[a-z]:[\\/]/i.test(r) ? r.replace(/\//g, '\\').toLowerCase() : r;
}

export const nuevoRastro = () => ({ archivos: new Map(), mensajes: new Map() });

function tocar(rastro, ruta, accion, ts, checkpoint = false) {
  if (typeof ruta !== 'string' || !ruta.trim() || ruta.length > 1000) return;
  const k = claveArchivo(ruta);
  let a = rastro.archivos.get(k);
  if (!a) rastro.archivos.set(k, (a = { ruta, leido: 0, escrito: 0, editado: 0, checkpoint: false, primera: ts, ultima: ts }));
  if (accion) a[accion]++;
  if (checkpoint) a.checkpoint = true;
  if (ts && (!a.primera || ts < a.primera)) a.primera = ts;
  if (ts && (!a.ultima || ts >= a.ultima)) {
    a.ultima = ts;
    a.ruta = ruta;
  }
}

export function rastrear(rastro, o) {
  const ts = typeof o.timestamp === 'string' ? o.timestamp : null;
  if (o.type === 'file-history-snapshot') {
    const s = o.snapshot ?? {};
    for (const ruta of Object.keys(s.trackedFileBackups ?? {})) tocar(rastro, ruta, null, s.timestamp ?? ts, true);
    return;
  }
  if (o.type !== 'assistant') return;
  const msg = o.message ?? {};
  // Claude Code escribe una línea por bloque de la respuesta, todas con el mismo uso: se cuenta una vez por mensaje.
  const idMsg = msg.id || o.requestId;
  if (msg.usage && msg.model && msg.model !== '<synthetic>' && idMsg) {
    const previo = rastro.mensajes.get(idMsg);
    const m = previo ?? { dia: fechaLocal(ts, false) || 'sin-fecha', modelo: msg.model };
    for (const [campo, api] of CAMPOS_USO) m[campo] = Math.max(m[campo] ?? 0, Number(msg.usage[api]) || 0);
    if (!previo) rastro.mensajes.set(idMsg, m);
  }
  if (!Array.isArray(msg.content)) return;
  for (const b of msg.content) {
    if (b?.type === 'tool_use' && ACCIONES_ARCHIVO[b.name]) tocar(rastro, b.input?.file_path ?? b.input?.notebook_path, ACCIONES_ARCHIVO[b.name], ts);
  }
}

export function cerrarRastro(rastro) {
  const uso = new Map();
  for (const m of rastro.mensajes.values()) {
    const k = `${m.dia}|${m.modelo}`;
    let x = uso.get(k);
    if (!x) uso.set(k, (x = { dia: m.dia, modelo: m.modelo, entrada: 0, salida: 0, cacheEscritura: 0, cacheLectura: 0, respuestas: 0 }));
    for (const [campo] of CAMPOS_USO) x[campo] += m[campo];
    x.respuestas++;
  }
  return {
    archivos: [...rastro.archivos.values()].sort((a, b) => (b.ultima ?? '').localeCompare(a.ultima ?? '')),
    uso: [...uso.values()].sort((a, b) => a.dia.localeCompare(b.dia)),
  };
}

// Solo archivos y tokens: para los subagentes, que no se muestran en la lista.
export async function analizarRastro(abs) {
  const rastro = nuevoRastro();
  for await (const { linea } of leerLineas(abs)) {
    let o;
    try {
      o = JSON.parse(linea);
    } catch {
      continue;
    }
    if (o && typeof o === 'object') rastrear(rastro, o);
  }
  return cerrarRastro(rastro);
}

export async function analizar(abs) {
  const rastro = nuevoRastro();
  const r = {
    id: null, cwd: null, rama: null, entrada: null, version: null,
    tituloPropio: null, tituloIA: null, resumen: null, primerPrompt: null, ultimoPrompt: null,
    desde: null, hasta: null, mensajesUsuario: 0, respuestas: 0, herramientas: 0, imagenes: 0,
    compactaciones: 0, modelos: [], lineas: 0, lineasDanadas: 0, lineasLaterales: 0,
  };
  const modelos = new Set();
  const eventos = [];
  const herramientasPorId = new Map();
  let ultimoMensaje = null;
  let errorEnUltima = false;
  let esSubagente = null;

  const agregar = (ev) => {
    eventos.push(ev);
    if (ev.tipo !== 'claude') ultimoMensaje = null;
  };

  for await (const { linea, off, ultima } of leerLineas(abs)) {
    r.lineas++;
    let o;
    try {
      o = JSON.parse(linea);
    } catch {
      r.lineasDanadas++;
      if (ultima) errorEnUltima = true;
      continue;
    }
    if (!o || typeof o !== 'object') continue;
    rastrear(rastro, o);
    const ts = typeof o.timestamp === 'string' ? o.timestamp : null;
    if (ts) {
      if (!r.desde || ts < r.desde) r.desde = ts;
      if (!r.hasta || ts > r.hasta) r.hasta = ts;
    }
    if (!r.id && typeof o.sessionId === 'string') r.id = o.sessionId;
    if (!r.cwd && typeof o.cwd === 'string') r.cwd = o.cwd;
    if (typeof o.gitBranch === 'string' && o.gitBranch) r.rama = o.gitBranch;
    if (!r.entrada && typeof o.entrypoint === 'string') r.entrada = o.entrypoint;
    if (typeof o.version === 'string') r.version = o.version;

    switch (o.type) {
      case 'custom-title':
        if (o.customTitle) r.tituloPropio = o.customTitle;
        continue;
      case 'ai-title':
        if (o.aiTitle || o.title) r.tituloIA = o.aiTitle || o.title;
        continue;
      case 'summary':
        if (o.summary) r.resumen = o.summary;
        continue;
      case 'system':
        if (o.subtype === 'compact_boundary') {
          r.compactaciones++;
          agregar({ tipo: 'compactacion', ts, texto: 'Conversación compactada' });
        } else if (o.level === 'error' && o.content) {
          agregar({ tipo: 'sistema', ts, texto: String(o.content).slice(0, MAX_DETALLE) });
        }
        continue;
      case 'user':
      case 'assistant':
        break;
      default:
        continue;
    }
    // En una conversación principal, las líneas "laterales" son trabajo interno de subagentes (versiones viejas).
    // Si el archivo arranca con una, es el transcript de un subagente y se muestra entero.
    if (esSubagente === null) esSubagente = Boolean(o.isSidechain);
    if (o.isSidechain && !esSubagente) {
      r.lineasLaterales++;
      continue;
    }
    const contenido = o.message?.content;

    if (o.type === 'user') {
      if (o.isMeta) continue;
      if (o.isCompactSummary) {
        const t = typeof contenido === 'string' ? contenido : textoDeResultado(contenido);
        agregar({ tipo: 'compactacion', ts, ...recortar(t, MAX_DETALLE), off, resumenCompacto: true });
        continue;
      }
      const bloques = typeof contenido === 'string' ? [{ type: 'text', text: contenido }] : Array.isArray(contenido) ? contenido : [];
      let nImagen = 0;
      for (const b of bloques) {
        if (b?.type === 'text') {
          const c = clasificarTextoUsuario(b.text);
          if (!c) continue;
          if (c.tipo === 'usuario') {
            r.mensajesUsuario++;
            const corto = c.texto.replace(/\s+/g, ' ').slice(0, 300);
            if (!r.primerPrompt) r.primerPrompt = corto;
            r.ultimoPrompt = corto;
          }
          agregar({ tipo: c.tipo, ts, ...recortar(c.texto, c.tipo === 'usuario' ? MAX_TEXTO : MAX_DETALLE), off });
        } else if (b?.type === 'image') {
          if (!b.source?.data) continue;
          r.imagenes++;
          agregar({ tipo: 'imagen', ts, off, n: nImagen++ });
        } else if (b?.type === 'document') {
          agregar({ tipo: 'sistema', ts, texto: `Documento adjunto (${b.source?.media_type ?? 'archivo'})` });
        } else if (b?.type === 'tool_result') {
          const imagenes = [];
          if (Array.isArray(b.content)) {
            for (const c of b.content) if (c?.type === 'image' && c.source?.data) imagenes.push({ off, n: nImagen++ });
          }
          r.imagenes += imagenes.length;
          const res = { ...recortar(textoDeResultado(b.content), MAX_DETALLE), error: Boolean(b.is_error), off, imagenes };
          const h = herramientasPorId.get(b.tool_use_id);
          if (h && !h.resultado) h.resultado = res;
          else agregar({ tipo: 'resultado', ts, resultado: res });
        }
      }
      continue;
    }

    // assistant
    const msg = o.message ?? {};
    if (msg.model && msg.model !== '<synthetic>') modelos.add(msg.model);
    const bloques = typeof contenido === 'string' ? [{ type: 'text', text: contenido }] : Array.isArray(contenido) ? contenido : [];
    for (const b of bloques) {
      if (b?.type === 'text') {
        if (!b.text?.trim()) continue;
        if (o.isApiErrorMessage || msg.model === '<synthetic>') {
          agregar({ tipo: 'sistema', ts, texto: b.text.slice(0, MAX_DETALLE) });
          continue;
        }
        if (ultimoMensaje && ultimoMensaje.msgId && ultimoMensaje.msgId === msg.id) {
          const unido = `${ultimoMensaje.texto}\n\n${b.text}`;
          Object.assign(ultimoMensaje, recortar(unido, MAX_TEXTO));
        } else {
          r.respuestas++;
          const ev = { tipo: 'claude', ts, ...recortar(b.text, MAX_TEXTO), off, msgId: msg.id ?? null };
          agregar(ev);
          ultimoMensaje = ev;
        }
      } else if (b?.type === 'thinking') {
        if (b.thinking?.trim()) agregar({ tipo: 'pensamiento', ts, ...recortar(b.thinking, MAX_DETALLE), off });
      } else if (b?.type === 'tool_use' || b?.type === 'server_tool_use') {
        r.herramientas++;
        let entrada = '';
        try {
          entrada = JSON.stringify(b.input ?? {}, null, 2);
        } catch {}
        const ev = {
          tipo: 'herramienta', ts, off,
          nombre: nombreHerramienta(b.name),
          resumen: String(resumenHerramienta(b.name, b.input ?? {})).replace(/\s+/g, ' ').slice(0, 300),
          ...recortar(entrada, MAX_DETALLE),
          resultado: null,
        };
        agregar(ev);
        if (b.id) herramientasPorId.set(b.id, ev);
      }
    }
  }

  if (errorEnUltima) {
    r.lineasDanadas--;
    r.ultimaIncompleta = true;
  }
  r.modelos = [...modelos];
  Object.assign(r, cerrarRastro(rastro));
  if (!r.id) r.id = abs.match(RE_UUID)?.[0] ?? null;
  r.vacia = r.mensajesUsuario === 0 && r.respuestas < 3;
  for (const ev of eventos) delete ev.msgId;
  return { resumen: r, eventos };
}

export function tituloDe(r, tituloApp) {
  if (r.tituloPropio) return { titulo: r.tituloPropio, origen: 'propio' };
  if (tituloApp) return { titulo: tituloApp, origen: 'app' };
  if (r.tituloIA) return { titulo: r.tituloIA, origen: 'ia' };
  if (r.resumen) return { titulo: r.resumen, origen: 'resumen' };
  if (r.primerPrompt) return { titulo: r.primerPrompt.length > 90 ? r.primerPrompt.slice(0, 90) + '…' : r.primerPrompt, origen: 'prompt' };
  return { titulo: 'Sin título', origen: 'ninguno' };
}

const p2 = (n) => String(n).padStart(2, '0');
export function fechaLocal(iso, conHora = true) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const f = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  return conHora ? `${f} ${p2(d.getHours())}:${p2(d.getMinutes())}` : f;
}

export function aMarkdown({ titulo, clave, resumen: r, eventos, nombreUsuario }) {
  const l = [`# ${titulo}`, ''];
  l.push(`- **Sesión:** \`${r.id ?? '?'}\``);
  if (r.cwd) l.push(`- **Carpeta:** \`${r.cwd}\``);
  l.push(`- **Desde:** ${fechaLocal(r.desde) || '?'} · **Hasta:** ${fechaLocal(r.hasta) || '?'}`);
  l.push(`- **Mensajes:** ${r.mensajesUsuario} tuyos, ${r.respuestas} respuestas, ${r.herramientas} herramientas`);
  l.push(`- **Archivo:** \`${clave}\``, '', '---', '');
  let enBloque = false;
  const cita = (t) => {
    l.push(`> ${t}  `);
    enBloque = true;
  };
  const parrafo = (encabezado, ev) => {
    if (enBloque) l.push('');
    enBloque = false;
    l.push(encabezado, '', ev.texto + (ev.truncado ? '\n\n[…recortado…]' : ''), '');
  };
  for (const ev of eventos) {
    if (ev.tipo === 'usuario') parrafo(`### ${nombreUsuario} · ${fechaLocal(ev.ts)}`, ev);
    else if (ev.tipo === 'claude') parrafo(`**Claude** · ${fechaLocal(ev.ts)}`, ev);
    else if (ev.tipo === 'herramienta') cita(`🔧 **${ev.nombre}** ${ev.resumen}`.trim());
    else if (ev.tipo === 'comando') cita(`⌨️ \`${ev.texto}\``);
    else if (ev.tipo === 'compactacion') cita('📦 Conversación compactada');
    else if (ev.tipo === 'interrupcion') cita('⏹️ Interrumpido');
    else if (ev.tipo === 'imagen') cita('🖼️ Imagen adjunta');
  }
  return l.join('\n') + '\n';
}
