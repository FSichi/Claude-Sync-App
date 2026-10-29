// Servidor local de la app. Solo escucha en 127.0.0.1 y exige un token por sesión en cada llamada a la API.
//   node src/servidor.js           -> servidor para desarrollo (muestra la URL)
//   node src/servidor.js --abrir   -> abre la ventana de la app y se cierra solo cuando cerrás la ventana
//   Opcional: --config <ruta a otro config.json>
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { RAIZ_APP, CARPETA_DATOS, VERSION, cargarConfig, rutaConfig, fuenteViva, fuenteApp, fuenteDeLaApp, fuenteDeLaConfiguracion } from './config.js';
import { sincronizar, sincronizando, listarFuente } from './sincronizar.js';
import { cargarManifiesto, estadoDestino, leerJson, rutaEnDestino } from './archivos.js';
import { rutaIndice, clasificarRuta, leerTitulosApp, carpetaDeSesion } from './indice.js';
import { analizar, aMarkdown, tituloDe, leerLineaEn, imagenesDeLinea, sinBase64, fechaLocal, claveArchivo } from './parser.js';
import { indiceDeArchivos, lineaDeTiempo } from './historial.js';
import { comprobar, reparar, comprobando, rutaComprobacion } from './comprobar.js';
import {
  validarDestinoNuevo, guardarConfig, leerDestinosCrudos, sugerirDestinos, listarCarpetas, crearAccesoDirecto, etiquetaDestino, esDriveEnStreaming,
} from './destinos.js';
import { buscarActualizacion, actualizar, estadoActualizacion, estaInstalada, URL_RELEASES } from './actualizaciones.js';
import { parseChangelog } from './changelog.js';

const MODO_APP = process.argv.includes('--abrir');
const TOKEN = crypto.randomBytes(18).toString('hex');
const CARPETA_LOCAL = CARPETA_DATOS;
const ARCHIVO_LOG = path.join(CARPETA_LOCAL, 'servidor.log');
const ESPERA_SIN_VENTANA = 3 * 60 * 1000;
fs.mkdirSync(CARPETA_LOCAL, { recursive: true });

function log(...partes) {
  const texto = partes.map((p) => (p instanceof Error ? p.stack : typeof p === 'string' ? p : JSON.stringify(p))).join(' ');
  const linea = `[${new Date().toISOString()}] ${texto}\n`;
  try {
    fs.appendFileSync(ARCHIVO_LOG, linea);
  } catch {}
  if (!MODO_APP) process.stdout.write(linea);
}

const iConfig = process.argv.indexOf('--config');
const RUTA_CONFIG = rutaConfig(iConfig > 0 ? process.argv[iConfig + 1] : undefined);
let config = cargarConfig(RUTA_CONFIG);
const URL_APP = `http://127.0.0.1:${config.puerto}/`;
const estado = { progreso: null, ultimo: null, error: null, comprobacion: null, errorComprobacion: null };
let ultimoLatido = Date.now();

class ErrorHttp extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.codigo = codigo;
  }
}

const existe = (p) => fsp.access(p).then(() => true, () => false);

function memo(ms, fn) {
  let valor;
  let hasta = 0;
  let enCurso = null;
  const f = () => {
    if (Date.now() < hasta) return Promise.resolve(valor);
    if (!enCurso) {
      enCurso = fn()
        .then((v) => {
          valor = v;
          hasta = Date.now() + ms;
          return v;
        })
        .finally(() => {
          enCurso = null;
        });
    }
    return enCurso;
  };
  f.invalidar = () => {
    hasta = 0;
  };
  return f;
}

// ---------- Archivo y destinos ----------

async function ultimaLineaJson(ruta) {
  try {
    const fh = await fsp.open(ruta, 'r');
    try {
      const { size } = await fh.stat();
      const largo = Math.min(size, 64 * 1024);
      const buf = Buffer.alloc(largo);
      await fh.read(buf, 0, largo, size - largo);
      const lineas = buf.toString('utf8').trim().split('\n');
      return JSON.parse(lineas[lineas.length - 1]);
    } finally {
      await fh.close();
    }
  } catch {
    return null;
  }
}

async function destinoPrincipal() {
  for (const d of config.destinos) {
    if ((await estadoDestino(d)).disponible && (await existe(path.join(d, '_estado', 'manifiesto.json')))) return d;
  }
  return null;
}

async function infoDestinos() {
  return Promise.all(
    config.destinos.map(async (ruta) => {
      const e = await estadoDestino(ruta);
      const ultima = e.disponible ? await ultimaLineaJson(path.join(ruta, '_estado', 'registro.jsonl')) : null;
      const c = e.disponible ? await leerJson(rutaComprobacion(ruta), null) : null;
      return {
        ruta,
        etiqueta: etiquetaDestino(ruta),
        streaming: esDriveEnStreaming(ruta),
        existe: e.disponible && (await existe(ruta)),
        disponible: e.disponible,
        motivo: e.motivo ?? null,
        ultimaSync: ultima?.fin ?? null,
        conversaciones: ultima?.conversaciones ?? null,
        erroresUltima: ultima?.errores?.length ?? 0,
        comprobacion: c && {
          fecha: c.fecha, fondo: c.fondo, archivos: c.archivos, bytes: c.bytes, reparado: c.reparado ?? null,
          problemas: c.totalProblemas ?? c.problemas.length,
          alSincronizar: c.problemas.filter((p) => p.alSincronizar).length,
        },
      };
    }),
  );
}

