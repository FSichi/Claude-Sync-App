// Inicio: búsqueda, avisos, números, actividad, conversaciones recientes, proyectos y destinos.
import { h, numero, tamano, hace, fechaCorta, nombreCarpeta, rutaConversacion, navegar, plural } from './util.js';
import { icono } from './iconos.js';
import { est, sincronizarAhora, ultimaSincronizacion } from './estado.js';
import { abrirModalVersion } from './actualizacion.js';
import { abrirModal } from './capas.js';
import { setFiltros, filtros } from './filtros.js';
import { barras, eje, filasConBarra } from './graficos.js';

const DIA = 86400000;
const DIAS_ACTIVIDAD = 30;

export const iconoDestino = (d) => (d.etiqueta === 'Red' ? 'red' : /^Disco/.test(d.etiqueta) ? 'disco' : 'nube');

export function estadoDestino(d) {
  if (!d.disponible) return { clase: 'peligro', texto: 'No disponible' };
  if (!d.ultimaSync) return { clase: 'alerta', texto: 'Sin copia aún' };
  return { clase: 'ok', texto: `Al día · ${hace(d.ultimaSync)}` };
}

// Días que faltan para que Claude Code pueda borrar una conversación con cambios sin respaldar.
export const diasParaBorrarse = (c) => (c.pendiente && c.vence ? Math.ceil((new Date(c.vence) - Date.now()) / DIA) : null);

export function etiquetasConversacion(c, { completas = false } = {}) {
  const lista = [];
  const dias = diasParaBorrarse(c);
  if (dias != null && dias <= 7) lista.push(h('span', { class: 'etq etq-peligro', title: 'Tiene cambios sin respaldar y Claude Code borra las sesiones que pasan un tiempo sin cambios' }, dias <= 0 ? 'Se puede borrar hoy' : `Se borra en ${plural(dias, 'día', 'días')}`));
  if (c.eliminadaEnOrigen && !c.recuperada) lista.push(h('span', { class: 'etq etq-peligro', title: 'Ya no está en Claude: esta copia es la única' }, 'Borrada en Claude'));
  if (c.recuperada) lista.push(h('span', { class: 'etq etq-alerta' }, 'Recuperada'));
  if (c.pendiente) lista.push(h('span', { class: 'etq etq-acento' }, c.soloEnClaude ? 'Sin respaldar' : 'Cambios nuevos'));
  if (completas && c.archivadaEnApp) lista.push(h('span', { class: 'etq' }, 'Archivada en la app'));
  if (completas && c.subagentes) lista.push(h('span', { class: 'etq' }, plural(c.subagentes, 'subagente', 'subagentes')));
  return lista;
}

function verErrores(e) {
  const filas = e.ultimo.destinos.flatMap((d) => d.errores.map((x) => `${d.destino}\n  ${x.ruta}\n  ${x.error}`));
  abrirModal({ titulo: 'Archivos que no se pudieron copiar', contenido: h('pre', { class: 'crudo' }, filas.join('\n\n')) });
}

