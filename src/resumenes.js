// Resúmenes de las conversaciones, hechos con el Claude Code de la persona (claude -p), solo cuando lo pide.
//  - Sin herramientas, sin servidores MCP y sin guardar la sesión: no aparece como una conversación nueva.
//  - Se corre siempre desde la misma carpeta de la app, para que Claude Code no cree carpetas nuevas en ~/.claude.
//  - Se guardan en _estado/resumenes.json de cada destino, junto con el resto del archivo.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { escribirAtomico, leerJson } from './archivos.js';

export const MODELOS_RESUMEN = ['haiku', 'sonnet', 'opus'];
const MAX_TEXTO = 80000;
const MAX_MENSAJE = 3000;
const ESPERA_MAX = 4 * 60 * 1000;

export const rutaResumenes = (dest) => path.join(dest, '_estado', 'resumenes.json');

// ---------- Encontrar Claude Code ----------

// CLAUDE_ARCHIVO_CLAUDE permite usar otro ejecutable (los tests usan un script de Node que hace de Claude).
export function buscarClaude() {
  const propio = process.env.CLAUDE_ARCHIVO_CLAUDE;
  if (propio) return fs.existsSync(propio) ? propio : null;
  const candidatos = [path.join(os.homedir(), '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude')];
  for (const dir of (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    for (const nombre of process.platform === 'win32' ? ['claude.exe', 'claude.cmd'] : ['claude']) candidatos.push(path.join(dir, nombre));
  }
  return candidatos.find((c) => fs.existsSync(c)) ?? null;
}

// Arma el comando: un .js se corre con este mismo Node; un .cmd necesita el intérprete de Windows.
function comando(ejecutable, args) {
  if (/\.(m?js)$/i.test(ejecutable)) return [process.execPath, [ejecutable, ...args], {}];
  if (/\.cmd$/i.test(ejecutable)) return [process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${ejecutable}"`, ...args.map((a) => `"${a}"`)], { windowsVerbatimArguments: true }];
  return [ejecutable, args, {}];
}

// Sin las variables de una sesión de Claude Code: si la app se abrió desde una, el hijo se negaría a arrancar.
function entorno() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^CLAUDECODE$|^CLAUDE_CODE_(ENTRYPOINT|SSE_PORT|SESSION)/.test(k)) delete env[k];
  return env;
}

export function versionDeClaude(ejecutable) {
  return new Promise((resolver) => {
    const [cmd, args, extra] = comando(ejecutable, ['--version']);
    const hijo = execFile(cmd, args, { ...extra, env: entorno(), timeout: 15000, windowsHide: true }, (error, salida) => resolver(error ? null : String(salida).trim().split('\n')[0]));
    hijo.stdin?.end(); // que no se quede esperando una entrada
  });
}

// ---------- Texto que se manda a resumir ----------

const recortar = (t, max) => (t.length > max ? `${t.slice(0, max)} […]` : t);

export function textoParaResumir(eventos, { nombreUsuario = 'Usuario' } = {}) {
  const partes = [];
  let herramientas = [];
  const cerrarHerramientas = () => {
    if (!herramientas.length) return;
    const nombres = [...new Set(herramientas)];
    partes.push(`[Claude usó ${herramientas.length === 1 ? 'una herramienta' : `${herramientas.length} herramientas`}: ${nombres.slice(0, 8).join(', ')}${nombres.length > 8 ? '…' : ''}]`);
    herramientas = [];
  };
  for (const ev of eventos) {
    if (ev.tipo === 'herramienta') {
      herramientas.push(ev.resumen ? `${ev.nombre} ${ev.resumen}`.slice(0, 120) : ev.nombre);
      continue;
    }
    if (ev.tipo !== 'usuario' && ev.tipo !== 'claude' && ev.tipo !== 'comando') continue;
    cerrarHerramientas();
    if (ev.tipo === 'usuario') partes.push(`${nombreUsuario}: ${recortar(ev.texto, MAX_MENSAJE)}`);
    else if (ev.tipo === 'claude') partes.push(`Claude: ${recortar(ev.texto, MAX_MENSAJE)}`);
    else partes.push(`[${nombreUsuario} corrió: ${ev.texto.slice(0, 200)}]`);
  }
  cerrarHerramientas();
  let texto = partes.join('\n\n');
  // Si es muy larga, se queda con el principio (qué se buscaba) y sobre todo con el final (cómo terminó).
  if (texto.length > MAX_TEXTO) {
    const inicio = Math.floor(MAX_TEXTO * 0.25);
    texto = `${texto.slice(0, inicio)}\n\n[… se omitió la parte del medio de la conversación …]\n\n${texto.slice(texto.length - (MAX_TEXTO - inicio))}`;
  }
  return texto;
}

const SISTEMA = 'Resumís conversaciones de trabajo entre una persona y Claude Code. Respondés solo con el resumen pedido, en español rioplatense, claro y concreto, sin preámbulos ni comentarios.';

