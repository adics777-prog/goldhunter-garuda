// GoldHunter Garuda API (Cloudflare Pages Functions + D1). All routes live under /api/.
import {
  HttpError, fail, json, readJson, now, DAY, str, int, isEmail, hashPassword, verifyPassword,
  encrypt, decrypt, createSession, destroySession, sessionUser, isAdminEmail, randomToken, sha256,
  siteUrl, esc, rupiah, fmtDate, unb64,
} from '../../server/util.js';
import {
  getSettings, putSetting, quote, notify, emailUser, emailAdmin, newOrderCode, getUser, getProduct,
  processOrder, completeOrder, queueBuild, claimBuild, rebuildAll, finishBuild, runDaily, orderStatusLabel, pickUniqueCode, ensureUniqueCode, createOrder, changeOrderMonths, getUsdIdr, toIdr, boardName, maskAccount,
} from '../../server/logic.js';
import { layout, sendEmail } from '../../server/email.js';

const routes = [];
const route = (method, path, auth, handler) => {
  const keys = [];
  const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, auth, handler });
};

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api/, '') || '/';
  try {
    for (const r of routes) {
      if (r.method !== request.method) continue;
      const m = path.match(r.re);
      if (!m) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const ctx = { request, env, url, params, base: siteUrl(env, request), user: null, waitUntil: (p) => context.waitUntil(p) };
      if (r.auth === 'builder') {
        if (!env.BUILDER_TOKEN || request.headers.get('x-builder-token') !== env.BUILDER_TOKEN) fail(401, 'Token builder salah');
      } else if (r.auth === 'cron') {
        if (!env.CRON_SECRET || request.headers.get('x-cron-secret') !== env.CRON_SECRET) fail(401, 'Secret cron salah');
      } else {
        const sess = await sessionUser(env, request);
        ctx.user = sess.user;
        ctx.refreshCookie = sess.cookie;
        if (r.auth !== 'public' && !ctx.user) fail(401, 'Silakan login dulu');
        if (r.auth === 'admin' && ctx.user.role !== 'admin') fail(403, 'Khusus admin');
      }
      const res = await r.handler(ctx);
      // Keep the login alive: renewed cookie unless the handler set its own (login/logout)
      if (ctx.refreshCookie && !res.headers.has('set-cookie')) res.headers.append('set-cookie', ctx.refreshCookie);
      return res;
    }
    return json({ error: 'Endpoint tidak ditemukan' }, 404);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: 'Terjadi kesalahan server: ' + (e.message || e) }, 500);
  }
}

// =====================================================================
// AUTH
// =====================================================================
async function rateLimit(env, key, max, windowSec) {
  const t = now();
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE key=? AND created_at > ?').bind(key, t - windowSec).first();
  if (row.n >= max) fail(429, 'Terlalu banyak percobaan. Coba lagi beberapa menit lagi.');
  await env.DB.prepare('INSERT INTO login_attempts (key, created_at) VALUES (?,?)').bind(key, t).run();
}
const clientIp = (request) => request.headers.get('cf-connecting-ip') || 'local';

route('POST', '/auth/register', 'public', async ({ request, env, base }) => {
  const b = await readJson(request);
  const name = str(b.name, 80), email = str(b.email, 120).toLowerCase(), phone = str(b.phone, 30), password = String(b.password || '');
  const address = str(b.address, 300);
  if (name.length < 2) fail(400, 'Nama lengkap wajib diisi');
  if (address.length < 5) fail(400, 'Alamat wajib diisi');
  if (!isEmail(email)) fail(400, 'Email tidak valid');
  if (!/^[0-9+\-\s]{8,20}$/.test(phone)) fail(400, 'Nomor WhatsApp tidak valid');
  if (password.length < 8) fail(400, 'Password minimal 8 karakter');
  await rateLimit(env, 'reg:' + clientIp(request), 10, 3600);
  const exists = await env.DB.prepare('SELECT 1 FROM users WHERE email=?').bind(email).first();
  if (exists) fail(409, 'Email sudah terdaftar. Silakan login atau reset password.');
  const { hash, salt } = await hashPassword(password);
  const role = isAdminEmail(env, email) ? 'admin' : 'member';
  const r = await env.DB.prepare('INSERT INTO users (email, name, phone, address, pass_hash, pass_salt, role, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .bind(email, name, phone, address, hash, salt, role, now()).run();
  const userId = r.meta.last_row_id;
  await notify(env, userId, 'Selamat datang di GoldHunter Garuda!', 'Mulai dari menu Order, atau baca "Syarat EA Gratis" untuk EA gratis.', '#/order');
  const s = await getSettings(env);
  const pwRow = (pw) => `<tr><td style="padding:6px 0;color:#a3a3b2">Password</td><td style="padding:6px 0"><b style="font-family:monospace;font-size:16px">${pw}</b></td></tr>`;
  const welcome = (pw) => layout(env, 'Pendaftaran berhasil 🎉', `<p>Halo <b>${esc(name)}</b>,</p>
    <p>Terima kasih sudah mendaftar. Akun member GoldHunter Garuda Anda sudah aktif.</p>
    <table cellpadding="0" cellspacing="0" style="width:100%;background:#0d0d13;border:1px dashed #d4a017;border-radius:10px;padding:14px 18px;margin:16px 0">
      <tr><td style="padding:6px 0;color:#a3a3b2;width:110px">Alamat web</td><td style="padding:6px 0"><a href="${base}/masuk" style="color:#f5c542">${esc(base.replace(/^https?:\/\//, ''))}/masuk</a></td></tr>
      <tr><td style="padding:6px 0;color:#a3a3b2">Email login</td><td style="padding:6px 0"><b>${esc(email)}</b></td></tr>
      ${pw ? pwRow(pw) : ''}</table>
    <p><b style="color:#f5c542">Cara login:</b></p>
    <ol style="padding-left:20px;margin:6px 0 14px"><li>Buka <a href="${base}/masuk" style="color:#f5c542">${esc(base.replace(/^https?:\/\//, ''))}/masuk</a></li>
      <li>Masukkan email dan password di atas, lalu klik <b>Masuk</b>.</li>
      <li>Pilih menu <b>Order</b> untuk memesan EA / paket VPS, atau <b>Syarat EA Gratis</b> untuk EA gratis.</li></ol>
    <p style="color:#a3a3b2;font-size:13px">Lupa password? Klik "Lupa password?" di halaman masuk, link reset dikirim ke email ini. Demi keamanan, jangan bagikan password Anda kepada siapa pun, termasuk yang mengaku admin.</p>`,
    { text: 'Masuk Member Area', url: `${base}/masuk` });
  const withPw = s.welcome_email_password !== '0';
  await sendEmail(env, email, 'Pendaftaran berhasil, info login GoldHunter Garuda',
    welcome(withPw ? esc(password) : ''), withPw ? welcome('•••••••• (tidak disimpan di log)') : undefined);
  const cookie = await createSession(env, request, userId);
  return json({ ok: true, role }, 200, { 'set-cookie': cookie });
});

route('POST', '/auth/login', 'public', async ({ request, env }) => {
  const b = await readJson(request);
  const email = str(b.email, 120).toLowerCase();
  await rateLimit(env, 'login:' + email, 8, 900);
  await rateLimit(env, 'loginip:' + clientIp(request), 30, 900);
  const u = await env.DB.prepare('SELECT * FROM users WHERE email=?').bind(email).first();
  if (!u || !(await verifyPassword(String(b.password || ''), u.pass_hash, u.pass_salt))) fail(401, 'Email atau password salah');
  if (u.status !== 'active') fail(403, 'Akun Anda diblokir. Hubungi admin.');
  if (u.role !== 'admin' && isAdminEmail(env, email)) await env.DB.prepare(`UPDATE users SET role='admin' WHERE id=?`).bind(u.id).run();
  const cookie = await createSession(env, request, u.id);
  return json({ ok: true, role: isAdminEmail(env, email) ? 'admin' : u.role }, 200, { 'set-cookie': cookie });
});

route('POST', '/auth/logout', 'public', async ({ request, env }) => {
  return json({ ok: true }, 200, { 'set-cookie': await destroySession(env, request) });
});

route('POST', '/auth/forgot', 'public', async ({ request, env, base }) => {
  const b = await readJson(request);
  const email = str(b.email, 120).toLowerCase();
  await rateLimit(env, 'forgot:' + clientIp(request), 5, 900);
  const u = await env.DB.prepare('SELECT id, name, email FROM users WHERE email=?').bind(email).first();
  if (u) {
    const token = randomToken(32);
    await env.DB.prepare('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?,?,?)')
      .bind(await sha256(token), u.id, now() + 3600).run();
    await emailUser(env, u, 'Reset password GoldHunter Garuda',
      `<p>Halo ${esc(u.name)},</p><p>Kami menerima permintaan reset password. Klik tombol di bawah untuk membuat password baru. Link berlaku 1 jam.</p><p>Jika Anda tidak meminta reset, abaikan email ini.</p>`,
      { text: 'Buat Password Baru', url: `${base}/reset-password#${token}` });
  }
  // Same answer whether or not the email exists.
  return json({ ok: true });
});

route('POST', '/auth/reset', 'public', async ({ request, env }) => {
  const b = await readJson(request);
  const password = String(b.password || '');
  if (password.length < 8) fail(400, 'Password minimal 8 karakter');
  const th = await sha256(String(b.token || ''));
  const row = await env.DB.prepare('SELECT * FROM password_resets WHERE token_hash=? AND used=0 AND expires_at > ?').bind(th, now()).first();
  if (!row) fail(400, 'Link reset tidak valid atau sudah kedaluwarsa. Minta link baru.');
  const { hash, salt } = await hashPassword(password);
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET pass_hash=?, pass_salt=? WHERE id=?').bind(hash, salt, row.user_id),
    env.DB.prepare('UPDATE password_resets SET used=1 WHERE token_hash=?').bind(th),
    env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(row.user_id),
  ]);
  return json({ ok: true });
});

