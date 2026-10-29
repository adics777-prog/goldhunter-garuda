// "EA at work": a live XAUUSD-style chart that shows how GOLD HUNTER GARUDA works a market, end to end. Candles form
// tick by tick; BUY / SELL series open in the EMA trend direction, marty layers are added at growing distances with
// growing lots, the average and the shared TP follow, the basket closes at TP; DD reduction, the profit pocket, a trend
// flip (opposite side held) and a trailing step are shown in a fixed order every ±35 s loop, and every loop ends flat
// and in profit. ILLUSTRATION ONLY: the price path is scripted (seeded), the numbers are not trading results.
// Fills every <figure data-ghsim> (canvas + caption + chips are in the HTML, so data-en works). One rAF loop at
// ±30 fps, DPR-aware, lazy (IntersectionObserver), paused off-screen / tab hidden, a still frame with "reduce motion".
(() => {
  const T = (id, en) => (typeof window.T === 'function' ? window.T(id, en) : id);
  const TAU = Math.PI * 2;
  const FONT = "'Poppins',system-ui,sans-serif";
  const C = {
    gold: '245,197,66', green: '46,204,113', red: '239,77,90', blue: '77,163,255', orange: '255,159,67',
    cyan: '86,214,214', violet: '155,123,255', pink: '255,139,149', muted: '163,163,178',
  };

  // ---------- engine (pure, seeded) ----------
  const CFG = {
    tickMs: 70, ct: 12,                                  // 12 ticks per candle (±0.84 s)
    q: [5, 6, 7, 8, 9, 10, 12],                          // lot per layer in 0.01: ×1.15 a layer (0.05, 0.06, 0.07, …)
    dist: [3.0, 3.0, 3.0, 3.3, 3.6, 4.0],                // $ distance to the next layer (×1.1 after layer 4)
    tpd: 2.0, pocket: 0.5, emaK: 2 / 10, cool: 10, flipM: 0.25,
    trailStart: 2.4, trailGap: 1.3, trailStep: 1.0,
  };
  function rng(seed) {
    return () => {
      seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const qOf = (b) => b.L.reduce((a, x) => a + x.q, 0);
  const avgOf = (b) => b.L.reduce((a, x) => a + x.q * x.p, 0) / Math.max(1e-9, qOf(b));
  const tpOf = (b) => avgOf(b) + b.dir * CFG.tpd;
  const plOf = (b, x, p) => x.q * (p - x.p) * b.dir;    // 0.01 lot XAU = 1 oz → $1 per $1
  const fltOf = (b, p) => b.L.reduce((a, x) => a + plOf(b, x, p), 0);

  function makeSim(startPrice) {
    const s = {
      tick: 0, tic: 0, p: startPrice, cid: 0, cur: null, candles: [], ema: startPrice - 2, trend: 1,
      bal: 5000, day: 0, pocket: 0, eq: [], ev: [], loop: 0, seg: null, si: -1, k: 0, p0: 0, tgt: 0, z: 0,
      trade: false, rnd: rng(20261028), lid: 0, up: true,
    };
    const mk = (dir) => ({ dir, L: [], lastClose: -1e9, trail: false, sl: null });
    s.B = [mk(1), mk(-1)];
    const BUY = s.B[0], SELL = s.B[1];
    const emit = (k, o) => s.ev.push(Object.assign({ k, tick: s.tick, cid: s.cid, p: s.p }, o));
    const l1 = (b) => (b.L.length ? b.L[0].p : s.p);
    const lastL = (b) => b.L[b.L.length - 1];
    const toTP = (b, d) => (b.L.length ? tpOf(b) + b.dir * 0.22 : s.p + b.dir * d);

    // the market of one loop, as moves the EA reacts to (targets read the state at the start of each move)
    const WARM = [
      { n: 190, to: () => s.p + 3.6 }, { n: 110, to: () => s.p - 1.6 }, { n: 200, to: () => s.p + 3.4 },
      { n: 80, to: () => s.p - 0.8 }, { n: 140, to: () => s.p + 1.8 },
    ];
    const LOOP = [
      // A · uptrend: BUY opens, TP, again TP
      { n: 6, to: () => s.p + 0.1, noflip: 1 },
      { n: 40, to: () => toTP(BUY, 2.3), noflip: 1 },
      { n: 16, to: () => s.p - 0.7, noflip: 1 },
      { n: 34, to: () => toTP(BUY, 2.3), noflip: 1 },
      { n: 12, to: () => s.p - 0.4, noflip: 1 },
      // B · top and drop: BUY marty layers, trend turns down (BUY held), SELL series win on the way
      { n: 34, to: () => l1(BUY) - 3.4 },
      { n: 12, to: () => s.p + 1.0 },
      { n: 22, to: () => Math.min(l1(BUY) - 4.8, s.ema - 1.6) },
      { n: 28, to: () => Math.min(toTP(SELL, 2.3), l1(BUY) - 6.3) },
      { n: 14, to: () => s.p + 0.8 },
      { n: 34, to: () => Math.min(toTP(SELL, 2.3), l1(BUY) - 9.6) },
      // C · deep: layer 5, bounce → DD reduction, SELL TP at the bottom
      { n: 14, to: () => s.p + 1.0 },
      { n: 34, to: () => Math.min(toTP(SELL, 2.3), l1(BUY) - 13.2) },
      { n: 26, to: () => lastL(BUY).p + 2.5, noflip: 1, act: 'reduce' },
      { n: 38, to: () => toTP(SELL, 1.6), block: [1], noflip: 1 },
      // D · rally: trend turns up (SELL held), the pocket pays L1, BUY basket TP, new BUY rides with trailing
      { n: 40, to: () => l1(BUY) - 8.0, block: [1], act: 'pocket' },
      { n: 30, to: () => toTP(BUY, 2.3), block: [1] },
      { n: 16, to: () => s.p + 0.3, act: 'trail' },
      { n: 46, to: () => l1(BUY) + 4.9, noflip: 1 },
      { n: 20, to: () => (BUY.sl != null ? BUY.sl - 0.35 : s.p - 1.5), noflip: 1 },
      { n: 12, to: () => s.p + 0.4, block: [0, 1], noflip: 1 },
    ];
    let script = WARM;

    function closeAll(b, kind) {
      const n = b.L.length, q = qOf(b), usd = fltOf(b, s.p);
      s.bal += usd; s.day += usd;
      if (usd > 0) s.pocket += usd * CFG.pocket;
      emit(kind, { dir: b.dir, usd, n, q, pk: usd > 0 ? usd * CFG.pocket : 0 });
      b.L = []; b.lastClose = s.tick; b.trail = false; b.sl = null;
    }
    function act(name) {
      const b = BUY;
      if (name === 'reduce' && b.L.length >= 5) {
        const nw = lastL(b), od = b.L[0];
        const gain = plOf(b, nw, s.p), per = (od.p - s.p) * b.dir;       // loss per 0.01 lot of the oldest
        if (gain > 0 && per > 0) {
          const tq = Math.min(od.q, Math.floor((gain - 1) / per));
          if (tq >= 1) {
            const cost = tq * per, from = od.q;
            b.L.pop(); od.q -= tq;
            if (!od.q) b.L.shift();
            s.bal += gain - cost; s.day += gain - cost;
            emit('reduce', { gain, cost, net: gain - cost, nw: { cid: nw.cid, p: nw.p, n: nw.n }, od: { cid: od.cid, p: od.p, n: od.n, from, to: od.q } });
          }
        }
      } else if (name === 'pocket' && b.L.length >= 2) {
        const od = b.L[0], loss = -plOf(b, od, s.p);
        if (loss > 0 && s.pocket >= loss) {
          s.pocket -= loss; s.bal -= loss; s.day -= loss;
          b.L.shift();
          emit('pocket', { paid: loss, od: { cid: od.cid, p: od.p, n: od.n, q: od.q } });
        }
      } else if (name === 'trail' && b.L.length) {
        b.trail = true;
        emit('trailon', { dir: b.dir });
      }
    }
    function nextSeg() {
      if (s.seg && s.seg.act && s.trade) act(s.seg.act);
      s.si++;
      if (s.si >= script.length) {
        if (script === WARM) { script = LOOP; s.trade = true; }
        s.si = 0; s.loop++; s.day = 0; s.pocket = 0; s.eq = []; s.rnd = rng(20261028);
        if (s.trade) emit('loop', {});
      }
      s.seg = script[s.si];
      s.k = 0; s.p0 = s.p; s.tgt = s.seg.to(); s.z = 0;
    }
    function step() {
      if (!s.seg || s.k >= s.seg.n) nextSeg();
      // price: eased move to the target + a noise bridge that is zero at both ends
      s.k++;
      const f = s.k / s.seg.n, e = f < 0.5 ? 2 * f * f : 1 - (-2 * f + 2) ** 2 / 2;
      s.z = s.z * 0.72 + (s.rnd() - 0.5) * 2 * (s.seg.v || 0.34);
      const np = Math.round((s.p0 + (s.tgt - s.p0) * e + s.z * Math.sin(Math.PI * f) ** 0.7) * 100) / 100;
      s.up = np >= s.p; s.p = np; s.tick++;
      // candles
      if (!s.cur) s.cur = { id: s.cid, o: s.p, h: s.p, l: s.p, c: s.p, e: s.ema };
      const c = s.cur;
      c.h = Math.max(c.h, s.p); c.l = Math.min(c.l, s.p); c.c = s.p; c.e = s.ema + CFG.emaK * (s.p - s.ema);
      if (++s.tic >= CFG.ct) {
        s.tic = 0;
        s.ema = c.e;
        s.candles.push(c);
        if (s.candles.length > 160) s.candles.shift();
        if (!s.seg.noflip) {
          if (s.trend > 0 && c.c < s.ema - CFG.flipM) { s.trend = -1; emit('flip', { dir: -1, held: BUY.L.length > 0 }); }
          else if (s.trend < 0 && c.c > s.ema + CFG.flipM) { s.trend = 1; emit('flip', { dir: 1, held: SELL.L.length > 0 }); }
        }
        s.cid++;
        s.cur = { id: s.cid, o: c.c, h: c.c, l: c.c, c: c.c, e: s.ema };
      }
      if (!s.trade) return;
      // baskets
      for (const b of s.B) {
        if (!b.L.length) continue;
        const last = lastL(b);
        if (b.L.length < CFG.q.length && (s.p - last.p) * b.dir <= -CFG.dist[b.L.length - 1]) {
          const n = last.n + 1, q = CFG.q[b.L.length];
          b.L.push({ p: s.p, q, cid: s.cid, n, id: ++s.lid });
          emit('layer', { dir: b.dir, n, q, d: CFG.dist[b.L.length - 2] });
        }
        if (b.trail) {
          const a = avgOf(b), run = (s.p - a) * b.dir;
          if (run >= CFG.trailStart) {
            const lvl = a + b.dir * Math.floor((run - CFG.trailGap) / CFG.trailStep) * CFG.trailStep;
            if ((lvl - a) * b.dir > 0 && (b.sl == null || (lvl - b.sl) * b.dir > 0.001)) {
              b.sl = lvl;
              emit('trailstep', { dir: b.dir, lock: qOf(b) * (lvl - a) * b.dir, sl: lvl });
            }
          }
          if (b.sl != null && (s.p - b.sl) * b.dir <= 0) closeAll(b, 'trailclose');
        } else if ((s.p - tpOf(b)) * b.dir >= 0) closeAll(b, 'tp');
      }
      // new series: flat side, in the trend direction, after a short pause
      s.B.forEach((b, i) => {
        if (b.L.length || s.trend !== b.dir || s.tick - b.lastClose < CFG.cool || (s.seg.block && s.seg.block.includes(i))) return;
        b.L.push({ p: s.p, q: CFG.q[0], cid: s.cid, n: 1, id: ++s.lid });
        emit('open', { dir: b.dir, q: CFG.q[0] });
      });
      if (s.tick % 3 === 0) {
        s.eq.push(s.day + fltOf(BUY, s.p) + fltOf(SELL, s.p));
        if (s.eq.length > 240) s.eq.shift();
      }
    }
    // warm-up: a full chart and a settled EMA before the first trade
    while (!s.trade) step();
    s.ev = [];
    return { s, step, avg: avgOf, tp: tpOf, flt: fltOf, q: qOf, BUY, SELL };
  }
  window.GHSIM = { makeSim, CFG };

  const hosts = document.querySelectorAll('[data-ghsim]');
  if (!hosts.length || !document.createElement('canvas').getContext) return;

  // ---------- shared drawing helpers ----------
  const glow = (rgb) => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, `rgba(${rgb},0.95)`); gr.addColorStop(0.3, `rgba(${rgb},0.38)`); gr.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return c;
  };
  const G = {}; for (const k in C) G[k] = glow(C[k]);
  const usd = (v, sign = true) => `${sign ? (v >= 0 ? '+' : '−') : (v < 0 ? '−' : '')}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const px = (v) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const lot = (q) => (q / 100).toFixed(2);
  const side = (d) => (d > 0 ? 'BUY' : 'SELL');
  const sideC = (d) => (d > 0 ? C.blue : C.orange);
  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function pill(ctx, x, y, text, rgb, o = {}) {      // x,y = anchor; o.align 'left'|'right'|'center'
    ctx.font = o.font || `700 9.5px ${FONT}`;
    const w = ctx.measureText(text).width + 12, h = o.h || 17;
    let x0 = o.align === 'right' ? x - w : o.align === 'center' ? x - w / 2 : x;
    if (o.minX != null) x0 = Math.max(o.minX, x0);
    if (o.maxX != null) x0 = Math.min(o.maxX - w, x0);
    const y0 = y - h / 2;
    ctx.globalAlpha = o.a == null ? 1 : o.a;
    rr(ctx, x0, y0, w, h, h / 2);
    ctx.fillStyle = o.solid ? `rgba(${rgb},0.92)` : `rgba(10,10,16,0.88)`; ctx.fill();
    ctx.strokeStyle = `rgba(${rgb},0.8)`; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = o.solid ? '#07120c' : `rgb(${rgb})`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(text, x0 + 6, y + 0.5);
    ctx.globalAlpha = 1;
    return { x: x0, w };
  }
  function brackets(ctx, x, y, w, h, rgb, l = 12) {
    ctx.strokeStyle = `rgba(${rgb},0.85)`; ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(x, y + l); ctx.lineTo(x, y); ctx.lineTo(x + l, y);
    ctx.moveTo(x + w - l, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + l);
    ctx.moveTo(x + w, y + h - l); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - l, y + h);
    ctx.moveTo(x + l, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - l);
    ctx.stroke();
  }

  // ---------- captions (HTML, under the canvas) ----------
  const CAP = {
    loop: () => ['🧠', T('Mesin AI membaca <b>tren EMA</b>, spread &amp; jarak layer…', 'The AI engine reads the <b>EMA trend</b>, spread &amp; layer step…'), 'trend'],
    open: (e) => [e.dir > 0 ? '🟦' : '🟧', e.dir > 0
      ? T(`Tren naik · seri <b>BUY</b> dibuka ${lot(e.q)} lot`, `Uptrend · <b>BUY</b> series opened at ${lot(e.q)} lot`)
      : T(`Tren turun · seri <b>SELL</b> dibuka ${lot(e.q)} lot`, `Downtrend · <b>SELL</b> series opened at ${lot(e.q)} lot`), 'trend'],
    layer: (e) => ['🪜', e.d > CFG.dist[0]
      ? T(`Marty layer ke-${e.n} ${side(e.dir)} · jarak melebar · lot <b>${lot(e.q)}</b> · rata-rata ikut bergeser`, `Marty layer ${e.n} ${side(e.dir)} · wider step · lot <b>${lot(e.q)}</b> · the average follows`)
      : T(`Marty layer ke-${e.n} ${side(e.dir)} · lot naik <b>${lot(e.q)}</b> · rata-rata ikut bergeser`, `Marty layer ${e.n} ${side(e.dir)} · bigger lot <b>${lot(e.q)}</b> · the average follows`), 'marty'],
    tp: (e) => ['🎯', T(`TP bersama tercapai · ${e.n} posisi ${side(e.dir)} ditutup <b>${usd(e.usd)}</b> · sebagian masuk kantong`, `Shared TP reached · ${e.n} ${side(e.dir)} position${e.n > 1 ? 's' : ''} closed <b>${usd(e.usd)}</b> · part goes to the pocket`), 'tp'],
    flip: (e) => ['🔀', e.dir > 0
      ? T(`Tren berbalik <b>naik</b>: sisi SELL ditahan, seri baru hanya BUY`, `Trend turned <b>up</b>: the SELL side is held, new series only BUY`)
      : T(`Tren berbalik <b>turun</b>: sisi BUY ditahan, seri baru hanya SELL`, `Trend turned <b>down</b>: the BUY side is held, new series only SELL`), 'trend'],
    reduce: (e) => ['♻️', T(`DD reduction: profit layer terbaru memangkas posisi terlama · bersih <b>${usd(e.net)}</b>`, `DD reduction: the newest layer's profit trims the oldest position · net <b>${usd(e.net)}</b>`), 'reduce'],
    pocket: (e) => ['👛', T(`Kantong profit membayar posisi tersangkut (L${e.od.n}) <b>${usd(e.paid, false)}</b>`, `The profit pocket pays off a stuck position (L${e.od.n}) <b>${usd(e.paid, false)}</b>`), 'pocket'],
    trailon: () => ['🪂', T('Tren kuat · TP dilepas, <b>trailing</b> aktif', 'Strong trend · TP released, <b>trailing</b> on'), 'trail'],
    trailstep: (e) => ['🔒', T(`Trailing mengunci profit <b>${usd(e.lock)}</b>`, `Trailing locks in <b>${usd(e.lock)}</b>`), 'trail'],
    trailclose: (e) => ['🪂', T(`Trailing tersentuh · profit terkunci <b>${usd(e.usd)}</b> · basket bersih`, `Trailing hit · profit locked <b>${usd(e.usd)}</b> · basket flat`), 'trail'],
  };

  // ---------- one animation per container ----------
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const narrowMQ = matchMedia('(max-width: 899px)');
  const hero = document.getElementById('aiHud');
  let heroOn = false;
  const all = [];
  if (hero) new IntersectionObserver((es) => { heroOn = es[0].isIntersecting; all.forEach((a) => a.setRun()); }).observe(hero);

  function Anim(host) {
    const stage = host.querySelector('.ghsim-stage');
    const cv = host.querySelector('canvas');
    const ctx = cv.getContext('2d');
    const capTxt = host.querySelector('.ghsim-cap-txt'), capIco = host.querySelector('.ghsim-cap-ico');
    const chips = {}; host.querySelectorAll('.ghsim-chips [data-k]').forEach((li) => { chips[li.dataset.k] = li; });
    const sim = makeSim(4118.4);
    const s = sim.s;
    let W = 0, H = 0, dpr = 1, wide = false, P, CH, AX, X0, X1, Y0, Y1, cw, bg = null;
    let lo = 0, hi = 0, ranged = false, acc = 0, disp = 0, dispPk = 0;
    const fx = [], parts = [], flyers = [];
    const born = new Map();                                   // layer id → ms when it appeared
    let pocketXY = [0, 0], capAt = -1e9, cap = null;
    const capQ = [];

    function layout() {
      wide = W >= 760;
      if (wide) {
        const pw = Math.round(Math.min(292, Math.max(244, W * 0.26)));
        P = { x: W - pw - 14, y: 14, w: pw, h: H - 28 };
        CH = { x: 14, y: 14, w: W - pw - 42, h: H - 28 };
      } else {
        const ph = 128;
        P = { x: 10, y: 10, w: W - 20, h: ph };
        CH = { x: 10, y: ph + 20, w: W - 20, h: H - ph - 30 };
      }
      AX = wide ? 64 : 54; cw = wide ? 13 : 8.5;
      X0 = CH.x + 6; X1 = CH.x + CH.w - AX; Y0 = CH.y + (wide ? 50 : 42); Y1 = CH.y + CH.h - 14;
    }
    function size() {
      const b = stage.getBoundingClientRect();
      if (!b.width) return false;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = b.width; H = b.height;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      layout();
      // static layer: chart grid + frames, drawn once per size
      bg = document.createElement('canvas'); bg.width = cv.width; bg.height = cv.height;
      const g = bg.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      rr(g, CH.x, CH.y, CH.w, CH.h, 12); g.fillStyle = 'rgba(8,8,13,0.55)'; g.fill();
      g.strokeStyle = 'rgba(86,214,214,0.16)'; g.lineWidth = 1; g.stroke();
      g.save(); rr(g, CH.x, CH.y, CH.w, CH.h, 12); g.clip();
      g.strokeStyle = 'rgba(163,163,178,0.05)';
      for (let x = X1 - 0.5; x > CH.x; x -= wide ? 52 : 40) { g.beginPath(); g.moveTo(x, CH.y); g.lineTo(x, CH.y + CH.h); g.stroke(); }
      g.restore();
      g.fillStyle = 'rgba(163,163,178,0.08)'; g.fillRect(X1, Y0 - 6, 1, Y1 - Y0 + 12);
      brackets(g, CH.x + 3, CH.y + 3, CH.w - 6, CH.h - 6, C.cyan, 10);
      // panel
      const pg = g.createLinearGradient(P.x, P.y, P.x + P.w, P.y + P.h);
      pg.addColorStop(0, 'rgba(86,214,214,0.07)'); pg.addColorStop(1, 'rgba(155,123,255,0.07)');
      rr(g, P.x, P.y, P.w, P.h, 12); g.fillStyle = 'rgba(12,12,19,0.92)'; g.fill(); g.fillStyle = pg; g.fill();
      const bgr = g.createLinearGradient(P.x, P.y, P.x + P.w, P.y + P.h);
      bgr.addColorStop(0, 'rgba(86,214,214,0.75)'); bgr.addColorStop(0.55, 'rgba(155,123,255,0.65)'); bgr.addColorStop(1, 'rgba(245,197,66,0.6)');
      g.strokeStyle = bgr; g.lineWidth = 1.2; g.stroke();
      brackets(g, P.x - 3, P.y - 3, P.w + 6, P.h + 6, C.gold, 12);
      ranged = false;
      return true;
    }

    // ---- coordinates
    const frac = () => (s.tic + Math.min(1, acc / CFG.tickMs)) / CFG.ct;
    const xOf = (cid) => X1 - cw * 4.2 - ((s.cid - cid) + frac()) * cw;
    const Y = (v) => Y1 - ((v - lo) / Math.max(0.5, hi - lo)) * (Y1 - Y0);

    // ---- events from the engine → effects + captions
    function caption(e) {
      const f = CAP[e.k];
      if (!f || reduce) return;
      const c = { f, e };
      if (performance.now() - capAt < 1500) { capQ.push(c); if (capQ.length > 2) capQ.shift(); } else showCap(c);
    }
    function showCap(c) {
      cap = c; capAt = performance.now();
      const [ico, txt, chip] = c.f(c.e);
      if (capTxt) { capTxt.innerHTML = txt; capTxt.classList.remove('in'); void capTxt.offsetWidth; capTxt.classList.add('in'); }
      if (capIco) capIco.textContent = ico;
      for (const k in chips) chips[k].classList.toggle('on', k === chip);
      if (chips[chip]) chips[chip].classList.add('seen');
    }
    function burst(x, y, rgb, n = 14, sp = 2.2) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU, v = sp * (0.4 + Math.random());
        parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 0.6, life: 0, max: 600 + Math.random() * 500, c: rgb, r: 8 + Math.random() * 8 });
      }
    }
    function fly(x0, y0, x1, y1, rgb, n, now) {
      for (let i = 0; i < n; i++) flyers.push({ x0, y0, x1, y1, t0: now + i * 70, dur: 750, c: rgb, bend: (Math.random() - 0.5) * 70 });
    }
    function drain(now, live) {
      for (const e of s.ev) {
        e.t0 = now;
        if (e.k === 'loop') { disp = 0; for (const k in chips) chips[k].classList.remove('seen', 'on'); caption(e); continue; }
        if (live) {
          const x = xOf(e.cid), y = Y(e.p);
          if (e.k === 'tp' || e.k === 'trailclose') {
            burst(x, y, e.k === 'tp' ? C.green : C.violet, 18, 2.6);
            if (e.pk > 0) fly(x, y, pocketXY[0], pocketXY[1], C.gold, 6, now + 350);
          } else if (e.k === 'reduce') burst(x, y, C.cyan, 12);
          else if (e.k === 'pocket') fly(pocketXY[0], pocketXY[1], xOf(e.od.cid), Y(e.od.p), C.gold, 8, now);
          else if (e.k === 'flip') burst(x, y, e.dir > 0 ? C.green : C.red, 10, 1.6);
        }
        if (e.k !== 'trailstep' || !fx.some((f) => f.k === 'trailstep' && now - f.t0 < 900)) fx.push(e);
        if (e.k === 'layer' || e.k === 'open') {
          const b = s.B[e.dir > 0 ? 0 : 1], l = b.L[b.L.length - 1];
          if (l) born.set(l.id, now);
        }
        caption(e);
      }
      s.ev.length = 0;
      for (let i = fx.length - 1; i >= 0; i--) if (now - fx[i].t0 > 4200) fx.splice(i, 1);
      if (born.size > 40) for (const k of born.keys()) { born.delete(k); if (born.size <= 30) break; }
    }

    // ---- drawing
    function drawChart(now) {
      const TMX = X1 - (wide ? 84 : 72), occ = [];
      const hit = (x, y, w, h) => occ.some((r) => x < r.x + r.w && x + w > r.x && y < r.y + r.h && y + h > r.y);
      const vis = s.candles.filter((c) => xOf(c.id) > X0 - cw).concat([s.cur]);
      // vertical range: candles + every open line, eased
      let a = Infinity, b = -Infinity;
      for (const c of vis) { a = Math.min(a, c.l, c.e); b = Math.max(b, c.h, c.e); }
      for (const bk of s.B) if (bk.L.length) {
        for (const l of bk.L) { a = Math.min(a, l.p); b = Math.max(b, l.p); }
        const t = bk.trail ? (bk.sl ?? sim.avg(bk)) : sim.tp(bk);
        a = Math.min(a, t, sim.avg(bk)); b = Math.max(b, t, sim.avg(bk));
      }
      const pad = Math.max(0.8, (b - a) * 0.1);
      if (!ranged) { lo = a - pad; hi = b + pad; ranged = true; }
      lo += (a - pad - lo) * 0.1; hi += (b + pad - hi) * 0.1;

      ctx.save();
      rr(ctx, CH.x, CH.y, CH.w, CH.h, 12); ctx.clip();
      // price grid + axis
      const span = hi - lo, stepRaw = span / (wide ? 6 : 5);
      const step = [0.5, 1, 2, 2.5, 5, 10].find((v) => v >= stepRaw) || 10;
      ctx.font = `500 ${wide ? 10 : 9}px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      for (let v = Math.ceil(lo / step) * step; v < hi; v += step) {
        const y = Math.round(Y(v)) + 0.5;
        if (y < Y0 - 4 || y > Y1 + 4) continue;
        ctx.fillStyle = 'rgba(163,163,178,0.07)'; ctx.fillRect(X0, y, X1 - X0, 1);
        ctx.fillStyle = 'rgba(163,163,178,0.6)'; ctx.fillText(px(v), X1 + 6, y);
      }
      // EMA trend zones: green BUY zone above the line, red SELL zone below it
      const pts = vis.map((c) => [xOf(c.id), Y(c.e)]);
      if (pts.length > 1) {
        const up = s.trend > 0;
        const zone = (toY, rgb, al) => {
          const gr = ctx.createLinearGradient(0, toY, 0, (Y0 + Y1) / 2);
          gr.addColorStop(0, `rgba(${rgb},0)`); gr.addColorStop(1, `rgba(${rgb},${al})`);
          ctx.beginPath(); ctx.moveTo(pts[0][0], toY);
          pts.forEach(([x, y]) => ctx.lineTo(x, y));
          ctx.lineTo(pts[pts.length - 1][0], toY); ctx.closePath();
          ctx.fillStyle = gr; ctx.fill();
        };
        zone(Y0 - 10, C.green, up ? 0.15 : 0.06);
        zone(Y1 + 10, C.red, up ? 0.06 : 0.15);
        const eg = ctx.createLinearGradient(X0, 0, X1, 0);
        eg.addColorStop(0, `rgba(${C.violet},0.9)`); eg.addColorStop(1, `rgba(${C.cyan},1)`);
        ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.strokeStyle = `rgba(${C.cyan},0.16)`; ctx.lineWidth = 6; ctx.stroke();
        ctx.strokeStyle = eg; ctx.lineWidth = 1.7; ctx.stroke();
        // zone labels ride the left end of the line
        const [lx, ly0] = pts.find(([x]) => x > X0 + 8) || pts[0];
        const ly = Math.max(Y0 + 30, Math.min(Y1 - 30, ly0)), zf = `700 ${wide ? 9 : 8}px ${FONT}`;
        const e1 = pill(ctx, X0 + 4, ly, 'EMA', C.cyan, { font: `800 ${wide ? 9 : 8}px ${FONT}`, h: 15, solid: 1 });
        pill(ctx, X0 + 4, ly - 18, T('▲ ZONA BUY', '▲ BUY ZONE'), C.green, { font: zf, h: 15, a: up ? 1 : 0.55 });
        pill(ctx, X0 + 4, ly + 18, T('▼ ZONA SELL', '▼ SELL ZONE'), C.pink, { font: zf, h: 15, a: up ? 0.55 : 1 });
        void e1; void lx;
      }
      // a slow scan beam
      const sy = Y0 + ((now / 5200) % 1) * (Y1 - Y0);
      const sg = ctx.createLinearGradient(0, sy - 34, 0, sy + 6);
      sg.addColorStop(0, `rgba(${C.cyan},0)`); sg.addColorStop(0.85, `rgba(${C.cyan},0.045)`); sg.addColorStop(1, `rgba(${C.cyan},0)`);
      ctx.fillStyle = sg; ctx.fillRect(X0, sy - 34, X1 - X0, 40);

      // basket lines + right-hand tags
      const tags = [];
      for (const bk of s.B) {
        if (!bk.L.length) continue;
        const sc = sideC(bk.dir), av = sim.avg(bk), tp = sim.tp(bk), sn = side(bk.dir);
        ctx.setLineDash([2, 4]); ctx.lineWidth = 1;
        for (const l of bk.L) {
          const x = Math.max(X0, xOf(l.cid)), y = Math.round(Y(l.p)) + 0.5;
          ctx.strokeStyle = `rgba(${sc},0.32)`; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(X1, y); ctx.stroke();
        }
        ctx.setLineDash([6, 4]);
        const hl = (v, rgb, al, w = 1.3) => { const y = Math.round(Y(v)) + 0.5; ctx.strokeStyle = `rgba(${rgb},${al})`; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(X0, y); ctx.lineTo(X1, y); ctx.stroke(); return y; };
        if (bk.L.length > 1) tags.push({ y: hl(av, sc, 0.85), t: T(`RATA² ${sn}`, `AVG ${sn}`), c: sc });
        if (bk.trail) {
          hl(tp, C.green, 0.25, 1);
          tags.push({ y: Y(tp), t: T('TP dilepas', 'TP released'), c: C.muted });
          if (bk.sl != null) {
            ctx.setLineDash([]);
            const y = hl(bk.sl, C.violet, 0.95, 1.8);
            ctx.drawImage(G.violet, X1 - 30, y - 12, 24, 24);
            tags.push({ y, t: 'TRAILING SL', c: C.violet, solid: 1 });
          }
        } else {
          const y = hl(tp, C.green, 0.95, 1.5);
          tags.push({ y, t: `TP ${sn}`, c: C.green, solid: 1 });
        }
        ctx.setLineDash([]);
      }
      // bid line
      const by = Math.round(Y(s.p)) + 0.5;
      ctx.setLineDash([1, 3]); ctx.strokeStyle = 'rgba(255,241,184,0.35)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(X0, by); ctx.lineTo(X1, by); ctx.stroke(); ctx.setLineDash([]);

      // candles
      const bw = Math.max(3, cw * 0.62);
      for (const c of vis) {
        const x = Math.round(xOf(c.id)) + 0.5, upc = c.c >= c.o, rgb = upc ? C.green : C.red;
        if (x < X0 - cw || x > X1) continue;
        ctx.strokeStyle = `rgba(${rgb},0.9)`; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, Y(c.h)); ctx.lineTo(x, Y(c.l)); ctx.stroke();
        const y0 = Y(Math.max(c.o, c.c)), h = Math.max(1.2, Math.abs(Y(c.o) - Y(c.c)));
        ctx.fillStyle = upc ? `rgba(${rgb},0.85)` : `rgba(${rgb},0.9)`;
        ctx.fillRect(x - bw / 2, y0, bw, h);
      }
      // live price glow on the forming candle
      const lx = xOf(s.cid);
      const pr = 16 + 3 * Math.sin(now / 260);
      ctx.drawImage(G.gold, lx - pr / 2, by - pr / 2, pr, pr);

      // layer markers + "MARTY BUY #3 · 0.06" labels (big for 4 s, then just #n)
      for (const bk of s.B) {
        const sc = sideC(bk.dir);
        bk.L.forEach((l) => {
          const x = xOf(l.cid), y = Y(l.p);
          if (x < X0 - 4) return;
          const age = now - (born.get(l.id) ?? -1e9);
          if (age < 900) { const r = 8 + age / 30; ctx.strokeStyle = `rgba(${sc},${(1 - age / 900).toFixed(3)})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke(); }
          ctx.drawImage(G[bk.dir > 0 ? 'blue' : 'orange'], x - 9, y - 9, 18, 18);
          ctx.fillStyle = `rgb(${sc})`;
          ctx.beginPath();
          if (bk.dir > 0) { ctx.moveTo(x, y - 4); ctx.lineTo(x + 4.5, y + 3.5); ctx.lineTo(x - 4.5, y + 3.5); }
          else { ctx.moveTo(x, y + 4); ctx.lineTo(x + 4.5, y - 3.5); ctx.lineTo(x - 4.5, y - 3.5); }
          ctx.closePath(); ctx.fill();
          const off = bk.dir > 0 ? 13 : -13;
          if (age < 4000) {
            const t = l.n === 1 ? `${side(bk.dir)} #1 · ${lot(l.q)}` : `MARTY ${side(bk.dir)} #${l.n} · ${lot(l.q)}`;
            const r = pill(ctx, x, y + off, t, sc, { align: 'center', minX: X0 + 2, maxX: TMX, a: age > 3400 ? (4000 - age) / 600 : 1, font: `700 ${wide ? 9.5 : 8.5}px ${FONT}` });
            occ.push({ x: r.x, y: y + off - 9, w: r.w, h: 18 });
          } else {
            ctx.font = `700 8.5px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = bk.dir > 0 ? 'top' : 'bottom';
            ctx.fillStyle = `rgba(${sc},0.9)`; ctx.fillText(`#${l.n}`, x, y + (bk.dir > 0 ? 6 : -6));
          }
        });
      }

      // effects tied to the chart
      for (const e of fx) {
        const age = now - e.t0, x = xOf(e.cid), y = Y(e.p);
        if (e.k === 'tp' || e.k === 'trailclose') {
          const rgb = e.k === 'tp' ? C.green : C.violet, k = Math.min(1, age / 2600);
          if (age < 2600) {
            ctx.fillStyle = `rgba(${rgb},${(0.14 * (1 - k)).toFixed(3)})`; ctx.fillRect(x - 22, Y0 - 10, 44, Y1 - Y0 + 20);
            ctx.strokeStyle = `rgba(${rgb},${(0.9 * (1 - k)).toFixed(3)})`; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(x, y, 6 + 40 * k, 0, TAU); ctx.stroke();
            ctx.drawImage(G[e.k === 'tp' ? 'green' : 'violet'], x - 22, y - 22, 44, 44);
          }
          if (age < 3600) {
            const rise = Math.min(1, age / 1200) * 26, a = age > 2800 ? (3600 - age) / 800 : 1;
            const txt = `${usd(e.usd)} ${e.k === 'tp' ? 'TP' : 'TRAILING'}`;
            ctx.font = `800 ${wide ? 15 : 12.5}px ${FONT}`;
            const tw = ctx.measureText(txt).width;
            const tx = Math.max(X0 + tw / 2 + 4, Math.min(X1 - tw / 2 - 6, x - tw / 2 - 12));
            const cl = (v) => Math.max(Y0 + 12, Math.min(Y1 - 12, v));
            // a free spot away from the layer labels, eased so the text glides instead of jumping
            let d = e.dir > 0 ? -1 : 1, ly = cl(y + d * (20 + rise));
            for (let i = 0; i < 8 && hit(tx - tw / 2 - 4, ly - 11, tw + 8, 22); i++) {
              const n = ly + d * 20;
              if (n !== cl(n)) { d = -d; ly = cl(y + d * (20 + rise)); } else ly = n;
            }
            e.ly = e.ly == null ? ly : e.ly + (ly - e.ly) * 0.3;
            const ty = e.ly;
            ctx.globalAlpha = Math.max(0, a);
            ctx.drawImage(G[e.k === 'tp' ? 'green' : 'violet'], tx - tw / 2 - 10, ty - 18, tw + 20, 36);
            ctx.fillStyle = e.k === 'tp' ? '#7dffb2' : '#d7c8ff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(txt, tx, ty);
            ctx.globalAlpha = 1;
          }
        } else if (e.k === 'flip' && age < 3400) {
          const a = age > 2600 ? (3400 - age) / 800 : 1, up = e.dir > 0, rgb = up ? C.green : C.red;
          const ay = Math.max(Y0 + 16, Math.min(Y1 - 46, y + (up ? -50 : 50)));
          ctx.globalAlpha = a;
          ctx.drawImage(G[up ? 'green' : 'red'], x - 24, ay - 24, 48, 48);
          ctx.fillStyle = `rgb(${rgb})`; ctx.beginPath();
          if (up) { ctx.moveTo(x, ay - 13); ctx.lineTo(x + 10, ay + 3); ctx.lineTo(x + 4, ay + 3); ctx.lineTo(x + 4, ay + 13); ctx.lineTo(x - 4, ay + 13); ctx.lineTo(x - 4, ay + 3); ctx.lineTo(x - 10, ay + 3); }
          else { ctx.moveTo(x, ay + 13); ctx.lineTo(x + 10, ay - 3); ctx.lineTo(x + 4, ay - 3); ctx.lineTo(x + 4, ay - 13); ctx.lineTo(x - 4, ay - 13); ctx.lineTo(x - 4, ay - 3); ctx.lineTo(x - 10, ay - 3); }
          ctx.closePath(); ctx.fill();
          pill(ctx, x, ay + 26, up ? T('TREN NAIK', 'UPTREND') : T('TREN TURUN', 'DOWNTREND'), rgb, { align: 'center', minX: X0 + 2, maxX: TMX, solid: 1 });
          ctx.globalAlpha = 1;
        } else if (e.k === 'reduce' && age < 3400) {
          const a = age > 2700 ? (3400 - age) / 700 : 1;
          const x1 = xOf(e.nw.cid), y1 = Y(e.nw.p), x2 = xOf(e.od.cid), y2 = Y(e.od.p);
          const mx = (x1 + x2) / 2, my = Math.max(Y0 + 6, Math.min(y1, y2) - 70);
          ctx.globalAlpha = a;
          ctx.strokeStyle = `rgba(${C.cyan},0.9)`; ctx.lineWidth = 1.8; ctx.setLineDash([5, 4]);
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.quadraticCurveTo(mx, my, x2, y2); ctx.stroke(); ctx.setLineDash([]);
          const k = (age % 1300) / 1300, ix = (1 - k) ** 2 * x1 + 2 * (1 - k) * k * mx + k * k * x2, iy = (1 - k) ** 2 * y1 + 2 * (1 - k) * k * my + k * k * y2;
          ctx.drawImage(G.cyan, ix - 10, iy - 10, 20, 20);
          ctx.drawImage(G.cyan, x1 - 14, y1 - 14, 28, 28);
          const g1 = pill(ctx, x1, y1 - 15, `#${e.nw.n} ${usd(e.gain)}`, C.green, { align: 'center', minX: X0 + 2, maxX: TMX }); occ.push({ x: g1.x, y: y1 - 24, w: g1.w, h: 18 });
          const g2 = pill(ctx, x2, y2 + 24, `L${e.od.n} ${lot(e.od.from)}→${lot(e.od.to)}`, C.pink, { align: 'center', minX: X0 + 2, maxX: TMX }); occ.push({ x: g2.x, y: y2 + 15, w: g2.w, h: 18 });
          pill(ctx, mx, Math.max(Y0 + 10, (my + Math.min(y1, y2)) / 2 - 6), T(`REDUCTION bersih ${usd(e.net)}`, `REDUCTION net ${usd(e.net)}`), C.cyan, { align: 'center', minX: X0 + 2, maxX: TMX, solid: 1, font: `800 ${wide ? 10.5 : 9}px ${FONT}`, h: 20 });
          ctx.globalAlpha = 1;
        } else if (e.k === 'pocket' && age < 4000) {
          const a = age > 3200 ? (4000 - age) / 800 : 1, x2 = xOf(e.od.cid), y2 = Y(e.od.p);
          ctx.globalAlpha = a;
          if (age > 600) {
            const k = Math.min(1, (age - 600) / 500);
            ctx.strokeStyle = `rgba(${C.gold},${0.9 * (1 - k * 0.5)})`; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(x2, y2, 7 + 16 * k, 0, TAU); ctx.stroke();
            ctx.drawImage(G.gold, x2 - 16, y2 - 16, 32, 32);
          }
          pill(ctx, x2, y2 - 16, T(`KANTONG bayar L${e.od.n} ${usd(-e.paid)}`, `POCKET pays L${e.od.n} ${usd(-e.paid)}`), C.gold, { align: 'center', minX: X0 + 2, maxX: TMX, solid: 1, font: `800 ${wide ? 10 : 9}px ${FONT}`, h: 19 });
          ctx.globalAlpha = 1;
        } else if (e.k === 'trailstep' && age < 1800) {
          const bk = s.B[e.dir > 0 ? 0 : 1];
          if (bk.sl != null) pill(ctx, X1 - 96, Y(e.sl) + (e.dir > 0 ? 14 : -14), T(`🔒 kunci ${usd(e.lock)}`, `🔒 lock ${usd(e.lock)}`), C.violet, { align: 'right', minX: X0 + 2, a: age > 1300 ? (1800 - age) / 500 : 1 });
        }
      }

      // right-hand tags (spread so they never overlap)
      tags.sort((p, q) => p.y - q.y);
      for (let i = 1; i < tags.length; i++) if (tags[i].y - tags[i - 1].y < 19) tags[i].y = tags[i - 1].y + 19;
      const over = tags.length ? tags[tags.length - 1].y - (Y1 - 6) : 0;
      if (over > 0) tags.forEach((t) => { t.y -= over; });
      tags.forEach((t) => pill(ctx, X1 - 4, t.y, t.t, t.c, { align: 'right', solid: t.solid, font: `700 ${wide ? 9 : 8}px ${FONT}`, h: 16 }));
      // price tag on the axis
      const pt = px(s.p);
      ctx.font = `700 ${wide ? 10 : 9}px ${FONT}`;
      rr(ctx, X1 + 2, by - 9, AX - 6, 18, 4);
      ctx.fillStyle = s.up ? `rgba(${C.green},0.95)` : `rgba(${C.red},0.95)`; ctx.fill();
      ctx.fillStyle = '#05120a'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(pt, X1 + 2 + (AX - 6) / 2, by + 0.5);
      ctx.restore();

      // trend card (top-left of the chart)
      const up = s.trend > 0, rgb = up ? C.green : C.red;
      const flipAge = fx.reduce((m, f) => (f.k === 'flip' ? Math.min(m, now - f.t0) : m), 1e9);
      const txt = up ? T('▲ TREN NAIK (BULLISH)', '▲ UPTREND (BULLISH)') : T('▼ TREN TURUN (BEARISH)', '▼ DOWNTREND (BEARISH)');
      ctx.font = `800 ${wide ? 11.5 : 10}px ${FONT}`;
      const tw = ctx.measureText(txt).width + 22, th = wide ? 28 : 24, tx = CH.x + 12, ty = CH.y + 10;
      if (flipAge < 1500) ctx.drawImage(G[up ? 'green' : 'red'], tx - 20, ty - 20, tw + 40, th + 40);
      rr(ctx, tx, ty, tw, th, 8); ctx.fillStyle = `rgba(${rgb},0.13)`; ctx.fill();
      ctx.strokeStyle = `rgba(${rgb},0.75)`; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.fillStyle = up ? '#7dffb2' : '#ff9aa4'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(txt, tx + 11, ty + th / 2 + 0.5);
      ctx.font = `500 ${wide ? 9.5 : 8.5}px ${FONT}`; ctx.fillStyle = 'rgba(163,163,178,0.85)';
      const sub = up ? T('EMA · seri baru hanya BUY', 'EMA · new series BUY only') : T('EMA · seri baru hanya SELL', 'EMA · new series SELL only');
      if (wide || W >= 400) { ctx.textAlign = 'right'; ctx.fillText(`XAUUSD · M1`, CH.x + CH.w - 12, ty + th / 2); }
      if (wide) { ctx.textAlign = 'left'; ctx.fillText(sub, tx + tw + 10, ty + th / 2 + 0.5); }
    }

    function drawPanel(now) {
      const x = P.x + 14, r = P.x + P.w - 14, pk = s.pocket;
      disp += (s.day - disp) * 0.12; if (Math.abs(s.day - disp) < 0.005) disp = s.day;
      dispPk += (pk - dispPk) * 0.12;
      const head = (y, big) => {
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.font = `900 ${big ? 13.5 : 11.5}px 'Cinzel',serif`;
        const gg = ctx.createLinearGradient(x, y - 12, x + 160, y);
        gg.addColorStop(0, '#fff1b8'); gg.addColorStop(0.5, '#f5c542'); gg.addColorStop(1, '#d4a017');
        ctx.fillStyle = gg; ctx.fillText('GOLD HUNTER GARUDA', x, y);
        return ctx.measureText('GOLD HUNTER GARUDA').width;
      };
      const aktif = (y) => {
        ctx.font = `800 ${wide ? 9.5 : 8.5}px ${FONT}`;
        const t = T('AKTIF', 'ACTIVE'), w = ctx.measureText(t).width + 24, h = 17;
        rr(ctx, r - w, y - h / 2, w, h, h / 2); ctx.fillStyle = 'rgba(46,204,113,0.14)'; ctx.fill();
        ctx.strokeStyle = 'rgba(46,204,113,0.8)'; ctx.lineWidth = 1; ctx.stroke();
        const pa = 0.55 + 0.45 * Math.sin(now / 280);
        ctx.drawImage(G.green, r - w + 2, y - 8, 16, 16);
        ctx.fillStyle = `rgba(46,204,113,${pa.toFixed(2)})`; ctx.beginPath(); ctx.arc(r - w + 10, y, 3, 0, TAU); ctx.fill();
        ctx.fillStyle = '#7dffb2'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(t, r - w + 17, y + 0.5);
      };
      const label = (t, lx, ly, align = 'left') => {
        ctx.font = `600 ${wide ? 9 : 8}px ${FONT}`; ctx.fillStyle = 'rgba(163,163,178,0.9)';
        ctx.textAlign = align; ctx.textBaseline = 'alphabetic'; ctx.fillText(t, lx, ly);
      };
      const spark = (sx, sy, sw, sh) => {
        const E = s.eq;
        rr(ctx, sx, sy, sw, sh, 6); ctx.fillStyle = 'rgba(255,255,255,0.025)'; ctx.fill();
        if (E.length < 2) return;
        let a = Math.min(0, ...E), b = Math.max(1, ...E);
        const yy = (v) => sy + sh - 4 - ((v - a) / (b - a)) * (sh - 8), xx = (i) => sx + 3 + (i / (E.length - 1)) * (sw - 6);
        const z = yy(0);
        ctx.strokeStyle = 'rgba(163,163,178,0.2)'; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(sx + 3, z); ctx.lineTo(sx + sw - 3, z); ctx.stroke(); ctx.setLineDash([]);
        const gr = ctx.createLinearGradient(0, sy, 0, sy + sh);
        gr.addColorStop(0, 'rgba(245,197,66,0.35)'); gr.addColorStop(1, 'rgba(245,197,66,0)');
        ctx.beginPath(); E.forEach((v, i) => (i ? ctx.lineTo(xx(i), yy(v)) : ctx.moveTo(xx(i), yy(v))));
        ctx.lineTo(xx(E.length - 1), sy + sh); ctx.lineTo(sx + 3, sy + sh); ctx.closePath(); ctx.fillStyle = gr; ctx.fill();
        ctx.beginPath(); E.forEach((v, i) => (i ? ctx.lineTo(xx(i), yy(v)) : ctx.moveTo(xx(i), yy(v))));
        ctx.strokeStyle = '#f5c542'; ctx.lineWidth = 1.5; ctx.stroke();
        const ex = xx(E.length - 1), ey = yy(E[E.length - 1]);
        ctx.drawImage(G.gold, ex - 7, ey - 7, 14, 14);
      };
      const pocketBar = (bx, by, bw) => {
        const cap = 60, f = Math.max(0, Math.min(1, dispPk / cap));
        rr(ctx, bx, by, bw, 7, 3.5); ctx.fillStyle = 'rgba(245,197,66,0.12)'; ctx.fill();
        if (f > 0.01) {
          const gr = ctx.createLinearGradient(bx, 0, bx + bw, 0);
          gr.addColorStop(0, '#d4a017'); gr.addColorStop(1, '#fff1b8');
          rr(ctx, bx, by, Math.max(7, bw * f), 7, 3.5); ctx.fillStyle = gr; ctx.fill();
          ctx.drawImage(G.gold, bx + bw * f - 9, by - 5, 18, 18);
        }
        pocketXY = [bx + bw * f, by + 3];
      };
      const basket = (bk, bx, by, bw, compact) => {
        const sc = sideC(bk.dir), up = bk.dir > 0, held = bk.L.length && s.trend !== bk.dir;
        ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
        ctx.font = `800 ${compact ? 9.5 : 10.5}px ${FONT}`; ctx.fillStyle = `rgb(${sc})`;
        const nm = `${up ? '▲' : '▼'} ${side(bk.dir)}`;
        ctx.fillText(nm, bx, by);
        const nw = ctx.measureText(nm).width;
        ctx.font = `600 ${compact ? 8.5 : 9.5}px ${FONT}`; ctx.fillStyle = 'rgba(236,236,241,0.85)';
        const info = bk.L.length ? `${bk.L.length} layer · ${lot(sim.q(bk))}` : (s.trend === bk.dir ? T('siap', 'ready') : T('ditahan', 'held'));
        ctx.fillText(info, bx + nw + 6, by);
        if (bk.L.length) {
          const f = sim.flt(bk, s.p);
          ctx.font = `700 ${compact ? 9.5 : 10.5}px ${FONT}`; ctx.textAlign = 'right';
          ctx.fillStyle = f >= 0 ? '#7dffb2' : '#ff9aa4'; ctx.fillText(usd(f), bx + bw, by);
        }
        ctx.font = `500 ${compact ? 8 : 8.5}px ${FONT}`; ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(163,163,178,0.85)';
        let sub;
        if (!bk.L.length) sub = s.trend === bk.dir ? T('menunggu sinyal masuk', 'waiting for an entry') : T('lawan tren · tidak buka seri', 'against trend · no new series');
        else if (bk.trail) sub = bk.sl != null ? `TRAILING SL ${px(bk.sl)}` : T('trailing aktif · TP dilepas', 'trailing on · TP released');
        else sub = `${compact ? '' : T('RATA² ', 'AVG ')}${px(sim.avg(bk))} → TP ${px(sim.tp(bk))}`;
        ctx.fillText(sub, bx, by + (compact ? 12 : 14));
        if (held) pill(ctx, bx + bw, by + (compact ? 9 : 10), T('DITAHAN', 'HELD'), C.muted, { align: 'right', font: `700 ${compact ? 7.5 : 8}px ${FONT}`, h: 13 });
      };
      const basketLine = (bk, bx, by, bw) => {
        const sc = sideC(bk.dir), held = bk.L.length && s.trend !== bk.dir;
        ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
        ctx.font = `800 9.5px ${FONT}`; ctx.fillStyle = `rgb(${sc})`;
        const nm = `${bk.dir > 0 ? '▲' : '▼'} ${side(bk.dir)}`;
        ctx.fillText(nm, bx, by);
        let cx = bx + ctx.measureText(nm).width + 6;
        ctx.font = `600 8.5px ${FONT}`; ctx.fillStyle = 'rgba(236,236,241,0.85)';
        const info = bk.L.length ? `${bk.L.length} layer · ${lot(sim.q(bk))}` : (s.trend === bk.dir ? T('siap · menunggu sinyal', 'ready · waiting') : T('ditahan · lawan tren', 'held · against trend'));
        ctx.fillText(info, cx, by);
        cx += ctx.measureText(info).width + 6;
        if (held) pill(ctx, cx, by - 3, T('DITAHAN', 'HELD'), C.muted, { font: `700 7.5px ${FONT}`, h: 13 });
        if (bk.L.length) {
          const f = sim.flt(bk, s.p);
          ctx.font = `700 9.5px ${FONT}`; ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
          ctx.fillStyle = f >= 0 ? '#7dffb2' : '#ff9aa4'; ctx.fillText(usd(f), bx + bw, by);
        }
      };
      const profitCol = disp >= 0 ? '#f5c542' : '#ff9aa4';

      if (wide) {
        let y = P.y + 30;
        head(y, true);
        aktif(y + 20);
        ctx.font = `700 9.5px ${FONT}`; ctx.fillStyle = `rgb(${C.cyan})`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText('· AI ENGINE ·', x, y + 20);
        label(T('XAUUSD · M1 · mode EMA TREN', 'XAUUSD · M1 · EMA TREND mode'), x, y + 44);
        ctx.fillStyle = 'rgba(163,163,178,0.15)'; ctx.fillRect(x, y + 54, r - x, 1);
        y += 76;
        label(T('PROFIT HARI INI', "TODAY'S PROFIT"), x, y);
        ctx.font = `800 26px ${FONT}`; ctx.fillStyle = profitCol; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.drawImage(G.gold, x - 10, y + 2, 120, 34);
        ctx.fillText(usd(disp), x, y + 30);
        label(`${T('Saldo', 'Balance')} ${usd(s.bal - s.day + disp, false)}`, x, y + 48);
        ctx.fillStyle = 'rgba(163,163,178,0.15)'; ctx.fillRect(x, y + 60, r - x, 1);
        y += 82;
        basket(s.B[0], x, y, r - x, false);
        basket(s.B[1], x, y + 40, r - x, false);
        ctx.fillStyle = 'rgba(163,163,178,0.15)'; ctx.fillRect(x, y + 64, r - x, 1);
        y += 86;
        label(T('KANTONG PROFIT', 'PROFIT POCKET'), x, y);
        ctx.font = `800 12px ${FONT}`; ctx.fillStyle = '#f5c542'; ctx.textAlign = 'right'; ctx.fillText(usd(dispPk, false), r, y);
        pocketBar(x, y + 8, r - x);
        y += 36;
        const foot = P.y + P.h - 16;
        label(T('EKUITAS HARI INI', "TODAY'S EQUITY"), x, y);
        spark(x, y + 8, r - x, Math.max(36, foot - y - 30));
        ctx.font = `600 9px ${FONT}`; ctx.fillStyle = 'rgba(163,163,178,0.9)'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.fillText(T('🛡 SL equity (9.1) · siaga', '🛡 Equity SL (9.1) · standby'), x, foot);
      } else {
        const y = P.y + 20;
        const hw = head(y, false);
        ctx.font = `700 8px ${FONT}`; ctx.fillStyle = `rgb(${C.cyan})`; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        if (P.w > 340) ctx.fillText('AI ENGINE', x + hw + 8, y);
        aktif(y - 4);
        ctx.fillStyle = 'rgba(163,163,178,0.15)'; ctx.fillRect(x, y + 9, r - x, 1);
        const cw3 = (r - x - 16) / 3, c2 = x + cw3 + 8, c3 = x + 2 * cw3 + 16, ry = y + 26;
        label(T('PROFIT HARI INI', "TODAY'S PROFIT"), x, ry);
        ctx.font = `800 ${cw3 < 96 ? 14 : 16}px ${FONT}`; ctx.fillStyle = profitCol; ctx.textAlign = 'left';
        ctx.fillText(usd(disp), x, ry + 20);
        label(T('KANTONG', 'POCKET'), c2, ry);
        ctx.font = `800 12.5px ${FONT}`; ctx.fillStyle = '#f5c542'; ctx.textAlign = 'left'; ctx.fillText(usd(dispPk, false), c2, ry + 18);
        pocketBar(c2, ry + 24, cw3);
        label(T('EKUITAS', 'EQUITY'), c3, ry);
        spark(c3, ry + 5, cw3, 30);
        ctx.fillStyle = 'rgba(163,163,178,0.15)'; ctx.fillRect(x, ry + 42, r - x, 1);
        const hw2 = (r - x - 14) / 2;
        if (hw2 >= 150) {
          basket(s.B[0], x, ry + 60, hw2, true);
          basket(s.B[1], x + hw2 + 14, ry + 60, hw2, true);
        } else {
          basketLine(s.B[0], x, ry + 59, r - x);
          basketLine(s.B[1], x, ry + 76, r - x);
        }
      }
    }
    function drawFloat(now) {
      for (let i = parts.length - 1; i >= 0; i--) {
        const q = parts[i];
        q.life += 33; q.x += q.vx; q.y += q.vy; q.vy += 0.05; q.vx *= 0.97;
        if (q.life > q.max) { parts.splice(i, 1); continue; }
        ctx.globalAlpha = 1 - q.life / q.max;
        ctx.drawImage(G[Object.keys(C).find((k) => C[k] === q.c) || 'gold'], q.x - q.r / 2, q.y - q.r / 2, q.r, q.r);
      }
      for (let i = flyers.length - 1; i >= 0; i--) {
        const f = flyers[i], k = (now - f.t0) / f.dur;
        if (k < 0) continue;
        if (k >= 1) { flyers.splice(i, 1); continue; }
        const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
        const mx = (f.x0 + f.x1) / 2 + f.bend, my = Math.min(f.y0, f.y1) - 40;
        const xx = (1 - e) ** 2 * f.x0 + 2 * (1 - e) * e * mx + e * e * f.x1, yy = (1 - e) ** 2 * f.y0 + 2 * (1 - e) * e * my + e * e * f.y1;
        ctx.globalAlpha = 0.95;
        ctx.drawImage(G.gold, xx - 8, yy - 8, 16, 16);
      }
      ctx.globalAlpha = 1;
    }
    function render(now, live = true) {
      if (!bg) return;
      drain(now, live);
      if (capQ.length && now - capAt >= 1500) showCap(capQ.shift());
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(bg, 0, 0, W, H);
      drawChart(now);
      drawPanel(now);
      drawFloat(now);
    }

    // ---- run / pause
    let running = false, visible = false, raf = 0, last = 0, lastDraw = 0;
    function loop(now) {
      raf = requestAnimationFrame(loop);
      if (now - lastDraw < 32) return;
      const dt = Math.min(120, last ? now - last : 33);
      last = now; lastDraw = now;
      acc += dt;
      while (acc >= CFG.tickMs) { acc -= CFG.tickMs; sim.step(); }
      render(now);
    }
    this.setRun = () => {
      const want = visible && !document.hidden && !reduce && !(heroOn && narrowMQ.matches);
      if (want === running) return;
      running = want;
      host.classList.toggle('run', running);
      if (running) { last = 0; raf = requestAnimationFrame(loop); } else cancelAnimationFrame(raf);
    };
    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      size();
      if (reduce) {
        // still frame: mid-loop, a long BUY basket, the DD reduction and the pocket on screen
        while (!s.ev.some((e) => e.k === 'reduce')) { s.ev.length = 0; sim.step(); }
        s.ev = s.ev.filter((e) => e.k === 'reduce');
        for (let i = 0; i < 6; i++) sim.step();
        s.ev = s.ev.filter((e) => e.k === 'reduce');
        const now = performance.now();
        disp = s.day; dispPk = s.pocket;
        render(now, false);
        fx.forEach((f) => { f.t0 = now - 600; });
        render(now, false);
        return;
      }
      this.setRun();
    };
    new IntersectionObserver((es) => {
      visible = es[0].isIntersecting;
      if (visible) start();
      if (started) this.setRun();
    }, { rootMargin: '600px 0px' }).observe(host);
    document.addEventListener('visibilitychange', () => this.setRun());
    narrowMQ.addEventListener && narrowMQ.addEventListener('change', () => this.setRun());
    let rt = 0;
    new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(() => { if (started && size()) render(performance.now(), false); }, 120); }).observe(stage);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (started && !running) render(performance.now(), false); });
    document.addEventListener('ghg:lang', () => {
      if (cap) { const c = cap; capAt = 0; showCap(c); }
      if (started && !running) render(performance.now(), false);
    });
    if (capTxt && !reduce) showCap({ f: CAP.loop, e: {} });
    if (reduce && capTxt) {
      capTxt.innerHTML = T('Satu basket dari awal sampai akhir: <b>marty layer</b>, rata-rata &amp; <b>TP bersama</b>, <b>DD reduction</b>, <b>kantong profit</b> dan <b>tren EMA</b>.',
        'One basket end to end: <b>marty layers</b>, the average &amp; <b>shared TP</b>, <b>DD reduction</b>, the <b>profit pocket</b> and the <b>EMA trend</b>.');
      document.addEventListener('ghg:lang', () => {
        capTxt.innerHTML = T('Satu basket dari awal sampai akhir: <b>marty layer</b>, rata-rata &amp; <b>TP bersama</b>, <b>DD reduction</b>, <b>kantong profit</b> dan <b>tren EMA</b>.',
          'One basket end to end: <b>marty layers</b>, the average &amp; <b>shared TP</b>, <b>DD reduction</b>, the <b>profit pocket</b> and the <b>EMA trend</b>.');
      });
    }
  }
  hosts.forEach((h) => { if (h.querySelector('canvas')) all.push(new Anim(h)); });
})();
