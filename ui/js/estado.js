// Estado compartido de la interfaz y las acciones que lo actualizan. Las vistas escuchan eventos.
import { api, post, toast, numero, tamano } from './util.js';

export const est = {
  app: null, // /api/estado
  conversaciones: [],
  principal: null,
  actualizacion: null, // /api/actualizacion
  sincronizandoAntes: false,
  conexionPerdida: false,
};

const oyentes = new Map();
export function on(evento, fn) {
  if (!oyentes.has(evento)) oyentes.set(evento, new Set());
  oyentes.get(evento).add(fn);
  return () => oyentes.get(evento).delete(fn);
}
export function emit(evento, datos) {
  for (const fn of oyentes.get(evento) ?? []) {
    try {
      fn(datos);
    } catch (e) {
      console.error(e);
    }
  }
}

let temporizador = null;
export async function actualizarEstado() {
  clearTimeout(temporizador);
  try {
    const e = await api('/api/estado');
    est.app = e;
    est.conexionPerdida = false;
    if (est.sincronizandoAntes && !e.sincronizando) alTerminarSincronizacion(e);
    est.sincronizandoAntes = e.sincronizando;
    emit('estado', e);
    const pronto = e.sincronizando || e.actualizacion ? 700 : !e.pendientes ? 2500 : 30000;
    temporizador = setTimeout(actualizarEstado, pronto);
  } catch {
    est.conexionPerdida = true;
    emit('estado', est.app);
    temporizador = setTimeout(actualizarEstado, 5000);
  }
}

export async function cargarConversaciones() {
  try {
    const datos = await api('/api/conversaciones');
    est.conversaciones = datos.conversaciones;
    est.principal = datos.destino;
    emit('conversaciones', est.conversaciones);
  } catch (e) {
    toast(`No se pudo cargar la lista: ${e.message}`, 'error');
  }
}

export async function sincronizarAhora() {
  try {
    await post('/api/sincronizar');
    est.sincronizandoAntes = true;
    await actualizarEstado();
  } catch (e) {
    toast(e.message, 'error');
  }
}

function alTerminarSincronizacion(e) {
  if (e.error) {
    toast(`La sincronización falló: ${e.error}`, 'error');
  } else if (e.ultimo) {
    const partes = e.ultimo.destinos.map((d) => {
      if (!d.disponible) return `${d.destino}: no disponible`;
      const cambios = d.nuevos + d.agregados + d.reemplazados;
      return `${d.destino}: ${cambios ? `${numero(cambios)} archivos (${tamano(d.bytes)})` : 'ya estaba al día'}${d.errores.length ? `, ${d.errores.length} errores` : ''}`;
    });
    const errores = e.ultimo.destinos.some((d) => d.errores.length);
    toast(`Sincronización terminada. ${partes.join(' · ')}`, errores ? 'error' : 'ok');
  }
  emit('sincronizacion-terminada', e);
  cargarConversaciones();
}

export const ultimaSincronizacion = (e) => {
  const fechas = (e?.destinos ?? []).map((d) => d.ultimaSync).filter(Boolean).sort();
  return fechas[fechas.length - 1] ?? null;
};