// =====================================================================
// MEMBER
// =====================================================================
route('GET', '/me', 'public', async ({ env, user }) => {
  if (!user) return json({ user: null });
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id=? AND is_read=0').bind(user.id).first();
  return json({ user, unread: n.n });
});

route('PUT', '/me', 'member', async ({ request, env, user }) => {
  const b = await readJson(request);
  const name = str(b.name, 80), phone = str(b.phone, 30), address = str(b.address, 300);
  if (name.length < 2) fail(400, 'Nama wajib diisi');
  if (!/^[0-9+\-\s]{8,20}$/.test(phone)) fail(400, 'Nomor WhatsApp tidak valid');
  if (address.length < 5) fail(400, 'Alamat wajib diisi');
  await env.DB.prepare('UPDATE users SET name=?, phone=?, address=? WHERE id=?').bind(name, phone, address, user.id).run();
  return json({ ok: true });
});

route('POST', '/me/password', 'member', async ({ request, env, user }) => {
  const b = await readJson(request);
  const u = await env.DB.prepare('SELECT pass_hash, pass_salt FROM users WHERE id=?').bind(user.id).first();
  if (!(await verifyPassword(String(b.old_password || ''), u.pass_hash, u.pass_salt))) fail(400, 'Password lama salah');
  if (String(b.new_password || '').length < 8) fail(400, 'Password baru minimal 8 karakter');
  const { hash, salt } = await hashPassword(String(b.new_password));
  await env.DB.prepare('UPDATE users SET pass_hash=?, pass_salt=? WHERE id=?').bind(hash, salt, user.id).run();
  return json({ ok: true });
});

route('GET', '/catalog', 'public', async ({ env }) => {
  const s = await getSettings(env);
  const { results } = await env.DB.prepare('SELECT id, code, name, kind, billing, includes_ea, includes_vps, requires_ib, managed_vps, price, description, features FROM products WHERE active=1 ORDER BY sort, id').all();
  return json({
    products: results, durations: s.durations, discounts: s.discounts, mt4_enabled: s.mt4_enabled === '1', vps_spec: s.vps_spec || '',
    min_capital_usd: Number(s.min_capital_usd || 100),
    profit_est: s.profit_est_enabled === '1' && Number(s.profit_est_min_idr) > 0 && Number(s.profit_est_max_idr) >= Number(s.profit_est_min_idr) && s.profit_est_basis
      ? { min: Number(s.profit_est_min_idr), max: Number(s.profit_est_max_idr), basis: s.profit_est_basis } : null,
    ib_brokers: s.ib_brokers.filter((b) => b.active && b.link), whatsapp: s.whatsapp || '',
  });
});

route('GET', '/rate', 'public', async ({ env, waitUntil }) => {
  const r = await getUsdIdr(env, waitUntil);
  const s = await getSettings(env);
  return new Response(JSON.stringify({ usd_idr: r.rate || 0, source: r.source, updated_at: now(), min_capital_usd: Number(s.min_capital_usd || 100) }), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=900' },
  });
});

// ======================= PROFIT REPORTS (from the EA) & PUBLIC BOARD =======================
route('POST', '/ea/report', 'public', async ({ request, env }) => {
  const b = await readJson(request);
  const id = int(b.lic);
  const l = id ? await env.DB.prepare('SELECT id, account_number, report_token, status FROM licenses WHERE id=?').bind(id).first() : null;
  if (!l || !l.report_token || String(b.token || '') !== l.report_token) fail(403, 'Token laporan tidak valid');
  if (String(b.login || '') !== String(l.account_number)) fail(403, 'Nomor akun tidak cocok dengan lisensi');
  const t = now();
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; };
  const last = await env.DB.prepare('SELECT updated_at FROM ea_stats WHERE license_id=?').bind(l.id).first();
  if (last && t - last.updated_at < 60) return json({ ok: true, throttled: true });
  const cur = str(b.currency, 8).toUpperCase();
  const wib = new Date((t + 7 * 3600) * 1000).toISOString().slice(0, 10);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO ea_stats (license_id, login, server, currency, balance, equity, profit_day, profit_week, profit_month, positions, ea_version, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(license_id) DO UPDATE SET login=excluded.login, server=excluded.server, currency=excluded.currency,
        balance=excluded.balance, equity=excluded.equity, profit_day=excluded.profit_day, profit_week=excluded.profit_week, profit_month=excluded.profit_month,
        positions=excluded.positions, ea_version=excluded.ea_version, updated_at=excluded.updated_at`)
      .bind(l.id, str(b.login, 20), str(b.server, 80), cur, num(b.balance), num(b.equity), num(b.day), num(b.week), num(b.month), int(b.positions) || 0, str(b.version, 20), t),
    env.DB.prepare(`INSERT INTO ea_stats_daily (license_id, day, profit, balance, currency) VALUES (?,?,?,?,?)
        ON CONFLICT(license_id, day) DO UPDATE SET profit=excluded.profit, balance=excluded.balance, currency=excluded.currency`)
      .bind(l.id, wib, num(b.day), num(b.balance), cur),
  ]);
  return json({ ok: true });
});

async function boardRows(env, rate, { includeHidden = false } = {}) {
  const s = await getSettings(env);
  const stale = now() - Number(s.board_stale_days || 3) * DAY;
  const { results } = await env.DB.prepare(`SELECT st.*, l.id AS lid, l.account_number, l.broker, l.platform, l.status, l.board_show, l.board_hide_name,
      u.name AS user_name, u.email AS user_email, p.name AS product_name
      FROM ea_stats st JOIN licenses l ON l.id=st.license_id JOIN users u ON u.id=l.user_id JOIN products p ON p.id=l.product_id
      ${includeHidden ? '' : `WHERE l.status='active' AND l.board_show=1 AND st.updated_at > ${stale}`}`).all();
  const mode = s.board_name_mode || 'first_initial';
  return results.map((r) => {
    const idr = (v) => { const x = toIdr(v, r.currency, rate); return x == null ? null : Math.round(x); };
    const pct = (p) => (r.balance - p) > 0 ? Math.round(p / (r.balance - p) * 10000) / 100 : null;
    const row = {
      name: boardName(r.user_name, mode, r.board_hide_name), account: maskAccount(r.account_number), broker: r.broker, platform: r.platform,
      day_idr: idr(r.profit_day), week_idr: idr(r.profit_week), month_idr: idr(r.profit_month), balance_idr: idr(r.balance),
      day_pct: pct(r.profit_day), week_pct: pct(r.profit_week), month_pct: pct(r.profit_month), updated_at: r.updated_at,
    };
    if (includeHidden) Object.assign(row, { license_id: r.lid, user_name: r.user_name, user_email: r.user_email, account_number: r.account_number,
      product_name: r.product_name, status: r.status, currency: r.currency, balance: r.balance, equity: r.equity, positions: r.positions,
      ea_version: r.ea_version, board_show: r.board_show, board_hide_name: r.board_hide_name, stale: r.updated_at <= stale });
    return row;
  }).filter((r) => includeHidden || r.month_idr != null);
}

route('GET', '/board', 'public', async ({ env, url, waitUntil }) => {
  const s = await getSettings(env);
  if (s.board_enabled !== '1') return json({ enabled: false, rows: [] });
  const period = ['day', 'week', 'month'].includes(url.searchParams.get('period')) ? url.searchParams.get('period') : 'month';
  const { rate, source } = await getUsdIdr(env, waitUntil);
  const rows = (await boardRows(env, rate)).sort((a, b) => (b[period + '_idr'] || 0) - (a[period + '_idr'] || 0));
  const limit = Math.min(int(url.searchParams.get('limit')) || 500, 500);
  return new Response(JSON.stringify({
    enabled: true, period, usd_idr: rate, rate_source: source, generated_at: now(), landing_top: Number(s.board_landing_top || 10),
    total_accounts: rows.length, total_idr: rows.reduce((a, r) => a + (r[period + '_idr'] || 0), 0), rows: rows.slice(0, limit),
  }), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=60' } });
});

route('GET', '/admin/board', 'admin', async ({ env, waitUntil }) => {
  const { rate } = await getUsdIdr(env, waitUntil);
  const rows = (await boardRows(env, rate, { includeHidden: true })).sort((a, b) => (b.month_idr || 0) - (a.month_idr || 0));
  return json({ usd_idr: rate, rows });
});
route('PUT', '/admin/licenses/:id/board', 'admin', async ({ request, env, params }) => {
  const b = await readJson(request);
  await env.DB.prepare('UPDATE licenses SET board_show=?, board_hide_name=? WHERE id=?').bind(b.board_show ? 1 : 0, b.board_hide_name ? 1 : 0, int(params.id)).run();
  return json({ ok: true });
});

route('GET', '/member/summary', 'member', async ({ env, user }) => {
  const q = (sql) => env.DB.prepare(sql).bind(user.id).first();
  const [lic, ord, soon] = await Promise.all([
    q(`SELECT COUNT(*) AS n FROM licenses WHERE user_id=? AND status='active'`),
    q(`SELECT COUNT(*) AS n FROM orders WHERE user_id=? AND status IN ('awaiting_payment','awaiting_verification','processing')`),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM licenses WHERE user_id=? AND status='active' AND expires_at IS NOT NULL AND expires_at < ?`).bind(user.id, now() + 7 * DAY).first(),
  ]);
  return json({ active_licenses: lic.n, open_orders: ord.n, expiring_soon: soon.n });
});

