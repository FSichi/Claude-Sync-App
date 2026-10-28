// Utilidades de archivos compartidas. Ninguna borra nada.
import fsp from 'node:fs/promises';
import path from 'node:path';

export const SUFIJO_TEMP = '.tmp-sync';

export function rutaEnDestino(dest, rel) {
  return path.join(dest, ...rel.split('/'));
}

export async function leerJson(ruta, defecto) {
  try {
    return JSON.parse((await fsp.readFile(ruta, 'utf8')).replace(/^﻿/, ''));
  } catch {
    return defecto;
  }
}

// OneDrive y el antivirus a veces bloquean un archivo unos instantes: se reintenta.
export async function conReintentos(fn) {
  for (let intento = 0; ; intento++) {
    try {
      return await fn();
    } catch (e) {
      if (intento >= 6 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e;
      await new Promise((r) => setTimeout(r, 150 * (intento + 1)));
    }
  }
}

// Escribe un archivo propio de la app (manifiesto, índice, textos) sin dejarlo a medias.
export async function escribirAtomico(ruta, contenido) {
  await fsp.mkdir(path.dirname(ruta), { recursive: true });
  const tmp = ruta + SUFIJO_TEMP;
  await conReintentos(() => fsp.writeFile(tmp, contenido));
  await conReintentos(() => fsp.rename(tmp, ruta));
}

export const rutaManifiesto = (dest) => path.join(dest, '_estado', 'manifiesto.json');
export const cargarManifiesto = (dest) => leerJson(rutaManifiesto(dest), { version: 1, archivos: {} });

export async function estadoDestino(dest) {
  try {
    await fsp.access(path.dirname(dest));
    return { disponible: true };
  } catch {
    return { disponible: false, motivo: `No se encuentra ${path.dirname(dest)}` };
  }
}
