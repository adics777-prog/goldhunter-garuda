// Login / register / forgot / reset pages. The page type comes from <body data-page>.
(() => {
  const { $, api, busy, toast, esc } = GHG;
  const page = document.body.dataset.page;
  const form = $('form');
  const msg = $('#msg');
  const show = (text, type = 'err') => { msg.className = 'alert ' + type; msg.innerHTML = text; msg.classList.remove('hidden'); };
  const qs = new URLSearchParams(location.search);
  const paket = /^\d+$/.test(qs.get('paket') || '') ? qs.get('paket') : '';
  const next = () => {
    if (paket) return '/member#/order/' + paket;
    const n = qs.get('next');
    return n && n.startsWith('/') && !n.startsWith('//') ? n : null;
  };
  // Keep the chosen package when switching between Masuk and Daftar
  document.querySelectorAll('.keep-q').forEach((a) => { a.href += location.search; });
  const note = $('#order-note');
  if (note && page === 'masuk' && (paket || (qs.get('next') || '').includes('order'))) {
    note.classList.remove('hidden');
    $('#reg-link').href += location.search;
  }

  // Already logged in -> straight to the area
  if (page === 'masuk' || page === 'daftar') {
    api('/me').then((r) => { if (r.user) location.href = next() || (r.user.role === 'admin' ? '/admin' : '/member'); }).catch(() => {});
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    msg.classList.add('hidden');
    const d = Object.fromEntries(new FormData(form));
    const btn = $('button[type=submit]', form);
    try {
      await busy(btn, async () => {
        if (page === 'masuk') {
          const r = await api('/auth/login', { method: 'POST', body: d });
          location.href = next() || (r.role === 'admin' ? '/admin' : '/member');
        } else if (page === 'daftar') {
          if (d.password !== d.password2) throw new Error('Konfirmasi password tidak sama');
          if (!d.agree) throw new Error('Centang persetujuan risiko trading dulu');
          const r = await api('/auth/register', { method: 'POST', body: d });
          location.href = r.role === 'admin' ? '/admin' : (next() || '/member#/order');
        } else if (page === 'lupa') {
          await api('/auth/forgot', { method: 'POST', body: d });
          form.classList.add('hidden');
          show(`Jika <b>${esc(d.email)}</b> terdaftar, link reset password sudah dikirim ke email tersebut. Cek juga folder Spam/Promosi. Link berlaku 1 jam.`, 'ok');
        } else if (page === 'reset') {
          if (d.password !== d.password2) throw new Error('Konfirmasi password tidak sama');
          await api('/auth/reset', { method: 'POST', body: { token: location.hash.slice(1), password: d.password } });
          form.classList.add('hidden');
          show('Password berhasil diganti. <a href="/masuk">Masuk sekarang →</a>', 'ok');
        }
      });
    } catch (err) {
      show(esc(err.message));
    }
  });

  if (page === 'reset' && location.hash.length < 10) {
    show('Link reset tidak lengkap. Buka link dari email Anda, atau <a href="/lupa-password">minta link baru</a>.');
    form.classList.add('hidden');
  }
})();
