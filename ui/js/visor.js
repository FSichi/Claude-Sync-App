// Lector de una conversación: encabezado con acciones y la transcripción paginada.
import { h, $, $$, api, post, enc, TOKEN, numero, tamano, fechaLarga, nombreCarpeta, navegar, rutaConversacion, leerPref, guardarPref, copiar, toast, avisarError, plural } from './util.js';
import { icono } from './iconos.js';
import { markdown } from './markdown.js';
import { abrirModal, abrirCajon } from './capas.js';
import { est } from './estado.js';
import { etiquetasConversacion } from './inicio.js';

const PAGINA = 300;
const prefs = { herramientas: leerPref('herramientas', true), pensamiento: leerPref('pensamiento', false) };
let v = null; // conversación abierta
let observador = null;
let cargando = false;

// ---------- Eventos de la transcripción ----------

const hora = (ts) => (ts ? new Date(ts).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '');

function avisoRecortado(ev) {
  if (!ev?.truncado || ev.off == null) return null;
  return h('div', { class: 'recortado' }, 'Texto recortado. ', h('button', { type: 'button', onclick: () => verLinea(ev.off) }, 'Ver completo'));
}

const urlImagen = (off, n) => `/api/imagen?clave=${enc(v.clave)}&off=${off}&n=${n}&t=${TOKEN}`;
function miniatura(off, n) {
  const url = urlImagen(off, n);
  return h('button', { type: 'button', class: 'miniatura', 'aria-label': 'Ver la imagen en grande', onclick: () => abrirModal({ etiqueta: 'Imagen', ancho: 1100, contenido: h('img', { src: url, alt: 'Imagen de la conversación' }) }) },
    h('img', { src: url, alt: 'Imagen de la conversación', loading: 'lazy' }));
}

function detalleHerramienta(ev) {
  const r = ev.resultado;
  return h('div', { class: 'herr-detalle' },
    ev.texto ? [h('h4', null, 'Entrada'), h('pre', null, ev.texto), avisoRecortado(ev)] : null,
    r
      ? [h('h4', null, r.error ? 'Resultado (error)' : 'Resultado'), r.texto ? h('pre', { class: r.error ? 'error' : null }, r.texto) : null, avisoRecortado(r),
          r.imagenes?.length ? h('div', { class: 'miniaturas' }, r.imagenes.map((i) => miniatura(i.off, i.n))) : null]
      : h('p', { class: 'tenue' }, 'Sin resultado registrado.'));
}

function alAbrir(details, construir) {
  details.addEventListener('toggle', () => {
    if (details.open && !details.dataset.listo) {
      details.dataset.listo = '1';
      details.append(construir());
    }
  });
  return details;
}

function nodoHerramienta(ev) {
  const r = ev.resultado;
  return alAbrir(h('details', { class: 'herr' },
    h('summary', null,
      icono('chevron', 13),
      h('span', { class: 'herr-nombre' }, ev.nombre),
      h('span', { class: 'herr-resumen' }, ev.resumen || ''),
      r?.error ? h('span', { class: 'herr-error' }, 'error') : null,
      r?.imagenes?.length ? h('span', { class: 'tenue' }, plural(r.imagenes.length, 'imagen', 'imágenes')) : null)), () => detalleHerramienta(ev));
}

function nodoGrupo(lista) {
  const nombres = [...new Set(lista.map((x) => x.nombre))];
  const errores = lista.filter((x) => x.resultado?.error).length;
  return alAbrir(h('details', { class: 'grupo-herr' },
    h('summary', null,
      icono('chevron', 13),
      icono('herramienta', 14),
      h('span', null, plural(lista.length, 'herramienta', 'herramientas')),
      h('span', { class: 'herr-resumen tenue' }, `· ${nombres.slice(0, 4).join(', ')}${nombres.length > 4 ? '…' : ''}`),
      errores ? h('span', { class: 'herr-error' }, `${errores} con error`) : null)),
    () => h('div', { class: 'grupo-herr-lista' }, lista.map(nodoHerramienta)));
}

