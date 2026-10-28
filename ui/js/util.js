// Utilidades compartidas: API, DOM, formatos, preferencias y avisos.
import { icono } from './iconos.js';

export const TOKEN = document.querySelector('meta[name="token"]').content;
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const enc = encodeURIComponent;

export async function api(ruta, opciones = {}) {
  const r = await fetch(ruta, {
    ...opciones,
    headers: { 'X-Token': TOKEN, ...(opciones.body ? { 'Content-Type': 'application/json' } : {}) },
  });
  const esJson = (r.headers.get('content-type') || '').includes('json');
  const datos = esJson ? await r.json() : await r.text();
  if (!r.ok) throw new Error((esJson && datos.error) || `Error ${r.status}`);
  return datos;
}
export const post = (ruta, datos = {}) => api(ruta, { method: 'POST', body: JSON.stringify(datos) });

// Crea elementos sin innerHTML (salvo "html", que solo recibe el HTML ya escapado de markdown()).
export function h(tag, attrs, ...hijos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value') continue; // se asigna al final, cuando un <select> ya tiene sus opciones
    else if (k === 'checked') el.checked = Boolean(v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const hijo of hijos.flat(Infinity)) {
    if (hijo == null || hijo === false) continue;
    el.append(hijo instanceof Node ? hijo : String(hijo));
  }
  if (attrs && attrs.value != null) el.value = attrs.value;
  return el;
}

// Como replaceChildren, pero ignora null/false y aplana listas (replaceChildren los convertiría en texto).
export function reemplazar(el, ...hijos) {
  el.replaceChildren(...hijos.flat(Infinity).filter((x) => x != null && x !== false));
  return el;
}

export const navegar = (ruta) => {
  if (location.hash !== ruta) location.hash = ruta;
};
export const rutaConversacion = (clave) => `#/conversaciones/${enc(clave)}`;

// ---------- Formatos ----------
export const numero = (n) => (n ?? 0).toLocaleString('es-AR');
export function tamano(b) {
  if (b == null) return '';
  if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toLocaleString('es-AR', { maximumFractionDigits: 1 })} MB`;
  return `${(b / 1024 ** 3).toLocaleString('es-AR', { maximumFractionDigits: 2 })} GB`;
}
const dos = (n) => String(n).padStart(2, '0');
const hora = (d) => `${dos(d.getHours())}:${dos(d.getMinutes())}`;
const mismoDia = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
export function fechaCorta(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const hoy = new Date();
  if (mismoDia(d, hoy)) return `hoy ${hora(d)}`;
  if (mismoDia(d, new Date(hoy.getTime() - 86400000))) return 'ayer';
  const o = d.getFullYear() === hoy.getFullYear() ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' };
  return d.toLocaleDateString('es-AR', o);
}
export function fechaLarga(iso) {
  if (!iso) return '?';
  return new Date(iso).toLocaleString('es-AR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
export function fechaDia(iso) {
  if (!iso) return '';
  return new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' });
}
export function hace(iso) {
  if (!iso) return null;
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'hace instantes';
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  const dias = Math.round(s / 86400);
  return dias === 1 ? 'hace 1 día' : `hace ${dias} días`;
}
export function mes(iso) {
  if (!iso) return 'Sin fecha';
  const t = new Date(iso).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  return t.charAt(0).toUpperCase() + t.slice(1);
}
export const normalizar = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
export const plural = (n, uno, varios) => `${numero(n)} ${n === 1 ? uno : varios}`;

export function nombreCarpeta(c) {
  const cwd = c.cwd || '';
  if (/scratch-workspaces/i.test(cwd)) return 'Sin carpeta';
  if (/local-agent-mode-sessions/i.test(cwd)) return 'Cowork';
  if (cwd) {
    const partes = cwd.split(/[\\/]+/).filter(Boolean);
    const i = partes.findIndex((p) => /^(escritorio|desktop)$/i.test(p));
    const usar = i >= 0 && i < partes.length - 1 ? partes.slice(i + 1) : partes;
    return usar.slice(-2).join(' › ') || cwd;
  }
  if (c.proyecto) return c.proyecto.replace(/^[A-Za-z]--Users-[^-]+-(OneDrive-Escritorio-)?/, '').replace(/-/g, ' ') || c.proyecto;
  return 'Sin carpeta';
}

// ---------- Preferencias del navegador (solo comodidades: tema, filtros, vista) ----------
export function leerPref(clave, defecto) {
  try {
    const v = localStorage.getItem(`pref:${clave}`);
    return v == null ? defecto : JSON.parse(v);
  } catch {
    return defecto;
  }
}
export function guardarPref(clave, valor) {
  try {
    localStorage.setItem(`pref:${clave}`, JSON.stringify(valor));
  } catch {}
}

export function aplicarTema(pref) {
  guardarPref('tema', pref);
  const claro = pref === 'claro' || (pref === 'sistema' && matchMedia('(prefers-color-scheme: light)').matches);
  document.documentElement.dataset.tema = claro ? 'claro' : 'oscuro';
}

// ---------- Avisos flotantes ----------
export function toast(mensaje, tipo = 'info') {
  const nombre = tipo === 'error' ? 'alerta' : tipo === 'ok' ? 'check' : 'info';
  const t = h('div', { class: `toast ${tipo}`, role: tipo === 'error' ? 'alert' : 'status' }, icono(nombre, 16), h('span', null, mensaje));
  $('#toasts').append(t);
  setTimeout(() => t.remove(), tipo === 'error' ? 9000 : 5000);
}
export const avisarError = (e) => toast(e.message || String(e), 'error');

export async function copiar(texto, aviso = 'Copiado') {
  try {
    await navigator.clipboard.writeText(texto);
    toast(aviso, 'ok');
  } catch {
    toast('No se pudo copiar al portapapeles', 'error');
  }
}