function avisos(e) {
  const lista = [];
  const aviso = (tipo, nombreIcono, texto, accion) => lista.push(h('div', { class: `aviso ${tipo}`, role: tipo === 'error' ? 'alert' : null }, icono(nombreIcono, 18), h('div', { class: 'aviso-texto' }, texto), accion));
  const boton = (texto, alClic, primario = false) => h('button', { type: 'button', class: `btn btn-chico${primario ? ' btn-primario' : ''}`, onclick: alClic }, texto);
  const ultima = ultimaSincronizacion(e);
  const errores = e.ultimo?.destinos.reduce((s, d) => s + d.errores.length, 0) ?? 0;
  const faltantes = e.destinos.filter((d) => !d.disponible);
  const sinCopia = e.destinos.filter((d) => d.disponible && !d.ultimaSync);
  const pend = e.pendientes?.conversaciones ?? 0;
  const diasSin = ultima ? Math.floor((Date.now() - new Date(ultima)) / DIA) : 0;
  const conProblemas = e.destinos.filter((d) => d.comprobacion?.problemas);

  if (est.conexionPerdida) aviso('error', 'alerta', 'Se perdió la conexión con la app. Cerrá esta ventana y volvé a abrir Claude Archivo.');
  if (e.error) aviso('error', 'alerta', `La última sincronización falló: ${e.error}`, boton('Reintentar', sincronizarAhora));
  else if (errores) aviso('error', 'alerta', `La última sincronización terminó con ${plural(errores, 'archivo', 'archivos')} sin copiar.`, boton('Ver detalle', () => verErrores(e)));
  if (e.riesgo?.pronto) {
    aviso('error', 'alerta', h('span', null, h('strong', null, plural(e.riesgo.pronto, 'conversación sin respaldar', 'conversaciones sin respaldar')), ` se ${e.riesgo.pronto === 1 ? 'puede' : 'pueden'} borrar de Claude Code en menos de 7 días.`), boton('Sincronizar ahora', sincronizarAhora, true));
  }
  if (faltantes.length) aviso('alerta', 'alerta', h('span', null, h('strong', null, faltantes.map((d) => d.etiqueta).join(' y ')), ` no está disponible (${faltantes[0].motivo || faltantes[0].ruta}). Esa copia no se va a actualizar.`));
  if (conProblemas.length) {
    const n = conProblemas.reduce((s, d) => s + d.comprobacion.problemas, 0);
    aviso('alerta', 'escudo', h('span', null, 'La última comprobación encontró ', h('strong', null, plural(n, 'archivo con problemas', 'archivos con problemas')), ` en ${conProblemas.map((d) => d.etiqueta).join(' y ')}.`), boton('Ver y reparar', () => navegar('#/ajustes/comprobar')));
  }
  if (!e.destinos.length) aviso('info', 'info', 'Para empezar, elegí dónde guardar las copias: otro disco, Google Drive, OneDrive o un NAS.', boton('Elegir dónde guardar', () => navegar('#/ajustes/destinos'), true));
  else if (e.sincronizando || e.comprobando) {
    // Mientras copia o comprueba, el progreso está abajo a la izquierda: no se ofrece sincronizar.
  } else if (!ultima) aviso('info', 'info', `Todavía no hay ninguna copia.${e.pendientes ? ` La primera copia son ${tamano(e.pendientes.bytes)} por destino y puede tardar varios minutos.` : ''}`, boton('Hacer la primera copia', sincronizarAhora, true));
  else if (sinCopia.length) aviso('info', 'info', h('span', null, 'Todavía no hay copia en ', h('strong', null, sinCopia.map((d) => d.etiqueta).join(' y ')), '. Se hace en la próxima sincronización.'), boton('Sincronizar', sincronizarAhora));
  else if (pend && e.recordatorioDias && diasSin >= e.recordatorioDias && !e.riesgo?.pronto) {
    aviso('alerta', 'reloj', h('span', null, h('strong', null, `Hace ${plural(diasSin, 'día', 'días')} que no sincronizás`), ` y ${plural(pend, 'conversación tiene', 'conversaciones tienen')} cambios sin respaldar.`), boton('Sincronizar', sincronizarAhora, true));
  } else if (pend && !e.riesgo?.pronto) aviso('info', 'info', `${plural(pend, 'conversación tiene', 'conversaciones tienen')} cambios sin respaldar.`, boton('Sincronizar', sincronizarAhora));
  return lista.length ? h('div', { class: 'avisos' }, lista) : null;
}

function irConFiltro(cambios) {
  setFiltros({ ...filtros, estados: [], fecha: 'cualquiera', carpetas: [], ...cambios });
  navegar('#/conversaciones');
}

// ---------- Actividad de los últimos 30 días ----------

