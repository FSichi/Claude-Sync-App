// Busca versiones nuevas en los releases de GitHub y actualiza la app instalada.
// Es lo único que la app consulta en internet, y se puede desactivar en Ajustes › App.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { RAIZ_APP, VERSION } from './config.js';
import { compararVersiones, parseSecciones } from './changelog.js';

export const REPO = 'FSichi/Claude-Sync-App';
export const URL_RELEASES = `https://github.com/${REPO}/releases`;
const CACHE_MS = 6 * 60 * 60 * 1000;

// La versión instalada tiene el desinstalador de Inno Setup al lado; desde el código no se autoactualiza.
export const estaInstalada = () => fs.existsSync(path.join(RAIZ_APP, 'unins000.exe'));

let cache = null;

function aVersion(r) {
  const asset = (re) => {
    const a = (r.assets ?? []).find((x) => re.test(x.name));
    return a ? { nombre: a.name, url: a.browser_download_url, tamano: a.size } : null;
  };
  return {
    version: String(r.tag_name ?? '').replace(/^v/i, ''),
    titulo: r.name ?? r.tag_name,
    fecha: r.published_at ?? null,
    url: r.html_url,
    secciones: parseSecciones(r.body ?? ''),
    instalador: asset(/^Claude-Archivo-Setup-.+\.exe$/i),
    sha256: asset(/^Claude-Archivo-Setup-.+\.exe\.sha256$/i),
  };
}

export async function buscarActualizacion({ forzar = false } = {}) {
  if (!forzar && cache && Date.now() < cache.hasta) return cache.datos;
  const r = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=20`, {
    headers: { 'User-Agent': `Claude-Archivo/${VERSION}`, Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`GitHub respondió ${r.status}.`);
  const versiones = (await r.json())
    .filter((x) => !x.draft && !x.prerelease && /^v?\d+\.\d+\.\d+/.test(x.tag_name ?? ''))
    .map(aVersion)
    .sort((a, b) => compararVersiones(b.version, a.version));
  const ultima = versiones[0] ?? null;
  const datos = {
    actual: VERSION,
    ultima,
    hayNueva: Boolean(ultima && compararVersiones(ultima.version, VERSION) > 0),
    consultado: new Date().toISOString(),
    versiones: versiones.slice(0, 15),
  };
  cache = { hasta: Date.now() + CACHE_MS, datos };
  return datos;
}

export const estadoActualizacion = { fase: null, version: null, bytes: 0, total: 0, error: null };

// Baja el instalador, verifica su SHA-256 contra el publicado en el mismo release, lo ejecuta en silencio y cierra la app.
// El instalador reemplaza los archivos de la app y la vuelve a abrir; nunca toca la configuración ni las copias.
export async function actualizar(log = () => {}) {
  if (!estaInstalada()) throw new Error('Esta copia de la app no está instalada: bajá la versión nueva desde GitHub.');
  if (estadoActualizacion.fase && !estadoActualizacion.error) throw new Error('Ya se está actualizando.');
  const info = await buscarActualizacion({ forzar: true });
  if (!info.hayNueva) throw new Error('Ya tenés la última versión.');
  const { instalador, sha256, version } = info.ultima;
  if (!instalador || !sha256) throw new Error('El release no tiene el instalador o su SHA-256.');

  Object.assign(estadoActualizacion, { fase: 'descargando', version, bytes: 0, total: instalador.tamano ?? 0, error: null });
  try {
    const carpeta = path.join(os.tmpdir(), 'Claude-Archivo-actualizacion');
    await fsp.mkdir(carpeta, { recursive: true });
    const destino = path.join(carpeta, instalador.nombre);
    const temporal = `${destino}.descarga`;

    const r = await fetch(instalador.url, { signal: AbortSignal.timeout(15 * 60 * 1000) });
    if (!r.ok || !r.body) throw new Error(`No se pudo bajar el instalador (${r.status}).`);
    const hash = crypto.createHash('sha256');
    const fh = await fsp.open(temporal, 'w');
    try {
      for await (const trozo of r.body) {
        await fh.write(trozo);
        hash.update(trozo);
        estadoActualizacion.bytes += trozo.length;
      }
    } finally {
      await fh.close();
    }

    estadoActualizacion.fase = 'verificando';
    const textoSha = await (await fetch(sha256.url, { signal: AbortSignal.timeout(20000) })).text();
    const esperado = textoSha.trim().split(/\s+/)[0].toLowerCase();
    const real = hash.digest('hex');
    if (!/^[0-9a-f]{64}$/.test(esperado) || real !== esperado) {
      throw new Error('El instalador descargado no coincide con el SHA-256 publicado: no se instaló nada.');
    }
    await fsp.rename(temporal, destino);

    estadoActualizacion.fase = 'instalando';
    log('Actualizando a', version, 'con', destino);
    spawn(destino, ['/SILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/CLOSEAPPLICATIONS'], { detached: true, stdio: 'ignore' }).unref();
    // Se cierra para que el instalador pueda reemplazar los archivos; al terminar, la vuelve a abrir.
    setTimeout(() => process.exit(0), 1500);
  } catch (e) {
    estadoActualizacion.error = e.message;
    throw e;
  }
}
