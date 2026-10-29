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

// Menú emergente anclado a un botón: flechas para moverse, Enter para elegir, Esc o clic afuera para cerrar.
// items: [{ texto, icono, accion | href, descargar, detalle, deshabilitado, peligro }] o '-' para separar.
export function abrirMenu(boton, items, { etiqueta = 'Acciones' } = {}) {
  let capa;
  const nodos = items.filter(Boolean).map((it) => {
    if (it === '-') return h('div', { class: 'menu-sep', role: 'separator' });
    const contenido = [icono(it.icono, 15), h('span', { class: 'menu-texto' }, it.texto, it.detalle ? h('span', { class: 'menu-detalle' }, it.detalle) : null)];
    const clase = `menu-item${it.peligro ? ' peligro' : ''}`;
    if (it.href) return h('a', { class: clase, role: 'menuitem', tabindex: '-1', href: it.href, download: it.descargar ? '' : null, onclick: () => capa.cerrar() }, contenido);
    return h('button', { type: 'button', class: clase, role: 'menuitem', tabindex: '-1', disabled: it.deshabilitado, onclick: () => { capa.cerrar(); it.accion(); } }, contenido);
  });
  const panel = h('div', { class: 'menu', role: 'menu', 'aria-label': etiqueta, tabindex: '-1' }, nodos);
  const velo = h('div', { class: 'velo velo-menu' }, panel);
  boton.setAttribute('aria-expanded', 'true');
  capa = montar(velo, panel, () => boton.setAttribute('aria-expanded', 'false'));
  const r = boton.getBoundingClientRect();
  const left = Math.max(8, Math.min(r.right - panel.offsetWidth, innerWidth - panel.offsetWidth - 8));
  const top = r.bottom + 6 + panel.offsetHeight > innerHeight - 8 ? Math.max(8, r.top - panel.offsetHeight - 6) : r.bottom + 6;
  Object.assign(panel.style, { left: `${left}px`, top: `${top}px` });
  panel.addEventListener('keydown', (e) => {
    const lista = [...panel.querySelectorAll('.menu-item:not(:disabled)')];
    const i = lista.indexOf(document.activeElement);
    const ir = (j) => lista[(j + lista.length) % lista.length]?.focus();
    if (e.key === 'ArrowDown') ir(i + 1);
    else if (e.key === 'ArrowUp') ir(i - 1);
    else if (e.key === 'Home') ir(0);
    else if (e.key === 'End') ir(-1);
    else if (e.key === 'Tab') capa.cerrar();
    else return;
    e.preventDefault();
  });
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
