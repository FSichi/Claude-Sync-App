// Archivos: los que tocó Claude, en qué conversaciones aparecen y sus versiones recuperables
// (checkpoints de Claude Code, lo que escribió con Write y lo que se reconstruye de cada Edit).
import { h, api, enc, TOKEN, plural, numero, tamano, fechaLarga, fechaCorta, rutaArchivo, rutaConversacion, nombreDeRuta, carpetaDeRuta, copiar, avisarError, reemplazar, leerPref, guardarPref } from './util.js';
import { icono } from './iconos.js';
import { sincronizarAhora } from './estado.js';

const MODOS = [
  { id: 'cambiados', texto: 'Con cambios' },
  { id: 'faltan', texto: 'Ya no están' },
  { id: 'todos', texto: 'Todos' },
];
const TIPOS = {
  disco: { texto: 'En tu PC ahora', icono: 'monitor' },
  checkpoint: { texto: 'Checkpoint de Claude Code', icono: 'escudo' },
  escrito: { texto: 'Escrito por Claude', icono: 'archivo_codigo' },
  editado: { texto: 'Editado por Claude', icono: 'editar' },
};
const MAX_VISTA = 400000;

let ui = null;
let modo = leerPref('archivosModo', 'cambiados');
let consulta = '';
let pedido = 0;
let abierto = null;
let temporizador = null;

export function itemArchivo(a, { alElegir = null, actual = false } = {}) {
  const cambios = a.editado + a.escrito;
  const que = cambios ? plural(cambios, 'cambio', 'cambios') : a.leido ? `leído ${a.leido === 1 ? 'una vez' : `${numero(a.leido)} veces`}` : 'con checkpoint';
  return h('a', { class: 'item item-archivo', href: rutaArchivo(a.clave), 'data-clave': a.clave, 'aria-current': actual ? 'page' : null, onclick: alElegir },
    h('div', { class: 'item-titulo' }, nombreDeRuta(a.ruta)),
    h('div', { class: 'item-ruta', title: a.ruta }, carpetaDeRuta(a.ruta)),
    h('div', { class: 'item-meta' }, h('span', null, `${que}${a.conversaciones > 1 ? ` · ${numero(a.conversaciones)} conversaciones` : ''}`), h('span', null, fechaCorta(a.ultima))),
    a.existe === false ? h('div', { class: 'item-etqs' }, h('span', { class: 'etq etq-alerta' }, 'Ya no está en tu PC')) : null);
}

const panelVacio = () => h('div', { class: 'lector-vacio' },
  icono('archivo_codigo', 40, 1.5),
  h('h2', null, 'Elegí un archivo'),
  h('p', null, 'Acá están los archivos que leyó, escribió o editó Claude. De cada uno podés ver en qué conversaciones aparece y recuperar sus versiones, aunque ya no estén en tu PC.'));

function montar(vista) {
  const entrada = h('input', {
    type: 'search',
    placeholder: 'Buscar por nombre o carpeta',
    'aria-label': 'Buscar archivos por nombre o carpeta',
    autocomplete: 'off',
    value: consulta,
    oninput: (e) => {
      consulta = e.target.value;
      clearTimeout(temporizador);
      temporizador = setTimeout(cargarLista, 200);
    },
  });
  const modos = h('div', { class: 'seg seg-ancho', role: 'group', 'aria-label': 'Qué archivos mostrar' },
    MODOS.map((m) => h('button', {
      type: 'button',
      'aria-pressed': String(modo === m.id),
      onclick: (e) => {
        modo = m.id;
        guardarPref('archivosModo', modo);
        for (const b of e.currentTarget.parentElement.children) b.setAttribute('aria-pressed', String(b === e.currentTarget));
        cargarLista();
      },
    }, m.texto)));
  const info = h('div', { class: 'lista-info', role: 'status' });
  const lista = h('nav', { class: 'lista', 'aria-label': 'Archivos' });
  const panel = h('section', { class: 'lector', 'aria-label': 'Archivo' }, panelVacio());
  const raiz = h('div', { class: 'conv' }, h('aside', { class: 'lista-col' }, h('div', { class: 'lista-cab' }, h('label', { class: 'campo' }, icono('buscar', 15), entrada), modos, info), lista), panel);
  vista.replaceChildren(raiz);
  ui = { raiz, entrada, info, lista, panel };
  abierto = null;
}