function parseAccount(b, product, settings) {
  const platform = b.platform === 'mt4' ? 'mt4' : 'mt5';
  if (platform === 'mt4' && settings.mt4_enabled !== '1') fail(400, 'MT4 belum tersedia, segera hadir. Silakan pilih MT5.');
  const account_number = str(b.account_number, 20);
  if (!/^\d{4,15}$/.test(account_number)) fail(400, 'Nomor akun trading harus angka (4-15 digit)');
  const broker = str(b.broker, 40);
  const broker_server = str(b.broker_server, 80);
  if (!broker) fail(400, 'Pilih broker');
  if (product.requires_ib) {
    const ok = settings.ib_brokers.some((x) => x.active && x.link && x.name === broker);
    if (!ok) fail(400, 'EA gratis hanya untuk akun broker yang terdaftar di bawah IB kami');
  }
  if (product.managed_vps) {
    if (!broker_server) fail(400, 'VPS share: server broker wajib diisi (contoh: Exness-MT5Real25)');
    if (!String(b.trading_password || '')) fail(400, 'VPS share: password trading wajib diisi agar admin bisa memasang akun Anda');
  }
  return { platform, account_number, broker, broker_server };
}

route('POST', '/orders', 'member', async ({ request, env, user, base }) => {
  const b = await readJson(request);
  const s = await getSettings(env);
  const p = await getProduct(env, int(b.product_id));
  if (!p || !p.active) fail(400, 'Produk tidak tersedia');
  const acc = parseAccount(b, p, s);
  if (p.kind === 'ea_ib') {
    const dup = await env.DB.prepare(`SELECT 1 FROM orders WHERE product_id=? AND account_number=? AND broker=? AND status IN ('awaiting_verification','processing','completed')`)
      .bind(p.id, acc.account_number, acc.broker).first();
    if (dup) fail(409, 'Akun ini sudah pernah diajukan untuk EA gratis');
  }
  if (p.requires_ib && p.includes_vps) {
    const dup = await env.DB.prepare(`SELECT 1 FROM orders WHERE product_id=? AND account_number=? AND kind='new' AND status IN ('awaiting_payment','awaiting_verification','processing')`)
      .bind(p.id, acc.account_number).first();
    if (dup) fail(409, 'Pesanan VPS untuk akun ini masih berjalan');
  }
  const id = await createOrder(env, base, user, {
    kind: 'new', product_id: p.id, months: int(b.months), ...acc,
    trading_pass_enc: p.managed_vps ? await encrypt(env, String(b.trading_password)) : null,
  });
  return json({ ok: true, id });
});

route('GET', '/orders', 'member', async ({ env, user }) => {
  const { results } = await env.DB.prepare(`SELECT o.id, o.code, o.kind, o.status, o.total, o.months, o.platform, o.account_number, o.broker, o.created_at, o.pay_deadline, o.license_id,
      p.name AS product_name, p.billing FROM orders o JOIN products p ON p.id=o.product_id WHERE o.user_id=? ORDER BY o.id DESC`).bind(user.id).all();
  return json({ orders: results.map((o) => ({ ...o, status_label: orderStatusLabel(o.status) })) });
});

route('GET', '/orders/:id', 'member', async ({ env, user, params }) => {
  const o = await env.DB.prepare(`SELECT o.*, p.name AS product_name, p.billing, p.includes_ea, p.includes_vps, p.requires_ib, p.managed_vps, p.kind AS product_kind
      FROM orders o JOIN products p ON p.id=o.product_id WHERE o.id=? AND o.user_id=?`).bind(int(params.id), user.id).first();
  if (!o) fail(404, 'Pesanan tidak ditemukan');
  delete o.trading_pass_enc;
  const s = await getSettings(env);
  return json({ order: { ...o, status_label: orderStatusLabel(o.status) }, bank_accounts: s.bank_accounts || '', whatsapp: s.whatsapp || '' });
});

route('POST', '/orders/:id/confirm', 'member', async ({ request, env, user, params, base }) => {
  const b = await readJson(request);
  const o = await env.DB.prepare('SELECT * FROM orders WHERE id=? AND user_id=?').bind(int(params.id), user.id).first();
  if (!o) fail(404, 'Pesanan tidak ditemukan');
  if (!['awaiting_payment', 'awaiting_verification'].includes(o.status)) fail(409, 'Pesanan ini tidak menunggu pembayaran');
  const payer_name = str(b.payer_name, 80), payer_bank = str(b.payer_bank, 60), note = str(b.note, 500);
  if (!payer_name || !payer_bank) fail(400, 'Isi nama pengirim dan bank/e-wallet asal');
  const proof = b.proof || {};
  if (!proof.data_b64) fail(400, 'Upload foto bukti transfer');
  if (!/^image\/(jpeg|png|webp)$|^application\/pdf$/.test(proof.mime || '')) fail(400, 'Bukti harus gambar JPG/PNG/WEBP atau PDF');
  const size = Math.floor(proof.data_b64.length * 3 / 4);
  if (size > 1_400_000) fail(400, 'File bukti terlalu besar (maks 1,4 MB)');
  const t = now();
  const s = await getSettings(env);
  const f = await env.DB.prepare(`INSERT INTO files (user_id, kind, name, mime, size, data_b64, created_at) VALUES (?, 'proof', ?, ?, ?, ?, ?)`)
    .bind(user.id, str(proof.name, 100) || 'bukti', proof.mime, size, proof.data_b64, t).run();
  if (o.proof_file_id) await env.DB.prepare('DELETE FROM files WHERE id=?').bind(o.proof_file_id).run();
  await env.DB.prepare(`UPDATE orders SET status='awaiting_verification', proof_file_id=?, payer_name=?, payer_bank=?, member_note=?, confirmed_at=?, admin_note='' WHERE id=?`)
    .bind(f.meta.last_row_id, payer_name, payer_bank, note, t, o.id).run();
  await notify(env, user.id, `Bukti transfer ${o.code} diterima`, 'Terima kasih! Admin segera mengecek pembayaran dan memproses pesanan Anda.', '#/pesanan/' + o.id);
  await emailUser(env, user, `Bukti transfer ${o.code} diterima, segera dicek admin`,
    `<p>Halo ${esc(user.name)},</p><p>Bukti transfer <b>${rupiah(o.total)}</b> untuk pesanan <b>${esc(o.code)}</b> sudah kami terima. Admin akan segera mengecek pembayaran dan memproses pesanan Anda.</p>`,
    { text: 'Lihat Pesanan', url: `${base}/member#/pesanan/${o.id}` });
  await emailAdmin(env, base, `Konfirmasi pembayaran ${o.code}`,
    `<p>${esc(user.name)} (${esc(user.email)}) mengonfirmasi transfer <b>${rupiah(o.total)}</b> (kode unik <b>${o.unique_code}</b>) dari ${esc(payer_bank)} a.n. ${esc(payer_name)} untuk akun ${esc(o.account_number)}. Cek mutasi, lalu klik <b>Sudah Bayar</b>.</p>`,
    '/admin#/pesanan/' + o.id);
  // Auto mode (off by default while payments are manual transfers; a payment gateway will call the same path).
  const p = await getProduct(env, o.product_id);
  if (s.auto_process_paid === '1' && !p.requires_ib) await processOrder(env, base, o.id, { paid: true });
  return json({ ok: true });
});

