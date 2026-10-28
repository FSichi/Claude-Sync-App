// Inicio: búsqueda, avisos, resumen, conversaciones recientes y destinos.
import { h, numero, tamano, hace, fechaCorta, nombreCarpeta, rutaConversacion, navegar, plural } from './util.js';
import { icono } from './iconos.js';
import { est, sincronizarAhora, ultimaSincronizacion } from './estado.js';
import { abrirModalVersion } from './actualizacion.js';
import { abrirModal } from './capas.js';
import { setFiltros, filtros } from './filtros.js';

export const iconoDestino = (d) => (d.etiqueta === 'Red' ? 'red' : /^Disco/.test(d.etiqueta) ? 'disco' : 'nube');

export function estadoDestino(d) {
  if (!d.disponible) return { clase: 'peligro', texto: 'No disponible' };
  if (!d.ultimaSync) return { clase: 'alerta', texto: 'Sin copia aún' };
  return { clase: 'ok', texto: `Al día · ${hace(d.ultimaSync)}` };
}

export function etiquetasConversacion(c, { completas = false } = {}) {
  const lista = [];
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

  if (est.conexionPerdida) aviso('error', 'alerta', 'Se perdió la conexión con la app. Cerrá esta ventana y volvé a abrir Claude Archivo.');
  if (e.error) aviso('error', 'alerta', `La última sincronización falló: ${e.error}`, boton('Reintentar', sincronizarAhora));
  else if (errores) aviso('error', 'alerta', `La última sincronización terminó con ${plural(errores, 'archivo', 'archivos')} sin copiar.`, boton('Ver detalle', () => verErrores(e)));
  if (faltantes.length) aviso('alerta', 'alerta', h('span', null, h('strong', null, faltantes.map((d) => d.etiqueta).join(' y ')), ` no está disponible (${faltantes[0].motivo || faltantes[0].ruta}). Esa copia no se va a actualizar.`));
  if (!e.destinos.length) aviso('info', 'info', 'Para empezar, elegí dónde guardar las copias: otro disco, Google Drive, OneDrive o un NAS.', boton('Elegir dónde guardar', () => navegar('#/ajustes/destinos'), true));
  else if (!ultima) aviso('info', 'info', `Todavía no hay ninguna copia.${e.pendientes ? ` La primera copia son ${tamano(e.pendientes.bytes)} por destino y puede tardar varios minutos.` : ''}`, boton('Hacer la primera copia', sincronizarAhora, true));
  else if (sinCopia.length) aviso('info', 'info', h('span', null, 'Todavía no hay copia en ', h('strong', null, sinCopia.map((d) => d.etiqueta).join(' y ')), '. Se hace en la próxima sincronización.'), boton('Sincronizar', sincronizarAhora));
  else if (e.pendientes?.conversaciones) aviso('info', 'info', `${plural(e.pendientes.conversaciones, 'conversación tiene', 'conversaciones tienen')} cambios sin respaldar.`, boton('Sincronizar', sincronizarAhora));
  return lista.length ? h('div', { class: 'avisos' }, lista) : null;
}

function irConFiltro(estados) {
  setFiltros({ ...filtros, estados });
  navegar('#/conversaciones');
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

  const stat = (n, texto, estados, peligro = false) =>
    h('a', { href: '#/conversaciones', class: 'stat', onclick: (ev) => { ev.preventDefault(); irConFiltro(estados); } },
      h('div', { class: `stat-num${peligro && n ? ' peligro' : ''}` }, numero(n)),
      h('div', { class: 'stat-etq' }, texto));

  const recientes = [...visibles].sort((x, y) => (y.hasta || '').localeCompare(x.hasta || '')).slice(0, 6);

  vista.replaceChildren(h('div', { class: 'pagina' },
    h('div', { class: 'barra-superior' },
      h('label', { class: 'campo' }, icono('buscar', 16), buscador, h('kbd', { class: 'kbd' }, 'Ctrl K')),
      a?.hayNueva ? h('button', { type: 'button', class: 'pastilla-version', onclick: abrirModalVersion }, icono('actualizar', 15), `Versión ${a.ultima.version} disponible`) : null),
    h('div', { class: 'contenido' },
      h('header', { class: 'encabezado' }, h('h1', null, titulo), subtitulo ? h('p', null, subtitulo) : null),
      avisos(e),
      visibles.length ? h('section', { class: 'stats', 'aria-label': 'Resumen' },
        stat(visibles.length, 'archivadas', []),
        stat(visibles.length - borradas - recuperadas, 'siguen en Claude', ['claude']),
        stat(borradas, 'rescatadas tras borrarse', ['borrada'], true),
        stat(recuperadas, 'recuperadas', ['recuperada'])) : null,
      recientes.length ? h('section', { class: 'seccion' },
        h('div', { class: 'seccion-cab' }, h('h2', { class: 'seccion-titulo' }, 'Recientes'), h('a', { href: '#/conversaciones' }, 'Ver todas')),
        h('div', { class: 'filas' }, recientes.map((c) =>
          h('a', { class: 'fila', href: rutaConversacion(c.clave) },
            h('span', { class: 'fila-titulo' }, c.titulo),
            etiquetasConversacion(c),
            h('span', { class: 'fila-meta ancha', title: c.cwd || '' }, nombreCarpeta(c)),
            h('span', { class: 'fila-meta fecha' }, fechaCorta(c.hasta)))))) : null,
      h('section', { class: 'seccion' },
        h('div', { class: 'seccion-cab' }, h('h2', { class: 'seccion-titulo' }, 'Destinos'), h('a', { href: '#/ajustes/destinos' }, e.destinos.length ? 'Administrar' : 'Elegir')),
        e.destinos.length
          ? h('div', { class: 'grid-2' }, e.destinos.map((d) => {
              const s = estadoDestino(d);
              return h('div', { class: 'tarjeta tarjeta-destino' },
                icono(iconoDestino(d), 20),
                h('div', null, h('div', { class: 'nombre' }, d.etiqueta), h('div', { class: 'ruta', title: d.ruta }, d.ruta)),
                h('span', { class: `estado-texto ${s.clase}` }, s.texto));
            }))
          : h('div', { class: 'vacio-tarjeta' },
              icono('escudo', 22),
              h('p', null, 'Conviene un lugar en otro disco y otro en la nube (Google Drive, OneDrive): así no dependés de una sola copia.'),
              h('a', { class: 'btn btn-primario', href: '#/ajustes/destinos' }, 'Elegir dónde guardar'))),
      h('p', { class: 'nota-pie' }, 'Solo copia: nunca borra nada de tus destinos. Si borrás un chat en Claude, acá queda marcado como "Borrada en Claude"; lo que se borre antes de sincronizar no se puede rescatar.'))));
}
