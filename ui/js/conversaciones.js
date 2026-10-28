// Conversaciones: lista (búsqueda, filtros, orden) y lector a la derecha.
import { h, api, enc, plural, fechaCorta, mes, nombreCarpeta, rutaConversacion, toast, avisarError, reemplazar } from './util.js';
import { icono } from './iconos.js';
import { est } from './estado.js';
import { aplicar, chips, contarActivos, abrirFiltros, filtros, limpiarFiltros } from './filtros.js';
import { abrirEnLector, cerrarLector } from './visor.js';
import { etiquetasConversacion } from './inicio.js';

let ui = null;
let texto = '';
let busqueda = null; // { q, resultados }
let abierta = null;

function lectorVacio() {
  return h('div', { class: 'lector-vacio' },
    icono('chat', 40, 1.5),
    h('h2', null, 'Elegí una conversación'),
    h('p', null, 'Buscá por título o carpeta, o apretá Enter para buscar en todo el contenido. Con Esc cerrás la que tengas abierta.'));
}

function montar(vista) {
  const entrada = h('input', {
    type: 'search',
    id: 'buscar-lista',
    placeholder: 'Buscar',
    'aria-label': 'Buscar conversaciones: Enter busca en el contenido',
    autocomplete: 'off',
    oninput: (e) => {
      texto = e.target.value;
      busqueda = null;
      pintarLista();
    },
    onkeydown: (e) => {
      if (e.key === 'Enter') buscarContenido(e.target.value);
    },
  });
  const botonFiltros = h('button', { type: 'button', class: 'btn', 'aria-haspopup': 'dialog', onclick: () => abrirFiltros(est.conversaciones, pintarLista) });
  const chipsCont = h('div', { class: 'chips' });
  const info = h('div', { class: 'lista-info', role: 'status' });
  const lista = h('nav', { class: 'lista', 'aria-label': 'Lista de conversaciones' });
  const lector = h('section', { class: 'lector', id: 'lector', 'aria-label': 'Conversación' }, lectorVacio());
  const raiz = h('div', { class: 'conv' },
    h('aside', { class: 'lista-col' },
      h('div', { class: 'lista-cab' },
        h('div', { class: 'fila-controles' }, h('label', { class: 'campo' }, icono('buscar', 15), entrada), botonFiltros),
        chipsCont,
        info),
      lista),
    lector);
  vista.replaceChildren(raiz);
  ui = { raiz, entrada, botonFiltros, chipsCont, info, lista, lector };
  abierta = null;
  if (texto) entrada.value = texto;
}

function itemNodo(c, extra = null) {
  return h('a', {
    class: 'item',
    href: rutaConversacion(c.clave),
    'data-clave': c.clave,
    'aria-current': abierta === c.clave ? 'page' : null,
    onclick: () => {
      est.resaltar = busqueda?.q ?? null;
    },
  },
    h('div', { class: 'item-titulo' }, c.titulo),
    h('div', { class: 'item-meta' }, h('span', { title: c.cwd || '' }, nombreCarpeta(c)), h('span', null, fechaCorta(c.hasta))),
    (() => {
      const etqs = etiquetasConversacion(c);
      return etqs.length ? h('div', { class: 'item-etqs' }, etqs) : null;
    })(),
    extra);
}

function pintarControles() {
  const n = contarActivos();
  reemplazar(ui.botonFiltros, icono('filtro', 15), 'Filtros', n ? h('span', { class: 'insignia-num' }, n) : null);
  ui.botonFiltros.setAttribute('aria-label', n ? `Filtros: ${n} activos` : 'Filtros');
  const lista = chips(pintarLista);
  reemplazar(ui.chipsCont, lista);
  ui.chipsCont.hidden = !lista.length;
}

function vacio(mensaje, accion) {
  return h('div', { class: 'lista-vacia' }, h('span', null, mensaje), accion);
}

