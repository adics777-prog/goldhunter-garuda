// GOLD HUNTER GARUDA live: shared rendering of the EA instances, one per chart (landing, /live, member area). i18n.js (T) optional.
const GHL = (() => {
  const TT = (id, en) => (typeof window.T === 'function' ? window.T(id, en) : id);
  // name of the current month (WIB): "Bulan Oktober" / "October" instead of "this month"
  const MID = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const MEN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const monthIdx = () => { try { return Number(new Intl.DateTimeFormat('en-US', { month: 'numeric', timeZone: 'Asia/Jakarta' }).format(new Date())) - 1; } catch { return new Date().getMonth(); } };
  const monthLabel = (lower) => { const m = monthIdx(); return TT((lower ? 'bulan ' : 'Bulan ') + MID[m], MEN[m]); };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const loc = () => TT('id-ID', 'en-US');
  const isCent = (cur) => ['USC', 'USX', 'UST', 'CNT'].includes(String(cur || '').toUpperCase());
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
  const NAME = () => ({ XAUUSD: TT('Emas', 'Gold'), BTCUSD: 'Bitcoin', EURUSD: 'Euro / Dolar', USDJPY: TT('Dolar / Yen', 'Dollar / Yen'), US500: TT('Indeks S&P 500', 'S&P 500 index') });
  const ICON = { XAUUSD: '🥇', BTCUSD: '₿', EURUSD: '💶', USDJPY: '💴', US500: '📊' };
  const PAIRS = ['XAUUSD', 'USDJPY', 'BTCUSD', 'EURUSD'];   // focus pairs first

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

  // one EA instance (chart) on the overview / landing / member home: closed results first, floating only on the detail page
  function card(v, opts = {}) {
    const cur = v.currency;
    const fresh = v.total_usd == null;
    const tile = (k, val, c) => `<div class="ghl-tile"><span>${k}</span><b class="${c}">${val}</b></div>`;
    const dd = v.max_dd_pct ? '-' + num(v.max_dd_pct, 2) + '%' : '0%';
    return `<a class="ghl-card ${v.online ? '' : 'off'}" href="/live?setup=${v.id}">
      <div class="ghl-head">
        <span class="ghl-ico">${ICON[v.symbol] || '📈'}</span>
        <span class="ghl-id"><b class="ghl-sym">${esc(v.label || v.symbol)}</b><small>${esc((NAME()[v.symbol] || v.symbol) + (v.account ? ' · ' + v.account : ''))}</small></span>
        <span class="ghl-live ${v.online ? 'on' : ''}"><i></i>${v.online ? 'LIVE' : 'OFFLINE'}</span>
      </div>
      <div class="ghl-hero">
        <div class="ghl-k">${TT('Profit tertutup sejak mulai', 'Closed profit since start')}</div>
        <div class="ghl-big"><span class="${fresh ? 'ghl-wait' : cls(v.total_usd)}">${fresh ? TT('menunggu data…', 'waiting for data…') : usd(v.total_usd)}</span>
          ${v.total_pct == null ? '' : `<span class="ghl-pill ${cls(v.total_pct)}">${pct(v.total_pct)}</span>`}</div>
        <div class="ghl-sub">${v.modal_kind === 'budget' ? TT('Anggaran', 'Budget') : TT('Modal', 'Capital')} <b>${v.modal_usd == null ? '-' : usd(v.modal_usd, false)}</b> · ${run(v.running)}</div>
      </div>
      ${spark(v.spark, cur)}
      <div class="ghl-tiles">
        ${tile(TT('Hari ini', 'Today'), usd(toUsd(v.day, cur)) + (v.day_pct == null ? '' : ` <small>${pct(v.day_pct)}</small>`), cls(v.day))}
        ${tile(TT('Kemarin', 'Yesterday'), v.yday == null ? '-' : usd(v.yday_usd != null ? v.yday_usd : toUsd(v.yday, cur)) + (v.yday_pct == null ? '' : ` <small>${pct(v.yday_pct)}</small>`), cls(v.yday || 0))}
        ${tile(monthLabel(), usd(v.month_usd != null ? v.month_usd : toUsd(v.month, cur)) + (v.month_pct == null ? '' : ` <small>${pct(v.month_pct)}</small>`), cls(v.month))}
        ${tile(TT('DD terdalam', 'Max DD'), dd, v.max_dd_pct ? 'neg' : '')}
      </div>
      <div class="ghl-meta"><span>${TT('Basket terpanjang', 'Longest basket')} <b>${num(v.max_layers || 0)} layer</b></span><span>${TT('Seri selesai', 'Closed series')} <b>${num(v.series || 0)}</b></span></div>
      ${v.verified ? `<div class="ghl-ver">✓ ${TT('Akun riil MT5 · terverifikasi', 'Real MT5 account · verified')} · ${num(v.deals)} ${TT('transaksi', 'deals')}${v.server ? ' · ' + esc(v.server) : ''}</div>` : ''}
      ${opts.cta === false ? '' : `<span class="ghl-cta">${TT('Lihat laporan live', 'Open live report')} <span aria-hidden="true">→</span></span>`}
    </a>`;
  }

  // JSON with a time limit and quiet retries (slow phone networks); error.status = the HTTP status
  async function fetchJson(url, tries = 3) {
    let last;
    for (let i = 0; i < tries; i++) {
      const ac = typeof AbortController === 'function' ? new AbortController() : null;
      const to = ac ? setTimeout(() => ac.abort(), 12000) : 0;
      try {
        const r = await fetch(url, { credentials: 'same-origin', signal: ac ? ac.signal : undefined });
        const d = await r.json().catch(() => null);
        clearTimeout(to);
        if (r.ok && d) return d;
        last = Object.assign(new Error((d && d.error) || 'HTTP ' + r.status), { status: r.status });
        if (r.status >= 400 && r.status < 500) throw last;          // not found / not allowed: no retry
      } catch (e) {
        clearTimeout(to);
        last = e;
        if (e && e.status >= 400 && e.status < 500) throw e;
      }
      if (i + 1 < tries) await new Promise((r) => setTimeout(r, 1200 * (i + 1)));
    }
    throw last || new Error('network');
  }
  // last data seen on this device (shown at once on the next visit, then replaced by the fresh one)
  const stash = (k, d) => { try { localStorage.setItem(k, JSON.stringify({ t: Date.now(), d })); } catch (e) { /* private mode */ } };
  const unstash = (k, maxMs = 3 * 864e5) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v && Date.now() - v.t < maxMs ? v.d : null; } catch (e) { return null; } };
  // shimmering placeholder cards while the data loads
  const skeleton = (n = 3) => Array.from({ length: n }, () => '<div class="skel" aria-hidden="true"><span class="sk h"></span><span class="sk w60"></span><span class="sk box"></span><span class="sk w80"></span><span class="sk w40"></span></div>').join('');
  let cache = null, cacheAt = 0;
  async function load(force) {
    if (!force && cache && Date.now() - cacheAt < 20000) return cache;
    try {
      cache = await fetchJson('/api/live');
      cacheAt = Date.now();
      stash('ghg_live_ov', cache);
    } catch (e) {
      if (!cache) cache = unstash('ghg_live_ov');
      if (!cache) throw e;                                 // nothing to show yet: the caller keeps its placeholders
    }
    return cache;
  }

  const CSS = `
  .ghl-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}
  .ghl-card{position:relative;display:flex;flex-direction:column;gap:10px;border:1px solid var(--line);border-radius:18px;padding:16px 16px 14px;color:var(--text);text-decoration:none;min-width:0;overflow:hidden;
    background:radial-gradient(120% 70% at 100% 0%,rgba(245,197,66,.10),transparent 60%),linear-gradient(180deg,rgba(255,255,255,.025),transparent 40%),var(--card);
    box-shadow:0 10px 30px rgba(0,0,0,.25);transition:border-color .2s,transform .2s,box-shadow .2s}
  .ghl-card::before{content:"";position:absolute;inset:0 0 auto 0;height:3px;background:linear-gradient(90deg,#b8860b,#f5c542,#fff1b8,#f5c542,#b8860b)}
  .ghl-card:hover{border-color:rgba(245,197,66,.6);transform:translateY(-3px);box-shadow:0 16px 38px rgba(0,0,0,.35)}
  .ghl-card.off{opacity:.82}
  .ghl-head{display:flex;align-items:center;gap:10px;min-width:0}
  .ghl-ico{flex:none;display:grid;place-items:center;width:38px;height:38px;border-radius:50%;font-size:1.15rem;background:radial-gradient(circle at 30% 30%,rgba(245,197,66,.35),rgba(245,197,66,.08));border:1px solid rgba(245,197,66,.45)}
  .ghl-id{display:flex;flex-direction:column;min-width:0;line-height:1.2}
  .ghl-sym{font-weight:800;letter-spacing:.4px;font-size:1.02rem}
  .ghl-id small{color:var(--muted);font-size:.74rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ghl-live{margin-left:auto;flex:none;display:inline-flex;align-items:center;gap:6px;padding:4px 9px;border-radius:30px;font-size:.66rem;font-weight:800;letter-spacing:.8px;color:#ff8b95;background:rgba(255,139,149,.1);border:1px solid rgba(255,139,149,.3)}
  .ghl-live i{width:7px;height:7px;border-radius:50%;background:currentColor}
  .ghl-live.on{color:#6ee7a2;background:rgba(110,231,162,.1);border-color:rgba(110,231,162,.35)}
  .ghl-live.on i{animation:ghlPulse 1.8s ease-out infinite}
  @keyframes ghlPulse{0%{box-shadow:0 0 0 0 rgba(110,231,162,.6)}100%{box-shadow:0 0 0 7px rgba(110,231,162,0)}}
  .ghl-hero{padding:2px 0}
  .ghl-k{color:var(--muted);font-size:.68rem;text-transform:uppercase;letter-spacing:.6px}
  .ghl-big{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:1.7rem;font-weight:800;line-height:1.2;margin-top:2px}
  .ghl-wait{font-size:1.05rem;color:var(--muted);font-weight:700}
  .ghl-pill{font-size:.78rem;font-weight:800;padding:3px 8px;border-radius:30px;background:rgba(255,255,255,.06)}
  .ghl-pill.pos{background:rgba(110,231,162,.12)} .ghl-pill.neg{background:rgba(255,139,149,.12)}
  .ghl-sub{color:var(--muted);font-size:.78rem;margin-top:3px}
  .ghl-sub b{color:var(--text);font-weight:700}
  .ghl-spark{display:block;width:100%;height:38px;border-radius:8px;background:rgba(255,255,255,.02)}
  .ghl-tiles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
  .ghl-tile{border:1px solid var(--line);border-radius:12px;padding:8px 9px;background:rgba(255,255,255,.025);min-width:0}
  .ghl-tile span{display:block;color:var(--muted);font-size:.64rem;text-transform:uppercase;letter-spacing:.4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ghl-tile b{display:block;font-size:.95rem;font-weight:800;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ghl-tile b small{font-size:.72rem;font-weight:700;opacity:.85}
  .ghl-meta{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;font-size:.76rem;color:var(--muted)}
  .ghl-meta b{color:var(--text)}
  .ghl-ver{margin-top:8px;font-size:.74rem;font-weight:600;color:#6ee7a2;border:1px solid rgba(46,204,113,.35);background:rgba(46,204,113,.07);border-radius:9px;padding:5px 9px;overflow-wrap:anywhere}
  .ghl-cta{display:flex;align-items:center;justify-content:center;gap:6px;margin-top:2px;padding:9px 12px;border-radius:12px;font-weight:800;font-size:.84rem;color:#1a1306;background:linear-gradient(90deg,#d4a017,#f5c542);transition:filter .2s}
  .ghl-card:hover .ghl-cta{filter:brightness(1.08)}
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
  return { TT, monthLabel, fetchJson, stash, unstash, skeleton, run, esc, toUsd, usd, num, pct, cls, days, NAME, ICON, PAIRS, spark, card, load };
})();
