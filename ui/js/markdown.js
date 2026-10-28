// Markdown seguro: todo se escapa antes de darle formato.
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function enLinea(s) {
  return s
    .split(/(`[^`\n]+`)/g)
    .map((p) => {
      if (/^`[^`\n]+`$/.test(p)) return `<code>${p.slice(1, -1)}</code>`;
      return p
        .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>')
        .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    })
    .join('');
}

// Para textos de una línea que vienen de nosotros (changelog): escapa y aplica formato en línea.
export const lineaSegura = (s) => enLinea(esc(s));

export function markdown(texto) {
  const lineas = String(texto).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  const esInicioDeBloque = (l) => /^\s*(```|~~~|#{1,6}\s|>|([-*+]|\d+[.)])\s+|\|.*\|\s*$)/.test(l);
  let i = 0;
  while (i < lineas.length) {
    const l = lineas[i];
    const cerco = l.match(/^\s*(```+|~~~+)/);
    if (cerco) {
      const cod = [];
      i++;
      while (i < lineas.length && !lineas[i].trim().startsWith(cerco[1])) cod.push(lineas[i++]);
      i++;
      out.push(`<pre><code>${esc(cod.join('\n'))}</code></pre>`);
      continue;
    }
    if (!l.trim()) {
      i++;
      continue;
    }
    const tit = l.match(/^(#{1,6})\s+(.*)$/);
    if (tit) {
      out.push(`<h${tit[1].length}>${enLinea(esc(tit[2]))}</h${tit[1].length}>`);
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) {
      out.push('<hr>');
      i++;
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < lineas.length && /^\s*\|?\s*:?-{2,}/.test(lineas[i + 1])) {
      const filas = [];
      while (i < lineas.length && /^\s*\|.*\|\s*$/.test(lineas[i])) filas.push(lineas[i++]);
      const celdas = (f) => f.trim().replace(/^\||\|$/g, '').split('|').map((c) => enLinea(esc(c.trim())));
      const [cab, , ...resto] = filas;
      out.push(`<table><thead><tr>${celdas(cab).map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${resto.map((f) => `<tr>${celdas(f).map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    if (/^\s*>/.test(l)) {
      const cita = [];
      while (i < lineas.length && /^\s*>/.test(lineas[i])) cita.push(lineas[i++].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${markdown(cita.join('\n'))}</blockquote>`);
      continue;
    }
    const item = l.match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
    if (item) {
      const ordenada = /\d/.test(item[1]);
      const items = [];
      while (i < lineas.length) {
        const m = lineas[i].match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
        if (m) items.push(m[2]);
        else if (/^\s{2,}\S/.test(lineas[i]) && items.length) items[items.length - 1] += ' ' + lineas[i].trim();
        else break;
        i++;
      }
      const tag = ordenada ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map((x) => `<li>${enLinea(esc(x))}</li>`).join('')}</${tag}>`);
      continue;
    }
    const parrafo = [];
    while (i < lineas.length && lineas[i].trim() && (!parrafo.length || !esInicioDeBloque(lineas[i]))) parrafo.push(lineas[i++]);
    out.push(`<p>${parrafo.map((x) => enLinea(esc(x))).join('<br>')}</p>`);
  }
  return out.join('');
}
