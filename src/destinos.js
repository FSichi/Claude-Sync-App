// Destinos configurables desde la app: validar, guardar en config.json, sugerir y crear accesos directos.
// Quitar un destino solo lo saca de la lista: nunca se borra nada de esa carpeta.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { RAIZ_APP, expandir } from './config.js';
import { escribirAtomico } from './archivos.js';

export const NOMBRE_CARPETA = 'Claude-Archivo';

const bajo = (p) => path.resolve(p).toLowerCase().replace(/[\\/]+$/, '');
const dentroDe = (a, b) => a === b || a.startsWith(b + '\\');

// Guarda las rutas como %OneDrive%\... o %USERPROFILE%\... para que config.json sirva en otra PC.
export function contraerRuta(ruta) {
  const variables = ['OneDrive', 'LOCALAPPDATA', 'APPDATA', 'USERPROFILE']
    .map((v) => [v, process.env[v]])
    .filter(([, valor]) => valor)
    .sort((a, b) => b[1].length - a[1].length);
  for (const [v, valor] of variables) {
    const base = path.resolve(valor);
    if (bajo(ruta) === bajo(base) || bajo(ruta).startsWith(bajo(base) + '\\')) return `%${v}%${ruta.slice(base.length)}`;
  }
  return ruta;
}

export function etiquetaDestino(ruta) {
  const r = ruta.toLowerCase();
  if (/\\(mi unidad|my drive|google drive)(\\|$)/.test(r)) return 'Google Drive';
  if (process.env.OneDrive && dentroDe(bajo(ruta), bajo(process.env.OneDrive))) return 'OneDrive';
  if (/\\dropbox(\\|$)/.test(r)) return 'Dropbox';
  if (/\\iclouddrive(\\|$)/.test(r)) return 'iCloud Drive';
  if (ruta.startsWith('\\\\')) return 'Red';
  return `Disco ${ruta[0].toUpperCase()}:`;
}

// Google Drive en modo "transmitir" muestra los archivos en una unidad virtual (G:\Mi unidad).
// Ahí conviene marcar la carpeta "Disponible sin conexión" para que no dependa de internet.
export const esDriveEnStreaming = (ruta) => /^[A-Za-z]:\\(Mi unidad|My Drive)(\\|$)/i.test(ruta);

export function validarDestinoNuevo(entrada, config) {
  const texto = String(entrada ?? '').trim().replace(/^"(.*)"$/, '$1');
  if (!texto) return { error: 'Escribí o elegí una carpeta.' };
  const expandida = expandir(texto);
  if (!/^[A-Za-z]:[\\/]|^\\\\[^\\]+\\[^\\]+/.test(expandida)) {
    return { error: 'Tiene que ser una ruta completa, como D:\\Copias\\Claude-Archivo o \\\\NAS\\copias\\Claude-Archivo.' };
  }
  const ruta = path.resolve(expandida);
  if (path.parse(ruta).root.replace(/[\\/]+$/, '').toLowerCase() === bajo(ruta)) {
    return { error: `No uses la raíz de un disco. Elegí una carpeta, por ejemplo ${path.join(ruta, NOMBRE_CARPETA)}.` };
  }
  const r = bajo(ruta);
  for (const d of config.destinos) {
    if (r === bajo(d)) return { error: 'Ese destino ya está en la lista.' };
    if (dentroDe(r, bajo(d)) || dentroDe(bajo(d), r)) return { error: `Se superpone con el destino ${d}: no puede estar dentro de otro destino ni contenerlo.` };
  }
  for (const f of config.fuentes) {
    if (dentroDe(r, bajo(f.origen)) || dentroDe(bajo(f.origen), r)) return { error: `Se superpone con algo que se copia (${f.origen}). Elegí otra carpeta.` };
  }
  if (dentroDe(r, bajo(RAIZ_APP))) return { error: 'No puede estar dentro de la carpeta de la app.' };
  if (!fs.existsSync(path.dirname(ruta))) return { error: `No existe la carpeta ${path.dirname(ruta)}.` };
  if (fs.existsSync(ruta)) {
    if (!fs.statSync(ruta).isDirectory()) return { error: 'Esa ruta es un archivo, no una carpeta.' };
    const contenido = fs.readdirSync(ruta).filter((n) => !/^(desktop\.ini|thumbs\.db|\.ds_store)$/i.test(n));
    if (contenido.length && !fs.existsSync(path.join(ruta, '_estado'))) {
      return { error: `Esa carpeta ya tiene otros archivos. Para no mezclarlos, usá una subcarpeta nueva, por ejemplo ${path.join(ruta, NOMBRE_CARPETA)}.` };
    }
  }
  return { ruta, crudo: contraerRuta(ruta) };
}

// Mismo formato que el config.json original: una fuente por línea.
export function serializarConfig(crudo) {
  const valor = (v) => {
    if (Array.isArray(v) && !v.length) return '[]';
    if (Array.isArray(v) && v.some((x) => x && typeof x === 'object')) {
      const objeto = (o) => `{ ${Object.entries(o).map(([k, x]) => `${JSON.stringify(k)}: ${JSON.stringify(x)}`).join(', ')} }`;
      return `[\n${v.map((o) => `    ${objeto(o)}`).join(',\n')}\n  ]`;
    }
    if (Array.isArray(v)) return `[\n${v.map((x) => `    ${JSON.stringify(x)}`).join(',\n')}\n  ]`;
    return JSON.stringify(v);
  };
  return `{\n${Object.entries(crudo).map(([k, v]) => `  ${JSON.stringify(k)}: ${valor(v)}`).join(',\n')}\n}\n`;
}

const sello = () => new Date().toISOString().replace(/[:.]/g, '-');

