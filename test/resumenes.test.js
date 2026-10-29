import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { textoParaResumir, preguntarAClaude, resumir, buscarClaude, guardarResumenes, leerResumenes } from '../src/resumenes.js';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-archivo-resumenes-'));
const carpeta = path.join(base, 'trabajo');

// Hace de "claude -p": guarda lo que recibió y responde como Claude Code con --output-format json.
const falso = path.join(base, 'claude-falso.mjs');
fs.writeFileSync(falso, `
import fs from 'node:fs';
let entrada = '';
process.stdin.on('data', (d) => (entrada += d)).on('end', () => {
  fs.writeFileSync(process.env.FALSO_REGISTRO, JSON.stringify({ args: process.argv.slice(2), entrada, cwd: process.cwd() }));
  const modo = process.env.FALSO_MODO;
  if (modo === 'sesion') console.log(JSON.stringify({ type: 'result', is_error: true, result: 'Failed to authenticate: OAuth session expired and could not be refreshed' }));
  else if (modo === 'roto') console.log('esto no es json');
  else console.log(JSON.stringify({ type: 'result', is_error: false, result: '  **En una línea:** se armó la prueba.  ', usage: { output_tokens: 12 } }));
});
`);
const registro = path.join(base, 'registro.json');
process.env.FALSO_REGISTRO = registro;
const leerRegistro = () => JSON.parse(fs.readFileSync(registro, 'utf8'));

test('arma el texto con los mensajes y agrupa las herramientas', () => {
  const t = textoParaResumir([
    { tipo: 'usuario', texto: 'Armame un backup' },
    { tipo: 'herramienta', nombre: 'Read', resumen: 'config.js' },
    { tipo: 'herramienta', nombre: 'Edit', resumen: 'config.js' },
    { tipo: 'pensamiento', texto: 'no va' },
    { tipo: 'claude', texto: 'Listo.' },
  ], { nombreUsuario: 'Ana' });
  assert.equal(t, 'Ana: Armame un backup\n\n[Claude usó 2 herramientas: Read config.js, Edit config.js]\n\nClaude: Listo.');
});

test('si la conversación es muy larga, conserva el principio y el final', () => {
  const eventos = Array.from({ length: 200 }, (_, i) => ({ tipo: 'usuario', texto: `mensaje ${i} ${'x'.repeat(900)}` }));
  const t = textoParaResumir(eventos, { nombreUsuario: 'Ana' });
  assert.ok(t.length < 81000);
  assert.ok(t.startsWith('Ana: mensaje 0 '));
  assert.ok(t.includes('mensaje 199 '));
  assert.ok(t.includes('se omitió la parte del medio'));
});

test('llama a Claude sin herramientas, sin guardar la sesión y desde la carpeta de la app', async () => {
  process.env.CLAUDE_ARCHIVO_CLAUDE = falso;
  assert.equal(buscarClaude(), falso);
  delete process.env.FALSO_MODO;
  const r = await resumir({ eventos: [{ tipo: 'usuario', texto: 'Hola' }, { tipo: 'claude', texto: 'Chau' }], titulo: 'Prueba', cwd: 'C:\\P', nombreUsuario: 'Ana', ejecutable: falso, modelo: 'haiku', carpeta });
  assert.equal(r.texto, '**En una línea:** se armó la prueba.');
  const { args, entrada, cwd } = leerRegistro();
  assert.ok(args.includes('--no-session-persistence'));
  assert.equal(args[args.indexOf('--tools') + 1], '', 'sin herramientas');
  assert.ok(args.includes('--strict-mcp-config'));
  assert.equal(args[args.indexOf('--model') + 1], 'haiku');
  assert.equal(fs.realpathSync(cwd), fs.realpathSync(carpeta));
  assert.match(entrada, /<conversacion>\nAna: Hola\n\nClaude: Chau\n<\/conversacion>/);
});

test('explica cuando Claude Code no tiene la sesión iniciada o responde algo raro', async () => {
  process.env.FALSO_MODO = 'sesion';
  await assert.rejects(preguntarAClaude('hola', { ejecutable: falso, carpeta }), (e) => e.tipo === 'sesion' && /corré claude/.test(e.message));
  process.env.FALSO_MODO = 'roto';
  await assert.rejects(preguntarAClaude('hola', { ejecutable: falso, carpeta }), (e) => e.tipo === 'otro');
  await assert.rejects(preguntarAClaude('hola', { ejecutable: null, carpeta }), (e) => e.tipo === 'falta');
  delete process.env.FALSO_MODO;
});

test('guarda los resúmenes en los destinos con copias, sin perder los anteriores', async () => {
  const d1 = path.join(base, 'destino-1');
  const d2 = path.join(base, 'destino-sin-copias');
  fs.mkdirSync(path.join(d1, '_estado'), { recursive: true });
  await guardarResumenes([d1, d2], { a: { texto: 'uno' } });
  await guardarResumenes([d1, d2], { b: { texto: 'dos' } });
  assert.deepEqual(Object.keys(await leerResumenes(d1)).sort(), ['a', 'b']);
  assert.equal(fs.existsSync(d2), false, 'no crea nada en un destino sin copias');
});
