// Login / register / forgot / reset pages. The page type comes from <body data-page>.
(() => {
  const { $, api, busy, toast, esc } = GHG;
  const L = (id, en) => (window.T ? window.T(id, en) : id);
  // server messages are Indonesian: the common ones in English for English visitors
  const MSG_EN = {
    'Email atau password salah': 'Wrong email or password',
    'Email sudah terdaftar. Silakan login atau reset password.': 'This email is already registered. Please log in or reset your password.',
    'Nama lengkap wajib diisi': 'Please enter your full name',
    'Alamat wajib diisi': 'Please enter your address',
    'Email tidak valid': 'Invalid email address',
    'Nomor WhatsApp tidak valid': 'Invalid WhatsApp number',
    'Password minimal 8 karakter': 'Password must be at least 8 characters',
    'Terlalu banyak percobaan. Coba lagi beberapa menit lagi.': 'Too many attempts. Please try again in a few minutes.',
  };
  const tmsg = (m) => (window.GHG_LANG === 'en' && MSG_EN[m]) || m;
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
          if (d.password !== d.password2) throw new Error(L('Konfirmasi password tidak sama', 'The passwords do not match'));
          if (!d.agree) throw new Error(L('Centang persetujuan risiko trading dulu', 'Please tick the trading risk agreement first'));
          const r = await api('/auth/register', { method: 'POST', body: d });
          location.href = r.role === 'admin' ? '/admin' : (next() || '/member#/order');
        } else if (page === 'lupa') {
          await api('/auth/forgot', { method: 'POST', body: d });
          form.classList.add('hidden');
          show(L(`Jika <b>${esc(d.email)}</b> terdaftar, link reset password sudah dikirim ke email tersebut. Cek juga folder Spam/Promosi. Link berlaku 1 jam.`, `If <b>${esc(d.email)}</b> is registered, a password reset link has been sent to it. Also check your Spam / Promotions folder. The link is valid for 1 hour.`), 'ok');
        } else if (page === 'reset') {
          if (d.password !== d.password2) throw new Error(L('Konfirmasi password tidak sama', 'The passwords do not match'));
          await api('/auth/reset', { method: 'POST', body: { token: location.hash.slice(1), password: d.password } });
          form.classList.add('hidden');
          show(L('Password berhasil diganti. <a href="/masuk">Masuk sekarang →</a>', 'Password changed. <a href="/masuk">Log in now →</a>'), 'ok');
        }
      });
    } catch (err) {
      show(esc(tmsg(err.message)));
    }
  });

  if (page === 'reset' && location.hash.length < 10) {
    show(L('Link reset tidak lengkap. Buka link dari email Anda, atau <a href="/lupa-password">minta link baru</a>.', 'The reset link is incomplete. Open the link from your email, or <a href="/lupa-password">request a new one</a>.'));
    form.classList.add('hidden');
  }
})();
