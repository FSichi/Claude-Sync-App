// Lee el CHANGELOG.md (y el cuerpo de los releases de GitHub, que salen de él).
// Formato:  ## [1.2.0] - 2026-10-29   →   ### Nuevo   →   - Un cambio
const RE_VERSION = /^##\s+\[?v?(\d+\.\d+\.\d+)\]?(?:\s*[-–]\s*(\d{4}-\d{2}-\d{2}))?/;

function leerSecciones(lineas, alTerminar) {
  const secciones = [];
  let actual = null;
  for (const linea of lineas) {
    if (alTerminar(linea)) break;
    const titulo = linea.match(/^###\s+(.+)/);
    if (titulo) {
      actual = { titulo: titulo[1].trim(), items: [] };
      secciones.push(actual);
      continue;
    }
    const item = linea.match(/^\s*[-*]\s+(.+)/);
    if (item && actual) {
      actual.items.push(item[1].trim());
      continue;
    }
    // Una línea con sangría continúa el ítem anterior.
    if (actual?.items.length && /^\s{2,}\S/.test(linea)) actual.items[actual.items.length - 1] += ` ${linea.trim()}`;
  }
  return secciones.filter((s) => s.items.length);
}

export function parseChangelog(texto) {
  const lineas = String(texto ?? '').replace(/\r/g, '').split('\n');
  const versiones = [];
  for (let i = 0; i < lineas.length; i++) {
    const m = lineas[i].match(RE_VERSION);
    if (!m) continue;
    const resto = lineas.slice(i + 1);
    versiones.push({ version: m[1], fecha: m[2] ?? null, secciones: leerSecciones(resto, (l) => RE_VERSION.test(l)) });
  }
  return versiones;
}

// El cuerpo de un release: las secciones van primero; después de "---" o de un título "## " vienen las instrucciones.
export function parseSecciones(texto) {
  const lineas = String(texto ?? '').replace(/\r/g, '').split('\n');
  return leerSecciones(lineas, (l) => /^---\s*$/.test(l) || /^##\s/.test(l));
}

export function compararVersiones(a, b) {
  const partes = (v) => String(v).replace(/^v/i, '').split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  const [x, y] = [partes(a), partes(b)];
  for (let i = 0; i < 3; i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0) ? 1 : -1;
  }
  return 0;
}

// Markdown de una versión, para el cuerpo del release.
export function notasDeVersion(texto, version) {
  const v = parseChangelog(texto).find((x) => x.version === String(version).replace(/^v/i, ''));
  if (!v || !v.secciones.length) return null;
  return v.secciones.map((s) => `### ${s.titulo}\n${s.items.map((i) => `- ${i}`).join('\n')}`).join('\n\n');
}
