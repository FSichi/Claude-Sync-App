// Filtros de la lista de conversaciones: estado, fecha, origen, carpeta, contenido y orden.
import { h, leerPref, guardarPref, nombreCarpeta, normalizar, numero, plural, fechaDia } from './util.js';
import { icono } from './iconos.js';
import { abrirCajon } from './capas.js';

export const ESTADOS = [
  { id: 'claude', texto: 'En Claude', prueba: (c) => !c.recuperada && !c.eliminadaEnOrigen },
  { id: 'borrada', texto: 'Borradas en Claude', prueba: (c) => !c.recuperada && Boolean(c.eliminadaEnOrigen) },
  { id: 'recuperada', texto: 'Recuperadas', prueba: (c) => Boolean(c.recuperada) },
  { id: 'pendiente', texto: 'Con cambios sin respaldar', prueba: (c) => Boolean(c.pendiente) },
  { id: 'riesgo', texto: 'En riesgo: Claude Code puede borrarlas en 7 días', prueba: (c) => Boolean(c.pendiente && c.vence && new Date(c.vence) - Date.now() < 7 * 86400000) },
  { id: 'archivada', texto: 'Archivadas en la app de escritorio', prueba: (c) => Boolean(c.archivadaEnApp) },
];
export const ORIGENES = {
  escritorio: 'App de escritorio',
  terminal: 'Terminal',
  cowork: 'Cowork',
  ide: 'Editor (VS Code, JetBrains)',
  sdk: 'Automatizaciones (SDK)',
  otro: 'Sin dato',
};
export const FECHAS = [
  { id: 'cualquiera', texto: 'Cualquier fecha' },
  { id: 'hoy', texto: 'Hoy' },
  { id: '7', texto: 'Últimos 7 días' },
  { id: '30', texto: 'Últimos 30 días' },
  { id: 'anio', texto: 'Este año' },
  { id: 'rango', texto: 'Entre dos fechas' },
];
export const ORDENES = [
  { id: 'recientes', texto: 'Más recientes primero' },
  { id: 'antiguas', texto: 'Más antiguas primero' },
  { id: 'mensajes', texto: 'Más mensajes tuyos' },
  { id: 'tamano', texto: 'Más pesadas' },
  { id: 'titulo', texto: 'Título (A–Z)' },
];

const BASE = { estados: [], fecha: 'cualquiera', desde: '', hasta: '', campoFecha: 'hasta', origenes: [], carpetas: [], subagentes: false, imagenes: false, vacias: false, orden: 'recientes' };
export let filtros = { ...BASE, ...leerPref('filtros', {}) };
export function setFiltros(nuevos) {
  filtros = { ...BASE, ...nuevos };
  guardarPref('filtros', filtros);
}
export const limpiarFiltros = () => setFiltros({ orden: filtros.orden });

export function origenDe(c) {
  if (/local-agent-mode-sessions/i.test(c.cwd || '')) return 'cowork';
  const e = c.entrada || '';
  if (e === 'claude-desktop') return 'escritorio';
  if (e === 'cli') return 'terminal';
  if (/vscode|jetbrains|ide/i.test(e)) return 'ide';
  if (/^sdk/i.test(e)) return 'sdk';
  return 'otro';
}

function rangoFecha(f) {
  const ahora = new Date();
  const hoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
  const dias = (n) => new Date(hoy.getTime() - (n - 1) * 86400000);
  switch (f.fecha) {
    case 'hoy': return [hoy, null];
    case '7': return [dias(7), null];
    case '30': return [dias(30), null];
    case 'anio': return [new Date(ahora.getFullYear(), 0, 1), null];
    case 'rango': {
      const desde = f.desde ? new Date(`${f.desde}T00:00:00`) : null;
      const hasta = f.hasta ? new Date(`${f.hasta}T23:59:59.999`) : null;
      return desde || hasta ? [desde, hasta] : null;
    }
    default: return null;
  }
}

const COMPARAR = {
  recientes: (a, b) => (b.hasta || '').localeCompare(a.hasta || ''),
  antiguas: (a, b) => (a.hasta || '').localeCompare(b.hasta || ''),
  mensajes: (a, b) => (b.mensajesUsuario ?? 0) - (a.mensajesUsuario ?? 0),
  tamano: (a, b) => (b.tamano ?? 0) - (a.tamano ?? 0),
  titulo: (a, b) => (a.titulo || '').localeCompare(b.titulo || '', 'es', { sensitivity: 'base' }),
};

