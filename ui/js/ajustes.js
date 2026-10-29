// Ajustes: General, Destinos, Comprobar copias, Qué se copia, App y Avanzado.
import { h, api, post, avisarError, toast, hace, tamano, numero, fechaDia, aplicarTema, leerPref, plural, enc } from './util.js';
import { icono } from './iconos.js';
import { est, actualizarEstado, comprobarCopias, repararCopias } from './estado.js';
import { abrirModal, confirmar } from './capas.js';
import { iconoDestino, estadoDestino } from './inicio.js';
import { comprobarActualizacion, abrirModalVersion, nodoNotas } from './actualizacion.js';
import { SECCIONES_AJUSTES } from './rail.js';

let contenedor = null;
let seccionActual = null;

const cabecera = (titulo, texto) => h('header', { class: 'ajustes-cab' }, h('h1', null, titulo), texto ? h('p', null, texto) : null);
const ajuste = (titulo, desc, ...control) => h('div', { class: 'ajuste' },
  h('div', { class: 'ajuste-texto' }, h('div', { class: 'titulo' }, titulo), desc ? h('div', { class: 'desc' }, desc) : null),
  h('div', { class: 'ajuste-control' }, ...control));
const abrir = (datos) => post('/api/abrir', datos).catch(avisarError);

// ---------- General ----------

function general() {
  const e = est.app;
  const nombre = h('input', { class: 'entrada', type: 'text', maxlength: '40', value: e.nombreUsuario || '', 'aria-label': 'Tu nombre' });
  const guardar = async () => {
    try {
      await post('/api/ajustes', { nombreUsuario: nombre.value });
      await actualizarEstado();
      toast('Nombre guardado', 'ok');
    } catch (err) {
      avisarError(err);
    }
  };
  nombre.addEventListener('keydown', (ev) => ev.key === 'Enter' && guardar());
  const tema = leerPref('tema', 'sistema');
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Tema' },
    [['sistema', 'monitor', 'Sistema'], ['oscuro', 'luna', 'Oscuro'], ['claro', 'sol', 'Claro']].map(([id, ic, texto]) =>
      h('button', { type: 'button', 'aria-pressed': String(tema === id), onclick: (ev) => {
        aplicarTema(id);
        for (const b of ev.currentTarget.parentElement.children) b.setAttribute('aria-pressed', String(b === ev.currentTarget));
      } }, icono(ic, 14), texto)));
  const dias = [[0, 'No avisar'], [1, '1 día'], [2, '2 días'], [3, '3 días'], [5, '5 días'], [7, '1 semana'], [14, '2 semanas']];
  if (!dias.some(([n]) => n === e.recordatorioDias)) dias.push([e.recordatorioDias, `${e.recordatorioDias} días`]);
  const recordatorio = h('select', {
    class: 'selector',
    'aria-label': 'Avisar si pasan días sin sincronizar',
    value: String(e.recordatorioDias),
    onchange: async (ev) => {
      try {
        await post('/api/ajustes', { recordatorioDias: Number(ev.target.value) });
        await actualizarEstado();
        toast('Recordatorio guardado', 'ok');
      } catch (err) {
        avisarError(err);
      }
    },
  }, dias.map(([n, texto]) => h('option', { value: String(n) }, texto)));
  return [
    cabecera('General'),
    h('div', { class: 'lista-ajustes' },
      ajuste('Tu nombre', 'Cómo aparecen tus mensajes en las conversaciones y en los textos exportados.', nombre, h('button', { type: 'button', class: 'btn', onclick: guardar }, 'Guardar')),
      ajuste('Tema', 'Sistema usa el mismo que Windows.', seg),
      ajuste('Recordatorio para sincronizar', 'Si pasan estos días sin sincronizar y hay conversaciones con cambios, el inicio te avisa. La app nunca sincroniza sola.', recordatorio)),
  ];
}

// ---------- Comprobar copias ----------

const TIPOS_PROBLEMA = {
  falta: 'Falta en el destino',
  tamano: 'Tiene otro tamaño que el que se copió',
  contenido: 'El contenido está dañado',
  ilegible: 'No se pudo leer',
};