let cacheIndice = { ruta: null, mtimeMs: 0, datos: null };
async function indice() {
  const dest = await destinoPrincipal();
  if (!dest) return { dest: null, conversaciones: {}, auxiliares: {} };
  const ruta = rutaIndice(dest);
  const st = await fsp.stat(ruta).catch(() => null);
  if (!st) return { dest, conversaciones: {}, auxiliares: {} };
  if (cacheIndice.ruta !== ruta || cacheIndice.mtimeMs !== st.mtimeMs) {
    cacheIndice = { ruta, mtimeMs: st.mtimeMs, datos: await leerJson(ruta, { conversaciones: {} }) };
  }
  return { dest, conversaciones: cacheIndice.datos.conversaciones ?? {}, auxiliares: cacheIndice.datos.auxiliares ?? {}, version: cacheIndice.datos.version ?? 1 };
}

// Lo que cambió en el origen desde la última sincronización del destino principal.
const pendientes = memo(20000, async () => {
  const dest = await destinoPrincipal();
  const manifiesto = dest ? await cargarManifiesto(dest) : { archivos: {} };
  const r = { archivos: 0, bytes: 0, conversaciones: new Map() };
  for (const f of config.fuentes) {
    const { archivos } = await listarFuente(f, config.destinos);
    for (const a of archivos) {
      const m = manifiesto.archivos[a.rel];
      if (m && m.size === a.size && m.mtimeMs === a.mtimeMs) continue;
      r.archivos++;
      r.bytes += m && a.size > m.size ? a.size - m.size : a.size;
      const c = clasificarRuta(a.rel, config.fuentes);
      if (c?.tipo === 'conversacion') r.conversaciones.set(a.rel, { size: a.size, mtimeMs: a.mtimeMs, proyecto: c.proyecto, fuente: f });
    }
  }
  return r;
});

const titulosVivos = memo(30000, async () => {
  const f = fuenteApp(config);
  if (!f) return new Map();
  const { archivos } = await listarFuente(f);
  return leerTitulosApp(archivos.filter((a) => /local_[^\\/]+\.json$/.test(a.abs)).map((a) => a.abs));
});

async function infoLimpieza() {
  const ajustes = await leerJson(path.join(os.homedir(), '.claude', 'settings.json'), {});
  return { dias: ajustes.cleanupPeriodDays ?? 30, configurado: ajustes.cleanupPeriodDays != null };
}

// Claude Code borra las sesiones de ~/.claude/projects que pasan cleanupPeriodDays sin cambios.
// Solo corren riesgo las que tienen algo sin respaldar: lo ya copiado queda en el archivo.
const DIA = 86400000;
const PRONTO = 7 * DIA;
function venceEn(p, dias) {
  const viva = fuenteViva(config);
  return viva && p.fuente.origen === viva.origen ? p.mtimeMs + dias * DIA : null;
}
async function riesgo(pend) {
  if (!pend) return null;
  const { dias } = await infoLimpieza();
  let pronto = 0;
  let proximo = null;
  for (const p of pend.conversaciones.values()) {
    const vence = venceEn(p, dias);
    if (vence == null) continue;
    if (vence - Date.now() < PRONTO) pronto++;
    if (proximo == null || vence < proximo) proximo = vence;
  }
  return { dias, pronto, proximo: proximo == null ? null : new Date(proximo).toISOString() };
}

// ---------- Conversaciones ----------

function validarClave(clave) {
  if (typeof clave !== 'string' || !clave || clave.length > 1000 || /[\\:]/.test(clave) || clave.split('/').some((p) => !p || p === '..' || p === '.')) {
    throw new ErrorHttp(400, 'Clave inválida.');
  }
  return clave;
}

function rutaViva(clave) {
  for (const f of config.fuentes) {
    if (clave.startsWith(f.destino + '/')) return path.join(f.origen, ...clave.slice(f.destino.length + 1).split('/'));
  }
  return null;
}

async function resolver(clave) {
  validarClave(clave);
  for (const d of config.destinos) {
    const p = rutaEnDestino(d, clave);
    if (await existe(p)) return { abs: p, enArchivo: true };
  }
  const viva = rutaViva(clave);
  if (viva && (await existe(viva))) return { abs: viva, enArchivo: false };
  throw new ErrorHttp(404, 'No se encontró la conversación ni en el archivo ni en Claude.');
}

const cacheAnalisis = new Map();
async function analizarConCache(abs) {
  const st = await fsp.stat(abs);
  const k = `${abs}|${st.size}|${st.mtimeMs}`;
  let p = cacheAnalisis.get(k);
  if (p) cacheAnalisis.delete(k);
  else p = analizar(abs);
  cacheAnalisis.set(k, p);
  while (cacheAnalisis.size > 3) cacheAnalisis.delete(cacheAnalisis.keys().next().value);
  try {
    return await p;
  } catch (e) {
    cacheAnalisis.delete(k);
    throw e;
  }
}

const codificarCarpeta = (ruta) => ruta.replace(/[^A-Za-z0-9]/g, '-');

// Adónde iría la conversación si se restaura en ~/.claude/projects.
function destinoRestauracion(clave, info) {
  const viva = fuenteViva(config);
  if (!viva || !info.id) return null;
  let carpeta = null;
  if (clave.startsWith(viva.destino + '/')) carpeta = clave.slice(viva.destino.length + 1).split('/')[0];
  if (!carpeta && info.cwd && codificarCarpeta(info.cwd).length <= 200) carpeta = codificarCarpeta(info.cwd);
  if (!carpeta && info.proyecto) carpeta = info.proyecto;
  if (!carpeta) return null;
  return { carpeta: path.join(viva.origen, carpeta), jsonl: path.join(viva.origen, carpeta, `${info.id}.jsonl`) };
}