route('POST', '/orders/:id/months', 'member', async ({ request, env, user, params }) => {
  const b = await readJson(request);
  const o = await env.DB.prepare('SELECT * FROM orders WHERE id=? AND user_id=?').bind(int(params.id), user.id).first();
  if (!o) fail(404, 'Tagihan tidak ditemukan');
  await changeOrderMonths(env, o, int(b.months));
  return json({ ok: true });
});

route('POST', '/orders/:id/cancel', 'member', async ({ env, user, params }) => {
  const r = await env.DB.prepare(`UPDATE orders SET status='cancelled' WHERE id=? AND user_id=? AND status IN ('awaiting_payment','awaiting_verification') AND proof_file_id IS NULL`)
    .bind(int(params.id), user.id).run();
  if (!r.meta.changes) fail(409, 'Pesanan tidak bisa dibatalkan (pembayaran sudah dikonfirmasi atau sudah diproses)');
  return json({ ok: true });
});

async function licenseView(env, l, forAdmin) {
  const build = l.current_build_id
    ? await env.DB.prepare('SELECT id, status, file_id, ea_version, finished_at, expires_at, account_number FROM builds WHERE id=?').bind(l.current_build_id).first()
    : null;
  const pending = await env.DB.prepare(`SELECT id, status, created_at FROM builds WHERE license_id=? AND status IN ('queued','building') ORDER BY id DESC LIMIT 1`).bind(l.id).first();
  const out = {
    id: l.id, product_id: l.product_id, product_name: l.product_name, product_kind: l.product_kind, billing: l.billing,
    includes_ea: l.includes_ea, includes_vps: l.includes_vps, requires_ib: l.requires_ib, platform: l.platform, account_number: l.account_number,
    broker: l.broker, broker_server: l.broker_server, expires_at: l.expires_at, status: l.status,
    days_left: l.expires_at ? Math.ceil((l.expires_at - now()) / DAY) : null,
    managed_vps: l.managed_vps,
    // Shared VPS: the server login is the admin's, never shown to the member.
    vps_ip: l.managed_vps && !forAdmin ? '' : l.vps_ip, vps_user: l.managed_vps && !forAdmin ? '' : l.vps_user,
    vps_pass: l.managed_vps && !forAdmin ? '' : await decrypt(env, l.vps_pass_enc), vps_note: l.vps_note,
    build, build_pending: pending, created_at: l.created_at,
    report: await env.DB.prepare('SELECT currency, balance, equity, profit_day, profit_week, profit_month, positions, updated_at FROM ea_stats WHERE license_id=?').bind(l.id).first(),
  };
  if (forAdmin) { out.board_show = l.board_show; out.board_hide_name = l.board_hide_name; }
  if (forAdmin) {
    out.trading_pass = await decrypt(env, l.trading_pass_enc);
    out.user_id = l.user_id; out.user_name = l.user_name; out.user_email = l.user_email; out.user_phone = l.user_phone;
  }
  return out;
}
const LICENSE_SQL = `SELECT l.*, p.name AS product_name, p.kind AS product_kind, p.billing, p.includes_ea, p.includes_vps, p.requires_ib, p.managed_vps,
  u.name AS user_name, u.email AS user_email, u.phone AS user_phone
  FROM licenses l JOIN products p ON p.id=l.product_id JOIN users u ON u.id=l.user_id`;

route('GET', '/licenses', 'member', async ({ env, user }) => {
  const { results } = await env.DB.prepare(LICENSE_SQL + ' WHERE l.user_id=? ORDER BY l.id DESC').bind(user.id).all();
  const licenses = [];
  for (const l of results) licenses.push(await licenseView(env, l, false));
  const { results: changes } = await env.DB.prepare(`SELECT id, license_id, old_account, new_account, status, admin_note, created_at, decided_at
      FROM account_changes WHERE user_id=? ORDER BY id DESC`).bind(user.id).all();
  const { results: renewals } = await env.DB.prepare(`SELECT id, license_id, code, status, total, pay_deadline FROM orders WHERE user_id=? AND kind='renew'
      AND status IN ('awaiting_payment','awaiting_verification','processing')`).bind(user.id).all();
  return json({ licenses, changes, renewals });
});

route('POST', '/licenses/:id/renew', 'member', async ({ request, env, user, params, base }) => {
  const b = await readJson(request);
  const l = await env.DB.prepare(LICENSE_SQL + ' WHERE l.id=? AND l.user_id=?').bind(int(params.id), user.id).first();
  if (!l) fail(404, 'Lisensi tidak ditemukan');
  if (l.billing !== 'monthly') fail(400, 'Produk ini tidak perlu diperpanjang');
  if (!['active', 'expired'].includes(l.status)) fail(409, 'Lisensi belum aktif');
  const open = await env.DB.prepare(`SELECT * FROM orders WHERE license_id=? AND kind='renew' AND status IN ('awaiting_payment','awaiting_verification','processing')`).bind(l.id).first();
  if (open) {
    // An invoice already exists: use it (with the chosen duration) instead of creating a second one.
    if (open.status === 'awaiting_payment' && !open.proof_file_id && int(b.months) && int(b.months) !== open.months) await changeOrderMonths(env, open, int(b.months));
    return json({ ok: true, id: open.id, existing: true });
  }
  const id = await createOrder(env, base, user, {
    kind: 'renew', product_id: l.product_id, license_id: l.id, months: int(b.months), platform: l.platform,
    account_number: l.account_number, broker: l.broker, broker_server: l.broker_server, trading_pass_enc: l.trading_pass_enc,
  });
  return json({ ok: true, id });
});

route('POST', '/licenses/:id/change-account', 'member', async ({ request, env, user, params, base }) => {
  const b = await readJson(request);
  const l = await env.DB.prepare(LICENSE_SQL + ' WHERE l.id=? AND l.user_id=?').bind(int(params.id), user.id).first();
  if (!l) fail(404, 'Lisensi tidak ditemukan');
  if (l.status !== 'active') fail(409, 'Hanya lisensi aktif yang bisa diganti nomor akunnya');
  const pending = await env.DB.prepare(`SELECT 1 FROM account_changes WHERE license_id=? AND status='pending'`).bind(l.id).first();
  if (pending) fail(409, 'Masih ada pengajuan ganti akun yang menunggu admin');
  const new_account = str(b.new_account, 20);
  if (!/^\d{4,15}$/.test(new_account)) fail(400, 'Nomor akun baru harus angka (4-15 digit)');
  if (new_account === l.account_number) fail(400, 'Nomor akun baru sama dengan yang lama');
  const new_server = str(b.new_server, 80);
  if (l.managed_vps && (!new_server || !b.new_password)) fail(400, 'VPS share: isi server dan password trading akun baru');
  await env.DB.prepare(`INSERT INTO account_changes (license_id, user_id, old_account, new_account, new_server, new_pass_enc, reason, created_at)
      VALUES (?,?,?,?,?,?,?,?)`).bind(l.id, user.id, l.account_number, new_account, new_server,
    b.new_password ? await encrypt(env, String(b.new_password)) : null, str(b.reason, 500), now()).run();
  await notify(env, user.id, 'Pengajuan ganti nomor akun terkirim', `${l.account_number} → ${new_account}. Menunggu persetujuan admin.`, '#/lisensi');
  await emailAdmin(env, base, 'Pengajuan ganti nomor akun',
    `<p>${esc(user.name)} (${esc(user.email)}) minta ganti akun ${esc(l.account_number)} → <b>${esc(new_account)}</b> (${esc(l.product_name)}).</p><p>Alasan: ${esc(str(b.reason, 500)) || '-'}</p>`,
    '/admin#/ganti-akun');
  return json({ ok: true });
});