const VACIOS = {
  cambiados: 'Todavía no hay archivos que Claude haya escrito o editado.',
  faltan: 'Todos los archivos que cambió Claude siguen en tu PC.',
  todos: 'Todavía no hay archivos registrados.',
};

async function cargarLista() {
  const n = ++pedido;
  reemplazar(ui.info, h('span', null, modo === 'faltan' ? 'Revisando cuáles siguen en tu PC…' : 'Buscando…'));
  try {
    const r = await api(`/api/archivos?modo=${modo}&q=${enc(consulta.trim())}`);
    if (n !== pedido || !document.contains(ui.raiz)) return;
    if (r.faltaIndice) {
      reemplazar(ui.info, h('span', null, 'Falta armar el índice'));
      ui.lista.replaceChildren(h('div', { class: 'lista-vacia' },
        h('span', null, 'Para ver los archivos hay que sincronizar una vez con esta versión: arma el índice de lo que tocó Claude en cada conversación.'),
        h('button', { type: 'button', class: 'btn btn-chico btn-primario', onclick: sincronizarAhora }, 'Sincronizar')));
      return;
    }
    reemplazar(ui.info, h('span', null, r.total > r.archivos.length ? `Los ${numero(r.archivos.length)} más recientes de ${numero(r.total)}` : plural(r.total, 'archivo', 'archivos')));
    ui.lista.replaceChildren(...(r.archivos.length
      ? r.archivos.map((a) => itemArchivo(a, { actual: a.clave === abierto }))
      : [h('div', { class: 'lista-vacia' }, consulta.trim() ? 'Ningún archivo coincide con la búsqueda.' : VACIOS[modo])]));
  } catch (e) {
    avisarError(e);
  }
}

function marcarActual() {
  for (const el of ui.lista.querySelectorAll('.item')) {
    if (el.dataset.clave === abierto) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
  }
}

// ---------- Detalle de un archivo ----------

function estadoEnPC(d) {
  if (!d.enDisco) return h('span', { class: 'etq etq-peligro' }, 'Ya no está en tu PC');
  if (d.enDisco.coincide) return h('span', { class: 'etq etq-ok', title: 'El archivo de tu PC es igual a la última versión que dejó Claude' }, 'En tu PC, igual a la última versión');
  if (d.enDisco.coincide === false) return h('span', { class: 'etq etq-alerta', title: 'Cambió después de la última vez que lo tocó Claude' }, 'En tu PC, con otros cambios');
  return h('span', { class: 'etq' }, 'Está en tu PC');
}

function nodoVersion(v, { ultima, alElegir }) {
  const t = TIPOS[v.tipo];
  const detalle = v.disponible
    ? [v.lineas != null ? plural(v.lineas, 'línea', 'líneas') : null, v.tamano != null ? tamano(v.tamano) : null].filter(Boolean).join(' · ')
    : v.tipo === 'disco' ? 'No se puede mostrar (es binario o muy grande)' : 'No se pudo reconstruir: falta la versión anterior';
  return h('button', { type: 'button', class: 'version', 'data-n': String(v.n), disabled: !v.disponible, onclick: () => alElegir(v) },
    icono(t.icono, 16),
    h('span', { class: 'version-texto' },
      h('span', { class: 'version-titulo' }, t.texto,
        v === ultima ? h('span', { class: 'etq etq-acento' }, 'Última') : null,
        v.disponible && v.tipo === 'editado' ? h('span', { class: 'etq', title: 'Es la versión anterior con el cambio de Claude aplicado. Si el archivo cambió por otro lado entre medio, puede no ser exacta.' }, 'Reconstruida') : null,
        v.coincide === true && v.tipo === 'checkpoint' ? h('span', { class: 'etq etq-ok', title: 'El checkpoint confirma la reconstrucción anterior' }, 'Confirma') : null,
        v.subagente ? h('span', { class: 'etq' }, 'Subagente') : null),
      h('span', { class: 'version-meta' }, fechaLarga(v.ts), detalle ? ` · ${detalle}` : '')));
}