async function verProblemas(i, d) {
  try {
    const c = await api(`/api/comprobacion?destino=${i}`);
    const grupos = Object.entries(TIPOS_PROBLEMA).map(([tipo, texto]) => [texto, c.problemas.filter((p) => p.tipo === tipo)]).filter(([, l]) => l.length);
    const capa = abrirModal({
      titulo: `Problemas en ${d.etiqueta}`,
      ancho: 820,
      contenido: [
        h('p', { class: 'sutil' }, `Comprobación ${c.fondo ? 'a fondo' : 'rápida'} ${hace(c.fecha)}.${c.totalProblemas > c.problemas.length ? ` Se muestran ${numero(c.problemas.length)} de ${numero(c.totalProblemas)}.` : ''}`),
        ...grupos.map(([texto, lista]) => h('section', { class: 'seccion' },
          h('h3', { class: 'seccion-titulo' }, `${texto} (${numero(lista.length)})`),
          h('div', { class: 'filas' }, lista.map((p) => h('div', { class: 'fila' },
            h('code', { class: 'fila-titulo mono', title: p.rel }, p.rel),
            p.borradaEnClaude ? h('span', { class: 'etq etq-peligro', title: 'Claude ya no lo tiene: la copia buena tiene que salir de otro destino' }, 'Borrado en Claude') : null,
            p.alSincronizar ? h('span', { class: 'etq etq-acento', title: 'Claude tiene una versión más nueva: la próxima sincronización lo pone al día' }, 'Se arregla al sincronizar') : null,
            p.error ? h('span', { class: 'etq etq-alerta', title: p.error }, 'Error') : null))))),
      ],
      pie: [
        h('p', { class: 'nota' }, 'Reparar copia la versión buena desde Claude o desde otro destino. Antes guarda la dañada en _versiones/: no se borra nada.'),
        h('button', { type: 'button', class: 'btn btn-primario', disabled: est.app.sincronizando || est.app.comprobando, onclick: () => { capa.cerrar(); repararCopias(i); } }, 'Reparar'),
      ],
    });
  } catch (e) {
    avisarError(e);
  }
}

async function aFondo(d, i) {
  const si = await confirmar({
    titulo: `Comprobar ${d.etiqueta} a fondo`,
    texto: `Lee todo lo que hay en el destino${d.comprobacion?.bytes ? ` (unos ${tamano(d.comprobacion.bytes)})` : ''} y lo compara con Claude y con la comprobación anterior. Puede tardar varios minutos.${d.streaming ? ' En Google Drive en modo transmisión, también baja de internet lo que no esté disponible sin conexión.' : ''}`,
    aceptar: 'Comprobar a fondo',
  });
  if (si) comprobarCopias([i], true);
}

function filaComprobacion(d, i, ocupado) {
  const c = d.comprobacion;
  const [clase, texto] = !d.disponible ? ['peligro', 'No disponible'] : !c ? ['', 'Nunca se comprobó'] : c.problemas ? ['peligro', plural(c.problemas, 'archivo con problemas', 'archivos con problemas')] : ['ok', 'Sin problemas'];
  const desc = c
    ? `${c.reparado ? `Reparado ${hace(c.reparado)}` : `Comprobación ${c.fondo ? 'a fondo' : 'rápida'} ${hace(c.fecha)}`} · ${plural(c.archivos, 'archivo', 'archivos')}, ${tamano(c.bytes)}`
    : 'Todavía no se comprobó este destino.';
  return h('div', { class: 'destino' },
    icono(iconoDestino(d), 20),
    h('div', { class: 'destino-info' },
      h('div', { class: 'nombre' }, d.etiqueta, h('span', { class: `estado-texto ${clase}` }, texto)),
      h('div', { class: 'ruta' }, d.ruta),
      h('div', { class: 'desc' }, desc)),
    h('div', { class: 'acciones' },
      c?.problemas ? h('button', { type: 'button', class: 'btn btn-chico', onclick: () => verProblemas(i, d) }, 'Ver detalle') : null,
      c?.problemas ? h('button', { type: 'button', class: 'btn btn-chico btn-primario', disabled: ocupado, onclick: () => repararCopias(i) }, 'Reparar') : null,
      h('button', { type: 'button', class: 'btn btn-chico', disabled: ocupado || !d.disponible, onclick: () => comprobarCopias([i], false) }, 'Rápida'),
      h('button', { type: 'button', class: 'btn btn-chico', disabled: ocupado || !d.disponible, onclick: () => aFondo(d, i) }, 'A fondo')));
}