route('GET', '/files/:id', 'member', async ({ env, user, params }) => {
  const f = await env.DB.prepare('SELECT * FROM files WHERE id=?').bind(int(params.id)).first();
  if (!f) fail(404, 'File tidak ditemukan');
  if (user.role !== 'admin') {
    if (f.kind === 'proof' && f.user_id !== user.id) fail(403, 'Tidak diizinkan');
    if (f.kind === 'ea') {
      const ok = await env.DB.prepare(`SELECT 1 FROM builds b JOIN licenses l ON l.id=b.license_id
          WHERE b.file_id=? AND l.user_id=? AND l.status='active' AND l.current_build_id=b.id`).bind(f.id, user.id).first();
      if (!ok) fail(403, 'File EA hanya bisa diunduh saat lisensi aktif');
    }
  }
  return new Response(unb64(f.data_b64), {
    headers: {
      'content-type': f.mime,
      'content-disposition': `${f.kind === 'ea' ? 'attachment' : 'inline'}; filename="${f.name.replace(/[^\w.\-]/g, '_')}"`,
      'cache-control': 'private, no-store',
    },
  });
});

route('GET', '/notifications', 'member', async ({ env, user }) => {
  const { results } = await env.DB.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 100').bind(user.id).all();
  return json({ notifications: results });
});
route('POST', '/notifications/read-all', 'member', async ({ env, user }) => {
  await env.DB.prepare('UPDATE notifications SET is_read=1 WHERE user_id=?').bind(user.id).run();
  return json({ ok: true });
});

// =====================================================================
// ADMIN
// =====================================================================
route('GET', '/admin/stats', 'admin', async ({ env }) => {
  const t = now();
  const one = (sql, ...a) => env.DB.prepare(sql).bind(...a).first();
  const [pay, ver, proc, act, soon, chg, members, queued, failed, revenue] = await Promise.all([
    one(`SELECT COUNT(*) n FROM orders o JOIN products p ON p.id=o.product_id WHERE p.requires_ib=0 AND o.status='awaiting_payment'`),
    one(`SELECT COUNT(*) n FROM orders o JOIN products p ON p.id=o.product_id WHERE p.requires_ib=0 AND o.status='awaiting_verification'`),
    one(`SELECT COUNT(*) n FROM orders o JOIN products p ON p.id=o.product_id WHERE p.requires_ib=0 AND o.status='processing'`),
    one(`SELECT COUNT(*) n FROM licenses WHERE status='active'`),
    one(`SELECT COUNT(*) n FROM licenses WHERE status='active' AND expires_at IS NOT NULL AND expires_at < ?`, t + 7 * DAY),
    one(`SELECT COUNT(*) n FROM account_changes WHERE status='pending'`),
    one(`SELECT COUNT(*) n FROM users WHERE role='member'`),
    one(`SELECT COUNT(*) n FROM builds WHERE status IN ('queued','building')`),
    one(`SELECT COUNT(*) n FROM builds WHERE status='failed' AND created_at > ?`, t - 7 * DAY),
    one(`SELECT COALESCE(SUM(total),0) n FROM orders WHERE status IN ('processing','completed') AND processed_at > ?`, t - 30 * DAY),
  ]);
  const ib = await one(`SELECT COUNT(*) n FROM orders o JOIN products p ON p.id=o.product_id WHERE p.requires_ib=1 AND o.status IN ('awaiting_payment','awaiting_verification','processing')`);
  const ibUnchecked = await one(`SELECT COUNT(*) n FROM orders o JOIN products p ON p.id=o.product_id WHERE p.requires_ib=1 AND o.ib_status='' AND o.status IN ('awaiting_payment','awaiting_verification')`);
  const s = await getSettings(env);
  let builder = null, daily = null;
  try { builder = JSON.parse(s.builder_seen || 'null'); } catch {}
  try { daily = JSON.parse(s.daily_last_run || 'null'); } catch {}
  return json({
    awaiting_payment: pay.n, awaiting_verification: ver.n, processing: proc.n, active_licenses: act.n, expiring_7d: soon.n,
    ib_open: ib.n, ib_unchecked: ibUnchecked.n, pending_changes: chg.n, members: members.n, builds_pending: queued.n, builds_failed_7d: failed.n, revenue_30d: revenue.n,
    builder, daily, now: t, auto_rebuild: s.auto_rebuild_on_version !== '0',
    version_event: (() => { try { return JSON.parse(s.ea_version_event || 'null'); } catch { return null; } })(),
  });
});

route('GET', '/admin/orders', 'admin', async ({ env, url }) => {
  const status = url.searchParams.get('status') || '';
  const group = url.searchParams.get('group') || '';
  const q = str(url.searchParams.get('q'), 60);
  let sql = `SELECT o.id, o.code, o.kind, o.status, o.total, o.months, o.platform, o.account_number, o.broker, o.broker_server, o.created_at,
      o.confirmed_at, o.ib_status, o.proof_file_id, p.name AS product_name, p.billing, p.requires_ib, p.includes_vps,
      u.name AS user_name, u.email AS user_email, u.phone AS user_phone
      FROM orders o JOIN products p ON p.id=o.product_id JOIN users u ON u.id=o.user_id WHERE 1=1`;
  const args = [];
  if (group === 'ib') sql += ' AND p.requires_ib=1';
  if (group === 'paid') sql += ' AND p.requires_ib=0';
  if (status === 'open') sql += ` AND o.status IN ('awaiting_payment','awaiting_verification','processing')`;
  else if (status) { sql += ' AND o.status=?'; args.push(status); }
  if (q) { sql += ' AND (o.code LIKE ? OR o.account_number LIKE ? OR u.email LIKE ? OR u.name LIKE ?)'; args.push(...Array(4).fill(`%${q}%`)); }
  sql += ' ORDER BY o.id DESC LIMIT 300';
  const { results } = await env.DB.prepare(sql).bind(...args).all();
  return json({ orders: results.map((o) => ({ ...o, status_label: orderStatusLabel(o.status) })) });
});

route('GET', '/admin/orders/:id', 'admin', async ({ env, params }) => {
  const o = await env.DB.prepare(`SELECT o.*, p.name AS product_name, p.billing, p.includes_ea, p.includes_vps, p.requires_ib, p.managed_vps, p.kind AS product_kind,
      u.name AS user_name, u.email AS user_email, u.phone AS user_phone, u.address AS user_address
      FROM orders o JOIN products p ON p.id=o.product_id JOIN users u ON u.id=o.user_id WHERE o.id=?`).bind(int(params.id)).first();
  if (!o) fail(404, 'Order tidak ditemukan');
  o.trading_pass = await decrypt(env, o.trading_pass_enc);
  delete o.trading_pass_enc;
  const proof = o.proof_file_id ? await env.DB.prepare('SELECT id, name, mime, size FROM files WHERE id=?').bind(o.proof_file_id).first() : null;
  let license = null, builds = [];
  if (o.license_id) {
    const l = await env.DB.prepare(LICENSE_SQL + ' WHERE l.id=?').bind(o.license_id).first();
    if (l) license = await licenseView(env, l, true);
    builds = (await env.DB.prepare('SELECT id, status, file_id, ea_version, reason, created_at, finished_at, account_number, expires_at FROM builds WHERE license_id=? ORDER BY id DESC LIMIT 10').bind(o.license_id).all()).results;
  }
  return json({ order: { ...o, status_label: orderStatusLabel(o.status) }, proof, license, builds });
});

