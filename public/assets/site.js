// GOLD HUNTER GARUDA public site shell: one header / nav, footer (risk warning, links, contact), WhatsApp button and
// login state on every public page, plus shared renderers (packages from /api/catalog, recommended setup cards).
// Load after i18n.js (which translates the data-en texts injected here on DOMContentLoaded).
const SITE = (() => {
  const TT = (id, en) => (typeof window.T === 'function' ? window.T(id, en) : id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const here = (location.pathname.replace(/\.html$/, '').replace(/\/+$/, '') || '/').toLowerCase();
  const NAV = [['/', 'Beranda', 'Home'], ['/live', 'Live', 'Live'], ['/setup', 'Setup', 'Setups'], ['/harga', 'Harga', 'Pricing'], ['/cara-pasang', 'Cara Pasang', 'How to Install']];
  const link = ([href, id, en]) => `<a href="${href}" data-en="${esc(en)}"${here === href ? ' class="on" aria-current="page"' : ''}>${esc(id)}</a>`;

  const header = `<header class="site-top" id="site-top"><div class="wrap nav-in">
    <a class="logo" href="/" aria-label="GOLD HUNTER GARUDA"><img src="/assets/brand/goldhunter-garuda-logo-128.png" width="36" height="36" alt=""><span><b class="gold-text">GOLD HUNTER</b><small>GARUDA</small></span></a>
    <nav class="menu" id="site-menu" aria-label="Menu">
      ${NAV.map(link).join('')}
      <a href="#" class="lang-btn" data-lang-toggle>🌐 EN</a>
      <span class="nav-acc" id="nav-acc"><a href="/masuk" data-en="Log in">Masuk</a><a href="/daftar" class="btn btn-gold btn-sm" data-en="Sign Up">Daftar</a></span>
    </nav>
    <button class="burger" id="site-burger" type="button" aria-label="Menu" aria-expanded="false" aria-controls="site-menu">☰</button>
  </div></header>`;

  const risk = `<div class="disclaimer" id="risiko">
      <h4 data-en="⚠️ RISK WARNING">⚠️ PERINGATAN RISIKO</h4>
      <p data-en="${esc('<b>Trading forex, gold and crypto with leverage carries a very high risk and can lead to the loss of part or ALL of your capital.</b> Market conditions always change and cannot be predicted or controlled by anyone, including GoldHunter Garuda.')}"><b>Trading forex, emas dan kripto dengan leverage berisiko sangat tinggi dan dapat menyebabkan kehilangan sebagian atau SELURUH modal.</b> Kondisi pasar selalu berubah dan tidak dapat diprediksi maupun dikendalikan oleh siapa pun, termasuk GoldHunter Garuda.</p>
      <ul>
        <li data-en="${esc('GOLD HUNTER GARUDA is a martingale / averaging EA with an equity stop loss (setting 9.1, a loss limit you choose). It is a <b>trading tool</b>, not investment advice, not an investment product, not fund management, and it <b>does not guarantee profit</b>.')}">GOLD HUNTER GARUDA adalah EA martingale / averaging dengan stop loss equity (setting 9.1, batas rugi yang Anda pilih). Ini <b>alat bantu trading</b>, bukan nasihat investasi, bukan produk investasi, bukan pengelolaan dana, dan <b>tidak menjamin profit</b>.</li>
        <li data-en="${esc('The live reports, recommended setups and examples are <b>past records or illustrations</b> and do not guarantee future results. Results differ per account depending on capital, settings, start date and broker.')}">Laporan live, setup rekomendasi dan contoh perhitungan adalah <b>catatan masa lalu atau ilustrasi</b> dan tidak menjamin hasil di masa depan. Hasil tiap akun berbeda tergantung modal, setting, waktu mulai dan broker.</li>
        <li data-en="${esc('The decision to use the EA, the capital, the settings and the resulting risk are <b>entirely the user&#39;s responsibility</b>. GoldHunter Garuda and its admin are <b>not liable</b> for losses caused by market conditions, brokers, VPS, connections or the use of the EA.')}">Keputusan memakai EA, besar modal, setting dan risiko yang timbul <b>sepenuhnya tanggung jawab pengguna</b>. GoldHunter Garuda dan admin <b>tidak bertanggung jawab</b> atas kerugian akibat kondisi pasar, broker, VPS, koneksi atau pemakaian EA.</li>
        <li data-en="${esc('GoldHunter Garuda is <b>not a broker</b> and <b>does not accept, hold or manage trading funds</b>. Your funds stay in a broker account in your own name.')}">GoldHunter Garuda <b>bukan broker</b> dan <b>tidak menerima, menyimpan, atau mengelola dana trading</b>. Dana Anda berada di akun broker atas nama Anda sendiri.</li>
        <li data-en="${esc('Only use money you can afford to lose. By signing up and using this service you confirm that you have read, understood and accepted this warning.')}">Gunakan hanya dana yang siap Anda tanggung risikonya. Dengan mendaftar dan memakai layanan ini, Anda dianggap telah membaca, memahami dan menyetujui peringatan ini.</li>
      </ul>
    </div>`;

  const footer = `<footer class="site-foot"><div class="wrap">
    <div class="foot-grid">
      <div><a class="logo" href="/"><img src="/assets/brand/goldhunter-garuda-logo-128.png" width="36" height="36" alt=""><span><b class="gold-text">GOLD HUNTER</b><small>GARUDA</small></span></a>
        <p data-en="One Expert Advisor for MetaTrader 5. Focus on gold (XAUUSD), runs on every pair, with a recommended setup per pair from HQ.">Satu Expert Advisor untuk MetaTrader 5. Fokus emas (XAUUSD), jalan di semua pair, dengan setup rekomendasi per pair dari pusat.</p></div>
      <div><h4 data-en="Product">Produk</h4><ul>
        <li><a href="/live" data-en="Live reports">Laporan live</a></li><li><a href="/setup" data-en="Recommended setups">Setup rekomendasi</a></li>
        <li><a href="/harga" data-en="Pricing &amp; packages">Harga &amp; paket</a></li><li><a href="/cara-pasang" data-en="How to install">Cara pasang</a></li>
        <li><a href="/profit" data-en="Member results">Hasil member</a></li></ul></div>
      <div><h4 data-en="Account">Akun</h4><ul>
        <li><a href="/daftar" data-en="Sign up">Daftar</a></li><li><a href="/masuk" data-en="Log in">Masuk</a></li>
        <li><a href="/member" data-en="Member area">Member area</a></li><li><a href="/lupa-password" data-en="Forgot password">Lupa password</a></li></ul></div>
      <div><h4 data-en="Help">Bantuan</h4><ul id="foot-help">
        <li><a href="/cara-pasang#faq" data-en="Install FAQ">FAQ pemasangan</a></li><li><a href="/harga#faq" data-en="Licence FAQ">FAQ lisensi</a></li>
        <li><a href="#risiko" data-en="Risk warning">Peringatan risiko</a></li></ul></div>
    </div>
    ${risk}
    <p class="foot-copy">© <span id="foot-yr"></span> GOLD HUNTER GARUDA · MetaTrader 5 · All rights reserved.</p>
  </div></footer>
  <a class="wa-float" id="wa-float" hidden target="_blank" rel="noopener" aria-label="WhatsApp admin" title="WhatsApp admin"><svg viewBox="0 0 24 24" width="28" height="28" fill="#fff" aria-hidden="true"><path d="M17.5 14.4c-.3-.1-1.8-.9-2-1-.3-.1-.5-.1-.7.1-.2.3-.8 1-.9 1.2-.2.2-.3.2-.6.1-.3-.1-1.3-.5-2.4-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.6l.4-.5c.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5l-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.1.2 2.1 3.2 5.1 4.5.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.8-.7 2-1.4.2-.7.2-1.3.2-1.4-.1-.2-.3-.3-.6-.4zM12 2C6.5 2 2 6.5 2 12c0 1.8.5 3.5 1.3 4.9L2 22l5.2-1.4c1.4.8 3.1 1.2 4.8 1.2 5.5 0 10-4.5 10-10S17.5 2 12 2z"/></svg></a>`;

  document.body.classList.add('site');
  document.body.insertAdjacentHTML('afterbegin', header);
  document.body.insertAdjacentHTML('beforeend', footer);
  document.getElementById('foot-yr').textContent = new Date().getFullYear();

  // burger (phones / tablets)
  const menu = document.getElementById('site-menu'), burger = document.getElementById('site-burger');
  const setOpen = (o) => { menu.classList.toggle('open', o); burger.setAttribute('aria-expanded', o ? 'true' : 'false'); burger.textContent = o ? '✕' : '☰'; };
  burger.onclick = () => setOpen(!menu.classList.contains('open'));
  menu.addEventListener('click', (e) => { if (e.target.closest('a:not([data-lang-toggle])')) setOpen(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });

  // reveal on scroll
  const reveal = (root = document) => {
    const els = root.querySelectorAll('.reveal:not(.show)');
    if (!('IntersectionObserver' in window)) { els.forEach((el) => el.classList.add('show')); return; }
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('show'); io.unobserve(e.target); } }), { threshold: 0.08 });
    els.forEach((el) => io.observe(el));
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => reveal()); else reveal();

  // ---- shared data
  const catalog = fetch('/api/catalog', { credentials: 'same-origin' }).then((r) => r.json()).catch(() => null);
  const me = fetch('/api/me', { credentials: 'same-origin' }).then((r) => r.json()).then((r) => r.user || null).catch(() => null);
  // elements added after i18n.js ran: remember the Indonesian text and show the current language
  const loc = (root) => root && root.querySelectorAll('[data-en]').forEach((el) => {
    if (el.__gid !== undefined) return;
    el.__gid = el.innerHTML;
    if (window.GHG_LANG === 'en') el.innerHTML = el.getAttribute('data-en');
  });
  const waNum = (n) => String(n || '').replace(/\D/g, '').replace(/^0/, '62');
  const waLink = (num, text) => (num ? `https://wa.me/${waNum(num)}?text=${encodeURIComponent(text)}` : '');
  catalog.then((c) => {
    if (!c) return;
    const help = document.getElementById('foot-help');
    if (c.whatsapp) {
      const wa = document.getElementById('wa-float');
      wa.href = waLink(c.whatsapp, 'Halo Admin, saya ingin bertanya tentang GOLD HUNTER GARUDA.');
      wa.hidden = false;
      help.insertAdjacentHTML('afterbegin', `<li><a href="${esc(wa.href)}" target="_blank" rel="noopener" data-en="WhatsApp admin">WhatsApp admin</a></li>`);
    }
    if (c.telegram_link) help.insertAdjacentHTML('beforeend', `<li><a href="${esc(c.telegram_link)}" target="_blank" rel="noopener" data-en="Telegram channel">Channel Telegram</a></li>`);
    loc(help);
    document.querySelectorAll('[data-wa-plan]').forEach((el) => {
      if (!c.whatsapp) return;
      el.href = waLink(c.whatsapp, `Halo Admin, saya tertarik dengan *${el.dataset.waPlan || 'GOLD HUNTER GARUDA'}*. Mohon infonya.`);
      el.target = '_blank'; el.rel = 'noopener'; el.hidden = false;
    });
  });
  // logged in: the header goes straight to the member / admin area
  const accHtml = (u) => `<a href="/member" class="btn btn-gold btn-sm">Member Area</a>${u.role === 'admin' ? '<a href="/admin">Admin</a>' : ''}`;
  me.then((u) => {
    if (!u) return;
    const acc = document.getElementById('nav-acc');
    acc.innerHTML = accHtml(u);
    document.querySelectorAll('[data-guest-only]').forEach((el) => { el.hidden = true; });
    document.querySelectorAll('[data-member-only]').forEach((el) => { el.hidden = false; });
  });

  // ---- formatting
  const rp = (n) => 'Rp ' + Math.round(n || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const durL = (m) => (m === 18 ? TT('1,5 tahun', '1.5 years') : m >= 12 && m % 12 === 0 ? `${m / 12} ${TT('tahun', m === 12 ? 'year' : 'years')}` : `${m} ${TT('bulan', m === 1 ? 'month' : 'months')}`);
  const tx = (o, k) => (window.GHG_LANG === 'en' && o[k + '_en']) || o[k] || '';
  const num = (v, d = 0) => Number(v || 0).toLocaleString(TT('id-ID', 'en-US'), { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmtDate = (t) => { if (!t) return '-'; const d = new Date(t * 1000); return d.toLocaleDateString(TT('id-ID', 'en-GB'), { day: 'numeric', month: 'short', year: 'numeric' }); };

  // ---- packages (catalog): the four EA packages; rent has one price per duration
  const MAIN = ['ea_trial', 'ea_rent', 'ea_share', 'ea_ib'];
  function renderPlans(box, c, { note } = {}) {
    if (!box) return;
    const list = c ? c.products.filter((p) => MAIN.includes(p.kind)).sort((a, b) => MAIN.indexOf(a.kind) - MAIN.indexOf(b.kind)) : [];
    if (!list.length) { box.innerHTML = `<div class="empty-box" style="grid-column:1/-1">${TT('Hubungi admin untuk harga terbaru.', 'Ask the admin for the current prices.')}</div>`; return; }
    box.innerHTML = list.map((p) => {
      const feats = tx(p, 'features').split(/\r?\n/).filter(Boolean).map((f) => `<li>${esc(f)}</li>`).join('');
      let price = '', extra = '';
      if (p.kind === 'ea_rent' && p.prices) {
        const ms = Object.keys(p.prices).map(Number).sort((a, b) => a - b);
        const def = ms.includes(12) ? 12 : ms[0];
        extra = `<label class="sr-only" for="rent-${p.id}">${TT('Lama sewa', 'Rental period')}</label><select id="rent-${p.id}" data-rent="${p.id}">${ms.map((m) => `<option value="${m}" ${m === def ? 'selected' : ''}>${durL(m)} · ${rp(p.prices[m])}</option>`).join('')}</select><div class="save" data-save="${p.id}"></div>`;
        price = `<b data-rp="${p.id}">${rp(p.prices[def])}</b><small data-rl="${p.id}">/ ${durL(def)}</small>`;
      } else if (p.kind === 'ea_share') price = `<b>${c.share.pct}%</b><small>${TT('dari profit tertutup mingguan', 'of the weekly closed profit')}</small>`;
      else if (p.kind === 'ea_trial') price = `<b>${TT('GRATIS', 'FREE')}</b><small>${c.trial_days} ${TT('hari, langsung aktif', 'days, active at once')}</small>`;
      else price = `<b>${TT('GRATIS', 'FREE')}</b><small>${TT('untuk akun di bawah IB kami', 'for accounts under our IB')}</small>`;
      const best = p.kind === 'ea_share';
      const rib = { ea_share: TT('TANPA BIAYA DI DEPAN', 'NO UPFRONT FEE'), ea_trial: TT('MULAI DI SINI', 'START HERE') }[p.kind];
      const cta = { ea_trial: TT(`Coba Trial ${c.trial_days} Hari`, `Start ${c.trial_days}-Day Trial`), ea_rent: TT('Sewa Sekarang', 'Rent Now'), ea_share: TT('Mulai Sharing Profit', 'Start Profit Sharing'), ea_ib: TT('Ajukan EA Gratis', 'Apply for Free EA') }[p.kind];
      return `<div class="plan ${best ? 'best' : ''}">${rib ? `<div class="rib">${rib}</div>` : ''}
        <h3>${esc(tx(p, 'name'))}</h3><p class="desc">${esc(tx(p, 'description'))}</p>
        <div class="price">${price}</div>${extra}<ul>${feats}</ul>
        <a class="btn ${best || p.kind === 'ea_trial' ? 'btn-gold' : 'btn-outline'}" href="/member#/order/${p.id}">${cta}</a></div>`;
    }).join('');
    box.querySelectorAll('[data-rent]').forEach((sel) => {
      const p = c.products.find((x) => String(x.id) === sel.dataset.rent);
      const upd = () => {
        const m = Number(sel.value), v = p.prices[m], base = p.prices[1] || p.price, full = base * m;
        box.querySelector(`[data-rp="${p.id}"]`).textContent = rp(v);
        box.querySelector(`[data-rl="${p.id}"]`).textContent = '/ ' + durL(m);
        box.querySelector(`[data-save="${p.id}"]`).textContent = full > v ? TT(`Hemat ${Math.round((1 - v / full) * 100)}% (${rp(full - v)})`, `Save ${Math.round((1 - v / full) * 100)}% (${rp(full - v)})`) : '';
      };
      sel.onchange = upd; upd();
    });
    if (note) {
      const pays = [c.pay && c.pay.usdt ? TT('USDT TRC20 (otomatis)', 'USDT TRC20 (automatic)') : '', TT('transfer bank (kode unik)', 'bank transfer (unique code)'), c.pay && c.pay.gateway ? 'QRIS / virtual account' : ''].filter(Boolean);
      note.textContent = TT(`Bayar lewat ${pays.join(', ')}. Metode bisa diganti selama tagihan belum dibayar.`, `Pay by ${pays.join(', ')}. You can switch the method while the invoice is unpaid.`);
    }
  }

  // ---- recommended setup card
  const ICON = { XAUUSD: '🥇', BTCUSD: '₿', EURUSD: '💶', USDJPY: '💴', GBPUSD: '💷', US500: '📊', XAGUSD: '🥈' };
  const PAIR_NAME = () => ({ XAUUSD: TT('Emas', 'Gold'), BTCUSD: 'Bitcoin', EURUSD: 'Euro / Dolar', USDJPY: TT('Dolar / Yen', 'Dollar / Yen'), GBPUSD: 'Pound / Dolar', XAGUSD: TT('Perak', 'Silver') });
  // public card: pair + short description; details and the preset are in the member area
  function setupCard(s, ctx = {}) {
    const sum = tx(s, 'summary');
    const short = sum.length > 160 ? sum.slice(0, 157).replace(/\s+\S*$/, '') + '…' : sum;
    const btn = ctx.compact ? [`/setup#s${s.id}`, TT('Lihat setup', 'See setup')]
      : ctx.logged_in ? ['/member#/setup', TT('Detail & preset di member area', 'Details & preset in the member area')]
        : ['/masuk?next=/member', TT('Masuk untuk detail & preset', 'Log in for details & preset')];
    return `<article class="setup-card reveal" id="s${s.id}">
      <div class="sc-head"><span class="sc-ico" aria-hidden="true">${ICON[s.symbol] || '📈'}</span>
        <div class="sc-id"><b>${esc(s.symbol)}</b><small>${esc(tx(s, 'title') || PAIR_NAME()[s.symbol] || '')}</small></div></div>
      ${short ? `<p class="sc-sum">${esc(short)}</p>` : ''}
      <div class="sc-foot"><a class="btn btn-outline btn-sm" href="${btn[0]}">${btn[1]}</a></div>
    </article>`;
  }
  const setups = () => fetch('/api/setups', { credentials: 'same-origin' }).then((r) => r.json());

  return { loc, esc, TT, rp, durL, tx, num, fmtDate, catalog, me, waLink, renderPlans, setupCard, setups, ICON, reveal };
})();
