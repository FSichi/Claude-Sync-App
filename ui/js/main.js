// Arranque: rutas (#/inicio, #/conversaciones/<clave>, #/ajustes/<sección>), atajos y latido.
import { $, navegar, post } from './util.js';
import { est, on, actualizarEstado, cargarConversaciones } from './estado.js';
import { pintarRail } from './rail.js';
import { pintarInicio } from './inicio.js';
import { pintarConversaciones, refrescarLista, enfocarBusqueda } from './conversaciones.js';
import { pintarAjustes, repintarAjustes, seccionDeAjustes, alLlegarEstado } from './ajustes.js';
import { comprobarActualizacion, avisarSiHayVersion, mostrarNovedadesSiCorresponde } from './actualizacion.js';
import { cerrarSuperior, hayCapas } from './capas.js';

function rutaActual() {
  const partes = location.hash.replace(/^#\/?/, '').split('/');
  const seccion = ['inicio', 'conversaciones', 'ajustes'].includes(partes[0]) ? partes[0] : 'inicio';
  let param = partes.slice(1).join('/') || null;
  if (param) {
    try {
      param = decodeURIComponent(param);
    } catch {
      param = null;
    }
  }
  return { seccion, param };
}

// Inicio se vuelve a pintar cuando cambia el estado: conserva lo que estabas escribiendo en el buscador.
function repintarInicio() {
  const previo = $('#buscar-inicio');
  const valor = previo?.value;
  const enfocado = previo && document.activeElement === previo;
  pintarInicio($('#vista'));
  const nuevo = $('#buscar-inicio');
  if (nuevo && valor) nuevo.value = valor;
  if (enfocado) nuevo?.focus();
}

let seccionPintada = null;
function render() {
  const r = rutaActual();
  const vista = $('#vista');
  pintarRail(r);
  if (r.seccion === 'conversaciones') pintarConversaciones(vista, r.param);
  else if (r.seccion === 'ajustes') pintarAjustes(vista, r.param);
  else repintarInicio();
  if (seccionPintada !== r.seccion || r.seccion === 'ajustes') vista.scrollTop = 0;
  seccionPintada = r.seccion;
}
window.addEventListener('hashchange', render);

on('estado', () => {
  const r = rutaActual();
  pintarRail(r);
  if (r.seccion === 'inicio') repintarInicio();
  if (r.seccion === 'ajustes') alLlegarEstado();
});
on('conversaciones', () => {
  const r = rutaActual();
  pintarRail(r);
  if (r.seccion === 'inicio') repintarInicio();
  if (r.seccion === 'conversaciones') refrescarLista();
});
on('actualizacion', () => {
  const r = rutaActual();
  pintarRail(r);
  if (r.seccion === 'inicio') repintarInicio();
  if (r.seccion === 'ajustes' && seccionDeAjustes() === 'app') repintarAjustes();
});
on('sincronizacion-terminada', () => {
  if (rutaActual().seccion === 'ajustes') repintarAjustes();
});

document.addEventListener('keydown', (e) => {
  const enCampo = e.target.closest?.('input, textarea, select, [contenteditable]');
  if (e.key === 'Escape') {
    if (hayCapas()) {
      e.preventDefault();
      cerrarSuperior();
      return;
    }
    const r = rutaActual();
    if (r.seccion === 'conversaciones' && r.param) navegar('#/conversaciones');
    else if (r.seccion !== 'inicio' && !enCampo) navegar('#/inicio');
    return;
  }
  if ((e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !enCampo)) {
    if (hayCapas()) return;
    e.preventDefault();
    const r = rutaActual();
    if (r.seccion === 'inicio') $('#buscar-inicio')?.focus();
    else {
      if (r.seccion !== 'conversaciones') navegar('#/conversaciones');
      setTimeout(enfocarBusqueda, 0);
    }
  }
});

// Latido: si la ventana se cierra, el servidor se apaga solo a los pocos minutos.
const latido = () => post('/api/latido').catch(() => {});
setInterval(latido, 20000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    latido();
    actualizarEstado();
  }
});

(async () => {
  render();
  await actualizarEstado();
  await cargarConversaciones();
  await mostrarNovedadesSiCorresponde();
  if (est.app?.buscarActualizaciones) {
    await comprobarActualizacion();
    avisarSiHayVersion();
  }
})();