// IB check for free-EA orders: admin looks the account up in the broker partner portal.
route('POST', '/admin/orders/:id/ib', 'admin', async ({ request, env, params, base }) => {
  const b = await readJson(request);
  const o = await env.DB.prepare(`SELECT o.*, p.requires_ib FROM orders o JOIN products p ON p.id=o.product_id WHERE o.id=?`).bind(int(params.id)).first();
  if (!o || !o.requires_ib) fail(404, 'Order IB tidak ditemukan');
  if (!['awaiting_payment', 'awaiting_verification'].includes(o.status)) fail(409, 'Order ini sudah diproses');
  const t = now();
  const user = await getUser(env, o.user_id);
  if (b.verified) {
    await env.DB.prepare(`UPDATE orders SET ib_status='yes', ib_checked_at=? WHERE id=?`).bind(t, o.id).run();
    await notify(env, o.user_id, `Akun ${o.account_number} terverifikasi di bawah IB kami`, 'Pesanan Anda segera diproses.', '#/pesanan/' + o.id);
    return json({ ok: true });
  }
  const note = str(b.note, 500) || `Akun ${o.account_number} belum terdaftar di bawah IB kami.`;
  await env.DB.prepare(`UPDATE orders SET ib_status='no', ib_checked_at=?, status='rejected', admin_note=? WHERE id=?`).bind(t, note, o.id).run();
  await notify(env, o.user_id, `Akun ${o.account_number} belum di bawah IB kami`, note + ' Lihat menu "Syarat EA Gratis" (daftar akun baru / pindah partner), lalu ajukan lagi.', '#/ib');
  await emailUser(env, user, `Akun ${o.account_number} belum terdaftar di bawah IB kami`,
    `<p>Halo ${esc(user.name)},</p><p>${esc(note)}</p><p>Untuk mendapatkan EA gratis, akun trading Anda harus terdaftar di bawah partner GoldHunter Garuda: daftar akun baru lewat link kami, atau ajukan pindah partner lalu buat akun trading baru. Panduan lengkap ada di menu <b>Syarat EA Gratis</b> di member area. Setelah itu ajukan lagi dengan nomor akun yang baru.</p>`
    + (o.proof_file_id ? '<p>Untuk pembayaran yang sudah Anda transfer, admin akan menghubungi Anda.</p>' : ''),
    { text: 'Lihat Panduan', url: `${base}/member#/ib` });
  return json({ ok: true });
});

// Admin checked the bank statement: payment is in -> process right away (EA build starts).
route('POST', '/admin/orders/:id/paid', 'admin', async ({ env, params, base }) => {
  const o = await env.DB.prepare('SELECT o.*, p.billing FROM orders o JOIN products p ON p.id=o.product_id WHERE o.id=?').bind(int(params.id)).first();
  if (!o) fail(404, 'Order tidak ditemukan');
  if (o.billing === 'free') fail(400, 'Order gratis tidak perlu pembayaran');
  const licenseId = await processOrder(env, base, o.id, { paid: true });
  return json({ ok: true, license_id: licenseId });
});

// Proof cannot be accepted (wrong amount, unreadable...): member uploads a new one.
route('POST', '/admin/orders/:id/proof-reject', 'admin', async ({ request, env, params, base }) => {
  const b = await readJson(request);
  const note = str(b.note, 500);
  if (!note) fail(400, 'Tulis alasan agar member tahu apa yang harus diperbaiki');
  const o = await env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(int(params.id)).first();
  if (!o || o.status !== 'awaiting_verification') fail(409, 'Order ini tidak sedang menunggu cek pembayaran');
  const s = await getSettings(env);
  const deadline = now() + Number(s.pay_deadline_hours || 24) * 3600;
  await env.DB.prepare(`UPDATE orders SET status='awaiting_payment', admin_note=?, proof_file_id=NULL, pay_deadline=MAX(pay_deadline, ?) WHERE id=?`)
    .bind(note, deadline, o.id).run();
  if (o.proof_file_id) await env.DB.prepare('DELETE FROM files WHERE id=?').bind(o.proof_file_id).run();
  const user = await getUser(env, o.user_id);
  await notify(env, o.user_id, `Bukti transfer ${o.code} perlu dikirim ulang`, note, '#/bayar/' + o.id);
  await emailUser(env, user, `Bukti transfer ${o.code} perlu dikirim ulang`,
    `<p>Halo ${esc(user.name)},</p><p>Bukti transfer untuk pesanan <b>${esc(o.code)}</b> belum bisa kami terima.</p><p>Alasan: <b>${esc(note)}</b></p><p>Silakan kirim ulang bukti transfer yang benar (total <b>${rupiah(o.total)}</b>, termasuk kode unik ${o.unique_code}).</p>`,
    { text: 'Kirim Ulang Bukti', url: `${base}/member#/bayar/${o.id}` });
  return json({ ok: true });
});

route('POST', '/admin/orders/:id/process', 'admin', async ({ env, params, base }) => {
  const licenseId = await processOrder(env, base, int(params.id));
  return json({ ok: true, license_id: licenseId });
});
route('POST', '/admin/orders/:id/complete', 'admin', async ({ request, env, params, base }) => {
  const b = await readJson(request);
  await completeOrder(env, base, int(params.id), str(b.admin_note, 1000));
  return json({ ok: true });
});
route('POST', '/admin/orders/:id/reject', 'admin', async ({ request, env, params, base }) => {
  const b = await readJson(request);
  const reason = str(b.reason, 500);
  if (!reason) fail(400, 'Tulis alasan penolakan');
  const o = await env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(int(params.id)).first();
  if (!o) fail(404, 'Order tidak ditemukan');
  if (!['awaiting_payment', 'awaiting_verification'].includes(o.status)) fail(409, 'Hanya order yang belum diproses yang bisa ditolak');
  await env.DB.prepare(`UPDATE orders SET status='rejected', admin_note=? WHERE id=?`).bind(reason, o.id).run();
  const user = await getUser(env, o.user_id);
  await notify(env, o.user_id, `Pesanan ${o.code} ditolak`, reason, '#/pesanan/' + o.id);
  await emailUser(env, user, `Pesanan ${o.code} ditolak`, `<p>Halo ${esc(user.name)},</p><p>Mohon maaf, pesanan <b>${esc(o.code)}</b> ditolak oleh admin.</p><p>Alasan: ${esc(reason)}</p>`,
    { text: 'Lihat Pesanan', url: `${base}/member#/pesanan/${o.id}` });
  return json({ ok: true });
});

route('GET', '/admin/licenses', 'admin', async ({ env, url }) => {
  const q = str(url.searchParams.get('q'), 60);
  const status = url.searchParams.get('status') || '';
  let sql = LICENSE_SQL + ' WHERE 1=1';
  const args = [];
  if (status) { sql += ' AND l.status=?'; args.push(status); }
  if (q) { sql += ' AND (l.account_number LIKE ? OR u.email LIKE ? OR u.name LIKE ? OR l.vps_ip LIKE ?)'; args.push(...Array(4).fill(`%${q}%`)); }
  sql += ' ORDER BY (l.expires_at IS NULL), l.expires_at, l.id DESC LIMIT 500';
  const { results } = await env.DB.prepare(sql).bind(...args).all();
  const t = now();
  return json({
    licenses: results.map((l) => ({
      id: l.id, user_name: l.user_name, user_email: l.user_email, product_name: l.product_name, includes_vps: l.includes_vps,
      platform: l.platform, account_number: l.account_number, broker: l.broker, status: l.status, expires_at: l.expires_at,
      days_left: l.expires_at ? Math.ceil((l.expires_at - t) / DAY) : null, vps_ip: l.vps_ip, current_build_id: l.current_build_id,
    })),
  });
});

route('GET', '/admin/licenses/:id', 'admin', async ({ env, params }) => {
  const l = await env.DB.prepare(LICENSE_SQL + ' WHERE l.id=?').bind(int(params.id)).first();
  if (!l) fail(404, 'Lisensi tidak ditemukan');
  const [builds, changes, orders] = await Promise.all([
    env.DB.prepare('SELECT id, status, file_id, ea_version, reason, log, created_at, finished_at, account_number, expires_at FROM builds WHERE license_id=? ORDER BY id DESC LIMIT 20').bind(l.id).all(),
    env.DB.prepare('SELECT * FROM account_changes WHERE license_id=? ORDER BY id DESC').bind(l.id).all(),
    env.DB.prepare('SELECT id, code, kind, status, total, months, created_at FROM orders WHERE license_id=? ORDER BY id DESC').bind(l.id).all(),
  ]);
  return json({ license: await licenseView(env, l, true), builds: builds.results, changes: changes.results.map((c) => ({ ...c, new_pass_enc: undefined })), orders: orders.results });
});

