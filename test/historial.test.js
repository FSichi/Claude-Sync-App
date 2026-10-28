import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analizar } from '../src/parser.js';
import { aplicarCambios, indiceDeArchivos, lineaDeTiempo } from '../src/historial.js';

const SESION = 'aaaaaaaa-1111-2222-3333-444444444444';
const RUTA = 'C:\\Proyecto\\app.js';
const linea = (o) => JSON.stringify({ sessionId: SESION, ...o }) + '\n';
const herramienta = (id, name, input, ts, msg = `m-${id}`) =>
  linea({ type: 'assistant', timestamp: ts, message: { id: msg, model: 'claude-test', content: [{ type: 'tool_use', id, name, input }], usage: { input_tokens: 10, output_tokens: 5 } } });
const resultado = (id, error = false) => linea({ type: 'user', timestamp: '2026-10-01T10:00:00.000Z', message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: error, content: 'ok' }] } });

test('cuenta los tokens una vez por mensaje y junta los archivos que tocó Claude', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-archivo-historial-'));
  const abs = path.join(dir, `${SESION}.jsonl`);
  const parte = (bloque, usage) => linea({ type: 'assistant', timestamp: '2026-10-01T10:00:00.000Z', message: { id: 'msg-1', model: 'claude-test', content: [bloque], usage } });
  fs.writeFileSync(abs,
    // Una respuesta en dos líneas: la segunda trae el total de salida.
    parte({ type: 'text', text: 'Leo y edito.' }, { input_tokens: 100, output_tokens: 3, cache_read_input_tokens: 50 }) +
    parte({ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: 'c:/proyecto/APP.js', old_string: 'a', new_string: 'b' } }, { input_tokens: 100, output_tokens: 40, cache_read_input_tokens: 50 }) +
    herramienta('t2', 'Read', { file_path: RUTA }, '2026-10-01T10:01:00.000Z') +
    linea({ type: 'file-history-snapshot', snapshot: { messageId: 'u1', timestamp: '2026-10-01T10:02:00.000Z', trackedFileBackups: { 'C:\\Otro\\nota.md': { backupFileName: 'x@v1', version: 1 } } } }));
  const { resumen } = await analizar(abs);
  const uso = resumen.uso.find((u) => u.modelo === 'claude-test');
  assert.equal(uso.respuestas, 2, 'dos mensajes distintos');
  assert.equal(uso.entrada, 110);
  assert.equal(uso.salida, 45, 'del primer mensaje cuenta el total, no la suma de sus líneas');
  assert.equal(uso.cacheLectura, 50);
  const app = resumen.archivos.find((a) => a.ruta.toLowerCase().endsWith('app.js'));
  assert.equal(app.editado, 1);
  assert.equal(app.leido, 1, 'la misma ruta con otras mayúsculas y barras es el mismo archivo');
  assert.ok(resumen.archivos.find((a) => a.ruta === 'C:\\Otro\\nota.md').checkpoint);
});

test('aplica los Edit como Claude Code, y avisa cuando no puede', () => {
  assert.equal(aplicarCambios('uno dos uno', [{ old_string: 'uno', new_string: '1' }]), '1 dos uno');
  assert.equal(aplicarCambios('uno dos uno', [{ old_string: 'uno', new_string: '1', replace_all: true }]), '1 dos 1');
  assert.equal(aplicarCambios('a\r\nb\r\n', [{ old_string: 'a\nb', new_string: 'x\ny' }]), 'x\r\ny\r\n');
  assert.equal(aplicarCambios('precio $1', [{ old_string: '$1', new_string: '$$2' }]), 'precio $$2', 'los $ del reemplazo no son patrones');
  assert.equal(aplicarCambios('hola', [{ old_string: 'chau', new_string: 'x' }]), null);
  assert.equal(aplicarCambios('a b', [{ old_string: 'a', new_string: 'c' }, { old_string: 'c b', new_string: 'listo' }]), 'listo');
});

test('reconstruye las versiones de un archivo con checkpoints, Write y Edit', async () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-archivo-historial-'));
  const rel = `claude/projects/C--Proyecto/${SESION}.jsonl`;
  const abs = path.join(dest, ...rel.split('/'));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const checkpoints = path.join(dest, 'claude', 'file-history');
  fs.mkdirSync(path.join(checkpoints, SESION), { recursive: true });
  fs.writeFileSync(path.join(checkpoints, SESION, 'abc@v2'), 'const a = 2;\n');
  fs.writeFileSync(abs,
    herramienta('w', 'Write', { file_path: RUTA, content: 'const a = 1;\n' }, '2026-10-01T10:00:00.000Z') + resultado('w') +
    herramienta('e1', 'Edit', { file_path: RUTA, old_string: '1', new_string: '2' }, '2026-10-01T10:01:00.000Z') + resultado('e1') +
    herramienta('e2', 'Edit', { file_path: RUTA, old_string: 'no existe', new_string: 'x' }, '2026-10-01T10:02:00.000Z') + resultado('e2', true) +
    linea({ type: 'user', uuid: 'u2', timestamp: '2026-10-01T10:05:00.000Z', message: { content: 'seguí' } }) +
    // El respaldo se registra después de la edición, pero es el estado al empezar el mensaje u2.
    linea({ type: 'file-history-snapshot', snapshot: { messageId: 'u2', timestamp: '2026-10-01T10:05:00.000Z', trackedFileBackups: { [RUTA]: { backupFileName: 'abc@v2', version: 2, backupTime: '2026-10-01T10:06:00.000Z' } } } }) +
    herramienta('e3', 'Edit', { file_path: RUTA, old_string: 'const', new_string: 'let' }, '2026-10-01T10:05:30.000Z') + resultado('e3'));

  const { resumen } = await analizar(abs);
  const mapa = indiceDeArchivos({ [rel]: { clave: rel, id: SESION, titulo: 'Prueba', archivos: resumen.archivos } });
  const archivo = mapa.get('c:\\proyecto\\app.js');
  assert.equal(archivo.conversaciones.length, 1);

  const { versiones, enDisco } = await lineaDeTiempo(archivo, { dest, carpetasCheckpoints: [checkpoints] });
  assert.deepEqual(versiones.map((v) => v.tipo), ['escrito', 'editado', 'checkpoint', 'editado'], 'el Edit con error no cuenta');
  assert.equal(versiones[1].texto, 'const a = 2;\n');
  assert.equal(versiones[1].exacta, false, 'lo que sale de un Edit es reconstruido');
  assert.equal(versiones[2].coincide, true, 'el checkpoint confirma la reconstrucción');
  assert.equal(versiones.at(-1).texto, 'let a = 2;\n');
  assert.equal(enDisco, null, 'el archivo original no existe');
});

test('los archivos que tocan los subagentes cuentan para su conversación', () => {
  const rel = 'claude/projects/C--P/s1.jsonl';
  const mapa = indiceDeArchivos(
    { [rel]: { clave: rel, id: 's1', titulo: 'Con subagente', archivos: [{ ruta: RUTA, leido: 1, escrito: 0, editado: 0, ultima: '2026-10-01T10:00:00.000Z' }] } },
    { 'claude/projects/C--P/s1/subagents/agent-1.jsonl': { sesion: 'claude/projects/C--P/s1', archivos: [{ ruta: RUTA, leido: 0, escrito: 0, editado: 3, ultima: '2026-10-01T11:00:00.000Z' }] } },
  );
  const a = mapa.get('c:\\proyecto\\app.js');
  assert.equal(a.editado, 3);
  assert.equal(a.conversaciones.length, 1);
  assert.equal(a.conversaciones[0].rels.length, 2);
});
