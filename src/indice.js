// Índice de las conversaciones archivadas: título, carpeta, fechas, conteos y una copia en Markdown legible.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fuenteApp } from './config.js';
import { analizar, aMarkdown, tituloDe, fechaLocal } from './parser.js';
import { cargarManifiesto, escribirAtomico, leerJson, rutaEnDestino } from './archivos.js';

// Si cambia lo que extrae el parser, subir este número fuerza a reindexar todo.
const VERSION_INDICE = 1;

export const rutaIndice = (dest) => path.join(dest, '_estado', 'indice.json');

// Una conversación es un .jsonl en la raíz de la fuente o dentro de la carpeta de un proyecto.
// Lo que está más adentro (subagents/, workflows/) pertenece a la sesión de la carpeta que lo contiene.
export function clasificarRuta(rel, fuentes) {
  for (const f of fuentes) {
    if (!f.conversaciones || !rel.startsWith(f.destino + '/')) continue;
    const partes = rel.slice(f.destino.length + 1).split('/');
    const nombre = partes[partes.length - 1];
    if (!/\.jsonl($|\.)/.test(nombre)) return null;
    if (partes.length <= 2) return { tipo: 'conversacion', fuente: f, proyecto: partes.length === 2 ? partes[0] : '' };
    if (partes.length >= 3 && partes[1] !== 'memory') {
      return { tipo: 'auxiliar', fuente: f, sesion: `${f.destino}/${partes[0]}/${partes[1]}` };
    }
    return null;
  }
  return null;
}

// La clave de la sesión dueña de los subagentes: ".../<proyecto>/<id>" (sin .jsonl).
export const carpetaDeSesion = (clave) => clave.replace(/\.jsonl$/, '');

export async function leerTitulosApp(archivos) {
  const titulos = new Map();
  for (const a of archivos) {
    const j = await leerJson(a, null);
    if (!j) continue;
    const dato = { titulo: j.title || null, archivada: Boolean(j.isArchived), cwd: j.cwd || null, creada: j.createdAt || null };
    if (j.cliSessionId) titulos.set(j.cliSessionId, dato);
    if (typeof j.sessionId === 'string') titulos.set(j.sessionId.replace(/^local_/, ''), dato);
  }
  return titulos;
}

const nombreTexto = (clave, r) => {
  const base = path.posix.basename(clave).replace(/\.jsonl.*$/, '').replace(/[^\w.-]+/g, '_');
  const carpeta = path.posix.dirname(clave).split('/').slice(0, 2).join('/'); // ej. claude/projects
  return `texto/${carpeta}/${fechaLocal(r.desde, false) || 'sin-fecha'}_${base}.md`;
};

export async function actualizarIndice(dest, config, { cache = new Map(), onProgreso = () => {} } = {}) {
  const manifiesto = await cargarManifiesto(dest);
  const anterior = await leerJson(rutaIndice(dest), null);
  const previas = anterior?.version === VERSION_INDICE ? anterior.conversaciones : {};
  const conversaciones = {};

  const app = fuenteApp(config);
  const archivosApp = Object.keys(manifiesto.archivos)
    .filter((rel) => app && rel.startsWith(app.destino + '/') && /\/local_[^/]+\.json$/.test(rel))
    .map((rel) => rutaEnDestino(dest, rel));
  const titulosApp = await leerTitulosApp(archivosApp);

  const subagentes = new Map();
  const candidatas = [];
  for (const rel of Object.keys(manifiesto.archivos)) {
    const c = clasificarRuta(rel, config.fuentes);
    if (!c) continue;
    if (c.tipo === 'conversacion') candidatas.push({ rel, ...c });
    else if (/\/agent-[^/]+\.jsonl$/.test(rel)) subagentes.set(c.sesion, (subagentes.get(c.sesion) ?? 0) + 1);
  }

  let analizadas = 0;
  for (let i = 0; i < candidatas.length; i++) {
    const { rel, fuente, proyecto } = candidatas[i];
    const abs = rutaEnDestino(dest, rel);
    let st;
    try {
      st = await fsp.stat(abs);
    } catch {
      continue;
    }
    let e = previas[rel];
    if (!e || e.tamano !== st.size) {
      onProgreso({ fase: 'indexando', destino: dest, archivo: rel, hechos: i, total: candidatas.length });
      const llave = `${rel}|${st.size}`;
      let res = cache.get(llave);
      if (!res) {
        res = await analizar(abs);
        cache.set(llave, res);
      }
      const r = res.resumen;
      const texto = nombreTexto(rel, r);
      const md = aMarkdown({ titulo: tituloDe(r, titulosApp.get(r.id)?.titulo).titulo, clave: rel, resumen: r, eventos: res.eventos, nombreUsuario: config.nombreUsuario });
      await escribirAtomico(rutaEnDestino(dest, texto), md);
      analizadas++;
      e = {
        clave: rel, fuente: fuente.nombre, recuperada: fuente.recuperada, proyecto,
        id: r.id, cwd: r.cwd, rama: r.rama, entrada: r.entrada, version: r.version,
        tituloPropio: r.tituloPropio, tituloIA: r.tituloIA, resumen: r.resumen,
        primerPrompt: r.primerPrompt, ultimoPrompt: r.ultimoPrompt, desde: r.desde, hasta: r.hasta,
        mensajesUsuario: r.mensajesUsuario, respuestas: r.respuestas, herramientas: r.herramientas,
        imagenes: r.imagenes, compactaciones: r.compactaciones, modelos: r.modelos,
        lineasDanadas: r.lineasDanadas, vacia: r.vacia, tamano: st.size, texto,
      };
    }
    const app = titulosApp.get(e.id);
    const t = tituloDe(e, app?.titulo);
    conversaciones[rel] = {
      ...e,
      titulo: t.titulo,
      tituloOrigen: t.origen,
      archivadaEnApp: app?.archivada ?? false,
      subagentes: subagentes.get(carpetaDeSesion(rel)) ?? 0,
      eliminadaEnOrigen: manifiesto.archivos[rel]?.eliminadoEnOrigen ?? null,
      sincronizada: manifiesto.archivos[rel]?.sincronizado ?? null,
    };
  }

  await escribirAtomico(rutaIndice(dest), JSON.stringify({ version: VERSION_INDICE, generado: new Date().toISOString(), conversaciones }));
  await escribirAtomico(path.join(dest, 'texto', 'INDICE.md'), indiceMarkdown(conversaciones));
  return { total: Object.keys(conversaciones).length, analizadas };
}

function indiceMarkdown(conversaciones) {
  const filas = Object.values(conversaciones)
    .filter((c) => !c.vacia)
    .sort((a, b) => (b.hasta ?? '').localeCompare(a.hasta ?? ''));
  const celda = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ');
  const l = [
    '# Índice de conversaciones',
    '',
    `Generado el ${fechaLocal(new Date().toISOString())}. ${filas.length} conversaciones (sin contar las vacías).`,
    '',
    '| Última actividad | Título | Carpeta | Tus mensajes | Estado | Texto |',
    '|---|---|---|---|---|---|',
  ];
  for (const c of filas) {
    const estado = c.recuperada ? 'Recuperada' : c.eliminadaEnOrigen ? 'Borrada en Claude' : 'En Claude';
    const enlace = c.texto.replace(/^texto\//, '');
    l.push(`| ${fechaLocal(c.hasta)} | ${celda(c.titulo)} | ${celda(c.cwd)} | ${c.mensajesUsuario} | ${estado} | [abrir](${encodeURI(enlace)}) |`);
  }
  return l.join('\n') + '\n';
}
