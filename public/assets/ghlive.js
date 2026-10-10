// GOLD HUNTER GARUDA live: shared rendering of setups (landing, /live, member area). Needs common.js (GHG); i18n.js (T) optional.
const GHL = (() => {
  const TT = (id, en) => (typeof window.T === 'function' ? window.T(id, en) : id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const loc = () => TT('id-ID', 'en-US');
  const isCent = (cur) => ['USC', 'USX', 'UST'].includes(String(cur || '').toUpperCase());
  // account money -> dollars (cent account: 100 USC = $1)
  const toUsd = (v, cur) => (v == null ? null : isCent(cur) ? v / 100 : v);
  const usd = (v, sign = true) => {
    if (v == null || !Number.isFinite(Number(v))) return '-';
    const n = Number(v), a = Math.abs(n);
    const s = a.toLocaleString(loc(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (sign ? (n > 0 ? '+' : n < 0 ? '-' : '') : (n < 0 ? '-' : '')) + '$' + s;
  };
  const num = (v, d = 0) => Number(v || 0).toLocaleString(loc(), { minimumFractionDigits: d, maximumFractionDigits: d });
  const pct = (v, sign = true) => (v == null || !Number.isFinite(Number(v)) ? '-' : (sign && v > 0 ? '+' : '') + Number(v).toLocaleString(loc(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%');
  const cls = (v) => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');
  const days = (sec) => {
    const d = Math.floor((sec || 0) / 86400), h = Math.floor(((sec || 0) % 86400) / 3600);
    if (d >= 1) return `${d} ${TT('hari', d === 1 ? 'day' : 'days')}${d < 7 && h ? ` ${h} ${TT('jam', 'h')}` : ''}`;
    if (h >= 1) return `${h} ${TT('jam', h === 1 ? 'hour' : 'hours')}`;
    return TT('baru mulai', 'just started');
  };
  const run = (sec) => ((sec || 0) < 3600 ? TT('baru mulai', 'just started') : `${TT('berjalan', 'running')} ${days(sec)}`);
  const RISK = () => ({
    LOW: { name: 'Low', cls: 'b-green', txt: TT('Risiko rendah', 'Low risk') },
    MEDIUM: { name: 'Medium', cls: 'b-gold', txt: TT('Risiko sedang', 'Medium risk') },
    HIGH: { name: 'High', cls: 'b-red', txt: TT('Risiko tinggi', 'High risk') },
  });
  const riskBadge = (r) => { const x = RISK()[r]; return x ? `<span class="badge ${x.cls}">${x.name}</span>` : `<span class="badge b-blue">${TT('Akun master', 'Master account')}</span>`; };
  const NAME = () => ({ XAUUSD: TT('Emas', 'Gold'), BTCUSD: 'Bitcoin', EURUSD: 'Euro / Dolar', USDJPY: TT('Dolar / Yen', 'Dollar / Yen') });
  const ICON = { XAUUSD: '🥇', BTCUSD: '₿', EURUSD: '💶', USDJPY: '💴' };
  const PAIRS = ['XAUUSD', 'BTCUSD', 'EURUSD', 'USDJPY'];
  // The 12 monitoring-account presets: first lot 0.01 per `caps` USC (LOW / MEDIUM / HIGH), lot follows the balance.
  // Minimum account capital = capital per 0.01 lot (below it the broker minimum 0.01 is used, i.e. more risk).
  // Tester 1 Jan - 10 Oct 2026 gold 0.01 per 10,000 (= HIGH): deepest floating of one side -41% (29 Jan, 48 positions).
  // hold = adverse move without any pause at -10% / -30% / -50% floating.
  const PRESET = {
    XAUUSD: { caps: [40000, 20000, 10000], dist: '$1', tp: '$1,50', back: '$0,50', hold: [['$80', '$138', '$178'], ['$56', '$97', '$126'], ['$40', '$69', '$89']] },
    BTCUSD: { caps: [16000, 8000, 4000], dist: '$35', tp: '$50', back: '$17,50', hold: [['$2.977', '$5.153', '$6.653'], ['$2.110', '$3.643', '$4.705'], ['$1.498', '$2.583', '$3.327']] },
    EURUSD: { caps: [12800, 6400, 3200], dist: '3 pip', tp: '4 pip', back: '1,5 pip', hold: [['247 pip', '427 pip', '551 pip'], ['175 pip', '302 pip', '389 pip'], ['124 pip', '214 pip', '276 pip']] },
    USDJPY: { caps: [8000, 4000, 2000], dist: '3 pip', tp: '4 pip', back: '1,5 pip', hold: [['246 pip', '424 pip', '548 pip'], ['174 pip', '301 pip', '387 pip'], ['123 pip', '213 pip', '274 pip']] },
  };
  const RISKS = ['LOW', 'MEDIUM', 'HIGH'];
  const enNum = (s) => (TT('id', 'en') === 'en' ? String(s).replace(/\./g, '#').replace(/,/g, '.').replace(/#/g, ',') : s);

  // small bar chart of daily profit since the start
  function spark(arr, cur) {
    const a = (arr || []).slice(-30);
    if (!a.length) return '';
    const mx = Math.max(1e-9, ...a.map((x) => Math.abs(x[1])));
    const w = 100 / 30, off = 30 - a.length;          // 30 fixed slots, newest on the right
    const bars = a.map((x, j) => {
      const i = j + off;
      const h = Math.max(2, Math.abs(x[1]) / mx * 26);
      const y = x[1] >= 0 ? 28 - h : 28;
      return `<rect x="${(i * w + w * 0.15).toFixed(2)}" y="${y.toFixed(2)}" width="${(w * 0.7).toFixed(2)}" height="${h.toFixed(2)}" rx="0.6" fill="${x[1] >= 0 ? '#6ee7a2' : '#ff8b95'}"><title>${esc(x[0])}: ${usd(toUsd(x[1], cur))}</title></rect>`;
    }).join('');
    return `<svg class="ghl-spark" viewBox="0 0 100 56" preserveAspectRatio="none" aria-hidden="true"><line x1="0" y1="28" x2="100" y2="28" stroke="rgba(255,255,255,.18)" stroke-width="0.4"/>${bars}</svg>`;
  }

  // one setup on the overview / landing
  function card(v, opts = {}) {
    const cur = v.currency;
    const fl = toUsd(v.floating, cur);
    const pos = (x) => (x && x.count ? `${x.count} ${TT('posisi', 'pos')}` : '-');
    return `<a class="ghl-card ${v.online ? '' : 'off'}" href="/live?setup=${v.id}">
      <div class="ghl-head"><span class="ghl-sym">${ICON[v.symbol] || '📈'} ${esc(v.symbol)}</span>${riskBadge(v.risk)}<span class="ghl-dot ${v.online ? 'on' : ''}" title="${v.online ? 'online' : 'offline'}"></span></div>
      <div class="ghl-k">${TT('Profit sejak mulai', 'Profit since start')}</div>
      <div class="ghl-big"><span class="${cls(v.total_usd)}">${v.total_usd == null ? TT('menghitung…', 'counting…') : usd(v.total_usd)}</span>
        <span class="ghl-pct ${cls(v.total_pct)}">${v.total_pct == null ? '' : pct(v.total_pct)}</span></div>
      <div class="ghl-sub">${TT('Modal', 'Capital')} ${v.modal_usd == null ? '-' : usd(v.modal_usd, false)} · ${run(v.running)}</div>
      ${spark(v.spark, cur)}
      <div class="ghl-grid">
        <div><span>${TT('Hari ini', 'Today')}</span><b class="${cls(v.day)}">${usd(toUsd(v.day, cur))}</b></div>
        <div><span>${TT('DD terdalam', 'Max DD')}</span><b class="${v.max_dd_pct ? 'neg' : ''}">${v.max_dd_pct ? '-' + num(v.max_dd_pct, 2) + '%' : '0%'}</b></div>
        <div><span>${TT('Seri selesai', 'Closed series')}</span><b>${num(v.series || 0)}</b></div>
        <div><span>${TT('Basket terpanjang', 'Longest basket')}</span><b>${num(v.max_layers || 0)}</b></div>
      </div>
      <div class="ghl-foot"><span>BUY ${pos(v.buy)} · SELL ${pos(v.sell)}</span><span class="${cls(fl)}">${TT('floating', 'floating')} ${usd(fl)}</span></div>
      ${opts.cta === false ? '' : `<span class="ghl-cta">${TT('Lihat laporan live →', 'Open live report →')}</span>`}
    </a>`;
  }

  // an offer (pair x risk) on the landing: preset facts + its live monitoring account if it reports
  function offer(sym, risk, live) {
    const p = PRESET[sym], i = RISKS.indexOf(risk), h = p.hold[i];
    const R = RISK()[risk];
    const liveBox = live
      ? `<div class="ghl-live"><div class="row between" style="gap:6px"><span class="tiny muted">${TT('Akun pantau live', 'Live monitoring account')} <span class="ghl-dot ${live.online ? 'on' : ''}"></span></span><span class="tiny muted">${run(live.running)}</span></div>
          <div class="ghl-big" style="margin-top:2px"><span class="${cls(live.total_usd)}">${live.total_usd == null ? TT('menghitung…', 'counting…') : usd(live.total_usd)}</span><span class="ghl-pct ${cls(live.total_pct)}">${live.total_pct == null ? '' : pct(live.total_pct)}</span></div>
          <div class="tiny muted">${TT('DD terdalam', 'Max DD')} ${live.max_dd_pct ? '-' + num(live.max_dd_pct, 2) + '%' : '0%'} · ${TT('basket terpanjang', 'longest basket')} ${num(live.max_layers || 0)}</div></div>`
      : `<div class="ghl-live soon"><span class="tiny">⏳ ${TT('Akun pantau segera tayang di sini', 'Its monitoring account goes live here soon')}</span></div>`;
    return `<div class="ghl-offer r-${risk.toLowerCase()}">
      <div class="row between" style="gap:8px"><b class="ghl-oname">${R.name}</b><span class="badge ${R.cls}">${R.txt}</span></div>
      <dl class="ghl-dl">
        <dt>${TT('Lot pertama', 'First lot')}</dt><dd>0.01 ${TT('per', 'per')} ${usd(p.caps[i] / 100, false).replace(/[.,]00$/, '')} ${TT('modal, ikut balance', 'of capital, grows with balance')}</dd>
        <dt>${TT('Modal minimal', 'Min. capital')}</dt><dd>${usd(p.caps[i] / 100, false).replace(/[.,]00$/, '')} <small>(${num(p.caps[i])} USC)</small></dd>
        <dt>${TT('Tahan melawan', 'Withstands')}</dt><dd>${enNum(h[0])} <small>(−10%)</small> · ${enNum(h[2])} <small>(−50%)</small></dd>
        <dt>${TT('Jarak · TP', 'Step · TP')}</dt><dd>${enNum(p.dist)} · ${enNum(p.tp)}</dd>
      </dl>
      ${liveBox}
      <a class="btn ${live ? 'btn-gold' : 'btn-ghost'} btn-sm ghl-obtn" href="${live ? '/live?setup=' + live.id : '/live'}">${live ? TT('📡 Laporan live', '📡 Live report') : TT('Lihat semua live', 'See all live reports')}</a>
    </div>`;
  }

  let cache = null, cacheAt = 0;
  async function load(force) {
    if (!force && cache && Date.now() - cacheAt < 20000) return cache;
    const r = await fetch('/api/live', { credentials: 'same-origin' });
    cache = await r.json();
    cacheAt = Date.now();
    return cache;
  }
  const find = (setups, sym, risk) => (setups || []).find((x) => x.symbol === sym && x.risk === risk);

  const CSS = `
  .ghl-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}
  .ghl-card{display:block;border:1px solid var(--line);border-radius:16px;background:var(--card);padding:14px 16px;color:var(--text);text-decoration:none;min-width:0;transition:border-color .15s,transform .15s}
  .ghl-card:hover{border-color:var(--gold);transform:translateY(-2px)}
  .ghl-card.off{opacity:.8}
  .ghl-head{display:flex;align-items:center;gap:8px;margin-bottom:8px}
  .ghl-sym{font-weight:800;letter-spacing:.3px}
  .ghl-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#ff8b95;margin-left:auto;flex:none}
  .ghl-live .ghl-dot{margin-left:4px;vertical-align:middle}
  .ghl-dot.on{background:#6ee7a2;box-shadow:0 0 0 3px rgba(110,231,162,.18)}
  .ghl-k{color:var(--muted);font-size:.72rem;text-transform:uppercase;letter-spacing:.4px}
  .ghl-big{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;font-size:1.45rem;font-weight:800;line-height:1.25}
  .ghl-pct{font-size:.95rem;font-weight:700}
  .ghl-sub{color:var(--muted);font-size:.8rem;margin-top:2px}
  .ghl-spark{display:block;width:100%;height:34px;margin:8px 0 4px}
  .ghl-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 12px;margin-top:6px;font-size:.8rem}
  .ghl-grid span{display:block;color:var(--muted);font-size:.7rem}
  .ghl-grid b{font-weight:700}
  .ghl-foot{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;border-top:1px solid var(--line);margin-top:10px;padding-top:8px;font-size:.78rem;color:var(--muted)}
  .ghl-cta{display:block;margin-top:8px;color:var(--gold);font-weight:700;font-size:.82rem}
  .ghl-offers{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px}
  .ghl-offer{border:1px solid var(--line);border-radius:16px;background:var(--card);padding:16px;display:flex;flex-direction:column;gap:10px;min-width:0}
  .ghl-offer.r-low{border-top:3px solid #2ecc71}.ghl-offer.r-medium{border-top:3px solid var(--gold)}.ghl-offer.r-high{border-top:3px solid #ef4d5a}
  .ghl-oname{font-size:1.15rem;font-family:'Cinzel',serif}
  .ghl-dl{display:grid;grid-template-columns:auto 1fr;gap:4px 10px;margin:0;font-size:.84rem}
  .ghl-dl dt{color:var(--muted)} .ghl-dl dd{margin:0;overflow-wrap:anywhere} .ghl-dl small{color:var(--muted)}
  .ghl-live{border:1px dashed var(--line);border-radius:12px;padding:10px 12px;background:var(--bg-2)}
  .ghl-live.soon{color:var(--muted);text-align:center}
  .ghl-obtn{margin-top:auto;align-self:flex-start}
  .ghl-tabs{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-bottom:16px}
  .ghl-tabs button{border:1px solid var(--line);background:var(--bg-2);color:var(--text);border-radius:30px;padding:8px 14px;font-weight:700;font-size:.85rem;cursor:pointer}
  .ghl-tabs button.active{border-color:var(--gold);color:var(--gold);background:rgba(245,197,66,.08)}
  .pos{color:#6ee7a2} .neg{color:#ff8b95}`;
  if (typeof document !== 'undefined' && !document.getElementById('ghl-css')) {
    const st = document.createElement('style');
    st.id = 'ghl-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  return { TT, run, esc, toUsd, usd, num, pct, cls, days, riskBadge, NAME, ICON, PAIRS, PRESET, RISKS, RISK, spark, card, offer, load, find, enNum };
})();