function comprobacion() {
  const e = est.app;
  const ocupado = e.sincronizando || e.comprobando;
  const p = e.progresoComprobacion;
  const fraccion = p ? (p.bytesTotal ? p.bytesHechos / p.bytesTotal : p.total ? p.hechos / p.total : null) : null;
  return [
    cabecera('Comprobar copias', 'Revisa que en cada destino esté todo lo que se copió y que nada se haya dañado. Lo que esté mal se repara con la versión buena de Claude o de otro destino, sin borrar nada.'),
    e.comprobando && p ? h('div', { class: 'tarjeta progreso-tarjeta', role: 'status' },
      h('div', { class: 'sync-estado' }, h('span', { class: 'estado-punto acento' }), h('span', null, `${p.fase === 'reparando' ? 'Reparando' : p.fondo ? 'Comprobando a fondo' : 'Comprobando'} ${p.destino}`), fraccion != null ? h('span', { class: 'tenue' }, `${Math.round(fraccion * 100)} %`) : null),
      h('div', { class: `barra${fraccion == null ? ' indeterminada' : ''}` }, h('div', { class: 'barra-relleno', style: fraccion != null ? `width: ${Math.round(fraccion * 100)}%` : null })),
      h('div', { class: 'sync-detalle' }, p.bytesTotal ? `${tamano(p.bytesHechos)} de ${tamano(p.bytesTotal)}` : p.total ? `${numero(p.hechos)} de ${numero(p.total)} archivos` : '')) : null,
    e.errorComprobacion ? h('div', { class: 'aviso error', role: 'alert' }, icono('alerta', 18), h('div', { class: 'aviso-texto' }, `La última comprobación falló: ${e.errorComprobacion}`)) : null,
    e.destinos.length
      ? h('div', { class: 'lista-ajustes' }, e.destinos.map((d, i) => filaComprobacion(d, i, ocupado)))
      : h('div', { class: 'vacio-tarjeta' }, icono('escudo', 22), h('p', null, 'Primero elegí dónde guardar las copias, en Destinos.')),
    e.destinos.length > 1 ? h('div', null, h('button', { type: 'button', class: 'btn', disabled: ocupado, onclick: () => comprobarCopias([], false) }, icono('escudo', 15), 'Comprobar todos (rápida)')) : null,
    h('div', { class: 'grid-2' },
      h('div', { class: 'tarjeta explicacion' }, h('h3', null, 'Rápida'), h('p', null, 'Mira que cada archivo esté y tenga el tamaño esperado. Tarda segundos y no lee el contenido, así que en Google Drive no baja nada.')),
      h('div', { class: 'tarjeta explicacion' }, h('h3', null, 'A fondo'), h('p', null, 'Lee cada archivo y compara su huella (SHA-256) con Claude, si no cambió, o con la comprobación anterior. Encuentra archivos dañados aunque tengan el tamaño correcto.'))),
  ];
}

// ---------- Destinos ----------

async function cambiarDestinos(datos) {
  await post('/api/destinos', datos);
  await actualizarEstado();
  repintar();
}

function filaDestino(d, i, total, ocupado) {
  const s = estadoDestino(d);
  return h('div', { class: 'destino' },
    icono(iconoDestino(d), 20),
    h('div', { class: 'destino-info' },
      h('div', { class: 'nombre' }, d.etiqueta,
        i === 0 ? h('span', { class: 'etq', title: 'La app te muestra las conversaciones desde este destino' }, 'Principal') : null,
        h('span', { class: `estado-texto ${s.clase}` }, s.texto)),
      h('div', { class: 'ruta' }, d.ruta)),
    h('div', { class: 'acciones' },
      d.existe ? h('button', { type: 'button', class: 'btn btn-chico', onclick: () => abrir({ destino: i }) }, 'Abrir') : null,
      d.existe ? h('button', { type: 'button', class: 'btn btn-chico', onclick: () => accesoDirecto(i) }, 'Acceso directo') : null,
      i > 0 ? h('button', { type: 'button', class: 'btn btn-chico', disabled: ocupado, onclick: () => cambiarDestinos({ accion: 'subir', indice: i }).catch(avisarError) }, i === 1 ? 'Hacer principal' : 'Subir') : null,
      total > 1 ? h('button', { type: 'button', class: 'btn btn-chico btn-peligro', disabled: ocupado, onclick: () => quitar(d, i) }, 'Quitar') : null),
    !d.disponible && d.motivo ? h('div', { class: 'nota' }, d.motivo) : null,
    d.streaming ? h('div', { class: 'nota' }, 'Google Drive en modo transmisión: para que la copia quede en tu disco y se suba sola, en el Explorador hacé clic derecho en esta carpeta → ', h('strong', null, 'Acceso sin conexión → Disponible sin conexión'), d.existe ? '.' : ' (después de la primera sincronización).') : null);
}

