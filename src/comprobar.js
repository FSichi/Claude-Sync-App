// Comprobar copias: revisa que cada destino tenga lo que dice su manifiesto y repara lo que falte o esté dañado.
//  - Rápida: que cada archivo exista y tenga el tamaño esperado. No lee el contenido, así que en Google Drive
//    en modo transmisión no baja nada.
//  - A fondo: además lee todo y compara su huella (SHA-256) con Claude, si el archivo no cambió desde que se
//    copió, o con la huella de la comprobación anterior, si no se volvió a copiar desde entonces.
//  - Reparar: copia encima una versión buena (de Claude o de otro destino). Antes guarda la dañada en _versiones/.
// Como el resto de la app, nunca borra nada.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { cargarManifiesto, escribirAtomico, estadoDestino, leerJson, rutaEnDestino, rutaManifiesto } from './archivos.js';
import { copiarCompleto, sello } from './sincronizar.js';

const MAX_PROBLEMAS = 500;
export const rutaComprobacion = (dest) => path.join(dest, '_estado', 'comprobacion.json');
const rutaHuellas = (dest) => path.join(dest, '_estado', 'huellas.json');
const existe = (p) => fsp.access(p).then(() => true, () => false);

let enCurso = false;
export const comprobando = () => enCurso;

async function huella(abs, alAvanzar = () => {}) {
  const h = crypto.createHash('sha256');
  for await (const trozo of fs.createReadStream(abs, { highWaterMark: 1024 * 1024 })) {
    h.update(trozo);
    alAvanzar(trozo.length);
  }
  return h.digest('hex');
}

export function rutaOrigen(rel, fuentes) {
  for (const f of fuentes) {
    if (rel === f.destino) return f.origen;
    if (rel.startsWith(f.destino + '/')) return path.join(f.origen, ...rel.slice(f.destino.length + 1).split('/'));
  }
  return null;
}

// El original sirve de referencia solo si no cambió desde que se copió.
async function origenIntacto(rel, m, fuentes) {
  const origen = m.eliminadoEnOrigen ? null : rutaOrigen(rel, fuentes);
  if (!origen) return null;
  const st = await fsp.stat(origen).catch(() => null);
  return st && st.size === m.size && st.mtimeMs === m.mtimeMs ? origen : null;
}

async function conBloqueo(fn) {
  if (enCurso) throw new Error('Ya hay una comprobación en curso.');
  enCurso = true;
  try {
    return await fn();
  } finally {
    enCurso = false;
  }
}

// destinos: [{ ruta, fondo }]. Guarda el resultado de cada destino en su _estado/comprobacion.json.
export function comprobar(destinos, fuentes, { onProgreso = () => {} } = {}) {
  return conBloqueo(async () => {
    const resultados = [];
    for (const { ruta: dest, fondo } of destinos) {
      const r = { fecha: new Date().toISOString(), fondo: Boolean(fondo), disponible: false, archivos: 0, bytes: 0, problemas: [] };
      const est = await estadoDestino(dest);
      if (!est.disponible || !(await existe(rutaManifiesto(dest)))) {
        resultados.push({ destino: dest, ...r, motivo: est.motivo ?? 'Todavía no tiene copias.' });
        continue;
      }
      r.disponible = true;
      const { archivos } = await cargarManifiesto(dest);
      const entradas = Object.entries(archivos);
      const previas = fondo ? (await leerJson(rutaHuellas(dest), {})).archivos ?? {} : {};
      const huellas = {};
      const bytesTotal = fondo ? entradas.reduce((s, [, m]) => s + (m.copiado ?? m.size ?? 0), 0) : 0;
      let bytesHechos = 0;
      let ultimoAviso = 0;
      const avisar = (hechos, forzar = false) => {
        if (!forzar && Date.now() - ultimoAviso < 250) return;
        ultimoAviso = Date.now();
        onProgreso({ fase: 'comprobando', destino: dest, fondo: r.fondo, hechos, total: entradas.length, bytesHechos, bytesTotal });
      };
      for (let i = 0; i < entradas.length; i++) {
        const [rel, m] = entradas[i];
        avisar(i);
        const esperado = m.copiado ?? m.size ?? 0;
        const base = { rel, borradaEnClaude: Boolean(m.eliminadoEnOrigen) };
        r.archivos++;
        r.bytes += esperado;
        const st = await fsp.stat(rutaEnDestino(dest, rel)).catch(() => null);
        if (!st) {
          r.problemas.push({ ...base, tipo: 'falta' });
          continue;
        }
        if (st.size !== esperado) {
          r.problemas.push({ ...base, tipo: 'tamano', esperado, real: st.size });
          continue;
        }
        if (!fondo) continue;
        let sha;
        try {
          sha = await huella(rutaEnDestino(dest, rel), (n) => {
            bytesHechos += n;
            avisar(i);
          });
        } catch (e) {
          r.problemas.push({ ...base, tipo: 'ilegible', error: e.message });
          continue;
        }
        huellas[rel] = { size: st.size, sha256: sha, sincronizado: m.sincronizado ?? null };
        const origen = await origenIntacto(rel, m, fuentes);
        const previa = previas[rel];
        let referencia = null;
        if (origen) referencia = { de: 'claude', sha256: await huella(origen).catch(() => null) };
        else if (previa && previa.size === st.size && previa.sincronizado === (m.sincronizado ?? null)) referencia = { de: 'anterior', sha256: previa.sha256 };
        if (referencia?.sha256 && referencia.sha256 !== sha) {
          r.problemas.push({ ...base, tipo: 'contenido', comparadoCon: referencia.de, bueno: referencia.sha256 });
          // La huella buena se conserva para la próxima comprobación.
          if (referencia.de === 'anterior') huellas[rel] = previa;
        }
      }
      avisar(entradas.length, true);
      if (fondo) await escribirAtomico(rutaHuellas(dest), JSON.stringify({ fecha: r.fecha, archivos: huellas }));
      r.totalProblemas = r.problemas.length;
      r.problemas = r.problemas.slice(0, MAX_PROBLEMAS);
      await escribirAtomico(rutaComprobacion(dest), JSON.stringify(r));
      resultados.push({ destino: dest, ...r });
    }
    return resultados;
  });
}

