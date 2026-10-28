import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prepararConfigUsuario, cargarConfig, resolverOrigen, RAIZ_APP } from '../src/config.js';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-archivo-config-'));
let n = 0;
// Arma una "instalación" de la app con los archivos de configuración que se le pasen.
function instalacion(archivos, subcarpeta = 'app') {
  const raiz = path.join(base, `caso-${++n}`);
  const raizApp = path.join(raiz, subcarpeta);
  fs.mkdirSync(raizApp, { recursive: true });
  for (const [rel, contenido] of Object.entries(archivos)) {
    const p = path.join(raiz, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, contenido);
  }
  return { raizApp, carpeta: path.join(raiz, 'datos-usuario') };
}
const predeterminada = fs.readFileSync(path.join(RAIZ_APP, 'config.predeterminado.json'), 'utf8');

test('la primera vez crea la configuración del usuario desde la predeterminada, sin destinos', () => {
  const { raizApp, carpeta } = instalacion({ 'app/config.predeterminado.json': predeterminada });
  const r = prepararConfigUsuario({ carpeta, raizApp });
  assert.equal(r.origen, 'predeterminada');
  assert.deepEqual(cargarConfig(r.ruta).destinos, []);
});

test('migra el config.json que versiones anteriores guardaban junto al código', () => {
  const viejo = '{ "destinos": ["D:\\\\Claude-Archivo"], "fuentes": [], "nombreUsuario": "Ana" }';
  const { raizApp, carpeta } = instalacion({ 'app/config.predeterminado.json': predeterminada, 'app/config.json': viejo });
  const r = prepararConfigUsuario({ carpeta, raizApp });
  assert.equal(r.origen, 'anterior');
  assert.equal(fs.readFileSync(r.ruta, 'utf8'), viejo);
});

test('abierta desde la copia _app de un archivo, usa la configuración guardada en ese archivo', () => {
  const guardada = '{ "destinos": ["E:\\\\Claude-Archivo"], "fuentes": [] }';
  const { raizApp, carpeta } = instalacion(
    { '_app/config.predeterminado.json': predeterminada, '_app/config.json': '{ "destinos": [], "fuentes": [] }', '_configuracion/config.json': guardada },
    '_app',
  );
  const r = prepararConfigUsuario({ carpeta, raizApp });
  assert.equal(r.origen, 'archivo');
  assert.equal(fs.readFileSync(r.ruta, 'utf8'), guardada);
});

test('si el usuario ya tiene configuración, no la toca', () => {
  const { raizApp, carpeta } = instalacion({ 'app/config.predeterminado.json': predeterminada, 'app/config.json': '{}' });
  fs.mkdirSync(carpeta, { recursive: true });
  fs.writeFileSync(path.join(carpeta, 'config.json'), '{ "destinos": [], "fuentes": [], "nombreUsuario": "Mía" }');
  const r = prepararConfigUsuario({ carpeta, raizApp });
  assert.equal(r.origen, 'existente');
  assert.match(fs.readFileSync(r.ruta, 'utf8'), /Mía/);
});

test('encuentra los datos de la app de escritorio en su ubicación nueva o en la vieja', () => {
  const antes = { APPDATA: process.env.APPDATA, LOCALAPPDATA: process.env.LOCALAPPDATA };
  const raiz = path.join(base, `appdata-${++n}`);
  process.env.APPDATA = path.join(raiz, 'Roaming');
  process.env.LOCALAPPDATA = path.join(raiz, 'Local');
  try {
    const vieja = path.join(raiz, 'Roaming', 'Claude', 'claude-code-sessions');
    const nueva = path.join(raiz, 'Local', 'Claude-Data', 'claude_abc123', 'claude-code-sessions');
    const origen = '%APPDATA%\\Claude\\claude-code-sessions';
    assert.equal(resolverOrigen(origen), vieja, 'si no existe ninguna, queda la ruta configurada');
    fs.mkdirSync(vieja, { recursive: true });
    assert.equal(resolverOrigen(origen), vieja);
    fs.mkdirSync(nueva, { recursive: true });
    assert.equal(resolverOrigen(origen), nueva, 'la ubicación nueva tiene prioridad');
  } finally {
    Object.assign(process.env, antes);
  }
});

test('con una lista de rutas candidatas usa la primera que exista', () => {
  const existe = fs.mkdtempSync(path.join(base, 'candidata-'));
  assert.equal(resolverOrigen([path.join(base, 'no-existe'), existe]), existe);
});
