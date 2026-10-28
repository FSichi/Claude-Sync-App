import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analizar, clasificarTextoUsuario, tituloDe, aMarkdown } from '../src/parser.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-archivo-parser-'));
const archivo = (nombre, lineas, { ultimaAMedias = false } = {}) => {
  const p = path.join(dir, nombre);
  fs.writeFileSync(p, lineas.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + (ultimaAMedias ? '' : '\n'));
  return p;
};
const u = (content, extra = {}) => ({ type: 'user', sessionId: 's1', timestamp: '2026-10-01T10:00:00Z', cwd: 'C:\\P', message: { role: 'user', content }, ...extra });
const a = (content, extra = {}) => ({ type: 'assistant', sessionId: 's1', timestamp: '2026-10-01T10:00:01Z', message: { id: extra.id ?? 'm1', model: 'claude-x', role: 'assistant', content }, ...extra });

test('clasifica comandos, interrupciones y quita recordatorios del sistema', () => {
  assert.equal(clasificarTextoUsuario('<command-name>/compact</command-name><command-args>corto</command-args>').texto, '/compact corto');
  assert.equal(clasificarTextoUsuario('[Request interrupted by user]').tipo, 'interrupcion');
  assert.deepEqual(clasificarTextoUsuario('hola <system-reminder>secreto</system-reminder>'), { tipo: 'usuario', texto: 'hola' });
  assert.equal(clasificarTextoUsuario('<system-reminder>solo esto</system-reminder>'), null);
  assert.equal(clasificarTextoUsuario('<task-notification>x</task-notification>').tipo, 'sistema');
});

test('arma eventos, une herramientas con su resultado y tolera líneas dañadas', async () => {
  const p = archivo('conv.jsonl', [
    { type: 'custom-title', customTitle: 'Mi título', sessionId: 's1' },
    u('Armame el backup'),
    a([{ type: 'text', text: 'Dale.' }]),
    a([{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'dir', description: 'Lista archivos' } }], { id: 'm2' }),
    u([{ type: 'tool_result', tool_use_id: 't1', content: 'archivo.txt' }]),
    '{"esto no es json',
    u('Otra cosa', { isSidechain: true }),
    a([{ type: 'text', text: 'Listo.' }], { id: 'm3' }),
    '{"type":"user","incompleta"',
  ], { ultimaAMedias: true });
  const { resumen, eventos } = await analizar(p);
  assert.equal(tituloDe(resumen).titulo, 'Mi título');
  assert.equal(resumen.mensajesUsuario, 1);
  assert.equal(resumen.respuestas, 2);
  assert.equal(resumen.lineasDanadas, 1, 'la última línea incompleta no cuenta como dañada');
  assert.equal(resumen.lineasLaterales, 1);
  const herr = eventos.find((e) => e.tipo === 'herramienta');
  assert.equal(herr.resumen, 'Lista archivos');
  assert.equal(herr.resultado.texto, 'archivo.txt');
  const md = aMarkdown({ titulo: 'Mi título', clave: 'x', resumen, eventos, nombreUsuario: 'Ana' });
  assert.match(md, /### Ana/);
  assert.match(md, /🔧 \*\*Bash\*\* Lista archivos/);
});

test('el transcript de un subagente (todo lateral) se muestra entero', async () => {
  const p = archivo('agent-1.jsonl', [u('Investigá X', { isSidechain: true }), a([{ type: 'text', text: 'Encontré Y.' }], { isSidechain: true })]);
  const { resumen, eventos } = await analizar(p);
  assert.equal(resumen.primerPrompt, 'Investigá X');
  assert.equal(eventos.length, 2);
});
