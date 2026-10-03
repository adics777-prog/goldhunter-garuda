// Shared front-end helpers (member + admin + auth pages). No framework.
const GHG = (() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rupiah = (n) => 'Rp ' + Math.round(n || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const fmtDate = (t) => { if (!t) return 'Selamanya'; const d = new Date(t * 1000); return `${d.getDate()} ${BULAN[d.getMonth()]} ${d.getFullYear()}`; };
  const fmtDateTime = (t) => { if (!t) return '-'; const d = new Date(t * 1000); return `${fmtDate(t)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const ago = (t) => {
    const s = Math.floor(Date.now() / 1000) - t;
    if (s < 60) return 'baru saja';
    if (s < 3600) return Math.floor(s / 60) + ' menit lalu';
    if (s < 86400) return Math.floor(s / 3600) + ' jam lalu';
    return Math.floor(s / 86400) + ' hari lalu';
  };

  async function api(path, { method = 'GET', body } = {}) {
    const opt = { method, headers: {}, credentials: 'same-origin' };
    if (body !== undefined) { opt.headers['content-type'] = 'application/json'; opt.body = JSON.stringify(body); }
    let r;
    try { r = await fetch('/api' + path, opt); } catch { throw new Error('Tidak bisa terhubung ke server. Periksa koneksi internet.'); }
    let data = {};
    try { data = await r.json(); } catch {}
    if (r.status === 401 && !path.startsWith('/auth/')) { location.href = '/masuk?next=' + encodeURIComponent(location.pathname + location.hash); throw new Error('Silakan login'); }
    if (!r.ok) throw new Error(data.error || `Gagal (${r.status})`);
    return data;
  }

  function toast(msg, type = 'ok') {
    let box = $('#toast');
    if (!box) { box = document.createElement('div'); box.id = 'toast'; document.body.appendChild(box); }
    const el = document.createElement('div');
    el.className = type;
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => el.remove(), type === 'err' ? 6000 : 3500);
  }

  // Run an async action with the button disabled + spinner; errors become toasts.
  async function busy(btn, fn) {
    const html = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'; }
    try { return await fn(); } catch (e) { toast(e.message, 'err'); throw e; } finally { if (btn) { btn.disabled = false; btn.innerHTML = html; } }
  }

  function modal(title, html, { wide = false } = {}) {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal ${wide ? 'wide' : ''}"><button class="x" aria-label="Tutup">×</button><h2>${esc(title)}</h2><div class="m-body">${html}</div></div>`;
    const close = () => { bg.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(); });
    $('.x', bg).onclick = close;
    document.addEventListener('keydown', onKey);
    document.body.appendChild(bg);
    return { el: $('.m-body', bg), close };
  }
  function confirmBox(title, text, okLabel = 'Ya, lanjutkan', danger = false) {
    return new Promise((resolve) => {
      const m = modal(title, `<p class="muted">${text}</p><div class="row" style="justify-content:flex-end;margin-top:20px">
        <button class="btn btn-ghost" data-no>Batal</button><button class="btn ${danger ? 'btn-red' : 'btn-gold'}" data-yes>${esc(okLabel)}</button></div>`);
      $('[data-no]', m.el).onclick = () => { m.close(); resolve(false); };
      $('[data-yes]', m.el).onclick = () => { m.close(); resolve(true); };
    });
  }

  function copy(text) {
    navigator.clipboard?.writeText(text).then(() => toast('Disalin: ' + text), () => toast('Gagal menyalin', 'err'));
  }
  document.addEventListener('click', (e) => {
    const c = e.target.closest('[data-copy]');
    if (c) copy(c.dataset.copy);
    const pw = e.target.closest('[data-toggle-pw]');
    if (pw) { const i = pw.parentElement.querySelector('input'); i.type = i.type === 'password' ? 'text' : 'password'; pw.textContent = i.type === 'password' ? 'lihat' : 'sembunyi'; }
  });

  // Shrink photos before upload (D1 rows are limited to ~2 MB).
  async function readProof(file) {
    if (!file) throw new Error('Pilih file bukti transfer');
    if (file.type === 'application/pdf') {
      if (file.size > 1_300_000) throw new Error('PDF terlalu besar (maks 1,3 MB). Kirim foto/screenshot saja.');
      return { name: file.name, mime: file.type, data_b64: await toB64(file) };
    }
    if (!file.type.startsWith('image/')) throw new Error('Bukti harus berupa gambar atau PDF');
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Gambar tidak bisa dibaca')); i.src = URL.createObjectURL(file); });
    const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    let q = 0.82, blob;
    do { blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', q)); q -= 0.12; } while (blob.size > 1_000_000 && q > 0.3);
    return { name: file.name.replace(/\.\w+$/, '') + '.jpg', mime: 'image/jpeg', data_b64: await toB64(blob) };
  }
  function toB64(blob) {
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });
  }

  const ORDER_BADGE = {
    awaiting_payment: 'b-orange', awaiting_verification: 'b-blue', processing: 'b-gold', completed: 'b-green',
    rejected: 'b-red', cancelled: 'b-gray', expired: 'b-gray',
  };
  const ORDER_LABEL = {
    awaiting_payment: 'Menunggu Pembayaran', awaiting_verification: 'Menunggu Verifikasi', processing: 'Diproses',
    completed: 'Selesai', rejected: 'Ditolak', cancelled: 'Dibatalkan', expired: 'Kedaluwarsa',
  };
  const orderBadge = (s, label) => `<span class="badge ${ORDER_BADGE[s] || 'b-gray'}">${esc(label || ORDER_LABEL[s] || s)}</span>`;
  const LIC = { processing: ['b-blue', 'Diproses'], active: ['b-green', 'Aktif'], expired: ['b-red', 'Habis'], suspended: ['b-gray', 'Dinonaktifkan'] };
  const licenseBadge = (s) => `<span class="badge ${(LIC[s] || ['b-gray'])[0]}">${esc((LIC[s] || [0, s])[1])}</span>`;
  const BUILD = { queued: ['b-orange', 'Antre compile'], building: ['b-blue', 'Sedang compile…'], done: ['b-green', 'Siap'], failed: ['b-red', 'Gagal'], replaced: ['b-gray', 'Diganti'] };
  const buildBadge = (s) => `<span class="badge ${(BUILD[s] || ['b-gray'])[0]}">${esc((BUILD[s] || [0, s])[1])}</span>`;
  const billingText = (p, months) => p.billing === 'free' ? 'Gratis' : p.billing === 'lifetime' ? 'Sekali bayar, selamanya' : `${months} bulan`;
  const platformText = (p) => (p || '').toUpperCase();

  function qrSvg(text, size = 200) {
    if (!window.qrcode) return '';
    const q = window.qrcode(0, 'M');
    q.addData(text);
    q.make();
    return q.createSvgTag({ cellSize: Math.max(2, Math.floor(size / (q.getModuleCount() + 8))), margin: 4, scalable: true });
  }

  async function logout() {
    await api('/auth/logout', { method: 'POST', body: {} }).catch(() => {});
    location.href = '/masuk';
  }

  return {
    $, $$, esc, rupiah, fmtDate, fmtDateTime, ago, api, toast, busy, modal, confirmBox, copy, readProof,
    orderBadge, licenseBadge, buildBadge, billingText, platformText, qrSvg, logout,
  };
})();
