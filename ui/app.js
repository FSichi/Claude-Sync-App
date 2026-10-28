'use strict';

const TOKEN = document.querySelector('meta[name="token"]').content;
const PAGINA = 300;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const enc = encodeURIComponent;

const est = {
  conversaciones: [],
  filtro: 'todas',
  texto: '',
  proyecto: '',
  verVacias: false,
  seleccion: null,
  busqueda: null,
  app: null,
  sincronizandoAntes: false,
  visor: null,
  principal: null,
};

const preferencias = (() => {
  try {
    return JSON.parse(localStorage.getItem('preferencias') || '{}');
  } catch {
    return {};
  }
})();
function guardarPreferencias() {
  try {
    localStorage.setItem('preferencias', JSON.stringify(preferencias));
  } catch {}
}
preferencias.herramientas ??= true;
preferencias.pensamiento ??= false;

// ---------- Utilidades ----------

async function api(ruta, opciones = {}) {
  const r = await fetch(ruta, {
    ...opciones,
    headers: { 'X-Token': TOKEN, ...(opciones.body ? { 'Content-Type': 'application/json' } : {}) },
  });
  const esJson = (r.headers.get('content-type') || '').includes('json');
  const datos = esJson ? await r.json() : await r.text();
  if (!r.ok) throw new Error((esJson && datos.error) || `Error ${r.status}`);
  return datos;
}
const post = (ruta, datos = {}) => api(ruta, { method: 'POST', body: JSON.stringify(datos) });

function h(tag, attrs, ...hijos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v; // solo con HTML generado por markdown(), que escapa todo
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const hijo of hijos.flat(Infinity)) {
    if (hijo == null || hijo === false) continue;
    el.append(hijo instanceof Node ? hijo : String(hijo));
  }
  return el;
}

