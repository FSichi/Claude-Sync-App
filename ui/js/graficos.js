// Gráficos de una sola serie (un solo color, sin leyenda: el título dice qué es). Los usan Inicio y Estadísticas.
import { h } from './util.js';

// Barras verticales con un globo al pasar el mouse o al enfocar cada barra.
// puntos: [{ valor, titulo, lineas: [texto, ...] }]
export function barras(puntos, { descripcion, alto = 150 } = {}) {
  const max = Math.max(1, ...puntos.map((p) => p.valor));
  const globo = h('div', { class: 'globo', hidden: true, role: 'status' });
  const mostrar = (p, barra) => {
    globo.replaceChildren(h('strong', null, p.titulo), ...p.lineas.map((l) => h('span', null, l)));
    globo.hidden = false;
    const r = barra.getBoundingClientRect();
    const caja = barra.parentElement.getBoundingClientRect();
    globo.style.left = `${Math.min(Math.max(0, r.left - caja.left + r.width / 2 - 90), Math.max(0, caja.width - 180))}px`;
  };
  const ocultar = () => (globo.hidden = true);
  return h('div', { class: 'grafico', role: 'group', 'aria-label': descripcion, style: `height: ${alto}px` },
    globo,
    h('div', { class: 'barras' }, puntos.map((p) => h('div', {
      class: 'barra-dia',
      tabindex: '0',
      'aria-label': `${p.titulo}: ${p.lineas.join(', ')}`,
      onmouseenter: (ev) => mostrar(p, ev.currentTarget),
      onfocus: (ev) => mostrar(p, ev.currentTarget),
      onmouseleave: ocultar,
      onblur: ocultar,
    }, h('div', { class: 'barra-dia-valor', style: `height: ${p.valor ? Math.max(3, (p.valor / max) * 100) : 0}%` })))));
}

export const eje = (...etiquetas) => h('div', { class: 'eje' }, etiquetas.map((t) => h('span', null, t)));

// Filas con una barra horizontal proporcional al valor. items: [{ nombre, valor, derecha, abajo, alClic }]
export function filasConBarra(items) {
  const max = Math.max(1, ...items.map((x) => x.valor));
  return h('div', { class: 'tarjeta proyectos' }, items.map((x) => {
    const contenido = [
      h('div', { class: 'proyecto-cab' }, h('span', { class: 'proyecto-nombre', title: x.nombre }, x.nombre), x.derecha ? h('span', { class: 'tenue' }, x.derecha) : null),
      h('div', { class: 'proyecto-barra' }, h('div', { style: `width: ${Math.max(2, (x.valor / max) * 100)}%` })),
      x.abajo ? h('div', { class: 'proyecto-valor' }, x.abajo) : null,
    ];
    return x.alClic
      ? h('a', { class: 'proyecto', href: x.href ?? '#', onclick: (ev) => { ev.preventDefault(); x.alClic(); } }, contenido)
      : h('div', { class: 'proyecto' }, contenido);
  }));
}
