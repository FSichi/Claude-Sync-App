// Aplica el tema guardado antes de pintar, para que no parpadee.
(function () {
  var pref = 'sistema';
  try {
    pref = JSON.parse(localStorage.getItem('pref:tema')) || 'sistema';
  } catch (e) {}
  var claro = pref === 'claro' || (pref === 'sistema' && window.matchMedia('(prefers-color-scheme: light)').matches);
  document.documentElement.dataset.tema = claro ? 'claro' : 'oscuro';
})();