function pintarLista() {
  if (!ui || !document.contains(ui.raiz)) return;
  pintarControles();
  if (busqueda) return pintarResultados();

  const items = aplicar(est.conversaciones, filtros, texto);
  reemplazar(ui.info, 
    h('span', null, plural(items.length, 'conversación', 'conversaciones')),
    texto.trim().length >= 2 ? h('button', { type: 'button', onclick: () => buscarContenido(texto) }, 'Buscar en el contenido') : null);

  const frag = document.createDocumentFragment();
  const agrupar = filtros.orden === 'recientes' || filtros.orden === 'antiguas';
  let grupo = null;
  for (const c of items) {
    if (agrupar) {
      const g = mes(c.hasta);
      if (g !== grupo) {
        frag.append(h('div', { class: 'grupo-mes' }, g));
        grupo = g;
      }
    }
    frag.append(itemNodo(c));
  }
  if (!items.length) {
    frag.append(est.conversaciones.length
      ? vacio('Ninguna conversación coincide.', contarActivos() || texto ? h('button', { type: 'button', class: 'btn btn-chico', onclick: () => { limpiarFiltros(); texto = ''; ui.entrada.value = ''; pintarLista(); } }, 'Limpiar filtros y búsqueda') : null)
      : vacio('Todavía no hay conversaciones archivadas.'));
  }
  ui.lista.replaceChildren(frag);
}

function pintarResultados() {
  const { q, resultados } = busqueda;
  const porClave = new Map(est.conversaciones.map((c) => [c.clave, c]));
  const permitidas = new Set(aplicar(est.conversaciones, filtros, '').map((c) => c.clave));
  const visibles = resultados.filter((r) => permitidas.has(r.clave));
  reemplazar(ui.info, 
    h('span', null, `${plural(visibles.length, 'conversación contiene', 'conversaciones contienen')} “${q}”`),
    h('button', { type: 'button', onclick: () => { busqueda = null; texto = ''; ui.entrada.value = ''; pintarLista(); } }, 'Volver a la lista'));
  const frag = document.createDocumentFragment();
  for (const r of visibles) {
    const c = porClave.get(r.clave) || { ...r };
    const fragmentos = r.fragmentos.map((f) => h('div', { class: 'item-frag' }, '…', f.antes, h('mark', null, f.texto), f.despues, '…'));
    frag.append(itemNodo(c, [h('div', { class: 'item-meta' }, h('span', null, plural(r.coincidencias, 'coincidencia', 'coincidencias'))), fragmentos]));
  }
  if (!visibles.length) frag.append(vacio(resultados.length ? 'Hay coincidencias, pero los filtros activos las ocultan.' : 'No aparece en ninguna conversación archivada. Las que todavía no se sincronizaron no se pueden buscar en el contenido.'));
  ui.lista.replaceChildren(frag);
}

async function buscarContenido(consulta) {
  const q = consulta.trim();
  if (q.length < 2) {
    toast('Escribí al menos 2 letras para buscar en el contenido.');
    return;
  }
  reemplazar(ui.info, h('span', null, `Buscando “${q}” en todas las conversaciones…`));
  try {
    busqueda = { q, resultados: await api(`/api/buscar?q=${enc(q)}`) };
    pintarLista();
  } catch (e) {
    avisarError(e);
  }
}

function abrir(clave) {
  for (const el of ui.lista.querySelectorAll('.item')) {
    if (el.dataset.clave === clave) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
  }
  if (!clave) {
    abierta = null;
    cerrarLector();
    ui.lector.dataset.clave = '';
    ui.lector.replaceChildren(lectorVacio());
    return;
  }
  if (clave === abierta) return;
  abierta = clave;
  ui.lector.dataset.clave = clave;
  const resaltar = est.resaltar;
  const padre = est.padrePendiente;
  est.resaltar = null;
  est.padrePendiente = null;
  abrirEnLector(ui.lector, clave, { resaltar, padre });
  ui.lista.querySelector(`.item[aria-current="page"]`)?.scrollIntoView({ block: 'nearest' });
}

export function pintarConversaciones(vista, clave) {
  if (!ui || !vista.contains(ui.raiz)) {
    montar(vista);
    pintarLista();
  }
  if (est.busquedaPendiente) {
    const q = est.busquedaPendiente;
    est.busquedaPendiente = null;
    ui.entrada.value = q;
    texto = q;
    buscarContenido(q);
  }
  abrir(clave);
}

export const refrescarLista = () => pintarLista();
export const enfocarBusqueda = () => ui?.entrada.focus();