async function infoConversacion(clave, abs) {
  const { conversaciones } = await indice();
  let info = conversaciones[clave];
  if (!info) {
    const { resumen } = await analizarConCache(abs);
    const t = tituloDe(resumen, (await titulosVivos()).get(resumen.id)?.titulo);
    info = { ...resumen, clave, titulo: t.titulo, tituloOrigen: t.origen, recuperada: false };
  }
  const fuente = config.fuentes.find((f) => clave.startsWith(f.destino + '/'));
  const viva = fuente && !fuente.recuperada ? rutaViva(clave) : null;
  const restauracion = destinoRestauracion(clave, info);
  const enClaude = (viva && (await existe(viva))) || (restauracion ? await existe(restauracion.jsonl) : false);
  const { archivos, uso, ...resto } = info;
  const tocados = await archivosDeConversacion(clave).catch(() => []);
  return {
    ...resto,
    archivosTocados: tocados.length,
    archivosCambiados: tocados.filter((a) => a.editado || a.escrito).length,
    enClaude,
    comandoRetomar: info.id && info.cwd ? `cd "${info.cwd}"\nclaude --resume ${info.id}` : null,
  };
}

async function listaConversaciones() {
  const { dest, conversaciones } = await indice();
  const pend = sincronizando() ? { conversaciones: new Map() } : await pendientes();
  const titulos = await titulosVivos();
  const { dias } = await infoLimpieza();
  const vence = (clave) => {
    const p = pend.conversaciones.get(clave);
    const t = p ? venceEn(p, dias) : null;
    return t == null ? null : new Date(t).toISOString();
  };
  const lista = [];
  for (const c of Object.values(conversaciones)) {
    const { primerPrompt, ultimoPrompt, tituloPropio, tituloIA, resumen, archivos, uso, ...resto } = c;
    const cambiados = (archivos ?? []).filter((a) => a.editado || a.escrito).length;
    // Respuestas de Claude por día, para el gráfico de actividad del inicio.
    const actividad = {};
    for (const u of uso ?? []) actividad[u.dia] = (actividad[u.dia] ?? 0) + u.respuestas;
    lista.push({ ...resto, primerPrompt: primerPrompt?.slice(0, 200) ?? null, pendiente: pend.conversaciones.has(c.clave), vence: vence(c.clave), archivosCambiados: cambiados, actividad: uso ? actividad : null });
  }
  for (const [clave, p] of pend.conversaciones) {
    if (conversaciones[clave]) continue;
    const id = path.posix.basename(clave).match(/[0-9a-f-]{36}/i)?.[0] ?? null;
    const app = id ? titulos.get(id) : null;
    lista.push({
      clave, id, proyecto: p.proyecto, cwd: app?.cwd ?? null, recuperada: p.fuente.recuperada,
      titulo: app?.titulo ?? 'Sin respaldar todavía', tituloOrigen: app?.titulo ? 'app' : 'ninguno',
      hasta: new Date(p.mtimeMs).toISOString(), tamano: p.size, pendiente: true, soloEnClaude: true, vacia: false, vence: vence(clave),
    });
  }
  return { destino: dest, conversaciones: lista };
}

// ---------- Archivos que tocó Claude ----------

let cacheArchivos = { datos: null, mapa: new Map() };
async function mapaDeArchivos() {
  const ind = await indice();
  if (!ind.dest) return { ...ind, mapa: new Map() };
  if (cacheArchivos.datos !== cacheIndice.datos) cacheArchivos = { datos: cacheIndice.datos, mapa: indiceDeArchivos(ind.conversaciones, ind.auxiliares) };
  return { ...ind, mapa: cacheArchivos.mapa };
}

const resumenArchivo = (a) => ({ clave: a.clave, ruta: a.ruta, leido: a.leido, escrito: a.escrito, editado: a.editado, checkpoint: a.checkpoint, ultima: a.ultima, conversaciones: a.conversaciones.length });
const normalizarRuta = (s) => normalizar(s).replace(/\\/g, '/');

const MAX_LISTA_ARCHIVOS = 300;

// modo: 'cambiados' (los que Claude escribió o editó), 'faltan' (cambiados que ya no están en tu PC) o 'todos'.
async function listaArchivos(consulta, modo = 'cambiados') {
  const { mapa, version, conversaciones } = await mapaDeArchivos();
  const q = normalizarRuta((consulta ?? '').trim());
  let salida = [];
  for (const a of mapa.values()) {
    if (modo !== 'todos' && !a.editado && !a.escrito && !a.checkpoint) continue;
    if (q && !normalizarRuta(a.ruta).includes(q)) continue;
    salida.push(resumenArchivo(a));
  }
  salida.sort((x, y) => (y.ultima ?? '').localeCompare(x.ultima ?? ''));
  const conExiste = async (lista) => Promise.all(lista.map(async (a) => ({ ...a, existe: await existe(a.ruta) })));
  if (modo === 'faltan') salida = (await conExiste(salida)).filter((a) => !a.existe);
  const total = salida.length;
  const archivos = modo === 'faltan' ? salida.slice(0, MAX_LISTA_ARCHIVOS) : await conExiste(salida.slice(0, MAX_LISTA_ARCHIVOS));
  // Con un índice de una versión anterior todavía no hay datos de archivos: se arman en la próxima sincronización.
  const faltaIndice = version < 2 && Object.keys(conversaciones).length > 0;
  return { total, archivos, faltaIndice };
}

async function archivosDeConversacion(clave) {
  validarClave(clave);
  const { mapa } = await mapaDeArchivos();
  const salida = [];
  for (const a of mapa.values()) {
    const c = a.conversaciones.find((x) => x.clave === clave);
    if (c) salida.push({ ...resumenArchivo(a), leido: c.leido, escrito: c.escrito, editado: c.editado, ultima: c.ultima });
  }
  return salida.sort((x, y) => y.editado + y.escrito - (x.editado + x.escrito) || (y.ultima ?? '').localeCompare(x.ultima ?? ''));
}

