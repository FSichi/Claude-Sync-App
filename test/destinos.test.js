import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RAIZ_APP } from '../src/config.js';
import { validarDestinoNuevo, serializarConfig, guardarConfig, contraerRuta, etiquetaDestino, esDriveEnStreaming, crearAccesoDirecto } from '../src/destinos.js';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-archivo-destinos-'));
const carpeta = (...partes) => {
  const p = path.join(base, ...partes);
  fs.mkdirSync(p, { recursive: true });
  return p;
};
const config = {
  destinos: [carpeta('existente', 'Claude-Archivo')],
  fuentes: [{ origen: carpeta('usuario', '.claude', 'projects') }],
};

test('acepta una carpeta nueva o vacía y devuelve la ruta lista para guardar', () => {
  assert.equal(validarDestinoNuevo(path.join(carpeta('drive'), 'Claude-Archivo'), config).ruta, path.join(base, 'drive', 'Claude-Archivo'));
  assert.ok(validarDestinoNuevo(carpeta('vacia'), config).ruta);
});

test('acepta una carpeta que ya es un archivo de Claude (por ejemplo, para volver a agregarla)', () => {
  const viejo = carpeta('viejo', 'Claude-Archivo');
  carpeta('viejo', 'Claude-Archivo', '_estado');
  fs.writeFileSync(path.join(viejo, 'LEEME.md'), '#');
  assert.ok(validarDestinoNuevo(viejo, config).ruta);
});

test('rechaza rutas que podrían mezclar o pisar cosas', () => {
  const casos = {
    vacia: '',
    relativa: 'carpeta\\sin\\disco',
    raiz: path.parse(base).root,
    repetida: config.destinos[0],
    dentroDeOtroDestino: path.join(config.destinos[0], 'sub'),
    contieneOtroDestino: path.join(base, 'existente'),
    dentroDeLoQueSeCopia: path.join(base, 'usuario', '.claude', 'projects', 'x'),
    contieneLoQueSeCopia: path.join(base, 'usuario'),
    dentroDeLaApp: path.join(RAIZ_APP, 'copias'),
    padreInexistente: path.join(base, 'no', 'existe', 'Claude-Archivo'),
  };
  for (const [caso, ruta] of Object.entries(casos)) assert.ok(validarDestinoNuevo(ruta, config).error, `debería rechazar: ${caso}`);
});

test('rechaza una carpeta con otros archivos y sugiere una subcarpeta', () => {
  const ocupada = carpeta('ocupada');
  fs.writeFileSync(path.join(ocupada, 'foto.jpg'), 'x');
  const r = validarDestinoNuevo(ocupada, config);
  assert.match(r.error, /Claude-Archivo/);
});

test('guarda rutas de OneDrive y del usuario con variables, para que sirvan en otra PC', () => {
  const antes = process.env.OneDrive;
  process.env.OneDrive = path.join(base, 'OneDrive');
  try {
    assert.equal(contraerRuta(path.join(base, 'OneDrive', 'Claude-Archivo')), '%OneDrive%\\Claude-Archivo');
  } finally {
    process.env.OneDrive = antes;
  }
});

test('reconoce Google Drive en modo transmisión y en modo espejo', () => {
  assert.equal(etiquetaDestino('G:\\Mi unidad\\Claude-Archivo'), 'Google Drive');
  assert.equal(etiquetaDestino('C:\\Users\\x\\Mi unidad\\Claude-Archivo'), 'Google Drive');
  assert.equal(esDriveEnStreaming('G:\\Mi unidad\\Claude-Archivo'), true);
  assert.equal(esDriveEnStreaming('C:\\Users\\x\\Mi unidad\\Claude-Archivo'), false);
  assert.equal(etiquetaDestino('D:\\Claude-Archivo'), 'Disco D:');
});

test('reescribir config.json conserva su formato (una fuente por línea)', () => {
  const original = fs.readFileSync(path.join(RAIZ_APP, 'config.predeterminado.json'), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(serializarConfig(JSON.parse(original)), original);
});

test('crea el acceso directo y, si ya existe, no lo pisa', { skip: process.platform !== 'win32' }, async () => {
  const destino = carpeta('Mi unidad', 'Claude-Archivo');
  const escritorio = carpeta('escritorio');
  const primero = await crearAccesoDirecto(destino, escritorio);
  assert.equal(primero.yaExistia, false);
  assert.equal(path.basename(primero.ruta), 'Archivo de Claude (Google Drive).lnk');
  assert.ok(fs.existsSync(primero.ruta));
  const segundo = await crearAccesoDirecto(destino, escritorio);
  assert.equal(segundo.yaExistia, true);
});

test('antes de cambiar los destinos guarda una copia del config anterior', async () => {
  const archivo = path.join(carpeta('app'), 'config.json');
  const inicial = { destinos: ['D:\\Claude-Archivo'], fuentes: [{ nombre: 'A', origen: 'C:\\a', destino: 'a' }], puerto: 1 };
  fs.writeFileSync(archivo, serializarConfig(inicial));
  const copias = path.join(base, 'copias');
  await guardarConfig(archivo, { destinos: ['D:\\Claude-Archivo', 'G:\\Mi unidad\\Claude-Archivo'] }, copias);
  const nuevo = JSON.parse(fs.readFileSync(archivo, 'utf8'));
  assert.deepEqual(nuevo.destinos, ['D:\\Claude-Archivo', 'G:\\Mi unidad\\Claude-Archivo']);
  assert.deepEqual(nuevo.fuentes, inicial.fuentes);
  assert.equal(nuevo.puerto, 1);
  const [copia] = fs.readdirSync(copias);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(copias, copia), 'utf8')).destinos, ['D:\\Claude-Archivo']);
});