async function quitar(d, i) {
  const si = await confirmar({ titulo: 'Quitar un destino', texto: `¿Quitar ${d.ruta} de la lista? No se borra nada: la carpeta y todo lo que tiene quedan como están, solo deja de actualizarse.`, aceptar: 'Quitar de la lista', peligro: true });
  if (si) cambiarDestinos({ accion: 'quitar', indice: i }).catch(avisarError);
}

async function accesoDirecto(i) {
  try {
    const r = await post('/api/acceso-directo', { destino: i });
    toast(r.yaExistia ? `Ya había un acceso directo con ese nombre: no lo toqué (${r.ruta}).` : `Listo: creé el acceso directo en el Escritorio (${r.ruta}).`, 'ok');
  } catch (e) {
    avisarError(e);
  }
}

const unirRuta = (base, nombre) => `${base.replace(/\\$/, '')}\\${nombre}`;
const rutaPropuesta = (r) => (/(^|\\)Claude-Archivo$/i.test(r) ? r : unirRuta(r, 'Claude-Archivo'));

async function explorador(entrada, ruta = null, capaPrevia = null) {
  try {
    const datos = await api(`/api/carpetas${ruta ? `?ruta=${enc(ruta)}` : ''}`);
    capaPrevia?.cerrar();
    let capa;
    const ir = (destino) => explorador(entrada, destino, capa);
    const boton = (nombre, destino) => h('button', { type: 'button', class: 'carpeta', onclick: () => ir(destino) }, icono('carpeta', 15), nombre);
    const lista = datos.ruta === null
      ? [h('h4', null, 'Lugares'), datos.lugares.map((l) => boton(l.nombre, l.ruta)), h('h4', null, 'Discos'), datos.discos.map((d) => boton(d.nombre, d.ruta))]
      : datos.carpetas.length ? datos.carpetas.map((n) => boton(n, unirRuta(datos.ruta, n))) : h('p', { class: 'tenue' }, 'No hay subcarpetas.');
    capa = abrirModal({
      titulo: 'Elegí dónde guardar la copia',
      ancho: 760,
      contenido: [
        h('div', { class: 'explorador-ruta' },
          h('button', { type: 'button', class: 'btn btn-chico', disabled: datos.ruta === null, onclick: () => ir(datos.padre || null) }, icono('izquierda', 14), 'Subir'),
          h('code', null, datos.ruta ?? 'Este equipo')),
        h('div', { class: 'explorador-lista' }, lista),
      ],
      pie: datos.ruta ? [
        h('p', { class: 'nota' }, 'Se va a guardar en ', h('code', null, rutaPropuesta(datos.ruta))),
        h('button', { type: 'button', class: 'btn btn-primario', onclick: () => { entrada.value = rutaPropuesta(datos.ruta); capa.cerrar(); entrada.focus(); } }, 'Usar esta carpeta'),
      ] : null,
    });
  } catch (e) {
    avisarError(e);
  }
}