function pedido({ titulo, cwd, nombreUsuario, texto }) {
  return [
    `Resumí esta conversación entre ${nombreUsuario} y Claude Code${titulo ? ` (título: "${titulo}")` : ''}${cwd ? `, en la carpeta ${cwd}` : ''}.`,
    '',
    'Devolvé exactamente este formato en Markdown, sin nada antes ni después:',
    '',
    '**En una línea:** qué se buscaba y cómo terminó.',
    '',
    '### Qué se hizo',
    '- (los pasos o resultados principales, de 2 a 6 viñetas)',
    '',
    '### Decisiones',
    '- (lo que se decidió y por qué; si no hubo, escribí "Ninguna en particular.")',
    '',
    '### Quedó pendiente',
    '- (lo que faltó o se dejó para después; si no hay, escribí "Nada pendiente.")',
    '',
    '<conversacion>',
    texto,
    '</conversacion>',
  ].join('\n');
}

// ---------- Llamar a Claude ----------

export class ErrorClaude extends Error {
  constructor(mensaje, tipo) {
    super(mensaje);
    this.tipo = tipo;
  }
}

function explicar(texto = '') {
  if (/auth|log ?in|oauth|credential|api key|401|403/i.test(texto)) {
    return new ErrorClaude('Claude Code no tiene la sesión iniciada en esta PC. Abrí una terminal, corré claude y entrá con tu cuenta; después volvé a probar.', 'sesion');
  }
  if (/rate|limit|429|overloaded|quota|usage/i.test(texto)) return new ErrorClaude(`Claude no puede responder ahora (límite de uso o mucha demanda). Probá más tarde. Detalle: ${texto.slice(0, 200)}`, 'limite');
  return new ErrorClaude(`Claude Code devolvió un error: ${texto.slice(0, 300) || 'sin detalle'}`, 'otro');
}

// Corre claude -p y devuelve { texto, uso }. señal: AbortSignal para cancelar.
export function preguntarAClaude(entrada, { ejecutable, modelo = 'haiku', carpeta, señal } = {}) {
  return new Promise((resolver, rechazar) => {
    if (!ejecutable) return rechazar(new ErrorClaude('No encontré Claude Code en esta PC. Instalalo desde https://claude.com/claude-code y volvé a probar.', 'falta'));
    fs.mkdirSync(carpeta, { recursive: true });
    const args = ['-p', '--model', modelo, '--no-session-persistence', '--tools', '', '--strict-mcp-config', '--setting-sources', 'project', '--output-format', 'json', '--system-prompt', SISTEMA];
    const [cmd, argumentos, extra] = comando(ejecutable, args);
    const hijo = spawn(cmd, argumentos, { ...extra, cwd: carpeta, env: entorno(), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let salida = '';
    let errores = '';
    const temporizador = setTimeout(() => hijo.kill(), ESPERA_MAX);
    const alCancelar = () => hijo.kill();
    señal?.addEventListener('abort', alCancelar);
    hijo.stdout.on('data', (d) => (salida += d));
    hijo.stderr.on('data', (d) => (errores += d));
    hijo.on('error', (e) => rechazar(new ErrorClaude(`No se pudo abrir Claude Code: ${e.message}`, 'falta')));
    hijo.on('close', (codigo) => {
      clearTimeout(temporizador);
      señal?.removeEventListener('abort', alCancelar);
      if (señal?.aborted) return rechazar(new ErrorClaude('Cancelado.', 'cancelado'));
      let r;
      try {
        r = JSON.parse(salida);
      } catch {
        return rechazar(explicar(errores.trim() || salida.trim() || `terminó con código ${codigo}`));
      }
      if (r.is_error || !r.result) return rechazar(explicar(String(r.result ?? r.subtype ?? '')));
      resolver({ texto: String(r.result).trim(), uso: r.usage ?? null });
    });
    hijo.stdin.end(entrada);
  });
}

export async function resumir({ eventos, titulo, cwd, nombreUsuario, ...opciones }) {
  const texto = textoParaResumir(eventos, { nombreUsuario });
  if (!texto.trim()) throw new ErrorClaude('La conversación no tiene mensajes para resumir.', 'vacia');
  return preguntarAClaude(pedido({ titulo, cwd, nombreUsuario, texto }), opciones);
}

// ---------- Guardar y leer ----------

export async function leerResumenes(dest) {
  return (await leerJson(rutaResumenes(dest), null))?.resumenes ?? {};
}

// Agrega o reemplaza resúmenes en cada destino que ya tiene copias, sin perder los que ya había.
export async function guardarResumenes(destinos, nuevos) {
  for (const dest of destinos) {
    try {
      await fsp.access(path.join(dest, '_estado'));
    } catch {
      continue;
    }
    const actuales = await leerResumenes(dest);
    await escribirAtomico(rutaResumenes(dest), JSON.stringify({ version: 1, resumenes: { ...actuales, ...nuevos } }));
  }
}
