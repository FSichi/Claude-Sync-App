// Barra lateral: navegación, estado de la copia y botón de sincronizar.
// En Conversaciones se achica a íconos; en Ajustes muestra las secciones de Ajustes.
import { h, $, numero, tamano, hace, reemplazar } from './util.js';
import { icono } from './iconos.js';
import { est, sincronizarAhora, ultimaSincronizacion } from './estado.js';

export const SECCIONES_AJUSTES = [
  { id: 'general', texto: 'General', icono: 'usuario' },
  { id: 'destinos', texto: 'Destinos', icono: 'disco' },
  { id: 'comprobar', texto: 'Comprobar copias', icono: 'escudo' },
  { id: 'copia', texto: 'Qué se copia', icono: 'lista' },
  { id: 'app', texto: 'App', icono: 'caja' },
  { id: 'avanzado', texto: 'Avanzado', icono: 'terminal' },
];

const FASES = {
  listando: 'Revisando qué hay en Claude',
  comparando: 'Comparando con el archivo',
  copiando: 'Copiando',
  indexando: 'Armando el índice',
};

function estadoCopia(e) {
  if (!e) return { clase: 'acento', texto: 'Conectando…', detalle: '' };
  if (est.conexionPerdida) return { clase: 'peligro', texto: 'Sin conexión', detalle: 'Cerrá y volvé a abrir la app' };
  if (e.sincronizando) {
    const p = e.progreso || {};
    const fraccion = p.fase === 'copiando' && p.bytesTotal ? p.bytesHechos / p.bytesTotal : p.fase === 'indexando' && p.total ? p.hechos / p.total : null;
    const detalle = p.fase === 'copiando' ? `${numero(p.hechos)} de ${numero(p.total)} · ${tamano(p.bytesHechos)} de ${tamano(p.bytesTotal)}` : FASES[p.fase] ?? '';
    return { clase: 'acento', texto: fraccion != null ? `Sincronizando ${Math.round(fraccion * 100)} %` : 'Sincronizando…', detalle, fraccion, sincronizando: true };
  }
  if (e.comprobando) {
    const p = e.progresoComprobacion || {};
    const fraccion = p.bytesTotal ? p.bytesHechos / p.bytesTotal : p.total ? p.hechos / p.total : null;
    const reparando = p.fase === 'reparando';
    return {
      clase: 'acento',
      texto: `${reparando ? 'Reparando' : 'Comprobando'}${fraccion != null ? ` ${Math.round(fraccion * 100)} %` : '…'}`,
      detalle: p.destino ? `${reparando ? 'Reparando' : 'Revisando'} ${p.destino}` : '',
      fraccion,
      sincronizando: true,
      boton: reparando ? 'Reparando…' : 'Comprobando…',
    };
  }
  if (!e.destinos.length) return { clase: 'alerta', texto: 'Sin destinos', detalle: 'Elegí dónde guardar' };
  if (e.error || e.ultimo?.destinos.some((d) => d.errores.length)) return { clase: 'peligro', texto: 'Con errores', detalle: 'Mirá el inicio' };
  if (e.destinos.some((d) => !d.disponible)) return { clase: 'alerta', texto: 'Falta un destino', detalle: e.destinos.find((d) => !d.disponible).ruta };
  const ultima = ultimaSincronizacion(e);
  if (!ultima) return { clase: 'alerta', texto: 'Sin copia todavía', detalle: '' };
  const pend = e.pendientes?.conversaciones ?? 0;
  if (e.riesgo?.pronto) return { clase: 'peligro', texto: `${numero(e.riesgo.pronto)} en riesgo`, cuando: hace(ultima), detalle: 'Claude Code puede borrarlas pronto' };
  if (pend) return { clase: 'alerta', texto: `${numero(pend)} con cambios`, cuando: hace(ultima), detalle: 'Sin respaldar todavía' };
  return { clase: '', texto: 'Al día', cuando: hace(ultima), detalle: '' };
}

function enlace(href, nombreIcono, texto, { actual, contador, punto, compacta } = {}) {
  return h('a', { href, class: 'rail-link', 'aria-current': actual ? 'page' : null, 'aria-label': compacta ? texto : null, title: compacta ? texto : null },
    icono(nombreIcono, compacta ? 18 : 16),
    compacta ? null : h('span', { class: 'texto' }, texto),
    contador != null && !compacta ? h('span', { class: 'contador' }, contador) : null,
    punto ? h('span', { class: 'punto', title: 'Hay una versión nueva' }) : null);
}

