import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sincronizar } from '../src/sincronizar.js';
import { comprobar, reparar } from '../src/comprobar.js';
import { leerJson } from '../src/archivos.js';

let base, origen, d1, d2, config;
const fuente = (dir) => ({ nombre: 'Proyectos', origen: dir, destino: 'claude/projects', conversaciones: false, recuperada: false, versiones: true, excluir: [] });
const enDest = (d, rel) => path.join(d, ...rel.split('/'));
const leer = (p) => fs.readFileSync(p, 'utf8');
const REL = 'claude/projects/P/charla.jsonl';

beforeEach(async () => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-archivo-comprobar-'));
  origen = path.join(base, 'origen');
  d1 = path.join(base, 'destino-1');
  d2 = path.join(base, 'destino-2');
  fs.mkdirSync(path.join(origen, 'P'), { recursive: true });
  fs.writeFileSync(path.join(origen, 'P', 'charla.jsonl'), '{"hola":"mundo"}\n');
  fs.writeFileSync(path.join(origen, 'P', 'nota.md'), 'nota');
  config = { nombreUsuario: 'Ana', destinos: [d1, d2], fuentes: [fuente(origen)] };
  await sincronizar(config, { incluirApp: false });
});

test('con las copias sanas no encuentra problemas', async () => {
  const [r1, r2] = await comprobar([{ ruta: d1, fondo: true }, { ruta: d2, fondo: false }], config.fuentes);
  assert.equal(r1.archivos, 2);
  assert.deepEqual(r1.problemas, []);
  assert.deepEqual(r2.problemas, []);
  assert.ok(fs.existsSync(path.join(d1, '_estado', 'huellas.json')), 'a fondo guarda las huellas');
  assert.equal((await leerJson(path.join(d2, '_estado', 'comprobacion.json'))).fondo, false);
});

test('detecta lo que falta, lo que cambió de tamaño y lo dañado con el mismo tamaño', async () => {
  fs.writeFileSync(enDest(d1, 'claude/projects/P/nota.md'), 'nota de más');
  fs.writeFileSync(enDest(d1, REL), '{"hola":"MUNDO"}\n');
  const manifiesto = path.join(d1, '_estado', 'manifiesto.json');
  const m = await leerJson(manifiesto);
  m.archivos['claude/projects/P/fantasma.jsonl'] = { size: 3, mtimeMs: 1, copiado: 3 };
  fs.writeFileSync(manifiesto, JSON.stringify(m));

  const rapida = (await comprobar([{ ruta: d1, fondo: false }], config.fuentes))[0];
  assert.deepEqual(rapida.problemas.map((p) => p.tipo).sort(), ['falta', 'tamano'], 'la rápida no lee el contenido');

  const fondo = (await comprobar([{ ruta: d1, fondo: true }], config.fuentes))[0];
  const danado = fondo.problemas.find((p) => p.tipo === 'contenido');
  assert.equal(danado.rel, REL);
  assert.equal(danado.comparadoCon, 'claude');
});

test('repara desde Claude y guarda la copia dañada en _versiones', async () => {
  fs.writeFileSync(enDest(d1, REL), '{"hola":"MUNDO"}\n');
  await comprobar([{ ruta: d1, fondo: true }], config.fuentes);
  const r = await reparar(d1, [d2], config.fuentes);
  assert.equal(r.reparados, 1);
  assert.equal(leer(enDest(d1, REL)), '{"hola":"mundo"}\n');
  const versiones = fs.readdirSync(path.join(d1, '_versiones'));
  assert.match(versiones[0], /_reparacion$/);
  assert.equal(leer(enDest(path.join(d1, '_versiones', versiones[0]), REL)), '{"hola":"MUNDO"}\n', 'no se pierde nada, ni lo dañado');
  assert.deepEqual((await comprobar([{ ruta: d1, fondo: true }], config.fuentes))[0].problemas, []);
});

test('si Claude ya lo borró, repara desde otro destino comparando con la huella anterior', async () => {
  await comprobar([{ ruta: d1, fondo: true }], config.fuentes);
  // Claude ya no lo tiene: la fuente apunta a una carpeta vacía.
  const vacia = path.join(base, 'origen-vacio');
  fs.mkdirSync(vacia);
  config.fuentes = [fuente(vacia)];
  await sincronizar(config, { incluirApp: false });
  fs.writeFileSync(enDest(d1, REL), '{"hola":"MUNDO"}\n');

  const [r] = await comprobar([{ ruta: d1, fondo: true }], config.fuentes);
  const p = r.problemas.find((x) => x.rel === REL);
  assert.equal(p.comparadoCon, 'anterior');
  assert.ok(p.borradaEnClaude);
  assert.equal((await reparar(d1, [d2], config.fuentes)).reparados, 1);
  assert.equal(leer(enDest(d1, REL)), '{"hola":"mundo"}\n', 'la copia buena vino del otro destino');
});