async function mostrarVersion(clave, v, contenedor) {
  const titulo = `${TIPOS[v.tipo].texto} · ${fechaLarga(v.ts)}`;
  const url = (ruta) => `/api/archivo/${ruta}?clave=${enc(clave)}&n=${enc(v.n)}`;
  const pre = h('pre', { class: 'codigo-archivo' }, 'Cargando…');
  let texto = null;
  reemplazar(contenedor,
    h('div', { class: 'vista-cab' },
      h('div', { class: 'vista-titulo' }, titulo),
      h('button', { type: 'button', class: 'btn btn-chico', onclick: () => texto != null && copiar(texto, 'Contenido copiado') }, icono('copiar', 14), 'Copiar'),
      h('a', { class: 'btn btn-chico btn-primario', href: `${url('descargar')}&t=${TOKEN}`, download: '' }, icono('descargar', 14), 'Descargar')),
    v.tipo === 'editado' ? h('p', { class: 'nota-version' }, 'Reconstruida: la versión anterior con el cambio de Claude aplicado. Si el archivo cambió por otro lado entre medio, puede no ser exacta.') : null,
    pre);
  try {
    texto = (await api(url('version'))).texto;
    pre.textContent = texto.length > MAX_VISTA ? `${texto.slice(0, MAX_VISTA)}\n\n[…Es muy largo para mostrarlo entero: descargalo para verlo completo…]` : texto || '(vacío)';
  } catch (e) {
    pre.textContent = e.message;
  }
}

