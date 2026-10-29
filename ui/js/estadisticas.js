// Estadísticas: tokens y respuestas por período, modelo, proyecto y conversación, según lo que informa Claude Code
// en cada respuesta (incluidos los subagentes). Se calcula en el navegador a partir de /api/estadisticas.
import { h, api, numero, plural, compacto, nombreCarpeta, nombreModelo, rutaConversacion, navegar, leerPref, guardarPref, avisarError } from './util.js';
import { sincronizarAhora } from './estado.js';
import { barras, eje, filasConBarra } from './graficos.js';
import { setFiltros, filtros } from './filtros.js';

const DIA = 86400000;
const RANGOS = [
  { id: '30', texto: '30 días', dias: 30 },
  { id: '90', texto: '90 días', dias: 90 },
  { id: '365', texto: '12 meses', dias: 365 },
  { id: 'todo', texto: 'Todo', dias: null },
];
const CAMPOS = ['entrada', 'salida', 'cacheEscritura', 'cacheLectura', 'respuestas'];
const total = (x) => x.entrada + x.salida + x.cacheEscritura + x.cacheLectura;
const METRICAS = [
  { id: 'total', texto: 'Tokens', valor: total },
  { id: 'salida', texto: 'Tokens generados', valor: (x) => x.salida },
  { id: 'respuestas', texto: 'Respuestas', valor: (x) => x.respuestas },
];

let rango = leerPref('estadisticasRango', '30');
let metrica = leerPref('estadisticasMetrica', 'total');
let datos = null;
let contenedor = null;

const vacio = () => ({ entrada: 0, salida: 0, cacheEscritura: 0, cacheLectura: 0, respuestas: 0 });
const sumar = (a, u) => {
  for (const k of CAMPOS) a[k] += u[k] ?? 0;
  return a;
};
const en = (mapa, clave, crear = vacio) => mapa.get(clave) ?? mapa.set(clave, crear()).get(clave);
const claveDia = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const nombreMes = (clave) => {
  const t = new Date(`${clave}-15T12:00:00`).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  return t.charAt(0).toUpperCase() + t.slice(1);
};

function calcular(conversaciones, r) {
  const hoy = new Date();
  hoy.setHours(12, 0, 0, 0);
  const desde = r.dias ? claveDia(new Date(hoy.getTime() - (r.dias - 1) * DIA)) : null;
  const porDia = Boolean(r.dias && r.dias <= 90);
  const tot = vacio();
  const periodos = new Map();
  const modelos = new Map();
  const proyectos = new Map();
  const meses = new Map();
  const dias = new Set();
  const convs = [];
  let primero = null;
  for (const c of conversaciones) {
    const t = vacio();
    for (const u of c.uso) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(u.dia) || (desde && u.dia < desde)) continue;
      sumar(t, u);
      sumar(tot, u);
      dias.add(u.dia);
      if (!primero || u.dia < primero) primero = u.dia;
      sumar(en(periodos, porDia ? u.dia : u.dia.slice(0, 7)), u);
      sumar(en(modelos, nombreModelo(u.modelo)), u);
      sumar(en(meses, u.dia.slice(0, 7)), u);
    }
    if (!t.respuestas && !total(t)) continue;
    convs.push({ c, ...t });
    const p = en(proyectos, nombreCarpeta(c), () => ({ nombre: nombreCarpeta(c), conversaciones: 0, ...vacio() }));
    sumar(p, t);
    p.conversaciones++;
  }
  // La serie lleva todos los días (o meses) del período, aunque no haya actividad.
  const serie = [];
  if (porDia) {
    for (let i = r.dias - 1; i >= 0; i--) {
      const d = new Date(hoy.getTime() - i * DIA);
      serie.push({ clave: claveDia(d), fecha: d, ...(periodos.get(claveDia(d)) ?? vacio()) });
    }
  } else if (primero) {
    const d = new Date(`${(desde ?? primero).slice(0, 7)}-01T12:00:00`);
    const fin = claveDia(hoy).slice(0, 7);
    while (claveDia(d).slice(0, 7) <= fin) {
      const k = claveDia(d).slice(0, 7);
      serie.push({ clave: k, fecha: new Date(d), ...(periodos.get(k) ?? vacio()) });
      d.setMonth(d.getMonth() + 1);
    }
  }
  const porTotal = (a, b) => total(b) - total(a);
  return {
    tot,
    serie,
    porDia,
    dias: dias.size,
    conversaciones: convs.length,
    modelos: [...modelos].map(([nombre, x]) => ({ nombre, ...x })).sort(porTotal),
    proyectos: [...proyectos.values()].sort(porTotal).slice(0, 8),
    top: convs.sort(porTotal).slice(0, 10),
    meses: [...meses].map(([mes, x]) => ({ mes, ...x })).sort((a, b) => b.mes.localeCompare(a.mes)),
  };
}