function carpetasDeCheckpoints(dest) {
  const f = config.fuentes.find((x) => path.basename(x.origen).toLowerCase() === 'file-history');
  return f ? [rutaEnDestino(dest, f.destino), f.origen] : [];
}

const cacheHistorial = new Map();
async function historialDe(clave) {
  const { dest, mapa } = await mapaDeArchivos();
  const archivo = typeof clave === 'string' ? mapa.get(claveArchivo(clave)) : null;
  if (!archivo) throw new ErrorHttp(404, 'Ese archivo no aparece en ninguna conversación archivada.');
  const k = `${archivo.clave}|${cacheIndice.mtimeMs}`;
  let p = cacheHistorial.get(k);
  if (!p) {
    p = lineaDeTiempo(archivo, { dest, carpetasCheckpoints: carpetasDeCheckpoints(dest) });
    p.catch(() => cacheHistorial.delete(k));
    cacheHistorial.set(k, p);
    while (cacheHistorial.size > 4) cacheHistorial.delete(cacheHistorial.keys().next().value);
  }
  return { archivo, ...(await p) };
}

async function versionDe(clave, n) {
  const h = await historialDe(clave);
  const v = n === 'disco' ? h.enDisco : h.versiones[Number(n)];
  if (!v || v.texto == null) throw new ErrorHttp(404, 'Esa versión no se puede mostrar.');
  return { archivo: h.archivo, version: v };
}

// ---------- Comprobar copias ----------

const fuentesConApp = () => [...config.fuentes, fuenteDeLaApp(), fuenteDeLaConfiguracion(config)];

function iniciarComprobacion({ destinos, fondo }) {
  if (sincronizando()) throw new ErrorHttp(409, 'Esperá a que termine la sincronización.');
  if (comprobando()) throw new ErrorHttp(409, 'Ya hay una comprobación en curso.');
  config = cargarConfig(RUTA_CONFIG);
  const indices = Array.isArray(destinos) && destinos.length ? destinos : config.destinos.map((_, i) => i);
  const lista = indices.map((i) => config.destinos[i]).filter(Boolean).map((ruta) => ({ ruta, fondo: Boolean(fondo) }));
  if (!lista.length) throw new ErrorHttp(400, 'No hay destinos para comprobar.');
  estado.errorComprobacion = null;
  estado.comprobacion = { fase: 'comprobando', destino: lista[0].ruta, fondo: Boolean(fondo), hechos: 0, total: 0 };
  comprobar(lista, fuentesConApp(), { onProgreso: (p) => (estado.comprobacion = p) })
    .then((r) => log('Comprobación terminada', r.map((d) => ({ destino: d.destino, fondo: d.fondo, archivos: d.archivos, problemas: d.totalProblemas ?? 0 }))))
    .catch((e) => {
      estado.errorComprobacion = e.message;
      log(e);
    })
    .finally(() => (estado.comprobacion = null));
}

function iniciarReparacion(i) {
  if (sincronizando() || comprobando()) throw new ErrorHttp(409, 'Esperá a que termine lo que está en curso.');
  config = cargarConfig(RUTA_CONFIG);
  const dest = config.destinos[i];
  if (!dest) throw new ErrorHttp(400, 'Destino inválido.');
  estado.errorComprobacion = null;
  estado.comprobacion = { fase: 'reparando', destino: dest, hechos: 0, total: 0 };
  reparar(dest, config.destinos.filter((d) => d !== dest), fuentesConApp(), { onProgreso: (p) => (estado.comprobacion = p) })
    .then((r) => log('Reparación terminada', dest, r))
    .catch((e) => {
      estado.errorComprobacion = e.message;
      log(e);
    })
    .finally(() => (estado.comprobacion = null));
}

async function subagentes(clave) {
  validarClave(clave);
  const carpeta = carpetaDeSesion(clave);
  const bases = [...config.destinos.map((d) => rutaEnDestino(d, carpeta)), rutaViva(carpeta)].filter(Boolean);
  for (const base of bases) {
    if (!(await existe(base))) continue;
    const salida = [];
    for (const e of await fsp.readdir(base, { withFileTypes: true, recursive: true })) {
      if (!e.isFile() || !/^agent-.+\.jsonl$/.test(e.name)) continue;
      const abs = path.join(e.parentPath, e.name);
      const meta = await leerJson(abs.replace(/\.jsonl$/, '.meta.json'), {});
      const st = await fsp.stat(abs);
      const rel = path.relative(base, abs).split(path.sep).join('/');
      salida.push({ clave: `${carpeta}/${rel}`, descripcion: meta.description ?? null, tipo: meta.agentType ?? null, fase: meta.workflowPhase ?? null, tamano: st.size, fecha: st.mtime.toISOString() });
    }
    return salida.sort((a, b) => a.fecha.localeCompare(b.fecha));
  }
  return [];
}

// ---------- Búsqueda en los textos ----------

const normalizar = (s) =>
  s.toLowerCase().replace(/[áàäâã]/g, 'a').replace(/[éèëê]/g, 'e').replace(/[íìïî]/g, 'i').replace(/[óòöôõ]/g, 'o').replace(/[úùüû]/g, 'u');
const cacheTextos = new Map();