function nodosEventos(eventos, ctx) {
  const nombre = est.app?.nombreUsuario || 'Vos';
  const nodos = [];
  let grupo = [];
  let miniaturas = null;
  const cerrarGrupo = () => {
    if (grupo.length) nodos.push(grupo.length === 1 ? nodoHerramienta(grupo[0]) : nodoGrupo(grupo));
    grupo = [];
  };
  const turno = (quien, ts) => {
    if (ctx.hablante === quien) return;
    ctx.hablante = quien;
    nodos.push(h('div', { class: `turno-etq${quien === 'usuario' ? ' derecha' : ''}` }, `${quien === 'usuario' ? nombre : 'Claude'}${ts ? ` · ${hora(ts)}` : ''}`));
  };
  for (const ev of eventos) {
    if (ev.tipo === 'herramienta' || ev.tipo === 'resultado') {
      miniaturas = null;
      turno('claude', ev.ts);
      grupo.push(ev.tipo === 'resultado' ? { nombre: 'Resultado', resumen: '', resultado: ev.resultado } : ev);
      continue;
    }
    cerrarGrupo();
    if (ev.tipo !== 'imagen') miniaturas = null;
    switch (ev.tipo) {
      case 'usuario':
        turno('usuario', ev.ts);
        nodos.push(h('div', { class: 'turno usuario' }, h('div', { class: 'burbuja' }, ev.texto), avisoRecortado(ev)));
        break;
      case 'imagen':
        turno('usuario', ev.ts);
        if (!miniaturas) {
          miniaturas = h('div', { class: 'miniaturas' });
          nodos.push(h('div', { class: 'turno usuario' }, miniaturas));
        }
        miniaturas.append(miniatura(ev.off, ev.n));
        break;
      case 'claude':
        turno('claude', ev.ts);
        nodos.push(h('div', { class: 'turno' }, h('div', { class: 'md', html: markdown(ev.texto) }), avisoRecortado(ev)));
        break;
      case 'pensamiento':
        turno('claude', ev.ts);
        nodos.push(h('details', { class: 'pensamiento' }, h('summary', null, icono('idea', 14), 'Razonamiento'), h('div', { class: 'contenido' }, ev.texto), avisoRecortado(ev)));
        break;
      case 'comando':
        nodos.push(h('div', { class: 'evento-chico' }, icono('terminal', 14), 'Comando', h('code', null, ev.texto)));
        break;
      case 'salida':
        nodos.push(h('details', { class: 'evento-chico' }, h('summary', null, 'Salida del comando'), h('pre', { class: 'crudo' }, ev.texto)));
        break;
      case 'interrupcion':
        nodos.push(h('div', { class: 'evento-chico' }, icono('cerrar', 14), 'Interrumpido'));
        break;
      case 'compactacion':
        ctx.hablante = null;
        nodos.push(ev.resumenCompacto
          ? h('details', { class: 'evento-chico' }, h('summary', null, 'Resumen que armó Claude al compactar'), h('pre', { class: 'crudo' }, ev.texto), avisoRecortado(ev))
          : h('div', { class: 'marca-linea' }, 'Conversación compactada'));
        break;
      case 'sistema':
        nodos.push(h('details', { class: 'evento-chico' }, h('summary', null, 'Aviso del sistema'), h('pre', { class: 'crudo' }, ev.texto)));
        break;
    }
  }
  cerrarGrupo();
  return nodos;
}

// ---------- Resaltado de búsqueda ----------

function terminos(consulta) {
  const s = (consulta || '').trim();
  if (/^".+"$/.test(s)) return [s.slice(1, -1)];
  return s.split(/\s+/).filter((t) => t.length >= 2);
}