function botonSincronizar(compacta, s) {
  const deshabilitado = s.sincronizando || !est.app?.destinos.length || est.conexionPerdida;
  if (compacta) {
    return h('button', { type: 'button', class: `btn btn-fantasma btn-icono sync-compacto${s.sincronizando ? ' girando' : ''}`, disabled: deshabilitado, 'aria-label': `Sincronizar ahora (${s.texto})`, title: `${s.texto}${s.cuando ? ` · ${s.cuando}` : ''}`, onclick: sincronizarAhora },
      icono('sincronizar', 18), h('span', { class: `estado-punto ${s.clase}` }));
  }
  return h('div', { class: 'sync-tarjeta' },
    h('div', { class: 'sync-estado' }, h('span', { class: `estado-punto ${s.clase}` }), h('span', null, s.texto), s.cuando ? h('span', { class: 'tenue' }, s.cuando) : null),
    s.detalle ? h('div', { class: 'sync-detalle', title: s.detalle }, s.detalle) : null,
    s.sincronizando ? h('div', { class: `barra${s.fraccion == null ? ' indeterminada' : ''}` }, h('div', { class: 'barra-relleno', style: s.fraccion != null ? `width: ${Math.round(s.fraccion * 100)}%` : null })) : null,
    h('button', { type: 'button', class: `btn btn-primario btn-ancho${s.sincronizando ? ' girando' : ''}`, disabled: deshabilitado, title: est.app?.destinos.length ? null : 'Primero elegí dónde guardar las copias', onclick: sincronizarAhora },
      icono('sincronizar', 15, 2), s.sincronizando ? s.boton ?? 'Sincronizando…' : 'Sincronizar'));
}

const problemasEnCopias = (e) => (e?.destinos ?? []).reduce((s, d) => s + (d.comprobacion?.problemas ?? 0), 0);

export function pintarRail(ruta) {
  const rail = $('#rail');
  const e = est.app;
  const hayVersion = Boolean(est.actualizacion?.hayNueva);
  const s = estadoCopia(e);

  if (ruta.seccion === 'ajustes') {
    rail.className = 'rail';
    const actual = ruta.param || 'general';
    reemplazar(rail, 
      h('a', { href: '#/inicio', class: 'rail-volver' }, icono('izquierda', 15), 'Volver al inicio'),
      h('div', { class: 'rail-titulo' }, 'Ajustes'),
      SECCIONES_AJUSTES.map((x) => enlace(`#/ajustes/${x.id}`, x.icono, x.texto, {
        actual: actual === x.id,
        contador: x.id === 'destinos' ? e?.destinos.length : x.id === 'comprobar' ? problemasEnCopias(e) || null : null,
        punto: x.id === 'app' && hayVersion,
      })),
      h('div', { class: 'rail-pie' }, botonSincronizar(false, s)));
    return;
  }

  const compacta = ruta.seccion === 'conversaciones' || ruta.seccion === 'archivos';
  rail.className = `rail${compacta ? ' compacta' : ''}`;
  const visibles = est.conversaciones.filter((c) => !c.vacia).length;
  reemplazar(rail, 
    h('a', { href: '#/inicio', class: 'marca', 'aria-label': compacta ? 'Claude Archivo, inicio' : null },
      h('span', { class: 'marca-logo' }, icono('archivo', 16, 2)),
      compacta ? null : h('span', { class: 'marca-texto' }, 'Claude Archivo')),
    enlace('#/inicio', 'inicio', 'Inicio', { actual: ruta.seccion === 'inicio', compacta }),
    enlace('#/conversaciones', 'chat', 'Conversaciones', { actual: ruta.seccion === 'conversaciones', contador: visibles ? numero(visibles) : null, compacta }),
    enlace('#/archivos', 'archivo_codigo', 'Archivos', { actual: ruta.seccion === 'archivos', compacta }),
    enlace('#/ajustes/general', 'ajustes', 'Ajustes', { punto: hayVersion, compacta }),
    h('div', { class: 'rail-pie' }, botonSincronizar(compacta, s)));
}
