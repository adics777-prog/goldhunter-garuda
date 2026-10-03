// Admin area (hash router).
(() => {
  const { $, $$, esc, rupiah, fmtDate, fmtDateTime, ago, api, toast, busy, modal, confirmBox,
    orderBadge, licenseBadge, buildBadge, billingText } = GHG;
  const view = $('#view');
  let me = null, timer = null;

  const title = (t, right = '') => `<div class="page-title"><h1>${t}</h1><div class="row">${right}</div></div>`;
  const setCount = (id, n) => { const el = $(id); el.textContent = n; el.classList.toggle('hidden', !n); };
  const post = (path, body = {}) => api(path, { method: 'POST', body });
  const ibBadge = (o) => !o.requires_ib ? '' : o.ib_status === 'yes' ? '<span class="badge b-green">IB ✔</span>'
    : o.ib_status === 'no' ? '<span class="badge b-red">Bukan IB</span>' : '<span class="badge b-orange">Cek IB</span>';
  const waLink = (num) => num ? `https://wa.me/${String(num).replace(/\D/g, '').replace(/^0/, '62')}` : '';
  const dateInput = (t) => { if (!t) return ''; const d = new Date(t * 1000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const fromDateInput = (v) => v ? Math.floor(new Date(v + 'T23:59:00').getTime() / 1000) : null;

  async function boot() {
    const r = await api('/me');
    if (!r.user) { location.href = '/masuk?next=/admin'; return; }
    if (r.user.role !== 'admin') { location.href = '/member'; return; }
    me = r.user;
    $('#me-name').textContent = me.name;
    $('#me-email').textContent = me.email;
    await counts();
    render();
    setInterval(() => counts().catch(() => {}), 30000);
  }
  async function counts() {
    const s = await api('/admin/stats');
    setCount('#c-ib', s.ib_open);
    setCount('#c-paid', s.awaiting_verification + s.processing);
    setCount('#c-chg', s.pending_changes);
    return s;
  }

  const routes = { '': dashboard, ib: ibOrders, pesanan: paidOrders, 'ganti-akun': changesPage, lisensi: licensesPage, build: buildsPage,
    member: usersPage, produk: productsPage, pengaturan: settingsPage, email: emailsPage };
  async function render() {
    clearInterval(timer);
    const [name, arg] = location.hash.replace(/^#\/?/, '').split('/');
    $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === (name || '')));
    $('#side').classList.remove('open');
    view.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
    try { await (routes[name] || dashboard)(arg); } catch (e) { view.innerHTML = `<div class="alert err">${esc(e.message)}</div>`; }
  }
  window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });
  $('#burger').onclick = () => $('#side').classList.toggle('open');

  // ------------------------------------------------------------------ dashboard
  async function dashboard() {
    const s = await counts();
    const online = s.builder && s.now - s.builder.at < 90;
    const stat = (n, label, href, alert) => `<a class="stat ${alert && n ? 'alert' : ''}" href="${href}"><b>${n}</b><span>${label}</span></a>`;
    view.innerHTML = `${title('Dashboard')}
      <div class="grid c4" style="margin-bottom:22px">
        ${stat(s.ib_unchecked, 'IB belum dicek', '#/ib', true)}
        ${stat(s.ib_open, 'Order IB berjalan', '#/ib')}
        ${stat(s.awaiting_verification, 'Pembayaran perlu dicek', '#/pesanan', true)}
        ${stat(s.processing, 'Sedang diproses', '#/pesanan')}
        ${stat(s.awaiting_payment, 'Menunggu transfer', '#/pesanan')}
        ${stat(s.pending_changes, 'Ganti akun menunggu', '#/ganti-akun', true)}
        ${stat(s.active_licenses, 'Lisensi aktif', '#/lisensi')}
        ${stat(s.expiring_7d, 'Habis ≤ 7 hari', '#/lisensi', true)}
        ${stat(s.members, 'Member', '#/member')}
        <div class="stat"><b style="font-size:1.25rem">${rupiah(s.revenue_30d)}</b><span>Omzet 30 hari</span></div>
      </div>
      <div class="grid c2">
        <div class="card"><h3>Builder EA (compile otomatis)</h3>
          <p>${online ? '<span class="badge b-green">● Online</span>' : '<span class="badge b-red">● Offline</span>'}
            <span class="small muted">${s.builder ? `terakhir aktif ${ago(s.builder.at)} (${esc(s.builder.id)})` : 'belum pernah terhubung'}</span></p>
          <p class="small muted" style="margin-top:8px">Antre: <b>${s.builds_pending}</b> · gagal 7 hari: <b>${s.builds_failed_7d}</b>.
            ${online ? '' : 'Jalankan <b>Jalankan Builder.bat</b> di PC/VPS Windows agar order bisa di-generate.'}</p>
          <a class="btn btn-ghost btn-sm" style="margin-top:12px" href="#/build">Lihat riwayat generate</a></div>
        <div class="card"><h3>Pengingat &amp; pembersihan harian</h3>
          <p class="small muted">Kirim email pengingat masa sewa (7/3/1 hari), tandai lisensi yang habis, dan batalkan order yang tidak dibayar. Berjalan otomatis setiap hari.</p>
          <p class="small" style="margin-top:8px">${s.daily ? `Terakhir: ${fmtDateTime(s.daily.at)}, ${s.daily.reminders ?? 0} pengingat, ${s.daily.expired ?? 0} habis, ${s.daily.unpaid_expired ?? 0} order kedaluwarsa` : 'Belum pernah berjalan.'}</p>
          <button class="btn btn-outline btn-sm" style="margin-top:12px" id="run-daily">Jalankan sekarang</button></div>
      </div>`;
    $('#run-daily').onclick = async (e) => {
      const r = await busy(e.target, () => post('/admin/run-daily'));
      toast(`Selesai: ${r.result.reminders} pengingat, ${r.result.expired} lisensi habis`);
      render();
    };
  }

  // ------------------------------------------------------------------ orders
  function ordersTable(orders, ib) {
    if (!orders.length) return '<div class="card empty">Tidak ada order.</div>';
    return `<div class="table-wrap"><table><thead><tr><th>Kode</th><th>Member</th><th>Paket</th><th>Akun</th>${ib ? '<th>IB</th>' : ''}<th>Total</th><th>Status</th><th>Masuk</th></tr></thead><tbody>
      ${orders.map((o) => `<tr class="click" onclick="location.hash='#/${ib ? 'ib' : 'pesanan'}/${o.id}'">
        <td class="mono small">${esc(o.code)}</td>
        <td>${esc(o.user_name)}<div class="tiny muted">${esc(o.user_email)}</div></td>
        <td>${esc(o.product_name)}${o.kind === 'renew' ? ' <span class="badge b-gray">Perpanjang</span>' : ''}<div class="tiny muted">${billingText(o, o.months)}</div></td>
        <td><b>${esc(o.account_number)}</b><div class="tiny muted">${esc(o.broker)} · ${o.platform.toUpperCase()}</div></td>
        ${ib ? `<td>${o.kind === 'renew' ? '<span class="tiny muted">-</span>' : ibBadge(o)}</td>` : ''}
        <td class="nowrap">${o.total ? rupiah(o.total) : 'Gratis'}${o.proof_file_id ? '<div class="tiny" style="color:var(--green)">bukti ✔</div>' : ''}</td>
        <td>${orderBadge(o.status)}</td><td class="small nowrap">${ago(o.created_at)}</td></tr>`).join('')}
    </tbody></table></div>`;
  }
  async function orderList(group, arg) {
    if (arg) return orderDetail(arg, group);
    const ib = group === 'ib';
    const state = JSON.parse(sessionStorage.getItem('ord-' + group) || '{"status":"open","q":""}');
    const tabs = [['open', 'Perlu tindakan'], ['awaiting_payment', 'Menunggu transfer'], ['awaiting_verification', ib ? 'Menunggu cek' : 'Cek pembayaran'],
      ['processing', 'Diproses'], ['completed', 'Selesai'], ['rejected', 'Ditolak'], ['', 'Semua']];
    view.innerHTML = `${title(ib ? '🎁 Order EA Gratis (IB)' : '💳 Order Berbayar')}
      ${ib ? `<div class="alert info small" style="margin-bottom:16px">Alur: buka Personal Area <b>Partner Exness</b> → cari nomor akun klien → jika ada, klik <b>Ya, under IB</b> → <b>Proses</b> (EA otomatis di-compile &amp; dikunci) → <b>Oke, Selesai</b>.</div>` : ''}
      <div class="row between" style="margin-bottom:14px"><div class="choice" id="tabs">${tabs.map(([v, l]) => `<label><input type="radio" name="st" value="${v}" ${state.status === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>
        <input id="q" placeholder="Cari kode / akun / email" value="${esc(state.q)}" style="max-width:260px"></div>
      <div id="list"><div class="loading"><span class="spinner"></span></div></div>`;
    const load = async () => {
      const qs = new URLSearchParams({ group, status: state.status, q: state.q });
      const { orders } = await api('/admin/orders?' + qs);
      $('#list').innerHTML = ordersTable(orders, ib);
    };
    $('#tabs').onchange = (e) => { state.status = e.target.value; sessionStorage.setItem('ord-' + group, JSON.stringify(state)); load(); };
    let t; $('#q').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { state.q = e.target.value; sessionStorage.setItem('ord-' + group, JSON.stringify(state)); load(); }, 300); };
    await load();
  }
  function ibOrders(arg) { return orderList('ib', arg); }
  function paidOrders(arg) { return orderList('paid', arg); }

  async function orderDetail(id, group) {
    const { order: o, proof, license: l, builds } = await api('/admin/orders/' + id);
    const back = group === 'ib' ? '#/ib' : '#/pesanan';
    const open = ['awaiting_payment', 'awaiting_verification'].includes(o.status);
    const needIb = o.requires_ib && o.kind === 'new' && o.ib_status !== 'yes';
    const b = builds[0];
    const steps = [];

    if (o.requires_ib && o.kind === 'new') {
      steps.push(`<div class="card ${needIb && open ? 'gold' : ''}"><h3>1. Cek akun di bawah IB</h3>
        ${o.ib_status === 'yes' ? `<div class="alert ok small">✔ Terverifikasi under IB (${fmtDateTime(o.ib_checked_at)})</div>`
        : o.ib_status === 'no' ? `<div class="alert err small">✖ Bukan IB. ${esc(o.admin_note)}</div>`
        : `<p class="small muted">Buka Personal Area Partner ${esc(o.broker)} → menu klien, cari nomor akun <b class="copy" data-copy="${esc(o.account_number)}">${esc(o.account_number)}</b>.</p>
           <div class="row" style="margin-top:12px"><button class="btn btn-green" id="ib-yes">✔ Ya, under IB kita</button><button class="btn btn-red" id="ib-no">✖ Bukan IB</button></div>`}</div>`);
    }
    if (o.billing !== 'free') {
      steps.push(`<div class="card ${o.status === 'awaiting_verification' ? 'gold' : ''}"><h3>${steps.length + 1}. Pembayaran</h3>
        <dl class="kv small"><dt>Total harus masuk</dt><dd><b style="font-size:1.1rem">${rupiah(o.total)}</b> <span class="tiny muted">(kode unik ${o.unique_code})</span></dd>
        ${o.confirmed_at && o.proof_file_id ? `<dt>Dari</dt><dd>${esc(o.payer_bank)} a.n. ${esc(o.payer_name)}</dd><dt>Dikonfirmasi</dt><dd>${fmtDateTime(o.confirmed_at)}</dd>
          ${o.member_note ? `<dt>Catatan</dt><dd>${esc(o.member_note)}</dd>` : ''}` : '<dt>Status</dt><dd>Belum ada konfirmasi dari member</dd>'}</dl>
        ${proof ? (proof.mime.startsWith('image/') ? `<a href="/api/files/${proof.id}" target="_blank"><img src="/api/files/${proof.id}" style="max-height:340px;border-radius:10px;margin-top:12px;border:1px solid var(--line)"></a>`
          : `<a class="btn btn-ghost btn-sm" style="margin-top:12px" href="/api/files/${proof.id}" target="_blank">Buka bukti (PDF)</a>`) : ''}</div>`);
    }
    let procHtml = '';
    if (open) {
      procHtml = `<p class="small muted">${o.includes_ea ? 'EA otomatis di-compile dan dikunci ke nomor akun ini.' : ''}${o.kind === 'renew' ? ' Masa aktif diperpanjang ' + o.months + ' bulan.' : ''}</p>
        <div class="row" style="margin-top:12px"><button class="btn btn-gold" id="process" ${needIb ? 'disabled title="Cek IB dulu"' : ''}>▶ Proses</button>
        <button class="btn btn-red btn-sm" id="reject">Tolak</button></div>
        ${o.billing !== 'free' && !o.proof_file_id ? '<p class="tiny muted" style="margin-top:8px">Member belum upload bukti. Klik Proses hanya jika pembayaran sudah Anda pastikan masuk.</p>' : ''}`;
    } else if (o.status === 'processing' || o.status === 'completed') {
      procHtml = `${o.includes_ea ? `<div class="row between small" style="margin-bottom:10px"><span>File EA (${o.platform.toUpperCase()}, akun ${esc(l?.account_number || o.account_number)})</span>
          <span id="bstat">${b ? buildBadge(b.status) : '-'}</span></div>
          <div class="row" id="bact">${b && b.status === 'done' && b.file_id ? `<a class="btn btn-ghost btn-sm" href="/api/files/${b.file_id}">⬇ Unduh .${o.platform === 'mt4' ? 'ex4' : 'ex5'}</a>` : ''}
          <button class="btn btn-ghost btn-sm" id="rebuild">↻ Generate ulang</button></div>
          ${b && b.status === 'failed' ? `<div class="alert err tiny" style="margin-top:10px;white-space:pre-wrap">${esc((b.log || '').slice(-600))}</div>` : ''}` : ''}
        ${o.includes_vps && l ? `<hr><form id="vpsf"><div class="small muted" style="margin-bottom:10px">Login MT member untuk dipasang di VPS:
            <b class="copy" data-copy="${esc(l.account_number)}">${esc(l.account_number)}</b> · <span class="copy" data-copy="${esc(l.broker_server)}">${esc(l.broker_server)}</span> ·
            password <span class="copy mono" data-copy="${esc(o.trading_pass)}">${esc(o.trading_pass) || '-'}</span></div>
          <div class="grid c2" style="gap:0 12px"><div class="field"><label>IP / host VPS</label><input name="vps_ip" value="${esc(l.vps_ip)}"></div>
          <div class="field"><label>Username VPS</label><input name="vps_user" value="${esc(l.vps_user)}"></div></div>
          <div class="field"><label>Password VPS ${l.vps_pass ? '(kosongkan = tidak diubah)' : ''}</label><input name="vps_pass" placeholder="${l.vps_pass ? '••••••' : ''}"></div>
          <div class="field"><label>Catatan untuk member</label><input name="vps_note" value="${esc(l.vps_note)}" placeholder="contoh: EA sudah jalan di chart XAUUSDc M1"></div>
          <button class="btn btn-ghost btn-sm" type="submit">Simpan detail VPS</button></form>` : ''}
        ${o.status === 'processing' ? `<hr><div class="field"><label>Catatan untuk member (opsional)</label><input id="anote"></div>
          <button class="btn btn-green" id="complete">✔ Oke, Selesai</button>` : `<div class="alert ok small" style="margin-top:12px">Selesai ${fmtDateTime(o.completed_at)}${o.admin_note ? ' · ' + esc(o.admin_note) : ''}</div>`}`;
    } else {
      procHtml = `<div class="alert small">${orderBadge(o.status)} ${esc(o.admin_note || '')}</div>`;
    }
    steps.push(`<div class="card ${o.status === 'processing' ? 'gold' : ''}"><h3>${steps.length + 1}. Proses${o.status === 'processing' || o.status === 'completed' ? ' &amp; Selesai' : ''}</h3>${procHtml}</div>`);

    view.innerHTML = `<div class="crumb"><a href="${back}">← Kembali</a></div>
      ${title(`<span style="font-family:monospace">${esc(o.code)}</span>`, `${ibBadge(o)} ${orderBadge(o.status, o.status_label)}`)}
      <div class="grid c2" style="align-items:start">
        <div class="stack">${steps.join('')}</div>
        <div class="stack">
          <div class="card"><h3>Order</h3><dl class="kv small">
            <dt>Paket</dt><dd>${esc(o.product_name)}${o.kind === 'renew' ? ' <span class="badge b-gray">Perpanjang</span>' : ''}</dd>
            <dt>Durasi</dt><dd>${billingText(o, o.months)}</dd>
            <dt>Platform</dt><dd>${o.platform.toUpperCase()}</dd>
            <dt>Broker / server</dt><dd>${esc(o.broker)}${o.broker_server ? ' · ' + esc(o.broker_server) : ''}</dd>
            <dt>Nomor akun</dt><dd><b class="copy" data-copy="${esc(o.account_number)}">${esc(o.account_number)}</b></dd>
            ${o.trading_pass ? `<dt>Password trading</dt><dd class="mono copy" data-copy="${esc(o.trading_pass)}">${esc(o.trading_pass)}</dd>` : ''}
            <dt>Dibuat</dt><dd>${fmtDateTime(o.created_at)}</dd>
            ${l ? `<dt>Lisensi</dt><dd><a href="#/lisensi/${l.id}">#${l.id}</a> ${licenseBadge(l.status)} s/d ${fmtDate(l.expires_at)}</dd>` : ''}
          </dl></div>
          <div class="card"><h3>Member</h3><dl class="kv small"><dt>Nama</dt><dd>${esc(o.user_name)}</dd><dt>Email</dt><dd>${esc(o.user_email)}</dd>
            <dt>WhatsApp</dt><dd>${esc(o.user_phone)} ${o.user_phone ? `<a href="${waLink(o.user_phone)}" target="_blank" rel="noopener">chat →</a>` : ''}</dd>
            <dt>Alamat</dt><dd>${esc(o.user_address) || '-'}</dd></dl></div>
        </div>
      </div>`;

    const act = (sel, fn) => { const el = $(sel); if (el) el.onclick = (e) => fn(e.currentTarget); };
    act('#ib-yes', async (btn) => { await busy(btn, () => post(`/admin/orders/${o.id}/ib`, { verified: true })); toast('Ditandai under IB'); render(); counts(); });
    act('#ib-no', async () => {
      const m = modal('Bukan under IB', `<p class="small muted" style="margin-bottom:12px">Order ditolak dan member diberi panduan cara jadi IB.</p>
        <div class="field"><label>Pesan untuk member</label><textarea id="ibn">Akun ${esc(o.account_number)} belum terdaftar di bawah IB kami.</textarea></div>
        <button class="btn btn-red btn-block" id="ibn-ok">Tolak &amp; kirim pesan</button>`);
      $('#ibn-ok', m.el).onclick = async (e) => { await busy(e.target, () => post(`/admin/orders/${o.id}/ib`, { verified: false, note: $('#ibn', m.el).value })); m.close(); render(); counts(); };
    });
    act('#process', async (btn) => {
      if (!(await confirmBox('Proses order?', `Lisensi dibuat untuk akun <b>${esc(o.account_number)}</b>${o.includes_ea ? ' dan file EA langsung di-compile' : ''}. Member mendapat email "sedang diproses".`, 'Proses'))) return;
      await busy(btn, () => post(`/admin/orders/${o.id}/process`)); toast('Diproses. EA sedang di-compile…'); render(); counts();
    });
    act('#reject', async () => {
      const m = modal('Tolak order', `<div class="field"><label>Alasan (dikirim ke member)</label><textarea id="rr"></textarea></div><button class="btn btn-red btn-block" id="rr-ok">Tolak</button>`);
      $('#rr-ok', m.el).onclick = async (e) => { await busy(e.target, () => post(`/admin/orders/${o.id}/reject`, { reason: $('#rr', m.el).value })); m.close(); render(); counts(); };
    });
    act('#rebuild', async (btn) => { await busy(btn, () => post(`/admin/licenses/${l.id}/build`)); toast('Masuk antrean compile'); render(); });
    act('#complete', async (btn) => {
      if (o.includes_ea && !(b && b.status === 'done') && !(await confirmBox('File EA belum siap', 'File EA belum selesai di-compile. Tetap tandai selesai?', 'Tetap selesai'))) return;
      if (o.includes_vps && l && !l.vps_ip && !(await confirmBox('Detail VPS kosong', 'IP VPS belum diisi. Tetap tandai selesai?', 'Tetap selesai'))) return;
      await busy(btn, () => post(`/admin/orders/${o.id}/complete`, { admin_note: $('#anote').value })); toast('Selesai. Email dikirim ke member.'); render(); counts();
    });
    const vf = $('#vpsf');
    if (vf) vf.onsubmit = async (e) => {
      e.preventDefault();
      await busy($('button', vf), () => api(`/admin/licenses/${l.id}`, { method: 'PUT', body: Object.fromEntries(new FormData(vf)) }));
      toast('Detail VPS disimpan'); render();
    };
    // Live build status while compiling
    if (b && ['queued', 'building'].includes(b.status)) {
      timer = setInterval(async () => {
        const r = await api('/admin/orders/' + id).catch(() => null);
        const nb = r && r.builds[0];
        if (nb && (nb.status !== b.status || nb.id !== b.id)) { clearInterval(timer); render(); if (nb.status === 'done') toast('File EA siap ✔'); }
      }, 4000);
    }
  }

  // ------------------------------------------------------------------ account changes
  async function changesPage() {
    const st = sessionStorage.getItem('chg') || 'pending';
    const { changes } = await api('/admin/changes?status=' + st);
    view.innerHTML = `${title('🔁 Pengajuan Ganti Nomor Akun')}
      <div class="choice" id="ct" style="margin-bottom:14px">${[['pending', 'Menunggu'], ['approved', 'Disetujui'], ['rejected', 'Ditolak'], ['all', 'Semua']].map(([v, l]) => `<label><input type="radio" name="c" value="${v}" ${st === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>
      ${changes.length ? `<div class="table-wrap"><table><thead><tr><th>Member</th><th>Paket</th><th>Akun lama → baru</th><th>Alasan</th><th>Status</th><th></th></tr></thead><tbody>
        ${changes.map((c) => `<tr><td>${esc(c.user_name)}<div class="tiny muted">${esc(c.user_email)}</div></td><td class="small">${esc(c.product_name)}</td>
          <td>${esc(c.old_account)} → <b>${esc(c.new_account)}</b>${c.new_server ? `<div class="tiny muted">${esc(c.new_server)}</div>` : ''}</td>
          <td class="small">${esc(c.reason) || '-'}<div class="tiny muted">${ago(c.created_at)}</div></td>
          <td><span class="badge ${{ pending: 'b-orange', approved: 'b-green', rejected: 'b-red' }[c.status]}">${c.status}</span>${c.admin_note ? `<div class="tiny muted">${esc(c.admin_note)}</div>` : ''}</td>
          <td class="nowrap">${c.status === 'pending' ? `<button class="btn btn-green btn-sm" data-ok="${c.id}">Setujui &amp; generate</button> <button class="btn btn-red btn-sm" data-no="${c.id}">Tolak</button>` : `<a href="#/lisensi/${c.license_id}" class="small">Lisensi →</a>`}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="card empty">Tidak ada pengajuan.</div>'}`;
    $('#ct').onchange = (e) => { sessionStorage.setItem('chg', e.target.value); render(); };
    $$('[data-ok]').forEach((b) => b.onclick = async () => {
      const c = changes.find((x) => x.id == b.dataset.ok);
      if (!(await confirmBox('Setujui ganti akun?', `${esc(c.old_account)} → <b>${esc(c.new_account)}</b>. File EA baru langsung di-compile untuk akun baru.${c.includes_vps ? ' Jangan lupa ganti login MT di VPS.' : ''}`, 'Setujui'))) return;
      await busy(b, () => post(`/admin/changes/${c.id}/approve`)); toast('Disetujui, EA baru di-compile'); render(); counts();
    });
    $$('[data-no]').forEach((b) => b.onclick = () => {
      const m = modal('Tolak pengajuan', `<div class="field"><label>Alasan</label><textarea id="cn"></textarea></div><button class="btn btn-red btn-block" id="cn-ok">Tolak</button>`);
      $('#cn-ok', m.el).onclick = async (e) => { await busy(e.target, () => post(`/admin/changes/${b.dataset.no}/reject`, { note: $('#cn', m.el).value })); m.close(); render(); counts(); };
    });
  }

  // ------------------------------------------------------------------ licenses
  async function licensesPage(id) {
    if (id) return licenseDetail(id);
    const st = JSON.parse(sessionStorage.getItem('lic') || '{"status":"","q":""}');
    view.innerHTML = `${title('🔑 Lisensi &amp; VPS')}
      <div class="row between" style="margin-bottom:14px"><div class="choice" id="lt">${[['', 'Semua'], ['active', 'Aktif'], ['processing', 'Diproses'], ['expired', 'Habis'], ['suspended', 'Nonaktif']].map(([v, l]) => `<label><input type="radio" name="l" value="${v}" ${st.status === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>
      <input id="lq" placeholder="Cari akun / email / IP" value="${esc(st.q)}" style="max-width:260px"></div><div id="ll"></div>`;
    const load = async () => {
      const { licenses } = await api('/admin/licenses?' + new URLSearchParams(st));
      $('#ll').innerHTML = licenses.length ? `<div class="table-wrap"><table><thead><tr><th>Akun</th><th>Member</th><th>Paket</th><th>Berlaku</th><th>VPS</th><th>Status</th></tr></thead><tbody>
        ${licenses.map((l) => `<tr class="click" onclick="location.hash='#/lisensi/${l.id}'"><td><b>${esc(l.account_number)}</b><div class="tiny muted">${esc(l.broker)} · ${l.platform.toUpperCase()}</div></td>
          <td>${esc(l.user_name)}<div class="tiny muted">${esc(l.user_email)}</div></td><td class="small">${esc(l.product_name)}</td>
          <td class="nowrap small">${fmtDate(l.expires_at)}${l.expires_at ? `<div class="tiny ${l.days_left <= 7 ? '' : 'muted'}" style="${l.days_left <= 7 ? 'color:var(--orange)' : ''}">${l.days_left > 0 ? l.days_left + ' hari lagi' : 'habis'}</div>` : ''}</td>
          <td class="small mono">${l.includes_vps ? esc(l.vps_ip || '— belum diisi') : '-'}</td><td>${licenseBadge(l.status)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="card empty">Belum ada lisensi.</div>';
    };
    $('#lt').onchange = (e) => { st.status = e.target.value; sessionStorage.setItem('lic', JSON.stringify(st)); load(); };
    let t; $('#lq').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { st.q = e.target.value; sessionStorage.setItem('lic', JSON.stringify(st)); load(); }, 300); };
    await load();
  }

  async function licenseDetail(id) {
    const { license: l, builds, changes, orders } = await api('/admin/licenses/' + id);
    view.innerHTML = `<div class="crumb"><a href="#/lisensi">← Lisensi</a></div>
      ${title(`Akun ${esc(l.account_number)}`, licenseBadge(l.status))}
      <div class="grid c2" style="align-items:start">
        <form class="card" id="lf"><h3>Edit lisensi</h3>
          <div class="grid c2" style="gap:0 12px">
            <div class="field"><label>Status</label><select name="status">${['processing', 'active', 'expired', 'suspended'].map((s) => `<option ${l.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
            <div class="field"><label>Berlaku sampai (kosong = selamanya)</label><input type="date" name="expires" value="${dateInput(l.expires_at)}"></div>
            <div class="field"><label>Nomor akun</label><input name="account_number" value="${esc(l.account_number)}"></div>
            <div class="field"><label>Server broker</label><input name="broker_server" value="${esc(l.broker_server)}"></div>
          </div>
          ${l.includes_vps ? `<div class="small muted" style="margin:4px 0 10px">Password trading member: <span class="mono copy" data-copy="${esc(l.trading_pass)}">${esc(l.trading_pass) || '-'}</span></div>
          <div class="grid c2" style="gap:0 12px"><div class="field"><label>IP VPS</label><input name="vps_ip" value="${esc(l.vps_ip)}"></div>
            <div class="field"><label>Username VPS</label><input name="vps_user" value="${esc(l.vps_user)}"></div></div>
          <div class="field"><label>Password VPS ${l.vps_pass ? '(sekarang: <span class="mono copy" data-copy="' + esc(l.vps_pass) + '">' + esc(l.vps_pass) + '</span>)' : ''}</label><input name="vps_pass" placeholder="kosongkan = tidak diubah"></div>
          <div class="field"><label>Catatan VPS (terlihat member)</label><input name="vps_note" value="${esc(l.vps_note)}"></div>` : ''}
          <p class="tiny muted" style="margin-bottom:12px">Mengubah nomor akun atau tanggal berlaku otomatis membuat file EA baru.</p>
          <button class="btn btn-gold" type="submit">Simpan</button></form>
        <div class="stack">
          <div class="card"><dl class="kv small"><dt>Member</dt><dd>${esc(l.user_name)}<div class="tiny muted">${esc(l.user_email)} · ${esc(l.user_phone)}</div></dd>
            <dt>Paket</dt><dd>${esc(l.product_name)}</dd><dt>Broker</dt><dd>${esc(l.broker)} · ${l.platform.toUpperCase()}</dd>
            <dt>Order</dt><dd>${orders.map((o) => `<a href="#/${l.requires_ib ? 'ib' : 'pesanan'}/${o.id}" class="mono">${esc(o.code)}</a> ${orderBadge(o.status)}`).join('<br>')}</dd></dl></div>
          ${l.includes_ea ? `<div class="card"><div class="row between" style="margin-bottom:10px"><h3 style="margin:0">File EA</h3><button class="btn btn-outline btn-sm" id="rb">↻ Generate ulang</button></div>
            ${builds.length ? `<div class="table-wrap"><table><thead><tr><th>#</th><th>Akun</th><th>Berlaku</th><th>Status</th><th></th></tr></thead><tbody>${builds.map((b) => `<tr>
              <td>${b.id}<div class="tiny muted">${ago(b.created_at)}</div></td><td>${esc(b.account_number)}</td><td class="small">${fmtDate(b.expires_at)}</td>
              <td>${buildBadge(b.status)}<div class="tiny muted">${esc(b.reason)}</div></td>
              <td>${b.file_id && b.status === 'done' ? `<a class="small" href="/api/files/${b.file_id}">Unduh</a>` : b.status === 'failed' ? `<a class="small" href="#" data-log="${b.id}">Log</a>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<div class="muted small">Belum ada build.</div>'}</div>` : ''}
          ${changes.length ? `<div class="card"><h3>Riwayat ganti akun</h3>${changes.map((c) => `<div class="small" style="padding:6px 0;border-bottom:1px solid var(--line)">${esc(c.old_account)} → <b>${esc(c.new_account)}</b> · ${c.status} · ${fmtDate(c.created_at)}</div>`).join('')}</div>` : ''}
        </div>
      </div>`;
    $('#lf').onsubmit = async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(e.target));
      d.expires_at = fromDateInput(d.expires); delete d.expires;
      if (l.expires_at && dateInput(l.expires_at) === dateInput(d.expires_at)) d.expires_at = l.expires_at;
      const r = await busy($('#lf button[type=submit]'), () => api('/admin/licenses/' + l.id, { method: 'PUT', body: d }));
      toast(r.rebuilt ? 'Disimpan. File EA baru sedang di-compile.' : 'Disimpan'); render();
    };
    const rb = $('#rb');
    if (rb) rb.onclick = async () => { await busy(rb, () => post(`/admin/licenses/${l.id}/build`)); toast('Masuk antrean compile'); render(); };
    $$('[data-log]').forEach((a) => a.onclick = (e) => { e.preventDefault(); const b = builds.find((x) => x.id == a.dataset.log); modal('Log build #' + b.id, `<pre style="white-space:pre-wrap;font-size:.75rem">${esc(b.log)}</pre>`, { wide: true }); });
    if (builds.some((b) => ['queued', 'building'].includes(b.status))) timer = setInterval(() => render(), 5000);
  }

  async function buildsPage() {
    const [{ builds }, s] = await Promise.all([api('/admin/builds'), api('/admin/stats')]);
    const online = s.builder && s.now - s.builder.at < 90;
    view.innerHTML = `${title('⚙️ Generate EA')}
      <div class="alert ${online ? 'ok' : 'warn'}" style="margin-bottom:16px">Builder ${online ? `<b>online</b> (${esc(s.builder.id)}, ${ago(s.builder.at)})` : '<b>offline</b>. Jalankan <b>Jalankan Builder.bat</b> di PC/VPS Windows. Order tetap antre dan otomatis diproses saat builder menyala.'}</div>
      ${builds.length ? `<div class="table-wrap"><table><thead><tr><th>#</th><th>Member</th><th>Akun</th><th>Berlaku</th><th>Versi</th><th>Status</th><th>Waktu</th><th></th></tr></thead><tbody>
      ${builds.map((b) => `<tr class="click" onclick="location.hash='#/lisensi/${b.license_id}'"><td>${b.id}</td><td>${esc(b.user_name)}</td><td><b>${esc(b.account_number)}</b> <span class="tiny muted">${b.platform.toUpperCase()}</span></td>
        <td class="small">${fmtDate(b.expires_at)}</td><td class="small">${esc(b.ea_version || '-')}</td><td>${buildBadge(b.status)}<div class="tiny muted">${esc(b.reason)}</div></td>
        <td class="small nowrap">${ago(b.created_at)}</td><td>${b.file_id && b.status === 'done' ? `<a class="small" href="/api/files/${b.file_id}" onclick="event.stopPropagation()">Unduh</a>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<div class="card empty">Belum ada.</div>'}`;
    if (builds.some((b) => ['queued', 'building'].includes(b.status))) timer = setInterval(() => render(), 5000);
  }

  // ------------------------------------------------------------------ users
  async function usersPage() {
    const { users } = await api('/admin/users');
    view.innerHTML = `${title('👥 Member', `<span class="muted small">${users.length} akun</span>`)}
      <div class="table-wrap"><table><thead><tr><th>Nama</th><th>Email</th><th>WhatsApp</th><th>Alamat</th><th>Lisensi aktif</th><th>Order</th><th>Daftar</th><th>Role</th><th></th></tr></thead><tbody>
      ${users.map((u) => `<tr><td>${esc(u.name)}</td><td class="small">${esc(u.email)}</td><td class="small">${esc(u.phone)} ${u.phone ? `<a href="${waLink(u.phone)}" target="_blank" rel="noopener">↗</a>` : ''}</td><td class="tiny muted" style="max-width:220px">${esc(u.address)}</td>
        <td>${u.active_licenses}</td><td>${u.orders}</td><td class="small nowrap">${fmtDate(u.created_at)}</td>
        <td>${u.role === 'admin' ? '<span class="badge b-gold">admin</span>' : '<span class="badge b-gray">member</span>'} ${u.status === 'blocked' ? '<span class="badge b-red">diblokir</span>' : ''}</td>
        <td class="nowrap">${u.id === me.id ? '' : `<button class="btn btn-ghost btn-sm" data-u="${u.id}">Ubah</button>`}</td></tr>`).join('')}</tbody></table></div>`;
    $$('[data-u]').forEach((b) => b.onclick = () => {
      const u = users.find((x) => x.id == b.dataset.u);
      const m = modal(u.name, `<div class="field"><label>Role</label><select id="ur"><option value="member">member</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>admin</option></select></div>
        <div class="field"><label>Status</label><select id="us"><option value="active">aktif</option><option value="blocked" ${u.status === 'blocked' ? 'selected' : ''}>diblokir</option></select></div>
        <button class="btn btn-gold btn-block" id="uok">Simpan</button>`);
      $('#uok', m.el).onclick = async (e) => { await busy(e.target, () => api('/admin/users/' + u.id, { method: 'PUT', body: { role: $('#ur', m.el).value, status: $('#us', m.el).value } })); m.close(); render(); };
    });
  }

  // ------------------------------------------------------------------ products
  const KINDS = { ea_ib: 'EA gratis (IB)', ib_vps: 'VPS untuk EA gratis (IB)', ea_lifetime: 'EA beli selamanya', ea_rent: 'EA sewa bulanan', vps_ea: 'VPS + EA (bulanan)', vps: 'VPS saja (bulanan)' };
  async function productsPage() {
    const { products } = await api('/admin/products');
    view.innerHTML = `${title('🏷️ Produk &amp; Harga', '<button class="btn btn-gold btn-sm" id="np">+ Produk</button>')}
      <div class="table-wrap"><table><thead><tr><th>Urut</th><th>Nama</th><th>Jenis</th><th>Harga</th><th>Status</th><th></th></tr></thead><tbody>
      ${products.map((p) => `<tr><td>${p.sort}</td><td><b>${esc(p.name)}</b><div class="tiny muted">${esc(p.description).slice(0, 90)}</div></td><td class="small">${KINDS[p.kind] || p.kind}</td>
        <td class="nowrap">${p.billing === 'free' ? 'Gratis' : rupiah(p.price) + (p.billing === 'monthly' ? '/bln' : '')}</td>
        <td>${p.active ? '<span class="badge b-green">tampil</span>' : '<span class="badge b-gray">disembunyikan</span>'}</td><td><button class="btn btn-ghost btn-sm" data-p="${p.id}">Edit</button></td></tr>`).join('')}</tbody></table></div>
      <p class="small muted" style="margin-top:12px">Diskon per durasi (mis. 12 bulan -25%) diatur di <a href="#/pengaturan">Pengaturan</a>.</p>`;
    const edit = (p) => {
      const m = modal(p ? 'Edit produk' : 'Produk baru', `<form id="pf">
        <div class="field"><label>Nama</label><input name="name" value="${esc(p?.name)}"></div>
        <div class="grid c2" style="gap:0 12px"><div class="field"><label>Jenis</label><select name="kind">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}" ${p?.kind === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        <div class="field"><label>Harga (Rp; bulanan = per bulan)</label><input name="price" type="number" min="0" step="1000" value="${p?.price ?? ''}"></div></div>
        <div class="field"><label>Deskripsi</label><textarea name="description">${esc(p?.description)}</textarea></div>
        <div class="field"><label>Keunggulan (satu per baris)</label><textarea name="features" style="min-height:120px">${esc(p?.features)}</textarea></div>
        <div class="grid c2" style="gap:0 12px"><div class="field"><label>Urutan</label><input name="sort" type="number" value="${p?.sort ?? 9}"></div>
        <div class="field"><label>&nbsp;</label><label class="row" style="color:var(--text)"><input type="checkbox" name="active" ${!p || p.active ? 'checked' : ''}> Tampilkan ke member</label></div></div>
        <button class="btn btn-gold btn-block" type="submit">Simpan</button></form>`, { wide: true });
      $('#pf', m.el).onsubmit = async (e) => {
        e.preventDefault();
        const d = Object.fromEntries(new FormData(e.target)); d.active = !!d.active;
        await busy($('button[type=submit]', e.target), () => api('/admin/products' + (p ? '/' + p.id : ''), { method: p ? 'PUT' : 'POST', body: d }));
        m.close(); toast('Produk disimpan'); render();
      };
    };
    $('#np').onclick = () => edit(null);
    $$('[data-p]').forEach((b) => b.onclick = () => edit(products.find((x) => x.id == b.dataset.p)));
  }

  // ------------------------------------------------------------------ settings
  async function settingsPage() {
    const s = await api('/admin/settings');
    const env = s._env;
    const prov = s.email_provider || env.email_provider || 'log';
    const brokerRow = (b = { name: '', link: '', active: true }) => `<div class="row ibr" style="margin-bottom:8px;flex-wrap:nowrap">
      <input class="ib-name" value="${esc(b.name)}" placeholder="Broker" style="max-width:120px"><input class="ib-link" style="flex:1" value="${esc(b.link)}" placeholder="https://link-ib-anda">
      <label class="row nowrap" style="margin:0;color:var(--text)"><input type="checkbox" class="ib-act" ${b.active ? 'checked' : ''}> aktif</label></div>`;
    view.innerHTML = `${title('🛠️ Pengaturan')}
      <form id="sf" class="grid" style="align-items:start;grid-template-columns:repeat(auto-fit,minmax(min(380px,100%),1fr))">
        <div class="card"><h3>Pembayaran</h3>
          <div class="field"><label>Rekening / e-wallet tujuan transfer (satu per baris)</label><textarea name="bank_accounts" style="min-height:110px">${esc(s.bank_accounts)}</textarea></div>
          <div class="grid c2" style="gap:0 12px"><div class="field"><label>Batas waktu bayar (jam)</label><input name="pay_deadline_hours" type="number" min="1" value="${esc(s.pay_deadline_hours)}"></div>
          <div class="field"><label>Kode unik 3 digit</label><select name="unique_code"><option value="1">Aktif</option><option value="0" ${s.unique_code === '0' ? 'selected' : ''}>Mati</option></select></div></div>
          <h3 style="margin-top:8px">Durasi sewa &amp; diskon</h3>
          <div class="field"><label>Pilihan durasi (bulan, pisahkan koma)</label><input name="durations" value="${s.durations.join(', ')}"></div>
          <div class="field"><label>Diskon per durasi (format bulan=persen, pisahkan koma)</label><input name="discounts" value="${Object.entries(s.discounts).map(([m, d]) => `${m}=${d}`).join(', ')}">
            <div class="help">Contoh: <span class="mono">12=25</span> berarti sewa 12 bulan diskon 25%.</div></div></div>
        <div class="card"><h3>Otomatisasi</h3>
          <label class="row small" style="color:var(--text);margin-bottom:10px;align-items:flex-start"><input type="checkbox" name="auto_complete_ea" ${s.auto_complete_ea === '1' ? 'checked' : ''} style="margin-top:4px">
            <span><b>Selesai otomatis</b> untuk order EA tanpa VPS begitu file EA selesai di-compile (member &amp; admin dapat email).</span></label>
          <label class="row small" style="color:var(--text);margin-bottom:6px;align-items:flex-start"><input type="checkbox" name="auto_process_paid" ${s.auto_process_paid === '1' ? 'checked' : ''} style="margin-top:4px">
            <span><b>Proses otomatis</b> begitu member mengunggah bukti transfer, tanpa dicek admin dulu. Order IB tetap menunggu cek IB.</span></label>
          <div class="help" style="margin-bottom:14px">⚠️ Selama pembayaran masih transfer manual, sebaiknya dibiarkan mati (bukti bisa palsu). Aktifkan setelah memakai payment gateway.</div>
          <h3>Notifikasi</h3>
          <div class="field"><label>Email admin untuk notifikasi (pisahkan koma)</label><input name="admin_notify_email" value="${esc(s.admin_notify_email)}" placeholder="kosong = email admin"></div>
          <div class="field"><label>WhatsApp admin (ditampilkan ke member)</label><input name="whatsapp" value="${esc(s.whatsapp)}" placeholder="08xxxxxxxxxx"></div>
          <div class="field"><label>Pengingat sebelum masa sewa habis (hari, pisahkan koma)</label><input name="reminder_days" value="${s.reminder_days.join(', ')}"></div>
          <label class="row small" style="color:var(--text)"><input type="checkbox" name="mt4_enabled" ${s.mt4_enabled === '1' ? 'checked' : ''}> MT4 bisa dipesan (aktifkan setelah EA versi MQL4 ada)</label></div>
        <div class="card" style="grid-column:1/-1" id="email-card"><div class="row between"><h3 style="margin:0">✉️ Email (notifikasi ke member)</h3>
            <span>${prov === 'log' ? '<span class="badge b-orange">Belum aktif: email hanya dicatat di log</span>' : `<span class="badge b-green">Aktif via ${esc(prov)}</span>`}</span></div>
          <div class="grid c2" style="margin-top:14px;align-items:start">
            <div>
              <div class="field"><label>Penyedia email</label><select name="email_provider">
                <option value="log" ${prov === 'log' ? 'selected' : ''}>Log saja (tes, tidak terkirim)</option>
                <option value="resend" ${prov === 'resend' ? 'selected' : ''}>Resend (disarankan)</option>
                <option value="brevo" ${prov === 'brevo' ? 'selected' : ''}>Brevo</option></select></div>
              <div class="grid c2" style="gap:0 12px"><div class="field"><label>Email pengirim</label><input name="email_from" value="${esc(s.email_from || env.email_from)}" placeholder="no-reply@goldhuntergaruda.com"></div>
              <div class="field"><label>Nama pengirim</label><input name="email_from_name" value="${esc(s.email_from_name || 'GoldHunter Garuda')}"></div></div>
              <div class="field"><label>API key ${s.email_api_key_set ? '<span class="badge b-green">tersimpan</span>' : ''}</label><input name="email_api_key" type="password" autocomplete="off" placeholder="${s.email_api_key_set ? 'kosongkan = tidak diubah' : 're_xxxxxxxx (Resend) / xkeysib-... (Brevo)'}">
                <div class="help">Disimpan terenkripsi di database.</div></div>
              <label class="row small" style="color:var(--text);margin-bottom:14px"><input type="checkbox" name="welcome_email_password" ${s.welcome_email_password !== '0' ? 'checked' : ''}> Sertakan password di email pendaftaran (tidak ikut tersimpan di log email)</label>
              <div class="row"><input id="test-to" value="${esc(me.email)}" style="max-width:260px"><button type="button" class="btn btn-outline btn-sm" id="test-email">Kirim email tes</button></div>
              <div class="help">Simpan pengaturan dulu, baru kirim tes. Hasilnya terlihat di <a href="#/email">Log Email</a>.</div>
            </div>
            <div class="alert info small"><b>Cara mengaktifkan (Resend, gratis 3.000 email/bulan):</b>
              <ol style="margin:8px 0 0 18px"><li>Daftar di <a href="https://resend.com" target="_blank" rel="noopener">resend.com</a> memakai email Anda.</li>
              <li>Menu <b>Domains → Add Domain</b> → isi <b>goldhuntergaruda.com</b>.</li>
              <li>Klik <b>Auto configure with Cloudflare</b> (atau salin record DNS yang diberikan ke Cloudflare → DNS). Tunggu status <b>Verified</b>.</li>
              <li>Menu <b>API Keys → Create API Key</b> (permission: Sending access), salin key-nya.</li>
              <li>Di sini: pilih <b>Resend</b>, email pengirim <span class="mono">no-reply@goldhuntergaruda.com</span>, tempel API key, <b>Simpan</b>, lalu <b>Kirim email tes</b>.</li></ol></div>
          </div></div>
        <div class="card" style="grid-column:1/-1"><h3>Link IB broker (EA gratis)</h3><div id="ibl">${s.ib_brokers.map(brokerRow).join('')}</div>
          <button type="button" class="btn btn-ghost btn-sm" id="addib">+ Broker</button>
          <p class="help">QR code di halaman "Cara Jadi IB" dibuat otomatis dari link ini.</p></div>
        <div class="card"><h3>Status server</h3><dl class="kv small">
          <dt>Alamat web</dt><dd>${esc(env.site_url)}</dd>
          <dt>Kunci enkripsi</dt><dd>${env.data_key_set ? '✔' : '<span class="badge b-red">belum diatur</span>'}</dd>
          <dt>Token builder</dt><dd>${env.builder_token_set ? '✔' : '<span class="badge b-red">belum diatur</span>'}</dd>
          <dt>Secret cron</dt><dd>${env.cron_secret_set ? '✔' : '<span class="badge b-red">belum diatur</span>'}</dd></dl></div>
        <div style="grid-column:1/-1"><button class="btn btn-gold" type="submit">Simpan Pengaturan</button></div>
      </form>`;
    $('#addib').onclick = () => $('#ibl').insertAdjacentHTML('beforeend', brokerRow());
    $('#test-email').onclick = async (e) => {
      const r = await busy(e.target, () => post('/admin/email-test', { to: $('#test-to').value }));
      if (r.status === 'sent') toast('Email tes terkirim ✔ Cek inbox (dan folder Spam).');
      else if (r.status === 'logged') toast('Mode "Log saja": email hanya dicatat, tidak dikirim. Pilih Resend/Brevo lalu Simpan.', 'err');
      else toast('Gagal: ' + r.error, 'err');
    };
    $('#sf').onsubmit = async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(e.target));
      const body = {
        bank_accounts: d.bank_accounts, pay_deadline_hours: d.pay_deadline_hours, unique_code: d.unique_code,
        durations: d.durations.split(/[,\s]+/).filter(Boolean).map(Number),
        discounts: Object.fromEntries(d.discounts.split(',').map((x) => x.split('=').map((y) => y.trim())).filter((x) => x.length === 2)),
        reminder_days: d.reminder_days.split(/[,\s]+/).filter(Boolean).map(Number),
        admin_notify_email: d.admin_notify_email, whatsapp: d.whatsapp, mt4_enabled: d.mt4_enabled ? '1' : '0',
        auto_complete_ea: d.auto_complete_ea ? '1' : '0', auto_process_paid: d.auto_process_paid ? '1' : '0',
        ib_brokers: $$('.ibr').map((r) => ({ name: $('.ib-name', r).value, link: $('.ib-link', r).value, active: $('.ib-act', r).checked })),
        email_provider: d.email_provider, email_from: d.email_from, email_from_name: d.email_from_name, email_api_key: d.email_api_key,
        welcome_email_password: d.welcome_email_password ? '1' : '0',
      };
      await busy($('#sf button[type=submit]'), () => api('/admin/settings', { method: 'PUT', body }));
      toast('Pengaturan disimpan'); render();
    };
  }

  async function emailsPage() {
    const { emails } = await api('/admin/emails');
    view.innerHTML = `${title('✉️ Log Email')}
      <div class="table-wrap"><table><thead><tr><th>Waktu</th><th>Kepada</th><th>Subjek</th><th>Status</th></tr></thead><tbody>
      ${emails.map((m) => `<tr class="click" data-e="${m.id}"><td class="small nowrap">${fmtDateTime(m.created_at)}</td><td class="small">${esc(m.to_addr)}</td><td>${esc(m.subject)}</td>
        <td><span class="badge ${{ sent: 'b-green', failed: 'b-red', logged: 'b-orange' }[m.status]}">${{ sent: 'terkirim', failed: 'gagal', logged: 'log saja' }[m.status]}</span>${m.error ? `<div class="tiny muted">${esc(m.error.slice(0, 120))}</div>` : ''}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Belum ada email</td></tr>'}</tbody></table></div>`;
    $$('[data-e]').forEach((r) => r.onclick = () => modal('Isi email', `<iframe src="/api/admin/emails/${r.dataset.e}" style="width:100%;height:65vh;border:0;border-radius:8px;background:#fff"></iframe>`, { wide: true }));
  }

  boot();
})();
