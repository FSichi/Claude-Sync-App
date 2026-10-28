import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sincronizar } from '../src/sincronizar.js';
import { leerJson } from '../src/archivos.js';

let base, origen, dest, config;

const linea = (o) => JSON.stringify(o) + '\n';
const usuario = (texto, ts = '2026-10-01T10:00:00.000Z') =>
  linea({ type: 'user', sessionId: 'aaaaaaaa-1111-2222-3333-444444444444', cwd: 'C:\\Proyecto', timestamp: ts, message: { role: 'user', content: texto } });
const respuesta = (texto, id = 'm1', ts = '2026-10-01T10:00:05.000Z') =>
  linea({ type: 'assistant', sessionId: 'aaaaaaaa-1111-2222-3333-444444444444', timestamp: ts, message: { id, model: 'claude-test', role: 'assistant', content: [{ type: 'text', text: texto }] } });

const escribir = (rel, contenido) => {
  const p = path.join(origen, ...rel.split('/'));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, contenido);
  return p;
};
const enDest = (rel) => path.join(dest, ...rel.split('/'));
const leer = (p) => fs.readFileSync(p, 'utf8');
const sync = (extra = {}) => sincronizar(config, { incluirApp: false, ...extra });

function contarArchivos(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) if (e.isFile()) n++;
  return n;
}

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-archivo-test-'));
  origen = path.join(base, 'origen');
  dest = path.join(base, 'destino');
  fs.mkdirSync(origen);
  config = {
    nombreUsuario: 'Ana',
    destinos: [dest],
    fuentes: [
      { nombre: 'Proyectos', origen: path.join(origen, 'projects'), destino: 'claude/projects', conversaciones: true, recuperada: false, versiones: true, excluir: [] },
      { nombre: 'Metadatos app', origen: path.join(origen, 'app'), destino: 'app-escritorio/claude-code-sessions', conversaciones: false, recuperada: false, versiones: false, excluir: ['rpm'] },
    ],
  };
});