export function aplicar(lista, f = filtros, texto = '') {
  const t = normalizar(texto.trim());
  const rango = rangoFecha(f);
  const estados = ESTADOS.filter((e) => f.estados.includes(e.id));
  const origenes = new Set(f.origenes);
  const carpetas = new Set(f.carpetas);
  const salida = lista.filter((c) => {
    if (!f.vacias && c.vacia) return false;
    if (estados.length && !estados.some((e) => e.prueba(c))) return false;
    if (origenes.size && !origenes.has(origenDe(c))) return false;
    if (carpetas.size && !carpetas.has(nombreCarpeta(c))) return false;
    if (f.subagentes && !(c.subagentes > 0)) return false;
    if (f.imagenes && !(c.imagenes > 0)) return false;
    if (rango) {
      const valor = f.campoFecha === 'desde' ? c.desde : c.hasta;
      if (!valor) return false;
      const d = new Date(valor);
      if ((rango[0] && d < rango[0]) || (rango[1] && d > rango[1])) return false;
    }
    if (t && !normalizar(`${c.titulo} ${c.cwd || ''} ${c.primerPrompt || ''} ${c.id || ''}`).includes(t)) return false;
    return true;
  });
  return salida.sort(COMPARAR[f.orden] ?? COMPARAR.recientes);
}

export function contarActivos(f = filtros) {
  return [f.estados.length, f.fecha !== 'cualquiera', f.origenes.length, f.carpetas.length, f.subagentes, f.imagenes, f.vacias].filter(Boolean).length;
}

function textoFecha(f) {
  if (f.fecha !== 'rango') return FECHAS.find((x) => x.id === f.fecha)?.texto;
  if (f.desde && f.hasta) return `Del ${fechaDia(f.desde)} al ${fechaDia(f.hasta)}`;
  if (f.desde) return `Desde el ${fechaDia(f.desde)}`;
  if (f.hasta) return `Hasta el ${fechaDia(f.hasta)}`;
  return null;
}

// Los filtros activos como chips: un clic saca ese filtro.
export function chips(alCambiar) {
  const f = filtros;
  const lista = [];
  const chip = (texto, quitar) => lista.push(h('button', { type: 'button', class: 'chip', title: `Quitar: ${texto}`, onclick: () => { setFiltros(quitar({ ...filtros })); alCambiar(); } }, h('span', null, texto), icono('cerrar', 13, 2)));
  for (const id of f.estados) chip(ESTADOS.find((e) => e.id === id)?.texto ?? id, (x) => ({ ...x, estados: x.estados.filter((y) => y !== id) }));
  const fecha = f.fecha !== 'cualquiera' && textoFecha(f);
  if (fecha) chip(`${f.campoFecha === 'desde' ? 'Empezadas' : 'Activas'}: ${fecha.toLowerCase()}`, (x) => ({ ...x, fecha: 'cualquiera', desde: '', hasta: '' }));
  for (const id of f.origenes) chip(ORIGENES[id] ?? id, (x) => ({ ...x, origenes: x.origenes.filter((y) => y !== id) }));
  if (f.carpetas.length > 2) chip(`${f.carpetas.length} carpetas`, (x) => ({ ...x, carpetas: [] }));
  else for (const c of f.carpetas) chip(c, (x) => ({ ...x, carpetas: x.carpetas.filter((y) => y !== c) }));
  if (f.subagentes) chip('Con subagentes', (x) => ({ ...x, subagentes: false }));
  if (f.imagenes) chip('Con imágenes', (x) => ({ ...x, imagenes: false }));
  if (f.vacias) chip('Incluye vacías', (x) => ({ ...x, vacias: false }));
  if (f.orden !== 'recientes') chip(ORDENES.find((o) => o.id === f.orden)?.texto ?? f.orden, (x) => ({ ...x, orden: 'recientes' }));
  return lista;
}

