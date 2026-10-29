// Historial de los archivos que tocó Claude: en qué conversaciones aparece cada uno y qué versiones se pueden recuperar.
//  - Checkpoint: la copia que guarda Claude Code al empezar un mensaje, antes de editar (exacta).
//  - Escrito: el contenido completo que Claude escribió con Write (exacto).
//  - Editado: el resultado de aplicar cada Edit sobre la versión anterior (reconstruido: si el archivo cambió por
//    otro lado entre medio, puede no coincidir con lo que hubo en el disco).
// Solo lee: nunca escribe en las rutas originales.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { leerLineas, claveArchivo } from './parser.js';
import { rutaEnDestino } from './archivos.js';
import { carpetaDeSesion } from './indice.js';

const MAX_TEXTO = 5 * 1024 * 1024;
const HERRAMIENTAS = { Write: 'escrito', Edit: 'editado', MultiEdit: 'editado' };

function sumar(total, a) {
  total.leido += a.leido;
  total.escrito += a.escrito;
  total.editado += a.editado;
  total.checkpoint ||= a.checkpoint;
  if ((a.ultima ?? '') > (total.ultima ?? '')) {
    total.ultima = a.ultima;
    total.ruta = a.ruta;
  }
}

const vacio = (ruta) => ({ ruta, leido: 0, escrito: 0, editado: 0, checkpoint: false, ultima: null });

// Todos los archivos del índice, con las conversaciones (y sus subagentes) que los tocaron.
export function indiceDeArchivos(conversaciones, auxiliares = {}) {
  const porSesion = new Map();
  for (const [rel, a] of Object.entries(auxiliares)) {
    if (!porSesion.has(a.sesion)) porSesion.set(a.sesion, []);
    porSesion.get(a.sesion).push({ rel, archivos: a.archivos ?? [] });
  }
  const archivos = new Map();
  for (const c of Object.values(conversaciones)) {
    const propios = new Map();
    for (const f of [{ rel: c.clave, archivos: c.archivos ?? [] }, ...(porSesion.get(carpetaDeSesion(c.clave)) ?? [])]) {
      for (const a of f.archivos) {
        const k = claveArchivo(a.ruta);
        let p = propios.get(k);
        if (!p) propios.set(k, (p = { ...vacio(a.ruta), rels: [] }));
        sumar(p, a);
        if (!p.rels.includes(f.rel)) p.rels.push(f.rel);
      }
    }
    for (const [k, p] of propios) {
      let g = archivos.get(k);
      if (!g) archivos.set(k, (g = { clave: k, ...vacio(p.ruta), conversaciones: [] }));
      sumar(g, p);
      g.conversaciones.push({ clave: c.clave, id: c.id, titulo: c.titulo, leido: p.leido, escrito: p.escrito, editado: p.editado, ultima: p.ultima, rels: p.rels });
    }
  }
  for (const g of archivos.values()) g.conversaciones.sort((a, b) => (b.ultima ?? '').localeCompare(a.ultima ?? ''));
  return archivos;
}

// Lee un archivo como texto, si no es enorme ni binario.
async function leerTexto(abs) {
  try {
    const st = await fsp.stat(abs);
    if (!st.isFile() || st.size > MAX_TEXTO) return null;
    const buf = await fsp.readFile(abs);
    if (buf.subarray(0, 8000).includes(0)) return null;
    return buf.toString('utf8');
  } catch {
    return null;
  }
}

// Aplica los reemplazos de un Edit. Devuelve null si alguno no se encuentra (no se puede reconstruir).
export function aplicarCambios(texto, cambios) {
  let t = texto;
  for (const c of cambios) {
    const viejo = c?.old_string;
    const nuevo = c?.new_string;
    if (typeof viejo !== 'string' || typeof nuevo !== 'string') return null;
    if (viejo === '') {
      if (t !== '') return null;
      t = nuevo;
      continue;
    }
    // Claude escribe con \n aunque el archivo use \r\n: Claude Code respeta el final de línea del archivo.
    const variantes = [[viejo, nuevo]];
    if (t.includes('\r\n') && !viejo.includes('\r\n')) variantes.push([viejo.replace(/\n/g, '\r\n'), nuevo.replace(/\n/g, '\r\n')]);
    const v = variantes.find(([a]) => t.includes(a));
    if (!v) return null;
    t = c.replace_all ? t.split(v[0]).join(v[1]) : t.replace(v[0], () => v[1]);
  }
  return t;
}