function destinos() {
  const e = est.app;
  const ocupado = e.sincronizando;
  const entrada = h('input', { class: 'entrada mono', type: 'text', placeholder: 'G:\\Mi unidad\\Claude-Archivo', 'aria-label': 'Carpeta del nuevo destino' });
  const mensaje = h('p', { class: 'mensaje', role: 'status' });
  const agregar = async () => {
    try {
      await cambiarDestinos({ accion: 'agregar', ruta: entrada.value.trim() });
      toast('Destino agregado. La próxima sincronización copia ahí todo el archivo.', 'ok');
    } catch (err) {
      mensaje.textContent = err.message;
      mensaje.className = 'mensaje error';
    }
  };
  entrada.addEventListener('keydown', (ev) => ev.key === 'Enter' && agregar());
  const sugerencias = h('div', { class: 'sugerencias' });
  api('/api/destinos/sugerencias').then(({ sugerencias: lista, tamanoArchivo }) => {
    sugerencias.replaceChildren(...lista.map((s) => h('button', { type: 'button', class: 'sugerencia', onclick: () => {
      entrada.value = s.ruta;
      mensaje.textContent = s.nota || '';
      mensaje.className = 'mensaje';
      entrada.focus();
    } }, icono(/Drive|OneDrive|Dropbox|iCloud/.test(s.nombre) ? 'nube' : 'carpeta', 18), h('span', null, h('span', { class: 'nombre' }, s.nombre), h('span', { class: 'ruta' }, s.ruta)))));
    if (tamanoArchivo) mensaje.textContent ||= `Al agregar un destino, la próxima sincronización copia ahí todo el archivo (hoy, unos ${tamano(tamanoArchivo)}).`;
  }).catch(() => {});

  return [
    cabecera('Destinos', 'Dónde se guardan las copias. Cada sincronización copia todo a cada destino. Quitar uno no borra nada: la carpeta queda como está.'),
    ocupado ? h('div', { class: 'aviso info' }, icono('info', 18), h('div', { class: 'aviso-texto' }, 'Hay una sincronización en curso: esperá a que termine para cambiar los destinos.')) : null,
    e.destinos.length
      ? h('div', { class: 'lista-ajustes' }, e.destinos.map((d, i) => filaDestino(d, i, e.destinos.length, ocupado)))
      : h('div', { class: 'vacio-tarjeta' }, icono('escudo', 22), h('p', null, 'Todavía no elegiste ningún lugar. Conviene uno en otro disco y otro en la nube.')),
    h('section', { class: 'seccion' },
      h('h2', { style: 'font-size: 15px' }, 'Agregar un destino'),
      h('p', { class: 'sutil' }, 'Encontré estos lugares en tu PC. Lo que se guarda en una carpeta sincronizada se sube solo a la nube.'),
      sugerencias,
      h('div', { class: 'fila-agregar' },
        entrada,
        h('button', { type: 'button', class: 'btn', onclick: () => explorador(entrada) }, icono('carpeta', 15), 'Elegir carpeta…'),
        h('button', { type: 'button', class: 'btn btn-primario', disabled: ocupado, onclick: agregar }, 'Agregar')),
      mensaje),
  ];
}

// ---------- Resúmenes ----------

let datosResumenes = null; // /api/resumenes: se pide al entrar y al terminar un lote, no en cada actualización
const MODELOS = [['haiku', 'Haiku'], ['sonnet', 'Sonnet'], ['opus', 'Opus']];

let cargandoResumenes = false;
async function cargarResumenes() {
  if (cargandoResumenes) return;
  cargandoResumenes = true;
  try {
    datosResumenes = await api('/api/resumenes');
  } catch (e) {
    datosResumenes = { error: e.message };
  } finally {
    cargandoResumenes = false;
  }
  if (seccionActual === 'resumenes') repintar();
}

async function probarClaude(boton, salida) {
  boton.disabled = true;
  boton.classList.add('girando');
  salida.className = 'mensaje';
  salida.textContent = 'Preguntándole a Claude…';
  try {
    const r = await post('/api/resumenes/probar');
    salida.className = r.ok ? 'mensaje ok' : 'mensaje error';
    salida.textContent = r.ok ? 'Funciona: Claude respondió.' : r.error;
  } catch (e) {
    salida.className = 'mensaje error';
    salida.textContent = e.message;
  }
  boton.disabled = false;
  boton.classList.remove('girando');
}

async function lote(cuales) {
  try {
    await post('/api/resumir/todas', { cuales });
    await actualizarEstado();
  } catch (e) {
    avisarError(e);
  }
}

