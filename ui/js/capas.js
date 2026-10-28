// Modales y cajones apilados. Esc o clic afuera cierra el de arriba; el foco vuelve adonde estaba.
import { h, $ } from './util.js';
import { icono } from './iconos.js';

const pila = [];

function montar(velo, panel, alCerrar) {
  const antes = document.activeElement;
  const capa = {
    velo,
    cerrar() {
      const i = pila.indexOf(capa);
      if (i === -1) return;
      pila.splice(i, 1);
      velo.remove();
      alCerrar?.();
      if (antes && document.contains(antes)) antes.focus();
    },
  };
  velo.addEventListener('mousedown', (e) => {
    if (e.target === velo) capa.cerrar();
  });
  pila.push(capa);
  $('#capas').append(velo);
  const foco = panel.querySelector('[autofocus]') || panel.querySelector('input, button:not([data-cerrar]), a[href], select');
  (foco || panel).focus();
  return capa;
}

const botonCerrar = (alClic) => h('button', { type: 'button', class: 'btn btn-fantasma btn-icono', 'aria-label': 'Cerrar', 'data-cerrar': true, onclick: alClic }, icono('cerrar', 16));

// contenido: nodo; cab: nodos extra arriba del título; pie: nodos del pie.
export function abrirModal({ titulo, contenido, cab = null, pie = null, ancho = 640, etiqueta, alCerrar } = {}) {
  let capa;
  const idTitulo = `titulo-${Math.random().toString(36).slice(2)}`;
  const panel = h('section', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titulo ? idTitulo : null, 'aria-label': titulo ? null : etiqueta, tabindex: '-1', style: `max-width: ${ancho}px` },
    h('header', { class: 'modal-cab' },
      h('div', { class: 'fila-sup' }, cab, botonCerrar(() => capa.cerrar())),
      titulo ? h('h2', { id: idTitulo }, titulo) : null),
    h('div', { class: 'modal-cuerpo' }, contenido),
    pie ? h('footer', { class: 'modal-pie' }, pie) : null);
  const velo = h('div', { class: 'velo' }, panel);
  capa = montar(velo, panel, alCerrar);
  capa.panel = panel;
  return capa;
}

export function abrirCajon({ titulo, contenido, pie = null, alCerrar } = {}) {
  let capa;
  const panel = h('aside', { class: 'cajon', role: 'dialog', 'aria-modal': 'true', 'aria-label': titulo, tabindex: '-1' },
    h('header', { class: 'cajon-cab' }, h('h2', null, titulo), botonCerrar(() => capa.cerrar())),
    h('div', { class: 'cajon-cuerpo' }, contenido),
    pie ? h('footer', { class: 'cajon-pie' }, pie) : null);
  const velo = h('div', { class: 'velo cajon-velo' }, panel);
  capa = montar(velo, panel, alCerrar);
  capa.panel = panel;
  return capa;
}

export function cerrarSuperior() {
  const capa = pila[pila.length - 1];
  if (!capa) return false;
  capa.cerrar();
  return true;
}

export const hayCapas = () => pila.length > 0;

export function confirmar({ titulo, texto, aceptar = 'Aceptar', peligro = false }) {
  return new Promise((resolver) => {
    let respondio = false;
    const responder = (v) => {
      respondio = true;
      capa.cerrar();
      resolver(v);
    };
    const capa = abrirModal({
      titulo,
      ancho: 480,
      contenido: h('p', { class: 'sutil' }, texto),
      pie: [
        h('button', { type: 'button', class: 'btn', onclick: () => responder(false) }, 'Cancelar'),
        h('button', { type: 'button', class: `btn ${peligro ? 'btn-peligro' : 'btn-primario'}`, autofocus: true, onclick: () => responder(true) }, aceptar),
      ],
      alCerrar: () => {
        if (!respondio) resolver(false);
      },
    });
  });
}
