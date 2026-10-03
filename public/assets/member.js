// Member area (hash router). Pages: beranda, order, pesanan, lisensi, ib, notifikasi, profil.
(() => {
  const { $, $$, esc, rupiah, fmtDate, fmtDateTime, ago, api, toast, busy, modal, confirmBox, readProof,
    orderBadge, licenseBadge, buildBadge, billingText, qrSvg } = GHG;
  const view = $('#view');
  let me = null, catalog = null, timer = null;

  const getCatalog = async () => (catalog ||= await api('/catalog'));
  const title = (t, right = '') => `<div class="page-title"><h1>${t}</h1><div class="row">${right}</div></div>`;
  const features = (f) => String(f || '').split(/\r?\n/).filter(Boolean).map((x) => `<li>${esc(x)}</li>`).join('');
  const priceText = (p) => p.billing === 'free' ? 'GRATIS' : p.billing === 'lifetime' ? rupiah(p.price) : `${rupiah(p.price)}<span class="small muted"> /bulan</span>`;
  const waLink = (num, text) => num ? `https://wa.me/${String(num).replace(/\D/g, '').replace(/^0/, '62')}?text=${encodeURIComponent(text)}` : '';

  async function refreshMe() {
    const r = await api('/me');
    if (!r.user) { location.href = '/masuk?next=/member'; return; }
    me = r.user;
    $('#me-name').textContent = me.name;
    $('#me-email').textContent = me.email;
    $('#admin-link').classList.toggle('hidden', me.role !== 'admin');
    const u = $('#unread');
    u.textContent = r.unread;
    u.classList.toggle('hidden', !r.unread);
  }

  // ------------------------------------------------------------------ router
  const routes = {
    '': home, order: orderPage, pesanan: ordersPage, lisensi: licensesPage, ib: ibPage, notifikasi: notifPage, profil: profilePage,
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
  }
  window.addEventListener('hashchange', render);
  $('#burger').onclick = () => $('#side').classList.toggle('open');
  document.addEventListener('click', (e) => { if (e.target.id === 'side') $('#side').classList.remove('open'); });

  // ------------------------------------------------------------------ beranda
  async function home() {
    const [s, lic, n, c] = await Promise.all([api('/member/summary'), api('/licenses'), api('/notifications'), getCatalog()]);
    const vpsP = c.products.find((p) => p.requires_ib && p.includes_vps) || c.products.find((p) => p.includes_vps);
    const active = lic.licenses.filter((l) => l.status !== 'suspended').slice(0, 3);
    view.innerHTML = `
      ${title(`Halo, ${esc(me.name.split(' ')[0])} 👋`)}
      <div class="grid c4" style="margin-bottom:22px">
        <a class="stat" href="#/lisensi"><b>${s.active_licenses}</b><span>Lisensi aktif</span></a>
        <a class="stat" href="#/pesanan"><b>${s.open_orders}</b><span>Pesanan berjalan</span></a>
        <a class="stat ${s.expiring_soon ? 'alert' : ''}" href="#/lisensi"><b>${s.expiring_soon}</b><span>Habis ≤ 7 hari</span></a>
      </div>
      <div class="card gold" style="margin-bottom:22px">
        <div class="row between">
          <div style="max-width:620px"><h3 class="gold-text cinzel" style="font-size:1.3rem;margin-bottom:6px">EA GRATIS lewat IB Exness</h3>
            <p class="muted">Buat akun Exness lewat link IB kami, maka EA GoldHunter Garuda <b style="color:var(--text)">gratis</b> untuk akun itu. Mau jalan 24 jam? Sewa VPS pribadi kami${vpsP ? ` <b style="color:var(--text)">${rupiah(vpsP.price)}/bulan</b>` : ''}.</p></div>
          <div class="row"><a class="btn btn-outline" href="#/ib">Cara Jadi IB</a><a class="btn btn-gold" href="#/order">Order Sekarang</a></div>
        </div>
      </div>
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
  async function orderPage(productId) {
    const c = await getCatalog();
    if (productId) return orderForm(c, c.products.find((p) => String(p.id) === productId));
    const card = (p) => `
      <div class="card product ${p.requires_ib ? 'gold' : ''}">
        ${p.requires_ib ? '<span class="badge b-gold ribbon">KHUSUS IB</span>' : ''}
        <h3 style="margin:0;padding-right:80px">${esc(p.name)}</h3>
        <div class="price">${priceText(p)}</div>
        <p class="muted small">${esc(p.description)}</p>
        <ul>${features(p.features)}</ul>
        <a class="btn ${p.requires_ib ? 'btn-gold' : 'btn-outline'}" href="#/order/${p.id}">${p.billing === 'free' ? 'Ajukan Gratis' : 'Pilih Paket'}</a>
      </div>`;
    const ib = c.products.filter((p) => p.requires_ib), paid = c.products.filter((p) => !p.requires_ib);
    view.innerHTML = `${title('Order')}
      ${ib.length ? `<h2 class="cinzel" style="font-size:1.15rem;margin-bottom:6px">🎁 EA Gratis untuk Akun IB</h2>
        <p class="muted small" style="margin-bottom:14px">Syarat: akun trading dibuat lewat link IB kami. Belum punya? <a href="#/ib">Lihat caranya</a>.</p>
        <div class="grid c3" style="margin-bottom:34px">${ib.map(card).join('')}</div>` : ''}
      <h2 class="cinzel" style="font-size:1.15rem;margin-bottom:14px">💳 Paket Berbayar (semua broker)</h2>
      <div class="grid c3">${paid.map(card).join('')}</div>`;
  }

  function orderForm(c, p) {
    if (!p) { location.hash = '#/order'; return; }
    const ibBrokers = c.ib_brokers;
    const brokerField = p.requires_ib
      ? `<select name="broker">${ibBrokers.map((b) => `<option>${esc(b.name)}</option>`).join('')}</select>
         <div class="help">Akun harus terdaftar di bawah IB kami. <a href="#/ib">Cara jadi IB →</a></div>`
      : `<select name="broker_sel"><option>Exness</option><option>HFM</option><option value="">Lainnya…</option></select>
         <input name="broker_other" class="hidden" placeholder="Nama broker" style="margin-top:8px">`;
    const durations = c.durations.map((m, i) => {
      const d = Number(c.discounts[m] || 0);
      return `<label><input type="radio" name="months" value="${m}" ${i === 0 ? 'checked' : ''}><span>${m === 12 ? '1 tahun' : m + ' bulan'} ${d ? `<small>-${d}%</small>` : ''}</span></label>`;
    }).join('');
    view.innerHTML = `
      <div class="crumb"><a href="#/order">← Semua paket</a></div>
      ${title(esc(p.name))}
      <div class="grid c2" style="align-items:start">
        <form class="card" id="of" novalidate>
          ${p.requires_ib ? `<div class="alert warn" style="margin-bottom:16px">Syarat EA gratis: akun trading Anda <b>terdaftar di bawah IB kami</b>. Admin akan mengeceknya sebelum memproses.</div>` : ''}
          <div class="field"><label>Platform</label><div class="choice">
            <label><input type="radio" name="platform" value="mt5" checked><span>MetaTrader 5</span></label>
            <label><input type="radio" name="platform" value="mt4" ${c.mt4_enabled ? '' : 'disabled'}><span>MetaTrader 4 ${c.mt4_enabled ? '' : '<span class="tiny muted">(segera hadir)</span>'}</span></label>
          </div></div>
          <div class="field"><label>Broker</label>${brokerField}</div>
          <div class="field"><label>Nomor akun trading (login MT)</label><input name="account_number" inputmode="numeric" placeholder="contoh: 183946672" required>
            <div class="help">EA akan dikunci hanya untuk nomor akun ini. Ganti nomor akun hanya bisa lewat pengajuan ke admin.</div></div>
          <div class="field"><label>Server broker ${p.includes_vps ? '' : '<span class="muted">(opsional)</span>'}</label><input name="broker_server" placeholder="contoh: Exness-MT5Real25">
            <div class="help">Terlihat di MetaTrader: File → Login to Trade Account, atau di email pembukaan akun dari broker.</div></div>
          ${p.includes_vps ? `<div class="alert info small" style="margin-bottom:16px">🖥️ <b>VPS pribadi untuk Anda</b> (RAM 2 GB, 2 core, disk 40 GB, Windows). Setelah pesanan selesai, IP, username dan password Remote Desktop muncul di menu <b>Lisensi &amp; VPS</b>. Anda login sendiri lalu memasang MetaTrader dan EA, dan bisa mengatur setting EA sesuka Anda.</div>` : ''}
          ${p.billing === 'monthly' ? `<div class="field"><label>Lama sewa</label><div class="choice">${durations}</div></div>` : ''}
          <div class="alert info small" style="margin-bottom:16px">EA GoldHunter Garuda dirancang untuk akun <b>Standard Cent (USC)</b> dengan mode <b>hedging</b>, pair XAUUSDc.</div>
          <button class="btn btn-gold btn-block" type="submit">${p.billing === 'free' ? 'Ajukan EA Gratis' : 'Buat Pesanan'}</button>
        </form>
        <div class="card summary" id="sum"></div>
      </div>`;
    const f = $('#of');
    const sel = $('[name=broker_sel]', f);
    if (sel) sel.onchange = () => $('[name=broker_other]', f).classList.toggle('hidden', sel.value !== '');
    const calc = () => {
      const m = Number(new FormData(f).get('months')) || null;
      let rows = '', total = 0;
      if (p.billing === 'free') rows = `<div class="row between"><span>Lisensi EA</span><b>GRATIS</b></div>`;
      else if (p.billing === 'lifetime') { total = p.price; rows = `<div class="row between"><span>Harga (selamanya)</span><b>${rupiah(p.price)}</b></div>`; }
      else {
        const d = Number(c.discounts[m] || 0), gross = p.price * m;
        total = Math.round(gross * (100 - d) / 100);
        rows = `<div class="row between"><span>${rupiah(p.price)} × ${m} bulan</span><span>${rupiah(gross)}</span></div>`
          + (d ? `<div class="row between" style="color:var(--green)"><span>Diskon ${d}%</span><span>- ${rupiah(gross - total)}</span></div>` : '');
      }
      $('#sum').innerHTML = `<h3>Ringkasan</h3><div class="stack small">${rows}</div><hr>
        <div class="row between"><span>Total</span><span class="total">${total ? rupiah(total) : 'GRATIS'}</span></div>
        ${total ? '<p class="tiny muted" style="margin-top:8px">Kode unik 3 digit ditambahkan ke nominal transfer agar pembayaran mudah dicocokkan.</p>' : ''}
        <hr><ol class="steps small">${p.billing === 'free'
          ? '<li><b>Ajukan</b>Isi nomor akun Exness Anda.</li><li><b>Admin cek IB</b>Akun dicek di portal partner.</li><li><b>EA dikirim</b>File .ex5 terkunci di akun Anda, unduh di menu Lisensi.</li>'
          : `<li><b>Transfer</b>Sesuai nominal di halaman pesanan.</li><li><b>Konfirmasi</b>Upload bukti transfer.</li>${p.requires_ib ? '<li><b>Admin cek IB</b>Akun dicek di portal partner.</li>' : ''}<li><b>Diproses</b>${p.includes_vps ? 'Admin menyiapkan VPS pribadi Anda' + (p.includes_ea ? ' + file EA dikunci ke akun Anda' : '') + '.' : 'File EA dikunci ke akun Anda.'}</li>`}</ol>`;
    };
    f.onchange = calc;
    calc();
    f.onsubmit = async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(f));
      const body = { product_id: p.id, platform: d.platform, account_number: (d.account_number || '').trim(), broker_server: d.broker_server,
        months: Number(d.months) || null,
        broker: p.requires_ib ? d.broker : (d.broker_sel || d.broker_other || '').trim() };
      if (!/^\d{4,15}$/.test(body.account_number)) return toast('Nomor akun harus angka', 'err');
      const r = await busy($('button[type=submit]', f), () => api('/orders', { method: 'POST', body }));
      toast(p.billing === 'free' ? 'Pengajuan terkirim!' : 'Pesanan dibuat. Silakan transfer.');
      location.hash = '#/pesanan/' + r.id;
    };
  }

  // ------------------------------------------------------------------ pesanan
  async function ordersPage(id) {
    if (id) return orderDetail(id);
    const { orders } = await api('/orders');
    view.innerHTML = `${title('Pesanan Saya', '<a class="btn btn-gold btn-sm" href="#/order">+ Order baru</a>')}
      ${orders.length ? `<div class="table-wrap"><table><thead><tr><th>Kode</th><th>Paket</th><th>Akun</th><th>Total</th><th>Status</th><th>Tanggal</th></tr></thead><tbody>
        ${orders.map((o) => `<tr class="click" onclick="location.hash='#/pesanan/${o.id}'"><td class="mono">${esc(o.code)}</td>
          <td>${esc(o.product_name)}${o.kind === 'renew' ? ' <span class="badge b-gray">Perpanjang</span>' : ''}<div class="tiny muted">${billingText(o, o.months)}</div></td>
          <td>${esc(o.account_number)}<div class="tiny muted">${esc(o.broker)} · ${o.platform.toUpperCase()}</div></td>
          <td class="nowrap">${o.total ? rupiah(o.total) : 'Gratis'}</td><td>${orderBadge(o.status)}</td><td class="nowrap small">${fmtDate(o.created_at)}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="card empty">Belum ada pesanan. <a href="#/order">Order sekarang</a></div>'}`;
  }

  async function orderDetail(id) {
    const { order: o, bank_accounts, whatsapp } = await api('/orders/' + id);
    const free = o.billing === 'free';
    const steps = [
      ['Pesanan dibuat', o.created_at],
      [free ? 'Pengajuan diterima' : 'Pembayaran dikonfirmasi', o.confirmed_at],
      ...(o.requires_ib ? [['Akun dicek di bawah IB kami', o.ib_status === 'yes' ? o.ib_checked_at || 1 : null]] : []),
      ['Diproses admin', o.processed_at], ['Selesai', o.completed_at],
    ];
    const bankLines = String(bank_accounts || '').split(/\r?\n/).filter(Boolean).map((l) => {
      const num = (l.match(/\d[\d\s-]{5,}\d/) || [''])[0].replace(/[\s-]/g, '');
      return `<div class="row between" style="padding:8px 0;border-bottom:1px solid var(--line)"><span>${esc(l)}</span>${num ? `<button class="btn btn-ghost btn-sm" data-copy="${esc(num)}">Salin</button>` : ''}</div>`;
    }).join('');
    let action = '';
    if (o.status === 'awaiting_payment') {
      action = `<div class="card gold"><h3>Instruksi Pembayaran</h3>
        <p class="muted small">Transfer <b>tepat</b> sesuai nominal (termasuk 3 digit kode unik) sebelum <b>${fmtDateTime(o.pay_deadline)}</b>.</p>
        <div class="summary" style="margin:14px 0"><div class="muted small">Total transfer</div>
          <div class="row between"><span class="total">${rupiah(o.total)}</span><button class="btn btn-outline btn-sm" data-copy="${o.total}">Salin nominal</button></div></div>
        <div style="margin-bottom:18px">${bankLines || '<div class="muted">Rekening belum diatur admin.</div>'}</div>
        <h3>Konfirmasi Pembayaran</h3>
        <form id="cf" novalidate>
          <div class="grid c2" style="gap:0 14px"><div class="field"><label>Nama pengirim</label><input name="payer_name" required></div>
          <div class="field"><label>Dari bank / e-wallet</label><input name="payer_bank" placeholder="BCA / DANA / ..." required></div></div>
          <div class="field"><label>Foto / screenshot bukti transfer</label><input type="file" name="proof" accept="image/*,application/pdf" required></div>
          <div class="field"><label>Catatan (opsional)</label><input name="note"></div>
          <div class="row"><button class="btn btn-gold" type="submit">Saya Sudah Transfer</button><button class="btn btn-red btn-sm" type="button" id="cancel">Batalkan pesanan</button></div>
        </form></div>`;
    } else if (o.status === 'awaiting_verification') {
      action = `<div class="alert ok">${free
        ? '✅ Pengajuan diterima. Admin sedang mengecek bahwa akun Anda terdaftar di bawah IB kami, lalu <b>segera memproses</b>.'
        : '✅ Konfirmasi pembayaran diterima. Pesanan Anda <b>segera diproses</b> oleh admin.'}</div>`;
    } else if (o.status === 'processing') {
      action = `<div class="alert info">⚙️ Pesanan sedang diproses admin${o.includes_ea ? ' (file EA dikunci ke nomor akun Anda)' : ''}${o.includes_vps ? ' dan VPS pribadi Anda disiapkan' : ''}.</div>`;
    } else if (o.status === 'completed') {
      action = `<div class="alert ok">🎉 Pesanan selesai. <a href="#/lisensi">Buka Lisensi &amp; VPS →</a></div>`;
    } else if (o.status === 'rejected') {
      action = `<div class="alert err">Pesanan ditolak. ${o.admin_note ? 'Alasan: ' + esc(o.admin_note) : ''}${o.requires_ib ? ' <a href="#/ib">Lihat cara jadi IB</a>.' : ''}</div>`;
    } else {
      action = `<div class="alert">Pesanan ${o.status === 'expired' ? 'kedaluwarsa karena belum dibayar' : 'dibatalkan'}.</div>`;
    }
    const wa = waLink(whatsapp, `Halo admin GoldHunter Garuda, saya mau tanya pesanan ${o.code}`);
    view.innerHTML = `
      <div class="crumb"><a href="#/pesanan">← Pesanan saya</a></div>
      ${title(`Pesanan <span class="mono" style="font-family:monospace">${esc(o.code)}</span>`, orderBadge(o.status, o.status_label))}
      <div class="grid c2" style="align-items:start">
        <div class="stack">${action}
          <div class="card"><h3>Detail</h3><dl class="kv">
            <dt>Paket</dt><dd>${esc(o.product_name)}${o.kind === 'renew' ? ' (perpanjangan)' : ''}</dd>
            <dt>Durasi</dt><dd>${billingText(o, o.months)}</dd>
            <dt>Platform</dt><dd>${o.platform.toUpperCase()}</dd>
            <dt>Broker</dt><dd>${esc(o.broker)}${o.broker_server ? ' · ' + esc(o.broker_server) : ''}</dd>
            <dt>Nomor akun</dt><dd><b>${esc(o.account_number)}</b></dd>
            ${o.total ? `<dt>Harga</dt><dd>${o.months ? rupiah(o.unit_price) + ' × ' + o.months + ' bln' : rupiah(o.unit_price)}${o.discount_pct ? ` <span class="badge b-green">-${o.discount_pct}%</span>` : ''}</dd>
            <dt>Kode unik</dt><dd>${o.unique_code}</dd><dt>Total</dt><dd><b>${rupiah(o.total)}</b></dd>` : '<dt>Biaya</dt><dd><b>GRATIS</b></dd>'}
          </dl></div>
        </div>
        <div class="card"><h3>Status</h3><ul class="timeline">${steps.map(([t, at]) => `<li class="${at ? 'done' : ''}">${t}${at > 1 ? `<div class="tiny muted">${fmtDateTime(at)}</div>` : ''}</li>`).join('')}</ul>
          ${wa ? `<a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="${wa}">💬 Tanya admin via WhatsApp</a>` : ''}</div>
      </div>`;
    const cf = $('#cf');
    if (cf) {
      cf.onsubmit = async (e) => {
        e.preventDefault();
        const d = new FormData(cf);
        await busy($('button[type=submit]', cf), async () => {
          const proof = await readProof(d.get('proof') && d.get('proof').size ? d.get('proof') : null);
          await api(`/orders/${o.id}/confirm`, { method: 'POST', body: { payer_name: d.get('payer_name'), payer_bank: d.get('payer_bank'), note: d.get('note'), proof } });
        });
        toast('Terima kasih! Konfirmasi diterima, pesanan segera diproses.');
        render();
        refreshMe();
      };
      $('#cancel').onclick = async () => {
        if (!(await confirmBox('Batalkan pesanan?', `Pesanan ${esc(o.code)} akan dibatalkan.`, 'Ya, batalkan', true))) return;
        await api(`/orders/${o.id}/cancel`, { method: 'POST', body: {} }).then(() => { toast('Pesanan dibatalkan'); render(); }, (e) => toast(e.message, 'err'));
      };
    }
  }

  // ------------------------------------------------------------------ lisensi
  async function licensesPage() {
    const [{ licenses, changes, renewals }, c] = await Promise.all([api('/licenses'), getCatalog()]);
    const card = (l) => {
      const ch = changes.filter((x) => x.license_id === l.id);
      const renewing = renewals.find((r) => r.license_id === l.id);
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
      const vps = l.includes_vps ? (l.vps_ip
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
        <div class="row between"><div><div class="tiny muted">${esc(l.product_name)}</div>
          <div style="font-size:1.25rem;font-weight:700">${esc(l.account_number)} <span class="small muted" style="font-weight:400">${esc(l.broker)} · ${l.platform.toUpperCase()}</span></div>
          ${l.broker_server ? `<div class="tiny muted">${esc(l.broker_server)}</div>` : ''}</div>${licenseBadge(l.status)}</div>
        <div style="margin:14px 0">${l.expires_at
          ? `<div class="row between small"><span>${l.requires_ib ? 'Sewa VPS' : 'Masa aktif'} s/d <b>${fmtDate(l.expires_at)}</b></span><span class="${l.days_left <= 7 ? 'badge b-orange' : 'muted'}">${l.days_left > 0 ? l.days_left + ' hari lagi' : 'sudah habis'}</span></div><div class="bar"><i style="width:${pct}%"></i></div>`
          : '<div class="small">Masa aktif: <b>Selamanya</b></div>'}
          ${l.requires_ib && l.includes_vps ? '<div class="tiny muted" style="margin-top:4px">EA gratis (IB) tidak kedaluwarsa; yang diperpanjang hanya sewa VPS.</div>' : ''}</div>
        <div class="row">${ea}</div>${vps}
        <div class="row" style="margin-top:16px">
          ${l.billing === 'monthly' && ['active', 'expired'].includes(l.status) ? (renewing
            ? `<a class="btn btn-outline btn-sm" href="#/pesanan/${renewing.id}">Perpanjangan ${esc(renewing.code)} →</a>`
            : `<button class="btn btn-gold btn-sm" data-renew="${l.id}">↻ Perpanjang</button>`) : ''}
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
        <li><b>Pasang di chart</b>Buka chart XAUUSDc timeframe M1, seret EA ke chart, centang "Allow Algo Trading", lalu nyalakan tombol Algo Trading.</li>
        <li><b>Ganti file saat diperbarui</b>Setelah perpanjangan atau ganti akun, unduh file baru dan timpa file lama.</li></ol></div>`;
    $$('[data-renew]').forEach((b) => b.onclick = () => renewModal(licenses.find((l) => l.id == b.dataset.renew), c));
    $$('[data-change]').forEach((b) => b.onclick = () => changeModal(licenses.find((l) => l.id == b.dataset.change)));
  }

  function renewModal(l, c) {
    const p = c.products.find((x) => x.id === l.product_id) || { price: 0 };
    const m = modal(`Perpanjang akun ${l.account_number}`, `
      <p class="muted small" style="margin-bottom:14px">${esc(l.product_name)} · berakhir ${fmtDate(l.expires_at)}. Masa baru dihitung dari tanggal berakhir (atau dari hari ini jika sudah habis).</p>
      <form id="rf"><div class="field"><label>Lama perpanjangan</label><div class="choice">${c.durations.map((mo, i) => {
        const d = Number(c.discounts[mo] || 0);
        return `<label><input type="radio" name="months" value="${mo}" ${i === 0 ? 'checked' : ''}><span>${mo === 12 ? '1 tahun' : mo + ' bulan'} ${d ? `<small>-${d}%</small>` : ''}</span></label>`;
      }).join('')}</div></div>
      <div class="summary"><div class="row between"><span>Total</span><span class="total" id="rt"></span></div></div>
      <button class="btn btn-gold btn-block" style="margin-top:16px" type="submit">Buat Pesanan Perpanjangan</button></form>`);
    const f = $('#rf', m.el);
    const calc = () => { const mo = Number(new FormData(f).get('months')); const d = Number(c.discounts[mo] || 0); $('#rt', m.el).textContent = rupiah(Math.round(p.price * mo * (100 - d) / 100)); };
    f.onchange = calc; calc();
    f.onsubmit = async (e) => {
      e.preventDefault();
      const r = await busy($('button[type=submit]', f), () => api(`/licenses/${l.id}/renew`, { method: 'POST', body: { months: Number(new FormData(f).get('months')) } }));
      m.close();
      location.hash = '#/pesanan/' + r.id;
    };
  }

  function changeModal(l) {
    const m = modal(`Ganti nomor akun ${l.account_number}`, `
      <p class="muted small" style="margin-bottom:14px">Pengajuan dicek admin. Setelah disetujui, file EA dibuat ulang untuk nomor akun baru, dan file lama tidak berlaku untuk akun baru.
      ${l.requires_ib ? '<br><b>Akun baru juga harus terdaftar di bawah IB kami.</b>' : ''}</p>
      <form id="chf" novalidate>
        <div class="field"><label>Nomor akun baru</label><input name="new_account" inputmode="numeric" required></div>
        <div class="field"><label>Server broker akun baru ${l.includes_vps ? '' : '<span class="muted">(opsional)</span>'}</label><input name="new_server" placeholder="contoh: Exness-MT5Real25"></div>
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

  // ------------------------------------------------------------------ IB tutorial
  async function ibPage() {
    const c = await getCatalog();
    const ibProducts = c.products.filter((p) => p.requires_ib);
    const vps = ibProducts.find((p) => p.includes_vps);
    const brokers = c.ib_brokers;
    const brokerCard = (b) => `
      <div class="card gold"><div class="row" style="align-items:flex-start;gap:24px">
        <div class="qr" title="Scan untuk daftar ${esc(b.name)}">${qrSvg(b.link)}</div>
        <div style="flex:1;min-width:240px"><h3 class="cinzel" style="font-size:1.3rem">Daftar ${esc(b.name)} lewat link IB kami</h3>
          <p class="muted small" style="margin-bottom:14px">Scan QR dengan kamera HP, atau klik tombol di bawah. Akun yang dibuat lewat link ini otomatis tercatat di bawah IB GoldHunter Garuda.</p>
          <div class="row"><a class="btn btn-gold" href="${esc(b.link)}" target="_blank" rel="noopener">Daftar ${esc(b.name)} →</a>
          <button class="btn btn-ghost btn-sm" data-copy="${esc(b.link)}">Salin link</button></div>
          <p class="tiny muted mono" style="margin-top:10px;word-break:break-all">${esc(b.link)}</p></div>
      </div></div>`;
    view.innerHTML = `${title('Cara Jadi IB &amp; Dapat EA Gratis')}
      <div class="alert ok" style="margin-bottom:20px">🎁 <b>EA GoldHunter Garuda GRATIS</b> untuk akun trading yang terdaftar di bawah IB (Introducing Broker) kami.
        ${vps ? `Ingin EA berjalan 24 jam tanpa menyalakan komputer? Sewa VPS pribadi (RAM 2 GB, 2 core, disk 40 GB) cukup <b>${rupiah(vps.price)}/bulan</b>.` : ''}</div>
      ${brokers.length ? brokers.map(brokerCard).join('') : '<div class="alert">Link IB belum tersedia.</div>'}
      <p class="small muted" style="margin:10px 0 24px">Saat ini tersedia broker: <b>${brokers.map((b) => esc(b.name)).join(', ') || '-'}</b>. HFM segera menyusul.</p>
      <div class="grid c2" style="align-items:start">
        <div class="card"><h3>Langkah-langkah (akun baru)</h3><ol class="steps small">
          <li><b>Daftar lewat link / QR di atas</b>Gunakan email yang belum pernah dipakai di Exness.</li>
          <li><b>Lengkapi verifikasi</b>Di Personal Area Exness: verifikasi email, nomor HP, identitas (KTP) dan alamat.</li>
          <li><b>Buat akun trading MT5 Standard Cent</b>Personal Area → Akun Saya → Buka akun baru → pilih <b>Standard Cent</b>, platform <b>MT5</b>. Catat nomor akun dan servernya.</li>
          <li><b>Deposit</b>Deposit sesuai modal yang Anda rencanakan (akun cent: saldo tampil dalam USC).</li>
          <li><b>Ajukan EA gratis di sini</b><a href="#/order">Order</a> → <i>EA Gratis (Akun IB Exness)</i>, isi nomor akun. ${vps ? 'Mau jalan 24 jam? Pilih juga <i>VPS untuk EA Gratis</i> (VPS pribadi, Anda pasang sendiri).' : ''}</li>
          <li><b>Admin cek &amp; kirim EA</b>Admin memastikan akun Anda di bawah IB kami, lalu file EA (terkunci di nomor akun Anda) bisa diunduh di menu <a href="#/lisensi">Lisensi &amp; VPS</a>.</li>
        </ol></div>
        <div class="stack">
          <div class="card"><h3>Sudah punya akun Exness?</h3><p class="small muted">Akun yang dibuat <b>tanpa</b> link IB kami (atau lewat partner lain) tidak tercatat di bawah IB kami, jadi belum bisa mendapat EA gratis. Pilihannya:</p>
            <ul class="small" style="margin:10px 0 0 18px;color:#d6d6de"><li>Daftar ulang lewat link kami memakai <b>email baru</b>, atau</li>
            <li>Hubungi Live Chat Exness dan minta pindah partner ke link IB kami (keputusan ada di pihak Exness).</li>
            <li>Atau pilih paket berbayar yang berlaku untuk semua broker.</li></ul></div>
          <div class="card"><h3>Kenapa gratis?</h3><p class="small muted">Sebagai IB, kami mendapat komisi dari broker atas aktivitas trading akun Anda, <b>tanpa biaya tambahan</b> untuk Anda: spread dan komisi Anda sama seperti mendaftar langsung.</p></div>
          <div class="alert warn small">Trading emas dengan EA tetap berisiko. Gunakan dana yang siap Anda tanggung risikonya.</div>
        </div>
      </div>`;
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
  setInterval(() => refreshMe().catch(() => {}), 60000);
})();
