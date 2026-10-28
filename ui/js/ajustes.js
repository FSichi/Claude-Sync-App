// Ajustes: General, Destinos, Qué se copia, App y Avanzado.
import { h, api, post, avisarError, toast, hace, tamano, fechaDia, aplicarTema, leerPref, plural, enc } from './util.js';
import { icono } from './iconos.js';
import { est, actualizarEstado } from './estado.js';
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
  return [
    cabecera('General'),
    h('div', { class: 'lista-ajustes' },
      ajuste('Tu nombre', 'Cómo aparecen tus mensajes en las conversaciones y en los textos exportados.', nombre, h('button', { type: 'button', class: 'btn', onclick: guardar }, 'Guardar')),
      ajuste('Tema', 'Sistema usa el mismo que Windows.', seg)),
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
      ajuste('Buscar versiones nuevas al abrir', 'Es lo único que la app consulta en internet: la lista de versiones en GitHub.', automatico)),
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
      ajuste('Borrado automático de Claude Code', limpieza.configurado
        ? `Claude Code está configurado para borrar las sesiones de terminal con más de ${limpieza.dias} días (cleanupPeriodDays).`
        : 'Claude Code borra las sesiones de terminal con más de 30 días sin uso (cleanupPeriodDays). Las de la app de escritorio no tienen ese límite. Las copias de esta app no se ven afectadas.')),
  ];
}

const SECCIONES = { general, destinos, copia, app, avanzado };

function repintar() {
  if (!contenedor || !document.contains(contenedor) || !est.app) return;
  contenedor.replaceChildren(...SECCIONES[seccionActual]().filter(Boolean));
}

export function pintarAjustes(vista, seccion) {
  seccionActual = SECCIONES_AJUSTES.some((x) => x.id === seccion) ? seccion : 'general';
  contenedor = h('div', { class: 'contenido angosto' });
  vista.replaceChildren(h('div', { class: 'pagina', style: 'padding-top: 40px' }, contenedor));
  if (!est.app) {
    contenedor.dataset.cargando = '1';
    contenedor.append(h('p', { class: 'sutil' }, 'Cargando…'));
    return;
  }
  repintar();
}

// Si la página se abrió antes de tener el estado, se pinta cuando llega.
export function alLlegarEstado() {
  if (contenedor?.dataset.cargando && est.app) {
    delete contenedor.dataset.cargando;
    repintar();
  }
}

export const repintarAjustes = repintar;
export const seccionDeAjustes = () => seccionActual;