async function buscar(consulta) {
  const q = normalizar(consulta.trim());
  if (q.length < 2) return [];
  const terminos = q.startsWith('"') && q.endsWith('"') && q.length > 2 ? [q.slice(1, -1)] : q.split(/\s+/).filter(Boolean);
  const { dest, conversaciones } = await indice();
  if (!dest) return [];
  const resultados = [];
  for (const c of Object.values(conversaciones)) {
    if (c.vacia || !c.texto) continue;
    const ruta = rutaEnDestino(dest, c.texto);
    const st = await fsp.stat(ruta).catch(() => null);
    if (!st) continue;
    let t = cacheTextos.get(ruta);
    if (!t || t.mtimeMs !== st.mtimeMs) {
      t = { mtimeMs: st.mtimeMs, normal: normalizar(await fsp.readFile(ruta, 'utf8')) };
      cacheTextos.set(ruta, t);
    }
    if (!terminos.every((x) => t.normal.includes(x))) continue;
    const posiciones = [];
    let total = 0;
    for (let i = t.normal.indexOf(terminos[0]); i !== -1 && total < 999; i = t.normal.indexOf(terminos[0], i + 1)) {
      if (posiciones.length < 3 && (!posiciones.length || i - posiciones[posiciones.length - 1] > 200)) posiciones.push(i);
      total++;
    }
    resultados.push({ c, ruta, posiciones, total });
  }
  resultados.sort((a, b) => b.total - a.total);
  const salida = [];
  for (const r of resultados.slice(0, 100)) {
    const original = await fsp.readFile(r.ruta, 'utf8');
    salida.push({
      clave: r.c.clave,
      titulo: r.c.titulo,
      hasta: r.c.hasta,
      cwd: r.c.cwd,
      coincidencias: r.total,
      fragmentos: r.posiciones.map((i) => ({
        antes: original.slice(Math.max(0, i - 90), i).replace(/\s+/g, ' '),
        texto: original.slice(i, i + terminos[0].length),
        despues: original.slice(i + terminos[0].length, i + terminos[0].length + 140).replace(/\s+/g, ' '),
      })),
    });
  }
  return salida;
}

// ---------- Acciones ----------

async function restaurar(clave) {
  const { abs, enArchivo } = await resolver(clave);
  if (!enArchivo) throw new ErrorHttp(409, 'Esta conversación todavía no está en el archivo: sincronizá primero.');
  const info = await infoConversacion(clave, abs);
  const r = destinoRestauracion(clave, info);
  if (!r) throw new ErrorHttp(422, 'No se pudo determinar la carpeta del proyecto de esta conversación.');
  if (await existe(r.jsonl)) return { yaExistia: true, ruta: r.jsonl, comando: info.comandoRetomar };
  await fsp.mkdir(r.carpeta, { recursive: true });
  await fsp.copyFile(abs, r.jsonl, fs.constants.COPYFILE_EXCL); // nunca pisa nada
  // Subagentes y resultados de herramientas de la sesión, si los hay.
  const auxOrigen = abs.replace(/\.jsonl$/, '');
  let auxCopiados = 0;
  if (await existe(auxOrigen)) {
    for (const e of await fsp.readdir(auxOrigen, { withFileTypes: true, recursive: true })) {
      if (!e.isFile()) continue;
      const desde = path.join(e.parentPath, e.name);
      const hacia = path.join(r.carpeta, info.id, path.relative(auxOrigen, desde));
      if (await existe(hacia)) continue;
      await fsp.mkdir(path.dirname(hacia), { recursive: true });
      await fsp.copyFile(desde, hacia, fs.constants.COPYFILE_EXCL);
      auxCopiados++;
    }
  }
  log('Restaurada', clave, '->', r.jsonl);
  return { yaExistia: false, ruta: r.jsonl, auxCopiados, comando: info.comandoRetomar };
}

function abrirEnExplorador(ruta, seleccionar) {
  const arg = seleccionar ? `/select,"${ruta}"` : `"${ruta}"`;
  spawn('explorer.exe', [arg], { windowsVerbatimArguments: true, detached: true, stdio: 'ignore' }).unref();
}

// Tamaño aproximado de lo que hay que copiar a un destino nuevo.
async function tamanoArchivo() {
  const dest = await destinoPrincipal();
  if (!dest) return null;
  const { archivos } = await cargarManifiesto(dest);
  return Object.values(archivos).reduce((s, a) => s + (a.copiado ?? a.size ?? 0), 0);
}

async function cambiarDestinos({ accion, ruta, indice }) {
  if (sincronizando()) throw new ErrorHttp(409, 'Esperá a que termine la sincronización para cambiar los destinos.');
  config = cargarConfig(RUTA_CONFIG); // por si config.json se editó a mano
  const crudos = leerDestinosCrudos(config.archivo);
  let nuevos;
  if (accion === 'agregar') {
    const v = validarDestinoNuevo(ruta, config);
    if (v.error) throw new ErrorHttp(422, v.error);
    nuevos = [...crudos, v.crudo];
  } else {
    const i = Number(indice);
    if (!Number.isInteger(i) || i < 0 || i >= crudos.length) throw new ErrorHttp(400, 'Destino inválido.');
    if (accion === 'quitar') {
      if (crudos.length === 1) throw new ErrorHttp(422, 'Tiene que quedar al menos un destino.');
      nuevos = crudos.filter((_, j) => j !== i);
    } else if (accion === 'subir') {
      if (i === 0) return;
      nuevos = [...crudos];
      [nuevos[i - 1], nuevos[i]] = [nuevos[i], nuevos[i - 1]];
    } else {
      throw new ErrorHttp(400, 'Acción inválida.');
    }
  }
  await guardarConfig(config.archivo, { destinos: nuevos }, path.join(CARPETA_LOCAL, 'config-anteriores'));
  config = cargarConfig(RUTA_CONFIG);
  pendientes.invalidar();
  cacheIndice.mtimeMs = 0;
  log('Destinos cambiados', accion, config.destinos);
}