// Cambia campos de primer nivel de config.json (destinos, nombreUsuario). Antes guarda una copia de la versión anterior.
export async function guardarConfig(archivoConfig, cambios, carpetaCopias) {
  const actual = await fsp.readFile(archivoConfig, 'utf8');
  const crudo = JSON.parse(actual.replace(/^\uFEFF/, ''));
  await fsp.mkdir(carpetaCopias, { recursive: true });
  await fsp.writeFile(path.join(carpetaCopias, `config-${sello()}.json`), actual, { flag: 'wx' });
  await escribirAtomico(archivoConfig, serializarConfig({ ...crudo, ...cambios }));
}

export function leerDestinosCrudos(archivoConfig) {
  return JSON.parse(fs.readFileSync(archivoConfig, 'utf8').replace(/^\uFEFF/, '')).destinos;
}

// Lugares donde suele convenir una copia: Google Drive (unidad o espejo), OneDrive, Dropbox, iCloud.
export function sugerirDestinos(config) {
  const home = os.homedir();
  const vistos = new Set(config.destinos.map(bajo));
  const salida = [];
  const sumar = (base, nombre, nota) => {
    if (!base || !fs.existsSync(base)) return;
    const ruta = path.join(base, NOMBRE_CARPETA);
    if (vistos.has(bajo(ruta)) || config.destinos.some((d) => dentroDe(bajo(d), bajo(base)) && etiquetaDestino(d) === etiquetaDestino(ruta))) return;
    vistos.add(bajo(ruta));
    salida.push({ nombre, base, ruta, nota });
  };
  for (const letra of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
    for (const carpeta of ['Mi unidad', 'My Drive']) {
      sumar(`${letra}:\\${carpeta}`, `Google Drive (unidad ${letra}:)`, 'Después de la primera copia, marcá la carpeta como disponible sin conexión: clic derecho → Acceso sin conexión → Disponible sin conexión.');
    }
  }
  for (const carpeta of ['Mi unidad', 'My Drive', 'Google Drive']) {
    sumar(path.join(home, carpeta), 'Google Drive (carpeta en tu disco)', 'Modo espejo: todo queda en tu disco y Google Drive lo sube solo.');
  }
  sumar(process.env.OneDrive, 'OneDrive', 'Se sube solo a la nube.');
  sumar(process.env.OneDriveCommercial !== process.env.OneDrive ? process.env.OneDriveCommercial : null, 'OneDrive del trabajo', 'Se sube a la cuenta del trabajo.');
  sumar(path.join(home, 'Dropbox'), 'Dropbox', 'Se sube solo a la nube.');
  sumar(path.join(home, 'iCloudDrive'), 'iCloud Drive', 'Se sube solo a la nube.');
  return salida;
}

// Explorador de carpetas para elegir un destino desde la propia app.
const OCULTAS = /^(\$|\.|system volume information$|recovery$|config\.msi$|windows$|program files|programdata$|appdata$|perflogs$)/i;

export async function listarCarpetas(ruta, config) {
  if (!ruta) {
    const discos = [];
    for (const letra of 'CDEFGHIJKLMNOPQRSTUVWXYZ') if (fs.existsSync(`${letra}:\\`)) discos.push({ nombre: `Disco ${letra}:`, ruta: `${letra}:\\` });
    const lugares = [{ nombre: 'Tu carpeta de usuario', ruta: os.homedir() }, ...sugerirDestinos({ ...config, destinos: [] }).map((s) => ({ nombre: s.nombre, ruta: s.base }))];
    return { ruta: null, padre: null, carpetas: [], lugares, discos };
  }
  const abs = path.resolve(ruta);
  const entradas = await fsp.readdir(abs, { withFileTypes: true });
  const carpetas = entradas
    .filter((e) => e.isDirectory() && !OCULTAS.test(e.name))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
  const padre = path.dirname(abs);
  return { ruta: abs, padre: padre === abs ? '' : padre, carpetas };
}

function powershell(script) {
  const codificado = Buffer.from(`[Console]::OutputEncoding = [Text.Encoding]::UTF8\n${script}`, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', codificado]);
    let salida = '';
    let errores = '';
    p.stdout.on('data', (d) => (salida += d));
    p.stderr.on('data', (d) => (errores += d));
    p.on('error', reject);
    p.on('close', (codigo) => (codigo === 0 ? resolve(salida.trim()) : reject(new Error(errores.trim() || `PowerShell terminó con código ${codigo}`))));
  });
}

const comillas = (s) => `'${String(s).replace(/'/g, "''")}'`;

// Acceso directo en el Escritorio a la carpeta de un destino. Si ya existe uno con ese nombre, no lo toca.
export async function crearAccesoDirecto(carpeta, dondeCrearlo = null) {
  const nombre = `Archivo de Claude (${etiquetaDestino(carpeta)})`.replace(/[\\/:*?"<>|]+/g, ' ');
  const salida = await powershell([
    dondeCrearlo ? `$escritorio = ${comillas(dondeCrearlo)}` : "$escritorio = [Environment]::GetFolderPath('Desktop')",
    `$lnk = Join-Path $escritorio ${comillas(nombre + '.lnk')}`,
    'if (Test-Path -LiteralPath $lnk) { Write-Output "EXISTE|$lnk"; exit 0 }',
    '$s = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)',
    `$s.TargetPath = ${comillas(carpeta)}`,
    `$s.Description = ${comillas('Copia de las conversaciones de Claude')}`,
    '$s.Save()',
    'Write-Output "OK|$lnk"',
  ].join('\n'));
  const [estado, ruta] = salida.split('|');
  return { ruta, yaExistia: estado === 'EXISTE' };
}