function seg(opciones, actual, alElegir, etiqueta) {
  return h('div', { class: 'seg', role: 'group', 'aria-label': etiqueta },
    opciones.map((o) => h('button', { type: 'button', 'aria-pressed': String(o.id === actual), onclick: () => alElegir(o.id) }, o.texto)));
}

const tile = (valor, texto, titulo = null) => h('div', { class: 'stat', title: titulo }, h('div', { class: 'stat-num' }, valor), h('div', { class: 'stat-etq' }, texto));

function grafico(e) {
  const m = METRICAS.find((x) => x.id === metrica) ?? METRICAS[0];
  const titulo = (p) => (e.porDia ? p.fecha.toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' }) : nombreMes(p.clave));
  const puntos = e.serie.map((p) => ({
    valor: m.valor(p),
    titulo: titulo(p),
    lineas: [`${compacto(total(p))} tokens`, `${compacto(p.salida)} generados`, `${compacto(p.cacheLectura)} leídos de la caché`, plural(p.respuestas, 'respuesta', 'respuestas')],
  }));
  const corta = (p) => (e.porDia ? p.fecha.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }) : p.fecha.toLocaleDateString('es-AR', { month: 'short', year: '2-digit' }));
  const s = e.serie;
  return h('section', { class: 'seccion' },
    h('div', { class: 'seccion-cab' },
      h('h2', { class: 'seccion-titulo' }, `${m.texto} por ${e.porDia ? 'día' : 'mes'}`),
      seg(METRICAS, metrica, (id) => {
        metrica = id;
        guardarPref('estadisticasMetrica', id);
        pintar();
      }, 'Qué mostrar en el gráfico')),
    h('div', { class: 'tarjeta actividad' },
      s.length ? barras(puntos, { descripcion: `${m.texto} por ${e.porDia ? 'día' : 'mes'}`, alto: 190 }) : h('p', { class: 'tenue' }, 'No hay actividad en este período.'),
      s.length ? eje(corta(s[0]), corta(s[Math.floor(s.length / 2)]), e.porDia ? 'hoy' : corta(s[s.length - 1])) : null));
}

function tabla(meses) {
  const celda = (n) => h('td', { class: 'num' }, numero(n));
  return h('div', { class: 'tarjeta tabla-cont' },
    h('table', { class: 'tabla' },
      h('thead', null, h('tr', null, ['Mes', 'Respuestas', 'Entrada', 'Escritura en caché', 'Lectura de caché', 'Generados', 'Total'].map((t, i) => h('th', { class: i ? 'num' : null, scope: 'col' }, t)))),
      h('tbody', null, meses.map((m) => h('tr', null,
        h('th', { scope: 'row' }, nombreMes(m.mes)),
        celda(m.respuestas), celda(m.entrada), celda(m.cacheEscritura), celda(m.cacheLectura), celda(m.salida), celda(total(m)))))));
}

