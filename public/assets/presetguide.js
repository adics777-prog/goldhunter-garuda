// Illustrated guide "use a preset in 4 steps": MetaTrader 5 drawn in HTML/CSS (Navigator → chart, Inputs → Load,
// pick the pair's preset that the installer already copied, Algo Trading on + panel). Fills every [data-preset-guide];
// bilingual through window.T (i18n.js) when the page has it, Indonesian otherwise. Styles: app.css "preset guide".
(() => {
  const T = (id, en) => (typeof window.T === 'function' ? window.T(id, en) : id);
  const candles = () => {
    const c = [[30, 18, 1], [26, 22, 0], [34, 14, 1], [24, 26, 0], [38, 12, 1], [30, 20, 1], [42, 10, 0], [36, 16, 1], [46, 8, 1], [40, 14, 0], [50, 6, 1], [44, 12, 1]];
    return c.map(([y, h, up], i) => `<i class="pg-c ${up ? 'up' : 'dn'}" style="left:${6 + i * 8}%;bottom:${y}%;height:${h + 10}%"></i>`).join('');
  };
  const win = (title, body, cls = '') => `<div class="pg-win ${cls}"><div class="pg-bar"><i></i><i></i><i></i><span>${title}</span></div><div class="pg-body">${body}</div></div>`;
  function html() {
    const step = (n, h, p, art) => `<li class="pg-step"><div class="pg-art">${art}</div><div class="pg-txt"><span class="pg-n">${n}</span><div><b>${h}</b><p>${p}</p></div></div></li>`;
    const s1 = win('MetaTrader 5', `<div class="pg-split">
        <div class="pg-nav"><div class="pg-nh">Navigator</div><div class="pg-tree">📁 Expert Advisors</div><div class="pg-tree sub on">🦅 GOLD HUNTER GARUDA</div><div class="pg-tree">📁 Scripts</div></div>
        <div class="pg-chart">${candles()}<span class="pg-drop">${T('lepas di sini', 'drop here')}</span></div></div>
        <span class="pg-cursor" aria-hidden="true">🖱️</span>`, 'pg-drag');
    const s2 = win('GOLD HUNTER GARUDA', `<div class="pg-tabs"><span>Common</span><span class="on">Inputs</span></div>
        <div class="pg-rows"><div><span>1.1 Magic number</span><b>130926</b></div><div><span>1.3 ${T('Nama setup', 'Setup name')}</span><b>XAU 1</b></div><div class="mut"><span>${T('… input lain diisi preset', '… other inputs come from the preset')}</span></div></div>
        <div class="pg-btns"><span class="pg-btn hl">Load</span><span class="pg-btn">Save</span><span class="pg-btn">OK</span></div>`);
    const s3 = win('MQL5\\Presets', `<div class="pg-files">
        <div class="on">📄 GOLD HUNTER GARUDA XAUUSD.set</div><div>📄 GOLD HUNTER GARUDA USDJPY.set</div><div>📄 GOLD HUNTER GARUDA EURUSD.set</div><div>📄 GOLD HUNTER GARUDA BTCUSD.set</div></div>
        <div class="pg-note">✔ ${T('disalin otomatis oleh installer', 'copied automatically by the installer')}</div>`);
    const s4 = win('XAUUSD, M1', `<div class="pg-tool"><span class="pg-algo">▶ Algo Trading</span></div>
        <div class="pg-chart sm">${candles()}<div class="pg-panel"><b>GOLD HUNTER GARUDA</b><span>XAU 1 · BARBAR</span><span class="g">SEWA · 29 ${T('hari', 'days')}</span><span>BUY 2 · SELL 1</span></div></div>`);
    return `<ol class="pg">
      ${step(1, T('Seret EA ke chart', 'Drag the EA onto the chart'), T('Buka chart pair-nya (M1 cukup). Dari Navigator → Expert Advisors, seret <b>GOLD HUNTER GARUDA</b> ke chart.', 'Open the chart of the pair (M1 is fine). From Navigator → Expert Advisors, drag <b>GOLD HUNTER GARUDA</b> onto it.'), s1)}
      ${step(2, T('Tab Inputs → Load', 'Inputs tab → Load'), T('Jendela EA terbuka. Pilih tab <b>Inputs</b>, lalu klik <b>Load</b>.', 'The EA window opens. Pick the <b>Inputs</b> tab and click <b>Load</b>.'), s2)}
      ${step(3, T('Pilih preset pair-nya', 'Pick the preset of the pair'), T('Semua preset pusat <b>sudah ada di daftar</b>: installer menyalinnya dan memperbaruinya otomatis. Pilih yang sesuai pair chart.', 'Every preset from HQ is <b>already in the list</b>: the installer copied it and keeps it updated. Pick the one for the chart\'s pair.'), s3)}
      ${step(4, T('OK, Algo Trading hijau', 'OK, Algo Trading green'), T('Centang <b>Allow Algo Trading</b>, klik OK, dan pastikan tombol <b>Algo Trading</b> hijau. Panel EA muncul dengan lisensi dan hitung mundurnya.', 'Tick <b>Allow Algo Trading</b>, click OK and make sure the <b>Algo Trading</b> button is green. The EA panel shows your licence and its countdown.'), s4)}
    </ol>`;
  }
  const render = () => document.querySelectorAll('[data-preset-guide]').forEach((el) => { el.innerHTML = html(); });
  window.GHG_PRESET_GUIDE = { html, render };
  render();
  document.addEventListener('ghg:lang', render);
})();