function resumenesSeccion() {
  const d = datosResumenes;
  const t = est.app.resumenes;
  const cab = cabecera('Resúmenes', 'Claude resume cada conversación: qué se buscaba, qué se hizo, qué se decidió y qué quedó pendiente. El resumen aparece arriba de la conversación, se exporta con ella y entra en la búsqueda.');
  if (!d) {
    cargarResumenes();
    return [cab, h('p', { class: 'sutil' }, 'Cargando…')];
  }
  if (d.error) return [cab, h('p', { class: 'mensaje error' }, d.error)];
  const ocupado = Boolean(t?.enCurso);
  const salidaPrueba = h('p', { class: 'mensaje', role: 'status' });
  const modelo = h('div', { class: 'seg', role: 'group', 'aria-label': 'Modelo para los resúmenes' }, MODELOS.map(([id, texto]) => h('button', {
    type: 'button',
    'aria-pressed': String((est.app.modeloResumenes ?? d.modelo) === id),
    onclick: async () => {
      try {
        await post('/api/ajustes', { modeloResumenes: id });
        await actualizarEstado();
        repintar();
      } catch (e) {
        avisarError(e);
      }
    },
  }, texto)));
  const fraccion = t?.total ? t.hechos / t.total : null;
  return [
    cab,
    h('div', { class: 'lista-ajustes' },
      h('div', { class: 'ajuste' },
        h('div', { class: 'ajuste-texto' },
          h('div', { class: 'titulo' }, 'Claude Code'),
          h('div', { class: 'desc' }, d.claude ? `${d.claude.version ?? 'Versión desconocida'} · ${d.claude.ruta}` : 'No lo encontré en esta PC. Instalalo desde claude.com/claude-code y volvé a abrir la app.'),
          salidaPrueba),
        d.claude ? h('div', { class: 'ajuste-control' }, h('button', { type: 'button', class: 'btn', onclick: (e) => probarClaude(e.currentTarget, salidaPrueba) }, icono('sincronizar', 14), 'Probar')) : null),
      ajuste('Modelo', 'Haiku es el más rápido y el que menos uso consume. Sonnet y Opus hacen resúmenes más finos.', modelo),
      h('div', { class: 'ajuste' },
        h('div', { class: 'ajuste-texto' },
          h('div', { class: 'titulo' }, `${numero(d.conResumen)} de ${plural(d.total, 'conversación tiene', 'conversaciones tienen')} resumen`),
          h('div', { class: 'desc' }, d.desactualizados ? `${plural(d.desactualizados, 'tiene', 'tienen')} mensajes nuevos desde que se resumió.` : 'Se resumen de a dos, empezando por las más recientes. Podés cancelar cuando quieras: lo hecho queda guardado.')),
        h('div', { class: 'ajuste-control' },
          d.faltan ? h('button', { type: 'button', class: 'btn btn-primario', disabled: ocupado || !d.claude, onclick: () => lote('faltan') }, `Resumir ${d.faltan === 1 ? 'la que falta' : `las ${numero(d.faltan)} que faltan`}`) : null,
          d.desactualizados ? h('button', { type: 'button', class: 'btn', disabled: ocupado || !d.claude, onclick: () => lote('desactualizados') }, `Actualizar ${d.desactualizados === 1 ? 'la desactualizada' : `las ${numero(d.desactualizados)}`}`) : null))),
    ocupado ? h('div', { class: 'tarjeta progreso-tarjeta', role: 'status' },
      h('div', { class: 'sync-estado' }, h('span', { class: 'estado-punto acento' }), h('span', null, `Resumiendo ${numero(t.hechos)} de ${numero(t.total)}`), h('span', { class: 'tenue' }, `${Math.round((fraccion ?? 0) * 100)} %`)),
      h('div', { class: 'barra' }, h('div', { class: 'barra-relleno', style: `width: ${Math.round((fraccion ?? 0) * 100)}%` })),
      t.actual?.length ? h('div', { class: 'sync-detalle' }, `Ahora: ${t.actual.join(' · ')}`) : null,
      t.errores ? h('div', { class: 'sync-detalle' }, `${plural(t.errores, 'no se pudo', 'no se pudieron')} hacer. Último error: ${t.ultimoError}`) : null,
      h('div', null, h('button', { type: 'button', class: 'btn btn-chico', onclick: () => post('/api/resumir/cancelar').catch(avisarError) }, 'Cancelar'))) : null,
    t && !t.enCurso ? h('div', { class: `aviso ${t.motivo ? 'error' : t.errores || t.cancelado ? 'alerta' : 'info'}`, role: 'status' },
      icono(t.motivo ? 'alerta' : 'info', 18),
      h('div', { class: 'aviso-texto' }, t.motivo
        ? `Se frenó: ${t.motivo}`
        : `${t.cancelado ? 'Cancelado. ' : ''}${plural(t.hechos - t.errores, 'resumen hecho', 'resúmenes hechos')}${t.errores ? `, ${plural(t.errores, 'con error', 'con error')}. Último error: ${t.ultimoError}` : '.'}`)) : null,
    h('p', { class: 'nota-pie' }, 'Cada resumen usa tu cuenta de Claude y cuenta para tus límites de uso, como cualquier conversación: se le manda el texto de la conversación. Nada se resume solo, solo cuando lo pedís. Claude Code corre sin herramientas y sin guardar la sesión, así que no aparece como una conversación nueva.'),
  ];
}