// Busca una copia buena de cada problema y la copia encima. Lo que no se puede arreglar queda en la lista.
export function reparar(dest, otrosDestinos, fuentes, { onProgreso = () => {} } = {}) {
  return conBloqueo(async () => {
    const ultimo = await leerJson(rutaComprobacion(dest), null);
    if (!ultimo?.problemas?.length) return { reparados: 0, alSincronizar: 0, sinArreglo: 0 };
    const { archivos } = await cargarManifiesto(dest);
    const carpetaVersiones = path.join(dest, '_versiones', `${sello()}_reparacion`);
    const quedan = [];
    let reparados = 0;
    for (let i = 0; i < ultimo.problemas.length; i++) {
      const p = ultimo.problemas[i];
      onProgreso({ fase: 'reparando', destino: dest, hechos: i, total: ultimo.problemas.length });
      const m = archivos[p.rel];
      if (!m) continue; // ya no está en el manifiesto
      const esperado = m.copiado ?? m.size ?? 0;
      const candidatos = [await origenIntacto(p.rel, m, fuentes), ...otrosDestinos.map((o) => rutaEnDestino(o, p.rel))].filter(Boolean);
      let bueno = null;
      for (const c of candidatos) {
        const st = await fsp.stat(c).catch(() => null);
        if (!st || st.size !== esperado) continue;
        if (p.bueno && (await huella(c).catch(() => null)) !== p.bueno) continue;
        bueno = c;
        break;
      }
      if (!bueno) {
        // Si Claude todavía lo tiene (aunque haya cambiado), la próxima sincronización copia la versión nueva.
        const origen = m.eliminadoEnOrigen ? null : rutaOrigen(p.rel, fuentes);
        quedan.push({ ...p, alSincronizar: Boolean(origen && (await existe(origen))) });
        continue;
      }
      try {
        const abs = rutaEnDestino(dest, p.rel);
        if (await existe(abs)) await copiarCompleto(abs, rutaEnDestino(carpetaVersiones, p.rel));
        await copiarCompleto(bueno, abs);
        reparados++;
      } catch (e) {
        quedan.push({ ...p, error: e.message });
      }
    }
    const r = { ...ultimo, problemas: quedan, totalProblemas: quedan.length, reparado: new Date().toISOString(), reparados };
    await escribirAtomico(rutaComprobacion(dest), JSON.stringify(r));
    return { reparados, alSincronizar: quedan.filter((p) => p.alSincronizar).length, sinArreglo: quedan.filter((p) => !p.alSincronizar).length };
  });
}