// Panel lateral con todos los filtros. Se aplican mientras los cambiás.
export function abrirFiltros(lista, alCambiar) {
  let f = structuredClone(filtros);
  const botonVer = h('button', { type: 'button', class: 'btn btn-primario' });
  const actualizar = () => {
    setFiltros(f);
    alCambiar();
    botonVer.textContent = `Ver ${plural(aplicar(lista, f).length, 'conversación', 'conversaciones')}`;
  };

  const opcion = (tipo, nombre, texto, marcado, alMarcar, cuenta) =>
    h('label', { class: 'opcion' },
      h('input', { type: tipo, name: nombre, checked: marcado, onchange: (e) => alMarcar(e.target.checked) }),
      h('span', { class: 'texto', title: texto }, texto),
      cuenta != null ? h('span', { class: 'cuenta' }, numero(cuenta)) : null);
  const alternar = (campo, valor) => (si) => {
    f[campo] = si ? [...new Set([...f[campo], valor])] : f[campo].filter((x) => x !== valor);
    actualizar();
  };
  const grupo = (titulo, ...hijos) => h('section', { class: 'filtro-grupo' }, h('div', { class: 'filtro-titulo' }, titulo), ...hijos);

  function construir() {
    const base = lista.filter((c) => f.vacias || !c.vacia);
    const contar = (prueba) => base.filter(prueba).length;

    const desde = h('input', { type: 'date', class: 'entrada', value: f.desde, onchange: (e) => { f.desde = e.target.value; actualizar(); } });
    const hasta = h('input', { type: 'date', class: 'entrada', value: f.hasta, onchange: (e) => { f.hasta = e.target.value; actualizar(); } });
    const rango = h('div', { class: 'fechas', hidden: f.fecha !== 'rango' },
      h('label', null, 'Desde', desde),
      h('label', null, 'Hasta', hasta));

    const origenesPresentes = Object.keys(ORIGENES).map((id) => ({ id, n: contar((c) => origenDe(c) === id) })).filter((o) => o.n || f.origenes.includes(o.id));

    const porCarpeta = new Map();
    for (const c of base) porCarpeta.set(nombreCarpeta(c), (porCarpeta.get(nombreCarpeta(c)) ?? 0) + 1);
    const carpetas = [...porCarpeta].sort((a, b) => b[1] - a[1]);
    const listaCarpetas = h('div', { class: 'opciones scroll' });
    const pintarCarpetas = (q = '') => {
      const nq = normalizar(q);
      listaCarpetas.replaceChildren(...carpetas
        .filter(([nombre]) => !nq || normalizar(nombre).includes(nq))
        .map(([nombre, n]) => opcion('checkbox', 'carpeta', nombre, f.carpetas.includes(nombre), alternar('carpetas', nombre), n)));
    };
    pintarCarpetas();

    return [
      grupo('Ordenar',
        h('select', { class: 'selector', 'aria-label': 'Orden', value: f.orden, onchange: (e) => { f.orden = e.target.value; actualizar(); } },
          ORDENES.map((o) => h('option', { value: o.id }, o.texto)))),
      grupo('Estado',
        h('div', { class: 'opciones' }, ESTADOS.map((e) => opcion('checkbox', 'estado', e.texto, f.estados.includes(e.id), alternar('estados', e.id), contar(e.prueba))))),
      grupo('Fecha',
        h('div', { class: 'seg', role: 'group', 'aria-label': 'Qué fecha mirar' },
          [['hasta', 'Última actividad'], ['desde', 'Inicio']].map(([id, texto]) =>
            h('button', { type: 'button', 'aria-pressed': String(f.campoFecha === id), onclick: (e) => {
              f.campoFecha = id;
              for (const b of e.currentTarget.parentElement.children) b.setAttribute('aria-pressed', String(b === e.currentTarget));
              actualizar();
            } }, texto))),
        h('div', { class: 'opciones' }, FECHAS.map((x) => opcion('radio', 'fecha', x.texto, f.fecha === x.id, () => {
          f.fecha = x.id;
          rango.hidden = x.id !== 'rango';
          actualizar();
        }))),
        rango),
      origenesPresentes.length ? grupo('Origen',
        h('div', { class: 'opciones' }, origenesPresentes.map((o) => opcion('checkbox', 'origen', ORIGENES[o.id], f.origenes.includes(o.id), alternar('origenes', o.id), o.n)))) : null,
      grupo(h('span', null, 'Carpeta'),
        carpetas.length > 8 ? h('label', { class: 'campo', style: 'height: 32px' }, icono('buscar', 14),
          h('input', { type: 'search', placeholder: 'Buscar carpeta', 'aria-label': 'Buscar carpeta', oninput: (e) => pintarCarpetas(e.target.value) })) : null,
        listaCarpetas),
      grupo('Contenido',
        h('div', { class: 'opciones' },
          opcion('checkbox', 'contenido', 'Con subagentes', f.subagentes, (si) => { f.subagentes = si; actualizar(); }, contar((c) => c.subagentes > 0)),
          opcion('checkbox', 'contenido', 'Con imágenes', f.imagenes, (si) => { f.imagenes = si; actualizar(); }, contar((c) => c.imagenes > 0)),
          opcion('checkbox', 'contenido', 'Incluir conversaciones vacías', f.vacias, (si) => { f.vacias = si; actualizar(); reconstruir(); }))),
    ];
  }

  const cuerpo = h('div');
  const reconstruir = () => cuerpo.replaceChildren(...construir().filter(Boolean));
  reconstruir();
  actualizar();

  const capa = abrirCajon({
    titulo: 'Filtros',
    contenido: cuerpo,
    pie: [
      h('button', { type: 'button', class: 'btn', onclick: () => { f = { ...structuredClone(BASE), orden: f.orden }; actualizar(); reconstruir(); } }, 'Limpiar'),
      botonVer,
    ],
  });
  botonVer.addEventListener('click', () => capa.cerrar());
  return capa;
}