// ---------- Qué se copia ----------

function copia() {
  const e = est.app;
  return [
    cabecera('Qué se copia', 'Las carpetas y archivos que cada sincronización copia a tus destinos. No se copian las credenciales de Claude.'),
    h('div', { class: 'fuentes' }, e.fuentes.map((f) => h('div', { class: 'fuente' },
      h('div', null, f.nombre),
      h('div', null, h('div', { class: 'ruta' }, f.origen), h('div', { class: 'ruta' }, `→ ${f.destino}${/\.[a-z0-9]+$/i.test(f.destino) ? '' : '/'}`))))),
    h('p', { class: 'nota-pie' }, 'Para sumar o sacar fuentes, editá config.json (en Avanzado) y volvé a abrir la app. Por ejemplo, para incluir conversaciones viejas rescatadas de un disco, agregá una fuente con "conversaciones": true y "recuperada": true.'),
  ];
}

// ---------- App ----------

function app() {
  const e = est.app;
  const a = est.actualizacion;
  const estadoVersion = h('div', { class: 'ajuste-texto' });
  const pintarEstadoVersion = () => {
    const x = est.actualizacion;
    let titulo = 'Buscar versiones nuevas';
    let desc = e.buscarActualizaciones ? 'Se consulta al abrir la app.' : 'La búsqueda automática está desactivada.';
    if (x?.error) desc = x.error;
    else if (x?.hayNueva) titulo = `La versión ${x.ultima.version} está disponible`;
    else if (x?.ultima) {
      titulo = 'Tenés la última versión';
      desc = `Consultado ${hace(x.consultado)}.`;
    }
    estadoVersion.replaceChildren(h('div', { class: 'titulo' }, titulo), h('div', { class: 'desc' }, desc));
  };
  pintarEstadoVersion();
  const buscarAhora = h('button', { type: 'button', class: 'btn', onclick: async (ev) => {
    const b = ev.currentTarget;
    b.disabled = true;
    b.classList.add('girando');
    await comprobarActualizacion({ forzar: true });
    b.disabled = false;
    b.classList.remove('girando');
    repintar();
  } }, icono('sincronizar', 14), 'Buscar ahora');

  const automatico = h('label', { class: 'interruptor' },
    h('input', { type: 'checkbox', checked: e.buscarActualizaciones, 'aria-label': 'Buscar versiones nuevas al abrir', onchange: async (ev) => {
      try {
        await post('/api/ajustes', { buscarActualizaciones: ev.target.checked });
        await actualizarEstado();
        repintar();
      } catch (err) {
        avisarError(err);
      }
    } }),
    h('span'));

  const historial = h('div', { class: 'lista-ajustes' }, h('div', { class: 'historial-version tenue' }, 'Cargando…'));
  api('/api/novedades').then(({ versiones }) => {
    historial.replaceChildren(...(versiones.length ? versiones.map((v) => h('div', { class: 'historial-version' },
      h('div', { class: 'cab' }, h('strong', null, `Versión ${v.version}`), v.version === e.version ? h('span', { class: 'etq etq-acento' }, 'La que tenés') : null, v.fecha ? h('span', { class: 'tenue', style: 'font-size: 12.5px' }, fechaDia(v.fecha)) : null),
      nodoNotas(v.secciones))) : [h('div', { class: 'historial-version tenue' }, 'No hay historial de versiones.')]));
  }).catch(() => {});

  return [
    cabecera('App', 'Versión, actualizaciones y novedades.'),
    h('div', { class: 'lista-ajustes' },
      ajuste('Versión instalada', e.instalada ? 'Instalada con el instalador.' : 'Abierta desde el código: se actualiza con git pull.', h('span', { class: 'version-chip' }, e.version)),
      h('div', { class: 'ajuste' }, estadoVersion, h('div', { class: 'ajuste-control' },
        a?.hayNueva ? h('button', { type: 'button', class: 'btn btn-primario', onclick: abrirModalVersion }, icono('actualizar', 15), 'Ver novedades y actualizar') : null,
        buscarAhora)),
      ajuste('Buscar versiones nuevas al abrir', 'Es lo único que la app consulta por su cuenta en internet: la lista de versiones en GitHub. Los resúmenes que pidas los manda tu Claude Code.', automatico)),
    h('section', { class: 'seccion' },
      h('div', { class: 'seccion-cab' }, h('h2', { class: 'seccion-titulo' }, 'Historial de versiones'), h('a', { href: e.releases, target: '_blank', rel: 'noopener noreferrer' }, 'Ver en GitHub')),
      historial),
  ];
}

