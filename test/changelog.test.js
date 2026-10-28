import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { RAIZ_APP, VERSION } from '../src/config.js';
import { parseChangelog, parseSecciones, compararVersiones, notasDeVersion } from '../src/changelog.js';

const ejemplo = `# Changelog

## [1.2.0] - 2026-10-29

### Nuevo
- **Diseño nuevo**, más simple.
- Filtros por fecha
  y por carpeta.

### Arreglos
- Un arreglo.

## [1.1.0] - 2026-10-28

### Nuevo
- Instalador.
`;

test('lee las versiones, sus secciones y los ítems de varias líneas', () => {
  const v = parseChangelog(ejemplo);
  assert.deepEqual(v.map((x) => x.version), ['1.2.0', '1.1.0']);
  assert.equal(v[0].fecha, '2026-10-29');
  assert.deepEqual(v[0].secciones.map((s) => s.titulo), ['Nuevo', 'Arreglos']);
  assert.equal(v[0].secciones[0].items[1], 'Filtros por fecha y por carpeta.');
});

test('del cuerpo de un release toma las novedades y deja afuera las instrucciones', () => {
  const cuerpo = `### Nuevo\n- Algo\n\n---\n\n## Cómo instalar\n1. Bajá el instalador.\n- no es una novedad`;
  const s = parseSecciones(cuerpo);
  assert.equal(s.length, 1);
  assert.deepEqual(s[0].items, ['Algo']);
});

test('compara versiones número por número', () => {
  assert.equal(compararVersiones('1.10.0', '1.9.3'), 1);
  assert.equal(compararVersiones('v1.2.0', '1.2.0'), 0);
  assert.equal(compararVersiones('1.1.9', '1.2.0'), -1);
});

test('las notas del release salen del CHANGELOG, y faltan si la versión no está', () => {
  assert.match(notasDeVersion(ejemplo, '1.2.0'), /^### Nuevo\n- \*\*Diseño nuevo\*\*/);
  assert.equal(notasDeVersion(ejemplo, '9.9.9'), null);
});

test('el CHANGELOG.md del repo tiene la versión de package.json', () => {
  const texto = fs.readFileSync(path.join(RAIZ_APP, 'CHANGELOG.md'), 'utf8');
  assert.ok(notasDeVersion(texto, VERSION), `falta "## [${VERSION}]" en CHANGELOG.md`);
});