// Lo que pasó con un archivo en un transcript: checkpoints y escrituras (sin las que dieron error).
async function eventosDe(abs, clave) {
  const tsMensaje = new Map();
  const conError = new Set();
  const checkpoints = new Map();
  const usos = [];
  for await (const { linea } of leerLineas(abs)) {
    let o;
    try {
      o = JSON.parse(linea);
    } catch {
      continue;
    }
    if (o?.type === 'user') {
      if (o.uuid && o.timestamp) tsMensaje.set(o.uuid, o.timestamp);
      const cont = o.message?.content;
      if (Array.isArray(cont)) for (const b of cont) if (b?.type === 'tool_result' && b.is_error) conError.add(b.tool_use_id);
    } else if (o?.type === 'file-history-snapshot') {
      const s = o.snapshot ?? {};
      for (const [ruta, b] of Object.entries(s.trackedFileBackups ?? {})) {
        if (!b?.backupFileName || checkpoints.has(b.backupFileName) || claveArchivo(ruta) !== clave) continue;
        checkpoints.set(b.backupFileName, {
          tipo: 'checkpoint',
          mensaje: s.messageId ?? o.messageId,
          tsRespaldo: [s.timestamp, b.backupTime].filter(Boolean).sort()[0] ?? null,
          archivoCheckpoint: b.backupFileName,
        });
      }
    } else if (o?.type === 'assistant' && Array.isArray(o.message?.content)) {
      for (const b of o.message.content) {
        if (b?.type !== 'tool_use' || !HERRAMIENTAS[b.name] || claveArchivo(b.input?.file_path) !== clave) continue;
        usos.push({ tipo: HERRAMIENTAS[b.name], ts: o.timestamp ?? null, id: b.id, entrada: b.input });
      }
    }
  }
  // El checkpoint es el estado al empezar el mensaje del usuario: va antes de las ediciones de ese mensaje.
  return [
    ...[...checkpoints.values()].map((c) => ({ ...c, ts: tsMensaje.get(c.mensaje) ?? c.tsRespaldo })),
    ...usos.filter((u) => !conError.has(u.id)),
  ];
}

const orden = (e) => (e.tipo === 'checkpoint' ? 0 : 1);

// carpetasCheckpoints: dónde buscar <sesión>/<archivo>@vN (el archivo primero, después Claude).
export async function lineaDeTiempo(archivo, { dest, carpetasCheckpoints = [] }) {
  const eventos = [];
  for (const conv of archivo.conversaciones) {
    for (const rel of conv.rels) {
      let lista;
      try {
        lista = await eventosDe(rutaEnDestino(dest, rel), archivo.clave);
      } catch {
        continue;
      }
      for (const e of lista) eventos.push({ ...e, conversacion: conv.clave, sesion: conv.id, subagente: rel !== conv.clave });
    }
  }
  eventos.sort((a, b) => (a.ts ?? '').localeCompare(b.ts ?? '') || orden(a) - orden(b));

  const versiones = [];
  let actual = null;
  for (const e of eventos) {
    let texto = null;
    let exacta = false;
    let coincide = null;
    if (e.tipo === 'checkpoint') {
      for (const c of carpetasCheckpoints) {
        if (!e.sesion) break;
        texto = await leerTexto(path.join(c, e.sesion, e.archivoCheckpoint));
        if (texto != null) break;
      }
      if (texto == null) continue; // el checkpoint no se copió o es binario
      exacta = true;
      if (actual != null) coincide = actual === texto;
      actual = texto;
    } else if (e.tipo === 'escrito') {
      texto = typeof e.entrada?.content === 'string' ? e.entrada.content : null;
      exacta = texto != null;
      actual = texto;
    } else {
      texto = actual == null ? null : aplicarCambios(actual, Array.isArray(e.entrada?.edits) ? e.entrada.edits : [e.entrada]);
      actual = texto;
    }
    versiones.push({ n: versiones.length, tipo: e.tipo, ts: e.ts, conversacion: e.conversacion, subagente: e.subagente, exacta, coincide, texto });
  }

  let enDisco = null;
  try {
    const st = await fsp.stat(archivo.ruta);
    if (st.isFile()) {
      const texto = await leerTexto(archivo.ruta);
      const ultima = [...versiones].reverse().find((v) => v.texto != null);
      enDisco = { ts: st.mtime.toISOString(), tamano: st.size, texto, coincide: texto != null && ultima ? texto === ultima.texto : null };
    }
  } catch {}
  return { versiones, enDisco };
}