// ---------- Avanzado ----------

function avanzado() {
  const e = est.app;
  const limpieza = e.limpieza;
  return [
    cabecera('Avanzado'),
    h('div', { class: 'lista-ajustes' },
      ajuste('Configuración', e.configuracion, h('button', { type: 'button', class: 'btn', onclick: () => abrir({ que: 'configuracion' }) }, 'Mostrar')),
      ajuste('Registro de la app', e.log, h('button', { type: 'button', class: 'btn', onclick: () => abrir({ que: 'log' }) }, 'Mostrar')),
      ajuste('Carpeta de datos de la app', `${e.carpetaDatos}. Guarda la configuración, el registro y una copia de cada configuración anterior.`, h('button', { type: 'button', class: 'btn', onclick: () => abrir({ que: 'datos' }) }, 'Abrir')),
      ajuste('Borrado automático de Claude Code', `Claude Code borra las sesiones que pasan ${limpieza.dias} días sin cambios (cleanupPeriodDays${limpieza.configurado ? ', configurado en tu settings.json' : ', el valor por defecto'}). Lo que ya está en tus copias no se pierde, y el inicio te avisa si alguna conversación sin respaldar está por borrarse.`)),
  ];
}

const SECCIONES = { general, destinos, comprobar: comprobacion, resumenes: resumenesSeccion, copia, app, avanzado };

function repintar() {
  if (!contenedor || !document.contains(contenedor) || !est.app) return;
  contenedor.replaceChildren(...SECCIONES[seccionActual]().filter(Boolean));
}

export function pintarAjustes(vista, seccion) {
  seccionActual = SECCIONES_AJUSTES.some((x) => x.id === seccion) ? seccion : 'general';
  if (seccionActual === 'resumenes') datosResumenes = null; // al entrar se vuelven a contar
  contenedor = h('div', { class: 'contenido angosto' });
  vista.replaceChildren(h('div', { class: 'pagina', style: 'padding-top: 40px' }, contenedor));
  if (!est.app) {
    contenedor.dataset.cargando = '1';
    contenedor.append(h('p', { class: 'sutil' }, 'Cargando…'));
    return;
  }
  repintar();
}

// Si la página se abrió antes de tener el estado, se pinta cuando llega. Comprobar copias muestra el progreso.
let comprobandoAntes = false;
let resumiendoAntes = false;
export function alLlegarEstado() {
  const resumiendo = Boolean(est.app?.resumenes?.enCurso);
  if (contenedor?.dataset.cargando && est.app) {
    delete contenedor.dataset.cargando;
    repintar();
  } else if (seccionActual === 'comprobar' && (est.app?.comprobando || comprobandoAntes)) {
    repintar();
  } else if (seccionActual === 'resumenes' && (resumiendo || resumiendoAntes)) {
    if (resumiendoAntes && !resumiendo) cargarResumenes(); // terminó: se actualizan las cuentas
    else repintar();
  }
  comprobandoAntes = Boolean(est.app?.comprobando);
  resumiendoAntes = resumiendo;
}

export const repintarAjustes = repintar;
export const seccionDeAjustes = () => seccionActual;