async function cambiarAjustes(datos) {
  const cambios = {};
  if (datos.nombreUsuario !== undefined) {
    const limpio = String(datos.nombreUsuario ?? '').replace(/\s+/g, ' ').trim();
    if (!limpio || limpio.length > 40) throw new ErrorHttp(422, 'Escribí un nombre de hasta 40 letras.');
    cambios.nombreUsuario = limpio;
  }
  if (datos.buscarActualizaciones !== undefined) cambios.buscarActualizaciones = Boolean(datos.buscarActualizaciones);
  if (datos.recordatorioDias !== undefined) {
    const n = Number(datos.recordatorioDias);
    if (!Number.isInteger(n) || n < 0 || n > 60) throw new ErrorHttp(422, 'Elegí entre 0 y 60 días.');
    cambios.recordatorioDias = n;
  }
  if (!Object.keys(cambios).length) throw new ErrorHttp(400, 'No hay nada para cambiar.');
  config = cargarConfig(RUTA_CONFIG);
  await guardarConfig(config.archivo, cambios, path.join(CARPETA_LOCAL, 'config-anteriores'));
  config = cargarConfig(RUTA_CONFIG);
}

async function novedades() {
  try {
    return parseChangelog(await fsp.readFile(path.join(RAIZ_APP, 'CHANGELOG.md'), 'utf8'));
  } catch {
    return [];
  }
}

function iniciarSincronizacion() {
  if (sincronizando()) throw new ErrorHttp(409, 'Ya hay una sincronización en curso.');
  if (comprobando()) throw new ErrorHttp(409, 'Esperá a que termine la comprobación de las copias.');
  config = cargarConfig(RUTA_CONFIG);
  if (!config.destinos.length) throw new ErrorHttp(409, 'Primero elegí dónde guardar las copias (Ajustes → Destinos).');
  estado.error = null;
  estado.progreso = { fase: 'listando' };
  sincronizar(config, { onProgreso: (p) => (estado.progreso = p) })
    .then((r) => {
      estado.ultimo = r;
      log('Sincronización terminada', r.destinos.map((d) => ({ destino: d.destino, nuevos: d.nuevos, agregados: d.agregados, reemplazados: d.reemplazados, errores: d.errores.length })));
      for (const d of r.destinos) for (const e of d.errores) log('Error de sincronización', e);
    })
    .catch((e) => {
      estado.error = e.message;
      log(e);
    })
    .finally(() => {
      estado.progreso = null;
      pendientes.invalidar();
      cacheIndice.mtimeMs = 0;
    });
}

// ---------- HTTP ----------

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};
const SEGURIDAD = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

function json(res, codigo, datos) {
  res.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SEGURIDAD });
  res.end(JSON.stringify(datos));
}

async function cuerpo(req) {
  let datos = '';
  for await (const parte of req) {
    datos += parte;
    if (datos.length > 64 * 1024) throw new ErrorHttp(413, 'Pedido demasiado grande.');
  }
  try {
    return datos ? JSON.parse(datos) : {};
  } catch {
    throw new ErrorHttp(400, 'JSON inválido.');
  }
}

// Sirve solo archivos de ui/ con extensiones conocidas, sin salir de esa carpeta.
const CARPETA_UI = path.join(RAIZ_APP, 'ui');
async function servirEstatico(res, rel) {
  const ruta = path.resolve(CARPETA_UI, rel);
  if (!ruta.startsWith(CARPETA_UI + path.sep) || !TIPOS[path.extname(ruta).toLowerCase()]) return json(res, 404, { error: 'No existe.' });
  let contenido;
  try {
    contenido = await fsp.readFile(ruta);
  } catch {
    return json(res, 404, { error: 'No existe.' });
  }
  if (rel === 'index.html') contenido = contenido.toString('utf8').replace('__TOKEN__', TOKEN);
  res.writeHead(200, { 'Content-Type': TIPOS[path.extname(ruta).toLowerCase()], 'Cache-Control': 'no-store', ...SEGURIDAD });
  res.end(contenido);
}