function pintarDetalle(clave, d) {
  const a = d.archivo;
  const versiones = [...d.versiones].reverse();
  const ultima = versiones.find((v) => v.disponible) ?? null;
  const opciones = [...(d.enDisco ? [{ n: 'disco', tipo: 'disco', ts: d.enDisco.ts, disponible: d.enDisco.disponible, tamano: d.enDisco.tamano, lineas: null }] : []), ...versiones];
  const recuperables = d.versiones.filter((v) => v.disponible).length;
  const vista = h('section', { class: 'vista-version', 'aria-live': 'polite' });
  const lista = h('div', { class: 'versiones' });
  const elegir = (v) => {
    for (const b of lista.querySelectorAll('.version')) b.setAttribute('aria-pressed', String(b.dataset.n === String(v.n)));
    mostrarVersion(clave, v, vista);
  };
  // Las ediciones seguidas que no se pudieron reconstruir van en una sola fila.
  for (let i = 0; i < opciones.length; i++) {
    const v = opciones[i];
    if (v.disponible || v.tipo !== 'editado') {
      lista.append(nodoVersion(v, { ultima, alElegir: elegir }));
      continue;
    }
    let j = i;
    while (j + 1 < opciones.length && !opciones[j + 1].disponible && opciones[j + 1].tipo === 'editado') j++;
    const n = j - i + 1;
    lista.append(h('div', { class: 'version version-sin', title: 'Para reconstruirlas hace falta una versión anterior exacta (un checkpoint o un Write), y no la hay.' },
      icono('editar', 16),
      h('span', { class: 'version-texto' },
        h('span', { class: 'version-titulo' }, n === 1 ? 'Una edición sin reconstruir' : `${n} ediciones sin reconstruir`),
        h('span', { class: 'version-meta' }, n === 1 ? fechaLarga(v.ts) : `${fechaLarga(opciones[j].ts)} → ${fechaLarga(v.ts)}`))));
    i = j;
  }

  const conversaciones = h('div', { class: 'tarjeta lista-conversaciones' }, a.conversaciones.map((c) => {
    const cambios = c.editado + c.escrito;
    return h('a', { class: 'item', href: rutaConversacion(c.clave) },
      h('div', { class: 'item-titulo' }, c.titulo || 'Sin título'),
      h('div', { class: 'item-meta' },
        h('span', null, [cambios ? plural(cambios, 'cambio', 'cambios') : null, c.leido ? `leído ${c.leido === 1 ? 'una vez' : `${numero(c.leido)} veces`}` : null].filter(Boolean).join(' · ') || 'Con checkpoint'),
        h('span', null, fechaCorta(c.ultima))));
  }));

  ui.panel.replaceChildren(
    h('header', { class: 'lector-cab' },
      h('div', { class: 'migas' },
        h('a', { href: '#/archivos' }, icono('izquierda', 15), 'Archivos'),
        h('span', { 'aria-hidden': 'true' }, '/'),
        h('span', { class: 'carpeta-migas', title: carpetaDeRuta(a.ruta) }, carpetaDeRuta(a.ruta)),
        h('button', { type: 'button', class: 'btn btn-fantasma btn-icono', 'aria-label': 'Cerrar el archivo (Esc)', title: 'Cerrar (Esc)', onclick: () => (location.hash = '#/archivos') }, icono('cerrar', 16))),
      h('div', { class: 'lector-fila' },
        h('h1', { class: 'lector-titulo' }, nombreDeRuta(a.ruta)),
        h('div', { class: 'acciones' }, h('button', { type: 'button', class: 'btn btn-chico', onclick: () => copiar(a.ruta, 'Ruta copiada') }, icono('copiar', 14), 'Copiar ruta'))),
      h('div', { class: 'lector-fila lector-sub' },
        h('div', { class: 'lector-izq' },
          estadoEnPC(d),
          h('div', { class: 'lector-datos' },
            h('span', { class: 'dato' }, icono('reloj', 13), plural(recuperables, 'versión recuperable', 'versiones recuperables')),
            h('span', { class: 'dato' }, icono('chat', 13), plural(a.conversaciones.length, 'conversación', 'conversaciones')),
            a.editado + a.escrito ? h('span', { class: 'dato' }, icono('editar', 13), plural(a.editado + a.escrito, 'cambio de Claude', 'cambios de Claude')) : null,
            h('span', { class: 'dato ruta-completa', title: a.ruta }, a.ruta))))),
    h('div', { class: 'archivo-cuerpo' },
      h('div', { class: 'archivo-lateral' },
        h('h2', { class: 'seccion-titulo' }, 'Versiones'),
        opciones.length ? lista : h('p', { class: 'tenue' }, 'No hay versiones guardadas de este archivo: Claude solo lo leyó.'),
        h('h2', { class: 'seccion-titulo' }, 'Conversaciones'),
        conversaciones),
      vista));

  const inicial = ultima ?? opciones.find((v) => v.disponible);
  if (inicial) elegir(inicial);
  else vista.append(h('div', { class: 'lector-vacio' }, h('p', null, 'No hay ninguna versión para mostrar.')));
}

async function abrir(clave) {
  if (clave === abierto) return;
  abierto = clave;
  marcarActual();
  if (!clave) {
    ui.panel.replaceChildren(panelVacio());
    return;
  }
  ui.panel.replaceChildren(h('div', { class: 'lector-vacio' }, h('p', null, 'Armando el historial del archivo…')));
  try {
    const d = await api(`/api/archivo?clave=${enc(clave)}`);
    if (abierto === clave) pintarDetalle(clave, d);
  } catch (e) {
    if (abierto === clave) ui.panel.replaceChildren(h('div', { class: 'lector-vacio' }, icono('alerta', 32), h('h2', null, 'No se pudo abrir'), h('p', null, e.message)));
  }
}

export function pintarArchivos(vista, clave) {
  if (!ui || !vista.contains(ui.raiz)) {
    montar(vista);
    cargarLista();
  }
  abrir(clave);
}

export const refrescarArchivos = () => ui && document.contains(ui.raiz) && cargarLista();
