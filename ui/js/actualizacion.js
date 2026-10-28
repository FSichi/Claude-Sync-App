// Versión nueva: consulta, modal con las novedades, actualización en un clic y "Novedades" después de actualizar.
import { h, api, post, fechaDia, tamano, leerPref, guardarPref, toast } from './util.js';
import { icono } from './iconos.js';
import { lineaSegura } from './markdown.js';
import { abrirModal } from './capas.js';
import { est, emit } from './estado.js';

const CLASE = { nuevo: 'nuevo', novedades: 'nuevo', mejoras: 'mejoras', mejora: 'mejoras', arreglos: 'arreglos', arreglo: 'arreglos', correcciones: 'arreglos' };

export function nodoNotas(secciones) {
  if (!secciones?.length) return h('p', { class: 'sutil' }, 'Esta versión no trae notas.');
  return h('div', { class: 'notas' }, secciones.map((s) =>
    h('div', { class: 'notas-seccion' },
      h('h3', { class: `notas-titulo ${CLASE[s.titulo.toLowerCase()] ?? ''}` }, s.titulo),
      h('ul', null, s.items.map((i) => h('li', { html: lineaSegura(i) }))))));
}

export async function comprobarActualizacion({ forzar = false } = {}) {
  try {
    est.actualizacion = await api(`/api/actualizacion${forzar ? '?forzar=1' : ''}`);
  } catch (e) {
    est.actualizacion = { error: e.message };
  }
  emit('actualizacion', est.actualizacion);
  return est.actualizacion;
}

// Al abrir la app: si hay una versión nueva, el modal aparece solo, salvo que se haya pospuesto hace poco.
export function avisarSiHayVersion() {
  const a = est.actualizacion;
  if (!a?.hayNueva) return;
  const pospuesta = leerPref('versionPospuesta', null);
  if (pospuesta?.version === a.ultima.version && Date.now() < pospuesta.hasta) return;
  abrirModalVersion();
}

function progreso(cuerpo, a) {
  const fases = { descargando: 'Descargando el instalador', verificando: 'Verificando que sea el original', instalando: 'Instalando' };
  const fraccion = a.fase === 'descargando' && a.total ? a.bytes / a.total : null;
  cuerpo.replaceChildren(h('div', { class: 'progreso-actualizacion' },
    h('div', null, fases[a.fase] ?? 'Preparando', a.fase === 'descargando' && a.total ? h('span', { class: 'tenue' }, ` · ${tamano(a.bytes)} de ${tamano(a.total)}`) : null),
    h('div', { class: `barra${fraccion == null ? ' indeterminada' : ''}` }, h('div', { class: 'barra-relleno', style: fraccion != null ? `width: ${Math.round(fraccion * 100)}%` : null })),
    a.fase === 'instalando' ? h('p', { class: 'sutil' }, 'La app se va a cerrar y volver a abrir sola en unos segundos. Podés cerrar esta ventana.') : null));
}

async function seguirActualizacion(cuerpo, pie, capa) {
  pie.replaceChildren(h('span', { class: 'nota' }, 'No cierres la app mientras se descarga.'));
  for (;;) {
    await new Promise((r) => setTimeout(r, 600));
    let e;
    try {
      e = await api('/api/estado');
    } catch {
      // El servidor ya se cerró para que el instalador reemplace los archivos.
      progreso(cuerpo, { fase: 'instalando' });
      setTimeout(() => window.close(), 4000);
      return;
    }
    const a = e.actualizacion;
    if (!a) continue;
    if (a.error) {
      cuerpo.replaceChildren(h('p', { class: 'mensaje error' }, a.error));
      pie.replaceChildren(h('button', { type: 'button', class: 'btn', onclick: () => capa.cerrar() }, 'Cerrar'));
      return;
    }
    progreso(cuerpo, a);
  }
}

export function abrirModalVersion() {
  const a = est.actualizacion;
  if (!a?.ultima) return;
  const u = a.ultima;
  const instalada = est.app?.instalada;
  const notas = h('div', null, nodoNotas(u.secciones));
  const pie = h('div', { style: 'display: contents' });
  let capa;
  const posponer = () => {
    guardarPref('versionPospuesta', { version: u.version, hasta: Date.now() + 3 * 86400000 });
    capa.cerrar();
  };
  pie.append(
    h('p', { class: 'nota' }, instalada
      ? `Baja el instalador${u.instalador ? ` (${tamano(u.instalador.tamano)})` : ''}, verifica que sea el original y reinicia la app. Tus copias y tu configuración no se tocan.`
      : 'Estás usando la app desde el código: actualizala con git pull, o instalá la versión nueva desde GitHub.'),
    h('button', { type: 'button', class: 'btn', onclick: posponer }, 'Más tarde'),
    instalada
      ? h('button', { type: 'button', class: 'btn btn-primario', onclick: async () => {
          try {
            await post('/api/actualizar');
            seguirActualizacion(notas, pie, capa);
          } catch (e) {
            toast(e.message, 'error');
          }
        } }, icono('descargar', 15, 2), 'Actualizar ahora')
      : h('a', { class: 'btn btn-primario', href: u.url, target: '_blank', rel: 'noopener noreferrer' }, icono('externo', 15), 'Ver en GitHub'));
  capa = abrirModal({
    titulo: 'Hay una versión nueva de Claude Archivo',
    ancho: 640,
    cab: [
      h('span', { class: 'version-chip' }, `${a.actual} → ${u.version}`),
      u.fecha ? h('span', { class: 'tenue', style: 'font-size: 12px' }, `Publicada el ${fechaDia(u.fecha)}`) : null,
    ],
    contenido: notas,
    pie,
  });
}

// Después de actualizar: muestra una vez las novedades de la versión instalada.
export async function mostrarNovedadesSiCorresponde() {
  const actual = est.app?.version;
  if (!actual) return;
  const vista = leerPref('versionVista', null);
  guardarPref('versionVista', actual);
  if (!vista || vista === actual) return;
  try {
    const { versiones } = await api('/api/novedades');
    const v = versiones.find((x) => x.version === actual);
    if (!v) return;
    let capa;
    capa = abrirModal({
      titulo: `Novedades de Claude Archivo ${actual}`,
      ancho: 600,
      cab: h('span', { class: 'version-chip' }, `Actualizada desde la ${vista}`),
      contenido: nodoNotas(v.secciones),
      pie: h('button', { type: 'button', class: 'btn btn-primario', onclick: () => capa.cerrar() }, 'Listo'),
    });
  } catch {}
}