function resaltarEn(raiz, consulta) {
  const ts = terminos(consulta);
  if (!ts.length) return;
  const re = new RegExp(ts.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi');
  const walker = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement.closest('mark, summary') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const nodos = [];
  while (walker.nextNode()) {
    re.lastIndex = 0;
    if (re.test(walker.currentNode.nodeValue)) nodos.push(walker.currentNode);
  }
  for (const nodo of nodos) {
    const texto = nodo.nodeValue;
    const frag = document.createDocumentFragment();
    let i = 0;
    for (const m of texto.matchAll(re)) {
      frag.append(texto.slice(i, m.index), h('mark', null, m[0]));
      i = m.index + m[0].length;
    }
    frag.append(texto.slice(i));
    nodo.replaceWith(frag);
  }
}

// ---------- Acciones ----------

async function verLinea(off) {
  try {
    const datos = await api(`/api/linea?clave=${enc(v.clave)}&off=${off}`);
    abrirModal({ titulo: 'Mensaje completo', ancho: 900, contenido: h('pre', { class: 'crudo' }, JSON.stringify(datos, null, 2)) });
  } catch (e) {
    avisarError(e);
  }
}

function mostrarComando(comando, intro) {
  abrirModal({
    titulo: 'Retomar en Claude Code',
    ancho: 600,
    contenido: [
      h('p', { class: 'sutil' }, intro || 'Abrí una terminal (PowerShell) y corré:'),
      h('pre', { class: 'crudo' }, comando),
      h('p', { class: 'tenue', style: 'font-size: 13px' }, 'No aparece en la barra lateral de la app de escritorio: se retoma desde la terminal. En la app podés probar el comando /resume, que lista las sesiones de terminal de esta PC.'),
    ],
    pie: h('button', { type: 'button', class: 'btn btn-primario', onclick: () => copiar(comando, 'Comando copiado') }, icono('copiar', 15), 'Copiar comando'),
  });
}

async function restaurar(boton) {
  try {
    const r = await post('/api/restaurar', { clave: v.clave });
    const intro = r.yaExistia
      ? `Esta conversación ya estaba en Claude (${r.ruta}). No se tocó nada.`
      : `Listo: se copió a ${r.ruta}${r.auxCopiados ? ` junto con ${plural(r.auxCopiados, 'archivo', 'archivos')} de subagentes y herramientas` : ''}. Para retomarla, abrí una terminal y corré:`;
    v.info.enClaude = true;
    if (r.comando) {
      mostrarComando(r.comando, intro);
      boton.replaceWith(h('button', { type: 'button', class: 'btn btn-chico', onclick: () => mostrarComando(r.comando) }, icono('terminal', 14), 'Cómo retomarla'));
    } else {
      toast(intro, 'ok');
      boton.remove();
    }
  } catch (e) {
    avisarError(e);
  }
}

async function verSubagentes() {
  const cuerpo = h('div', { class: 'opciones' }, h('p', { class: 'tenue' }, 'Cargando…'));
  const capa = abrirCajon({ titulo: `Subagentes (${v.info.subagentes})`, contenido: cuerpo });
  try {
    const lista = await api(`/api/subagentes?clave=${enc(v.clave)}`);
    cuerpo.replaceChildren(...(lista.length ? lista.map((s) => h('a', {
      class: 'item',
      href: rutaConversacion(s.clave),
      onclick: () => {
        est.padrePendiente = v.clave;
        capa.cerrar();
      },
    },
      h('div', { class: 'item-titulo' }, s.descripcion || s.clave.split('/').pop()),
      h('div', { class: 'item-meta' }, h('span', null, s.fase || s.tipo || 'Subagente'), h('span', null, tamano(s.tamano))))) : [h('p', { class: 'tenue' }, 'No se encontraron los archivos de los subagentes.')]));
  } catch (e) {
    cuerpo.replaceChildren(h('p', { class: 'mensaje error' }, e.message));
  }
}

function alternar(cual, boton) {
  prefs[cual] = !prefs[cual];
  guardarPref(cual, prefs[cual]);
  boton.setAttribute('aria-pressed', String(prefs[cual]));
  aplicarVista();
}
function aplicarVista() {
  const t = $('#transcripcion');
  if (!t) return;
  t.classList.toggle('sin-herramientas', !prefs.herramientas);
  t.classList.toggle('sin-pensamiento', !prefs.pensamiento);
}

// ---------- Paginado ----------

function actualizarBordes() {
  const arriba = $('#cargar-anteriores');
  if (arriba) arriba.hidden = v.inicio === 0;
  const centinela = $('#centinela');
  if (centinela) centinela.textContent = v.fin < v.total ? 'Cargando más…' : v.total ? 'Fin de la conversación' : '';
}

async function pedir(desde, cantidad) {
  return api(`/api/conversacion?clave=${enc(v.clave)}&desde=${desde}&cantidad=${cantidad}`);
}

function agregar(eventos, ctx, alPrincipio = false) {
  const cont = h('div');
  cont.append(...nodosEventos(eventos, ctx));
  resaltarEn(cont, v.resaltar);
  if (alPrincipio) $('#eventos').prepend(...cont.childNodes);
  else $('#eventos').append(...cont.childNodes);
}

async function cargarSiguientes() {
  const actual = v;
  if (!actual || cargando || actual.fin >= actual.total) return false;
  cargando = true;
  try {
    const p = await pedir(actual.fin, PAGINA);
    if (v !== actual) return false;
    agregar(p.eventos, actual.ctx);
    actual.fin += p.eventos.length;
    actual.total = p.total;
    actualizarBordes();
    return p.eventos.length > 0;
  } catch (e) {
    avisarError(e);
    return false;
  } finally {
    cargando = false;
  }
}

async function cargarAnteriores() {
  const actual = v;
  if (!actual || cargando || actual.inicio === 0) return;
  cargando = true;
  try {
    const desde = Math.max(0, actual.inicio - PAGINA);
    const p = await pedir(desde, actual.inicio - desde);
    if (v !== actual) return;
    const lector = $('#lector');
    const alto = lector.scrollHeight;
    agregar(p.eventos, { hablante: null }, true);
    lector.scrollTop += lector.scrollHeight - alto;
    actual.inicio = desde;
    actualizarBordes();
  } catch (e) {
    avisarError(e);
  } finally {
    cargando = false;
  }
}

async function irAlFinal() {
  const actual = v;
  if (actual.fin < actual.total) {
    const desde = Math.max(actual.fin, actual.total - PAGINA);
    try {
      const p = await pedir(desde, PAGINA);
      if (v !== actual) return;
      actual.ctx = { hablante: null };
      $('#eventos').replaceChildren();
      agregar(p.eventos, actual.ctx);
      actual.inicio = desde;
      actual.fin = desde + p.eventos.length;
      actualizarBordes();
    } catch (e) {
      avisarError(e);
      return;
    }
  }
  const lector = $('#lector');
  lector.scrollTop = lector.scrollHeight;
}

async function siguienteCoincidencia() {
  const lector = $('#lector');
  const limite = $('.lector-cab').getBoundingClientRect().bottom + 8;
  for (let i = 0; i < 200; i++) {
    const siguiente = $$('#eventos mark').find((m) => m.getBoundingClientRect().top > limite + 4);
    if (siguiente) {
      siguiente.closest('details')?.setAttribute('open', '');
      siguiente.scrollIntoView({ block: 'center' });
      return;
    }
    if (!(await cargarSiguientes())) break;
  }
  if (lector) toast('No hay más coincidencias en esta conversación.');
}

// ---------- Pintar ----------

function meta(i) {
  const partes = [];
  partes.push(h('span', null, `${fechaLarga(i.desde)} → ${fechaLarga(i.hasta)}`));
  partes.push(h('span', null, `${plural(i.mensajesUsuario ?? 0, 'mensaje tuyo', 'mensajes tuyos')} · ${plural(i.respuestas ?? 0, 'respuesta', 'respuestas')} · ${plural(i.herramientas ?? 0, 'herramienta', 'herramientas')}`));
  if (i.tamano) partes.push(h('span', null, tamano(i.tamano)));
  if (i.modelos?.length) partes.push(h('span', null, i.modelos.join(', ')));
  if (i.rama && i.rama !== 'HEAD') partes.push(h('span', null, `rama ${i.rama}`));
  if (i.lineasDanadas) partes.push(h('span', null, plural(i.lineasDanadas, 'línea dañada', 'líneas dañadas')));
  return h('div', { class: 'lector-meta' }, partes);
}

function pintar(lector, eventos) {
  const i = v.info;
  const carpeta = nombreCarpeta(i);
  const accionRetomar = !i.enClaude && v.enArchivo && i.id
    ? h('button', { type: 'button', class: 'btn btn-chico', title: 'Copia la conversación a Claude Code para retomarla. No pisa nada.', onclick: (e) => restaurar(e.currentTarget) }, icono('restaurar', 14), 'Restaurar en Claude')
    : i.enClaude && i.comandoRetomar
      ? h('button', { type: 'button', class: 'btn btn-chico', onclick: () => mostrarComando(i.comandoRetomar) }, icono('terminal', 14), 'Cómo retomarla')
      : null;

  const cab = h('header', { class: 'lector-cab' },
    h('div', { class: 'migas' },
      v.padre
        ? h('a', { href: rutaConversacion(v.padre) }, icono('izquierda', 15), 'Volver a la conversación')
        : h('a', { href: '#/inicio' }, icono('izquierda', 15), 'Inicio'),
      h('span', { 'aria-hidden': 'true' }, '/'),
      h('span', { class: 'carpeta-migas', title: i.cwd || '' }, carpeta),
      h('button', { type: 'button', class: 'btn btn-fantasma btn-icono', 'aria-label': 'Cerrar la conversación (Esc)', title: 'Cerrar (Esc)', onclick: () => navegar('#/conversaciones') }, icono('cerrar', 16))),
    h('div', { class: 'lector-fila' },
      h('div', null, h('h1', { class: 'lector-titulo' }, i.titulo || 'Sin título'), meta(i)),
      h('div', { class: 'acciones' },
        h('a', { class: 'btn btn-chico', href: `/api/exportar?clave=${enc(v.clave)}&t=${TOKEN}`, download: '' }, icono('exportar', 14), 'Exportar .md'),
        h('button', { type: 'button', class: 'btn btn-chico', onclick: () => post('/api/abrir', { clave: v.clave }).catch(avisarError) }, icono('carpeta', 14), 'Mostrar en carpeta'),
        accionRetomar,
        i.id ? h('button', { type: 'button', class: 'btn btn-chico btn-icono', 'aria-label': 'Copiar el ID de la sesión', title: `Copiar ID (${i.id})`, onclick: () => copiar(i.id, 'ID copiado') }, icono('copiar', 14)) : null)),
    h('div', { class: 'lector-barra' },
      etiquetasConversacion({ ...i, pendiente: false }, { completas: false }),
      i.subagentes ? h('button', { type: 'button', class: 'btn btn-chico', onclick: verSubagentes }, icono('ramas', 14), plural(i.subagentes, 'subagente', 'subagentes')) : null,
      h('span', { class: 'separador' }),
      v.resaltar ? h('button', { type: 'button', class: 'btn btn-chico', onclick: siguienteCoincidencia }, icono('buscar', 14), `Siguiente “${v.resaltar}”`) : null,
      h('button', { type: 'button', class: 'btn btn-chico', 'aria-pressed': String(prefs.herramientas), onclick: (e) => alternar('herramientas', e.currentTarget) }, icono('herramienta', 14), 'Herramientas'),
      h('button', { type: 'button', class: 'btn btn-chico', 'aria-pressed': String(prefs.pensamiento), onclick: (e) => alternar('pensamiento', e.currentTarget) }, icono('idea', 14), 'Razonamiento'),
      h('button', { type: 'button', class: 'btn btn-chico', onclick: irAlFinal }, icono('flecha_final', 14), 'Ir al final')));

  const transcripcion = h('article', { class: 'transcripcion', id: 'transcripcion' },
    h('div', { class: 'cargar-mas', id: 'cargar-anteriores', hidden: true }, h('button', { type: 'button', class: 'btn btn-chico', onclick: cargarAnteriores }, 'Cargar mensajes anteriores')),
    h('div', { id: 'eventos', style: 'display: flex; flex-direction: column; gap: 14px' }),
    h('div', { class: 'cargar-mas', id: 'centinela' }));
  lector.replaceChildren(cab, transcripcion);
  aplicarVista();
  agregar(eventos, v.ctx);
  if (!eventos.length) $('#eventos').append(h('p', { class: 'tenue' }, 'Esta conversación no tiene mensajes legibles.'));
  lector.scrollTop = 0;
  actualizarBordes();

  observador?.disconnect();
  observador = new IntersectionObserver((entradas) => {
    if (entradas.some((x) => x.isIntersecting)) cargarSiguientes();
  }, { root: lector, rootMargin: '600px' });
  observador.observe($('#centinela'));
}

export async function abrirEnLector(lector, clave, { resaltar = null, padre = null } = {}) {
  observador?.disconnect();
  v = null;
  lector.replaceChildren(h('div', { class: 'lector-vacio' }, h('p', null, 'Abriendo la conversación…')));
  try {
    const p = await api(`/api/conversacion?clave=${enc(clave)}&desde=0&cantidad=${PAGINA}`);
    if (lector.dataset.clave !== clave) return;
    v = { clave, info: p.info, total: p.total, inicio: 0, fin: p.eventos.length, enArchivo: p.enArchivo, resaltar, padre, ctx: { hablante: null } };
    pintar(lector, p.eventos);
  } catch (e) {
    lector.replaceChildren(h('div', { class: 'lector-vacio' }, icono('alerta', 32), h('h2', null, 'No se pudo abrir'), h('p', null, e.message)));
  }
}

export function cerrarLector() {
  observador?.disconnect();
  v = null;
}
