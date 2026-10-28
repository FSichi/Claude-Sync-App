// Uso desde la terminal:
//   node src/cli.js simular       -> muestra qué copiaría, sin escribir nada
//   node src/cli.js sincronizar   -> sincroniza
//   Opcional: --config <ruta a otro config.json>
import { cargarConfig } from './config.js';
import { sincronizar } from './sincronizar.js';

const MB = (b) => `${(b / 1048576).toFixed(1)} MB`;
const [, , comando = 'simular', ...resto] = process.argv;
if (!['simular', 'sincronizar'].includes(comando)) {
  console.error('Uso: node src/cli.js simular|sincronizar [--config ruta]');
  process.exit(2);
}
const i = resto.indexOf('--config');
const config = cargarConfig(i >= 0 ? resto[i + 1] : undefined);

let ultimo = '';
const resultado = await sincronizar(config, {
  simular: comando === 'simular',
  onProgreso: (p) => {
    let linea = p.fase;
    if (p.fase === 'copiando') linea = `Copiando a ${p.destino}: ${p.hechos}/${p.total} archivos, ${MB(p.bytesHechos)} de ${MB(p.bytesTotal)}`;
    if (p.fase === 'indexando') linea = `Indexando ${p.destino}${p.total ? `: ${p.hechos}/${p.total}` : ''}`;
    if (linea !== ultimo) process.stdout.write(`\r${linea.padEnd(110).slice(0, 110)}`);
    ultimo = linea;
  },
});
process.stdout.write('\n\n');

console.log(resultado.simulacion ? 'SIMULACIÓN (no se escribió nada)' : 'SINCRONIZACIÓN TERMINADA');
for (const f of resultado.fuentes) {
  console.log(`  ${f.disponible ? '✓' : '·'} ${f.nombre}: ${f.disponible ? `${f.archivos} archivos, ${MB(f.bytes)}` : 'no existe'}`);
}
for (const d of resultado.destinos) {
  console.log(`\nDestino ${d.destino}`);
  if (!d.disponible) {
    console.log(`  NO DISPONIBLE: ${d.motivo}`);
    continue;
  }
  console.log(`  nuevos ${d.nuevos} · agregados ${d.agregados} · reemplazados ${d.reemplazados} (versiones guardadas ${d.versionados}) · sin cambios ${d.sinCambios}`);
  console.log(`  ${MB(d.bytes)} ${resultado.simulacion ? 'a copiar' : 'copiados'}${d.eliminadosEnOrigen ? ` · ${d.eliminadosEnOrigen} archivos ya no están en el origen (se conservan)` : ''}`);
  if (d.conversaciones != null) console.log(`  ${d.conversaciones} conversaciones en el índice (${d.indexadas} procesadas ahora)`);
  for (const e of d.errores.slice(0, 20)) console.log(`  ERROR ${e.ruta}: ${e.error}`);
}
const errores = resultado.destinos.reduce((s, d) => s + d.errores.length, 0) + resultado.fuentes.reduce((s, f) => s + f.errores.length, 0);
process.exitCode = errores ? 1 : 0;