const claveDia = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function diasRecientes() {
  const hoy = new Date();
  hoy.setHours(12, 0, 0, 0);
  return Array.from({ length: DIAS_ACTIVIDAD }, (_, i) => new Date(hoy.getTime() - (DIAS_ACTIVIDAD - 1 - i) * DIA));
}

// Respuestas de Claude por día. Con un índice viejo (sin "actividad") se cuenta la conversación en su último día.
function actividad(conversaciones) {
  const dias = diasRecientes();
  const desde = claveDia(dias[0]);
  const porDia = new Map(dias.map((d) => [claveDia(d), { respuestas: 0, conversaciones: new Set() }]));
  const porCarpeta = new Map();
  let exacta = false;
  for (const c of conversaciones) {
    const sumar = (dia, n) => {
      const x = porDia.get(dia);
      if (!x) return;
      x.respuestas += n;
      x.conversaciones.add(c.clave);
      const carpeta = nombreCarpeta(c);
      const p = porCarpeta.get(carpeta) ?? { carpeta, respuestas: 0, conversaciones: new Set() };
      p.respuestas += n;
      p.conversaciones.add(c.clave);
      porCarpeta.set(carpeta, p);
    };
    if (c.actividad) {
      exacta = true;
      for (const [dia, n] of Object.entries(c.actividad)) if (dia >= desde) sumar(dia, n);
    } else if (c.hasta) {
      sumar(claveDia(new Date(c.hasta)), c.respuestas ?? 0);
    }
  }
  const serie = dias.map((d) => ({ fecha: d, ...porDia.get(claveDia(d)) }));
  // Sin respuestas contadas (conversaciones sin respaldar todavía), se ordena por cantidad de conversaciones.
  const medida = (p) => p.respuestas || p.conversaciones.size / 1000;
  const proyectos = [...porCarpeta.values()].sort((a, b) => medida(b) - medida(a)).slice(0, 6);
  return { serie, proyectos, exacta };
}

function graficoActividad(serie) {
  const total = serie.reduce((s, d) => s + d.respuestas, 0);
  const activos = serie.filter((d) => d.respuestas).length;
  const conversaciones = new Set(serie.flatMap((d) => [...d.conversaciones])).size;
  const corta = (d) => d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
  const puntos = serie.map((d) => ({
    valor: d.respuestas,
    titulo: d.fecha.toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' }),
    lineas: [`${plural(d.respuestas, 'respuesta', 'respuestas')} de Claude`, plural(d.conversaciones.size, 'conversación', 'conversaciones')],
  }));
  return h('div', { class: 'tarjeta actividad' },
    h('div', { class: 'actividad-cifras' },
      h('div', null, h('div', { class: 'stat-num' }, numero(total)), h('div', { class: 'stat-etq' }, 'respuestas de Claude')),
      h('div', null, h('div', { class: 'stat-num' }, numero(activos)), h('div', { class: 'stat-etq' }, 'días con actividad')),
      h('div', null, h('div', { class: 'stat-num' }, numero(conversaciones)), h('div', { class: 'stat-etq' }, 'conversaciones'))),
    barras(puntos, { descripcion: `Respuestas de Claude por día en los últimos ${DIAS_ACTIVIDAD} días` }),
    eje(corta(serie[0].fecha), corta(serie[Math.floor(serie.length / 2)].fecha), 'hoy'),
    h('a', { class: 'ver-mas', href: '#/estadisticas' }, 'Ver estadísticas completas'));
}

