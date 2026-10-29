// /fitur: every EA feature one by one. The content is the feature documentation inside the EA source
// (/*@GHG-FEATURES*/), published by the builder to /api/features, so a feature documented in a new EA version shows up
// here without a website deploy. Fallback: /assets/features.json shipped with the site.
(() => {
  const T = (id, en) => (typeof window.T === 'function' ? window.T(id, en) : id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const L = (x) => esc(x ? T(x.id || '', x.en || x.id || '') : '');
  const root = document.getElementById('fx-root'), chips = document.getElementById('fx-chips'), count = document.getElementById('fx-count');
  if (!root) return;
  const setLab = (s) => (s === 'otomatis' ? T('otomatis', 'automatic') : s === 'installer' ? 'installer' : `setting ${esc(s)}`);
  const feat = (f) => `<article class="fx reveal"><div class="fx-head"><h3>${L(f.title)}</h3>${f.setting ? `<span class="fx-set">${setLab(f.setting)}</span>` : ''}</div>
      <div class="fx-row"><span class="fx-k" aria-hidden="true">⚙️</span><div><b>${T('Cara kerja', 'How it works')}</b><p>${L(f.how)}</p></div></div>
      <div class="fx-row use"><span class="fx-k" aria-hidden="true">✅</span><div><b>${T('Fungsinya', 'What it is for')}</b><p>${L(f.use)}</p></div></div></article>`;
  const flow = (g) => (g.flow && g.flow.length ? `<ol class="flowline${g.flow.length === 4 ? ' four' : ''} reveal">${g.flow.map((x) =>
    `<li><span class="fl-ico" aria-hidden="true">${esc(x.icon)}</span><b>${L(x.title)}</b><small>${L(x.sub)}</small></li>`).join('')}</ol>` : '');
  let DOC = null;
  function render() {
    const gs = DOC.groups || [];
    const n = gs.reduce((a, g) => a + (g.features || []).length, 0);
    if (count) count.textContent = `🦅 ${n} ${T('fitur', 'features')}${DOC.version ? ` · EA v${DOC.version}` : ''}`;
    if (chips) chips.innerHTML = gs.map((g) => `<a href="#${esc(g.id)}">${esc(g.icon)} ${L(g.title)}</a>`).join('');
    root.innerHTML = gs.map((g, k) => `<section class="sec${k % 2 ? ' alt' : ''} fx-sec${g.badge ? ' fx-star' : ''}" id="${esc(g.id)}">
      <div class="wrap">
        <div class="fx-title reveal"><span class="fx-gico" aria-hidden="true">${esc(g.icon)}</span><div>${g.badge ? `<span class="fx-badge">${L(g.badge)}</span>` : ''}<h2>${L(g.title)}</h2><p>${L(g.intro)}</p></div></div>
        ${flow(g)}${g.note ? `<p class="fx-note reveal">${L(g.note)}</p>` : ''}
        <div class="fx-grid">${(g.features || []).map(feat).join('')}</div>
      </div></section>`).join('');
    if (typeof SITE !== 'undefined' && SITE.reveal) SITE.reveal(root);
    if (location.hash) { const el = document.getElementById(location.hash.slice(1)); if (el) el.scrollIntoView({ block: 'start' }); }
  }
  const load = (u) => fetch(u, { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then((d) => (d && Array.isArray(d.groups) && d.groups.length ? d : Promise.reject('empty')));
  load('/api/features').catch(() => load('/assets/features.json'))
    .then((d) => { DOC = d; render(); })
    .catch(() => { root.innerHTML = `<section class="sec"><div class="wrap"><div class="empty-box">${T('Daftar fitur belum bisa dimuat. Muat ulang halaman.', 'The feature list could not be loaded. Please reload.')}</div></div></section>`; });
  document.addEventListener('ghg:lang', () => { if (DOC) render(); });
})();