async function manejar(req, res) {
  const url = new URL(req.url, URL_APP);
  const host = req.headers.host ?? '';
  if (host !== `127.0.0.1:${config.puerto}` && host !== `localhost:${config.puerto}`) return json(res, 403, { error: 'Host no permitido.' });

  if (url.pathname === '/api/ping') return json(res, 200, { app: 'claude-archivo' });
  if (!url.pathname.startsWith('/api/')) {
    if (req.method !== 'GET') return json(res, 404, { error: 'No existe.' });
    let rel;
    try {
      rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    } catch {
      return json(res, 404, { error: 'No existe.' });
    }
    return servirEstatico(res, rel);
  }
  if (req.headers['x-token'] !== TOKEN && url.searchParams.get('t') !== TOKEN) return json(res, 403, { error: 'Token inválido.' });
  ultimoLatido = Date.now();

  const ruta = `${req.method} ${url.pathname}`;
  const q = (k) => url.searchParams.get(k);
  switch (ruta) {
    case 'POST /api/latido':
      return json(res, 200, { ok: true });

    case 'GET /api/estado': {
      // No hace esperar a la interfaz: si contar lo pendiente tarda, lo informa en la consulta siguiente.
      const pend = sincronizando() ? null : await Promise.race([pendientes(), new Promise((r) => setTimeout(() => r(null), 1500))]);
      const ultimo = estado.ultimo && {
        fecha: estado.ultimo.fecha,
        destinos: estado.ultimo.destinos.map((d) => ({ destino: d.destino, disponible: d.disponible, motivo: d.motivo, nuevos: d.nuevos, agregados: d.agregados, reemplazados: d.reemplazados, versionados: d.versionados, eliminadosEnOrigen: d.eliminadosEnOrigen, bytes: d.bytes, errores: d.errores.slice(0, 50) })),
        fuentesFaltantes: estado.ultimo.fuentes.filter((f) => !f.disponible).map((f) => f.nombre),
      };
      return json(res, 200, {
        sincronizando: sincronizando(),
        progreso: estado.progreso,
        error: estado.error,
        ultimo,
        destinos: await infoDestinos(),
        pendientes: pend && { archivos: pend.archivos, bytes: pend.bytes, conversaciones: pend.conversaciones.size },
        riesgo: await riesgo(pend),
        recordatorioDias: config.recordatorioDias,
        comprobando: comprobando(),
        progresoComprobacion: estado.comprobacion,
        errorComprobacion: estado.errorComprobacion,
        limpieza: await infoLimpieza(),
        fuentes: config.fuentes.map((f) => ({ nombre: f.nombre, origen: f.origen, destino: f.destino })),
        nombreUsuario: config.nombreUsuario,
        version: VERSION,
        instalada: estaInstalada(),
        buscarActualizaciones: config.buscarActualizaciones,
        actualizacion: estadoActualizacion.fase ? { ...estadoActualizacion } : null,
        releases: URL_RELEASES,
        carpetaDatos: CARPETA_LOCAL,
        configuracion: config.archivo,
        log: ARCHIVO_LOG,
      });
    }

    case 'POST /api/sincronizar':
      iniciarSincronizacion();
      return json(res, 202, { ok: true });

    case 'GET /api/conversaciones':
      return json(res, 200, await listaConversaciones());

    case 'GET /api/conversacion': {
      const clave = q('clave');
      const { abs, enArchivo } = await resolver(clave);
      const { eventos } = await analizarConCache(abs);
      const desde = Math.max(0, Number(q('desde')) || 0);
      const cantidad = Math.min(1000, Math.max(1, Number(q('cantidad')) || 300));
      const info = await infoConversacion(clave, abs);
      return json(res, 200, { clave, info, enArchivo, total: eventos.length, desde, eventos: eventos.slice(desde, desde + cantidad) });
    }

    case 'GET /api/subagentes':
      return json(res, 200, await subagentes(q('clave')));

    case 'GET /api/linea': {
      const { abs } = await resolver(q('clave'));
      const texto = await leerLineaEn(abs, Number(q('off')) || 0);
      let o;
      try {
        o = JSON.parse(texto);
      } catch {
        return json(res, 200, { crudo: texto.slice(0, 200000) });
      }
      return json(res, 200, sinBase64(o));
    }

    case 'GET /api/imagen': {
      const { abs } = await resolver(q('clave'));
      const imagen = imagenesDeLinea(JSON.parse(await leerLineaEn(abs, Number(q('off')) || 0)))[Number(q('n')) || 0];
      if (!imagen || !/^image\/(png|jpeg|gif|webp)$/.test(imagen.media_type)) throw new ErrorHttp(404, 'No hay imagen.');
      res.writeHead(200, { 'Content-Type': imagen.media_type, 'Cache-Control': 'private, max-age=86400', ...SEGURIDAD });
      return res.end(Buffer.from(imagen.data, 'base64'));
    }

    case 'GET /api/buscar':
      return json(res, 200, await buscar(q('q') ?? ''));

    case 'GET /api/exportar': {
      const clave = q('clave');
      const { abs } = await resolver(clave);
      const { resumen, eventos } = await analizarConCache(abs);
      const info = await infoConversacion(clave, abs);
      const md = aMarkdown({ titulo: info.titulo, clave, resumen, eventos, nombreUsuario: config.nombreUsuario });
      const nombre = `${fechaLocal(resumen.desde, false) || 'conversacion'} - ${info.titulo}`.replace(/[\\/:*?"<>|\r\n]+/g, ' ').slice(0, 120).trim() + '.md';
      res.writeHead(200, {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="conversacion.md"; filename*=UTF-8''${encodeURIComponent(nombre)}`,
        ...SEGURIDAD,
      });
      return res.end(md);
    }

    case 'POST /api/restaurar': {
      const { clave } = await cuerpo(req);
      return json(res, 200, await restaurar(clave));
    }

    case 'POST /api/abrir': {
      const datos = await cuerpo(req);
      if (typeof datos.destino === 'number') {
        const d = config.destinos[datos.destino];
        if (!d || !(await existe(d))) throw new ErrorHttp(404, 'Esa carpeta todavía no existe.');
        abrirEnExplorador(d, false);
      } else if (datos.que === 'configuracion') {
        abrirEnExplorador(config.archivo, true);
      } else if (datos.que === 'log') {
        abrirEnExplorador(ARCHIVO_LOG, true);
      } else if (datos.que === 'datos') {
        abrirEnExplorador(CARPETA_LOCAL, false);
      } else {
        const { abs } = await resolver(datos.clave);
        abrirEnExplorador(abs, true);
      }
      return json(res, 200, { ok: true });
    }

    case 'GET /api/destinos/sugerencias':
      return json(res, 200, { sugerencias: sugerirDestinos(config), tamanoArchivo: await tamanoArchivo() });

    case 'GET /api/carpetas':
      try {
        return json(res, 200, await listarCarpetas(q('ruta'), config));
      } catch (e) {
        throw new ErrorHttp(422, `No se puede abrir esa carpeta: ${e.message}`);
      }

    case 'POST /api/destinos':
      await cambiarDestinos(await cuerpo(req));
      return json(res, 200, { destinos: await infoDestinos() });

    case 'POST /api/ajustes':
      await cambiarAjustes(await cuerpo(req));
      return json(res, 200, { nombreUsuario: config.nombreUsuario, buscarActualizaciones: config.buscarActualizaciones, recordatorioDias: config.recordatorioDias });

    case 'GET /api/archivos':
      return json(res, 200, await listaArchivos(q('q'), ['todos', 'faltan'].includes(q('modo')) ? q('modo') : 'cambiados'));

    case 'GET /api/archivos-de':
      return json(res, 200, await archivosDeConversacion(q('clave')));

    case 'GET /api/archivo': {
      const h = await historialDe(q('clave'));
      const { conversaciones } = await indice();
      return json(res, 200, {
        archivo: { ...resumenArchivo(h.archivo), conversaciones: h.archivo.conversaciones.map(({ rels, ...c }) => ({ ...c, titulo: conversaciones[c.clave]?.titulo ?? c.titulo })) },
        versiones: h.versiones.map(({ texto, ...v }) => ({ ...v, disponible: texto != null, tamano: texto == null ? null : Buffer.byteLength(texto), lineas: texto == null ? null : texto.split('\n').length })),
        enDisco: h.enDisco && { ts: h.enDisco.ts, tamano: h.enDisco.tamano, coincide: h.enDisco.coincide, disponible: h.enDisco.texto != null },
      });
    }

    case 'GET /api/archivo/version': {
      const { version } = await versionDe(q('clave'), q('n'));
      return json(res, 200, { texto: version.texto });
    }

    case 'GET /api/archivo/descargar': {
      const { archivo, version } = await versionDe(q('clave'), q('n'));
      const ext = path.extname(archivo.ruta);
      const base = path.basename(archivo.ruta, ext);
      const cuando = fechaLocal(version.ts).replace(':', '');
      const nombre = `${base} (${q('n') === 'disco' ? 'en tu PC' : `versión ${cuando}`})${ext}`.replace(/[\\/:*?"<>|\r\n]+/g, ' ');
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="archivo${ext.replace(/[^\w.]/g, '')}"; filename*=UTF-8''${encodeURIComponent(nombre)}`,
        ...SEGURIDAD,
      });
      return res.end(version.texto);
    }

    case 'POST /api/comprobar':
      iniciarComprobacion(await cuerpo(req));
      return json(res, 202, { ok: true });

    case 'POST /api/reparar':
      iniciarReparacion(Number((await cuerpo(req)).destino));
      return json(res, 202, { ok: true });

    case 'GET /api/comprobacion': {
      const dest = config.destinos[Number(q('destino'))];
      if (!dest) throw new ErrorHttp(400, 'Destino inválido.');
      return json(res, 200, (await leerJson(rutaComprobacion(dest), null)) ?? { problemas: [] });
    }

    case 'GET /api/actualizacion': {
      const forzar = q('forzar') === '1';
      if (!config.buscarActualizaciones && !forzar) return json(res, 200, { actual: VERSION, desactivado: true });
      try {
        return json(res, 200, await buscarActualizacion({ forzar }));
      } catch (e) {
        return json(res, 200, { actual: VERSION, error: `No se pudo consultar GitHub: ${e.message}` });
      }
    }

    case 'POST /api/actualizar':
      if (sincronizando()) throw new ErrorHttp(409, 'Esperá a que termine la sincronización para actualizar.');
      actualizar(log).catch((e) => log('Actualización fallida:', e.message));
      return json(res, 202, { ok: true });

    case 'GET /api/novedades':
      return json(res, 200, { actual: VERSION, versiones: await novedades() });

    case 'POST /api/acceso-directo': {
      const d = config.destinos[(await cuerpo(req)).destino];
      if (!d) throw new ErrorHttp(400, 'Destino inválido.');
      if (!(await existe(d))) throw new ErrorHttp(409, 'Esa carpeta todavía no existe: sincronizá primero.');
      return json(res, 200, await crearAccesoDirecto(d));
    }

    default:
      return json(res, 404, { error: 'No existe.' });
  }
}

// ---------- Ventana ----------

function abrirVentana() {
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const candidatos = [
    path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ];
  const navegador = candidatos.find((p) => fs.existsSync(p));
  if (navegador) spawn(navegador, [`--app=${URL_APP}`, '--window-size=1440,920'], { detached: true, stdio: 'ignore' }).unref();
  else spawn('cmd.exe', ['/c', 'start', '""', URL_APP], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref();
}

async function yaEstaAbierta() {
  try {
    const r = await fetch(`${URL_APP}api/ping`, { signal: AbortSignal.timeout(2000) });
    return (await r.json()).app === 'claude-archivo';
  } catch {
    return false;
  }
}

const servidor = http.createServer((req, res) => {
  manejar(req, res).catch((e) => {
    if (!(e instanceof ErrorHttp)) log('Error en', req.method, req.url, e);
    if (!res.headersSent) json(res, e.codigo ?? 500, { error: e.message });
    else res.end();
  });
});

servidor.on('error', async (e) => {
  if (e.code === 'EADDRINUSE' && (await yaEstaAbierta())) {
    log('La app ya estaba abierta: se reutiliza.');
    if (MODO_APP) abrirVentana();
    process.exit(0);
  }
  log('No se pudo iniciar el servidor:', e);
  process.exit(1);
});

servidor.listen(config.puerto, '127.0.0.1', () => {
  log(`Claude Archivo escuchando en ${URL_APP}`);
  if (MODO_APP) {
    abrirVentana();
    ultimoLatido = Date.now();
    setInterval(() => {
      if (!sincronizando() && Date.now() - ultimoLatido > ESPERA_SIN_VENTANA) {
        log('No hay ventana abierta: se cierra el servidor.');
        process.exit(0);
      }
    }, 15000);
  }
});
