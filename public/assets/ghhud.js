// Hero "GARUDA AI ENGINE": a radar sweeps the pairs around the Garuda core, the basket engine below shows how the EA
// works a XAUUSD series (layers against the move, average, one TP from the average, close all), a log of the EA's
// reasoning and a ticker of the REAL showcase results (/api/live, event "ghl:live"). Two 2D canvases at ±30 fps,
// paused when off-screen or the tab is hidden, one still frame with "reduce motion". Pairs, layers and numbers in the
// drawing are illustrative (the panel says so).
(() => {
  const root = document.getElementById('aiHud');
  if (!root) return;
  const cvR = root.querySelector('.hud-radar'), cvB = root.querySelector('.hud-basket');
  const cR = cvR.getContext('2d'), cB = cvB.getContext('2d');
  const T = (id, en) => (typeof window.T === 'function' ? window.T(id, en) : id);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (id) => document.getElementById(id);
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (xs) => xs[(Math.random() * xs.length) | 0];
  const TAU = Math.PI * 2;
  const FONT = "'Poppins',sans-serif";
  const C = { gold: '245,197,66', green: '46,204,113', red: '239,77,90', blue: '77,163,255', orange: '255,159,67' };

  // glow sprites, made once (drawImage is far cheaper than shadowBlur)
  const glow = (rgb) => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, `rgba(${rgb},0.95)`); gr.addColorStop(0.3, `rgba(${rgb},0.38)`); gr.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return c;
  };
  const G = {}; for (const k in C) G[k] = glow(C[k]);
  const logo = new Image();
  logo.src = '/assets/brand/goldhunter-garuda-logo-256.png';

  // ---------- radar: pairs around the core ----------
  const FOCUS = ['XAUUSD', 'USDJPY'];
  const SYMS = ['XAUUSD', 'USDJPY', 'XAGUSD', 'EURUSD', 'GBPUSD', 'AUDCAD', 'US500', 'BTCUSD', 'GBPJPY', 'EURJPY', 'AUDUSD',
    'USDCAD', 'NZDUSD', 'USDCHF', 'CADJPY', 'EURGBP', 'AUDJPY', 'US30'];
  // spread evenly (golden angle, radii in 3 bands) and turning together, so the pairs never bunch up
  const nodes = SYMS.map((s, i) => ({
    s, focus: FOCUS.includes(s), a: i < 2 ? (i ? 3.6 : 0.5) : i * 2.39996 + rnd(-0.12, 0.12),
    r: i < 2 ? 0.55 : [0.34, 0.66, 0.9][i % 3] + rnd(-0.05, 0.05), w: 0.000035, ev: null, t: -1e9,
  }));
  // what the EA can be doing on a pair when the sweep passes it
  const EVENTS = [
    { k: 'tp', c: 'green', w: 3, tag: () => 'TP ✓' },
    { k: 'layer', c: 'gold', w: 4, tag: () => `L${(rnd(2, 6) | 0)}` },
    { k: 'news', c: 'blue', w: 1.4, tag: () => T('BERITA', 'NEWS') },
    { k: 'wild', c: 'orange', w: 1, tag: () => T('LIAR', 'WILD') },
    { k: 'ddr', c: 'red', w: 1, tag: () => 'DD−' },
    { k: 'pocket', c: 'gold', w: 1.2, tag: () => T('KANTONG', 'POCKET') },
  ];
  const evW = EVENTS.reduce((a, e) => a + e.w, 0);
  const pickEv = () => { let x = Math.random() * evW; for (const e of EVENTS) if ((x -= e.w) <= 0) return e; return EVENTS[0]; };

  let RW = 0, RH = 0, cx = 0, cy = 0, rx = 0, ry = 0, BW = 0, BH = 0, grid = null, dpr = 1;
  function fit(cv, ctx) {
    const b = cv.getBoundingClientRect();
    cv.width = Math.round(b.width * dpr); cv.height = Math.round(b.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return [b.width, b.height];
  }
  function size() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    [RW, RH] = fit(cvR, cR);
    [BW, BH] = fit(cvB, cB);
    cx = RW / 2; cy = RH / 2; rx = RW / 2 - 26; ry = RH / 2 - 18;
    // static background (grid + rings + cross) drawn once per size
    grid = document.createElement('canvas');
    grid.width = cvR.width; grid.height = cvR.height;
    const g = grid.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.strokeStyle = 'rgba(163,163,178,0.055)'; g.lineWidth = 1;
    for (let x = 0.5; x < RW; x += 22) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, RH); g.stroke(); }
    for (let y = 0.5; y < RH; y += 22) { g.beginPath(); g.moveTo(0, y); g.lineTo(RW, y); g.stroke(); }
    for (const k of [0.33, 0.66, 1]) {
      g.strokeStyle = `rgba(${C.gold},${k === 1 ? 0.16 : 0.1})`;
      g.beginPath(); g.ellipse(cx, cy, rx * k, ry * k, 0, 0, TAU); g.stroke();
    }
    g.strokeStyle = `rgba(${C.gold},0.06)`;
    g.beginPath(); g.moveTo(cx - rx, cy); g.lineTo(cx + rx, cy); g.moveTo(cx, cy - ry); g.lineTo(cx, cy + ry); g.stroke();
    // tick marks on the outer ring
    g.strokeStyle = `rgba(${C.gold},0.22)`;
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * TAU, l = i % 6 ? 3 : 7;
      g.beginPath(); g.moveTo(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry);
      g.lineTo(cx + Math.cos(a) * (rx - l), cy + Math.sin(a) * (ry - l * ry / rx)); g.stroke();
    }
  }
  const xy = (n) => [cx + Math.cos(n.a) * n.r * rx, cy + Math.sin(n.a) * n.r * ry];

  // ---------- log + numbers ----------
  const wibNow = () => new Date(Date.now() + 7 * 3600_000);
  const hhmmss = () => wibNow().toISOString().slice(11, 19);
  const clock = () => { $('hudClock').textContent = `${hhmmss()} WIB`; };
  const logBox = $('hudLog');
  let lastLog = 0;
  function log(html, kind = '') {
    const el = document.createElement('div');
    el.className = `hl ${kind}`;
    el.innerHTML = `<span class="ts">${hhmmss()}</span> ${html}`;
    logBox.prepend(el);
    while (logBox.children.length > 4) logBox.lastChild.remove();
    lastLog = performance.now();
  }
  let modeUntil = 0;
  const SHORT = { 'MARKET LIAR': 'LIAR', 'WILD MARKET': 'WILD', 'BASKET BUY': 'BUY ▲', 'BASKET SELL': 'SELL ▼' };
  function mode(txt, cls, ms) {
    const el = $('hudMode');
    el.textContent = root.clientWidth < 420 && SHORT[txt] ? SHORT[txt] : txt; el.className = cls;
    modeUntil = ms ? performance.now() + ms : 0;
  }
  const thinking = () => pick([
    T('Membaca <b>kalender berita MT5</b> 7 hari ke depan…', 'Reading the <b>MT5 news calendar</b> for the next 7 days…'),
    T('Menghitung <b>rata-rata</b> & target TP basket BUY dan SELL…', 'Computing the <b>average</b> & TP target of the BUY and SELL baskets…'),
    T('Membaca arah <b>EMA tren</b> & <b>SMA</b> sesuai mode…', 'Reading the <b>EMA trend</b> & <b>SMA</b> for the mode…'),
    T('Spread, margin & DD akun: <b>terpantau</b>', 'Spread, margin & account DD: <b>monitored</b>'),
    T('Mengukur jarak layer dari volatilitas terkini…', 'Sizing the layer distance from current volatility…'),
    T('Cek TP tiap posisi di server broker: <b>lengkap</b>', 'Checking every position\'s TP at the broker: <b>complete</b>'),
  ]);
  function onEvent(n, ev) {
    const s = `<b>${n.s}</b>`;
    if (ev.k === 'tp') log(`${s} · ${T('harga sampai target dari rata-rata', 'price reached the target from the average')} → <span class="ok">${T('TUTUP SEMUA', 'CLOSE ALL')} ✓</span>`, 'pass');
    else if (ev.k === 'layer') log(`${s} · ${T('harga melawan 1× jarak', 'price moved 1× distance against')} → ${T('tambah', 'add')} <b>${ev.tag}</b> · ${T('rata-rata ikut bergeser', 'average follows')}`);
    else if (ev.k === 'news') { log(`${s} · ${T('berita dampak tinggi mendekat', 'high-impact news ahead')} → <span class="nw">${T('mode berita', 'news mode')}</span>`); mode(T('BERITA', 'NEWS'), 'blue', 6000); }
    else if (ev.k === 'wild') { log(`${s} · <span class="wd">${T('market liar terdeteksi', 'wild market detected')}</span> → ${T('seri cepat, TP kecil', 'fast series, small TP')}`); mode(T('MARKET LIAR', 'WILD MARKET'), 'orange', 6000); }
    else if (ev.k === 'ddr') log(`${s} · ${T('basket panjang', 'long basket')} → <b>DD reduction</b>: ${T('layer tertua ditutup', 'oldest layer closed')}`);
    else log(`${s} · TP → <b>${T('kantong profit', 'profit pocket')}</b> ${T('menabung untuk memangkas basket', 'saves to trim baskets')}`);
  }
  function onScan(n, now) {
    if (n.ev && now - n.t < 6000) return;
    const busy = n.focus ? 0.55 : 0.2;
    // at most 3 pairs lit at once and never right next to a lit one, so the labels stay readable
    const [x, y] = xy(n);
    const lit = nodes.filter((m) => m !== n && m.ev && now - m.t < 4500);
    const near = lit.some((m) => { const [mx, my] = xy(m); return (mx - x) ** 2 + (my - y) ** 2 < 70 * 70; });
    if (Math.random() > busy || lit.length >= 3 || near) { n.ev = null; n.t = now; return; }
    const e = pickEv();
    n.ev = { k: e.k, c: e.c, tag: e.tag() };
    n.t = now;
    if (e.k === 'tp' || e.k === 'pocket') pulses.push({ n, p: 0, c: e.c });
    if (now - lastLog > 700) onEvent(n, n.ev);
  }

  // ---------- radar drawing ----------
  let sweep = rnd(0, TAU), prevSweep = sweep;
  const pulses = [];
  const norm = (v) => ((v % TAU) + TAU) % TAU;
  function drawRadar(now, dt) {
    prevSweep = sweep;
    sweep = norm(sweep + dt * 0.00105);           // one turn ±6 s
    const ctx = cR;
    ctx.clearRect(0, 0, RW, RH);
    if (grid) ctx.drawImage(grid, 0, 0, RW, RH);
    // sweep wedge
    for (let k = 0; k < 26; k++) {
      const a = sweep - k * 0.026;
      ctx.strokeStyle = `rgba(${C.gold},${(0.34 * (1 - k / 26)).toFixed(3)})`;
      ctx.lineWidth = k === 0 ? 1.8 : 1;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry); ctx.stroke();
    }
    const P = nodes.map((n) => {
      n.a = norm(n.a + n.w * dt);
      if (dt > 0 && dt < 200 && norm(prevSweep - n.a) > norm(sweep - n.a)) onScan(n, now);
      return xy(n);
    });
    // neural mesh between nearby pairs
    ctx.lineWidth = 1;
    for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
      const dx = P[i][0] - P[j][0], dy = P[i][1] - P[j][1], d2 = dx * dx + dy * dy;
      if (d2 < 4200) { ctx.strokeStyle = `rgba(163,163,178,${(0.13 * (1 - d2 / 4200)).toFixed(3)})`; ctx.beginPath(); ctx.moveTo(P[i][0], P[i][1]); ctx.lineTo(P[j][0], P[j][1]); ctx.stroke(); }
    }
    // focus pairs: always wired to the core
    nodes.forEach((n, i) => {
      if (!n.focus) return;
      ctx.strokeStyle = `rgba(${C.gold},0.22)`; ctx.setLineDash([3, 5]);
      ctx.beginPath(); ctx.moveTo(P[i][0], P[i][1]); ctx.lineTo(cx, cy); ctx.stroke(); ctx.setLineDash([]);
    });
    // active pairs: line to the core
    nodes.forEach((n, i) => {
      const age = now - n.t;
      if (n.ev && age < 4500) {
        ctx.strokeStyle = `rgba(${C[n.ev.c]},${(0.55 * (1 - age / 4500)).toFixed(3)})`; ctx.lineWidth = 1.3;
        ctx.beginPath(); ctx.moveTo(P[i][0], P[i][1]); ctx.lineTo(cx, cy); ctx.stroke();
      }
    });
    // data pulses flowing into the core
    for (let k = pulses.length - 1; k >= 0; k--) {
      const q = pulses[k];
      q.p += dt / 1000;
      if (q.p >= 1) { pulses.splice(k, 1); continue; }
      const [x, y] = xy(q.n);
      ctx.drawImage(G[q.c], x + (cx - x) * q.p - 10, y + (cy - y) * q.p - 10, 20, 20);
    }
    // pair dots + labels
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    nodes.forEach((n, i) => {
      const [x, y] = P[i], age = now - n.t;
      const hot = n.ev && age < 4500;
      if (hot) {
        const s = 28 + 7 * Math.sin(now / 170);
        ctx.drawImage(G[n.ev.c], x - s / 2, y - s / 2, s, s);
      } else if (n.focus) ctx.drawImage(G.gold, x - 9, y - 9, 18, 18);
      ctx.fillStyle = hot ? `rgb(${C[n.ev.c]})` : n.focus ? `rgb(${C.gold})` : 'rgba(210,210,222,0.55)';
      ctx.beginPath(); ctx.arc(x, y, hot ? 3.4 : n.focus ? 3 : 2.1, 0, TAU); ctx.fill();
      ctx.font = hot || n.focus ? `700 ${n.focus ? 10.5 : 10}px ${FONT}` : `500 8.5px ${FONT}`;
      ctx.fillStyle = hot ? `rgba(${C[n.ev.c]},0.95)` : n.focus ? 'rgba(255,241,184,0.9)' : 'rgba(163,163,178,0.5)';
      if (hot) { ctx.textBaseline = 'bottom'; ctx.fillText(`${n.s} ${n.ev.tag}`, x, y - 6); ctx.textBaseline = 'top'; }
      else ctx.fillText(n.s, x, y + 5);
    });
    // core: Garuda + pulsing glow + counter-rotating orbits
    const pr = 17 + 2.6 * Math.sin(now / 320);
    ctx.drawImage(G.gold, cx - pr * 2.8, cy - pr * 2.8, pr * 5.6, pr * 5.6);
    ctx.fillStyle = '#0b0b10'; ctx.beginPath(); ctx.arc(cx, cy, 17, 0, TAU); ctx.fill();
    ctx.strokeStyle = `rgb(${C.gold})`; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(cx, cy, 17, 0, TAU); ctx.stroke();
    if (logo.complete && logo.naturalWidth) ctx.drawImage(logo, cx - 14, cy - 14, 28, 28);
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(now / 950);
    ctx.setLineDash([4, 6]); ctx.strokeStyle = `rgba(${C.gold},0.55)`; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(0, 0, 34, 21, 0, 0, TAU); ctx.stroke();
    ctx.rotate(-now / 470); ctx.beginPath(); ctx.ellipse(0, 0, 24, 36, 0, 0, TAU); ctx.stroke();
    ctx.setLineDash([]); ctx.restore();
    // orbiting satellite on the inner orbit
    const sa = now / 700;
    ctx.drawImage(G.gold, cx + Math.cos(sa) * 34 - 6, cy + Math.sin(sa) * 21 - 6, 12, 12);
  }

  // ---------- basket engine (XAUUSD, in points) ----------
  const DIST = 100, TPD = 60, STEP_MS = 85, N = 190;
  const B = { side: 1, layers: [], hist: [], p: 0, turnAt: 3, closed: null, lo: -150, hi: 150, sampleAcc: 0, wait: 0 };
  const nextLot = () => {
    const L = B.layers;
    if (!L.length) return 0.01;
    const last = L[L.length - 1].lot;
    const same = L.filter((x) => x.lot === last).length;
    return same < 2 ? last : Math.max(last + 0.01, Math.round(last * 1.5 * 100) / 100);
  };
  const lots = () => B.layers.reduce((a, x) => a + x.lot, 0);
  const avg = () => B.layers.reduce((a, x) => a + x.lot * x.p, 0) / Math.max(1e-9, lots());
  const tpLine = () => avg() + B.side * TPD;
  const floating = () => B.layers.reduce((a, x) => a + x.lot * (B.p - x.p) * B.side, 0);   // $1 per point per lot (XAU 100 oz)
  const usd = (v) => `${v >= 0 ? '+' : '−'}$${Math.abs(v).toFixed(2)}`;
  const sideTxt = () => (B.side > 0 ? 'BUY' : 'SELL');
  function bkHead() {
    const el = $('hudBk');
    if (B.closed) { el.innerHTML = `<span class="pos">${T('TUTUP SEMUA', 'CLOSE ALL')} ✓ ${usd(B.closed.usd)}</span>`; return; }
    const f = floating();
    el.innerHTML = `${sideTxt()} · ${B.layers.length} layer · ${lots().toFixed(2)} lot · <span class="${f >= 0 ? 'pos' : 'neg'}">${usd(f)}</span>`;
  }
  function newSeries() {
    B.side = Math.random() < 0.5 ? 1 : -1;
    B.layers = [{ p: B.p, lot: 0.01, i: B.hist.length }];
    B.turnAt = (rnd(2, 5.2)) | 0;
    B.closed = null;
    if (!modeUntil) mode(`BASKET ${sideTxt()}`, 'gold');
    log(`<b>XAUUSD</b> · ${T('seri baru', 'new series')} <b>${sideTxt()}</b> 0.01 · TP ${TPD} ${T('poin dari rata-rata', 'points from the average')}`);
  }
  function stepBasket() {
    if (B.closed) {
      if (--B.wait <= 0) newSeries();
      B.p += rnd(-4, 4);
    } else {
      // against the series until the turn layer, then the move comes back (illustration of a series end to end)
      const against = B.layers.length < B.turnAt;
      const drift = (against ? -2.3 : 2.9) * B.side;
      B.p += drift + rnd(-7, 7);
      const last = B.layers[B.layers.length - 1];
      if (B.layers.length < 7 && (B.p - last.p) * B.side <= -DIST) {
        const lot = nextLot();
        B.layers.push({ p: B.p, lot, i: B.hist.length });
        log(`<b>XAUUSD</b> · ${T('harga melawan', 'price against')} ${DIST} ${T('poin', 'points')} → <b>L${B.layers.length}</b> ${lot.toFixed(2)} lot · ${T('rata-rata ikut', 'average follows')}`);
      }
      if ((B.p - tpLine()) * B.side >= 0) {
        const won = floating();
        B.closed = { usd: won, at: B.hist.length };
        B.wait = 22;
        log(`<b>XAUUSD</b> · ${B.layers.length} layer ${sideTxt()} → <span class="ok">${T('TUTUP SEMUA', 'CLOSE ALL')} ✓ ${usd(won)}</span>`, 'pass');
        if (!modeUntil) mode(T('TP ✓', 'TP ✓'), 'green', 2500);
      }
    }
    B.hist.push(B.p);
    if (B.hist.length > N) {
      B.hist.shift();
      B.layers.forEach((x) => x.i--);
      if (B.closed) B.closed.at--;
    }
  }
  function drawBasket() {
    const ctx = cB;
    ctx.clearRect(0, 0, BW, BH);
    const padL = 6, padR = 64, top = 8, bot = BH - 8;
    const H = B.hist;
    // vertical range follows price, layers and TP, eased so it never jumps
    let lo = Math.min(...H), hi = Math.max(...H);
    if (B.layers.length && !B.closed) { const ps = B.layers.map((x) => x.p).concat(tpLine()); lo = Math.min(lo, ...ps); hi = Math.max(hi, ...ps); }
    const pad = Math.max(30, (hi - lo) * 0.12);
    B.lo += (lo - pad - B.lo) * 0.08; B.hi += (hi + pad - B.hi) * 0.08;
    const Y = (v) => bot - ((v - B.lo) / Math.max(1, B.hi - B.lo)) * (bot - top);
    const X = (i) => padL + (i / (N - 1)) * (BW - padL - padR);
    // grid
    ctx.strokeStyle = 'rgba(163,163,178,0.06)'; ctx.lineWidth = 1;
    for (let y = top; y <= bot; y += (bot - top) / 4) { ctx.beginPath(); ctx.moveTo(0, Math.round(y) + 0.5); ctx.lineTo(BW, Math.round(y) + 0.5); ctx.stroke(); }
    ctx.font = `600 9px ${FONT}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    const hline = (v, rgb, a, label, dash) => {
      const y = Math.round(Y(v)) + 0.5;
      ctx.strokeStyle = `rgba(${rgb},${a})`; ctx.setLineDash(dash || []);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(BW - padR + 4, y); ctx.stroke(); ctx.setLineDash([]);
      if (label) { ctx.fillStyle = `rgba(${rgb},0.95)`; ctx.fillText(label, BW - padR + 8, y); }
    };
    if (B.layers.length && !B.closed) {
      B.layers.forEach((x, k) => hline(x.p, C.gold, 0.22, null, [2, 4]));
      hline(avg(), C.blue, 0.75, T('RATA²', 'AVG'), [5, 4]);
      hline(tpLine(), C.green, 0.85, 'TP', [5, 4]);
    }
    // price path with a soft fill
    const grad = ctx.createLinearGradient(0, top, 0, bot);
    grad.addColorStop(0, `rgba(${C.gold},0.20)`); grad.addColorStop(1, `rgba(${C.gold},0)`);
    ctx.beginPath(); H.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))));
    ctx.lineTo(X(H.length - 1), bot); ctx.lineTo(X(0), bot); ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
    ctx.beginPath(); H.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))));
    ctx.strokeStyle = `rgb(${C.gold})`; ctx.lineWidth = 1.6; ctx.stroke();
    // layer markers
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.font = `700 8.5px ${FONT}`;
    if (!B.closed) B.layers.forEach((x, k) => {
      if (x.i < 0) return;
      const px = X(x.i), py = Y(x.p);
      ctx.drawImage(G.gold, px - 8, py - 8, 16, 16);
      ctx.fillStyle = B.side > 0 ? `rgb(${C.green})` : `rgb(${C.red})`;
      ctx.beginPath(); ctx.arc(px, py, 3, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,241,184,0.9)';
      ctx.fillText(`L${k + 1}`, px, py - 5);
    });
    // close-all flash
    if (B.closed && B.closed.at >= 0) {
      const px = X(B.closed.at), a = Math.max(0, B.wait / 22);
      ctx.fillStyle = `rgba(${C.green},${(0.16 * a).toFixed(3)})`; ctx.fillRect(px - 26, top, 52, bot - top);
      ctx.drawImage(G.green, px - 18, Y(H[B.closed.at]) - 18, 36, 36);
    }
    // current price tag
    const ly = Y(B.p), lx = X(H.length - 1);
    ctx.drawImage(G.gold, lx - 10, ly - 10, 20, 20);
    ctx.fillStyle = '#fff1b8'; ctx.beginPath(); ctx.arc(lx, ly, 2.6, 0, TAU); ctx.fill();
  }

  // ---------- run / pause ----------
  let running = false, visible = true, last = 0, raf = 0, lastDraw = 0;
  function frame(now, dt) {
    drawRadar(now, dt);
    B.sampleAcc += dt;
    while (B.sampleAcc >= STEP_MS) { B.sampleAcc -= STEP_MS; stepBasket(); }
    drawBasket();
    bkHead();
    if (modeUntil && now > modeUntil) { modeUntil = 0; mode(B.closed ? 'TP ✓' : `BASKET ${sideTxt()}`, B.closed ? 'green' : 'gold'); }
  }
  function loop(now) {
    raf = requestAnimationFrame(loop);
    if (now - lastDraw < 32) return;              // ±30 fps is plenty and saves battery
    const dt = Math.min(100, last ? now - last : 16);
    last = now; lastDraw = now;
    frame(now, dt);
    if (now - lastLog > 3200) log(thinking(), 'think');
  }
  function setRun() {
    const want = visible && !document.hidden && !reduce;
    if (want === running) return;
    running = want;
    if (running) { last = 0; raf = requestAnimationFrame(loop); } else cancelAnimationFrame(raf);
  }
  new IntersectionObserver((es) => { visible = es[0].isIntersecting; setRun(); }, { rootMargin: '80px' }).observe(root);
  document.addEventListener('visibilitychange', setRun);
  let rt = 0;
  // the radar follows its box (window size, fonts, language switch change the hero height)
  new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(() => { size(); if (!running) frame(performance.now(), 0); }, 120); }).observe(cvR.parentElement);
  addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { size(); if (!running) frame(performance.now(), 0); }, 150); });

  // warm start: a series already in progress so the first frame is never empty
  for (let i = 0; i < N; i++) { B.p += rnd(-6, 6); B.hist.push(B.p); }
  B.layers = [{ p: B.p, lot: 0.01, i: N - 1 }];
  B.side = 1; B.turnAt = 4;
  for (let i = 0; i < 70; i++) stepBasket();
  logBox.innerHTML = '';                          // no log lines from the pre-simulation
  size();
  clock();
  setInterval(clock, 1000);
  mode(`BASKET ${sideTxt()}`, 'gold');
  log(thinking(), 'think');
  if (reduce) {
    const now = performance.now();
    nodes.slice(0, 4).forEach((n, i) => { const e = EVENTS[i]; n.ev = { k: e.k, c: e.c, tag: e.tag() }; n.t = now; });
    logo.onload = () => frame(performance.now(), 0);
    frame(now, 0);
  }
  setRun();

  // ticker of the REAL showcase results (only accounts the admin chose)
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function ticker(list) {
    const box = $('hudReal');
    const rows = (list || []).filter((v) => v.total_usd != null);
    if (!box || !rows.length || !window.GHL) { if (box) box.hidden = true; return; }
    const items = rows.slice(0, 10).map((v) => `<span><b>${esc(v.label || v.symbol)}</b> <i class="${v.total_usd >= 0 ? 'pos' : 'neg'}">${GHL.usd(v.total_usd)}</i>${v.total_pct == null ? '' : ` <small>${GHL.pct(v.total_pct)}</small>`}</span>`).join('');
    box.querySelector('.tk').innerHTML = items + items;  // doubled so it scrolls without a gap
    box.hidden = false;
  }
  // language switched after load (button or visitor country): restart the texts in the new language
  document.addEventListener('ghg:lang', () => {
    logBox.innerHTML = '';
    nodes.forEach((n) => { n.ev = null; });
    if (!modeUntil) mode(`BASKET ${sideTxt()}`, 'gold');
    log(thinking(), 'think');
  });
  window.addEventListener('ghl:live', (e) => ticker(e.detail));
  if (window.GHL_LIVE) ticker(window.GHL_LIVE);
})();