test('copia lo nuevo, arma el índice y el texto legible', async () => {
  escribir('projects/C--Proyecto/aaaaaaaa-1111-2222-3333-444444444444.jsonl', usuario('Hola, armame un backup') + respuesta('Dale, arranco.'));
  escribir('projects/C--Proyecto/aaaaaaaa-1111-2222-3333-444444444444/subagents/agent-1.jsonl', respuesta('sub'));
  escribir('projects/C--Proyecto/memory/MEMORY.md', '- nota');
  const r = await sync();
  assert.equal(r.destinos[0].nuevos, 3);
  assert.equal(leer(enDest('claude/projects/C--Proyecto/memory/MEMORY.md')), '- nota');

  const indice = await leerJson(path.join(dest, '_estado', 'indice.json'));
  const conv = Object.values(indice.conversaciones);
  assert.equal(conv.length, 1, 'los subagentes no cuentan como conversación aparte');
  assert.equal(conv[0].titulo, 'Hola, armame un backup');
  assert.equal(conv[0].subagentes, 1);
  assert.equal(conv[0].mensajesUsuario, 1);
  const md = leer(path.join(dest, ...conv[0].texto.split('/')));
  assert.match(md, /### Ana/);
  assert.match(md, /Dale, arranco\./);
  assert.ok(fs.existsSync(path.join(dest, 'LEEME.md')));
  assert.ok(fs.existsSync(path.join(dest, 'texto', 'INDICE.md')));
});

test('si el .jsonl solo creció, agrega lo nuevo al final sin guardar versión', async () => {
  const p = escribir('projects/P/s.jsonl', usuario('uno'));
  await sync();
  fs.appendFileSync(p, respuesta('dos'));
  const r = await sync();
  assert.equal(r.destinos[0].agregados, 1);
  assert.equal(r.destinos[0].versionados, 0);
  assert.equal(leer(enDest('claude/projects/P/s.jsonl')), leer(p));
  assert.ok(!fs.existsSync(path.join(dest, '_versiones')));
});

test('si el archivo cambió de otra forma, guarda la versión anterior antes de actualizar', async () => {
  const p = escribir('projects/P/s.jsonl', usuario('versión original larga'));
  await sync();
  fs.writeFileSync(p, usuario('reescrito'));
  const r = await sync();
  assert.equal(r.destinos[0].reemplazados, 1);
  assert.equal(r.destinos[0].versionados, 1);
  assert.equal(leer(enDest('claude/projects/P/s.jsonl')), leer(p));
  const [carpeta] = fs.readdirSync(path.join(dest, '_versiones'));
  assert.match(leer(path.join(dest, '_versiones', carpeta, 'claude', 'projects', 'P', 's.jsonl')), /versión original larga/);
});

// Los tests tampoco borran nada: para simular que la app borró una conversación,
// el origen pasa a ser otra carpeta que no tiene ese archivo.
function cambiarOrigen(nombre) {
  origen = path.join(base, nombre);
  fs.mkdirSync(origen, { recursive: true });
  config.fuentes[0].origen = path.join(origen, 'projects');
  config.fuentes[1].origen = path.join(origen, 'app');
}

test('lo que se borra en el origen se conserva y queda marcado', async () => {
  escribir('projects/P/borrada.jsonl', usuario('no me pierdas'));
  escribir('projects/P/sigue.jsonl', usuario('sigo acá'));
  await sync();
  cambiarOrigen('origen-sin-la-borrada');
  escribir('projects/P/sigue.jsonl', usuario('sigo acá'));
  const r = await sync();
  assert.equal(r.destinos[0].eliminadosEnOrigen, 1);
  assert.match(leer(enDest('claude/projects/P/borrada.jsonl')), /no me pierdas/);
  const indice = await leerJson(path.join(dest, '_estado', 'indice.json'));
  assert.ok(indice.conversaciones['claude/projects/P/borrada.jsonl'].eliminadaEnOrigen);
});

test('si se pierde el manifiesto no duplica contenido', async () => {
  const p = escribir('projects/P/s.jsonl', usuario('uno'));
  await sync();
  fs.appendFileSync(p, respuesta('dos'));
  fs.writeFileSync(path.join(dest, '_estado', 'manifiesto.json'), '{ roto');
  await sync();
  assert.equal(leer(enDest('claude/projects/P/s.jsonl')), leer(p));
});

test('si una copia anterior quedó a medias, la completa sin duplicar', async () => {
  const contenido = usuario('uno') + respuesta('dos') + respuesta('tres', 'm2');
  const p = escribir('projects/P/s.jsonl', contenido);
  fs.mkdirSync(path.dirname(enDest('claude/projects/P/s.jsonl')), { recursive: true });
  fs.writeFileSync(enDest('claude/projects/P/s.jsonl'), contenido.slice(0, 50));
  const r = await sync();
  assert.equal(r.destinos[0].agregados, 1);
  assert.equal(leer(enDest('claude/projects/P/s.jsonl')), leer(p));
});

test('la cantidad de archivos archivados nunca baja', async () => {
  escribir('projects/P/a.jsonl', usuario('a'));
  escribir('projects/P/b.jsonl', usuario('b'));
  escribir('app/local_x.json', '{"title":"T"}');
  await sync();
  const antes = contarArchivos(dest);
  cambiarOrigen('origen-casi-vacio'); // sin a.jsonl, con b.jsonl distinto y sin la carpeta de la app
  escribir('projects/P/b.jsonl', usuario('b distinto'));
  await sync();
  assert.ok(contarArchivos(dest) >= antes);
  assert.match(leer(enDest('claude/projects/P/a.jsonl')), /"a"/);
  assert.ok(fs.existsSync(enDest('app-escritorio/claude-code-sessions/local_x.json')));
});

test('las fuentes con versiones:false se actualizan sin guardar versión', async () => {
  const p = escribir('app/local_x.json', '{"title":"Viejo"}');
  await sync();
  fs.writeFileSync(p, '{"title":"Nuevo título más largo"}');
  const r = await sync();
  assert.equal(r.destinos[0].versionados, 0);
  assert.equal(leer(enDest('app-escritorio/claude-code-sessions/local_x.json')), '{"title":"Nuevo título más largo"}');
});

test('excluye carpetas configuradas', async () => {
  escribir('app/rpm/plugin.json', '{}');
  escribir('app/local_y.json', '{}');
  await sync();
  assert.ok(!fs.existsSync(enDest('app-escritorio/claude-code-sessions/rpm/plugin.json')));
  assert.ok(fs.existsSync(enDest('app-escritorio/claude-code-sessions/local_y.json')));
});

test('el título de la app de escritorio se usa si la conversación no tiene uno propio', async () => {
  escribir('projects/P/aaaaaaaa-1111-2222-3333-444444444444.jsonl', usuario('primer mensaje'));
  escribir('app/local_aaaaaaaa-1111-2222-3333-444444444444.json', JSON.stringify({ sessionId: 'local_aaaaaaaa-1111-2222-3333-444444444444', cliSessionId: 'aaaaaaaa-1111-2222-3333-444444444444', title: 'Título de la app' }));
  await sync();
  const indice = await leerJson(path.join(dest, '_estado', 'indice.json'));
  assert.equal(Object.values(indice.conversaciones)[0].titulo, 'Título de la app');
});

test('simular no escribe nada', async () => {
  escribir('projects/P/s.jsonl', usuario('uno'));
  const r = await sync({ simular: true });
  assert.equal(r.destinos[0].nuevos, 1);
  assert.ok(!fs.existsSync(path.join(dest, 'claude')));
});

test('un destino inexistente se informa y no rompe la sincronización', async () => {
  config.destinos = [path.join(base, 'no-existe', 'tampoco', 'destino'), dest];
  escribir('projects/P/s.jsonl', usuario('uno'));
  const r = await sync();
  assert.equal(r.destinos[0].disponible, false);
  assert.equal(r.destinos[1].nuevos, 1);
});