function proyectosActivos(proyectos) {
  if (!proyectos.length) return h('p', { class: 'tenue' }, `Sin actividad en los últimos ${DIAS_ACTIVIDAD} días.`);
  const porRespuestas = proyectos.some((p) => p.respuestas);
  return filasConBarra(proyectos.map((p) => ({
    nombre: p.carpeta,
    valor: porRespuestas ? p.respuestas : p.conversaciones.size,
    derecha: porRespuestas ? plural(p.conversaciones.size, 'conversación', 'conversaciones') : null,
    abajo: porRespuestas ? plural(p.respuestas, 'respuesta de Claude', 'respuestas de Claude') : plural(p.conversaciones.size, 'conversación', 'conversaciones'),
    href: '#/conversaciones',
    alClic: () => irConFiltro({ carpetas: [p.carpeta], fecha: '30' }),
  })));
}

export function pintarInicio(vista) {
  const e = est.app;
  if (!e) {
    vista.replaceChildren(h('div', { class: 'pagina' }, h('p', { class: 'sutil' }, 'Cargando…')));
    return;
  }
  const visibles = est.conversaciones.filter((c) => !c.vacia);
  const borradas = visibles.filter((c) => c.eliminadaEnOrigen && !c.recuperada).length;
  const recuperadas = visibles.filter((c) => c.recuperada).length;
  const recientes30 = visibles.filter((c) => c.hasta && Date.now() - new Date(c.hasta) < DIAS_ACTIVIDAD * DIA).length;
  const ultima = ultimaSincronizacion(e);
  const a = est.actualizacion;

  const buscador = h('input', {
    type: 'search',
    id: 'buscar-inicio',
    placeholder: 'Buscar en todas las conversaciones',
    'aria-label': 'Buscar en todas las conversaciones',
    autocomplete: 'off',
    onkeydown: (ev) => {
      if (ev.key === 'Enter' && ev.target.value.trim()) {
        est.busquedaPendiente = ev.target.value.trim();
        navegar('#/conversaciones');
      }
    },
  });

  let titulo = 'Tus conversaciones, a salvo';
  let subtitulo = ultima ? `La última copia terminó ${hace(ultima)}.` : '';
  if (!e.destinos.length) {
    titulo = 'Te damos la bienvenida a Claude Archivo';
    subtitulo = 'Copia tus conversaciones de Claude a los lugares que elijas, para que nunca se pierdan.';
  } else if (!ultima) {
    titulo = 'Todo listo para la primera copia';
    subtitulo = e.pendientes ? `Hay ${plural(e.pendientes.conversaciones, 'conversación', 'conversaciones')} y ${tamano(e.pendientes.bytes)} para respaldar.` : '';
  } else if (e.pendientes?.conversaciones) {
    subtitulo += ` ${plural(e.pendientes.conversaciones, 'conversación tiene', 'conversaciones tienen')} cambios nuevos.`;
  }

  const stat = (n, texto, alClic, peligro = false) =>
    h('a', { href: '#/conversaciones', class: 'stat', onclick: (ev) => { ev.preventDefault(); alClic(); } },
      h('div', { class: `stat-num${peligro && n ? ' peligro' : ''}` }, n == null ? '—' : numero(n)),
      h('div', { class: 'stat-etq' }, texto));

  const recientes = [...visibles].sort((x, y) => (y.hasta || '').localeCompare(x.hasta || '')).slice(0, 8);
  const act = visibles.length ? actividad(visibles) : null;

  const destinos = h('section', { class: 'seccion' },
    h('div', { class: 'seccion-cab' }, h('h2', { class: 'seccion-titulo' }, 'Destinos'), h('a', { href: '#/ajustes/destinos' }, e.destinos.length ? 'Administrar' : 'Elegir')),
    e.destinos.length
      ? h('div', { class: 'pila' }, e.destinos.map((d) => {
          const s = estadoDestino(d);
          const c = d.comprobacion;
          return h('div', { class: 'tarjeta tarjeta-destino' },
            icono(iconoDestino(d), 20),
            h('div', null,
              h('div', { class: 'nombre' }, d.etiqueta),
              h('div', { class: 'ruta', title: d.ruta }, d.ruta),
              c ? h('a', { class: `comprobada${c.problemas ? ' peligro' : ''}`, href: '#/ajustes/comprobar' }, c.problemas ? plural(c.problemas, 'archivo con problemas', 'archivos con problemas') : `Comprobada ${hace(c.reparado ?? c.fecha)}`) : null),
            h('span', { class: `estado-texto ${s.clase}` }, s.texto));
        }))
      : h('div', { class: 'vacio-tarjeta' },
          icono('escudo', 22),
          h('p', null, 'Conviene un lugar en otro disco y otro en la nube (Google Drive, OneDrive): así no dependés de una sola copia.'),
          h('a', { class: 'btn btn-primario', href: '#/ajustes/destinos' }, 'Elegir dónde guardar')));

  vista.replaceChildren(h('div', { class: 'pagina' },
    h('div', { class: 'barra-superior' },
      h('label', { class: 'campo' }, icono('buscar', 16), buscador, h('kbd', { class: 'kbd' }, 'Ctrl K')),
      a?.hayNueva ? h('button', { type: 'button', class: 'pastilla-version', onclick: abrirModalVersion }, icono('actualizar', 15), `Versión ${a.ultima.version} disponible`) : null),
    h('div', { class: 'contenido ancho' },
      h('header', { class: 'encabezado' }, h('h1', null, titulo), subtitulo ? h('p', null, subtitulo) : null),
      avisos(e),
      visibles.length ? h('section', { class: 'stats stats-6', 'aria-label': 'Resumen' },
        stat(visibles.length, 'archivadas', () => irConFiltro({})),
        stat(visibles.length - borradas - recuperadas, 'siguen en Claude', () => irConFiltro({ estados: ['claude'] })),
        stat(borradas, 'rescatadas tras borrarse', () => irConFiltro({ estados: ['borrada'] }), true),
        stat(recuperadas, 'recuperadas', () => irConFiltro({ estados: ['recuperada'] })),
        stat(recientes30, `activas en ${DIAS_ACTIVIDAD} días`, () => irConFiltro({ fecha: '30' })),
        stat(est.archivosCambiados, 'archivos que cambió Claude', () => navegar('#/archivos'))) : null,
      h('div', { class: 'inicio-grid' },
        h('div', { class: 'inicio-principal' },
          act ? h('section', { class: 'seccion' },
            h('div', { class: 'seccion-cab' }, h('h2', { class: 'seccion-titulo' }, `Actividad · últimos ${DIAS_ACTIVIDAD} días`), act.exacta ? null : h('span', { class: 'tenue', style: 'font-size: 12.5px' }, 'Aproximada hasta la próxima sincronización')),
            graficoActividad(act.serie)) : null,
          recientes.length ? h('section', { class: 'seccion' },
            h('div', { class: 'seccion-cab' }, h('h2', { class: 'seccion-titulo' }, 'Recientes'), h('a', { href: '#/conversaciones' }, 'Ver todas')),
            h('div', { class: 'filas' }, recientes.map((c) =>
              h('a', { class: 'fila', href: rutaConversacion(c.clave) },
                h('span', { class: 'fila-titulo' }, c.titulo),
                etiquetasConversacion(c),
                h('span', { class: 'fila-meta ancha', title: c.cwd || '' }, nombreCarpeta(c)),
                h('span', { class: 'fila-meta fecha' }, fechaCorta(c.hasta)))))) : null),
        h('aside', { class: 'inicio-lateral' },
          destinos,
          act ? h('section', { class: 'seccion' },
            h('div', { class: 'seccion-cab' }, h('h2', { class: 'seccion-titulo' }, 'Proyectos más activos')),
            proyectosActivos(act.proyectos)) : null)),
      h('p', { class: 'nota-pie' }, 'Solo copia: nunca borra nada de tus destinos. Si borrás un chat en Claude, acá queda marcado como "Borrada en Claude"; lo que se borre antes de sincronizar no se puede rescatar.'))));
}
