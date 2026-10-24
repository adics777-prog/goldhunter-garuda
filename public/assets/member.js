// Member area (hash router). Pages: beranda, order, pesanan, lisensi, ib, notifikasi, profil.
(() => {
  const { $, $$, esc, rupiah, fmtDate, fmtDateTime, ago, api, toast, busy, modal, confirmBox, readProof,
    orderBadge, licenseBadge, buildBadge, billingText, qrSvg, fillCapital, capitalLine, durLabel, kindBadge, PAY_LABEL, usd } = GHG;
  const view = $('#view');
  let me = null, catalog = null, timer = null;

  const getCatalog = async () => (catalog ||= await api('/catalog'));
  const title = (t, right = '') => `<div class="page-title"><h1>${t}</h1><div class="row">${right}</div></div>`;
  const features = (f) => String(f || '').split(/\r?\n/).filter(Boolean).map((x) => `<li>${esc(x)}</li>`).join('');
  const priceText = (p, c) => p.billing === 'free' ? 'GRATIS' : p.billing === 'trial' ? `GRATIS<span class="small muted"> ${c.trial_days} hari</span>`
    : p.billing === 'share' ? `${c.share.pct}%<span class="small muted"> dari profit / minggu</span>` : p.billing === 'lifetime' ? rupiah(p.price)
    : p.prices ? `<span class="small muted">mulai </span>${rupiah(Math.round(fromPerMonth(p, c)))}<span class="small muted"> /bulan</span>` : `${rupiah(p.price)}<span class="small muted"> /bulan</span>`;
  const waLink = (num, text) => num ? `https://wa.me/${String(num).replace(/\D/g, '').replace(/^0/, '62')}?text=${encodeURIComponent(text)}` : '';

  async function setupWhatsApp() {
    const c = await getCatalog().catch(() => null);
    if (c && c.telegram_link) { $('#tg-side').href = c.telegram_link; $('#tg-side').classList.remove('hidden'); }
    const wa = c && waLink(c.whatsapp, 'Halo admin GoldHunter Garuda, saya butuh bantuan');
    if (!wa) return;
    $('#wa-side').href = wa;
    $('#wa-side').classList.remove('hidden');
    const f = document.createElement('a');
    f.className = 'wa-float'; f.href = wa; f.target = '_blank'; f.rel = 'noopener'; f.title = 'Chat admin via WhatsApp';
    f.innerHTML = '<svg viewBox="0 0 24 24" width="28" height="28" fill="#fff"><path d="M17.5 14.4c-.3-.1-1.8-.9-2-1-.3-.1-.5-.1-.7.1-.2.3-.8 1-.9 1.2-.2.2-.3.2-.6.1-.3-.1-1.3-.5-2.4-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.6l.4-.5c.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5l-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.1.2 2.1 3.2 5.1 4.5.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.8-.7 2-1.4.2-.7.2-1.3.2-1.4-.1-.2-.3-.3-.6-.4zM12 2C6.5 2 2 6.5 2 12c0 1.8.5 3.5 1.3 4.9L2 22l5.2-1.4c1.4.8 3.1 1.2 4.8 1.2 5.5 0 10-4.5 10-10S17.5 2 12 2z"/></svg>';
    document.body.appendChild(f);
  }

  async function refreshMe() {
    const r = await api('/me');
    if (!r.user) { location.href = '/masuk?next=/member'; return; }
    me = r.user;
    $('#me-name').textContent = me.name;
    $('#me-email').textContent = me.email;
    $('#admin-link').classList.toggle('hidden', me.role !== 'admin');
    api('/orders').then((r) => {
      const n = r.orders.filter((o) => o.status === 'awaiting_payment' && o.total > 0).length;
      const b = $('#unpaid'); b.textContent = n; b.classList.toggle('hidden', !n);
    }).catch(() => {});
    const u = $('#unread');
    u.textContent = r.unread;
    u.classList.toggle('hidden', !r.unread);
  }

  // ------------------------------------------------------------------ router
  const routes = {
    '': home, order: orderPage, pesanan: ordersPage, bayar: payPage, lisensi: licensesPage, ib: ibPage, notifikasi: notifPage, profil: profilePage,
  };
  async function render() {
    clearInterval(timer);
    const [name, arg] = location.hash.replace(/^#\/?/, '').split('/');
    $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === (name || '')));
    $('#side').classList.remove('open');
    const fn = routes[name] || home;
    view.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
    try { await fn(arg); } catch (e) { view.innerHTML = `<div class="alert err">${esc(e.message)}</div>`; }
    window.scrollTo(0, 0);
    fillCapital(view);
  }
  window.addEventListener('hashchange', render);
  $('#burger').onclick = () => $('#side').classList.toggle('open');
  document.addEventListener('click', (e) => { if (e.target.id === 'side') $('#side').classList.remove('open'); });

  // ------------------------------------------------------------------ beranda
  async function home() {
    const [s, lic, n, c, lv] = await Promise.all([api('/member/summary'), api('/licenses'), api('/notifications'), getCatalog(),
      (typeof GHL !== 'undefined' ? GHL.load(true) : Promise.resolve(null)).catch(() => null)]);
    const vpsP = c.products.find((p) => p.requires_ib && p.includes_vps) || c.products.find((p) => p.includes_vps);
    const ibOffer = c.products.some((p) => p.requires_ib);
    // GOLD HUNTER GARUDA live: the EAs reporting from real accounts (one card per EA chart)
    const setups = lv && lv.setups ? lv.setups : [];
    const top = setups.slice().sort((a, b) => (b.online - a.online) || ((b.total_pct ?? -1e9) - (a.total_pct ?? -1e9))).slice(0, 4);
    const liveCard = `<div class="card gold" style="margin-bottom:22px">
        <div class="row between" style="flex-wrap:wrap;gap:10px;margin-bottom:12px"><h3 style="margin:0">📡 Laporan Live GOLD HUNTER GARUDA</h3>
          <div class="row" style="gap:8px;flex-wrap:wrap">${c.telegram_link ? `<a class="btn btn-outline btn-sm" href="${esc(c.telegram_link)}" target="_blank" rel="noopener">✈️ Gabung Telegram</a>` : ''}<a class="btn btn-gold btn-sm" href="/live">Buka laporan live</a></div></div>
        ${top.length ? `<div class="ghl-cards">${top.map((x) => GHL.card(x)).join('')}</div>` : '<p class="small muted">Akun live sedang disiapkan. Laporan live tampil di sini begitu EA-nya mulai mengirim data.</p>'}
        <p class="tiny muted" style="margin-top:12px">Bukan saran investasi. Trading berisiko tinggi; hasil masa lalu tidak menjamin hasil berikutnya.</p></div>`;
    const active = lic.licenses.filter((l) => l.status !== 'suspended').slice(0, 3);
    const bills = (await api('/orders')).orders.filter((o) => o.status === 'awaiting_payment' && o.total > 0);
    view.innerHTML = `
      ${title(`Halo, ${esc(me.name.split(' ')[0])} 👋`)}
      ${bills.length ? `<div class="alert warn" style="margin-bottom:18px">💳 Anda punya <b>${bills.length} tagihan</b> menunggu pembayaran${bills.length === 1 ? `: <b>${rupiah(bills[0].total)}</b>, jatuh tempo ${fmtDate(bills[0].pay_deadline)}` : ''}. <a href="#/bayar${bills.length === 1 ? '/' + bills[0].id : ''}">Bayar sekarang →</a></div>` : ''}
      ${liveCard}
      ${s.active_licenses || s.open_orders ? `<div class="grid c4" style="margin-bottom:22px">
        <a class="stat" href="#/lisensi"><b>${s.active_licenses}</b><span>Lisensi aktif</span></a>
        <a class="stat" href="#/pesanan"><b>${s.open_orders}</b><span>Pesanan berjalan</span></a>
        <a class="stat ${s.expiring_soon ? 'alert' : ''}" href="#/lisensi"><b>${s.expiring_soon}</b><span>Habis ≤ 7 hari</span></a>
      </div>` : ''}
      ${ibOffer ? `<div class="card gold" style="margin-bottom:22px">
        <div class="row between">
          <div style="max-width:620px"><h3 class="gold-text cinzel" style="font-size:1.3rem;margin-bottom:6px">EA GRATIS untuk akun Exness partner kami</h3>
            <p class="muted">Akun Exness Anda terdaftar di bawah partner GoldHunter Garuda? Maka EA GoldHunter Garuda <b style="color:var(--text)">gratis</b> untuk akun itu. Cukup modal <b data-cap="usd" style="color:var(--text)">$100</b> <span data-cap="idr"></span> di akun cent. Mau jalan 24 jam? Sewa VPS kami${vpsP ? ` <b style="color:var(--text)">${rupiah(vpsP.price)}/bulan</b>` : ''}.</p></div>
          <div class="row"><a class="btn btn-outline" href="#/ib">Syarat &amp; Panduan</a><a class="btn btn-gold" href="#/order">Order Sekarang</a></div>
        </div>
      </div>` : ''}
      <div class="grid c2">
        <div class="card"><div class="row between" style="margin-bottom:10px"><h3 style="margin:0">Lisensi Anda</h3><a href="#/lisensi" class="small">Lihat semua →</a></div>
          ${active.length ? active.map((l) => `<div class="row between" style="padding:10px 0;border-bottom:1px solid var(--line)">
              <div><b>${esc(l.account_number)}</b> <span class="muted small">${esc(l.broker)} · ${l.platform.toUpperCase()}</span><div class="small muted">${esc(l.product_name)}</div></div>
              <div class="right">${licenseBadge(l.status)}<div class="tiny muted">${l.expires_at ? 's/d ' + fmtDate(l.expires_at) : 'Selamanya'}</div></div></div>`).join('')
            : '<div class="empty">Belum ada lisensi. <a href="#/order">Order sekarang</a></div>'}
        </div>
        <div class="card"><div class="row between" style="margin-bottom:10px"><h3 style="margin:0">Notifikasi terbaru</h3><a href="#/notifikasi" class="small">Semua →</a></div>
          ${n.notifications.slice(0, 5).map((x) => `<div style="padding:9px 0;border-bottom:1px solid var(--line)"><div class="small"><b>${esc(x.title)}</b></div><div class="tiny muted">${ago(x.created_at)}</div></div>`).join('') || '<div class="empty">Belum ada notifikasi</div>'}
        </div>
      </div>`;
  }

  // ------------------------------------------------------------------ order
  const durationsOf = (p, c) => (p.durations && p.durations.length ? p.durations : c.durations);
  // price of a duration: rent has its own price per duration, other monthly packages = price x months - discount
  const priceFor = (p, m, c) => p.prices && p.prices[m] ? p.prices[m] : Math.round(p.price * m * (100 - Number(c.discounts[m] || 0)) / 100);
  const savePct = (p, m, c) => { const full = p.price * m, x = priceFor(p, m, c); return full > 0 && x < full ? Math.round((1 - x / full) * 100) : 0; };
  const fromPerMonth = (p, c) => Math.min(...durationsOf(p, c).map((m) => priceFor(p, m, c) / m));
  const MAIN_KINDS = ['ea_rent', 'ea_ib', 'ea_share', 'ea_trial'];
  async function orderPage(productId) {
    const c = await getCatalog();
    if (productId) return orderForm(c, c.products.find((p) => String(p.id) === productId));
    const card = (p) => {
      const tag = { ea_ib: 'KHUSUS IB', ea_share: 'TANPA BIAYA DI DEPAN', ea_trial: `GRATIS ${c.trial_days} HARI` }[p.kind];
      const btn = { ea_ib: 'Ajukan Gratis', ea_share: 'Aktifkan Sharing Profit', ea_trial: 'Mulai Trial' }[p.kind] || 'Pilih Paket';
      const durs = p.billing === 'monthly' && p.prices ? `<div class="choice" style="margin:8px 0 2px">${durationsOf(p, c).slice(0, 14).map((m) =>
        `<span class="tiny" style="padding:4px 10px;border:1px solid var(--line);border-radius:20px;background:var(--bg-2)">${durLabel(m)} <b>${rupiah(priceFor(p, m, c))}</b>${savePct(p, m, c) ? ` <span style="color:var(--green)">-${savePct(p, m, c)}%</span>` : ''}</span>`).join('')}</div>` : '';
      return `<div class="card product ${p.requires_ib || p.kind === 'ea_share' ? 'gold' : ''}">
        ${tag ? `<span class="badge ${p.kind === 'ea_share' ? 'b-green' : p.kind === 'ea_trial' ? 'b-blue' : 'b-gold'} ribbon">${tag}</span>` : ''}
        <h3 style="margin:0;padding-right:${tag ? 120 : 0}px">${esc(p.name)}</h3>
        <div class="price">${priceText(p, c)}</div>
        <p class="muted small">${esc(p.description)}</p>${durs}
        <ul>${features(p.features)}</ul>
        <a class="btn ${p.requires_ib || p.kind === 'ea_share' ? 'btn-gold' : 'btn-outline'}" href="#/order/${p.id}">${btn}</a>
      </div>`;
    };
    const main = c.products.filter((p) => MAIN_KINDS.includes(p.kind)), rest = c.products.filter((p) => !MAIN_KINDS.includes(p.kind));
    view.innerHTML = `${title('Order')}
      <p class="muted small" style="margin:-10px 0 18px">Semua paket memakai EA GOLD HUNTER GARUDA yang sama, terkunci di nomor akun Anda, update otomatis gratis. Bayar lewat transfer bank, USDT TRC20${c.pay && c.pay.gateway ? ' atau QRIS / Virtual Account' : ''}; metode bisa diganti selama belum dibayar.</p>
      ${main.length ? `<div class="grid c2" style="margin-bottom:30px">${main.map(card).join('')}</div>` : ''}
      ${rest.length ? `<h2 class="cinzel" style="font-size:1.15rem;margin-bottom:6px">🖥️ Paket + VPS</h2>
        <p class="muted small" style="margin-bottom:14px">EA berjalan 24 jam di VPS. Paket bertanda IB khusus akun di bawah partner kami (<a href="#/ib">panduan</a>).</p>
        <div class="grid c3">${rest.map(card).join('')}</div>` : ''}`;
  }

  function orderForm(c, p) {
    if (!p) { location.hash = '#/order'; return; }
    const ibBrokers = c.ib_brokers;
    const brokerField = p.requires_ib
      ? `<select name="broker">${ibBrokers.map((b) => `<option>${esc(b.name)}</option>`).join('')}</select>
         <div class="help">Akun harus terdaftar di bawah partner GoldHunter Garuda. <a href="#/ib">Panduan daftar / pindah partner →</a></div>`
      : `<select name="broker_sel"><option>Exness</option><option>HFM</option><option value="">Lainnya…</option></select>
         <input name="broker_other" class="hidden" placeholder="Nama broker" style="margin-top:8px">`;
    const durations = durationsOf(p, c).map((m, i) => {
      const d = savePct(p, m, c);
      return `<label><input type="radio" name="months" value="${m}" ${i === 0 ? 'checked' : ''}><span>${durLabel(m)} ${d ? `<small>-${d}%</small>` : ''}</span></label>`;
    }).join('');
    const share = p.billing === 'share', trial = p.billing === 'trial', free = p.billing === 'free';
    const submit = free ? 'Ajukan EA Gratis' : share ? 'Aktifkan Sharing Profit' : trial ? `Mulai Trial ${c.trial_days} Hari` : 'Buat Pesanan';
    view.innerHTML = `
      <div class="crumb"><a href="#/order">← Semua paket</a></div>
      ${title(esc(p.name))}
      <div class="grid c2" style="align-items:start">
        <form class="card" id="of" novalidate>
          ${p.requires_ib ? `<div class="alert warn" style="margin-bottom:16px">Syarat EA gratis: akun trading Anda <b>terdaftar di bawah IB kami</b>. Admin akan mengeceknya sebelum memproses.</div>` : ''}
          ${trial ? `<div class="alert info small" style="margin-bottom:16px">Trial <b>${c.trial_days} hari</b> langsung aktif tanpa menunggu admin. Hanya <b>sekali per nomor akun dan per member</b>.</div>` : ''}
          <div class="field"><label>Platform</label><div class="choice">
            <label><input type="radio" name="platform" value="mt5" checked><span>MetaTrader 5</span></label>
            <label><input type="radio" name="platform" value="mt4" ${c.mt4_enabled ? '' : 'disabled'}><span>MetaTrader 4${c.mt4_enabled ? '' : ' <i class="tiny" style="font-style:normal;opacity:.8">(segera hadir)</i>'}</span></label>
          </div></div>
          <div class="field"><label>Broker</label>${brokerField}</div>
          <div class="field"><label>Nomor akun trading (login MT)</label><input name="account_number" inputmode="numeric" placeholder="contoh: 183946672" required>
            <div class="help">EA akan dikunci hanya untuk nomor akun ini. Ganti nomor akun hanya bisa lewat pengajuan ke admin.</div></div>
          <div class="field"><label>Server broker ${p.managed_vps ? '' : '<span class="muted">(opsional)</span>'}</label><input name="broker_server" placeholder="contoh: Exness-MT5Real25">
            <div class="help">Terlihat di MetaTrader: File → Login to Trade Account, atau di email pembukaan akun dari broker.</div></div>
          ${p.managed_vps ? `<div class="field"><label>Password trading (password utama akun)</label><div class="pw-wrap"><input name="trading_password" type="password" autocomplete="off" required><button type="button" data-toggle-pw>lihat</button></div>
            <div class="help">Dipakai admin untuk login MetaTrader di VPS kami dan memasang EA. Disimpan terenkripsi. Bukan password Personal Area broker.</div></div>
            <div class="alert info small" style="margin-bottom:16px">🖥️ <b>VPS share dikelola admin.</b> Akun Anda dipasang di server kami dan <b>admin membantu setup sampai EA berjalan</b>. Anda tidak perlu mengurus VPS dan tidak mendapat akses Remote Desktop. Pantau lewat aplikasi MetaTrader di HP dengan <b>password investor</b> (akun pantau).</div>` : ''}
          ${p.includes_vps && !p.managed_vps ? `<div class="alert info small" style="margin-bottom:16px">🖥️ <b>VPS pribadi untuk Anda</b> (${esc(c.vps_spec || "Windows")}). Setelah pesanan selesai, IP, username dan password Remote Desktop muncul di menu <b>Lisensi &amp; VPS</b>. Anda login sendiri lalu memasang MetaTrader dan EA, dan bisa mengatur setting EA sesuka Anda.</div>` : ''}
          ${p.billing === 'monthly' ? `<div class="field"><label>Lama sewa</label><div class="choice">${durations}</div></div>` : ''}
          ${share ? `<div class="alert info small" style="margin-bottom:12px">💹 <b>Cara kerja sharing profit:</b> tiap hari <b>Minggu</b> Anda menerima laporan profit tertutup EA per chart untuk 7 hari sebelumnya dan tagihan komisi <b>${c.share.pct}%</b> dari total profitnya. Minggu tanpa profit tidak ditagih. Jatuh tempo <b>${c.share.due_days} hari</b>; bila belum dibayar, EA berhenti membuka posisi baru sampai lunas. EA wajib melapor ke web (WebRequest aktif), karena profit dihitung dari laporan EA.</div>
            <label class="row small" style="color:var(--text);margin-bottom:16px;align-items:flex-start"><input type="checkbox" name="agree_share" style="margin-top:4px"><span>Saya setuju komisi ${c.share.pct}% dari profit EA ditagih tiap minggu, dan EA berhenti membuka posisi baru bila tagihan lewat jatuh tempo.</span></label>` : ''}
          ${p.requires_ib ? `<div class="alert info small" style="margin-bottom:16px">Syarat akun: <b>Standard Cent (USC)</b>, mode <b>hedging</b>, pair XAUUSDc.<br>${capitalLine()}</div>` : ''}
          <button class="btn btn-gold btn-block" type="submit">${submit}</button>
        </form>
        <div class="card summary" id="sum"></div>
      </div>`;
    const f = $('#of');
    const sel = $('[name=broker_sel]', f);
    if (sel) sel.onchange = () => $('[name=broker_other]', f).classList.toggle('hidden', sel.value !== '');
    const calc = () => {
      const m = Number(new FormData(f).get('months')) || null;
      let rows = '', total = 0;
      if (free) rows = `<div class="row between"><span>Lisensi EA</span><b>GRATIS</b></div>`;
      else if (trial) rows = `<div class="row between"><span>Trial ${c.trial_days} hari</span><b>GRATIS</b></div>`;
      else if (share) rows = `<div class="row between"><span>Biaya di depan</span><b>Rp 0</b></div><div class="row between"><span>Komisi mingguan</span><b>${c.share.pct}% dari profit</b></div>`;
      else if (p.billing === 'lifetime') { total = p.price; rows = `<div class="row between"><span>Harga (selamanya)</span><b>${rupiah(p.price)}</b></div>`; }
      else {
        const gross = p.price * m;
        total = priceFor(p, m, c);
        rows = `<div class="row between"><span>${p.prices ? 'Sewa ' + durLabel(m) : `${rupiah(p.price)} × ${m} bulan`}</span><span>${rupiah(p.prices ? Math.max(gross, total) : gross)}</span></div>`
          + (gross > total ? `<div class="row between" style="color:var(--green)"><span>Hemat ${savePct(p, m, c)}%</span><span>- ${rupiah(gross - total)}</span></div>` : '');
      }
      const pays = ['transfer bank (kode unik)', c.pay && c.pay.usdt ? 'USDT TRC20 (otomatis)' : '', c.pay && c.pay.gateway ? 'QRIS / Virtual Account (otomatis)' : ''].filter(Boolean).join(', ');
      $('#sum').innerHTML = `<h3>Ringkasan</h3><div class="stack small">${rows}</div><hr>
        <div class="row between"><span>${share ? 'Bayar sekarang' : 'Total'}</span><span class="total">${total ? rupiah(total) : free || trial ? 'GRATIS' : 'Rp 0'}</span></div>
        ${total ? `<p class="tiny muted" style="margin-top:8px">Bayar dengan ${pays}. Metode bisa diganti selama belum dibayar.</p>` : ''}
        <hr><ol class="steps small">${free
          ? '<li><b>Ajukan</b>Isi nomor akun Exness Anda.</li><li><b>Admin cek IB</b>Akun dicek di portal partner.</li><li><b>EA dikirim</b>File EA terkunci di akun Anda, tanpa masa habis. Unduh di menu Lisensi.</li>'
          : trial || share ? `<li><b>Aktifkan</b>Isi nomor akun, klik tombol di kiri.</li><li><b>EA dibuat otomatis</b>File EA terkunci di akun Anda, siap dalam beberapa menit.</li><li><b>Pasang</b>Installer 1 file di menu Lisensi memasang EA &amp; update otomatis.</li>${share ? `<li><b>Tiap Minggu</b>Laporan profit + tagihan ${c.share.pct}% (minggu rugi gratis).</li>` : ''}`
          : `<li><b>Bayar</b>Pilih metode di halaman tagihan.</li><li><b>Terverifikasi</b>USDT / QRIS / VA otomatis; transfer bank dicek admin dari bukti transfer.</li>${p.requires_ib ? '<li><b>Admin cek IB</b>Akun dicek di portal partner.</li>' : ''}<li><b>Diproses</b>${p.managed_vps ? 'Admin memasang akun Anda di VPS dan menyalakan EA.' : p.includes_vps ? 'Admin menyiapkan VPS pribadi Anda' + (p.includes_ea ? ' + file EA dikunci ke akun Anda' : '') + '.' : 'File EA dikunci ke akun Anda, dibuat otomatis.'}</li>`}</ol>`;
    };
    f.onchange = calc;
    calc();
    f.onsubmit = async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(f));
      const body = { product_id: p.id, platform: d.platform, account_number: (d.account_number || '').trim(), broker_server: d.broker_server, trading_password: d.trading_password,
        months: Number(d.months) || null, agree_share: !!d.agree_share,
        broker: p.requires_ib ? d.broker : (d.broker_sel || d.broker_other || '').trim() };
      if (!/^\d{4,15}$/.test(body.account_number)) return toast('Nomor akun harus angka', 'err');
      if (share && !body.agree_share) return toast('Centang persetujuan sharing profit dulu', 'err');
      const r = await busy($('button[type=submit]', f), () => api('/orders', { method: 'POST', body }));
      toast(free ? 'Pengajuan terkirim!' : r.auto ? 'Disetujui otomatis. File EA sedang dibuat…' : 'Pesanan dibuat. Silakan pilih cara bayar.');
      location.hash = (free || r.auto ? '#/pesanan/' : '#/bayar/') + r.id;
      refreshMe();
    };
  }

  // ------------------------------------------------------------------ pesanan
  const orderWhat = (o) => o.kind === 'share' ? 'Tagihan sharing profit' : o.kind === 'renew' ? 'Perpanjangan' : '';
  async function ordersPage(id) {
    if (id) return orderDetail(id);
    const { orders } = await api('/orders');
    view.innerHTML = `${title('Pesanan Saya', '<a class="btn btn-gold btn-sm" href="#/order">+ Order baru</a>')}
      ${orders.length ? `<div class="table-wrap"><table><thead><tr><th>Kode</th><th>Paket</th><th>Akun</th><th>Total</th><th>Status</th><th>Tanggal</th></tr></thead><tbody>
        ${orders.map((o) => `<tr class="click" onclick="location.hash='#/pesanan/${o.id}'"><td class="mono">${esc(o.code)}</td>
          <td>${esc(o.product_name)}${orderWhat(o) ? ` <span class="badge b-gray">${orderWhat(o)}</span>` : ''}<div class="tiny muted">${billingText(o, o.months)}</div></td>
          <td>${esc(o.account_number)}<div class="tiny muted">${esc(o.broker)} · ${o.platform.toUpperCase()}</div></td>
          <td class="nowrap">${o.total ? rupiah(o.total) : 'Gratis'}${o.pay_method ? `<div class="tiny muted">${PAY_LABEL[o.pay_method] || ''}</div>` : ''}</td><td>${orderBadge(o.status)}</td><td class="nowrap small">${fmtDate(o.created_at)}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="card empty">Belum ada pesanan. <a href="#/order">Order sekarang</a></div>'}`;
  }

  // Total with the unique code highlighted, e.g. Rp 450.123
  const totalHtml = (o) => {
    const t = rupiah(o.total);
    if (!o.unique_code) return t;
    const tail = String(o.unique_code).padStart(3, '0');
    return t.endsWith(tail) ? `${t.slice(0, -tail.length)}<span style="color:var(--green);text-decoration:underline">${tail}</span>` : t;
  };
  const bankList = (banks) => (banks || []).length ? `<div class="banks">${banks.map((b) => `
      <div class="bank-card"><div class="bank-name">${esc(b.bank)}</div>
        <div class="bank-num mono">${esc(b.number)}</div>
        ${b.name ? `<div class="tiny muted">a.n. <b style="color:var(--text)">${esc(b.name)}</b></div>` : ''}
        <button class="btn btn-ghost btn-sm" type="button" data-copy="${esc(String(b.number).replace(/[\s-]/g, ''))}">Salin nomor</button></div>`).join('')}</div>`
    : '<div class="alert warn small">Rekening tujuan belum diatur admin. Pilih metode lain atau hubungi admin.</div>';
  const waButton = (whatsapp, text, label = '💬 Ada kendala? Chat admin via WhatsApp') => {
    const wa = waLink(whatsapp, text);
    return wa ? `<a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="${wa}">${label}</a>` : '';
  };
  // Weekly sharing report (per EA chart + total)
  const shareTable = (r) => !r ? '' : `<div class="table-wrap" style="margin:10px 0"><table><thead><tr><th>Chart EA</th><th class="right">Profit tertutup</th><th class="right">USD</th></tr></thead><tbody>
      ${(r.rows || []).map((x) => `<tr><td>${esc(x.label)}<div class="tiny muted">${esc(x.symbol)} · magic ${x.magic}${x.source === 'harian' ? ' · perkiraan' : ''}</div></td>
        <td class="right nowrap">${Number(x.profit).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${esc(x.currency)}</td><td class="right nowrap">${x.profit_usd == null ? '-' : usd(x.profit_usd)}</td></tr>`).join('')
        || '<tr><td colspan="3" class="muted small">Tidak ada laporan EA pada periode ini.</td></tr>'}
      <tr><td><b>Total</b></td><td></td><td class="right"><b>${usd(r.profit_usd)}</b></td></tr></tbody></table></div>
      <div class="small">Periode ${fmtDate(r.period_start)} – ${fmtDate(r.period_end - 1)} · komisi ${r.commission_pct}% = <b>${usd(r.commission_usd)}</b>${r.commission_idr ? ` (${rupiah(r.commission_idr)})` : ''}${r.note ? `<div class="tiny muted">${esc(r.note)}</div>` : ''}</div>`;

  async function orderDetail(id) {
    const { order: o, whatsapp, report } = await api('/orders/' + id);
    const free = !o.total && o.kind !== 'share';
    const auto = o.billing === 'trial' || o.billing === 'share';
    const steps = [
      [o.kind === 'share' ? 'Tagihan dibuat' : 'Pesanan dibuat', o.created_at],
      ...(free ? [[auto ? 'Disetujui otomatis' : 'Pengajuan diterima', o.confirmed_at]] : [[o.paid_via && o.paid_via !== 'bank' ? `Pembayaran ${PAY_LABEL[o.paid_via] || ''} terverifikasi otomatis` : 'Pembayaran diterima', o.paid_at]]),
      ...(o.requires_ib && o.kind === 'new' ? [['Akun dicek di bawah IB kami', o.ib_status === 'yes' ? o.ib_checked_at || 1 : null]] : []),
      ...(o.kind === 'share' ? [['Lunas', o.completed_at]] : [['Diproses', o.processed_at], ['Selesai', o.completed_at]]),
    ];
    let action = '';
    if (o.status === 'awaiting_payment') {
      action = `<div class="card gold"><h3>${o.kind === 'share' ? 'Tagihan sharing profit' : 'Menunggu pembayaran'}</h3>
        ${o.admin_note && o.confirmed_at ? `<div class="alert err small" style="margin-bottom:12px">Bukti transfer sebelumnya belum bisa kami terima: ${esc(o.admin_note)}. Silakan kirim ulang.</div>` : ''}
        <div class="summary" style="margin:6px 0 14px"><div class="muted small">Total${o.unique_code ? ` (transfer bank, kode unik <b>${o.unique_code}</b>)` : ''}</div><span class="total">${totalHtml(o)}</span>
          <div class="tiny muted">Bayar sebelum <b>${fmtDateTime(o.pay_deadline)}</b>${o.pay_method ? ` · metode: <b>${PAY_LABEL[o.pay_method] || o.pay_method}</b>` : ''}</div></div>
        <div class="row"><a class="btn btn-gold" href="#/bayar/${o.id}">💳 Bayar sekarang</a>
          ${o.proof_file_id || o.kind === 'share' ? '' : '<button class="btn btn-red btn-sm" type="button" id="cancel">Batalkan pesanan</button>'}</div>
        <div style="margin-top:12px">${waButton(whatsapp, `Halo admin GoldHunter Garuda, saya ada kendala pembayaran pesanan ${o.code}`)}</div></div>`;
    } else if (o.status === 'awaiting_verification') {
      action = `<div class="alert ok">${free
        ? '✅ Pengajuan diterima. Admin sedang mengecek bahwa akun Anda terdaftar di bawah IB kami, lalu <b>segera memproses</b>.'
        : o.paid_via ? '✅ Pembayaran sudah diterima. Admin mengecek akun Anda di bawah IB kami, lalu pesanan segera diproses.'
        : `✅ Bukti transfer diterima. Admin sedang mengecek pembayaran Anda, lalu pesanan <b>segera diproses</b>. <a href="#/bayar/${o.id}">Ganti bukti transfer</a>`}</div>`;
    } else if (o.status === 'processing') {
      action = `<div class="alert info">⚙️ ${o.paid_at ? 'Pembayaran sudah diterima. ' : auto ? 'Disetujui otomatis. ' : ''}Pesanan sedang diproses${o.includes_ea ? ': file EA dikunci ke nomor akun Anda dan dibuat otomatis' : ''}${o.includes_vps ? (o.managed_vps ? ', akun Anda dipasang di VPS kami' : ', VPS pribadi Anda disiapkan') : ''}. <a href="#/lisensi">Lisensi &amp; VPS →</a></div>`;
    } else if (o.status === 'completed') {
      action = `<div class="alert ok">🎉 ${o.kind === 'share' ? 'Tagihan lunas. Terima kasih!' : 'Pesanan selesai.'} <a href="#/lisensi">Buka Lisensi &amp; VPS →</a></div>`;
    } else if (o.status === 'rejected') {
      action = `<div class="alert err">Pesanan ditolak. ${o.admin_note ? 'Alasan: ' + esc(o.admin_note) : ''}${o.requires_ib ? ' <a href="#/ib">Lihat panduan daftar / pindah partner</a>.' : ''}</div>`;
    } else {
      action = `<div class="alert">Pesanan ${o.status === 'expired' ? 'kedaluwarsa karena belum dibayar' : 'dibatalkan'}.</div>`;
    }
    view.innerHTML = `
      <div class="crumb"><a href="#/pesanan">← Pesanan saya</a></div>
      ${title(`${o.kind === 'share' ? 'Tagihan' : 'Pesanan'} <span class="mono" style="font-family:monospace">${esc(o.code)}</span>`, orderBadge(o.status, o.status_label))}
      <div class="grid c2" style="align-items:start">
        <div class="stack">${action}
          ${report ? `<div class="card"><h3>📊 Laporan profit mingguan</h3>${shareTable(report)}</div>` : ''}
          <div class="card"><h3>Detail</h3><dl class="kv">
            <dt>Paket</dt><dd>${esc(o.product_name)} ${kindBadge(o.product_kind)}${orderWhat(o) ? ` <span class="badge b-gray">${orderWhat(o)}</span>` : ''}</dd>
            <dt>Durasi</dt><dd>${billingText(o, o.months)}</dd>
            <dt>Platform</dt><dd>${o.platform.toUpperCase()}</dd>
            <dt>Broker</dt><dd>${esc(o.broker)}${o.broker_server ? ' · ' + esc(o.broker_server) : ''}</dd>
            <dt>Nomor akun</dt><dd><b>${esc(o.account_number)}</b></dd>
            ${o.total ? `${o.kind === 'share' ? `<dt>Komisi</dt><dd>${usd(o.amount_usd)} = ${rupiah(o.subtotal)}</dd>` : `<dt>Harga</dt><dd>${o.months ? rupiah(o.subtotal) + ' (' + durLabel(o.months) + ')' : rupiah(o.unit_price)}${o.discount_pct ? ` <span class="badge b-green">hemat ${o.discount_pct}%</span>` : ''}</dd>`}
            ${o.unique_code ? `<dt>Kode unik (bank)</dt><dd><b style="color:var(--green)">${o.unique_code}</b></dd>` : ''}
            <dt>Total transfer bank</dt><dd><b>${totalHtml(o)}</b></dd>
            ${o.paid_via ? `<dt>Dibayar lewat</dt><dd>${PAY_LABEL[o.paid_via] || esc(o.paid_via)}${o.usdt_tx ? `<div class="tiny mono" style="overflow-wrap:anywhere">${esc(o.usdt_tx)}</div>` : ''}</dd>` : ''}` : '<dt>Biaya</dt><dd><b>GRATIS</b></dd>'}
          </dl></div>
        </div>
        <div class="card"><h3>Status</h3><ul class="timeline">${steps.map(([t, at]) => `<li class="${at ? 'done' : ''}">${t}${at > 1 ? `<div class="tiny muted">${fmtDateTime(at)}</div>` : ''}</li>`).join('')}</ul>
          ${waButton(whatsapp, `Halo admin GoldHunter Garuda, saya mau tanya pesanan ${o.code}`, '💬 Tanya admin via WhatsApp')}</div>
      </div>`;
    const cancel = $('#cancel');
    if (cancel) cancel.onclick = async () => {
      if (!(await confirmBox('Batalkan pesanan?', `Pesanan ${esc(o.code)} akan dibatalkan.`, 'Ya, batalkan', true))) return;
      await api(`/orders/${o.id}/cancel`, { method: 'POST', body: {} }).then(() => { toast('Pesanan dibatalkan'); render(); refreshMe(); }, (e) => toast(e.message, 'err'));
    };
    // trial / sharing / paid order still being built: refresh until it is ready
    if (o.status === 'processing') timer = setInterval(async () => {
      const r = await api('/orders/' + id).catch(() => null);
      if (r && r.order.status !== 'processing') { clearInterval(timer); render(); }
    }, 8000);
  }

  // ------------------------------------------------------------------ tagihan & pembayaran
  async function payPage(id) {
    const c = await getCatalog();
    if (!id) {
      const { orders } = await api('/orders');
      const unpaid = orders.filter((o) => o.total > 0 && ['awaiting_payment', 'awaiting_verification'].includes(o.status));
      if (unpaid.length === 1 && unpaid[0].status === 'awaiting_payment') { location.replace('#/bayar/' + unpaid[0].id); return; }
      view.innerHTML = `${title('Tagihan &amp; Pembayaran')}
        ${unpaid.length ? `<p class="muted" style="margin-bottom:14px">Tagihan perpanjangan sewa dibuat otomatis sebelum masa sewa habis; tagihan sharing profit dibuat tiap hari Minggu.</p>
          <div class="table-wrap"><table><thead><tr><th>Tagihan</th><th>Paket</th><th>Akun</th><th>Total</th><th>Jatuh tempo</th><th>Status</th><th></th></tr></thead><tbody>
          ${unpaid.map((o) => `<tr><td class="mono small">${esc(o.code)}<div class="tiny muted">${o.kind === 'share' ? 'Sharing profit' : o.kind === 'renew' ? 'Perpanjangan ' + durLabel(o.months) : 'Pesanan baru'}</div></td><td>${esc(o.product_name)}</td><td>${esc(o.account_number)}</td><td class="nowrap"><b>${rupiah(o.total)}</b></td>
            <td class="small nowrap">${fmtDate(o.pay_deadline)}</td><td>${orderBadge(o.status)}</td><td><a class="btn btn-gold btn-sm" href="#/bayar/${o.id}">${o.status === 'awaiting_payment' ? 'Bayar' : 'Lihat'}</a></td></tr>`).join('')}</tbody></table></div>`
          : '<div class="card empty">Tidak ada tagihan. <a href="#/pesanan">Lihat pesanan saya</a></div>'}
        <div style="margin-top:16px">${waButton(c.whatsapp, 'Halo admin GoldHunter Garuda, saya ada kendala pembayaran')}</div>`;
      return;
    }
    const d = await api('/orders/' + id);
    const { order: o, banks, whatsapp, usdt, gateway, report } = d;
    if (!['awaiting_payment', 'awaiting_verification'].includes(o.status) || !o.total) { location.replace('#/pesanan/' + o.id); return; }
    const methods = [['bank', '🏦 Transfer Bank'], ...(usdt ? [['usdt', '💠 USDT TRC20']] : []), ...(gateway ? [['gateway', '⚡ QRIS / Virtual Account']] : [])];
    let cur = (methods.find((m) => m[0] === o.pay_method) || methods[0])[0];
    if (o.status === 'awaiting_verification') cur = 'bank';
    const durs = o.kind === 'renew' && o.status === 'awaiting_payment' && !o.proof_file_id && (d.durations || []).length > 1 ? d.durations : [];
    const product = c.products.find((x) => x.id === o.product_id) || { price: o.unit_price, prices: o.product_prices ? JSON.parse(o.product_prices) : null, durations: d.durations };
    view.innerHTML = `
      <div class="crumb"><a href="#/pesanan/${o.id}">← ${o.kind === 'share' ? 'Tagihan' : 'Pesanan'} ${esc(o.code)}</a></div>
      ${title(o.kind === 'share' ? 'Tagihan Sharing Profit' : o.kind === 'renew' ? 'Tagihan Perpanjangan' : 'Pembayaran')}
      <div class="grid c2" style="align-items:start">
        <div class="card gold" id="paycard">
          <div class="summary" style="margin-bottom:14px"><div class="muted small">${esc(o.code)} · ${esc(o.product_name)} · akun ${esc(o.account_number)}</div>
            <div class="small" style="margin-top:4px">${o.kind === 'share' ? `Komisi ${usd(o.amount_usd)} = <b>${rupiah(o.subtotal)}</b>` : `Tagihan <b>${rupiah(o.subtotal)}</b>${o.months ? ' · ' + durLabel(o.months) : ''}`}</div>
            <div class="tiny muted">Jatuh tempo ${fmtDateTime(o.pay_deadline)}${o.kind === 'share' ? ' (setelah itu EA berhenti membuka posisi baru sampai lunas)' : ''}</div></div>
          ${report ? `<details style="margin-bottom:14px"><summary class="small" style="cursor:pointer;color:var(--gold)">📊 Lihat laporan profit minggu ini</summary>${shareTable(report)}</details>` : ''}
          ${durs.length ? `<div class="field"><label>Lama perpanjangan (bisa diganti sebelum bayar)</label><div class="choice" id="inv-months">${durs.map((m) =>
            `<label><input type="radio" name="inv_m" value="${m}" ${m === o.months ? 'checked' : ''}><span>${durLabel(m)} · ${rupiah(priceFor(product, m, c))}</span></label>`).join('')}</div></div>` : ''}
          ${o.status === 'awaiting_verification' ? `<div class="alert info small" style="margin-bottom:14px">${o.paid_via ? 'Pembayaran sudah diterima; admin sedang mengecek.' : 'Bukti transfer sudah Anda kirim dan sedang dicek admin. Isi form di bawah hanya jika ingin mengganti bukti.'}</div>` : ''}
          <div class="field"><label>Metode pembayaran${o.status === 'awaiting_payment' ? ' (bisa diganti kapan saja sebelum bayar)' : ''}</label>
            <div class="choice" id="pm">${methods.map(([k, l]) => `<label><input type="radio" name="pm" value="${k}" ${k === cur ? 'checked' : ''} ${o.status !== 'awaiting_payment' && k !== cur ? 'disabled' : ''}><span>${l}</span></label>`).join('')}</div></div>
          <div id="pmbox"></div>
        </div>
        <div class="stack">
          <div class="card"><h3>Cara bayar</h3><ul class="small muted" style="margin-left:18px;line-height:1.8">
            <li><b style="color:var(--text)">Transfer bank</b>: nominal tepat + kode unik, upload bukti, dicek admin.</li>
            ${usdt ? `<li><b style="color:var(--text)">USDT TRC20</b>: nominal unik per tagihan, ${usdt.auto ? 'dicek otomatis di blockchain' : 'dicek admin'}.</li>` : ''}
            ${gateway ? '<li><b style="color:var(--text)">QRIS / Virtual Account</b>: lunas otomatis begitu dibayar.</li>' : ''}
            <li>Setelah lunas, ${o.kind === 'share' ? 'lisensi berlanjut ke minggu berikutnya' : 'lisensi &amp; file EA dibuat'} otomatis.</li></ul></div>
          <div class="card"><h3>Ada kendala?</h3><p class="small muted" style="margin-bottom:12px">Salah nominal, transfer gagal, atau bukti tidak bisa diupload? Hubungi admin, sebutkan kode <b>${esc(o.code)}</b>.</p>
            ${waButton(whatsapp, `Halo admin GoldHunter Garuda, saya ada kendala pembayaran ${o.code} (total ${rupiah(o.total)})`, '💬 Chat Admin via WhatsApp') || '<span class="muted small">Kontak admin belum diatur.</span>'}</div>
        </div>
      </div>`;
    const box = $('#pmbox');
    const check = async (btn, tx) => {
      const r = await (btn ? busy(btn, () => api(`/orders/${o.id}/check`, { method: 'POST', body: { tx: tx || '' } })) : api(`/orders/${o.id}/check`, { method: 'POST', body: {} }).catch(() => null));
      if (!r) return;
      if (r.paid) { clearInterval(timer); toast('Pembayaran diterima ✔'); refreshMe(); location.hash = '#/pesanan/' + o.id; return; }
      if (btn) toast(r.note || 'Pembayaran belum terdeteksi. Coba lagi beberapa menit lagi (jaringan perlu konfirmasi).', r.note ? 'err' : 'ok');
    };
    const poll = () => { clearInterval(timer); timer = setInterval(() => { if (!document.hidden) check(null); }, 20000); };
    const showBank = () => {
      box.innerHTML = `<div class="summary" style="margin-bottom:14px"><div class="muted small">Transfer tepat (termasuk kode unik <b>${o.unique_code}</b>)</div>
          <div class="row between"><span class="total">${totalHtml(o)}</span><button class="btn btn-outline btn-sm" type="button" data-copy="${o.total}">Salin nominal</button></div></div>
        <div style="margin-bottom:16px">${bankList(banks)}</div>
        <form id="cf" novalidate><h3 style="margin-top:4px">Konfirmasi transfer</h3>
          ${o.status === 'awaiting_payment' && o.admin_note && o.confirmed_at ? `<div class="alert err small" style="margin-bottom:14px">Bukti sebelumnya belum bisa kami terima: ${esc(o.admin_note)}</div>` : ''}
          <div class="grid c2" style="gap:0 14px"><div class="field"><label>Nama pemilik rekening pengirim</label><input name="payer_name" value="${esc(o.payer_name || me.name)}" required></div>
          <div class="field"><label>Dari bank / e-wallet</label><input name="payer_bank" value="${esc(o.payer_bank)}" placeholder="BCA / BRI / DANA" required></div></div>
          <div class="field"><label>Foto / screenshot bukti transfer</label><input type="file" name="proof" accept="image/*,application/pdf" required>
            <div class="help">Pastikan nominal, tanggal dan rekening tujuan terlihat jelas. Foto otomatis dikecilkan.</div></div>
          <div class="field"><label>Catatan untuk admin (opsional)</label><input name="note" value="${esc(o.member_note)}"></div>
          <button class="btn btn-gold btn-block" type="submit">Kirim Bukti Transfer</button></form>`;
      const cf = $('#cf');
      cf.onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(cf);
        await busy($('button[type=submit]', cf), async () => {
          const proof = await readProof(fd.get('proof') && fd.get('proof').size ? fd.get('proof') : null);
          await api(`/orders/${o.id}/confirm`, { method: 'POST', body: { payer_name: fd.get('payer_name'), payer_bank: fd.get('payer_bank'), note: fd.get('note'), proof } });
        });
        toast('Terima kasih! Bukti transfer terkirim, admin segera mengecek.');
        location.hash = '#/pesanan/' + o.id;
        refreshMe();
      };
    };
    const showUsdt = () => {
      const u = usdt;
      box.innerHTML = `<div class="usdt-card" style="margin-top:0">
          <div class="row between" style="gap:10px;flex-wrap:wrap"><b>💠 USDT · jaringan TRC20 (TRON)</b>${u.rate ? `<span class="tiny muted">kurs ${rupiah(u.rate)} / USD</span>` : ''}</div>
          <div class="row" style="gap:16px;align-items:center;flex-wrap:wrap;margin-top:10px">
            ${u.qr ? '<img src="/api/usdt-qr" alt="QR alamat USDT" class="usdt-qr">' : ''}
            <div style="flex:1;min-width:200px">
              <div class="tiny muted">Kirim tepat (nominal unik tagihan ini)</div>
              <div class="row" style="gap:8px;align-items:center"><span class="total" style="font-size:1.3rem">${Number(u.amount).toFixed(2)} USDT</span><button class="btn btn-ghost btn-sm" type="button" data-copy="${Number(u.amount).toFixed(2)}">Salin</button></div>
              <div class="tiny muted" style="margin-top:8px">Alamat TRC20</div>
              <div class="mono small" style="overflow-wrap:anywhere">${esc(u.address)}</div>
              <button class="btn btn-ghost btn-sm" type="button" style="margin-top:6px" data-copy="${esc(u.address)}">Salin alamat</button>
            </div></div>
          <div class="alert warn small" style="margin-top:10px">Kirim <b>hanya lewat jaringan TRON (TRC20)</b>; jaringan lain (ERC20, BEP20) = dana tidak bisa kembali. Pastikan jumlah yang <b>diterima</b> tepat <b>${Number(u.amount).toFixed(2)} USDT</b> (biaya penarikan exchange jangan dipotong dari nominal ini).</div>
          ${u.auto ? `<p class="small" style="margin:12px 0 8px">Pembayaran dicek <b>otomatis</b> di blockchain (±1–5 menit setelah konfirmasi jaringan). Halaman ini mengecek sendiri tiap 20 detik.</p>
            <div class="field" style="margin-bottom:8px"><label>TX hash (opsional, bila jumlah terpotong biaya exchange)</label><input id="txh" class="mono" placeholder="64 karakter" autocomplete="off"></div>
            <button class="btn btn-gold btn-block" type="button" id="paid-check">✔ Saya sudah bayar, cek sekarang</button>`
            : `<p class="small muted" style="margin-top:12px">Setelah kirim, pilih "Transfer Bank" lalu upload screenshot + TX hash di catatan agar admin mengecek.</p>`}
        </div>`;
      const pc = $('#paid-check');
      if (pc) pc.onclick = () => check(pc, ($('#txh').value || '').trim());
      if (u.auto) poll();
    };
    const showGateway = () => {
      const t = gateway.current && gateway.current.expired_time > Date.now() / 1000 ? gateway.current : null;
      const chans = gateway.channels || [];
      box.innerHTML = `${gateway.sandbox ? '<div class="alert warn small" style="margin-bottom:10px">Mode SANDBOX (uji coba): pembayaran tidak sungguhan.</div>' : ''}
        <div class="field"><label>Pilih QRIS atau bank Virtual Account</label><div class="choice" id="tpc">${chans.map((x) =>
          `<label><input type="radio" name="tpc" value="${esc(x.code)}" ${t && t.method === x.code ? 'checked' : ''}><span>${esc(x.name)}</span></label>`).join('') || '<span class="small muted">Belum ada channel aktif.</span>'}</div></div>
        <div id="tpbox">${t ? `<div class="summary">
            <div class="row between"><b>${esc(t.payment_name)}</b><span class="tiny muted">berlaku s/d ${fmtDateTime(t.expired_time)}</span></div>
            <div class="row between" style="margin-top:8px"><span class="muted small">Total bayar${t.fee_customer ? ` (termasuk biaya ${rupiah(t.fee_customer)})` : ''}</span><span class="total" style="font-size:1.3rem">${rupiah(t.amount)}</span></div>
            ${t.qr_string || t.qr_url ? `<div style="text-align:center;margin:12px 0">${t.qr_string && qrSvg(t.qr_string, 220) ? `<div class="qr">${qrSvg(t.qr_string, 220)}</div>` : `<img src="${esc(t.qr_url)}" alt="QRIS" style="width:220px;max-width:100%;background:#fff;border-radius:10px;padding:8px">`}<div class="tiny muted">Scan dengan aplikasi e-wallet / m-banking apa saja</div></div>` : ''}
            ${t.pay_code ? `<div class="tiny muted" style="margin-top:10px">Nomor Virtual Account</div><div class="row" style="gap:8px"><span class="mono" style="font-size:1.2rem;font-weight:700;overflow-wrap:anywhere">${esc(t.pay_code)}</span><button class="btn btn-ghost btn-sm" type="button" data-copy="${esc(t.pay_code)}">Salin</button></div>` : ''}
            ${(t.instructions || []).map((i) => `<details style="margin-top:8px"><summary class="small" style="cursor:pointer">${esc(i.title)}</summary><ol class="small muted" style="margin:6px 0 0 18px">${i.steps.map((x) => `<li>${esc(x).replace(/&lt;(\/?)b&gt;/g, '<$1b>')}</li>`).join('')}</ol></details>`).join('')}
            ${t.checkout_url ? `<a class="btn btn-ghost btn-sm" style="margin-top:10px" target="_blank" rel="noopener" href="${esc(t.checkout_url)}">Buka halaman pembayaran ${esc(t.provider_name || gateway.name)} ↗</a>` : ''}
          </div>
          <button class="btn btn-gold btn-block" type="button" id="paid-check" style="margin-top:12px">✔ Saya sudah bayar, cek sekarang</button>` : '<p class="small muted">Pilih salah satu di atas untuk membuat kode bayar.</p>'}</div>`;
      $('#tpc') && ($('#tpc').onchange = async (e) => {
        try { await api(`/orders/${o.id}/method`, { method: 'POST', body: { method: 'gateway', channel: e.target.value } }); render(); }
        catch (err) { toast(err.message, 'err'); }
      });
      const pc = $('#paid-check');
      if (pc) { pc.onclick = () => check(pc); poll(); }
    };
    const show = async (k) => {
      clearInterval(timer);
      if (k === 'usdt' && !usdt.locked) {
        // lock the unique USDT amount of this invoice first, then show it
        if (o.status !== 'awaiting_payment') return showBank();
        try { await api(`/orders/${o.id}/method`, { method: 'POST', body: { method: 'usdt' } }); } catch (err) { toast(err.message, 'err'); return; }
        return render();
      }
      (k === 'usdt' ? showUsdt : k === 'gateway' ? showGateway : showBank)();
    };
    show(cur);
    $('#pm').onchange = async (e) => {
      const k = e.target.value;
      if (k === 'bank') { try { await api(`/orders/${o.id}/method`, { method: 'POST', body: { method: 'bank' } }); } catch (err) { toast(err.message, 'err'); return; } }
      show(k);                                        // USDT locks its amount, QRIS / VA asks for the channel
    };
    const im = $('#inv-months');
    if (im) im.onchange = async (e) => {
      try { await api(`/orders/${o.id}/months`, { method: 'POST', body: { months: Number(e.target.value) } }); toast('Durasi tagihan diganti'); render(); }
      catch (err) { toast(err.message, 'err'); }
    };
  }

  // Monitoring from a phone with the read-only (investor) password
  const monitorGuide = (name = 'Exness') => `<div class="card"><h3>📱 Pantau dari HP dengan akun pantau (password investor)</h3>
      <p class="small muted" style="margin-bottom:12px">Disarankan memantau lewat aplikasi MetaTrader di HP memakai <b>password investor</b>. Password ini hanya bisa <b>melihat</b> posisi, profit dan riwayat, tidak bisa membuka/menutup order, jadi aman dan tidak mengganggu EA yang berjalan.</p>
      <ol class="steps small">
        <li><b>Buat password investor</b>Di MetaTrader PC/VPS: menu <i>Tools → Options → Server → Change</i>, pilih <i>Change investor (read only) password</i>. Bisa juga lewat pengaturan akun trading di Personal Area ${esc(name)}. Pengguna VPS share boleh minta dibuatkan oleh admin.</li>
        <li><b>Pasang aplikasi MetaTrader 5</b>Dari Play Store (Android) atau App Store (iPhone). Gratis.</li>
        <li><b>Login akun</b>Buka aplikasi → <i>Pengaturan → Akun baru / Login ke akun yang ada</i> → cari broker <b>${esc(name)}</b> → pilih server akun Anda → isi <b>nomor akun</b> dan <b>password investor</b>.</li>
        <li><b>Pantau</b>Tab <i>Trade</i> untuk posisi berjalan dan floating, tab <i>History</i> untuk profit. Jangan login memakai password utama di banyak perangkat sekaligus.</li>
      </ol></div>`;

  // Profit report sent by the EA (shown on the public progress board)
  const reportBox = (l) => {
    const r = l.report;
    if (!r) return `<div class="small muted" style="margin-top:12px">📈 Laporan profit: <b>belum masuk</b>. Izinkan WebRequest di MetaTrader agar progress Anda tampil (panduan di bawah).</div>`;
    const cur = esc(r.currency);
    const f = (v) => `${v < 0 ? '-' : '+'}${Math.abs(v).toLocaleString('id-ID', { maximumFractionDigits: 2 })} ${cur}`;
    const modal = r.total_ok ? r.balance - r.total_profit : null;
    const days = r.started_at ? Math.max(0, Math.floor((Date.now() / 1000 - r.started_at) / 86400)) : 0;
    const tot = r.total_ok ? ` · sejak mulai (${days} hari) <b>${f(r.total_profit)}</b>${modal > 0 ? ` (${(r.total_profit / modal * 100 >= 0 ? '+' : '')}${(r.total_profit / modal * 100).toFixed(2)}% modal)` : ''}` : '';
    return `<div class="small" style="margin-top:12px">📈 Laporan EA ${ago(r.updated_at)}: hari ini <b>${f(r.profit_day)}</b> · minggu ini <b>${f(r.profit_week)}</b> · bulan ini <b>${f(r.profit_month)}</b>${tot}</div>`;
  };
  const reportGuide = () => `<div class="card"><h3>📈 Aktifkan laporan profit ke web (sekali saja)</h3>
      <p class="small muted" style="margin-bottom:12px">EA mengirim lama trading, modal dan profit (sejak mulai, bulan, minggu, hari) ke papan <a href="/profit" target="_blank" rel="noopener">Hasil Member</a> di web, nama Anda disensor. EA tetap trading normal walaupun langkah ini belum dilakukan.</p>
      <ol class="steps small">
        <li><b>Buka pengaturan MetaTrader</b>Menu <i>Tools → Options</i> (atau tekan <span class="mono">Ctrl+O</span>), tab <i>Expert Advisors</i>.</li>
        <li><b>Izinkan alamat web</b>Centang <i>Allow WebRequest for listed URL</i>, klik tanda <b>+</b>, ketik <span class="copy mono" data-copy="https://goldhuntergaruda.com">https://goldhuntergaruda.com</span>, lalu <b>OK</b>.</li>
        <li><b>Selesai</b>Dalam ±5 menit laporan pertama masuk dan tampil di kartu lisensi Anda. Nama di papan tampil singkat (misal "Budi S****"); minta admin jika ingin disamarkan.</li>
      </ol></div>`;

  // Automatic EA updates + setup backup on the member's own VPS (agent in licence mode): the one-file installer
  // (also for moving to a new VPS), the 3 manual files, the latest setup backup and each agent's last status
  const vpsAutoBox = (l, multi) => {
    const dl = (f, name) => `<a class="btn btn-outline btn-sm" href="/api/licenses/${l.id}/agent?f=${f}">⬇ ${name}</a>`;
    const mt = l.platform === 'mt4' ? 'MetaTrader 4' : 'MetaTrader 5';
    const acc = esc(l.account_number);
    const agents = l.vps_agents || [];
    const st = agents.length ? agents.map((a) => {
      const on = Date.now() / 1000 - a.updated_at < 600;
      const cur = l.build && a.build_id === l.build.id;
      return `<div class="tiny" style="margin-top:6px">${on ? '<span style="color:#6ee7a2">● terhubung</span>' : '<span style="color:#ff8b95">● tidak melapor</span>'}
        <b>${esc(a.host)}</b> · EA ${a.version ? 'v' + esc(a.version) : '-'}${a.build_id ? ` (build #${a.build_id})` : ''} ${cur ? '<span class="badge b-green">terbaru</span>' : ''}
        · terakhir ${ago(a.updated_at)}${a.note && a.note !== 'ok' ? `<div class="muted">${esc(a.note)}</div>` : ''}</div>`;
    }).join('') : '<div class="tiny muted" style="margin-top:6px">Status: <b>belum terhubung</b></div>';
    const pb = l.profile_backup;
    const backup = pb
      ? `<div class="tiny" style="margin-top:8px">💾 Backup setup terakhir: <b>${ago(pb.updated_at)}</b> <span class="muted">(${fmtDateTime(pb.updated_at)})</span> dari <b>${esc(pb.host)}</b> · ${pb.charts} chart, EA di ${pb.ea_charts} chart</div>`
      : '<div class="tiny muted" style="margin-top:8px">💾 Backup setup: <b>belum ada</b>. Dibuat otomatis oleh agen begitu EA terpasang di chart.</div>';
    return `<div class="summary" style="margin-top:14px"><div class="small"><b style="color:var(--gold)">🔄 Pasang EA &amp; update otomatis</b></div>
      <p class="tiny muted" style="margin:4px 0 10px">Satu file untuk PC / VPS baru maupun yang sudah jalan: EA + preset terpasang di setiap ${mt} yang login di akun ${acc}, versi baru &amp; preset baru masuk sendiri. Setting chart Anda tidak pernah diubah.</p>
      <a class="btn btn-gold btn-block" href="/api/licenses/${l.id}/installer" style="white-space:normal;text-align:center">⬇ Unduh installer GOLD HUNTER GARUDA</a>
      <ol class="steps-list small" style="margin-top:12px">
        <li>Pasang <b>${mt}</b> dari broker Anda, login akun <b>${acc}</b> dengan password <b>trading</b> dan centang <b>Save password</b>.</li>
        <li>Buat folder <span class="mono" style="word-break:break-all">C:\\GOLD HUNTER GARUDA</span> lalu pindahkan file yang diunduh (<b style="word-break:break-word">GOLD HUNTER GARUDA - Installer ${acc}.cmd</b>) ke folder itu.</li>
        <li>Klik dua kali file itu, lalu klik <b>Yes</b>. Muncul "Windows protected your PC"? Klik <i>More info → Run anyway</i>.</li>
        <li><b>Selesai.</b> EA + preset terpasang di setiap ${mt} yang login di akun ini, update otomatis aktif, setting chart Anda tidak pernah diubah.</li></ol>
      <details class="tiny" style="margin-top:8px"><summary class="muted" style="cursor:pointer">Diblokir Windows Defender / antivirus?</summary>
        <p class="muted" style="margin:6px 0">File installer berisi skrip pemasang sehingga kadang ditahan. Di browser pilih <b>Keep</b> / <b>Simpan tetap</b>. Bila Windows Security menghapusnya: buka <i>Windows Security → Virus &amp; threat protection → Protection history</i>, pilih file GOLD HUNTER GARUDA → <b>Actions → Allow</b> (atau <i>Restore</i>), lalu unduh ulang. Boleh juga tambahkan folder <span class="mono" style="word-break:break-all">C:\\GOLD HUNTER GARUDA</span> di <i>Virus &amp; threat protection settings → Exclusions</i>. Unduh installer hanya dari member area ini.</p></details>
      <details class="tiny" style="margin-top:6px"><summary class="muted" style="cursor:pointer">Sudah ada EA berjalan? Pindah VPS?</summary>
        <p class="muted" style="margin:6px 0">${mt} yang sudah menjalankan EA GOLD HUNTER GARUDA hanya mendapat file EA + preset terbaru: chart, setting &amp; input tidak disentuh. Setup terakhir dari backup hanya dipasang ke ${mt} yang belum berisi EA (PC / VPS baru). Installer boleh dijalankan ulang dari folder lain: agen lama otomatis dipindah ke folder baru.</p></details>
      <details class="tiny" style="margin-top:6px"><summary class="muted" style="cursor:pointer">Pasang manual (3 file)</summary>
        <p class="muted" style="margin:6px 0">Unduh ke <b>satu folder</b> (mis. <span class="mono" style="word-break:break-all">C:\\GOLD HUNTER GARUDA</span>), klik kanan <b>Pasang-Agen-VPS.bat</b> → <b>Run as administrator</b>. ${mt} harus login di akun ${acc}.</p>
        <div class="row" style="gap:8px">${dl('agent', 'GHG-VPS-Agent.ps1')}${dl('install', 'Pasang-Agen-VPS.bat')}${dl('config', 'config.json')}</div>
        ${multi ? `<p class="muted" style="margin:6px 0 0">Beberapa akun di satu VPS? Jalankan installer tiap akun (folder yang sama), atau pakai <a href="/api/licenses/${l.id}/agent?f=config&amp;all=1">config.json gabungan semua akun</a>.</p>` : ''}</details>
      <p class="tiny muted" style="margin:8px 0 0">Installer &amp; config.json berisi kunci lisensi akun ini, jangan dibagikan.</p>
      ${backup}${st}</div>`;
  };

  // Sharing profit: the last weekly reports of a licence
  const SHARE_ST = { invoiced: ['b-orange', 'Ditagih'], no_profit: ['b-gray', 'Tanpa profit'], below_min: ['b-gray', 'Di bawah minimum'], no_data: ['b-red', 'EA tidak melapor'] };
  const shareBox = (l) => {
    const reps = l.share.reports || [];
    return `<div class="summary" style="margin-top:14px"><div class="small"><b style="color:var(--gold)">💹 Laporan sharing profit mingguan</b></div>
      <p class="tiny muted" style="margin:4px 0 8px">Tiap Minggu: profit tertutup EA per chart untuk 7 hari sebelumnya, komisi dari total profit. Minggu ini dihitung mulai ${fmtDate(l.share.next_period_start)}.</p>
      ${reps.length ? `<div class="table-wrap"><table><thead><tr><th>Periode</th><th class="right">Profit</th><th class="right">Komisi</th><th>Status</th></tr></thead><tbody>${reps.map((r) => {
        const st = r.order_id ? (r.order_status === 'completed' ? ['b-green', 'Lunas'] : ['b-orange', 'Belum dibayar']) : (SHARE_ST[r.status] || ['b-gray', r.status]);
        return `<tr><td class="nowrap small">${fmtDate(r.period_start)} – ${fmtDate(r.period_end - 1)}<div class="tiny muted">${(r.rows || []).length} chart</div></td><td class="right nowrap">${usd(r.profit_usd)}</td>
          <td class="right nowrap">${r.commission_idr ? rupiah(r.commission_idr) : '-'}</td><td><span class="badge ${st[0]}">${st[1]}</span>${r.order_id && r.order_status !== 'completed' ? ` <a class="tiny" href="#/bayar/${r.order_id}">Bayar</a>` : r.order_id ? ` <a class="tiny" href="#/pesanan/${r.order_id}">Detail</a>` : ''}</td></tr>`;
      }).join('')}</tbody></table></div>` : '<div class="tiny muted">Belum ada laporan. Laporan pertama dikirim hari Minggu.</div>'}</div>`;
  };

  // ------------------------------------------------------------------ lisensi
  async function licensesPage() {
    const [{ licenses, changes, renewals }, c] = await Promise.all([api('/licenses'), getCatalog()]);
    const multi = licenses.filter((l) => l.includes_ea && l.status === 'active' && !l.managed_vps).length > 1;
    const card = (l) => {
      const ch = changes.filter((x) => x.license_id === l.id);
      const renewing = renewals.find((r) => r.license_id === l.id && r.kind === 'renew');
      const shareDue = renewals.filter((r) => r.license_id === l.id && r.kind === 'share' && r.status === 'awaiting_payment');
      const pct = l.expires_at && l.days_left > 0 ? Math.min(100, Math.round(l.days_left / 31 * 100)) : 0;
      const b = l.build;
      let ea = '';
      if (l.includes_ea) {
        if (l.status === 'active' && b && b.status === 'done' && b.file_id) {
          ea = `<a class="btn btn-gold btn-sm" href="/api/files/${b.file_id}">⬇ Unduh EA (.${l.platform === 'mt4' ? 'ex4' : 'ex5'})</a>
            <span class="tiny muted">v${esc(b.ea_version || '-')} · dibuat ${fmtDate(b.finished_at)}</span>`;
        } else if (l.build_pending) ea = `<span class="badge b-blue">File EA sedang dibuat…</span>`;
        else if (l.status === 'expired') ea = `<span class="muted small">Perpanjang untuk mengunduh EA lagi.</span>`;
        else ea = `<span class="muted small">File EA tersedia setelah pesanan selesai.</span>`;
      }
      const vps = l.includes_vps && l.managed_vps
        ? `<div class="summary" style="margin-top:14px"><div class="small" style="margin-bottom:6px"><b style="color:var(--gold)">🖥️ VPS share, dikelola admin</b></div>
            <p class="small muted">${l.status === 'active' ? 'Akun Anda berjalan di VPS kami. Admin yang mengurus MetaTrader &amp; EA.' : 'Admin sedang memasang akun Anda di VPS.'} Pantau dari HP dengan password investor (panduan di bawah).</p>
            ${l.vps_note ? `<p class="small" style="margin-top:8px">Catatan admin: ${esc(l.vps_note)}</p>` : ''}</div>`
        : l.includes_vps ? (l.vps_ip
        ? `<div class="summary" style="margin-top:14px"><div class="small muted" style="margin-bottom:6px">VPS (dikelola admin)</div><dl class="kv small">
            <dt>IP / Host</dt><dd><span class="copy mono" data-copy="${esc(l.vps_ip)}">${esc(l.vps_ip)}</span></dd>
            ${l.vps_user ? `<dt>Username</dt><dd><span class="copy mono" data-copy="${esc(l.vps_user)}">${esc(l.vps_user)}</span></dd>` : ''}
            ${l.vps_pass ? `<dt>Password</dt><dd><span class="copy mono" data-copy="${esc(l.vps_pass)}">••••••••</span> <span class="tiny muted">(klik untuk salin)</span></dd>` : ''}
            ${l.vps_note ? `<dt>Catatan</dt><dd>${esc(l.vps_note)}</dd>` : ''}</dl>
            <div class="small" style="margin-top:14px;padding-top:12px;border-top:1px solid var(--line)"><b style="color:var(--gold)">Cara masuk &amp; memantau VPS (Remote Desktop)</b>
              <ol style="margin:8px 0 0 18px;color:#d6d6de;line-height:1.7"><li><b>Laptop/PC Windows:</b> tekan <span class="mono">Win + R</span>, ketik <span class="mono">mstsc</span>, Enter. Isi IP, klik Connect, lalu masukkan username &amp; password di atas.</li>
              <li><b>HP Android / iPhone / Mac:</b> pasang aplikasi <b>Windows App</b> (Microsoft Remote Desktop), tambah PC dengan IP di atas, lalu login.</li>
              <li>Di dalam VPS: pasang MetaTrader dari broker Anda, login akun trading, salin file EA ke folder MQL5 → Experts, lalu pasang di chart (lihat panduan di bawah).</li>
              <li>Untuk memantau, login kapan saja dengan cara yang sama dan lihat MetaTrader yang berjalan di dalam VPS.</li>
              <li>Jangan pilih <i>Shut down</i> atau <i>Sign out</i> di VPS. Cukup tutup jendela Remote Desktop (tombol ✕), VPS dan MetaTrader tetap jalan 24 jam.</li></ol></div></div>`
        : `<div class="alert info small" style="margin-top:14px">VPS sedang disiapkan admin.</div>`) : '';
      return `<div class="card license ${l.status}">
        <div class="row between"><div><div class="tiny muted">${esc(l.product_name)} ${kindBadge(l.product_kind)}</div>
          <div style="font-size:1.25rem;font-weight:700">${esc(l.account_number)} <span class="small muted" style="font-weight:400">${esc(l.broker)} · ${l.platform.toUpperCase()}</span></div>
          ${l.broker_server ? `<div class="tiny muted">${esc(l.broker_server)}</div>` : ''}</div>${licenseBadge(l.status)}</div>
        <div style="margin:14px 0">${l.expires_at
          ? `<div class="row between small"><span>${l.requires_ib ? 'Sewa VPS' : 'Masa aktif'} s/d <b>${fmtDate(l.expires_at)}</b></span><span class="${l.days_left <= 7 ? 'badge b-orange' : 'muted'}">${l.days_left > 0 ? l.days_left + ' hari lagi' : 'sudah habis'}</span></div><div class="bar"><i style="width:${pct}%"></i></div>`
          : '<div class="small">Masa aktif: <b>Selamanya</b></div>'}
          ${l.requires_ib && l.includes_vps ? '<div class="tiny muted" style="margin-top:4px">EA gratis (IB) tidak kedaluwarsa; yang diperpanjang hanya sewa VPS.</div>' : ''}
          ${l.billing === 'share' ? `<div class="tiny muted" style="margin-top:4px">Sharing profit ${c.share.pct}%: berlaku per minggu, diperpanjang otomatis tiap tagihan lunas (minggu tanpa profit gratis).</div>` : ''}
          ${l.billing === 'trial' ? '<div class="tiny muted" style="margin-top:4px">Trial: setelah habis, lanjutkan dengan Sewa EA atau Sharing Profit di menu Order.</div>' : ''}</div>
        ${shareDue.length ? `<div class="alert warn small" style="margin-bottom:12px">💳 ${shareDue.map((r) => `Tagihan sharing <b>${esc(r.code)}</b> ${rupiah(r.total)}, jatuh tempo ${fmtDate(r.pay_deadline)} <a href="#/bayar/${r.id}">Bayar →</a>`).join('<br>')}</div>` : ''}
        <div class="row">${ea}</div>${vps}${l.includes_ea ? reportBox(l) : ''}
        ${l.share ? shareBox(l) : ''}
        ${l.includes_ea && l.status === 'active' && !l.managed_vps ? vpsAutoBox(l, multi) : ''}
        <div class="row" style="margin-top:16px">
          ${l.billing === 'monthly' && ['active', 'expired'].includes(l.status) ? (renewing
            ? (renewing.status === 'awaiting_payment'
              ? `<a class="btn btn-gold btn-sm" href="#/bayar/${renewing.id}">💳 Bayar tagihan ${rupiah(renewing.total)}</a> <span class="tiny muted">jatuh tempo ${fmtDate(renewing.pay_deadline)}</span>`
              : `<a class="btn btn-outline btn-sm" href="#/pesanan/${renewing.id}">Perpanjangan ${esc(renewing.code)} →</a>`)
            : `<button class="btn btn-gold btn-sm" data-renew="${l.id}">↻ Perpanjang</button>`) : ''}
          ${l.billing === 'trial' ? '<a class="btn btn-gold btn-sm" href="#/order">Lanjut berlangganan</a>' : ''}
          ${l.status === 'active' ? `<button class="btn btn-ghost btn-sm" data-change="${l.id}" ${ch.some((x) => x.status === 'pending') ? 'disabled title="Menunggu admin"' : ''}>Ajukan ganti nomor akun</button>` : ''}
        </div>
        ${ch.length ? `<div class="small" style="margin-top:14px">${ch.map((x) => `<div class="row between" style="padding:6px 0;border-top:1px solid var(--line)">
            <span>Ganti akun ${esc(x.old_account)} → <b>${esc(x.new_account)}</b> <span class="tiny muted">${fmtDate(x.created_at)}</span>${x.admin_note ? `<div class="tiny muted">Admin: ${esc(x.admin_note)}</div>` : ''}</span>
            <span class="badge ${{ pending: 'b-orange', approved: 'b-green', rejected: 'b-red' }[x.status]}">${{ pending: 'Menunggu admin', approved: 'Disetujui', rejected: 'Ditolak' }[x.status]}</span></div>`).join('')}</div>` : ''}
      </div>`;
    };
    view.innerHTML = `${title('Lisensi &amp; VPS', '<a class="btn btn-gold btn-sm" href="#/order">+ Order baru</a>')}
      ${licenses.length ? `<div class="grid c2">${licenses.map(card).join('')}</div>` : '<div class="card empty">Belum ada lisensi. Lisensi muncul di sini setelah pesanan diproses admin. <a href="#/order">Order sekarang</a></div>'}
      <div class="card" style="margin-top:22px"><h3>Cara memasang EA di MetaTrader 5</h3><ol class="steps small">
        <li><b>Unduh file .ex5</b>Klik "Unduh EA" di atas. File hanya berjalan di nomor akun yang tertera.</li>
        <li><b>Salin ke folder Experts</b>Di MetaTrader 5: File → Open Data Folder → MQL5 → Experts, tempel file .ex5, lalu klik kanan Navigator → Refresh.</li>
        <li><b>Pasang di chart</b>Buka chart pair sesuai paket Anda (lihat keterangan lisensi), seret EA ke chart, centang "Allow Algo Trading", lalu nyalakan tombol Algo Trading.</li>
        <li><b>Ganti file saat diperbarui</b>Setelah perpanjangan atau ganti akun, unduh file baru dan timpa file lama. Atau pasang agen <b>Update otomatis VPS</b> (di kartu lisensi) supaya file baru terpasang sendiri.</li></ol></div>
      <div style="margin-top:22px">${monitorGuide()}</div>
      ${licenses.some((l) => l.includes_ea) ? `<div style="margin-top:22px">${reportGuide()}</div>` : ''}`;
    $$('[data-renew]').forEach((b) => b.onclick = () => renewModal(licenses.find((l) => l.id == b.dataset.renew), c));
    $$('[data-change]').forEach((b) => b.onclick = () => changeModal(licenses.find((l) => l.id == b.dataset.change)));
  }

  function renewModal(l, c) {
    const p = c.products.find((x) => x.id === l.product_id) || { price: 0, durations: c.durations };
    const m = modal(`Perpanjang akun ${l.account_number}`, `
      <p class="muted small" style="margin-bottom:14px">${esc(l.product_name)} · berakhir ${fmtDate(l.expires_at)}. Masa baru dihitung dari tanggal berakhir (atau dari hari ini jika sudah habis).</p>
      <form id="rf"><div class="field"><label>Lama perpanjangan</label><div class="choice">${durationsOf(p, c).map((mo, i) => {
        const d = savePct(p, mo, c);
        return `<label><input type="radio" name="months" value="${mo}" ${i === 0 ? 'checked' : ''}><span>${durLabel(mo)} ${d ? `<small>-${d}%</small>` : ''}</span></label>`;
      }).join('')}</div></div>
      <div class="summary"><div class="row between"><span>Total</span><span class="total" id="rt"></span></div></div>
      <button class="btn btn-gold btn-block" style="margin-top:16px" type="submit">Buat Tagihan Perpanjangan</button></form>`);
    const f = $('#rf', m.el);
    const calc = () => { const mo = Number(new FormData(f).get('months')); $('#rt', m.el).textContent = rupiah(priceFor(p, mo, c)); };
    f.onchange = calc; calc();
    f.onsubmit = async (e) => {
      e.preventDefault();
      const r = await busy($('button[type=submit]', f), () => api(`/licenses/${l.id}/renew`, { method: 'POST', body: { months: Number(new FormData(f).get('months')) } }));
      m.close();
      location.hash = '#/bayar/' + r.id;
    };
  }

  function changeModal(l) {
    const m = modal(`Ganti nomor akun ${l.account_number}`, `
      <p class="muted small" style="margin-bottom:14px">Pengajuan dicek admin. Setelah disetujui, file EA dibuat ulang untuk nomor akun baru, dan file lama tidak berlaku untuk akun baru.
      ${l.requires_ib ? '<br><b>Akun baru juga harus terdaftar di bawah IB kami.</b>' : ''}</p>
      <form id="chf" novalidate>
        <div class="field"><label>Nomor akun baru</label><input name="new_account" inputmode="numeric" required></div>
        <div class="field"><label>Server broker akun baru ${l.managed_vps ? '' : '<span class="muted">(opsional)</span>'}</label><input name="new_server" placeholder="contoh: Exness-MT5Real25"></div>
        ${l.managed_vps ? `<div class="field"><label>Password trading akun baru</label><div class="pw-wrap"><input name="new_password" type="password" autocomplete="off"><button type="button" data-toggle-pw>lihat</button></div></div>` : ''}
        <div class="field"><label>Alasan</label><textarea name="reason" placeholder="contoh: akun lama ditutup / pindah ke akun cent baru"></textarea></div>
        <button class="btn btn-gold btn-block" type="submit">Kirim Pengajuan</button></form>`);
    const f = $('#chf', m.el);
    f.onsubmit = async (e) => {
      e.preventDefault();
      await busy($('button[type=submit]', f), () => api(`/licenses/${l.id}/change-account`, { method: 'POST', body: Object.fromEntries(new FormData(f)) }));
      m.close();
      toast('Pengajuan terkirim, menunggu persetujuan admin');
      render();
    };
  }

  // ------------------------------------------------------------------ syarat EA gratis (akun di bawah IB GoldHunter Garuda)
  async function ibPage(tab) {
    const c = await getCatalog();
    const vps = c.products.find((p) => p.requires_ib && p.includes_vps);
    const brokers = c.ib_brokers;
    const b = brokers[0];
    const link = b ? b.link : '';
    const name = b ? b.name : 'Exness';
    tab = tab === 'pindah' ? 'pindah' : 'baru';
    const linkBox = b ? `
      <div class="card gold"><div class="row" style="align-items:flex-start;gap:24px">
        <div class="qr" title="Scan untuk daftar ${esc(name)}">${qrSvg(link)}</div>
        <div style="flex:1;min-width:240px"><h3 class="cinzel" style="font-size:1.25rem">Link partner GoldHunter Garuda di ${esc(name)}</h3>
          <p class="muted small" style="margin-bottom:14px">Scan QR dengan kamera HP atau klik tombol di bawah. Link ini dipakai untuk <b>daftar akun baru</b> dan juga untuk <b>formulir pindah partner</b>.</p>
          <div class="row"><a class="btn btn-gold" href="${esc(link)}" target="_blank" rel="noopener">Buka link ${esc(name)} →</a>
          <button class="btn btn-ghost btn-sm" data-copy="${esc(link)}">Salin link</button></div>
          <p class="tiny muted mono" style="margin-top:10px;word-break:break-all">${esc(link)}</p></div>
      </div></div>` : '<div class="alert">Link partner belum diatur admin.</div>';
    const tabs = `<div class="choice" style="margin:22px 0 14px">
      <label><input type="radio" name="t" value="baru" ${tab === 'baru' ? 'checked' : ''}><span>① Belum punya akun ${esc(name)}</span></label>
      <label><input type="radio" name="t" value="pindah" ${tab === 'pindah' ? 'checked' : ''}><span>② Sudah punya akun ${esc(name)} (pindah partner)</span></label></div>`;
    const finish = `<li><b>Ajukan EA gratis di sini</b>Menu <a href="#/order">Order</a> → <i>EA Gratis (Akun IB ${esc(name)})</i>, isi nomor akun trading Anda.${vps ? ` Ingin jalan 24 jam? Pilih <i>${esc(vps.name)}</i> (VPS pribadi ${rupiah(vps.price)}/bulan).` : ''}</li>
      <li><b>Admin cek &amp; kirim EA</b>Admin memastikan akun Anda terdaftar di bawah partner GoldHunter Garuda, lalu file EA (terkunci di nomor akun Anda) bisa diunduh di menu <a href="#/lisensi">Lisensi &amp; VPS</a>.</li>`;
    const guideNew = `<div class="card"><h3>Panduan ①: Daftar akun ${esc(name)} baru lewat link kami</h3><ol class="steps small">
      <li><b>Buka link / scan QR di atas</b>Halaman pendaftaran ${esc(name)} terbuka. Pastikan Anda mendaftar dari link ini agar akun otomatis tercatat di bawah partner GoldHunter Garuda.</li>
      <li><b>Isi data pendaftaran</b>Pilih negara Indonesia, isi email dan buat password. Gunakan email yang <b>belum pernah</b> dipakai di ${esc(name)}.</li>
      <li><b>Verifikasi profil</b>Di Personal Area: verifikasi email, nomor HP, lalu upload KTP dan bukti alamat.</li>
      <li><b>Buat akun trading MT5 Standard Cent</b>Personal Area → <i>Akun Saya</i> → <i>Buka akun baru</i> → pilih <b>Standard Cent</b>, platform <b>MT5</b>. Catat <b>nomor akun</b> dan <b>servernya</b>.</li>
      <li><b>Deposit</b>${capitalLine()}. Di akun cent saldo tampil dalam USC ($1 = 100 USC).</li>
      ${finish}</ol></div>`;
    const guideMove = `<div class="card"><h3>Panduan ②: Sudah punya akun ${esc(name)}, pindah ke partner GoldHunter Garuda</h3>
      <div class="alert warn small" style="margin-bottom:16px"><b>Penting:</b> setelah pindah partner disetujui, hanya akun trading yang <b>dibuat sesudahnya</b> yang tercatat di bawah GoldHunter Garuda. Akun trading lama tetap di partner lama, jadi Anda perlu <b>membuat akun trading baru</b> (langkah 5).</div>
      <ol class="steps small">
      <li><b>Login ke Personal Area ${esc(name)}</b>Di web atau aplikasi ${esc(name)}.</li>
      <li><b>Buka Live Chat / Support</b>Klik ikon chat (pojok kanan bawah), lalu ketik <b class="copy" data-copy="Change partner">Change partner</b>.</li>
      <li><b>Isi formulir pindah partner</b>
        <ul style="margin:6px 0 0 18px;color:#d6d6de"><li>Alasan: pilih yang sesuai (misalnya <i>Education</i> / edukasi dan tools trading)</li>
        <li>Link partner baru: <span class="copy mono" data-copy="${esc(link)}">${esc(link) || '(link partner)'}</span> <span class="tiny muted">(klik untuk salin)</span></li>
        <li>Tempat Anda menemukan partner: <span class="copy mono" data-copy="https://goldhuntergaruda.com">https://goldhuntergaruda.com</span></li></ul></li>
      <li><b>Konfirmasi &amp; tunggu</b>Masukkan kode keamanan yang dikirim ${esc(name)} bila diminta. Proses biasanya 1–3 hari kerja dan keputusan sepenuhnya ada di pihak ${esc(name)}. Anda akan menerima email bila disetujui.</li>
      <li><b>Buat akun trading BARU</b>Setelah disetujui: Personal Area → <i>Buka akun baru</i> → <b>Standard Cent</b>, <b>MT5</b>. Pindahkan dana dari akun lama lewat <i>Transfer antar akun</i> bila perlu.</li>
      ${finish}</ol>
      <p class="tiny muted" style="margin-top:6px">Kalau permintaan pindah partner ditolak ${esc(name)}, Anda tetap bisa memakai Panduan ① dengan email lain, atau memilih paket berbayar yang berlaku untuk semua broker.</p></div>`;
    view.innerHTML = `${title('Syarat EA Gratis')}
      <div class="alert ok">🎁 <b>EA GoldHunter Garuda GRATIS</b> dengan satu syarat: akun trading ${esc(name)} Anda <b>terdaftar di bawah partner (IB) GoldHunter Garuda</b>.
        Tidak ada biaya tambahan: spread dan komisi Anda sama seperti mendaftar langsung.</div>
      ${tabs}
      ${linkBox}
      <div style="margin-top:16px">${tab === 'baru' ? guideNew : guideMove}</div>
      <p class="small muted" style="margin-top:14px">Broker yang tersedia: <b>${brokers.map((x) => esc(x.name)).join(', ') || '-'}</b>. HFM segera menyusul.</p>
      <div class="alert warn small" style="margin-top:14px">Trading emas dengan EA tetap berisiko. Gunakan dana yang siap Anda tanggung risikonya.</div>`;
    $$('input[name=t]').forEach((r) => r.onchange = () => { location.hash = '#/ib/' + r.value; });
  }

  // ------------------------------------------------------------------ notifikasi & profil
  async function notifPage() {
    const { notifications } = await api('/notifications');
    view.innerHTML = `${title('Notifikasi')}<div class="card" style="padding:0">${notifications.map((n) => `
      <a class="notif ${n.is_read ? 'read' : 'unread'}" href="${n.link || '#/notifikasi'}" style="color:inherit;text-decoration:none"><span class="dot"></span>
        <div><b>${esc(n.title)}</b>${n.body ? `<div class="small muted">${esc(n.body)}</div>` : ''}<div class="tiny muted">${fmtDateTime(n.created_at)}</div></div></a>`).join('') || '<div class="empty">Belum ada notifikasi</div>'}</div>`;
    if (notifications.some((n) => !n.is_read)) { await api('/notifications/read-all', { method: 'POST', body: {} }); refreshMe(); }
  }

  async function profilePage() {
    view.innerHTML = `${title('Profil')}
      <div class="grid c2" style="align-items:start">
        <form class="card" id="pf"><h3>Data diri</h3>
          <div class="field"><label>Email (untuk login &amp; reset password)</label><input value="${esc(me.email)}" disabled></div>
          <div class="field"><label>Nama</label><input name="name" value="${esc(me.name)}"></div>
          <div class="field"><label>Nomor WhatsApp</label><input name="phone" value="${esc(me.phone)}"></div>
          <div class="field"><label>Alamat</label><textarea name="address" style="min-height:70px">${esc(me.address)}</textarea></div>
          <button class="btn btn-gold" type="submit">Simpan</button></form>
        <form class="card" id="pwf"><h3>Ganti password</h3>
          <div class="field"><label>Password lama</label><input name="old_password" type="password" autocomplete="current-password"></div>
          <div class="field"><label>Password baru (min. 8)</label><input name="new_password" type="password" autocomplete="new-password"></div>
          <button class="btn btn-gold" type="submit">Ganti Password</button></form>
      </div>`;
    $('#pf').onsubmit = async (e) => {
      e.preventDefault();
      await busy($('#pf button'), () => api('/me', { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) }));
      toast('Profil disimpan'); refreshMe();
    };
    $('#pwf').onsubmit = async (e) => {
      e.preventDefault();
      await busy($('#pwf button'), () => api('/me/password', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }));
      toast('Password diganti'); e.target.reset();
    };
  }

  refreshMe().then(render);
  setupWhatsApp();
  setInterval(() => refreshMe().catch(() => {}), 60000);
})();
