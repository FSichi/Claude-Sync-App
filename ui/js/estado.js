// Estado compartido de la interfaz y las acciones que lo actualizan. Las vistas escuchan eventos.
import { api, post, toast, numero, tamano, plural } from './util.js';

export const est = {
  app: null, // /api/estado
  conversaciones: [],
  principal: null,
  actualizacion: null, // /api/actualizacion
  sincronizandoAntes: false,
  comprobandoAntes: false,
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
    if (est.comprobandoAntes && !e.comprobando) alTerminarComprobacion(e);
    if (e.progresoComprobacion) est.faseComprobacion = e.progresoComprobacion.fase;
    est.sincronizandoAntes = e.sincronizando;
    est.comprobandoAntes = e.comprobando;
    emit('estado', e);
    if (est.resumiendoAntes && !e.resumenes?.enCurso) alTerminarResumenes(e.resumenes);
    est.resumiendoAntes = Boolean(e.resumenes?.enCurso);
    const pronto = e.sincronizando || e.comprobando || e.actualizacion ? 700 : e.resumenes?.enCurso ? 1500 : !e.pendientes ? 2500 : 30000;
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
    api('/api/archivos?modo=cambiados').then((r) => {
      est.archivosCambiados = r.faltaIndice ? null : r.total;
      emit('conversaciones', est.conversaciones);
    }).catch(() => {});
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

// Comprobar o reparar las copias de los destinos (índices de config.destinos; vacío = todos).
export async function comprobarCopias(destinos, fondo) {
  try {
    await post('/api/comprobar', { destinos, fondo });
    est.comprobandoAntes = true;
    await actualizarEstado();
  } catch (e) {
    toast(e.message, 'error');
  }
}
export async function repararCopias(destino) {
  try {
    await post('/api/reparar', { destino });
    est.comprobandoAntes = true;
    await actualizarEstado();
  } catch (e) {
    toast(e.message, 'error');
  }
}

function alTerminarComprobacion(e) {
  const que = est.faseComprobacion === 'reparando' ? 'reparación' : 'comprobación';
  est.faseComprobacion = null;
  if (e.errorComprobacion) toast(`La ${que} falló: ${e.errorComprobacion}`, 'error');
  else {
    const problemas = e.destinos.reduce((s, d) => s + (d.comprobacion?.problemas ?? 0), 0);
    const pendientes = e.destinos.reduce((s, d) => s + (d.comprobacion?.alSincronizar ?? 0), 0);
    const titulo = que === 'reparación' ? 'Reparación terminada' : 'Comprobación terminada';
    if (!problemas) toast(`${titulo}: las copias están bien.`, 'ok');
    else if (pendientes === problemas) toast(`${titulo}: ${plural(problemas, 'archivo se pone', 'archivos se ponen')} al día en la próxima sincronización.`, 'info');
    else toast(`${titulo}: ${plural(problemas, 'archivo sigue', 'archivos siguen')} con problemas. Mirá Ajustes → Comprobar copias.`, 'error');
  }
  emit('comprobacion-terminada', e);
}

function alTerminarResumenes(t) {
  if (!t) return;
  if (t.motivo) toast(`Los resúmenes se frenaron: ${t.motivo}`, 'error');
  else toast(`${t.cancelado ? 'Resúmenes cancelados' : 'Resúmenes terminados'}: ${plural(t.hechos - t.errores, 'hecho', 'hechos')}${t.errores ? `, ${plural(t.errores, 'con error', 'con error')}` : ''}.`, t.errores ? 'error' : 'ok');
  cargarConversaciones();
}

export const ultimaSincronizacion = (e) => {
  const fechas = (e?.destinos ?? []).map((d) => d.ultimaSync).filter(Boolean).sort();
  return fechas[fechas.length - 1] ?? null;
};
