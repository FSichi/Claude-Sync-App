// Carga la configuración del usuario y resuelve las rutas (%USERPROFILE%, %APPDATA%, %OneDrive%).
// Cada usuario tiene su config.json en %LOCALAPPDATA%\Claude-Archivo; el código solo trae una predeterminada.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RAIZ_APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const VERSION = JSON.parse(fs.readFileSync(path.join(RAIZ_APP, 'package.json'), 'utf8')).version;

// Datos propios de la app en esta PC: configuración, registro y copias de configs anteriores.
// CLAUDE_ARCHIVO_DATOS permite usar otra carpeta (para pruebas).
export const CARPETA_DATOS = process.env.CLAUDE_ARCHIVO_DATOS
  ? path.resolve(process.env.CLAUDE_ARCHIVO_DATOS)
  : path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Claude-Archivo');

// Carpetas del archivo que escribe la propia app. Ninguna fuente puede usarlas como destino.
export const RESERVADAS = ['_estado', '_versiones', '_app', '_configuracion', 'texto'];

// Devuelve la ruta del config.json del usuario. Si todavía no existe, lo crea copiando (nunca pisa nada):
//  1. el de un archivo, si la app se abrió desde su copia _app (por ejemplo, después de formatear);
//  2. el que versiones anteriores guardaban junto al código;
//  3. la configuración predeterminada, sin destinos: la app pide elegirlos la primera vez.
export function prepararConfigUsuario({ carpeta = CARPETA_DATOS, raizApp = RAIZ_APP } = {}) {
  const ruta = path.join(carpeta, 'config.json');
  if (fs.existsSync(ruta)) return { ruta, origen: 'existente' };
  fs.mkdirSync(carpeta, { recursive: true });
  const candidatos = [
    [path.join(raizApp, '..', '_configuracion', 'config.json'), 'archivo'],
    [path.join(raizApp, 'config.json'), 'anterior'],
    [path.join(raizApp, 'config.predeterminado.json'), 'predeterminada'],
  ];
  for (const [desde, origen] of candidatos) {
    if (!fs.existsSync(desde)) continue;
    fs.copyFileSync(desde, ruta, fs.constants.COPYFILE_EXCL);
    return { ruta, origen };
  }
  throw new Error(`No se encontró la configuración predeterminada en ${raizApp}.`);
}

// --config <ruta> para usar otra configuración; si no, la del usuario.
export const rutaConfig = (argumento) => (argumento ? path.resolve(argumento) : prepararConfigUsuario().ruta);

export function expandir(ruta) {
  return ruta.replace(/%([^%]+)%/g, (todo, nombre) => {
    const valor = process.env[nombre];
    if (valor) return valor;
    if (nombre.toLowerCase() === 'onedrive') return path.join(os.homedir(), 'OneDrive');
    return todo;
  });
}

// La app de escritorio de Claude (versión Microsoft Store / MSIX) mudó sus datos de %APPDATA%\Claude a
// %LOCALAPPDATA%\Claude-Data\claude_<id>. Una fuente con la ruta vieja busca primero en la nueva.
function alternativas(origen) {
  if (Array.isArray(origen)) return origen;
  const m = origen.match(/^%APPDATA%[\\/]Claude[\\/](.+)$/i);
  return m ? [`%LOCALAPPDATA%\\Claude-Data\\claude_*\\${m[1]}`, origen] : [origen];
}

// Resuelve un comodín (*) en un segmento de la ruta. Si hay varias coincidencias, gana la modificada más recientemente.
function conComodin(ruta) {
  if (!ruta.includes('*')) return fs.existsSync(ruta) ? ruta : null;
  const partes = ruta.split(path.sep);
  const i = partes.findIndex((p) => p.includes('*'));
  const base = partes.slice(0, i).join(path.sep) + path.sep;
  const patron = new RegExp(`^${partes[i].split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 'i');
  let entradas;
  try {
    entradas = fs.readdirSync(base, { withFileTypes: true });
  } catch {
    return null;
  }
  const coincidencias = entradas
    .filter((e) => e.isDirectory() && patron.test(e.name))
    .map((e) => path.join(base, e.name, ...partes.slice(i + 1)))
    .filter((p) => fs.existsSync(p))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return coincidencias[0] ?? null;
}

// "origen" puede ser una ruta o una lista de rutas candidatas: se usa la primera que exista.
export function resolverOrigen(origen) {
  const candidatos = alternativas(origen).map((o) => path.resolve(expandir(o)));
  for (const c of candidatos) {
    const r = conComodin(c);
    if (r) return r;
  }
  return candidatos.find((c) => !c.includes('*')) ?? candidatos[0];
}

export function cargarConfig(archivo = rutaConfig()) {
  const texto = fs.readFileSync(archivo, 'utf8').replace(/^﻿/, '');
  const crudo = JSON.parse(texto);
  const fuentes = crudo.fuentes.map((f) => {
    const destino = f.destino.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!destino || destino.split('/').includes('..') || RESERVADAS.includes(destino.split('/')[0])) {
      throw new Error(`config.json: el destino "${f.destino}" de la fuente "${f.nombre}" no es válido.`);
    }
    return {
      nombre: f.nombre,
      origen: resolverOrigen(f.origen),
      destino,
      conversaciones: Boolean(f.conversaciones),
      recuperada: Boolean(f.recuperada),
      versiones: f.versiones !== false,
      excluir: (f.excluir ?? []).map((x) => x.toLowerCase()),
    };
  });
  return {
    archivo,
    puerto: crudo.puerto ?? 47821,
    nombreUsuario: crudo.nombreUsuario ?? 'Vos',
    buscarActualizaciones: crudo.buscarActualizaciones !== false,
    // Avisar si pasan más de estos días sin sincronizar y hay cambios (0: no avisar).
    recordatorioDias: Number.isInteger(crudo.recordatorioDias) && crudo.recordatorioDias >= 0 ? crudo.recordatorioDias : 3,
    destinos: (crudo.destinos ?? []).map((d) => path.resolve(expandir(d))),
    fuentes,
  };
}

// La fuente de conversaciones "viva" (la de ~/.claude/projects), que es adonde se restaura.
export function fuenteViva(config) {
  const vivas = config.fuentes.filter((f) => f.conversaciones && !f.recuperada);
  return vivas.find((f) => f.destino === 'claude/projects') ?? vivas[0] ?? null;
}

// Fuente con los metadatos de la app de escritorio (títulos de las sesiones).
export function fuenteApp(config) {
  return config.fuentes.find((f) => f.destino.endsWith('claude-code-sessions')) ?? null;
}

// Copia de la propia app dentro del archivo, para poder abrirla después de un formateo.
// No incluye el Node.js que trae el instalador (se reinstala con el instalador o desde nodejs.org).
export function fuenteDeLaApp() {
  return {
    nombre: 'La propia app',
    origen: RAIZ_APP,
    destino: '_app',
    conversaciones: false,
    recuperada: false,
    versiones: false,
    excluir: ['node_modules', '.git', 'node', 'build', 'dist'],
  };
}

// La configuración del usuario también va al archivo: si se pierde la PC, se recupera con todo lo demás.
export function fuenteDeLaConfiguracion(config) {
  return {
    nombre: 'Configuración de la app',
    origen: config.archivo,
    destino: '_configuracion/config.json',
    conversaciones: false,
    recuperada: false,
    versiones: true,
    excluir: [],
  };
}