function pintar() {
  if (!contenedor || !document.contains(contenedor)) return;
  const r = RANGOS.find((x) => x.id === rango) ?? RANGOS[0];
  const cab = h('header', { class: 'encabezado encabezado-fila' },
    h('div', null,
      h('h1', null, 'Estadísticas'),
      h('p', null, 'Cuánto trabajó Claude en tus conversaciones, según los tokens que informa Claude Code en cada respuesta, incluidos los subagentes.')),
    seg(RANGOS, rango, (id) => {
      rango = id;
      guardarPref('estadisticasRango', id);
      pintar();
    }, 'Período'));
  if (!datos) {
    contenedor.replaceChildren(cab, h('p', { class: 'sutil' }, 'Calculando…'));
    return;
  }
  if (datos.faltaIndice) {
    contenedor.replaceChildren(cab, h('div', { class: 'aviso info' }, h('div', { class: 'aviso-texto' }, 'Para ver las estadísticas hay que sincronizar una vez con esta versión: arma el índice con los tokens de cada conversación.'), h('button', { type: 'button', class: 'btn btn-chico btn-primario', onclick: sincronizarAhora }, 'Sincronizar')));
    return;
  }
  const e = calcular(datos.conversaciones, r);
  const t = e.tot;
  const sumaModelos = Math.max(1, total(t));
  contenedor.replaceChildren(
    cab,
    h('section', { class: 'stats stats-6', 'aria-label': 'Totales del período' },
      tile(compacto(total(t)), 'tokens en total', `${numero(total(t))} tokens`),
      tile(compacto(t.salida), 'generados por Claude', `${numero(t.salida)} tokens de salida`),
      tile(compacto(t.cacheLectura), 'leídos de la caché', `${numero(t.cacheLectura)} tokens`),
      tile(numero(t.respuestas), 'respuestas'),
      tile(numero(e.conversaciones), 'conversaciones'),
      tile(numero(e.dias), 'días con actividad')),
    grafico(e),
    h('div', { class: 'grid-2 alineado' },
      h('section', { class: 'seccion' },
        h('h2', { class: 'seccion-titulo' }, 'Por modelo'),
        e.modelos.length ? filasConBarra(e.modelos.map((m) => ({
          nombre: m.nombre,
          valor: total(m),
          derecha: (() => {
            const pct = (total(m) / sumaModelos) * 100;
            return pct > 0 && pct < 1 ? '<1 %' : `${Math.round(pct)} %`;
          })(),
          abajo: `${compacto(total(m))} tokens · ${plural(m.respuestas, 'respuesta', 'respuestas')}`,
        }))) : h('p', { class: 'tenue' }, 'Sin datos en este período.')),
      h('section', { class: 'seccion' },
        h('h2', { class: 'seccion-titulo' }, 'Por proyecto'),
        e.proyectos.length ? filasConBarra(e.proyectos.map((p) => ({
          nombre: p.nombre,
          valor: total(p),
          derecha: plural(p.conversaciones, 'conversación', 'conversaciones'),
          abajo: `${compacto(total(p))} tokens · ${plural(p.respuestas, 'respuesta', 'respuestas')}`,
          href: '#/conversaciones',
          alClic: () => {
            setFiltros({ ...filtros, estados: [], fecha: 'cualquiera', carpetas: [p.nombre] });
            navegar('#/conversaciones');
          },
        }))) : h('p', { class: 'tenue' }, 'Sin datos en este período.'))),
    e.top.length ? h('section', { class: 'seccion' },
      h('h2', { class: 'seccion-titulo' }, 'Las conversaciones que más usaron'),
      h('div', { class: 'filas' }, e.top.map((x) => h('a', { class: 'fila', href: rutaConversacion(x.c.clave) },
        h('span', { class: 'fila-titulo' }, x.c.titulo || 'Sin título'),
        h('span', { class: 'fila-meta ancha', title: x.c.cwd || '' }, nombreCarpeta(x.c)),
        h('span', { class: 'fila-meta' }, plural(x.respuestas, 'respuesta', 'respuestas')),
        h('span', { class: 'fila-meta fecha' }, compacto(total(x))))))) : null,
    e.meses.length ? h('section', { class: 'seccion' }, h('h2', { class: 'seccion-titulo' }, 'Detalle por mes'), tabla(e.meses)) : null,
    h('p', { class: 'nota-pie' }, 'Entrada son los tokens nuevos que recibió Claude; la caché guarda lo que se repite de un mensaje al siguiente (el contexto de la conversación), por eso es lo más grande. Son medidas de trabajo, no un costo. Las conversaciones que todavía no se sincronizaron no aparecen.'));
}

async function cargar() {
  try {
    datos = await api('/api/estadisticas');
  } catch (e) {
    avisarError(e);
    datos = { faltaIndice: false, conversaciones: [] };
  }
  pintar();
}

export function pintarEstadisticas(vista) {
  contenedor = h('div', { class: 'contenido ancho' });
  vista.replaceChildren(h('div', { class: 'pagina', style: 'padding-top: 32px' }, contenedor));
  pintar();
  if (!datos) cargar();
}

export function refrescarEstadisticas() {
  datos = null;
  if (contenedor && document.contains(contenedor)) {
    pintar();
    cargar();
  }
}
