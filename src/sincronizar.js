// Motor de sincronización.
//
// Regla de oro: SOLO COPIA. En todo el programa no hay una sola llamada que borre archivos.
//  - Archivo nuevo en el origen      -> se copia.
//  - Archivo que solo creció (.jsonl) -> se le agregan los bytes nuevos al final.
//  - Archivo que cambió de otra forma -> la versión anterior se guarda en _versiones/ y recién después se actualiza.
//  - Archivo que desapareció del origen (por ejemplo, un chat borrado en la app) -> se conserva y se marca.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fuenteDeLaApp, fuenteDeLaConfiguracion } from './config.js';
import { actualizarIndice } from './indice.js';
import { escribirLeeme } from './leeme.js';
import {
  SUFIJO_TEMP, cargarManifiesto, conReintentos, escribirAtomico, estadoDestino, leerJson, rutaEnDestino, rutaManifiesto,
} from './archivos.js';

const COLA = 64 * 1024; // bytes que se comparan para confirmar que un archivo solo creció
const TROZO = 8 * 1024 * 1024;

let enCurso = false;
export const sincronizando = () => enCurso;

export async function listarFuente(fuente, rutasIgnoradas = []) {
  const archivos = [];
  const errores = [];
  const ignoradas = new Set(rutasIgnoradas.map((r) => path.resolve(r).toLowerCase()));
  let st;
  try {
    st = await fsp.stat(fuente.origen);
  } catch {
    return { disponible: false, archivos, errores };
  }
  if (st.isFile()) {
    archivos.push({ rel: fuente.destino, abs: fuente.origen, size: st.size, mtimeMs: st.mtimeMs, fuente });
    return { disponible: true, archivos, errores };
  }
  const recorrer = async (dir, relDir) => {
    let entradas;
    try {
      entradas = await fsp.readdir(dir, { withFileTypes: true });
    } catch (e) {
      errores.push({ ruta: dir, error: e.message });
      return;
    }
    // Todo en paralelo: con miles de archivos, de a uno tarda varios segundos.
    await Promise.all(entradas.map(async (e) => {
      if (fuente.excluir.includes(e.name.toLowerCase()) || e.name.endsWith(SUFIJO_TEMP)) return;
      const abs = path.join(dir, e.name);
      const rel = `${relDir}/${e.name}`;
      // Los enlaces simbólicos y las junctions se ignoran para no entrar en bucles.
      if (e.isDirectory()) {
        if (!ignoradas.has(abs.toLowerCase())) await recorrer(abs, rel);
      } else if (e.isFile()) {
        try {
          const s = await fsp.stat(abs);
          archivos.push({ rel, abs, size: s.size, mtimeMs: s.mtimeMs, fuente });
        } catch (err) {
          errores.push({ ruta: abs, error: err.message });
        }
      }
    }));
  };
  await recorrer(fuente.origen, fuente.destino);
  archivos.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  return { disponible: true, archivos, errores };
}