route('PUT', '/admin/licenses/:id', 'admin', async ({ request, env, params, base }) => {
  const b = await readJson(request);
  const l = await env.DB.prepare(LICENSE_SQL + ' WHERE l.id=?').bind(int(params.id)).first();
  if (!l) fail(404, 'Lisensi tidak ditemukan');
  const t = now();
  const vps_ip = str(b.vps_ip, 60), vps_user = str(b.vps_user, 60), vps_note = str(b.vps_note, 1000);
  const vps_pass_enc = b.vps_pass ? await encrypt(env, String(b.vps_pass)) : (b.vps_pass === '' ? null : l.vps_pass_enc);
  const status = ['processing', 'active', 'expired', 'suspended'].includes(b.status) ? b.status : l.status;
  let expires_at = l.expires_at;
  if (b.expires_at !== undefined) expires_at = b.expires_at ? int(b.expires_at) : null;
  const account_number = b.account_number ? str(b.account_number, 20) : l.account_number;
  if (!/^\d{4,15}$/.test(account_number)) fail(400, 'Nomor akun harus angka');
  const broker_server = b.broker_server !== undefined ? str(b.broker_server, 80) : l.broker_server;
  await env.DB.prepare(`UPDATE licenses SET vps_ip=?, vps_user=?, vps_pass_enc=?, vps_note=?, status=?, expires_at=?, account_number=?, broker_server=?,
      reminder_exp=CASE WHEN ? IS NOT expires_at THEN NULL ELSE reminder_exp END, updated_at=? WHERE id=?`)
    .bind(vps_ip, vps_user, vps_pass_enc, vps_note, status, expires_at, account_number, broker_server, expires_at, t, l.id).run();
  const vpsChanged = vps_ip !== l.vps_ip || vps_user !== l.vps_user || (b.vps_pass && b.vps_pass !== '');
  if (vpsChanged && l.includes_vps && vps_ip) {
    await notify(env, l.user_id, `Detail VPS akun ${account_number} diperbarui`, 'Lihat di menu Lisensi & VPS.', '#/lisensi');
  }
  // EA licence data changed -> new file needed
  let rebuilt = false;
  if (l.includes_ea && (account_number !== l.account_number || expires_at !== l.expires_at)) {
    await queueBuild(env, l.id, 'Diubah admin');
    rebuilt = true;
  }
  return json({ ok: true, rebuilt });
});

// Manual EA file (e.g. an .ex4 for MT4 until the builder has an MQL4 source)
route('POST', '/admin/licenses/:id/upload', 'admin', async ({ request, env, params, base }) => {
  const b = await readJson(request);
  const l = await env.DB.prepare('SELECT * FROM licenses WHERE id=?').bind(int(params.id)).first();
  if (!l) fail(404, 'Lisensi tidak ditemukan');
  const filename = str(b.filename, 120);
  if (!/\.(ex4|ex5)$/i.test(filename)) fail(400, 'File harus .ex4 atau .ex5');
  if (!b.data_b64 || b.data_b64.length * 3 / 4 > 1_400_000) fail(400, 'File kosong atau terlalu besar (maks 1,4 MB)');
  const r = await env.DB.prepare(`INSERT INTO builds (license_id, platform, account_number, expires_at, status, reason, created_at, started_at)
      VALUES (?,?,?,?, 'building', 'Upload manual admin', ?, ?)`).bind(l.id, l.platform, l.account_number, l.expires_at, now(), now()).run();
  await finishBuild(env, base, { id: r.meta.last_row_id, ok: true, log: 'Upload manual oleh admin', filename, data_b64: b.data_b64, ea_version: str(b.ea_version, 20) });
  return json({ ok: true });
});

route('POST', '/admin/licenses/:id/build', 'admin', async ({ env, params }) => {
  const id = await queueBuild(env, int(params.id), 'Generate ulang oleh admin');
  return json({ ok: true, build_id: id });
});

route('GET', '/admin/changes', 'admin', async ({ env, url }) => {
  const status = url.searchParams.get('status') || 'pending';
  const { results } = await env.DB.prepare(`SELECT c.id, c.license_id, c.old_account, c.new_account, c.new_server, c.reason, c.status, c.admin_note, c.created_at, c.decided_at,
      u.name AS user_name, u.email AS user_email, p.name AS product_name, p.includes_vps
      FROM account_changes c JOIN users u ON u.id=c.user_id JOIN licenses l ON l.id=c.license_id JOIN products p ON p.id=l.product_id
      WHERE (?='' OR c.status=?) ORDER BY c.id DESC LIMIT 200`).bind(status === 'all' ? '' : status, status).all();
  return json({ changes: results });
});

route('POST', '/admin/changes/:id/approve', 'admin', async ({ request, env, params, base }) => {
  const b = await readJson(request);
  const c = await env.DB.prepare('SELECT * FROM account_changes WHERE id=?').bind(int(params.id)).first();
  if (!c || c.status !== 'pending') fail(409, 'Pengajuan tidak ditemukan / sudah diputuskan');
  const l = await env.DB.prepare(LICENSE_SQL + ' WHERE l.id=?').bind(c.license_id).first();
  const t = now();
  await env.DB.batch([
    env.DB.prepare(`UPDATE licenses SET account_number=?, broker_server=CASE WHEN ?<>'' THEN ? ELSE broker_server END,
        trading_pass_enc=COALESCE(?, trading_pass_enc), updated_at=? WHERE id=?`)
      .bind(c.new_account, c.new_server, c.new_server, c.new_pass_enc, t, c.license_id),
    env.DB.prepare(`UPDATE account_changes SET status='approved', admin_note=?, decided_at=? WHERE id=?`).bind(str(b.note, 500), t, c.id),
  ]);
  if (l.includes_ea) await queueBuild(env, c.license_id, `Ganti akun ${c.old_account} → ${c.new_account}`);
  const user = await getUser(env, c.user_id);
  await notify(env, c.user_id, 'Ganti nomor akun disetujui', `${c.old_account} → ${c.new_account}. File EA baru sedang dibuat.`, '#/lisensi');
  await emailUser(env, user, 'Ganti nomor akun disetujui',
    `<p>Halo ${esc(user.name)},</p><p>Pengajuan ganti nomor akun <b>${esc(c.old_account)}</b> → <b>${esc(c.new_account)}</b> disetujui. ${l.includes_ea ? 'File EA baru sedang dibuat; Anda akan menerima email lagi saat siap diunduh.' : ''}</p>`,
    { text: 'Buka Member Area', url: `${base}/member#/lisensi` });
  return json({ ok: true });
});

route('POST', '/admin/changes/:id/reject', 'admin', async ({ request, env, params, base }) => {
  const b = await readJson(request);
  const note = str(b.note, 500);
  if (!note) fail(400, 'Tulis alasan penolakan');
  const c = await env.DB.prepare('SELECT * FROM account_changes WHERE id=?').bind(int(params.id)).first();
  if (!c || c.status !== 'pending') fail(409, 'Pengajuan tidak ditemukan / sudah diputuskan');
  await env.DB.prepare(`UPDATE account_changes SET status='rejected', admin_note=?, decided_at=? WHERE id=?`).bind(note, now(), c.id).run();
  const user = await getUser(env, c.user_id);
  await notify(env, c.user_id, 'Ganti nomor akun ditolak', note, '#/lisensi');
  await emailUser(env, user, 'Ganti nomor akun ditolak', `<p>Halo ${esc(user.name)},</p><p>Pengajuan ganti akun ${esc(c.old_account)} → ${esc(c.new_account)} ditolak.</p><p>Alasan: ${esc(note)}</p>`,
    { text: 'Buka Member Area', url: `${base}/member#/lisensi` });
  return json({ ok: true });
});

route('GET', '/admin/users', 'admin', async ({ env, url }) => {
  const q = str(url.searchParams.get('q'), 60);
  const { results } = await env.DB.prepare(`SELECT u.id, u.email, u.name, u.phone, u.address, u.role, u.status, u.created_at, u.last_login_at,
      (SELECT COUNT(*) FROM licenses l WHERE l.user_id=u.id AND l.status='active') AS active_licenses,
      (SELECT COUNT(*) FROM orders o WHERE o.user_id=u.id) AS orders
      FROM users u WHERE (?='' OR u.email LIKE ? OR u.name LIKE ? OR u.phone LIKE ?) ORDER BY u.id DESC LIMIT 500`)
    .bind(q, `%${q}%`, `%${q}%`, `%${q}%`).all();
  return json({ users: results });
});
route('PUT', '/admin/users/:id', 'admin', async ({ request, env, params, user }) => {
  const b = await readJson(request);
  const id = int(params.id);
  if (id === user.id) fail(400, 'Tidak bisa mengubah akun Anda sendiri di sini');
  const role = b.role === 'admin' ? 'admin' : 'member';
  const status = b.status === 'blocked' ? 'blocked' : 'active';
  await env.DB.prepare('UPDATE users SET role=?, status=? WHERE id=?').bind(role, status, id).run();
  if (status === 'blocked') await env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(id).run();
  return json({ ok: true });
});