const numero = (n) => (n ?? 0).toLocaleString('es-AR');
function tamano(b) {
  if (b == null) return '';
  if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toLocaleString('es-AR', { maximumFractionDigits: 1 })} MB`;
  return `${(b / 1024 ** 3).toLocaleString('es-AR', { maximumFractionDigits: 2 })} GB`;
}
const dosDig = (n) => String(n).padStart(2, '0');
const hora = (d) => `${dosDig(d.getHours())}:${dosDig(d.getMinutes())}`;
function mismoDia(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function fechaCorta(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const hoy = new Date();
  const ayer = new Date(hoy.getTime() - 86400000);
  if (mismoDia(d, hoy)) return `hoy ${hora(d)}`;
  if (mismoDia(d, ayer)) return `ayer ${hora(d)}`;
  const opciones = d.getFullYear() === hoy.getFullYear() ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' };
  return d.toLocaleDateString('es-AR', opciones);
}
function fechaLarga(iso) {
  if (!iso) return '?';
  return new Date(iso).toLocaleString('es-AR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function hace(iso) {
  if (!iso) return null;
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'hace instantes';
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  const dias = Math.round(s / 86400);
  return dias === 1 ? 'hace 1 día' : `hace ${dias} días`;
}
function mes(iso) {
  if (!iso) return 'Sin fecha';
  const t = new Date(iso).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  return t.charAt(0).toUpperCase() + t.slice(1);
}
const normalizar = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function nombreCarpeta(c) {
  const cwd = c.cwd || '';
  if (/scratch-workspaces/i.test(cwd)) return 'Sin carpeta (app)';
  if (/local-agent-mode-sessions/i.test(cwd)) return 'Cowork';
  if (cwd) {
    const partes = cwd.split(/[\\/]+/).filter(Boolean);
    const sinPrefijo = partes.slice(partes.findIndex((p) => /^escritorio$|^desktop$/i.test(p)) + 1);
    const usar = sinPrefijo.length ? sinPrefijo : partes;
    return usar.slice(-2).join(' › ') || cwd;
  }
  if (c.proyecto) return c.proyecto.replace(/^[A-Za-z]--Users-[^-]+-(OneDrive-Escritorio-)?/, '').replace(/-/g, ' ') || c.proyecto;
  return 'Sin carpeta';
}

function toast(mensaje, error = false) {
  const t = h('div', { class: `toast${error ? ' error' : ''}`, role: error ? 'alert' : 'status' }, mensaje);
  $('#toasts').append(t);
  setTimeout(() => t.remove(), error ? 9000 : 5000);
}

async function copiar(texto, aviso = 'Copiado') {
  try {
    await navigator.clipboard.writeText(texto);
    toast(aviso);
  } catch {
    toast('No se pudo copiar al portapapeles', true);
  }
}

// ---------- Markdown (todo se escapa antes de dar formato) ----------

const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function enLinea(s) {
  return s
    .split(/(`[^`\n]+`)/g)
    .map((p) => {
      if (/^`[^`\n]+`$/.test(p)) return `<code>${p.slice(1, -1)}</code>`;
      return p
        .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>')
        .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    })
    .join('');
}

function markdown(texto) {
  const lineas = texto.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  const esInicioDeBloque = (l) => /^\s*(```|~~~|#{1,6}\s|>|([-*+]|\d+[.)])\s+|\|.*\|\s*$)/.test(l);
  let i = 0;
  while (i < lineas.length) {
    const l = lineas[i];
    const cerco = l.match(/^\s*(```+|~~~+)/);
    if (cerco) {
      const cod = [];
      i++;
      while (i < lineas.length && !lineas[i].trim().startsWith(cerco[1])) cod.push(lineas[i++]);
      i++;
      out.push(`<pre><code>${esc(cod.join('\n'))}</code></pre>`);
      continue;
    }
    if (!l.trim()) {
      i++;
      continue;
    }
    const tit = l.match(/^(#{1,6})\s+(.*)$/);
    if (tit) {
      out.push(`<h${tit[1].length}>${enLinea(esc(tit[2]))}</h${tit[1].length}>`);
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) {
      out.push('<hr>');
      i++;
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < lineas.length && /^\s*\|?\s*:?-{2,}/.test(lineas[i + 1])) {
      const filas = [];
      while (i < lineas.length && /^\s*\|.*\|\s*$/.test(lineas[i])) filas.push(lineas[i++]);
      const celdas = (f) => f.trim().replace(/^\||\|$/g, '').split('|').map((c) => enLinea(esc(c.trim())));
      const [cab, , ...resto] = filas;
      out.push(`<table><thead><tr>${celdas(cab).map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${resto.map((f) => `<tr>${celdas(f).map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    if (/^\s*>/.test(l)) {
      const cita = [];
      while (i < lineas.length && /^\s*>/.test(lineas[i])) cita.push(lineas[i++].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${markdown(cita.join('\n'))}</blockquote>`);
      continue;
    }
    const item = l.match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
    if (item) {
      const ordenada = /\d/.test(item[1]);
      const items = [];
      while (i < lineas.length) {
        const m = lineas[i].match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
        if (m) items.push(m[2]);
        else if (/^\s{2,}\S/.test(lineas[i]) && items.length) items[items.length - 1] += ' ' + lineas[i].trim();
        else break;
        i++;
      }
      const tag = ordenada ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map((x) => `<li>${enLinea(esc(x))}</li>`).join('')}</${tag}>`);
      continue;
    }
    const parrafo = [];
    while (i < lineas.length && lineas[i].trim() && (!parrafo.length || !esInicioDeBloque(lineas[i]))) parrafo.push(lineas[i++]);
    out.push(`<p>${parrafo.map((x) => enLinea(esc(x))).join('<br>')}</p>`);
  }
  return out.join('');
}

// ---------- Estado de la app y sincronización ----------

const FASES = {
  listando: 'Revisando qué hay en Claude…',
  comparando: 'Comparando con el archivo…',
  copiando: 'Copiando…',
  indexando: 'Armando el índice y los textos legibles…',
};

function ultimaSincronizacion(e) {
  const fechas = e.destinos.map((d) => d.ultimaSync).filter(Boolean).sort();
  return fechas[fechas.length - 1] ?? null;
}

function pintarAviso(e) {
  const aviso = $('#aviso');
  aviso.className = 'aviso';
  aviso.replaceChildren();
  const boton = (texto) => h('button', { class: 'boton chico', onclick: sincronizarAhora }, texto);
  const faltantes = e.destinos.filter((d) => !d.disponible);
  const nuncaSincronizado = !ultimaSincronizacion(e);
  const sinCopia = e.destinos.filter((d) => d.disponible && !d.ultimaSync);
  if (e.sincronizando) {
    aviso.hidden = true;
    return;
  }
  aviso.hidden = false;
  if (!e.destinos.length) {
    aviso.classList.add('info');
    aviso.append(h('span', null, 'Para empezar, elegí dónde guardar las copias de tus conversaciones: otro disco, Google Drive, OneDrive o un NAS.'), h('button', { class: 'boton chico', onclick: abrirAjustes }, 'Elegir dónde guardar'));
  } else if (e.error) {
    aviso.classList.add('error');
    aviso.append(h('span', null, `La última sincronización falló: ${e.error}`), boton('Reintentar'));
  } else if (e.ultimo && e.ultimo.destinos.some((d) => d.errores.length)) {
    const n = e.ultimo.destinos.reduce((s, d) => s + d.errores.length, 0);
    aviso.classList.add('error');
    aviso.append(h('span', null, `La última sincronización terminó con ${n} archivo${n === 1 ? '' : 's'} sin copiar.`), h('button', { class: 'boton chico', onclick: () => verErrores(e) }, 'Ver detalle'));
  } else if (faltantes.length) {
    aviso.append(h('span', null, `No se encuentra ${faltantes.map((d) => d.ruta).join(' ni ')}: esa copia no se va a actualizar.`));
  } else if (nuncaSincronizado) {
    const pend = e.pendientes;
    aviso.append(h('span', null, `Todavía no hay ninguna copia de tus conversaciones.${pend ? ` La primera sincronización copia ${tamano(pend.bytes)} a cada destino y puede tardar varios minutos.` : ''}`), boton('Hacer la primera copia'));
  } else if (sinCopia.length) {
    aviso.classList.add('info');
    aviso.append(h('span', null, `Todavía no hay copia en ${sinCopia.map((d) => d.ruta).join(' ni en ')}. Se hace en la próxima sincronización (la primera vez copia todo el archivo).`), boton('Sincronizar'));
  } else if (e.pendientes && e.pendientes.conversaciones > 0) {
    const n = e.pendientes.conversaciones;
    aviso.classList.add('info');
    aviso.append(h('span', null, `${n} conversaci${n === 1 ? 'ón tiene' : 'ones tienen'} cambios sin respaldar.`), boton('Sincronizar'));
  } else {
    aviso.hidden = true;
  }
}

function pintarProgreso(e) {
  const caja = $('#progreso');
  const btn = $('#btn-sincronizar');
  btn.disabled = e.sincronizando || !e.destinos.length;
  btn.title = e.destinos.length ? '' : 'Primero elegí dónde guardar las copias (Ajustes)';
  btn.classList.toggle('girando', e.sincronizando);
  $('span', btn).textContent = e.sincronizando ? 'Sincronizando…' : 'Sincronizar ahora';
  caja.hidden = !e.sincronizando;
  if (!e.sincronizando) return;
  const p = e.progreso || {};
  let titulo = FASES[p.fase] || 'Sincronizando…';
  let detalle = '';
  let fraccion = null;
  if (p.fase === 'copiando') {
    titulo = `Copiando a ${p.destino}`;
    detalle = `${numero(p.hechos)} de ${numero(p.total)} archivos · ${tamano(p.bytesHechos)} de ${tamano(p.bytesTotal)}`;
    fraccion = p.bytesTotal ? p.bytesHechos / p.bytesTotal : p.total ? p.hechos / p.total : null;
  } else if (p.fase === 'indexando') {
    titulo = `Armando el índice en ${p.destino}`;
    if (p.total) {
      detalle = `${numero(p.hechos)} de ${numero(p.total)} conversaciones`;
      fraccion = p.hechos / p.total;
    }
  } else if (p.fase === 'comparando') {
    titulo = `Comparando con ${p.destino}`;
  }
  $('#progreso-titulo').textContent = titulo;
  $('#progreso-detalle').textContent = detalle;
  caja.classList.toggle('indeterminado', fraccion == null);
  $('#progreso-relleno').style.width = fraccion == null ? '' : `${Math.round(fraccion * 100)}%`;
}

function pintarEstado(e) {
  const ultima = ultimaSincronizacion(e);
  $('#estado-linea').textContent = e.sincronizando
    ? 'Sincronizando: no cierres esta ventana hasta que termine.'
    : ultima
      ? `Última sincronización ${hace(ultima)} (${fechaLarga(ultima)})`
      : 'Todavía no sincronizaste';
  pintarAviso(e);
  pintarProgreso(e);
}

let temporizadorEstado = null;
async function actualizarEstado() {
  clearTimeout(temporizadorEstado);
  try {
    const e = await api('/api/estado');
    est.app = e;
    pintarEstado(e);
    if (est.sincronizandoAntes && !e.sincronizando) {
      est.sincronizandoAntes = false;
      alTerminarSincronizacion(e);
    }
    est.sincronizandoAntes = e.sincronizando;
    if (!est.seleccion && !est.busqueda) pintarInicio();
    temporizadorEstado = setTimeout(actualizarEstado, e.sincronizando ? 700 : 30000);
  } catch (err) {
    conexionPerdida(err);
    temporizadorEstado = setTimeout(actualizarEstado, 5000);
  }
}

function alTerminarSincronizacion(e) {
  if (e.error) {
    toast(`La sincronización falló: ${e.error}`, true);
  } else if (e.ultimo) {
    const partes = e.ultimo.destinos.map((d) => {
      if (!d.disponible) return `${d.destino}: no disponible`;
      const actualizados = d.agregados + d.reemplazados;
      const cuerpo = d.nuevos + actualizados === 0 ? 'ya estaba al día' : `${numero(d.nuevos)} nuevos, ${numero(actualizados)} actualizados (${tamano(d.bytes)})`;
      return `${d.destino}: ${cuerpo}${d.errores.length ? `, ${d.errores.length} errores` : ''}`;
    });
    toast(`Sincronización terminada. ${partes.join(' · ')}`, e.ultimo.destinos.some((d) => d.errores.length));
  }
  if (!$('#ajustes').hidden) pintarAjustes();
  cargarConversaciones();
}

async function sincronizarAhora() {
  try {
    await post('/api/sincronizar');
    est.sincronizandoAntes = true;
    actualizarEstado();
  } catch (e) {
    toast(e.message, true);
  }
}

function conexionPerdida() {
  const aviso = $('#aviso');
  aviso.hidden = false;
  aviso.className = 'aviso error';
  aviso.replaceChildren(h('span', null, 'Se perdió la conexión con la app. Cerrá esta ventana y volvé a abrir Claude Archivo.'));
}

function verErrores(e) {
  const filas = e.ultimo.destinos.flatMap((d) => d.errores.map((x) => `${d.destino}\n  ${x.ruta}\n  ${x.error}`));
  abrirModal('Archivos que no se pudieron copiar', h('pre', { class: 'crudo' }, filas.join('\n\n')));
}

// ---------- Lista ----------

async function cargarConversaciones() {
  try {
    const datos = await api('/api/conversaciones');
    est.conversaciones = datos.conversaciones;
    est.principal = datos.destino;
    pintarProyectos();
    pintarLista();
    if (!est.seleccion && !est.busqueda) pintarInicio();
  } catch (e) {
    $('#lista').replaceChildren(h('p', { class: 'sutil', style: 'padding:14px' }, `No se pudo cargar la lista: ${e.message}`));
  }
}

function pasaFiltroOrigen(c, filtro) {
  switch (filtro) {
    case 'claude':
      return !c.recuperada && !c.eliminadaEnOrigen;
    case 'borradas':
      return !c.recuperada && Boolean(c.eliminadaEnOrigen);
    case 'recuperadas':
      return c.recuperada;
    case 'pendientes':
      return c.pendiente;
    default:
      return true;
  }
}

function filtradas(filtro = est.filtro) {
  const t = normalizar(est.texto.trim());
  return est.conversaciones
    .filter((c) => {
      if (!est.verVacias && c.vacia) return false;
      if (!pasaFiltroOrigen(c, filtro)) return false;
      if (est.proyecto && nombreCarpeta(c) !== est.proyecto) return false;
      if (t && !normalizar(`${c.titulo} ${c.cwd || ''} ${c.primerPrompt || ''} ${c.id || ''}`).includes(t)) return false;
      return true;
    })
    .sort((a, b) => (b.hasta || '').localeCompare(a.hasta || ''));
}

function pintarProyectos() {
  const cuenta = new Map();
  for (const c of est.conversaciones) if (est.verVacias || !c.vacia) cuenta.set(nombreCarpeta(c), (cuenta.get(nombreCarpeta(c)) || 0) + 1);
  const sel = $('#proyecto');
  const actual = est.proyecto;
  sel.replaceChildren(h('option', { value: '' }, 'Todas las carpetas'));
  for (const [nombre, n] of [...cuenta].sort((a, b) => b[1] - a[1])) sel.append(h('option', { value: nombre }, `${nombre} (${n})`));
  sel.value = cuenta.has(actual) ? actual : '';
  est.proyecto = sel.value;
}

function insignias(c) {
  const lista = [];
  if (c.eliminadaEnOrigen && !c.recuperada) lista.push(h('span', { class: 'insignia borrada', title: `Ya no está en Claude desde ${fechaLarga(c.eliminadaEnOrigen)}. Esta copia es la única.` }, 'Borrada en Claude'));
  if (c.recuperada) lista.push(h('span', { class: 'insignia recuperada' }, 'Recuperada'));
  if (c.pendiente) lista.push(h('span', { class: 'insignia pendiente' }, c.soloEnClaude ? 'Sin respaldar' : 'Cambios sin respaldar'));
  if (c.archivadaEnApp) lista.push(h('span', { class: 'insignia' }, 'Archivada en la app'));
  if (c.subagentes) lista.push(h('span', { class: 'insignia' }, `${c.subagentes} subagente${c.subagentes === 1 ? '' : 's'}`));
  return lista.length ? h('div', { class: 'item-insignias' }, lista) : null;
}

function itemConversacion(c, extra) {
  const meta = [nombreCarpeta(c), c.mensajesUsuario != null ? `${c.mensajesUsuario} msj` : null, tamano(c.tamano)].filter(Boolean).join(' · ');
  return h(
    'button',
    { class: `item${est.seleccion === c.clave ? ' activo' : ''}`, role: 'listitem', 'data-clave': c.clave, onclick: () => abrirConversacion(c.clave, { resaltar: est.busqueda?.q }) },
    h('div', { class: 'item-titulo' }, c.titulo),
    h('div', { class: 'item-meta' }, h('span', null, meta), h('span', null, fechaCorta(c.hasta))),
    insignias(c),
    extra,
  );
}

function pintarLista() {
  for (const chip of $$('.chip')) {
    const n = filtradas(chip.dataset.filtro).length;
    chip.classList.toggle('activo', chip.dataset.filtro === est.filtro);
    const etiqueta = chip.dataset.etiqueta || (chip.dataset.etiqueta = chip.textContent);
    chip.replaceChildren(etiqueta, h('span', { class: 'n' }, numero(n)));
  }
  const lista = $('#lista');
  if (est.busqueda) return pintarResultados();
  const items = filtradas();
  $('#contador').textContent = `${numero(items.length)} conversaci${items.length === 1 ? 'ón' : 'ones'}`;
  const frag = document.createDocumentFragment();
  let grupo = null;
  for (const c of items) {
    const g = mes(c.hasta);
    if (g !== grupo) {
      frag.append(h('div', { class: 'grupo' }, g));
      grupo = g;
    }
    frag.append(itemConversacion(c));
  }
  if (!items.length) {
    frag.append(h('p', { class: 'sutil', style: 'padding:14px' }, est.conversaciones.length ? 'Ninguna conversación coincide con el filtro.' : 'Todavía no hay conversaciones archivadas.'));
  }
  lista.replaceChildren(frag);
}

async function buscarEnContenido() {
  const q = $('#filtro').value.trim();
  if (q.length < 2) {
    toast('Escribí al menos 2 letras para buscar.');
    return;
  }
  $('#contador').textContent = `Buscando “${q}” en todas las conversaciones…`;
  try {
    const resultados = await api(`/api/buscar?q=${enc(q)}`);
    est.busqueda = { q, resultados };
    est.texto = '';
    pintarLista();
  } catch (e) {
    toast(e.message, true);
  }
}

function resaltarTexto(texto, termino) {
  const frag = document.createDocumentFragment();
  frag.append(texto.antes, h('mark', null, texto.texto), texto.despues);
  return frag;
}

function pintarResultados() {
  const { q, resultados } = est.busqueda;
  const porClave = new Map(est.conversaciones.map((c) => [c.clave, c]));
  $('#contador').replaceChildren(
    h('span', null, `${numero(resultados.length)} conversaci${resultados.length === 1 ? 'ón contiene' : 'ones contienen'} “${q}” `),
    h('button', { class: 'boton chico', onclick: salirDeBusqueda }, 'Volver a la lista'),
  );
  const frag = document.createDocumentFragment();
  for (const r of resultados) {
    const c = porClave.get(r.clave) || { ...r, clave: r.clave };
    const fragmentos = r.fragmentos.map((f) => h('div', { class: 'item-fragmento' }, '…', resaltarTexto(f), '…'));
    frag.append(itemConversacion(c, [h('div', { class: 'item-meta' }, h('span', null, `${numero(r.coincidencias)} coincidencia${r.coincidencias === 1 ? '' : 's'}`)), fragmentos]));
  }
  if (!resultados.length) frag.append(h('p', { class: 'sutil', style: 'padding:14px' }, 'No aparece en ninguna conversación archivada. Ojo: las que todavía no se sincronizaron no se pueden buscar.'));
  $('#lista').replaceChildren(frag);
}

function salirDeBusqueda() {
  est.busqueda = null;
  $('#filtro').value = '';
  est.texto = '';
  pintarLista();
}

// ---------- Inicio (sin conversación abierta) ----------

function pintarInicio() {
  const e = est.app;
  if (!e) return;
  const visibles = est.conversaciones.filter((c) => !c.vacia);
  const borradas = visibles.filter((c) => c.eliminadaEnOrigen && !c.recuperada).length;
  const recuperadas = visibles.filter((c) => c.recuperada).length;
  const enClaude = visibles.length - borradas - recuperadas;
  const ultima = ultimaSincronizacion(e);

  const destinos = h('div', { class: 'bloque' },
    h('div', { class: 'bloque-titulo' }, h('h3', null, 'Dónde se guardan las copias'), h('button', { class: 'boton chico', onclick: abrirAjustes }, e.destinos.length ? 'Cambiar destinos' : 'Elegir destinos')),
    !e.destinos.length ? h('p', { class: 'sutil' }, 'Todavía no elegiste ningún lugar. Conviene uno en otro disco y otro en la nube (Google Drive, OneDrive): así no dependés de una sola copia.') : null,
    e.destinos.map((d, i) =>
      h('div', { class: 'fila-destino' },
        h('span', { class: `insignia ${d.disponible ? (d.ultimaSync ? 'ok' : '') : 'borrada'}` }, d.disponible ? (d.ultimaSync ? 'Al día' : 'Sin copia aún') : 'No disponible'),
        h('strong', { class: 'etiqueta-destino' }, d.etiqueta),
        h('span', { class: 'ruta', title: d.ruta }, d.ruta),
        h('span', { class: 'sutil' }, d.ultimaSync ? hace(d.ultimaSync) : ''),
        d.ultimaSync ? h('button', { class: 'boton chico', onclick: () => post('/api/abrir', { destino: i }).catch((x) => toast(x.message, true)) }, 'Abrir') : null,
      ),
    ),
  );

  const limpieza = e.limpieza;
  const protege = h('div', { class: 'bloque' }, h('h3', null, 'Cómo protege tus conversaciones'),
    h('p', null, 'Cada sincronización copia tus conversaciones de Claude Code, las de la app de escritorio y Cowork, sus subagentes, memorias y checkpoints. ', h('strong', null, 'Solo copia: nunca borra nada del archivo.')),
    h('p', null, 'Si borrás un chat desde la app, su archivo desaparece de tu PC, pero acá queda con la marca ', h('span', { class: 'insignia borrada' }, 'Borrada en Claude'), '. Lo que borres ', h('em', null, 'antes'), ' de sincronizar no se puede rescatar: conviene sincronizar seguido.'),
    h('p', { class: 'sutil' }, limpieza.configurado
      ? `Claude Code está configurado para borrar las sesiones de terminal con más de ${limpieza.dias} días (cleanupPeriodDays).`
      : 'Claude Code borra solo las sesiones de terminal con más de 30 días sin uso (cleanupPeriodDays). Las de la app de escritorio no tienen ese límite.'),
  );

  const visor = $('#visor');
  if (!ultima) {
    const hay = e.pendientes ? ` Hay ${numero(e.pendientes.conversaciones)} conversaciones y ${tamano(e.pendientes.bytes)} para respaldar.` : '';
    visor.replaceChildren(h('div', { class: 'visor-vacio' },
      h('h2', null, 'Tus conversaciones de Claude, a salvo'),
      h('p', { class: 'sutil' }, e.destinos.length ? `Todavía no hiciste ninguna copia.${hay}` : `Para empezar, elegí dónde guardar las copias.${hay}`),
      h('p', null, e.destinos.length
        ? h('button', { class: 'boton primario', onclick: sincronizarAhora, disabled: e.sincronizando }, e.sincronizando ? 'Sincronizando…' : 'Hacer la primera copia')
        : h('button', { class: 'boton primario', onclick: abrirAjustes }, 'Elegir dónde guardar las copias')),
      destinos, protege));
    return;
  }
  visor.replaceChildren(h('div', { class: 'visor-vacio' },
    h('h2', null, 'Tus conversaciones de Claude'),
    h('p', { class: 'sutil' }, `Última sincronización ${hace(ultima)}. Elegí una conversación de la lista para leerla.`),
    h('div', { class: 'tarjetas' },
      h('div', { class: 'tarjeta' }, h('div', { class: 'num' }, numero(visibles.length)), h('div', { class: 'etq' }, 'conversaciones archivadas')),
      h('div', { class: 'tarjeta' }, h('div', { class: 'num' }, numero(enClaude)), h('div', { class: 'etq' }, 'siguen en Claude')),
      h('div', { class: 'tarjeta' }, h('div', { class: 'num' }, numero(borradas)), h('div', { class: 'etq' }, 'borradas en Claude, rescatadas acá')),
      recuperadas ? h('div', { class: 'tarjeta' }, h('div', { class: 'num' }, numero(recuperadas)), h('div', { class: 'etq' }, 'recuperadas de copias anteriores')) : null,
    ),
    destinos, protege));
}

// ---------- Visor de una conversación ----------

function etiquetaTurno(quien, ts) {
  return h('div', { class: 'turno-etq' }, h('span', null, quien), ts ? h('span', { class: 'hora' }, fechaLarga(ts)) : null);
}

function avisoRecortado(ev) {
  if (!ev || !ev.truncado || ev.off == null) return null;
  return h('div', { class: 'recortado sutil' }, 'Texto recortado. ', h('button', { onclick: () => verLinea(ev.off) }, 'Ver completo'));
}

function urlImagen(off, n) {
  return `/api/imagen?clave=${enc(est.visor.clave)}&off=${off}&n=${n}&t=${TOKEN}`;
}
function miniatura(off, n) {
  const url = urlImagen(off, n);
  return h('button', { class: 'miniatura', title: 'Ver en grande', onclick: () => abrirModal('Imagen', h('img', { src: url, alt: 'Imagen de la conversación' })) }, h('img', { src: url, alt: 'Imagen de la conversación', loading: 'lazy' }));
}

function detalleHerramienta(ev) {
  const r = ev.resultado;
  return h('div', { class: 'herr-detalle' },
    ev.texto ? [h('h4', null, 'Entrada'), h('pre', null, ev.texto), avisoRecortado(ev)] : null,
    r
      ? [h('h4', null, r.error ? 'Resultado (error)' : 'Resultado'), r.texto ? h('pre', { class: r.error ? 'error' : null }, r.texto) : null, avisoRecortado(r), (r.imagenes || []).map((i) => miniatura(i.off, i.n))]
      : h('p', { class: 'sutil' }, 'Sin resultado registrado.'));
}

function nodoHerramienta(ev) {
  const r = ev.resultado;
  const d = h('details', { class: 'herramienta' },
    h('summary', null,
      h('span', { class: 'herr-nombre' }, ev.nombre),
      h('span', { class: 'herr-resumen' }, ev.resumen || ''),
      r && r.error ? h('span', { class: 'herr-estado error' }, 'error') : null,
      r && r.imagenes && r.imagenes.length ? h('span', { class: 'sutil' }, `${r.imagenes.length} img`) : null));
  d.addEventListener('toggle', () => {
    if (d.open && !d.dataset.listo) {
      d.dataset.listo = '1';
      d.append(detalleHerramienta(ev));
    }
  });
  return d;
}

function nodosEventos(eventos, contexto) {
  const nombre = est.app?.nombreUsuario || 'Vos';
  const nodos = [];
  for (const ev of eventos) {
    const hablante = ev.tipo === 'usuario' || ev.tipo === 'imagen' ? 'usuario' : ['claude', 'herramienta', 'pensamiento', 'resultado'].includes(ev.tipo) ? 'claude' : null;
    const nuevoTurno = hablante && hablante !== contexto.hablante;
    if (hablante) contexto.hablante = hablante;
    switch (ev.tipo) {
      case 'usuario':
        nodos.push(h('div', { class: 'turno usuario' }, etiquetaTurno(nombre, ev.ts), h('div', { class: 'contenido' }, ev.texto), avisoRecortado(ev)));
        break;
      case 'claude':
        nodos.push(h('div', { class: 'turno claude' }, nuevoTurno ? etiquetaTurno('Claude', ev.ts) : null, h('div', { class: 'contenido md', html: markdown(ev.texto) }), avisoRecortado(ev)));
        break;
      case 'herramienta':
        if (nuevoTurno) nodos.push(h('div', { class: 'turno claude' }, etiquetaTurno('Claude', ev.ts)));
        nodos.push(nodoHerramienta(ev));
        break;
      case 'resultado':
        nodos.push(nodoHerramienta({ nombre: 'Resultado', resumen: '', resultado: ev.resultado }));
        break;
      case 'pensamiento':
        nodos.push(h('details', { class: 'pensamiento' }, h('summary', null, 'Pensamiento'), h('div', { class: 'contenido' }, ev.texto), avisoRecortado(ev)));
        break;
      case 'imagen':
        nodos.push(h('div', { class: 'turno' }, nuevoTurno ? etiquetaTurno(nombre, ev.ts) : null, miniatura(ev.off, ev.n)));
        break;
      case 'comando':
        nodos.push(h('div', { class: 'evento-chico' }, 'Comando ', h('code', null, ev.texto)));
        break;
      case 'salida':
        nodos.push(h('details', { class: 'evento-chico' }, h('summary', null, 'Salida del comando'), h('pre', { class: 'crudo' }, ev.texto)));
        break;
      case 'interrupcion':
        nodos.push(h('div', { class: 'evento-chico' }, '⏹ Interrumpido por el usuario'));
        break;
      case 'compactacion':
        nodos.push(ev.resumenCompacto
          ? h('details', { class: 'evento-chico' }, h('summary', null, 'Resumen que Claude armó al compactar'), h('pre', { class: 'crudo' }, ev.texto), avisoRecortado(ev))
          : h('div', { class: 'marca-linea' }, 'Conversación compactada'));
        break;
      case 'sistema':
        nodos.push(h('details', { class: 'evento-chico' }, h('summary', null, 'Aviso del sistema'), h('pre', { class: 'crudo' }, ev.texto)));
        break;
    }
  }
  return nodos;
}

function terminosDe(consulta) {
  const s = (consulta || '').trim();
  if (/^".+"$/.test(s)) return [s.slice(1, -1)];
  return s.split(/\s+/).filter((t) => t.length >= 2);
}

function resaltarEn(raiz, consulta) {
  const terminos = terminosDe(consulta);
  if (!terminos.length) return;
  const re = new RegExp(terminos.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi');
  const walker = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement.closest('mark, script, style') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
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

let observador = null;

async function abrirConversacion(clave, { resaltar = null, padre = null } = {}) {
  est.seleccion = clave;
  for (const el of $$('.item')) el.classList.toggle('activo', el.dataset.clave === clave);
  const visor = $('#visor');
  visor.replaceChildren(h('div', { class: 'visor-vacio' }, h('p', { class: 'sutil' }, 'Abriendo la conversación…')));
  try {
    const pagina = await api(`/api/conversacion?clave=${enc(clave)}&desde=0&cantidad=${PAGINA}`);
    if (est.seleccion !== clave) return;
    est.visor = { clave, info: pagina.info, total: pagina.total, inicio: 0, fin: pagina.eventos.length, enArchivo: pagina.enArchivo, resaltar, padre, contextoFin: { hablante: null } };
    pintarVisor(pagina.eventos);
  } catch (e) {
    visor.replaceChildren(h('div', { class: 'visor-vacio' }, h('h2', null, 'No se pudo abrir'), h('p', { class: 'sutil' }, e.message)));
  }
}

function datosConversacion(i) {
  const partes = [];
  if (i.cwd) partes.push(h('span', { title: i.cwd }, '📁 ', i.cwd));
  partes.push(h('span', null, `${fechaLarga(i.desde)} → ${fechaLarga(i.hasta)}`));
  partes.push(h('span', null, `${numero(i.mensajesUsuario)} mensajes tuyos · ${numero(i.respuestas)} respuestas · ${numero(i.herramientas)} herramientas`));
  if (i.tamano) partes.push(h('span', null, tamano(i.tamano)));
  if (i.modelos && i.modelos.length) partes.push(h('span', null, i.modelos.join(', ')));
  if (i.rama && i.rama !== 'HEAD') partes.push(h('span', null, `rama ${i.rama}`));
  if (i.lineasDanadas) partes.push(h('span', { class: 'insignia recuperada' }, `${i.lineasDanadas} líneas dañadas`));
  if (i.id) partes.push(h('span', null, 'ID ', h('code', null, i.id)));
  return h('div', { class: 'datos-conv' }, partes);
}

function pintarVisor(eventos) {
  const v = est.visor;
  const i = v.info;
  const visor = $('#visor');
  visor.classList.toggle('sin-herramientas', !preferencias.herramientas);
  visor.classList.toggle('sin-pensamiento', !preferencias.pensamiento);

  const acciones = h('div', { class: 'acciones-conv' },
    v.padre ? h('button', { class: 'boton chico', onclick: () => abrirConversacion(v.padre) }, '← Volver a la conversación') : null,
    h('button', { class: 'boton chico', onclick: () => post('/api/abrir', { clave: v.clave }).catch((x) => toast(x.message, true)) }, 'Mostrar en el Explorador'),
    h('a', { class: 'boton chico', href: `/api/exportar?clave=${enc(v.clave)}&t=${TOKEN}`, download: '' }, 'Exportar .md'),
    i.id ? h('button', { class: 'boton chico', onclick: () => copiar(i.id, 'ID copiado') }, 'Copiar ID') : null,
    !i.enClaude && v.enArchivo && i.id ? h('button', { class: 'boton chico', onclick: restaurarActual, title: 'Copia la conversación a Claude Code para poder retomarla. No pisa nada.' }, 'Restaurar en Claude') : null,
    i.enClaude && i.comandoRetomar ? h('button', { class: 'boton chico', onclick: () => mostrarComando(i.comandoRetomar) }, 'Cómo retomarla') : null,
    h('span', { class: 'separador' }),
    h('label', { class: 'interruptor' }, h('input', { type: 'checkbox', checked: preferencias.herramientas, onchange: (e) => alternar('herramientas', e.target.checked) }), 'Herramientas'),
    h('label', { class: 'interruptor' }, h('input', { type: 'checkbox', checked: preferencias.pensamiento, onchange: (e) => alternar('pensamiento', e.target.checked) }), 'Pensamiento'),
    v.resaltar ? h('button', { class: 'boton chico', onclick: siguienteCoincidencia }, `Siguiente “${v.resaltar}”`) : null,
    h('button', { class: 'boton chico', onclick: irAlFinal }, 'Ir al final'),
  );

  const insig = insignias({ ...i, pendiente: false, subagentes: 0, eliminadaEnOrigen: i.eliminadaEnOrigen, recuperada: i.recuperada });
  const cabecera = h('div', { class: 'cabecera-conv' }, h('h2', null, i.titulo || 'Sin título'), insig, datosConversacion(i), acciones);
  if (i.subagentes) {
    const sub = h('details', { class: 'subagentes' }, h('summary', null, `Subagentes (${i.subagentes})`));
    sub.addEventListener('toggle', async () => {
      if (!sub.open || sub.dataset.listo) return;
      sub.dataset.listo = '1';
      try {
        const lista = await api(`/api/subagentes?clave=${enc(v.clave)}`);
        sub.append(h('ul', null, lista.map((s) => h('li', null, h('button', { onclick: () => abrirConversacion(s.clave, { padre: v.clave }) }, `${s.descripcion || s.clave.split('/').pop()}${s.fase ? ` (${s.fase})` : ''} · ${tamano(s.tamano)}`)))));
      } catch (e) {
        sub.append(h('p', { class: 'sutil' }, e.message));
      }
    });
    cabecera.append(sub);
  }

  const transcripcion = h('div', { class: 'transcripcion' });
  const arriba = h('div', { class: 'cargar-mas', id: 'cargar-anteriores', hidden: true }, h('button', { class: 'boton chico', onclick: cargarAnteriores }, 'Cargar mensajes anteriores'));
  const cuerpo = h('div', { id: 'eventos' });
  const centinela = h('div', { class: 'cargar-mas sutil', id: 'centinela' });
  transcripcion.append(arriba, cuerpo, centinela);
  cuerpo.append(...nodosEventos(eventos, v.contextoFin));
  if (!eventos.length) cuerpo.append(h('p', { class: 'sutil' }, 'Esta conversación no tiene mensajes legibles.'));
  resaltarEn(cuerpo, v.resaltar);
  visor.replaceChildren(cabecera, transcripcion);
  visor.scrollTop = 0;
  actualizarBordes();

  if (observador) observador.disconnect();
  observador = new IntersectionObserver((entradas) => {
    if (entradas.some((x) => x.isIntersecting)) cargarSiguientes();
  }, { root: visor, rootMargin: '600px' });
  observador.observe(centinela);
}

function actualizarBordes() {
  const v = est.visor;
  const arriba = $('#cargar-anteriores');
  if (arriba) arriba.hidden = v.inicio === 0;
  const centinela = $('#centinela');
  if (centinela) centinela.textContent = v.fin < v.total ? 'Cargando más…' : v.total ? 'Fin de la conversación' : '';
}

let cargando = false;
async function cargarSiguientes() {
  const v = est.visor;
  if (!v || cargando || v.fin >= v.total) return false;
  cargando = true;
  try {
    const p = await api(`/api/conversacion?clave=${enc(v.clave)}&desde=${v.fin}&cantidad=${PAGINA}`);
    if (est.visor !== v) return false;
    const nodos = nodosEventos(p.eventos, v.contextoFin);
    const cont = h('div');
    cont.append(...nodos);
    resaltarEn(cont, v.resaltar);
    $('#eventos').append(...cont.childNodes);
    v.fin += p.eventos.length;
    v.total = p.total;
    actualizarBordes();
    return true;
  } catch (e) {
    toast(e.message, true);
    return false;
  } finally {
    cargando = false;
  }
}

async function cargarAnteriores() {
  const v = est.visor;
  if (!v || cargando || v.inicio === 0) return;
  cargando = true;
  try {
    const desde = Math.max(0, v.inicio - PAGINA);
    const p = await api(`/api/conversacion?clave=${enc(v.clave)}&desde=${desde}&cantidad=${v.inicio - desde}`);
    if (est.visor !== v) return;
    const visor = $('#visor');
    const alto = visor.scrollHeight;
    const cont = h('div');
    cont.append(...nodosEventos(p.eventos, { hablante: null }));
    resaltarEn(cont, v.resaltar);
    $('#eventos').prepend(...cont.childNodes);
    visor.scrollTop += visor.scrollHeight - alto;
    v.inicio = desde;
    actualizarBordes();
  } catch (e) {
    toast(e.message, true);
  } finally {
    cargando = false;
  }
}

async function irAlFinal() {
  const v = est.visor;
  if (!v) return;
  if (v.fin < v.total) {
    const desde = Math.max(v.fin, v.total - PAGINA);
    try {
      const p = await api(`/api/conversacion?clave=${enc(v.clave)}&desde=${desde}&cantidad=${PAGINA}`);
      if (est.visor !== v) return;
      v.contextoFin = { hablante: null };
      const cont = h('div');
      cont.append(...nodosEventos(p.eventos, v.contextoFin));
      resaltarEn(cont, v.resaltar);
      $('#eventos').replaceChildren(...cont.childNodes);
      v.inicio = desde;
      v.fin = desde + p.eventos.length;
      actualizarBordes();
    } catch (e) {
      toast(e.message, true);
      return;
    }
  }
  const visor = $('#visor');
  visor.scrollTop = visor.scrollHeight;
}

async function siguienteCoincidencia() {
  const visor = $('#visor');
  const limite = visor.getBoundingClientRect().top + 140;
  for (let intentos = 0; intentos < 200; intentos++) {
    const siguiente = $$('#eventos mark').find((m) => m.getBoundingClientRect().top > limite + 4);
    if (siguiente) {
      siguiente.scrollIntoView({ block: 'center' });
      return;
    }
    if (!(await cargarSiguientes())) break;
  }
  toast('No hay más coincidencias en esta conversación.');
}

function alternar(cual, valor) {
  preferencias[cual] = valor;
  guardarPreferencias();
  const visor = $('#visor');
  visor.classList.toggle('sin-herramientas', !preferencias.herramientas);
  visor.classList.toggle('sin-pensamiento', !preferencias.pensamiento);
}

async function verLinea(off) {
  try {
    const datos = await api(`/api/linea?clave=${enc(est.visor.clave)}&off=${off}`);
    abrirModal('Mensaje completo (JSON original)', h('pre', { class: 'crudo' }, JSON.stringify(datos, null, 2)));
  } catch (e) {
    toast(e.message, true);
  }
}

function mostrarComando(comando, intro) {
  abrirModal('Retomar en Claude Code', h('div', { class: 'comando' },
    h('p', null, intro || 'Abrí una terminal (PowerShell) y corré:'),
    h('pre', { class: 'crudo' }, comando),
    h('p', null, h('button', { class: 'boton chico', onclick: () => copiar(comando, 'Comando copiado') }, 'Copiar comando')),
    h('p', { class: 'sutil' }, 'No va a aparecer en la barra lateral de la app de escritorio: se retoma desde la terminal. En la app podés probar el comando /resume, que lista las sesiones de terminal de esta PC.')));
}

async function restaurarActual(evento) {
  const v = est.visor;
  const boton = evento.currentTarget;
  try {
    const r = await post('/api/restaurar', { clave: v.clave });
    const intro = r.yaExistia
      ? `Esta conversación ya estaba en Claude (${r.ruta}). No se tocó nada.`
      : `Listo: se copió a ${r.ruta}${r.auxCopiados ? ` junto con ${r.auxCopiados} archivos de subagentes y herramientas` : ''}. Para retomarla, abrí una terminal y corré:`;
    if (r.comando) mostrarComando(r.comando, intro);
    else toast(intro);
    v.info.enClaude = true;
    if (r.comando) boton.replaceWith(h('button', { class: 'boton chico', onclick: () => mostrarComando(r.comando) }, 'Cómo retomarla'));
    else boton.remove();
  } catch (e) {
    toast(e.message, true);
  }
}

// ---------- Ajustes, modal y eventos globales ----------

function abrirModal(titulo, contenido) {
  $('#modal-titulo').textContent = titulo;
  $('#modal-cuerpo').replaceChildren(contenido);
  $('#modal').hidden = false;
  $('#modal [data-cerrar].boton').focus();
}

function abrirAjustes() {
  if (!est.app) return;
  $('#ajustes').hidden = false;
  pintarAjustes();
  $('#ajustes [data-cerrar].boton').focus();
}

const avisarError = (x) => toast(x.message, true);

function filaDestinoAjustes(d, i, total, ocupado) {
  const estado = !d.disponible ? ['borrada', 'No disponible'] : d.ultimaSync ? ['ok', 'Al día'] : ['', 'Sin copia aún'];
  return h('div', { class: 'destino' },
    h('div', { class: 'destino-cabecera' },
      h('span', { class: `insignia ${estado[0]}` }, estado[1]),
      h('strong', null, d.etiqueta),
      i === 0 ? h('span', { class: 'insignia', title: 'La app te muestra las conversaciones desde este destino.' }, 'Principal') : null,
      d.ultimaSync ? h('span', { class: 'sutil' }, `última copia ${hace(d.ultimaSync)}`) : null),
    h('div', { class: 'ruta', title: d.ruta }, d.ruta),
    !d.disponible && d.motivo ? h('p', { class: 'nota' }, d.motivo) : null,
    d.streaming ? h('p', { class: 'nota' }, 'Google Drive en modo transmisión: para que la copia quede en tu disco y se suba sola, en el Explorador hacé clic derecho en esta carpeta → ', h('strong', null, 'Acceso sin conexión → Disponible sin conexión'), d.existe ? '.' : ' (después de la primera sincronización, cuando ya exista).') : null,
    h('div', { class: 'acciones-destino' },
      d.existe ? h('button', { class: 'boton chico', onclick: () => post('/api/abrir', { destino: i }).catch(avisarError) }, 'Abrir') : null,
      d.existe ? h('button', { class: 'boton chico', onclick: () => accesoDirecto(i) }, 'Acceso directo en el Escritorio') : null,
      i > 0 ? h('button', { class: 'boton chico', disabled: ocupado, onclick: () => cambiarDestinos({ accion: 'subir', indice: i }) }, i === 1 ? 'Hacer principal' : 'Subir') : null,
      total > 1 ? h('button', { class: 'boton chico peligro', disabled: ocupado, onclick: () => confirmarQuitar(d, i) }, 'Quitar de la lista') : null));
}

function pintarAjustes() {
  const e = est.app;
  const ocupado = e.sincronizando;
  $('#ajustes-cuerpo').replaceChildren(
    h('div', { class: 'bloque' }, h('h3', null, 'Destinos: dónde se guardan las copias'),
      h('p', { class: 'sutil' }, 'Cada sincronización copia todo a cada destino. Quitar un destino no borra nada: la carpeta queda como está y solo deja de actualizarse.'),
      ocupado ? h('p', { class: 'nota' }, 'Hay una sincronización en curso: esperá a que termine para cambiar los destinos.') : null,
      e.destinos.map((d, i) => filaDestinoAjustes(d, i, e.destinos.length, ocupado))),
    h('div', { class: 'bloque' }, h('h3', null, 'Agregar otro destino'),
      h('p', { class: 'sutil' }, 'Una carpeta de Google Drive, OneDrive, otro disco o un NAS. Lo que la app guarde en una carpeta sincronizada se sube solo a la nube.'),
      h('div', { id: 'sugerencias' }, h('p', { class: 'sutil' }, 'Buscando Google Drive, OneDrive y otros…')),
      h('div', { class: 'fila-agregar' },
        h('input', { id: 'nuevo-destino', type: 'text', placeholder: 'Ej.: G:\\Mi unidad\\Claude-Archivo', 'aria-label': 'Carpeta del nuevo destino', onkeydown: (ev) => ev.key === 'Enter' && agregarDestino() }),
        h('button', { class: 'boton chico', onclick: () => abrirExplorador() }, 'Elegir carpeta…'),
        h('button', { class: 'boton chico primario', disabled: ocupado, onclick: agregarDestino }, 'Agregar')),
      h('p', { id: 'mensaje-destino', class: 'sutil', role: 'status' })),
    h('div', { class: 'bloque' }, h('h3', null, 'Qué se copia'),
      h('ul', { class: 'lista-fuentes' }, e.fuentes.map((f) => h('li', null, h('div', null, f.nombre), h('code', null, f.origen), h('div', { class: 'sutil' }, '→ ', h('code', null, `${f.destino}/`)))))),
    h('div', { class: 'bloque' }, h('h3', null, 'Tu nombre'),
      h('p', { class: 'sutil' }, 'Es como aparecen tus mensajes en las conversaciones y en los textos exportados.'),
      h('div', { class: 'fila-agregar' },
        h('input', { id: 'nombre-usuario', type: 'text', maxlength: '40', value: e.nombreUsuario || '', 'aria-label': 'Tu nombre', onkeydown: (ev) => ev.key === 'Enter' && guardarNombre() }),
        h('button', { class: 'boton chico', onclick: guardarNombre }, 'Guardar'))),
    h('div', { class: 'bloque' }, h('h3', null, 'Configuración'),
      h('p', null, 'Lo que se copia se cambia en ', h('code', null, 'config.json'), ' (después, volvé a abrir la app). Antes de cada cambio desde la app, se guarda una copia del config anterior.'),
      h('p', null,
        h('button', { class: 'boton chico', onclick: () => post('/api/abrir', { que: 'configuracion' }).catch(avisarError) }, 'Mostrar config.json'), ' ',
        h('button', { class: 'boton chico', onclick: () => post('/api/abrir', { que: 'log' }).catch(avisarError) }, 'Mostrar el registro de la app'))),
    h('p', { class: 'sutil version' }, `Claude Archivo ${e.version || ''} · `,
      h('a', { href: 'https://github.com/FSichi/Claude-Sync-App/releases', target: '_blank', rel: 'noopener noreferrer' }, 'Ver si hay una versión nueva')),
  );
  cargarSugerencias();
}

async function guardarNombre() {
  try {
    const r = await post('/api/nombre', { nombre: $('#nombre-usuario').value });
    est.app.nombreUsuario = r.nombreUsuario;
    toast(`Listo: tus mensajes se van a mostrar como "${r.nombreUsuario}".`);
  } catch (err) {
    toast(err.message, true);
  }
}

function mensajeDestino(texto, error = false) {
  const m = $('#mensaje-destino');
  if (!m) return;
  m.textContent = texto || '';
  m.className = error ? 'nota error' : 'sutil';
}

async function cargarSugerencias() {
  const caja = $('#sugerencias');
  try {
    const { sugerencias, tamanoArchivo } = await api('/api/destinos/sugerencias');
    est.tamanoArchivo = tamanoArchivo;
    if (!caja.isConnected) return;
    caja.replaceChildren(!sugerencias.length ? '' : h('div', { class: 'sugerencias' },
      h('div', { class: 'sutil' }, 'Encontré estos lugares en tu PC (clic para usarlo):'),
      sugerencias.map((s) => h('button', {
        class: 'sugerencia',
        onclick: () => {
          $('#nuevo-destino').value = s.ruta;
          mensajeDestino(s.nota);
          $('#nuevo-destino').focus();
        },
      }, h('strong', null, s.nombre), h('span', { class: 'ruta' }, s.ruta)))));
  } catch (err) {
    caja.replaceChildren(h('p', { class: 'sutil' }, err.message));
  }
}

async function cambiarDestinos(datos) {
  const r = await post('/api/destinos', datos);
  est.app.destinos = r.destinos;
  pintarAjustes();
  actualizarEstado();
  return r;
}

async function agregarDestino() {
  const ruta = $('#nuevo-destino').value.trim();
  try {
    await cambiarDestinos({ accion: 'agregar', ruta });
    const tam = est.tamanoArchivo ? ` (hoy, unos ${tamano(est.tamanoArchivo)})` : '';
    toast(`Destino agregado. La próxima sincronización copia ahí todo el archivo${tam}.`);
  } catch (err) {
    mensajeDestino(err.message, true);
  }
}

function confirmarQuitar(d, i) {
  abrirModal('Quitar un destino', h('div', null,
    h('p', null, '¿Quitar ', h('code', null, d.ruta), ' de la lista?'),
    h('p', { class: 'sutil' }, 'No se borra nada: la carpeta y todo lo que tiene quedan como están. Solo deja de actualizarse. Podés volver a agregarla cuando quieras.'),
    h('p', null,
      h('button', { class: 'boton chico peligro', onclick: () => { cerrarModal(); cambiarDestinos({ accion: 'quitar', indice: i }).catch(avisarError); } }, 'Quitar de la lista'), ' ',
      h('button', { class: 'boton chico', 'data-cerrar': true }, 'Cancelar'))));
}

async function accesoDirecto(i) {
  try {
    const r = await post('/api/acceso-directo', { destino: i });
    toast(r.yaExistia ? `Ya había un acceso directo con ese nombre en el Escritorio: no lo toqué (${r.ruta}).` : `Listo: creé el acceso directo en el Escritorio (${r.ruta}).`);
  } catch (err) {
    toast(err.message, true);
  }
}

// Explorador de carpetas propio, para elegir dónde guardar una copia.
const unirRuta = (base, nombre) => `${base.replace(/\\$/, '')}\\${nombre}`;
const rutaPropuesta = (r) => (/(^|\\)Claude-Archivo$/i.test(r) ? r : unirRuta(r, 'Claude-Archivo'));

async function abrirExplorador(ruta = null) {
  try {
    const datos = await api(`/api/carpetas${ruta ? `?ruta=${enc(ruta)}` : ''}`);
    const boton = (nombre, destino) => h('button', { class: 'carpeta', onclick: () => abrirExplorador(destino) }, h('span', { 'aria-hidden': 'true' }, '📁'), nombre);
    const lista = datos.ruta === null
      ? [h('h4', null, 'Lugares'), datos.lugares.map((l) => boton(l.nombre, l.ruta)), h('h4', null, 'Discos'), datos.discos.map((d) => boton(d.nombre, d.ruta))]
      : datos.carpetas.length ? datos.carpetas.map((n) => boton(n, unirRuta(datos.ruta, n))) : h('p', { class: 'sutil' }, 'No hay subcarpetas.');
    abrirModal('Elegí dónde guardar la copia', h('div', { class: 'explorador' },
      h('div', { class: 'explorador-ruta' },
        h('button', { class: 'boton chico', disabled: datos.ruta === null, onclick: () => abrirExplorador(datos.padre || null) }, '↑ Subir'),
        h('code', null, datos.ruta ?? 'Este equipo')),
      h('div', { class: 'explorador-lista' }, lista),
      datos.ruta ? h('div', { class: 'explorador-pie' },
        h('span', { class: 'sutil' }, 'Se va a guardar en ', h('code', null, rutaPropuesta(datos.ruta))),
        h('button', { class: 'boton chico primario', onclick: () => { $('#nuevo-destino').value = rutaPropuesta(datos.ruta); mensajeDestino(''); cerrarModal(); } }, 'Usar esta carpeta')) : null));
  } catch (err) {
    toast(err.message, true);
  }
}

function cerrarModal() {
  $('#modal').hidden = true;
}

function cerrarCapas() {
  if (!$('#modal').hidden) cerrarModal();
  else $('#ajustes').hidden = true;
}

document.addEventListener('click', (e) => {
  const boton = e.target.closest('[data-cerrar]');
  if (!boton) return;
  if (boton.closest('#modal')) cerrarModal();
  else $('#ajustes').hidden = true;
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') cerrarCapas();
  if (e.key === '/' && !e.target.closest('input, textarea, select')) {
    e.preventDefault();
    $('#filtro').focus();
  }
});

$('#btn-sincronizar').addEventListener('click', sincronizarAhora);
$('#btn-ajustes').addEventListener('click', abrirAjustes);
$('#btn-buscar').addEventListener('click', buscarEnContenido);
$('#filtro').addEventListener('input', (e) => {
  est.texto = e.target.value;
  if (est.busqueda) est.busqueda = null;
  pintarLista();
});
$('#filtro').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') buscarEnContenido();
});
$('#proyecto').addEventListener('change', (e) => {
  est.proyecto = e.target.value;
  pintarLista();
});
$('#ver-vacias').addEventListener('change', (e) => {
  est.verVacias = e.target.checked;
  pintarProyectos();
  pintarLista();
});
for (const chip of $$('.chip')) {
  chip.addEventListener('click', () => {
    est.filtro = chip.dataset.filtro;
    if (est.busqueda) salirDeBusqueda();
    else pintarLista();
  });
}

// Latido: si la ventana se cierra, la app se apaga sola a los pocos minutos.
const latido = () => post('/api/latido').catch(() => {});
setInterval(latido, 20000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    latido();
    actualizarEstado();
  }
});

actualizarEstado();
cargarConversaciones();