async function leerRango(ruta, desde, largo) {
  const fh = await fsp.open(ruta, 'r');
  try {
    const buf = Buffer.alloc(largo);
    const { bytesRead } = await fh.read(buf, 0, largo, desde);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

async function mismosBytes(a, b) {
  const fa = await fsp.open(a, 'r');
  const fb = await fsp.open(b, 'r');
  try {
    const ba = Buffer.allocUnsafe(TROZO);
    const bb = Buffer.allocUnsafe(TROZO);
    for (let pos = 0; ; ) {
      const ra = await fa.read(ba, 0, TROZO, pos);
      const rb = await fb.read(bb, 0, TROZO, pos);
      if (ra.bytesRead !== rb.bytesRead) return false;
      if (ra.bytesRead === 0) return true;
      if (!ba.subarray(0, ra.bytesRead).equals(bb.subarray(0, rb.bytesRead))) return false;
      pos += ra.bytesRead;
    }
  } finally {
    await fa.close();
    await fb.close();
  }
}

async function copiarCompleto(origen, dst) {
  await fsp.mkdir(path.dirname(dst), { recursive: true });
  const tmp = dst + SUFIJO_TEMP;
  await conReintentos(() => fsp.copyFile(origen, tmp));
  await conReintentos(() => fsp.rename(tmp, dst));
}

// Si los bytes que ya están en el archivo coinciden con el origen, agrega solo lo nuevo.
// Devuelve false si el origen no es una continuación de lo archivado.
async function agregarAlFinal(origen, dst, tamDst, alAvanzar) {
  if (tamDst > 0) {
    const n = Math.min(COLA, tamDst);
    const [a, b] = await Promise.all([leerRango(origen, tamDst - n, n), leerRango(dst, tamDst - n, n)]);
    if (a.length !== n || !a.equals(b)) return false;
    const m = Math.min(4096, tamDst);
    const [c, d] = await Promise.all([leerRango(origen, 0, m), leerRango(dst, 0, m)]);
    if (!c.equals(d)) return false;
  }
  const fo = await fsp.open(origen, 'r');
  const fd = await conReintentos(() => fsp.open(dst, 'a'));
  try {
    const buf = Buffer.allocUnsafe(TROZO);
    for (let pos = tamDst; ; ) {
      const { bytesRead } = await fo.read(buf, 0, TROZO, pos);
      if (bytesRead === 0) break;
      await fd.write(buf, 0, bytesRead);
      pos += bytesRead;
      alAvanzar(bytesRead);
    }
  } finally {
    await fo.close();
    await fd.close();
  }
  return true;
}

function sello(fecha = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${fecha.getFullYear()}-${p(fecha.getMonth() + 1)}-${p(fecha.getDate())}_${p(fecha.getHours())}${p(fecha.getMinutes())}${p(fecha.getSeconds())}`;
}

function procesoVivo(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

// Decide qué hay que hacer con cada archivo mirando solo tamaños y fechas (rápido).
async function planificar(dest, archivos, manifiesto) {
  const plan = [];
  for (const a of archivos) {
    const dst = rutaEnDestino(dest, a.rel);
    const m = manifiesto.archivos[a.rel];
    let ds = null;
    try {
      ds = await fsp.stat(dst);
    } catch {}
    if (!ds) plan.push({ tipo: 'nuevo', a, dst, bytes: a.size });
    else if (m && m.size === a.size && m.mtimeMs === a.mtimeMs && ds.size === a.size) continue;
    else if (a.size > ds.size) plan.push({ tipo: 'crecio', a, dst, tamDst: ds.size, bytes: a.size - ds.size });
    else plan.push({ tipo: 'revisar', a, dst, tamDst: ds.size, bytes: a.size });
  }
  return plan;
}

async function sincronizarDestino(dest, listados, { simular, onProgreso, ahora }) {
  const r = { destino: dest, disponible: false, nuevos: 0, agregados: 0, reemplazados: 0, versionados: 0, sinCambios: 0, bytes: 0, eliminadosEnOrigen: 0, cambiados: [], errores: [] };
  const est = await estadoDestino(dest);
  if (!est.disponible) {
    r.motivo = est.motivo;
    return r;
  }
  r.disponible = true;

  const archivos = listados.flatMap((l) => l.archivos);
  const manifiesto = await cargarManifiesto(dest);
  onProgreso({ fase: 'comparando', destino: dest });
  const plan = await planificar(dest, archivos, manifiesto);
  r.sinCambios = archivos.length - plan.length;
  if (simular) {
    for (const p of plan) {
      r[p.tipo === 'nuevo' ? 'nuevos' : p.tipo === 'crecio' ? 'agregados' : 'reemplazados']++;
      r.bytes += p.bytes;
      r.cambiados.push(p.a.rel);
    }
    return r;
  }

  const bloqueo = path.join(dest, '_estado', 'en-uso.json');
  await fsp.mkdir(path.dirname(bloqueo), { recursive: true });
  const previo = await leerJson(bloqueo, {});
  if (previo.pid && previo.pid !== process.pid && procesoVivo(previo.pid)) {
    r.errores.push({ ruta: dest, error: `Otra sincronización (proceso ${previo.pid}) está usando este destino.` });
    return r;
  }
  await escribirAtomico(bloqueo, JSON.stringify({ pid: process.pid, desde: ahora.toISOString() }));

  const bytesTotal = plan.reduce((s, p) => s + p.bytes, 0);
  let bytesHechos = 0;
  let ultimoAviso = 0;
  const avisar = (archivo, i, forzar = false) => {
    const t = Date.now();
    if (!forzar && t - ultimoAviso < 250) return;
    ultimoAviso = t;
    onProgreso({ fase: 'copiando', destino: dest, archivo, hechos: i, total: plan.length, bytesHechos, bytesTotal });
  };
  const carpetaVersiones = path.join(dest, '_versiones', sello(ahora));
  let ultimoGuardado = Date.now();

  for (let i = 0; i < plan.length; i++) {
    const { tipo, a, dst, tamDst } = plan[i];
    const base = bytesHechos;
    avisar(a.rel, i);
    try {
      let cambio = true;
      if (tipo === 'nuevo') {
        await copiarCompleto(a.abs, dst);
        r.nuevos++;
      } else if (tipo === 'crecio' && (await agregarAlFinal(a.abs, dst, tamDst, (n) => { bytesHechos += n; avisar(a.rel, i); }))) {
        r.agregados++;
      } else if (tipo === 'revisar' && a.size === tamDst && (await mismosBytes(a.abs, dst))) {
        cambio = false; // mismo contenido con otra fecha: solo se actualiza el manifiesto
      } else {
        if (a.fuente.versiones) {
          await copiarCompleto(dst, rutaEnDestino(carpetaVersiones, a.rel));
          r.versionados++;
        }
        await copiarCompleto(a.abs, dst);
        r.reemplazados++;
      }
      const final = await fsp.stat(dst);
      manifiesto.archivos[a.rel] = { size: a.size, mtimeMs: a.mtimeMs, copiado: final.size, sincronizado: ahora.toISOString() };
      if (cambio) {
        r.cambiados.push(a.rel);
        r.bytes += plan[i].bytes;
      } else r.sinCambios++;
    } catch (e) {
      r.errores.push({ ruta: a.abs, error: e.message });
    }
    bytesHechos = base + plan[i].bytes;
    if (Date.now() - ultimoGuardado > 30000) {
      await escribirAtomico(rutaManifiesto(dest), JSON.stringify(manifiesto));
      ultimoGuardado = Date.now();
    }
  }
  avisar('', plan.length, true);

  // Lo que ya no está en el origen se conserva y se marca (por ejemplo, un chat borrado desde la app).
  const vistos = new Set(archivos.map((a) => a.rel));
  for (const l of listados) {
    if (!l.disponible) continue;
    const prefijo = l.fuente.destino;
    for (const [rel, m] of Object.entries(manifiesto.archivos)) {
      if (rel !== prefijo && !rel.startsWith(prefijo + '/')) continue;
      if (vistos.has(rel)) {
        if (m.eliminadoEnOrigen) m.eliminadoEnOrigen = undefined;
      } else if (!m.eliminadoEnOrigen) {
        m.eliminadoEnOrigen = ahora.toISOString();
        r.eliminadosEnOrigen++;
      }
    }
  }

  await escribirAtomico(rutaManifiesto(dest), JSON.stringify(manifiesto));
  await escribirAtomico(bloqueo, JSON.stringify({ pid: null, hasta: new Date().toISOString() }));
  return r;
}

export async function sincronizar(config, { simular = false, incluirApp = true, onProgreso = () => {} } = {}) {
  if (enCurso) throw new Error('Ya hay una sincronización en curso.');
  enCurso = true;
  const ahora = new Date();
  try {
    const fuentes = incluirApp ? [...config.fuentes, fuenteDeLaApp(), fuenteDeLaConfiguracion(config)] : config.fuentes;
    onProgreso({ fase: 'listando' });
    const listados = [];
    for (const f of fuentes) listados.push({ fuente: f, ...(await listarFuente(f, config.destinos)) });

    const destinos = [];
    for (const dest of config.destinos) {
      destinos.push(await sincronizarDestino(dest, listados, { simular, onProgreso, ahora }));
    }

    if (!simular) {
      const cache = new Map();
      for (const d of destinos.filter((x) => x.disponible)) {
        onProgreso({ fase: 'indexando', destino: d.destino });
        try {
          const ind = await actualizarIndice(d.destino, config, { cache, onProgreso });
          d.conversaciones = ind.total;
          d.indexadas = ind.analizadas;
          await escribirLeeme(d.destino, config);
        } catch (e) {
          d.errores.push({ ruta: d.destino, error: `Índice: ${e.message}` });
        }
        const linea = { fecha: ahora.toISOString(), fin: new Date().toISOString(), ...d, cambiados: d.cambiados.length };
        await fsp.appendFile(path.join(d.destino, '_estado', 'registro.jsonl'), JSON.stringify(linea) + '\n');
      }
    }

    return {
      fecha: ahora.toISOString(),
      simulacion: simular,
      fuentes: listados.map((l) => ({ nombre: l.fuente.nombre, origen: l.fuente.origen, disponible: l.disponible, archivos: l.archivos.length, bytes: l.archivos.reduce((s, a) => s + a.size, 0), errores: l.errores })),
      destinos: destinos.map((d) => ({ ...d, cambiados: d.cambiados.length })),
    };
  } finally {
    enCurso = false;
  }
}