route('GET', '/admin/products', 'admin', async ({ env }) => {
  const { results } = await env.DB.prepare('SELECT * FROM products ORDER BY sort, id').all();
  return json({ products: results });
});
function productFields(b) {
  const kind = ['ea_ib', 'ib_vps', 'ib_vps_shared', 'ea_lifetime', 'ea_rent', 'vps_ea', 'vps_ea_shared', 'vps', 'vps_shared'].includes(b.kind) ? b.kind : fail(400, 'Jenis produk tidak valid');
  const billing = { ea_ib: 'free', ea_lifetime: 'lifetime' }[kind] || 'monthly';
  const price = int(b.price);
  if (billing !== 'free' && !(price > 0)) fail(400, 'Harga harus lebih dari 0');
  return [str(b.name, 80) || fail(400, 'Nama produk wajib'), kind, billing, ['vps', 'vps_shared'].includes(kind) ? 0 : 1, ['vps_ea', 'vps', 'vps_shared', 'ib_vps', 'ib_vps_shared', 'vps_ea_shared'].includes(kind) ? 1 : 0,
    ['ea_ib', 'ib_vps', 'ib_vps_shared'].includes(kind) ? 1 : 0, kind.endsWith('_shared') ? 1 : 0, billing === 'free' ? 0 : price, str(b.description, 600), str(b.features, 1500), b.active ? 1 : 0, int(b.sort) || 0];
}
route('POST', '/admin/products', 'admin', async ({ request, env }) => {
  const b = await readJson(request);
  const f = productFields(b);
  await env.DB.prepare(`INSERT INTO products (code, name, kind, billing, includes_ea, includes_vps, requires_ib, managed_vps, price, description, features, active, sort)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(`${f[1]}_${randomToken(4).toLowerCase()}`, ...f).run();
  return json({ ok: true });
});
route('PUT', '/admin/products/:id', 'admin', async ({ request, env, params }) => {
  const b = await readJson(request);
  const f = productFields(b);
  await env.DB.prepare(`UPDATE products SET name=?, kind=?, billing=?, includes_ea=?, includes_vps=?, requires_ib=?, managed_vps=?, price=?, description=?, features=?, active=?, sort=? WHERE id=?`)
    .bind(...f, int(params.id)).run();
  return json({ ok: true });
});

const EDITABLE_SETTINGS = ['durations', 'discounts', 'bank_accounts', 'admin_notify_email', 'whatsapp', 'pay_deadline_hours', 'reminder_days', 'mt4_enabled',
  'ib_brokers', 'auto_complete_ea', 'auto_process_paid', 'welcome_email_password', 'email_provider', 'email_from', 'email_from_name', 'vps_spec',
  'min_capital_usd', 'invoice_days_before', 'auto_rebuild_on_version', 'board_enabled', 'board_name_mode', 'board_landing_top', 'board_stale_days', 'profit_est_enabled', 'profit_est_min_idr', 'profit_est_max_idr', 'profit_est_basis'];
route('GET', '/admin/settings', 'admin', async ({ env }) => {
  const s = await getSettings(env);
  const out = Object.fromEntries(EDITABLE_SETTINGS.map((k) => [k, s[k] ?? '']));
  out.email_api_key_set = !!s.email_api_key_enc;
  out._env = { email_provider: env.EMAIL_PROVIDER || 'log', email_from: env.EMAIL_FROM || '', site_url: env.SITE_URL || '',
    builder_token_set: !!env.BUILDER_TOKEN, cron_secret_set: !!env.CRON_SECRET, data_key_set: !!env.DATA_KEY };
  return json(out);
});
route('PUT', '/admin/settings', 'admin', async ({ request, env }) => {
  const b = await readJson(request);
  for (const k of EDITABLE_SETTINGS) {
    if (b[k] === undefined) continue;
    let v = b[k];
    if (k === 'durations') { v = [...new Set(v.map(Number).filter((n) => n >= 1 && n <= 36))].sort((a, c) => a - c); if (!v.length) fail(400, 'Minimal 1 durasi'); }
    if (k === 'reminder_days') v = [...new Set(v.map(Number).filter((n) => n >= 1 && n <= 60))].sort((a, c) => c - a);
    if (k === 'discounts') v = Object.fromEntries(Object.entries(v).map(([m, d]) => [String(int(m)), Math.max(0, Math.min(90, Number(d) || 0))]).filter(([m, d]) => m !== 'null' && d > 0));
    if (k === 'ib_brokers') v = v.map((x) => ({ name: str(x.name, 40), link: str(x.link, 300), active: !!x.active })).filter((x) => x.name);
    if (k === 'email_provider' && !['', 'log', 'resend', 'brevo'].includes(v)) fail(400, 'Penyedia email tidak dikenal');
    if (k === 'email_from' && v && !isEmail(str(v, 120))) fail(400, 'Alamat pengirim email tidak valid');
    await putSetting(env, k, typeof v === 'string' ? v.trim() : v);
  }
  if (typeof b.email_api_key === 'string' && b.email_api_key.trim()) await putSetting(env, 'email_api_key_enc', await encrypt(env, b.email_api_key.trim()));
  if (b.email_api_key_clear) await env.DB.prepare(`DELETE FROM settings WHERE key='email_api_key_enc'`).run();
  return json({ ok: true });
});

route('POST', '/admin/email-test', 'admin', async ({ request, env, base, user }) => {
  const b = await readJson(request);
  const to = str(b.to, 120) || user.email;
  if (!isEmail(to)) fail(400, 'Email tujuan tidak valid');
  const r = await sendEmail(env, to, 'Tes email GoldHunter Garuda', layout(env, 'Tes email berhasil ✔',
    `<p>Halo ${esc(user.name)},</p><p>Jika Anda membaca email ini, pengaturan email web GoldHunter Garuda sudah benar. Email ke member (pendaftaran, reset password, pesanan, pengingat sewa) akan terkirim lewat jalur ini.</p>`,
    { text: 'Buka Admin', url: `${base}/admin` }));
  return json(r);
});

route('GET', '/admin/emails', 'admin', async ({ env }) => {
  const { results } = await env.DB.prepare('SELECT id, to_addr, subject, status, error, created_at FROM emails ORDER BY id DESC LIMIT 200').all();
  return json({ emails: results });
});
route('GET', '/admin/emails/:id', 'admin', async ({ env, params }) => {
  const e = await env.DB.prepare('SELECT body_html FROM emails WHERE id=?').bind(int(params.id)).first();
  if (!e) fail(404, 'Email tidak ditemukan');
  return new Response(e.body_html, { headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "script-src 'none'" } });
});

route('GET', '/admin/builds', 'admin', async ({ env }) => {
  const { results } = await env.DB.prepare(`SELECT b.id, b.license_id, b.platform, b.account_number, b.expires_at, b.status, b.ea_version, b.reason, b.created_at, b.finished_at, b.file_id,
      u.name AS user_name FROM builds b JOIN licenses l ON l.id=b.license_id JOIN users u ON u.id=l.user_id ORDER BY b.id DESC LIMIT 100`).all();
  return json({ builds: results });
});

route('POST', '/admin/rebuild-all', 'admin', async ({ env }) => {
  const n = await rebuildAll(env, '', 'Generate ulang semua oleh admin');
  return json({ ok: true, queued: n });
});

route('POST', '/admin/run-daily', 'admin', async ({ env, base }) => json({ ok: true, result: await runDaily(env, base) }));

// =====================================================================
// BUILDER (Windows PC with MetaEditor) and CRON
// =====================================================================
route('POST', '/builder/claim', 'builder', async ({ request, env, base, waitUntil }) => {
  const b = await readJson(request);
  // The builder polls every few seconds, so it also drives the daily job (reminders, expiries)
  // in case the GitHub Action cron is not configured.
  const s = await getSettings(env);
  let last = 0;
  try { last = JSON.parse(s.daily_last_run || '{}').at || 0; } catch {}
  if (now() - last > 20 * 3600) {
    await putSetting(env, 'daily_last_run', JSON.stringify({ at: now(), running: true }));
    waitUntil(runDaily(env, base).catch((e) => console.error('daily', e)));
  }
  return json({ job: await claimBuild(env, str(b.builder_id, 60) || 'builder', b.versions && typeof b.versions === 'object' ? b.versions : {}) });
});
route('POST', '/builder/result', 'builder', async ({ request, env, base }) => {
  const b = await readJson(request);
  return json(await finishBuild(env, base, {
    id: int(b.id), ok: !!b.ok, log: String(b.log || ''), filename: str(b.filename, 120) || 'GoldHunter_Garuda.ex5',
    data_b64: b.data_b64 || '', ea_version: str(b.ea_version, 20),
  }));
});
route('POST', '/cron/daily', 'cron', async ({ env, base }) => json({ ok: true, result: await runDaily(env, base) }));
