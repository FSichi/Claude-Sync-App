// Arma las notas de un release: lo nuevo de esa versión (del CHANGELOG.md) más cómo instalar.
//   node installer/notas-release.mjs 1.2.0 dist/notas.md
// Falla si el CHANGELOG.md no tiene esa versión, así no sale un release sin novedades.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { notasDeVersion } from '../src/changelog.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [version, salida] = process.argv.slice(2);
if (!version) {
  console.error('Uso: node installer/notas-release.mjs <versión> [archivo de salida]');
  process.exit(2);
}
const novedades = notasDeVersion(fs.readFileSync(path.join(raiz, 'CHANGELOG.md'), 'utf8'), version);
if (!novedades) {
  console.error(`El CHANGELOG.md no tiene una sección "## [${version}]" con cambios.`);
  process.exit(1);
}
const instalar = fs.readFileSync(path.join(raiz, 'installer', 'notas-release.md'), 'utf8');
const notas = `${novedades}\n\n---\n\n${instalar}`;
if (salida) {
  fs.mkdirSync(path.dirname(path.resolve(salida)), { recursive: true });
  fs.writeFileSync(salida, notas);
  console.log(`Notas de ${version} en ${salida}`);
} else {
  process.stdout.write(notas);
}
