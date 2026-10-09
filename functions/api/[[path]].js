// GoldHunter Garuda API (Cloudflare Pages Functions + D1). All routes live under /api/.
import {
  HttpError, fail, json, readJson, now, DAY, str, int, isEmail, hashPassword, verifyPassword,
  encrypt, decrypt, createSession, destroySession, sessionUser, isAdminEmail, randomToken, sha256,
  siteUrl, esc, rupiah, fmtDate, unb64, b64, b64url,
} from '../../server/util.js';
import {
  getSettings, putSetting, quote, notify, emailUser, emailAdmin, newOrderCode, getUser, getProduct,
  processOrder, completeOrder, queueBuild, claimBuild, rebuildAll, finishBuild, runDaily, orderStatusLabel, pickUniqueCode, ensureUniqueCode, createOrder, changeOrderMonths, getUsdIdr, toIdr, boardName, maskAccount, reportInterval, activeBanks,
  usdtPay, TRC20_RE,
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
      } else if (r.auth === 'signal_pub') {
        if (!env.SIGNAL_SECRET || request.headers.get('x-signal-secret') !== env.SIGNAL_SECRET) fail(401, 'Secret sinyal salah');
      } else if (r.auth === 'signal_read') {
        if (!env.SIGNAL_KEY || request.headers.get('x-signal-key') !== env.SIGNAL_KEY) fail(401, 'Kunci sinyal salah');
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

// ---- Risk warning the member agrees to when signing up. The exact text of every version is archived in
// legal_texts and each acceptance in consents (time, IP, country, browser, language, text hash), so an admin can
// print the signed statement later. Change RISK_VERSION whenever the wording changes.
const RISK_VERSION = 'RW-2026-10-05';
const RISK_TEXT = {
  id: [
    'Saya memahami bahwa trading forex, emas (XAUUSD) dan kripto dengan leverage berisiko sangat tinggi dan dapat menyebabkan kehilangan sebagian atau SELURUH modal saya.',
    'Sinyal dan EA Garuda AI / GoldHunter Garuda adalah alat bantu trading, bukan nasihat investasi, bukan produk investasi, bukan pengelolaan dana, dan TIDAK menjamin profit.',
    'Analisis AI bisa salah. Win rate, hasil dan contoh perhitungan yang ditampilkan adalah catatan masa lalu atau ilustrasi dan tidak menjamin hasil di masa depan.',
    'Keputusan memakai sinyal atau EA, besar modal, setting, dan seluruh risiko yang timbul sepenuhnya menjadi tanggung jawab saya. GoldHunter Garuda dan admin tidak bertanggung jawab atas kerugian akibat kondisi pasar, broker, VPS, koneksi, maupun penggunaan sinyal / EA.',
    'GoldHunter Garuda bukan broker dan tidak menerima, menyimpan atau mengelola dana trading saya. Dana saya berada di akun broker atas nama saya sendiri.',
    'Saya hanya memakai dana yang siap saya tanggung risikonya, dan saya menyetujui peringatan risiko ini dengan sadar, tanpa paksaan.',
  ],
  en: [
    'I understand that trading forex, gold (XAUUSD) and crypto with leverage carries a very high risk and can lead to the loss of part or ALL of my capital.',
    'Garuda AI / GoldHunter Garuda signals and EAs are a trading tool, not investment advice, not an investment product, not fund management, and they do NOT guarantee profit.',
    'AI analysis can be wrong. The win rate, results and examples shown are past records or illustrations and do not guarantee future results.',
    'The decision to use the signals or the EA, the capital, the settings and all resulting risk are entirely my own responsibility. GoldHunter Garuda and its admin are not liable for losses caused by market conditions, brokers, VPS, connections or the use of the signals / EA.',
    'GoldHunter Garuda is not a broker and does not accept, hold or manage my trading funds. My funds stay in a broker account in my own name.',
    'I only use money I can afford to lose, and I accept this risk warning knowingly and without pressure.',
  ],
};
async function recordConsent(env, request, userId, lang) {
  const l = lang === 'en' ? 'en' : 'id';
  const text = RISK_TEXT[l].map((x, i) => `${i + 1}. ${x}`).join('\n');
  await env.DB.prepare('INSERT OR IGNORE INTO legal_texts (version, lang, text, created_at) VALUES (?,?,?,?)').bind(RISK_VERSION, l, text, now()).run();
  await env.DB.prepare(`INSERT INTO consents (user_id, kind, version, lang, text_hash, ip, country, user_agent, accepted_at) VALUES (?,?,?,?,?,?,?,?,?)`)
    .bind(userId, 'risk_warning', RISK_VERSION, l, await sha256(text), clientIp(request), (request.cf && request.cf.country) || '',
      str(request.headers.get('user-agent'), 300), now()).run();
}

route('POST', '/auth/register', 'public', async ({ request, env, base }) => {
  const b = await readJson(request);
  const name = str(b.name, 80), email = str(b.email, 120).toLowerCase(), phone = str(b.phone, 30), password = String(b.password || '');
  const address = str(b.address, 300);
  if (name.length < 2) fail(400, 'Nama lengkap wajib diisi');
  if (address.length < 5) fail(400, 'Alamat wajib diisi');
  if (!isEmail(email)) fail(400, 'Email tidak valid');
  if (!/^[0-9+\-\s]{8,20}$/.test(phone)) fail(400, 'Nomor WhatsApp tidak valid');
  if (password.length < 8) fail(400, 'Password minimal 8 karakter');
  if (!b.agree) fail(400, 'Centang persetujuan risiko trading dulu');
  await rateLimit(env, 'reg:' + clientIp(request), 10, 3600);
  const exists = await env.DB.prepare('SELECT 1 FROM users WHERE email=?').bind(email).first();
  if (exists) fail(409, 'Email sudah terdaftar. Silakan login atau reset password.');
  const { hash, salt } = await hashPassword(password);
  const role = isAdminEmail(env, email) ? 'admin' : 'member';
  const r = await env.DB.prepare('INSERT INTO users (email, name, phone, address, pass_hash, pass_salt, role, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .bind(email, name, phone, address, hash, salt, role, now()).run();
  const userId = r.meta.last_row_id;
  await recordConsent(env, request, userId, str(b.lang, 4));
  await notify(env, userId, 'Selamat datang di Garuda AI!', 'Pantau sinyal AI di Beranda, ikuti channel Telegram, dan lihat paket di menu Order.', '#/');
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
    ib_brokers: s.ib_brokers.filter((b) => b.active && b.link), whatsapp: s.whatsapp || '', telegram_link: s.telegram_public_link || '',
  });
});

// QR code of the USDT (TRC20) address, uploaded by the admin
route('GET', '/usdt-qr', 'public', async ({ env }) => {
  const s = await getSettings(env);
  const f = s.usdt_enabled === '1' && s.usdt_qr_file_id ? await env.DB.prepare("SELECT mime, data_b64 FROM files WHERE id=? AND kind='usdt_qr'").bind(int(s.usdt_qr_file_id)).first() : null;
  if (!f) fail(404, 'QR belum diatur');
  return new Response(unb64(f.data_b64), { headers: { 'content-type': f.mime, 'cache-control': 'public, max-age=300' } });
});
route('POST', '/admin/usdt-qr', 'admin', async ({ request, env }) => {
  const b = await readJson(request);
  const m = String(b.image || '').match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) fail(400, 'Gambar QR harus PNG / JPG / WEBP');
  if (m[2].length > 900000) fail(400, 'Gambar QR terlalu besar (maks. 600 KB)');
  const r = await env.DB.prepare('INSERT INTO files (user_id, kind, name, mime, size, data_b64, created_at) VALUES (NULL, ?, ?, ?, ?, ?, ?)')
    .bind('usdt_qr', 'usdt-qr', m[1], Math.round(m[2].length * 0.75), m[2], now()).run();
  await env.DB.prepare("DELETE FROM files WHERE kind='usdt_qr' AND id<>?").bind(r.meta.last_row_id).run();
  await putSetting(env, 'usdt_qr_file_id', String(r.meta.last_row_id));
  return json({ ok: true });
});
route('DELETE', '/admin/usdt-qr', 'admin', async ({ env }) => {
  await env.DB.prepare("DELETE FROM files WHERE kind='usdt_qr'").run();
  await env.DB.prepare("DELETE FROM settings WHERE key='usdt_qr_file_id'").run();
  return json({ ok: true });
});

// Visitor country from Cloudflare (website language: Indonesian visitors get Indonesian)
route('GET', '/geo', 'public', async ({ request }) => json({ country: (request.cf && request.cf.country) || request.headers.get('cf-ipcountry') || '' }));

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
  const next = reportInterval(await getSettings(env));      // the EA follows this, no recompile needed
  const last = await env.DB.prepare('SELECT updated_at FROM ea_stats WHERE license_id=?').bind(l.id).first();
  if (last && t - last.updated_at < 60) return json({ ok: true, throttled: true, next });
  const cur = str(b.currency, 8).toUpperCase();
  const wib = new Date((t + 7 * 3600) * 1000).toISOString().slice(0, 10);
  const wibOf = (x) => new Date((x + 7 * 3600) * 1000).toISOString().slice(0, 10);
  // Save writes: the daily history row is refreshed at most every 30 minutes (and at each new day)
  const writeDaily = !last || wibOf(last.updated_at) !== wib || t - last.updated_at >= 1800 || next >= 1800;
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO ea_stats (license_id, login, server, currency, balance, equity, profit_day, profit_week, profit_month, positions, ea_version, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(license_id) DO UPDATE SET login=excluded.login, server=excluded.server, currency=excluded.currency,
        balance=excluded.balance, equity=excluded.equity, profit_day=excluded.profit_day, profit_week=excluded.profit_week, profit_month=excluded.profit_month,
        positions=excluded.positions, ea_version=excluded.ea_version, updated_at=excluded.updated_at`)
      .bind(l.id, str(b.login, 20), str(b.server, 80), cur, num(b.balance), num(b.equity), num(b.day), num(b.week), num(b.month), int(b.positions) || 0, str(b.version, 20), t),
    env.DB.prepare(`INSERT INTO ea_stats_daily (license_id, day, profit, balance, currency) VALUES (?,?,?,?,?)
        ON CONFLICT(license_id, day) DO UPDATE SET profit=excluded.profit, balance=excluded.balance, currency=excluded.currency`)
      .bind(l.id, wib, num(b.day), num(b.balance), cur),
  ].slice(0, writeDaily ? 2 : 1));
  return json({ ok: true, next });
});

// ======================= GOLD HUNTER GARUDA LIVE (akun master -> website & Telegram) =======================
// The master EA (input 13.2 = ea_master_key) posts a snapshot every minute plus the events since the last post.
// The site keeps one live snapshot, the finished series, the events and one row per WIB day; Telegram gets reports
// and warnings (never "signals").
const eaNum = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; };
const eaPx = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : 0; };
const wibDay = (t) => new Date((t + 7 * 3600) * 1000).toISOString().slice(0, 10);
const wibHour = (t) => new Date((t + 7 * 3600) * 1000).getUTCHours();
const wibDayStart = (t) => t - ((t + 7 * 3600) % 86400);
const wibClock = (t) => { const d = new Date((t + 7 * 3600) * 1000); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} WIB`; };
const wibDate = (t) => { const d = new Date((t + 7 * 3600) * 1000); const m = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']; return `${d.getUTCDate()} ${m[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const eaMoney = (v, cur) => `${Number(v) > 0 ? '+' : (Number(v) < 0 ? '-' : '')}${Math.abs(Number(v) || 0).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${cur ? ' ' + cur : ''}`;
const eaPlain = (v) => Math.abs(Number(v) || 0).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const eaDur = (sec) => { const m = Math.max(0, Math.round(sec / 60)); return m >= 1440 ? `${Math.floor(m / 1440)} hari ${Math.floor((m % 1440) / 60)} jam` : m >= 60 ? `${Math.floor(m / 60)} jam ${m % 60} mnt` : `${m} menit`; };
const EA_LIVE_KEYS = ['ea_master_key', 'ea_report_hour', 'ea_tg_min_layers', 'ea_offline_min', 'ea_tg_enabled'];
function eaCfg(s) {
  return { key: String(s.ea_master_key || '').trim(), hour: Number.isFinite(Number(s.ea_report_hour)) && s.ea_report_hour !== '' ? int(s.ea_report_hour) : 21,
    minLayers: s.ea_tg_min_layers === '' || s.ea_tg_min_layers == null ? 4 : int(s.ea_tg_min_layers), offlineMin: int(s.ea_offline_min) || 5, tg: s.ea_tg_enabled !== '0' };
}
async function eaLiveRow(env) {
  const r = await env.DB.prepare('SELECT updated_at, data FROM ea_live WHERE id=1').first();
  let d = {};
  try { d = JSON.parse((r && r.data) || '{}'); } catch { d = {}; }
  return { at: (r && r.updated_at) || 0, d };
}
async function eaTg(env, cfg, text, base) {
  if (!cfg.tg) return;
  try { await tgBroadcast(env, text + (base ? `\n📈 <a href="${base}/live">goldhuntergaruda.com/live</a>` : '')); } catch (e) { console.error('ea telegram', e); }
}
// No heartbeat for more than x minutes -> one warning; the next heartbeat sends "online again". Checked by the public page and the builder poll.
async function eaOfflineCheck(env, s, base) {
  const cfg = eaCfg(s);
  if (!cfg.key) return;
  const { at, d } = await eaLiveRow(env);
  if (!at) return;
  if (now() - at > cfg.offlineMin * 60 && s.ea_offline_state !== '1') {
    await putSetting(env, 'ea_offline_state', '1');
    await eaTg(env, cfg, [`🔴 <b>EA GOLD HUNTER GARUDA TIDAK MENGIRIM DATA</b>`, `Data terakhir ${wibClock(at)} (${eaDur(now() - at)} lalu). Cek VPS / MT5 / koneksi internet.`,
      `Posisi terakhir: BUY ${(d.buy && d.buy.count) || 0} · SELL ${(d.sell && d.sell.count) || 0} · floating ${eaMoney(d.floating || 0, d.currency)}`].join('\n'), base);
  }
}
async function eaDailyReport(env, s, cfg, d, t, base) {
  const day = wibDay(t);
  if (wibHour(t) < cfg.hour || s.ea_report_day === day) return;
  await putSetting(env, 'ea_report_day', day);
  const [row, ser] = await Promise.all([
    env.DB.prepare('SELECT * FROM ea_days WHERE day=?').bind(day).first(),
    env.DB.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN profit>0 THEN 1 ELSE 0 END),0) AS wins, COALESCE(AVG(duration),0) AS dur,
        COALESCE(MAX(positions),0) AS maxpos, COALESCE(MAX(lots),0) AS maxlots FROM ea_series WHERE closed_at >= ?`).bind(wibDayStart(t)).first(),
  ]);
  const cur = d.currency || '';
  const pct = (v) => d.balance > 0 ? ` (${(v / d.balance * 100 >= 0 ? '+' : '')}${(v / d.balance * 100).toFixed(2)}% modal)` : '';
  const text = [`📊 <b>LAPORAN HARIAN GOLD HUNTER GARUDA</b> · ${wibDate(t)}`, '',
    `Profit hari ini: <b>${eaMoney(d.day, cur)}</b>${pct(d.day)}`,
    `Minggu ini: ${eaMoney(d.week, cur)} · Bulan ini: ${eaMoney(d.month, cur)}`,
    `Seri selesai: ${ser.n} (${ser.wins} profit)${ser.n ? ` · rata-rata ${eaDur(ser.dur)} · basket terpanjang ${ser.maxpos} posisi / ${Number(ser.maxlots).toFixed(2)} lot` : ''}`,
    `Equity ${eaPlain(d.equity)} ${cur} · floating ${eaMoney(d.floating, cur)} · DD terdalam hari ini ${row ? row.max_dd_pct.toFixed(2) : '0.00'}%`,
    `Posisi sekarang: BUY ${(d.buy && d.buy.count) || 0} · SELL ${(d.sell && d.sell.count) || 0}`,
    d.pocket ? `Kantong profit: saldo ${eaPlain(d.pocket.saldo)} · dipakai ${d.pocket.cuts || 0}×` : '',
    `Mode ${esc(d.mode || '')} · lot ×${d.lot_mult} · TP ${d.tp_pts} poin · EA v${esc(d.version || '')}`].filter((x) => x !== '').join('\n');
  await eaTg(env, cfg, text, base);
}
route('POST', '/ea/live', 'public', async ({ request, env, waitUntil, base }) => {
  const s = await getSettings(env);
  const cfg = eaCfg(s);
  if (!cfg.key || request.headers.get('x-ea-key') !== cfg.key) fail(403, 'Kunci master salah (Admin > Pengaturan > EA Live)');
  const b = await readJson(request);
  const t = now();
  const side = (x) => x && typeof x === 'object' && int(x.count) > 0
    ? { count: int(x.count), lots: eaNum(x.lots), avg: eaPx(x.avg), tp: eaPx(x.tp), profit: eaNum(x.profit), next_lot: eaNum(x.next_lot), next_price: eaPx(x.next_price), since: int(x.since) || 0 }
    : { count: 0 };
  const pk = b.pocket && typeof b.pocket === 'object' ? b.pocket : {};
  const nw = b.news && typeof b.news === 'object' ? b.news : {};
  const snap = { login: str(b.login, 20), server: str(b.server, 60), currency: str(b.currency, 8).toUpperCase(), version: str(b.version, 12), symbol: str(b.symbol, 16),
    balance: eaNum(b.balance), equity: eaNum(b.equity), floating: eaNum(b.floating), day: eaNum(b.day), week: eaNum(b.week), month: eaNum(b.month),
    spread: int(b.spread) || 0, margin_level: eaNum(b.margin_level), status: str(b.status, 200), mode: str(b.mode, 12), trend_tf: str(b.trend_tf, 6), trend: int(b.trend) || 0, trend_why: str(b.trend_why, 120),
    tp_pts: int(b.tp_pts) || 0, lot_mult: eaNum(b.lot_mult), dist_pts: int(b.dist_pts) || 0, first_lot: eaNum(b.first_lot), reduction_from: int(b.reduction_from) || 0,
    pocket_pct: eaNum(b.pocket_pct), pocket_layers: int(b.pocket_layers) || 0,
    buy: side(b.buy), sell: side(b.sell), pocket: { saldo: eaNum(pk.saldo), in: eaNum(pk.in), out: eaNum(pk.out), cuts: int(pk.cuts) || 0 },
    news: { name: str(nw.name, 80), time: int(nw.time) || 0, active: !!nw.active, mode: str(nw.mode, 8) } };
  const day = wibDay(t);
  const prev = await env.DB.prepare('SELECT min_equity, max_dd_pct FROM ea_days WHERE day=?').bind(day).first();
  const minEq = prev && prev.min_equity > 0 ? Math.min(prev.min_equity, snap.equity) : snap.equity;
  const dd = snap.balance > 0 ? Math.max(prev ? prev.max_dd_pct : 0, Math.max(0, (snap.balance - snap.equity) / snap.balance * 100)) : 0;
  await env.DB.batch([
    env.DB.prepare('UPDATE ea_live SET updated_at=?, data=? WHERE id=1').bind(t, JSON.stringify(snap)),
    env.DB.prepare(`INSERT INTO ea_days (day, profit, balance, equity, min_equity, max_dd_pct, currency, updated_at) VALUES (?,?,?,?,?,?,?,?)
        ON CONFLICT(day) DO UPDATE SET profit=excluded.profit, balance=excluded.balance, equity=excluded.equity, min_equity=excluded.min_equity, max_dd_pct=excluded.max_dd_pct,
        currency=excluded.currency, updated_at=excluded.updated_at`).bind(day, snap.day, snap.balance, snap.equity, minEq, Math.round(dd * 100) / 100, snap.currency, t),
  ]);
  const msgs = [];
  const evs = Array.isArray(b.events) ? b.events.slice(0, 50) : [];
  const TITLE = { kantong: '🟡 KANTONG PROFIT', pengaman: '🛑 PENGAMAN EQUITY', dd: '⚠️ FLOATING RUGI BESAR', layer: '⚠️ BASKET PANJANG', reduction: '🔁 REDUCTION' };
  for (const e of evs) {
    const kind = str(e.kind, 12);
    if (!TITLE[kind] && kind !== 'seri') continue;
    const at = int(e.at) || t, sd = str(e.side, 4).toUpperCase(), profit = eaNum(e.profit), positions = int(e.positions) || 0, lots = eaNum(e.lots), dur = int(e.duration) || 0, text = str(e.text, 300);
    if (kind === 'seri') {
      await env.DB.batch([
        env.DB.prepare('INSERT INTO ea_series (closed_at, side, positions, lots, profit, duration, currency) VALUES (?,?,?,?,?,?,?)').bind(at, sd, positions, lots, profit, dur, snap.currency),
        env.DB.prepare('INSERT INTO ea_days (day, series, wins, currency, updated_at) VALUES (?,1,?,?,?) ON CONFLICT(day) DO UPDATE SET series=series+1, wins=wins+excluded.wins').bind(wibDay(at), profit > 0 ? 1 : 0, snap.currency, t),
      ]);
      if (positions >= cfg.minLayers) msgs.push(`${profit >= 0 ? '✅' : '🟠'} <b>Seri ${sd} selesai ${eaMoney(profit, snap.currency)}</b>\n${positions} posisi · ${lots.toFixed(2)} lot · ${eaDur(dur)}`);
    } else {
      await env.DB.prepare('INSERT INTO ea_events (at, kind, side, text, profit) VALUES (?,?,?,?,?)').bind(at, kind, sd, text, profit).run();
      if (kind !== 'reduction') msgs.push(`<b>${TITLE[kind]}</b>\n${esc(text)}`);
    }
  }
  if (s.ea_offline_state === '1') { await putSetting(env, 'ea_offline_state', '0'); msgs.push('🟢 <b>EA GOLD HUNTER GARUDA online kembali</b>'); }
  for (const m of msgs) waitUntil(eaTg(env, cfg, m, base));
  waitUntil(eaDailyReport(env, s, cfg, snap, t, base).catch((e) => console.error('ea daily', e)));
  return json({ ok: true, next: 60 });
});
route('GET', '/live', 'public', async ({ env, waitUntil, base }) => {
  const s = await getSettings(env);
  const cfg = eaCfg(s);
  const { at, d } = await eaLiveRow(env);
  const t = now();
  waitUntil(eaOfflineCheck(env, s, base).catch((e) => console.error('ea offline', e)));
  const [series, days, events, today] = await Promise.all([
    env.DB.prepare('SELECT closed_at, side, positions, lots, profit, duration, currency FROM ea_series ORDER BY id DESC LIMIT 40').all(),
    env.DB.prepare('SELECT * FROM ea_days ORDER BY day DESC LIMIT 31').all(),
    env.DB.prepare('SELECT at, kind, side, text, profit FROM ea_events ORDER BY id DESC LIMIT 20').all(),
    env.DB.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN profit>0 THEN 1 ELSE 0 END),0) AS wins, COALESCE(SUM(profit),0) AS profit,
        COALESCE(AVG(duration),0) AS dur, COALESCE(MAX(positions),0) AS maxpos FROM ea_series WHERE closed_at >= ?`).bind(wibDayStart(t)).first(),
  ]);
  const snap = { ...d };
  delete snap.login;
  delete snap.server;
  return json({ ok: true, configured: !!cfg.key, at, age: at ? t - at : null, online: !!at && t - at <= cfg.offlineMin * 60, offline_min: cfg.offlineMin,
    snapshot: snap, today, series: series.results, days: days.results, events: events.results, server_time: t });
});

// ======================= AI SIGNALS (MASTER EA -> server -> CLIENT EAs) =======================
const signalView = (r) => r && ({
  id: r.id, symbol: r.symbol, bar_time: r.bar_time, created_at: r.created_at, valid_until: r.valid_until,
  decision: r.decision, confidence: r.confidence, price: r.price, sl: r.sl, tp: r.tp,
  trend_h4: r.trend_h4, trend_h1: r.trend_h1, reason: r.reason, news: r.news || '', reason_en: r.reason_en || '', news_en: r.news_en || '', model: r.model,
  status: r.status, close_price: r.close_price, closed_at: r.closed_at, pips: r.pips,
  order_type: r.order_type || 'MARKET', filled_at: r.filled_at || 0, cancel_reason: r.cancel_reason || '',
  risk_pct: r.risk_pct || 1, tag: r.tag || '', sl_now: r.sl_now || 0, be_at: r.be_at || 0, mgmt_note: r.mgmt_note || '',
});
// signals that finished with a result (pending, cancelled and running ones are not part of any statistic)
const DONE_SQL = "status IN ('TP','SL','BE','CLOSE')";
const isLive = (st) => st === 'open' || st === 'pending';
// Markets: canonical symbol (broker suffix removed) and its pip size / decimals from table ai_symbols
const canonSymbol = (v) => { const x = str(v, 20).toUpperCase(); const m = x.match(/^([A-Z]{6})/); return m ? m[1] : x; };
const SYM_DEFAULT = { symbol: '', enabled: 0, pip: 0.1, digits: 2, pip_label: 'pips', session_start: 7, session_end: 20, weekend: 0, min_sl: 30, max_sl: 200 };
async function getSymbol(env, symbol) {
  const r = await env.DB.prepare('SELECT * FROM ai_symbols WHERE symbol=?').bind(symbol).first();
  return r || { ...SYM_DEFAULT, symbol };
}
async function allSymbols(env) {
  const { results } = await env.DB.prepare('SELECT * FROM ai_symbols ORDER BY sort, symbol').all();
  return results;
}
const symView = (m) => ({ symbol: m.symbol, enabled: !!m.enabled, pip: m.pip, digits: m.digits, pip_label: m.pip_label,
  session_start: m.session_start, session_end: m.session_end, weekend: !!m.weekend, min_sl: m.min_sl, max_sl: m.max_sl, profile: m.profile || '', scalp: !!m.scalp });

// ---- Telegram: the server posts every BUY/SELL signal (with the chart picture) and its result as a reply ----
// Configured in Admin > Pengaturan: bot token (stored encrypted) and any number of target channels / groups.
async function tgConfig(env) {
  const s = await getSettings(env);
  const token = s.telegram_bot_token_enc ? await decrypt(env, s.telegram_bot_token_enc) : '';
  const targets = (Array.isArray(s.telegram_targets) ? s.telegram_targets : []).filter((t) => t.active !== false && t.chat_id);
  return { on: s.telegram_enabled === '1' && !!token && targets.length > 0, token, targets };
}

// One message (or photo with caption) to one chat; returns { ok, message_id, error }
async function tgSend(token, chatId, text, { photo, replyTo } = {}) {
  const reply = replyTo ? { message_id: replyTo, allow_sending_without_reply: true } : null;
  try {
    let r;
    if (photo && text.length > 1024) {
      // caption limit 1024: picture with the headline, then the full text as a reply to it
      const head = text.split('\n\n')[0].slice(0, 1000);
      const p = await tgSend(token, chatId, head, { photo, replyTo });
      if (!p.ok) return p;
      const t = await tgSend(token, chatId, text, { replyTo: p.message_id });
      return t.ok ? p : t;
    }
    if (photo) {
      const fd = new FormData();
      fd.append('chat_id', String(chatId));
      fd.append('caption', text);
      fd.append('parse_mode', 'HTML');
      if (reply) fd.append('reply_parameters', JSON.stringify(reply));
      fd.append('photo', new Blob([unb64(photo)], { type: 'image/png' }), 'chart.png');
      r = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: 'POST', body: fd });
    } else {
      const body = { chat_id: chatId, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true } };
      if (reply) body.reply_parameters = reply;
      r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    }
    const j = await r.json();
    return j.ok ? { ok: true, message_id: j.result.message_id } : { ok: false, error: j.description || 'ditolak Telegram' };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

// Send to every active target; replyTo is the {chat_id: message_id} map of the original signal post
async function tgBroadcast(env, text, { photo, replyTo } = {}) {
  const c = await tgConfig(env);
  if (!c.on) return null;
  const out = {};
  await Promise.all(c.targets.map(async (t) => {
    const r = await tgSend(c.token, t.chat_id, text, { photo, replyTo: replyTo ? replyTo[t.chat_id] : null });
    if (r.ok) out[t.chat_id] = r.message_id;
    else console.error('telegram', t.chat_id, r.error);
  }));
  return out;
}

const fx = (n, d) => Number(n).toFixed(d);
// pips (gold 0.10, FX 0.0001 / JPY 0.01) with points = 1/10 pip; BTC is counted in whole-dollar "poin"
const pipTxt = (p, m) => m.pip_label === 'pips'
  ? `${p > 0 ? '+' : ''}${Number(p).toFixed(1)} pips (${p > 0 ? '+' : ''}${Math.round(p * 10).toLocaleString('id-ID')} point)`
  : `${p > 0 ? '+' : ''}${Math.round(p).toLocaleString('id-ID')} ${m.pip_label}`;
const SIDE_TXT = { BUY: '🟢 BUY', SELL: '🔴 SELL' };
const MK_NAME = { XAUUSD: 'Emas', BTCUSD: 'Bitcoin', EURUSD: 'Euro / Dolar', USDJPY: 'Dolar / Yen' };
const mkTitle = (sym) => `${esc(sym)}${MK_NAME[sym] ? ` (${MK_NAME[sym]})` : ''}`;
const trendTxt = (t) => t === 'UP' ? '▲ naik' : t === 'DOWN' ? '▼ turun' : '◆ sideways';
const durTxt = (sec) => { const m = Math.max(0, Math.round(sec / 60)); return m >= 60 ? `${Math.floor(m / 60)}j ${m % 60}m` : `${m}m`; };
// Claude writes the reason as "why ... Tunggu / Saya menunggu ..." -> split into why and what it waits for
function splitWait(reason) {
  const r = String(reason || '').trim();
  const i = r.search(/(?:^|[.;]\s+)(Tunggu|Menunggu|Saya menunggu|Kita tunggu)\b/);
  if (i <= 0) return [r, ''];
  const j = r.slice(i).search(/[A-Z]/);
  return [r.slice(0, i + 1).trim(), r.slice(i + Math.max(0, j)).trim()];
}
// Analysis without an entry (TUNGGU): education for followers, why the AI stays out and what it waits for
function tgWaitText(r, base, m) {
  const [why, wait] = splitWait(r.reason);
  return [
    `🦅 <b>GARUDA AI · ANALISIS ${mkTitle(r.symbol)}</b>`,
    `⏸ <b>Keputusan: TUNGGU</b>, belum ada entry`,
    `📊 Tren H4 ${trendTxt(r.trend_h4)} · H1 ${trendTxt(r.trend_h1)} · harga ${fx(r.price, m.digits)}`,
    '',
    '🧠 <b>Kenapa AI belum masuk?</b>',
    esc(why),
    ...(wait ? ['', '🎯 <b>Yang ditunggu AI</b>', esc(wait)] : []),
    ...(r.news ? ['', '📰 <b>Fundamental</b>', esc(r.news)] : []),
    '',
    '💡 <i>Tidak entry juga keputusan. Menunggu setup yang jelas menjaga modal tetap aman.</i>',
    `🔎 Sinyal &amp; track record: <a href="${base}/sinyal">goldhuntergaruda.com/sinyal</a>`,
    '<i>Edukasi, bukan saran investasi.</i>',
  ].join('\n');
}
const MAX_CHART_B64 = 1_800_000;              // about 1.3 MB PNG
const chartB64 = (v) => { const x = typeof v === 'string' ? v.replace(/\s/g, '') : ''; return x && x.length <= MAX_CHART_B64 && /^[A-Za-z0-9+/=]+$/.test(x) ? x : ''; };
async function saveChart(env, id, kind, data) {
  if (!data) return;
  await env.DB.prepare(`INSERT INTO signal_charts (signal_id, kind, mime, data, created_at) VALUES (?,?,?,?,?)
      ON CONFLICT(signal_id, kind) DO UPDATE SET data=excluded.data, created_at=excluded.created_at`).bind(id, kind, 'image/png', data, now()).run();
}

function tgOpenText(r, base, m) {
  const slP = Math.abs(r.price - r.sl) / m.pip, tpP = Math.abs(r.tp - r.price) / m.pip;
  const rr = slP > 0 ? tpP / slP : 0;
  const pend = r.order_type === 'LIMIT' || r.order_type === 'STOP';
  const until = new Date((r.valid_until + 7 * 3600) * 1000);
  const untilTxt = `${String(until.getUTCHours()).padStart(2, '0')}:${String(until.getUTCMinutes()).padStart(2, '0')} WIB`;
  return [
    (r.tag === 'NEWS' ? '📰 <b>NEWS</b> · ' : r.tag === 'SCALP' ? '⚡ <b>SCALP</b> · ' : '') + (pend ? `⏳ <b>GARUDA AI · PENDING ${SIDE_TXT[r.decision]} ${r.order_type} ${mkTitle(r.symbol)}</b>` : `🦅 <b>GARUDA AI · SINYAL ${SIDE_TXT[r.decision]} ${mkTitle(r.symbol)}</b>`),
    '',
    pend ? `📌 Harga pending: <b>${fx(r.price, m.digits)}</b> (${r.order_type === 'LIMIT' ? 'menunggu harga kembali ke area ini' : 'masuk saat harga menembus level ini'})` : `▶️ Entry: <b>${fx(r.price, m.digits)}</b>`,
    `🛑 Stop loss: <b>${fx(r.sl, m.digits)}</b>  (−${slP.toFixed(0)} ${m.pip_label})`,
    `🎯 Take profit: <b>${fx(r.tp, m.digits)}</b>  (+${tpP.toFixed(0)} ${m.pip_label})`,
    `⚖️ Risk : reward 1 : ${rr.toFixed(2)} · keyakinan AI ${r.confidence}%`,
    `🎚 Risiko pilihan AI: ${Number(r.risk_pct || 1).toFixed(2).replace(/\.?0+$/, '')}% saldo (lot dihitung otomatis dari modal tiap akun)`,
    `📊 Tren H4 ${trendTxt(r.trend_h4)} · H1 ${trendTxt(r.trend_h1)}`,
    '',
    '🧠 <b>Alasan AI</b>',
    esc(r.reason),
    ...(r.news ? ['', '📰 <b>Fundamental</b>', esc(r.news)] : []),
    '',
    pend ? `⏳ Berlaku sampai ${untilTxt}. Otomatis dibatalkan jika harga tidak tercapai atau setup gagal · #S${r.id}`
      : `⏱ Entry maksimal ${Math.round((r.valid_until - r.created_at) / 60)} menit setelah sinyal · #S${r.id}`,
    `🔎 Track record: <a href="${base}/sinyal?s=${r.id}">goldhuntergaruda.com/sinyal</a>`,
    '<i>Risiko ±1% per sinyal. Bukan saran investasi, trading berisiko tinggi.</i>',
  ].join('\n');
}

function tgCloseText(r, result, close, pips, m) {
  const head = { TP: '✅ <b>TARGET TERCAPAI (TP)</b>', SL: '❌ <b>STOP LOSS (SL)</b>', BE: '⚖️ <b>BREAK EVEN</b>', CLOSE: r.mgmt_note ? '🔒 <b>DITUTUP OLEH AI</b>' : '🔒 <b>DITUTUP</b>' }[result];
  const note = { TP: '🎉 Rencana berjalan sesuai analisis.', SL: '🛡️ Rugi terukur sesuai rencana (risiko ±1%). Disiplin SL menjaga modal untuk peluang berikutnya.',
    BE: '🛡️ SL sudah digeser ke harga masuk, posisi keluar tanpa rugi.', CLOSE: 'Posisi ditutup sebelum akhir pekan.' }[result];
  return [
    `${head}`,
    `${SIDE_TXT[r.decision]} ${mkTitle(r.symbol)} · #S${r.id}`,
    '',
    `Entry ${fx(r.price, m.digits)} → ${fx(close, m.digits)}`,
    `💰 Hasil: <b>${pipTxt(pips, m)}</b>`,
    ...(r.created_at ? [`⏱ Lama posisi: ${durTxt(now() - r.created_at)}`] : []),
    '',
    result === 'CLOSE' && r.mgmt_note ? `🧠 ${esc(r.mgmt_note)}` : note,
  ].join('\n');
}

// When a client should ask again: signals arrive a few minutes after each H1 close, so clients come back
// ~2.5 minutes after the next hour (plus a short retry window while this hour's signal is still missing).
// Keeps Functions/D1 traffic to a few requests per client per hour.
// When a CLIENT EA should ask again: often right after each analysis slot (Admin: every 60 / 30 / 15 min),
// and at most every 2 minutes when quick re-analysis on Claude's levels is on (it can come at any time)
function nextSignalCheck(t, latest, s = {}) {
  const slot = (Number(s.ai_interval_min) || 60) * 60;
  const slotStart = t - (t % slot);
  const toNext = slotStart + slot + 150 - t;
  const fresh = latest && latest.created_at >= slotStart;
  if (!fresh && t - slotStart < Math.min(15 * 60, slot / 2)) return 45;
  const n = Math.max(30, Math.min(toNext, 3600));
  return s.ai_level_trigger === '1' || s.ai_momentum === '1' ? Math.min(n, 120) : n;
}

route('POST', '/signal/publish', 'signal_pub', async ({ request, env, base, waitUntil }) => {
  const b = await readJson(request);
  const decision = str(b.decision, 8).toUpperCase();
  if (!['BUY', 'SELL', 'WAIT'].includes(decision)) fail(400, 'decision harus BUY, SELL atau WAIT');
  const symbol = canonSymbol(b.symbol);
  if (!symbol) fail(400, 'symbol kosong');
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const t = now();
  const orderType = decision !== 'WAIT' && ['LIMIT', 'STOP'].includes(str(b.order_type, 8).toUpperCase()) ? str(b.order_type, 8).toUpperCase() : 'MARKET';
  const pending = orderType !== 'MARKET';
  const validMin = Math.max(1, Math.min(int(b.valid_min) || 10, pending ? 480 : 60));
  const riskPct = Math.max(0.25, Math.min(Number(b.risk_pct) || 1, 1));
  const tag = ['NEWS', 'SCALP'].includes(str(b.tag, 8).toUpperCase()) ? str(b.tag, 8).toUpperCase() : '';
  const r = await env.DB.prepare(`INSERT INTO signals (symbol, bar_time, created_at, valid_until, decision, confidence, price, sl, tp, trend_h4, trend_h1, reason, model, cost_usd, tokens_in, tokens_out, status, news, reason_en, news_en, order_type, risk_pct, tag)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(symbol, int(b.bar_time) || 0, t, t + validMin * 60, decision, Math.max(0, Math.min(int(b.confidence) || 0, 100)),
      num(b.price), num(b.sl), num(b.tp), str(b.trend_h4, 8), str(b.trend_h1, 8), str(b.reason, 600), str(b.model, 40),
      num(b.cost_usd), int(b.tokens_in) || 0, int(b.tokens_out) || 0, decision === 'WAIT' ? 'wait' : (pending ? 'pending' : 'open'), str(b.news, 400), str(b.reason_en, 600), str(b.news_en, 400),
      orderType, riskPct, tag)
    .run();
  const id = r.meta.last_row_id;
  const chart = chartB64(b.chart_png);
  await saveChart(env, id, 'open', chart);
  if (decision === 'WAIT' && chart) {
    // analysis picture of a WAIT: shown on /sinyal and posted to Telegram as education (the EA sends one every x hours)
    waitUntil((async () => {
      await env.DB.prepare(`DELETE FROM signal_charts WHERE signal_id IN (SELECT id FROM signals WHERE decision='WAIT' AND created_at < ?)`).bind(t - 7 * DAY).run();
      const s = await getSettings(env);
      const key = 'tg_wait_last_' + symbol;
      const hrs = Math.max(1, Math.min(Number(s.telegram_wait_hours) || 3, 24));
      if (s.telegram_wait !== '1' || t - (Number(s[key]) || 0) < hrs * 3600 - 900) return;
      const row = await env.DB.prepare('SELECT * FROM signals WHERE id=?').bind(id).first();
      const msgs = await tgBroadcast(env, tgWaitText(row, base, await getSymbol(env, symbol)), { photo: chart });
      if (msgs && Object.keys(msgs).length) await putSetting(env, key, String(t));
    })());
  }
  if (decision !== 'WAIT') {
    // post to Telegram in the background so the EA gets its answer at once
    waitUntil((async () => {
      const row = await env.DB.prepare('SELECT * FROM signals WHERE id=?').bind(id).first();
      const msgs = await tgBroadcast(env, tgOpenText(row, base, await getSymbol(env, symbol)), { photo: chart });
      if (msgs && Object.keys(msgs).length) await env.DB.prepare('UPDATE signals SET tg_msgs=? WHERE id=?').bind(JSON.stringify(msgs), id).run();
    })());
  }
  return json({ ok: true, id, valid_until: t + validMin * 60 });
});

// The master moved the stop to the entry (break even at +1R): the position can no longer lose
route('POST', '/signal/update', 'signal_pub', async ({ request, env, waitUntil }) => {
  const b = await readJson(request);
  const row = await env.DB.prepare('SELECT * FROM signals WHERE id=?').bind(int(b.id) || 0).first();
  if (!row) fail(404, 'Sinyal tidak ditemukan');
  if (row.status !== 'open') fail(409, 'Sinyal tidak berjalan');
  const sl = Number(b.sl);
  if (!(sl > 0)) fail(400, 'sl tidak valid');
  const ai = str(b.event, 8).toUpperCase() === 'SL';
  if (!ai && row.be_at) return json({ ok: true, already: true });
  const note = str(b.note, 300);
  if (ai) await env.DB.prepare('UPDATE signals SET sl_now=?, mgmt_note=? WHERE id=?').bind(sl, note, row.id).run();
  else await env.DB.prepare('UPDATE signals SET sl_now=?, be_at=? WHERE id=?').bind(sl, now(), row.id).run();
  const mk = await getSymbol(env, row.symbol);
  let replyTo = null;
  try { replyTo = row.tg_msgs ? JSON.parse(row.tg_msgs) : null; } catch { replyTo = null; }
  const lockPips = Math.round(((row.decision === 'BUY' ? sl - row.price : row.price - sl) / mk.pip) * 10) / 10;
  waitUntil(tgBroadcast(env, ai
    ? [`🔧 <b>AI MENGGESER SL</b> · ${SIDE_TXT[row.decision]} ${mkTitle(row.symbol)} · #S${row.id}`, '',
      `SL sekarang <b>${fx(sl, mk.digits)}</b>${lockPips > 0 ? ` (profit terkunci ${pipTxt(lockPips, mk)})` : ''}, TP tetap ${fx(row.tp, mk.digits)}.`,
      ...(note ? [`🧠 ${esc(note)}`] : [])].join('\n')
    : [`🛡️ <b>BREAK EVEN</b> · ${SIDE_TXT[row.decision]} ${mkTitle(row.symbol)} · #S${row.id}`, '',
      `Harga sudah bergerak +1R sesuai arah. SL dipindah dari ${fx(row.sl, mk.digits)} ke harga masuk <b>${fx(sl, mk.digits)}</b>.`,
      'Posisi sekarang aman: paling buruk keluar tanpa rugi, target TP tetap ' + fx(row.tp, mk.digits) + '.'].join('\n'), { replyTo }));
  return json({ ok: true });
});

// A pending signal was filled (price reached the pending level) or cancelled (not reached in time / setup failed)
route('POST', '/signal/fill', 'signal_pub', async ({ request, env, waitUntil }) => {
  const b = await readJson(request);
  const row = await env.DB.prepare('SELECT * FROM signals WHERE id=?').bind(int(b.id) || 0).first();
  if (!row) fail(404, 'Sinyal tidak ditemukan');
  if (row.status !== 'pending') fail(409, 'Sinyal bukan pending');
  const price = Number(b.price) > 0 ? Number(b.price) : row.price;
  const t = now();
  await env.DB.prepare("UPDATE signals SET status='open', price=?, filled_at=?, valid_until=? WHERE id=?").bind(price, t, t + 120, row.id).run();
  const mk = await getSymbol(env, row.symbol);
  let replyTo = null;
  try { replyTo = row.tg_msgs ? JSON.parse(row.tg_msgs) : null; } catch { replyTo = null; }
  waitUntil(tgBroadcast(env, [`✅ <b>PENDING TERISI</b> · ${SIDE_TXT[row.decision]} ${mkTitle(row.symbol)} · #S${row.id}`, '',
    `Masuk di <b>${fx(price, mk.digits)}</b> · SL ${fx(row.sl, mk.digits)} · TP ${fx(row.tp, mk.digits)}`, 'Posisi sekarang berjalan, hasilnya dikirim saat TP / SL.'].join('\n'), { replyTo }));
  return json({ ok: true });
});
route('POST', '/signal/cancel', 'signal_pub', async ({ request, env, waitUntil }) => {
  const b = await readJson(request);
  const row = await env.DB.prepare('SELECT * FROM signals WHERE id=?').bind(int(b.id) || 0).first();
  if (!row) fail(404, 'Sinyal tidak ditemukan');
  if (row.status !== 'pending') fail(409, 'Sinyal bukan pending');
  const why = str(b.reason, 200) || 'harga tidak tercapai';
  await env.DB.prepare("UPDATE signals SET status='cancel', closed_at=?, cancel_reason=? WHERE id=?").bind(now(), why, row.id).run();
  let replyTo = null;
  try { replyTo = row.tg_msgs ? JSON.parse(row.tg_msgs) : null; } catch { replyTo = null; }
  waitUntil(tgBroadcast(env, [`🚫 <b>PENDING DIBATALKAN</b> · ${SIDE_TXT[row.decision]} ${mkTitle(row.symbol)} · #S${row.id}`, '',
    `Alasan: ${esc(why)}`, 'Order belum pernah terisi, jadi tidak ada untung / rugi. Tidak dihitung di win rate.'].join('\n'), { replyTo }));
  return json({ ok: true });
});

// The AI planned a pending order but the EA could not place it (filters / broker): clear reason on Telegram and on the live card
route('POST', '/signal/pending-fail', 'signal_pub', async ({ request, env, waitUntil }) => {
  const b = await readJson(request);
  const symbol = canonSymbol(str(b.symbol, 20));
  const mk = await getSymbol(env, symbol);
  if (!mk) fail(404, 'Pasar tidak dikenal');
  const dec = str(b.decision, 4).toUpperCase() === 'BUY' ? 'BUY' : 'SELL';
  const type = str(b.order_type, 8).toUpperCase() === 'STOP' ? 'STOP' : 'LIMIT';
  const price = Number(b.price) || 0, sl = Number(b.sl) || 0, tp = Number(b.tp) || 0;
  const why = str(b.reason, 400) || 'tidak lolos saringan EA';
  const text = `Rencana ${dec} ${type} ${fx(price, mk.digits)} tidak dipasang: ${why}`;
  await env.DB.prepare("UPDATE signals SET pend_fail=? WHERE id = (SELECT MAX(id) FROM signals WHERE symbol=? AND decision='WAIT' AND created_at > ?)")
    .bind(text, symbol, now() - 15 * 60).run();
  waitUntil(tgBroadcast(env, [`⚠️ <b>PENDING TIDAK DIPASANG</b> · ${SIDE_TXT[dec]} ${type} ${mkTitle(symbol)}`, '',
    `Rencana AI: ${dec} ${type} <b>${fx(price, mk.digits)}</b>${sl ? ` · SL ${fx(sl, mk.digits)}` : ''}${tp ? ` · TP ${fx(tp, mk.digits)}` : ''}${int(b.confidence) ? ` · keyakinan ${int(b.confidence)}%` : ''}`,
    `❗ Alasan: ${esc(why)}`, '',
    'Tidak ada order dan tidak ada posisi. AI terus memantau; pending baru bisa dipasang di analisis berikutnya.'].join('\n')));
  return json({ ok: true });
});

// A waiting pending order revised by the AI (same direction, new levels): same signal number, clients re-place their order
route('POST', '/signal/modify', 'signal_pub', async ({ request, env, waitUntil }) => {
  const b = await readJson(request);
  const row = await env.DB.prepare('SELECT * FROM signals WHERE id=?').bind(int(b.id) || 0).first();
  if (!row) fail(404, 'Sinyal tidak ditemukan');
  if (row.status !== 'pending') fail(409, 'Sinyal bukan pending');
  const type = ['LIMIT', 'STOP'].includes(str(b.order_type, 8).toUpperCase()) ? str(b.order_type, 8).toUpperCase() : row.order_type;
  const price = Number(b.price), sl = Number(b.sl), tp = Number(b.tp);
  if (!(price > 0 && sl > 0 && tp > 0)) fail(400, 'price / sl / tp tidak valid');
  const buy = row.decision === 'BUY';
  if (buy ? !(sl < price && tp > price) : !(sl > price && tp < price)) fail(400, 'SL / TP di sisi yang salah');
  const until = now() + Math.max(1, Math.min(int(b.valid_min) || 60, 24 * 60)) * 60;
  const conf = Math.max(0, Math.min(100, int(b.confidence) || row.confidence));
  const why = str(b.reason, 2000);
  const risk = Number(b.risk_pct) > 0 ? Math.max(0.25, Math.min(1, Number(b.risk_pct))) : row.risk_pct;
  await env.DB.prepare('UPDATE signals SET order_type=?, price=?, sl=?, tp=?, valid_until=?, confidence=?, risk_pct=? WHERE id=?').bind(type, price, sl, tp, until, conf, risk, row.id).run();
  const mk = await getSymbol(env, row.symbol);
  let replyTo = null;
  try { replyTo = row.tg_msgs ? JSON.parse(row.tg_msgs) : null; } catch { replyTo = null; }
  const u = new Date((until + 7 * 3600) * 1000);
  const slP = Math.abs(price - sl) / mk.pip, tpP = Math.abs(tp - price) / mk.pip;
  waitUntil(tgBroadcast(env, [`✏️ <b>PENDING DIUBAH AI</b> · ${SIDE_TXT[row.decision]} ${type} ${mkTitle(row.symbol)} · #S${row.id}`, '',
    `📌 Harga pending: ${fx(row.price, mk.digits)} → <b>${fx(price, mk.digits)}</b>`,
    `🛑 SL: ${fx(row.sl, mk.digits)} → <b>${fx(sl, mk.digits)}</b> (−${slP.toFixed(0)} ${mk.pip_label})`,
    `🎯 TP: ${fx(row.tp, mk.digits)} → <b>${fx(tp, mk.digits)}</b> (+${tpP.toFixed(0)} ${mk.pip_label})`,
    `⏳ Berlaku sampai ${String(u.getUTCHours()).padStart(2, '0')}:${String(u.getUTCMinutes()).padStart(2, '0')} WIB · keyakinan AI ${conf}%`,
    ...(why ? ['', `🧠 ${esc(why)}`] : []),
    '', 'Belum ada posisi: order lama diganti order baru di level ini (lot dihitung ulang dari jarak SL).'].join('\n'), { replyTo }));
  return json({ ok: true });
});

// The MASTER EA follows every BUY/SELL signal and reports how it ended; pips are computed here from the entry
route('POST', '/signal/close', 'signal_pub', async ({ request, env, waitUntil }) => {
  const b = await readJson(request);
  const result = str(b.result, 8).toUpperCase();
  if (!['TP', 'SL', 'BE', 'CLOSE'].includes(result)) fail(400, 'result harus TP, SL, BE atau CLOSE');
  const row = await env.DB.prepare('SELECT id, symbol, decision, price, status, tg_msgs, created_at FROM signals WHERE id=?').bind(int(b.id) || 0).first();
  if (!row) fail(404, 'Sinyal tidak ditemukan');
  if (row.status !== 'open') fail(409, 'Sinyal sudah ditutup');
  const close = Number(b.close_price);
  if (!Number.isFinite(close) || close <= 0) fail(400, 'close_price tidak valid');
  const mk = await getSymbol(env, row.symbol);
  const pips = Math.round(((row.decision === 'BUY' ? close - row.price : row.price - close) / mk.pip) * 10) / 10;
  const t = now();
  const note = str(b.note, 300);
  await env.DB.prepare('UPDATE signals SET status=?, close_price=?, closed_at=?, pips=?, mgmt_note=CASE WHEN ?<>\'\' THEN ? ELSE mgmt_note END WHERE id=?')
    .bind(result, close, t, pips, note, note, row.id).run();
  row.mgmt_note = note;
  const chart = chartB64(b.chart_png);
  await saveChart(env, row.id, 'close', chart);
  let replyTo = null;
  try { replyTo = row.tg_msgs ? JSON.parse(row.tg_msgs) : null; } catch { replyTo = null; }
  waitUntil(tgBroadcast(env, tgCloseText(row, result, close, pips, mk), { photo: chart, replyTo }));
  waitUntil(queueContent(env, 'signal', row.id));
  return json({ ok: true, pips });
});

// ---- Promo videos (TikTok / Reels / Shorts, 9:16). The website queues a job, the builder on the admin PC asks for it,
// gets the data + a script written by Claude, renders the MP4 locally and sends it back to Telegram through here.
async function queueContent(env, kind, refId = 0) {
  const s = await getSettings(env);
  if (s.content_enabled !== '1' || (kind === 'signal' && s.content_on_signal !== '1')) return;
  const dup = await env.DB.prepare('SELECT 1 FROM content_jobs WHERE kind=? AND ref_id=?').bind(kind, refId).first();
  if (kind === 'signal' && dup) return;
  await env.DB.prepare('INSERT INTO content_jobs (created_at, kind, ref_id, lang) VALUES (?,?,?,?)').bind(now(), kind, refId, s.content_lang === 'en' ? 'en' : 'id').run();
}
// Rotating topics for the scheduled videos (admin can add more in Admin > Konten Video)
const CONTENT_TOPICS = [
  'Perkenalan: apa itu Garuda AI dan bagaimana cara kerjanya dari analisis sampai sinyal',
  'Kelebihan AI: bagaimana Claude menggabungkan analisis teknikal dan fundamental dalam satu keputusan',
  'Edukasi: apa itu stop loss dan kenapa setiap sinyal wajib punya stop loss',
  'Kelebihan AI: momentum dipantau tiap 5 menit, lalu dinilai AI dulu, layak entry atau jebakan',
  'Edukasi: arti reward : risk 1 : 1,5 dan kenapa itu penting',
  'Transparansi: kenapa semua sinyal dicatat terbuka, termasuk yang rugi',
  'Edukasi: kenapa risiko 1% per trade membuat akun bertahan lama',
  'Edukasi: cara membaca EMA 20, 50 dan 200 untuk melihat tren',
  'Kelebihan AI: AI mencari dan membaca berita sendiri sebelum menganalisis',
  'Edukasi: apa itu support dan resistance',
  'Edukasi: bahaya martingale dan averaging untuk akun trading',
  'Edukasi: apa itu zona demand dan supply',
  'Kelebihan AI: kenapa AI berani bilang TUNGGU dan tidak mengejar harga',
  'Edukasi: false breakout dan sapuan likuiditas, jebakan yang sering terjadi',
  'Edukasi: sesi Asia, London dan New York, kapan emas paling aktif',
  'Edukasi: kenapa data CPI, NFP dan FOMC bisa membuat emas bergerak kencang',
  'Edukasi: hubungan dolar AS dan harga emas',
  'Kelebihan AI: AI memahami karakter tiap pasar, emas berbeda dengan Bitcoin',
  'Edukasi: kenapa RSI terlalu tinggi bukan saat yang tepat untuk mengejar BUY',
  'Psikologi trading: jangan balas dendam setelah loss',
  'Panduan: cara membaca chart analisis Garuda AI (zona, level, skenario)',
  'Edukasi: trading santai dengan risiko terukur, tanpa harus memantau chart seharian',
];
function contentTopics(s) {
  const extra = String(s.content_topics || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  return [...CONTENT_TOPICS, ...extra];
}

// Script writer for videos: a cheap OpenAI-compatible model (Qwen on Alibaba Cloud Model Studio, or DeepSeek) so Claude credit is kept for trading
const aiName = (s) => /deepseek/i.test(s.qwen_base || '') ? 'DeepSeek' : 'Qwen';
async function qwenJson(env, s, system, user) {
  const key = await decrypt(env, s.qwen_key_enc);
  const base = String(s.qwen_base || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1').replace(/\/+$/, '');
  const r = await fetch(base + '/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
    body: JSON.stringify({ model: s.qwen_model || 'qwen-plus', temperature: 0.9, max_tokens: 2500, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) fail(502, aiName(s) + ': ' + ((j.error && (j.error.message || j.error.code)) || r.status));
  const txt = (((j.choices || [])[0] || {}).message || {}).content || '';
  return JSON.parse(txt.replace(/^```(?:json)?\s*|\s*```$/g, ''));
}

async function contentStats(env, days) {
  const t = now();
  const { results } = await env.DB.prepare(`SELECT symbol, COALESCE(SUM(CASE WHEN pips > 0 THEN 1 ELSE 0 END),0) AS wins, COALESCE(SUM(CASE WHEN pips < 0 THEN 1 ELSE 0 END),0) AS losses,
      COALESCE(SUM(pips),0) AS pips FROM signals WHERE decision IN ('BUY','SELL') AND ${DONE_SQL} AND closed_at > ? GROUP BY symbol`).bind(t - days * DAY).all();
  const markets = await allSymbols(env);
  const w = results.reduce((a, r) => a + r.wins, 0), l = results.reduce((a, r) => a + r.losses, 0);
  return { wr: w + l ? Math.round((w / (w + l)) * 100) : null, tp: w, sl: l,
    markets: results.map((r) => ({ symbol: r.symbol, pips: Math.round(r.pips * 10) / 10, wins: r.wins, losses: r.losses,
      pip_label: (markets.find((m) => m.symbol === r.symbol) || {}).pip_label || 'pips' })) };
}
// One JSON call for a feature: 'claude' uses the Claude key (Sonnet, low effort), anything else the cheap model (DeepSeek / Qwen)
async function aiJson(env, s, use, system, user) {
  if (use !== 'claude') return qwenJson(env, s, system, user);
  if (!s.ai_claude_key_enc) fail(400, 'API key Claude belum diatur');
  const key = await decrypt(env, s.ai_claude_key_enc);
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-5-5', max_tokens: 3000, system, output_config: { effort: 'low' },
      messages: [{ role: 'user', content: user }] }) });
  const j = await r.json();
  if (!r.ok) fail(502, 'Claude: ' + ((j.error && j.error.message) || r.status));
  const txt = (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  return JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
}
async function contentScript(env, kind, lang, data) {
  const s = await getSettings(env);
  if (kind === 'edu') return eduScript(env, s, lang, data);
  const L = lang === 'en' ? 'English' : 'Bahasa Indonesia (santai tapi sopan, gaya TikTok)';
  const scenes = kind === 'weekly' ? 'hook, stats, cta' : 'hook, signal, result, stats, cta';
  return aiJson(env, s, s.content_ai, `You write short vertical promo videos (TikTok / Reels / Shorts, about 25 seconds) for Garuda AI, an AI trading-signal service (analysis by Claude AI) at goldhuntergaruda.com. Write in ${L}.
Rules: use only the facts in the data, never invent numbers. Never promise or imply guaranteed profit, never say "pasti untung", "passive income" or similar. Style: friendly, confident, short punchy sentences; the hook creates curiosity about the result; say briefly WHY the AI took the trade (from the reason in the data). Losses are shown honestly: for a stop loss say the loss was limited by the stop loss (risk about 1%) and that every signal is published, wins and losses. Hook max 8 words that make people stop scrolling, total narration about 55-70 words. The cta scene invites people to check every signal and result themselves at goldhuntergaruda.com.
Return JSON only: {"hook": "max 8 words", "scenes": [{"id": "hook|signal|result|stats|cta", "say": "narration, numbers as digits, website spoken as goldhunter garuda dot com", "text": "subtitle, website written goldhuntergaruda.com"}], "caption": "2-4 short lines ending with goldhuntergaruda.com/sinyal and a one-line risk note", "hashtags": "5-8 hashtags"}`,
    `Video type: ${kind}. Scenes in this order: ${scenes}.\nData:\n${JSON.stringify(data)}`);
}
// Educational / introduction video: 3 points about one topic, Garuda AI facts given so nothing is invented
async function eduScript(env, s, lang, data) {
  const L = lang === 'en' ? 'English' : 'Bahasa Indonesia (santai, jelas, gaya TikTok edukatif)';
  return aiJson(env, s, s.content_ai, `You write short educational vertical videos (25-35 seconds, TikTok / Reels / Shorts) for Garuda AI (goldhuntergaruda.com), an AI trading-signal service for gold, Bitcoin and forex. Write in ${L}.
Teach one topic clearly and correctly for beginners. Use only the Garuda AI facts given; never invent results or numbers. Never promise profit, never say "pasti untung" or "passive income". Mention Garuda AI naturally (mostly in the last point and the cta).
Style: the hook must stop the scroll in 2 seconds (pick one: a sharp question, a common mistake, a surprising fact, or "stop doing X"). Speak like a friendly mentor, short punchy sentences, explain every term with an everyday analogy, give one concrete example (e.g. gold at 4,150 bouncing from support). Each point adds something new, no filler, no repeated words. Titles are catchy and readable in one glance.
Return JSON only: {"hook": "max 8 words that stop the scroll", "scenes": [{"id": "hook", "say": "...", "text": "..."}, {"id": "point", "icon": "one emoji", "title": "2-5 words", "say": "1-2 short sentences", "text": "short subtitle"} x3, ${data.chart ? '{"id": "chart", "title": "2-5 words", "say": "1-2 sentences about how the AI chart shows zones / levels", "text": "..."}, ' : ''}{"id": "cta", "say": "invite to follow the channel and check goldhunter garuda dot com", "text": "..."}], "caption": "3-4 short lines ending with goldhuntergaruda.com and a one-line risk note", "hashtags": "5-8 hashtags"}
"say" is read by a voice (website as "goldhunter garuda dot com"), "text" is the subtitle (website written goldhuntergaruda.com). Total narration 70-90 words.`,
    `Topic: ${data.topic}\nGaruda AI facts: ${JSON.stringify(data.facts)}`);
}
const GARUDA_FACTS = ['analysis by Claude AI combining technical (H4/H1/M15 chart, EMA 20/50/200, RSI, ATR, structure) and fundamental (news searched on the web, economic calendar, dollar strength)',
  'markets: gold XAUUSD, Bitcoin BTCUSD, EURUSD, USDJPY', 'routine analysis every hour in active hours + momentum checked every 5 minutes and judged by the AI before any entry',
  'every signal has entry, stop loss and take profit; reward:risk at least 1:1.5; about 1% risk per signal; max 1 position per market; stops for the day at 3% loss; no martingale',
  'every signal and its result (wins and losses) is published at goldhuntergaruda.com/sinyal and on Telegram', 'the AI can answer WAIT when the setup is not clear'];

route('POST', '/builder/content/claim', 'builder', async ({ env }) => {
  const s = await getSettings(env);
  if (s.content_enabled !== '1') return json({ job: null });
  // the script writer must be configured (Qwen by default): jobs simply wait until then, no Claude credit is used
  if (s.content_ai !== 'claude' && !s.qwen_key_enc) return json({ job: null, waiting: 'API key AI konten belum diatur' });
  if (s.content_ai === 'claude' && !s.ai_claude_key_enc) return json({ job: null, waiting: 'API key Claude belum diatur' });
  // scheduled educational videos: at each time of day (WIB) in content_times, the next topic in the rotation
  if (s.content_edu === '1') {
    const dayStart = now() - ((now() + 7 * 3600) % DAY);
    for (const hm of String(s.content_times || '').split(/[,\s]+/).filter((x) => /^\d{1,2}:\d{2}$/.test(x))) {
      const [h, m] = hm.split(':').map(Number);
      const slot = dayStart + h * 3600 + m * 60;
      if (now() < slot || now() - slot > 3 * 3600) continue;
      const done = await env.DB.prepare("SELECT 1 FROM content_jobs WHERE kind='edu' AND created_at >= ?").bind(slot).first();
      if (done) continue;
      const topics = contentTopics(s);
      const idx = (Number(s.content_topic_idx) || 0) % topics.length;
      await env.DB.prepare('INSERT INTO content_jobs (created_at, kind, ref_id, lang, topic) VALUES (?,?,?,?,?)').bind(now(), 'edu', idx, s.content_lang === 'en' ? 'en' : 'id', topics[idx]).run();
      await putSetting(env, 'content_topic_idx', String(idx + 1));
    }
  }
  // weekly recap: Saturday from 10:00 WIB, once per week
  const wib = new Date((now() + 7 * 3600) * 1000);
  if (s.content_weekly === '1' && wib.getUTCDay() === 6 && wib.getUTCHours() >= 10) {
    const last = await env.DB.prepare("SELECT MAX(created_at) AS t FROM content_jobs WHERE kind='weekly'").first();
    if (!last.t || now() - last.t > 5 * DAY) await queueContent(env, 'weekly', 0);
  }
  await env.DB.prepare("UPDATE content_jobs SET status='queued' WHERE status='rendering' AND created_at < ?").bind(now() - 3600).run();
  const job = await env.DB.prepare("SELECT * FROM content_jobs WHERE status='queued' ORDER BY id LIMIT 1").first();
  if (!job) return json({ job: null });
  await env.DB.prepare("UPDATE content_jobs SET status='rendering' WHERE id=?").bind(job.id).run();
  try {
    const out = { id: job.id, kind: job.kind, lang: job.lang, voice: job.lang === 'en' ? 'en-US-AndrewNeural' : (s.content_voice || 'id-ID-ArdiNeural'),
      send_telegram: s.content_tg === '1', send_social: Object.entries(socialReady(s)).filter(([k, ok]) => ok && s['content_' + k] === '1').map(([k]) => k) };
    const st30 = await contentStats(env, 30);
    const data = { stats_30_days: st30 };
    if (job.kind === 'edu') {
      delete data.stats_30_days;
      data.topic = job.topic;
      data.facts = GARUDA_FACTS;
      const pic = await env.DB.prepare(`SELECT c.data FROM signal_charts c JOIN signals s ON s.id = c.signal_id WHERE c.kind='open' AND s.created_at > ? ORDER BY s.id DESC LIMIT 1`)
        .bind(now() - 3 * DAY).first();
      if (pic) { out.chart_open = pic.data; data.chart = true; }
    } else if (job.kind === 'signal') {
      const r = await env.DB.prepare('SELECT * FROM signals WHERE id=?').bind(job.ref_id).first();
      if (!r || !['TP', 'SL', 'BE', 'CLOSE'].includes(r.status)) fail(404, 'Sinyal belum selesai');
      const m = await getSymbol(env, r.symbol);
      out.signal = { id: r.id, symbol: r.symbol, decision: r.decision, entry: r.price, sl: r.sl, tp: r.tp, close: r.close_price, pips: r.pips,
        pip_label: m.pip_label, digits: m.digits, result: r.status, created_at: r.created_at, closed_at: r.closed_at, confidence: r.confidence };
      const charts = await env.DB.prepare('SELECT kind, data FROM signal_charts WHERE signal_id=?').bind(r.id).all();
      for (const c of charts.results) out['chart_' + c.kind] = c.data;
      data.signal = { ...out.signal, reason: job.lang === 'en' ? (r.reason_en || r.reason) : r.reason, minutes_open: Math.round((r.closed_at - r.created_at) / 60) };
    } else {
      data.stats_7_days = await contentStats(env, 7);
    }
    const st = job.kind === 'weekly' ? data.stats_7_days : st30;
    out.topic = job.topic || '';
    out.stats = { title: job.kind === 'weekly' ? (job.lang === 'en' ? 'THIS WEEK' : 'HASIL MINGGU INI') : (job.lang === 'en' ? '30-DAY TRACK RECORD' : 'TRACK RECORD 30 HARI'),
      wr30: st.wr, tp30: st.tp, sl30: st.sl, markets: st.markets.map((x) => ({ symbol: x.symbol, pips30: x.pips, pip_label: x.pip_label })) };
    let script = job.script ? JSON.parse(job.script) : null;
    if (!script) {
      script = await contentScript(env, job.kind, job.lang, data);
      const caption = `${script.caption}\n\n${script.hashtags}`;
      await env.DB.prepare('UPDATE content_jobs SET script=?, caption=? WHERE id=?').bind(JSON.stringify(script), caption, job.id).run();
    }
    out.script = script;
    out.caption = `${script.caption}\n\n${script.hashtags}`;
    return json({ job: out });
  } catch (e) {
    await env.DB.prepare("UPDATE content_jobs SET status='failed', error=? WHERE id=?").bind(str(e.message || e, 300), job.id).run();
    return json({ job: null, error: String(e.message || e) });
  }
});
route('POST', '/builder/content/:id/done', 'builder', async ({ request, env, params }) => {
  const b = await readJson(request);
  await env.DB.prepare('UPDATE content_jobs SET status=?, error=?, file_name=?, duration=?, size=?, rendered_at=? WHERE id=?')
    .bind(b.ok ? 'done' : 'failed', str(b.error, 300), str(b.file_name, 200), Number(b.duration) || 0, int(b.size) || 0, now(), int(params.id)).run();
  return json({ ok: true });
});
// The rendered MP4 (raw body) goes straight to the Telegram targets; nothing is stored on the website
route('POST', '/builder/content/:id/telegram', 'builder', async ({ request, env, params }) => {
  const job = await env.DB.prepare('SELECT * FROM content_jobs WHERE id=?').bind(int(params.id)).first();
  if (!job) fail(404, 'Konten tidak ditemukan');
  const c = await tgConfig(env);
  if (!c.on) return json({ ok: false, error: 'Telegram belum aktif' });
  const buf = await request.arrayBuffer();
  if (!buf.byteLength || buf.byteLength > 45 * 1024 * 1024) fail(400, 'Ukuran video tidak valid');
  const cap = esc(job.caption).slice(0, 1000);
  let fileId = '';
  const errs = [];
  for (const t of c.targets) {
    const fd = new FormData();
    fd.append('chat_id', String(t.chat_id));
    fd.append('caption', cap);
    fd.append('parse_mode', 'HTML');
    fd.append('supports_streaming', 'true');
    fd.append('width', '1080');
    fd.append('height', '1920');
    if (job.duration) fd.append('duration', String(Math.round(job.duration)));
    fd.append('video', new Blob([buf], { type: 'video/mp4' }), job.file_name || 'garuda-ai.mp4');
    const r = await (await fetch(`https://api.telegram.org/bot${c.token}/sendVideo`, { method: 'POST', body: fd })).json().catch(() => ({}));
    if (r.ok) fileId = fileId || (r.result.video && r.result.video.file_id) || '';
    else errs.push(`${t.name || t.chat_id}: ${r.description || 'gagal'}`);
  }
  if (fileId) await env.DB.prepare('UPDATE content_jobs SET tg_file_id=? WHERE id=?').bind(fileId, job.id).run();
  return json({ ok: !!fileId, errors: errs });
});
// ------------------------------------------------------------------ social networks: Facebook Page Reels, Instagram Reels, TikTok (draft)
const META_GRAPH = (s) => `https://graph.facebook.com/${/^v\d+\.\d+$/.test(s.meta_ver || '') ? s.meta_ver : 'v23.0'}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function metaCall(s, path, params = {}, method = 'POST') {
  const u = new URL(META_GRAPH(s) + path);
  const opt = { method };
  if (method === 'GET') for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  else opt.body = new URLSearchParams(params);
  const j = await (await fetch(u, opt)).json().catch(() => ({}));
  if (j.error) throw new Error(j.error.error_user_msg || j.error.message || 'Meta error');
  return j;
}
async function metaUpload(uploadUrl, token, buf) {
  const r = await fetch(uploadUrl, { method: 'POST', headers: { authorization: 'OAuth ' + token, offset: '0', file_size: String(buf.byteLength) }, body: buf });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error('upload: ' + ((j.error && (j.error.message || j.error)) || j.debug_info && j.debug_info.message || r.status));
}
async function postFacebook(env, s, buf, caption) {
  const token = await decrypt(env, s.meta_page_token_enc);
  const st = await metaCall(s, `/${s.meta_page_id}/video_reels`, { upload_phase: 'start', access_token: token });
  await metaUpload(st.upload_url || `https://rupload.facebook.com/video-upload/${META_GRAPH(s).split('/').pop()}/${st.video_id}`, token, buf);
  await metaCall(s, `/${s.meta_page_id}/video_reels`, { upload_phase: 'finish', video_id: st.video_id, video_state: 'PUBLISHED', description: caption.slice(0, 2000), access_token: token });
  return st.video_id;
}
async function postInstagram(env, s, buf, caption) {
  const token = await decrypt(env, s.meta_page_token_enc);
  const c = await metaCall(s, `/${s.meta_ig_id}/media`, { media_type: 'REELS', upload_type: 'resumable', caption: caption.slice(0, 2200), share_to_feed: 'true', access_token: token });
  await metaUpload(c.uri, token, buf);
  for (let i = 0; i < 40; i++) {                       // Instagram processes the video before it can be published (usually 10-60 s)
    await sleep(4000);
    const st = await metaCall(s, `/${c.id}`, { fields: 'status_code,status', access_token: token }, 'GET');
    if (st.status_code === 'FINISHED') break;
    if (st.status_code === 'ERROR' || st.status_code === 'EXPIRED') throw new Error('Instagram menolak video: ' + (st.status || st.status_code));
    if (i === 39) throw new Error('Instagram masih memproses video terlalu lama');
  }
  const p = await metaCall(s, `/${s.meta_ig_id}/media_publish`, { creation_id: c.id, access_token: token });
  return p.id;
}
async function tiktokToken(env, s) {
  if (!s.tiktok_refresh_enc) throw new Error('Akun TikTok belum dihubungkan');
  if (s.tiktok_access_enc && Number(s.tiktok_expires) > now() + 300) return decrypt(env, s.tiktok_access_enc);
  const r = await fetch('https://open.tiktokapis.com/v2/oauth/token/', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_key: s.tiktok_client_key, client_secret: await decrypt(env, s.tiktok_client_secret_enc), grant_type: 'refresh_token',
      refresh_token: await decrypt(env, s.tiktok_refresh_enc) }) });
  const j = await r.json().catch(() => ({}));
  if (!j.access_token) throw new Error('TikTok: login kedaluwarsa, hubungkan ulang akun (' + (j.error_description || j.error || r.status) + ')');
  await tiktokSave(env, j);
  return j.access_token;
}
async function tiktokSave(env, j) {
  await putSetting(env, 'tiktok_access_enc', await encrypt(env, j.access_token));
  if (j.refresh_token) await putSetting(env, 'tiktok_refresh_enc', await encrypt(env, j.refresh_token));
  await putSetting(env, 'tiktok_expires', String(now() + (Number(j.expires_in) || 86400)));
  if (j.open_id) await putSetting(env, 'tiktok_open_id', j.open_id);
}
async function postTiktok(env, s, buf) {
  const tok = await tiktokToken(env, s);
  const n = buf.byteLength;
  const r = await fetch('https://open.tiktokapis.com/v2/post/publish/inbox/video/init/', { method: 'POST',
    headers: { authorization: 'Bearer ' + tok, 'content-type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ source_info: { source: 'FILE_UPLOAD', video_size: n, chunk_size: n, total_chunk_count: 1 } }) });
  const j = await r.json().catch(() => ({}));
  if (!j.data || !j.data.upload_url) throw new Error('TikTok: ' + ((j.error && (j.error.message || j.error.code)) || r.status));
  const u = await fetch(j.data.upload_url, { method: 'PUT', headers: { 'content-type': 'video/mp4', 'content-range': `bytes 0-${n - 1}/${n}` }, body: buf });
  if (!u.ok) throw new Error('TikTok upload: ' + u.status);
  return j.data.publish_id;
}
const SOCIAL_NAME = { fb: 'Facebook', ig: 'Instagram', tt: 'TikTok' };
function socialReady(s) {
  return { fb: !!(s.meta_page_id && s.meta_page_token_enc), ig: !!(s.meta_ig_id && s.meta_page_token_enc), tt: !!s.tiktok_refresh_enc };
}
// builder sends the rendered MP4 once per network; the result is kept per job
route('POST', '/builder/content/:id/social/:net', 'builder', async ({ request, env, params }) => {
  const net = params.net;
  if (!SOCIAL_NAME[net]) fail(404, 'Jaringan tidak dikenal');
  const job = await env.DB.prepare('SELECT * FROM content_jobs WHERE id=?').bind(int(params.id)).first();
  if (!job) fail(404, 'Konten tidak ditemukan');
  const s = await getSettings(env);
  if (!socialReady(s)[net]) return json({ ok: false, error: SOCIAL_NAME[net] + ' belum dihubungkan' });
  const buf = await request.arrayBuffer();
  if (!buf.byteLength || buf.byteLength > 95 * 1024 * 1024) fail(400, 'Ukuran video tidak valid');
  const social = JSON.parse(job.social || '{}');
  try {
    const id = net === 'fb' ? await postFacebook(env, s, buf, job.caption || '') : net === 'ig' ? await postInstagram(env, s, buf, job.caption || '') : await postTiktok(env, s, buf);
    social[net] = { ok: true, id: String(id || ''), at: now() };
  } catch (e) {
    social[net] = { ok: false, error: str(e.message || e, 300), at: now() };
  }
  await env.DB.prepare('UPDATE content_jobs SET social=? WHERE id=?').bind(JSON.stringify(social), job.id).run();
  return json({ ok: social[net].ok, error: social[net].error || '' });
});

route('GET', '/admin/social', 'admin', async ({ env, base }) => {
  const s = await getSettings(env);
  const r = socialReady(s);
  return json({ ready: r, content_fb: s.content_fb === '1', content_ig: s.content_ig === '1', content_tt: s.content_tt === '1', content_tg: s.content_tg === '1',
    meta_app_id: s.meta_app_id || '', meta_secret_set: !!s.meta_app_secret_enc, meta_page_id: s.meta_page_id || '', meta_page_name: s.meta_page_name || '',
    meta_ig_id: s.meta_ig_id || '', meta_ig_username: s.meta_ig_username || '', meta_pages: s.meta_pages_list ? JSON.parse(s.meta_pages_list) : [],
    tiktok_client_key: s.tiktok_client_key || '', tiktok_secret_set: !!s.tiktok_client_secret_enc, tiktok_name: s.tiktok_name || '',
    tiktok_redirect: `${base}/api/tiktok/callback`, telegram_public_link: s.telegram_public_link || '' });
});
route('PUT', '/admin/social', 'admin', async ({ request, env }) => {
  const b = await readJson(request);
  for (const k of ['content_fb', 'content_ig', 'content_tt']) if (b[k] !== undefined) await putSetting(env, k, b[k] ? '1' : '0');
  if (b.meta_app_id !== undefined) { if (b.meta_app_id && !/^\d{5,25}$/.test(String(b.meta_app_id).trim())) fail(400, 'App ID Meta berupa angka'); await putSetting(env, 'meta_app_id', String(b.meta_app_id).trim()); }
  if (typeof b.meta_app_secret === 'string' && b.meta_app_secret.trim()) await putSetting(env, 'meta_app_secret_enc', await encrypt(env, b.meta_app_secret.trim()));
  if (b.tiktok_client_key !== undefined) await putSetting(env, 'tiktok_client_key', str(b.tiktok_client_key, 80).trim());
  if (typeof b.tiktok_client_secret === 'string' && b.tiktok_client_secret.trim()) await putSetting(env, 'tiktok_client_secret_enc', await encrypt(env, b.tiktok_client_secret.trim()));
  if (b.telegram_public_link !== undefined) {
    const l = str(b.telegram_public_link, 200).trim();
    if (l && !/^https:\/\/t\.me\/[\w+/-]+$/.test(l)) fail(400, 'Link channel harus seperti https://t.me/namachannel');
    await putSetting(env, 'telegram_public_link', l);
  }
  if (b.disconnect === 'meta') for (const k of ['meta_page_id', 'meta_page_name', 'meta_page_token_enc', 'meta_ig_id', 'meta_ig_username', 'meta_pages_list', 'meta_pages_enc']) await putSetting(env, k, '');
  if (b.disconnect === 'tiktok') for (const k of ['tiktok_access_enc', 'tiktok_refresh_enc', 'tiktok_expires', 'tiktok_open_id', 'tiktok_name']) await putSetting(env, k, '');
  return json({ ok: true });
});
// Meta: short user token from Graph API Explorer -> long-lived token -> the Pages (never-expiring page tokens) + their Instagram accounts
route('POST', '/admin/social/meta-connect', 'admin', async ({ request, env }) => {
  const b = await readJson(request);
  const s = await getSettings(env);
  if (!s.meta_app_id || !s.meta_app_secret_enc) fail(400, 'Isi dan simpan App ID & App Secret dulu');
  const short = str(b.user_token, 600).trim();
  if (!short) fail(400, 'Tempel User Access Token dari Graph API Explorer');
  try {
    const ll = await metaCall(s, '/oauth/access_token', { grant_type: 'fb_exchange_token', client_id: s.meta_app_id,
      client_secret: await decrypt(env, s.meta_app_secret_enc), fb_exchange_token: short }, 'GET');
    const pages = await metaCall(s, '/me/accounts', { fields: 'id,name,access_token,instagram_business_account{id,username}', limit: '50', access_token: ll.access_token }, 'GET');
    const list = (pages.data || []).map((p) => ({ id: p.id, name: p.name, token: p.access_token, ig_id: p.instagram_business_account ? p.instagram_business_account.id : '',
      ig_username: p.instagram_business_account ? p.instagram_business_account.username : '' }));
    if (!list.length) fail(400, 'Token tidak punya akses ke Halaman Facebook mana pun. Saat Generate Access Token, centang Halaman Anda dan izin pages_*');
    await putSetting(env, 'meta_pages_enc', await encrypt(env, JSON.stringify(list)));
    await putSetting(env, 'meta_pages_list', JSON.stringify(list.map(({ token, ...x }) => x)));
    if (list.length === 1) await metaSelect(env, list[0]);
    return json({ ok: true, pages: list.map(({ token, ...x }) => x), selected: list.length === 1 ? list[0].id : '' });
  } catch (e) { if (e instanceof HttpError) throw e; fail(400, 'Meta: ' + e.message); }
});
async function metaSelect(env, p) {
  await putSetting(env, 'meta_page_id', p.id);
  await putSetting(env, 'meta_page_name', p.name);
  await putSetting(env, 'meta_page_token_enc', await encrypt(env, p.token));
  await putSetting(env, 'meta_ig_id', p.ig_id || '');
  await putSetting(env, 'meta_ig_username', p.ig_username || '');
}
route('POST', '/admin/social/meta-select', 'admin', async ({ request, env }) => {
  const b = await readJson(request);
  const s = await getSettings(env);
  const list = s.meta_pages_enc ? JSON.parse(await decrypt(env, s.meta_pages_enc)) : [];
  const p = list.find((x) => x.id === String(b.page_id));
  if (!p) fail(404, 'Halaman tidak ditemukan, hubungkan ulang');
  await metaSelect(env, p);
  return json({ ok: true });
});
// TikTok Login Kit: admin opens the authorize URL, TikTok returns to /api/tiktok/callback
route('POST', '/admin/social/tiktok-auth', 'admin', async ({ env, base }) => {
  const s = await getSettings(env);
  if (!s.tiktok_client_key || !s.tiktok_client_secret_enc) fail(400, 'Isi dan simpan Client Key & Client Secret TikTok dulu');
  const state = b64url(crypto.getRandomValues(new Uint8Array(18)));
  await putSetting(env, 'tiktok_state', `${state}:${now() + 900}`);
  const u = new URL('https://www.tiktok.com/v2/auth/authorize/');
  u.search = new URLSearchParams({ client_key: s.tiktok_client_key, scope: 'user.info.basic,video.upload', response_type: 'code', redirect_uri: `${base}/api/tiktok/callback`, state }).toString();
  return json({ url: u.toString() });
});
route('GET', '/tiktok/callback', 'public', async ({ env, url, base }) => {
  const s = await getSettings(env);
  const back = (msg) => new Response(null, { status: 302, headers: { location: `${base}/admin#/sosmed/${encodeURIComponent(msg)}` } });
  const [st, exp] = String(s.tiktok_state || '').split(':');
  if (!st || url.searchParams.get('state') !== st || now() > Number(exp)) return back('Sesi login TikTok tidak valid, coba lagi');
  await putSetting(env, 'tiktok_state', '');
  if (url.searchParams.get('error')) return back('TikTok: ' + (url.searchParams.get('error_description') || url.searchParams.get('error')));
  const r = await fetch('https://open.tiktokapis.com/v2/oauth/token/', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_key: s.tiktok_client_key, client_secret: await decrypt(env, s.tiktok_client_secret_enc), code: url.searchParams.get('code') || '',
      grant_type: 'authorization_code', redirect_uri: `${base}/api/tiktok/callback` }) });
  const j = await r.json().catch(() => ({}));
  if (!j.access_token) return back('TikTok: ' + (j.error_description || j.error || 'gagal login'));
  await tiktokSave(env, j);
  const me = await (await fetch('https://open.tiktokapis.com/v2/user/info/?fields=display_name,username', { headers: { authorization: 'Bearer ' + j.access_token } })).json().catch(() => ({}));
  const u = (me.data && me.data.user) || {};
  await putSetting(env, 'tiktok_name', u.username ? '@' + u.username : (u.display_name || 'terhubung'));
  return back('ok');
});
route('GET', '/admin/content', 'admin', async ({ env }) => {
  const s = await getSettings(env);
  const { results } = await env.DB.prepare(`SELECT c.id, c.created_at, c.kind, c.ref_id, c.lang, c.status, c.caption, c.error, c.file_name, c.duration, c.size, c.rendered_at, c.topic,
      c.tg_file_id <> '' AS on_telegram, c.social, s.symbol, s.decision, s.pips, s.status AS result FROM content_jobs c LEFT JOIN signals s ON s.id = c.ref_id AND c.kind = 'signal'
      ORDER BY c.id DESC LIMIT 60`).all();
  const { results: closed } = await env.DB.prepare(`SELECT id, symbol, decision, pips, status, closed_at FROM signals WHERE decision IN ('BUY','SELL') AND ${DONE_SQL}
      ORDER BY id DESC LIMIT 20`).all();
  const bs = (() => { try { return JSON.parse(s.builder_seen || '{}'); } catch { return {}; } })();
  return json({ jobs: results, closed, builder_seen: bs.at || 0,
    settings: { content_enabled: s.content_enabled, content_on_signal: s.content_on_signal, content_weekly: s.content_weekly, content_lang: s.content_lang,
      content_voice: s.content_voice, content_tg: s.content_tg, content_edu: s.content_edu, content_times: s.content_times || '', content_topics: s.content_topics || '',
      content_ai: s.content_ai || 'qwen', qwen_base: s.qwen_base || '', qwen_model: s.qwen_model || 'qwen-plus', qwen_key_set: !!s.qwen_key_enc },
    topics: contentTopics(s), next_topic: (Number(s.content_topic_idx) || 0) % contentTopics(s).length });
});
// Test the Qwen connection with the saved key / model
route('POST', '/admin/content/qwen-test', 'admin', async ({ env }) => {
  const s = await getSettings(env);
  if (!s.qwen_key_enc) fail(400, 'API key ' + aiName(s) + ' belum disimpan');
  const t0 = Date.now();
  const j = await qwenJson(env, s, 'Return JSON only.', 'Return {"ok": true, "text": "Garuda AI siap"}');
  return json({ ok: true, ms: Date.now() - t0, text: j.text || JSON.stringify(j), model: s.qwen_model || 'qwen-plus', provider: aiName(s) });
});
route('POST', '/admin/content', 'admin', async ({ request, env }) => {
  const b = await readJson(request);
  if (b.kind === 'edu') {
    const s = await getSettings(env);
    const topics = contentTopics(s);
    const topic = str(b.topic, 300) || topics[(Number(s.content_topic_idx) || 0) % topics.length];
    await env.DB.prepare('INSERT INTO content_jobs (created_at, kind, ref_id, lang, topic) VALUES (?,?,0,?,?)').bind(now(), 'edu', b.lang === 'en' ? 'en' : 'id', topic).run();
    if (!b.topic) await putSetting(env, 'content_topic_idx', String((Number(s.content_topic_idx) || 0) + 1));
    return json({ ok: true });
  }
  if (b.kind === 'weekly') await env.DB.prepare('INSERT INTO content_jobs (created_at, kind, ref_id, lang) VALUES (?,?,0,?)').bind(now(), 'weekly', b.lang === 'en' ? 'en' : 'id').run();
  else if (b.kind === 'signal' && int(b.ref_id)) await env.DB.prepare('INSERT INTO content_jobs (created_at, kind, ref_id, lang) VALUES (?,?,?,?)').bind(now(), 'signal', int(b.ref_id), b.lang === 'en' ? 'en' : 'id').run();
  else if (b.retry && int(b.retry)) await env.DB.prepare("UPDATE content_jobs SET status='queued', error='' WHERE id=?").bind(int(b.retry)).run();
  else fail(400, 'Permintaan tidak dikenal');
  return json({ ok: true });
});
route('PUT', '/admin/content/settings', 'admin', async ({ request, env }) => {
  const b = await readJson(request);
  for (const k of ['content_enabled', 'content_on_signal', 'content_weekly', 'content_tg', 'content_edu']) if (b[k] !== undefined) await putSetting(env, k, b[k] ? '1' : '0');
  if (b.content_times !== undefined) {
    const t = String(b.content_times).split(/[,\s]+/).filter(Boolean);
    if (t.some((x) => !/^([01]?\d|2[0-3]):[0-5]\d$/.test(x))) fail(400, 'Jam harus format HH:MM, pisahkan koma (contoh 12:00, 19:00)');
    await putSetting(env, 'content_times', t.join(', '));
  }
  if (b.content_topics !== undefined) await putSetting(env, 'content_topics', str(b.content_topics, 6000));
  if (b.content_ai) await putSetting(env, 'content_ai', b.content_ai === 'claude' ? 'claude' : 'qwen');
  if (b.qwen_model) await putSetting(env, 'qwen_model', str(b.qwen_model, 60));
  if (b.qwen_base) { if (!/^https:\/\/[a-z0-9.-]+(\/[\w/.-]*)?$/i.test(b.qwen_base)) fail(400, 'Alamat API tidak valid'); await putSetting(env, 'qwen_base', str(b.qwen_base, 200)); }
  if (typeof b.qwen_key === 'string' && b.qwen_key.trim()) await putSetting(env, 'qwen_key_enc', await encrypt(env, b.qwen_key.trim()));
  if (b.content_lang) await putSetting(env, 'content_lang', b.content_lang === 'en' ? 'en' : 'id');
  if (b.content_voice && /^[a-z]{2}-[A-Z]{2}-[A-Za-z]+Neural$/.test(b.content_voice)) await putSetting(env, 'content_voice', b.content_voice);
  return json({ ok: true });
});
// download a rendered video back from Telegram (no storage on the website)
route('GET', '/admin/content/:id/video', 'admin', async ({ env, params }) => {
  const job = await env.DB.prepare('SELECT file_name, tg_file_id FROM content_jobs WHERE id=?').bind(int(params.id)).first();
  if (!job || !job.tg_file_id) fail(404, 'Video tidak ada di Telegram; ambil dari folder Konten di PC builder');
  const c = await tgConfig(env);
  const f = await (await fetch(`https://api.telegram.org/bot${c.token}/getFile?file_id=${encodeURIComponent(job.tg_file_id)}`)).json();
  if (!f.ok) fail(502, 'Telegram: ' + (f.description || 'gagal'));
  const v = await fetch(`https://api.telegram.org/file/bot${c.token}/${f.result.file_path}`);
  return new Response(v.body, { headers: { 'content-type': 'video/mp4', 'content-disposition': `attachment; filename="${job.file_name || 'garuda-ai.mp4'}"`, 'cache-control': 'private, no-store' } });
});

// Chart picture of a signal. While the signal is still running only logged-in users may see it (it shows the levels).
route('GET', '/signal/:id/chart', 'public', async ({ env, params, url, user }) => {
  const id = int(params.id) || 0;
  const kind = url.searchParams.get('kind') === 'close' ? 'close' : 'open';
  const sig = await env.DB.prepare('SELECT status FROM signals WHERE id=?').bind(id).first();
  if (!sig) fail(404, 'Sinyal tidak ditemukan');
  if (isLive(sig.status) && !user) fail(403, 'Chart sinyal yang masih berjalan khusus member');
  const c = await env.DB.prepare('SELECT mime, data FROM signal_charts WHERE signal_id=? AND kind=?').bind(id, kind).first();
  if (!c) fail(404, 'Chart tidak ada');
  return new Response(unb64(c.data), { headers: { 'content-type': c.mime, 'cache-control': isLive(sig.status) ? 'private, max-age=60' : 'public, max-age=86400' } });
});

// Public page /sinyal: BUY/SELL signals with their outcome. Entry/SL/TP of a still-running signal are shown to
// logged-in users only, so the page works as a track record without giving the live trade away.
route('GET', '/signal/feed', 'public', async ({ env, url, user }) => {
  const limit = Math.max(1, Math.min(int(url.searchParams.get('limit')) || 50, 200));
  const sym = url.searchParams.get('symbol') ? canonSymbol(url.searchParams.get('symbol')) : '';
  const w = sym ? ' AND symbol=?' : '';
  const a = sym ? [sym] : [];
  const t = now();
  const [{ results }, last, stat, markets] = await Promise.all([
    env.DB.prepare(`SELECT s.*, (SELECT COUNT(*) FROM signal_charts c WHERE c.signal_id=s.id AND c.kind='open') AS has_chart,
        (SELECT COUNT(*) FROM signal_charts c WHERE c.signal_id=s.id AND c.kind='close') AS has_close_chart
        FROM signals s WHERE decision IN ('BUY','SELL')${w} ORDER BY id DESC LIMIT ?`).bind(...a, limit).all(),
    env.DB.prepare(`SELECT id, symbol, decision, created_at, reason, news, reason_en, news_en, trend_h4, trend_h1, confidence, price, status FROM signals WHERE 1=1${w} ORDER BY id DESC LIMIT 1`).bind(...a).first(),
    env.DB.prepare(`SELECT COUNT(*) AS closed, COALESCE(SUM(CASE WHEN pips > 0 THEN 1 ELSE 0 END),0) AS wins,
        COALESCE(SUM(CASE WHEN pips < 0 THEN 1 ELSE 0 END),0) AS losses, COALESCE(SUM(pips),0) AS pips
        FROM signals WHERE decision IN ('BUY','SELL') AND ${DONE_SQL} AND closed_at > ?${w}`).bind(t - 30 * DAY, ...a).first(),
    allSymbols(env),
  ]);
  // win rate per market: last 30 days and all time (closed BUY/SELL signals only)
  const { results: perMk } = await env.DB.prepare(`SELECT symbol,
      COUNT(*) AS closed, COALESCE(SUM(CASE WHEN pips > 0 THEN 1 ELSE 0 END),0) AS wins, COALESCE(SUM(CASE WHEN pips < 0 THEN 1 ELSE 0 END),0) AS losses,
      COALESCE(SUM(pips),0) AS pips,
      COALESCE(SUM(CASE WHEN closed_at > ? THEN 1 ELSE 0 END),0) AS closed30,
      COALESCE(SUM(CASE WHEN closed_at > ? AND pips > 0 THEN 1 ELSE 0 END),0) AS wins30,
      COALESCE(SUM(CASE WHEN closed_at > ? AND pips < 0 THEN 1 ELSE 0 END),0) AS losses30,
      COALESCE(SUM(CASE WHEN closed_at > ? THEN pips ELSE 0 END),0) AS pips30,
      MIN(created_at) AS since
      FROM signals WHERE decision IN ('BUY','SELL') AND ${DONE_SQL} GROUP BY symbol`).bind(t - 30 * DAY, t - 30 * DAY, t - 30 * DAY, t - 30 * DAY).all();
  const member = !!user;
  const signals = results.map((r) => {
    const v = { ...signalView(r), has_chart: !!r.has_chart, has_close_chart: !!r.has_close_chart };
    if (isLive(r.status) && !member) { v.price = null; v.sl = null; v.tp = null; v.reason = ''; v.news = ''; v.reason_en = ''; v.news_en = ''; v.locked = true; v.has_chart = false; }
    return v;
  });
  const openHidden = (x) => x.decision !== 'WAIT' && !member && isLive(x.status);
  const lastView = last ? { ...last, reason: openHidden(last) ? '' : last.reason, reason_en: openHidden(last) ? '' : last.reason_en } : null;   // news is public context
  // latest analysis of every market + its newest WAIT picture (last 24 h) for the live cards on /sinyal
  const { results: lastRows } = await env.DB.prepare(`SELECT id, symbol, decision, created_at, valid_until, reason, news, reason_en, news_en, trend_h4, trend_h1, confidence, status,
      order_type, price, sl, tp, sl_now, be_at, pend_fail, (SELECT COUNT(*) FROM signal_charts c WHERE c.signal_id = signals.id AND c.kind = 'open') AS has_chart FROM signals
      WHERE id IN (SELECT MAX(id) FROM signals WHERE COALESCE(tag, '') <> 'SCALP' GROUP BY symbol)`).all();
  const { results: waitPics } = await env.DB.prepare(`SELECT s.symbol, MAX(s.id) AS id, MAX(s.created_at) AS at FROM signals s
      JOIN signal_charts c ON c.signal_id = s.id AND c.kind = 'open' WHERE s.decision = 'WAIT' AND s.created_at > ? GROUP BY s.symbol`).bind(t - DAY).all();
  // a running position (then a waiting pending order) is shown instead of a later WAIT analysis of that market
  const { results: liveRows } = await env.DB.prepare(`SELECT id, symbol, decision, created_at, valid_until, reason, news, reason_en, news_en, trend_h4, trend_h1, confidence, status,
      order_type, price, sl, tp, sl_now, be_at, tag, (SELECT COUNT(*) FROM signal_charts c WHERE c.signal_id = signals.id AND c.kind = 'open') AS has_chart FROM signals
      WHERE decision IN ('BUY','SELL') AND status IN ('open','pending') AND created_at > ? ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, id DESC`).bind(t - 3 * DAY).all();
  const scalpBy = {};
  for (const lr of liveRows) if (lr.tag === 'SCALP' && lr.status === 'open' && !scalpBy[lr.symbol]) scalpBy[lr.symbol] = lr;
  for (const lr of liveRows.filter((x) => x.tag !== 'SCALP')) {
    const k = lastRows.findIndex((x) => x.symbol === lr.symbol);
    if (k >= 0 && lastRows[k].id !== lr.id && !(lastRows[k].status === 'open' && lr.status === 'pending')) lastRows[k] = lr;
    else if (k < 0) lastRows.push(lr);
  }
  const enabledSyms = new Set(markets.filter((m) => m.enabled).map((m) => m.symbol));
  const lastByMarket = lastRows.filter((x) => enabledSyms.has(x.symbol)).map((x) => {
    const pic = waitPics.find((p) => p.symbol === x.symbol);
    const hide = openHidden(x);
    const sc = scalpBy[x.symbol];
    const scalp = sc ? { id: sc.id, decision: sc.decision, created_at: sc.created_at, locked: !member, price: member ? sc.price : null, sl: member ? sc.sl : null,
      tp: member ? sc.tp : null, sl_now: member ? sc.sl_now || 0 : 0, be_at: sc.be_at || 0 } : null;
    return { ...x, reason: hide ? '' : x.reason, reason_en: hide ? '' : x.reason_en, price: hide ? null : x.price, sl: hide ? null : x.sl, tp: hide ? null : x.tp,
      locked: hide, has_chart: !!x.has_chart, wait_chart: pic ? pic.id : 0, wait_chart_at: pic ? pic.at : 0, scalp };
  });
  return json({ ok: true, server_time: t, member, signals, last: lastView, last_by_market: lastByMarket, stats30: stat, symbol: sym, market_stats: perMk,
    markets: markets.filter((m) => m.enabled).map((m) => { const v = symView(m); delete v.profile; return v; }) });
});

// One signal in full (shareable link /sinyal?s=<id>); a running signal's levels only for logged-in users
route('GET', '/signal/detail/:id', 'public', async ({ env, params, user }) => {
  const r = await env.DB.prepare(`SELECT s.*, (SELECT COUNT(*) FROM signal_charts c WHERE c.signal_id=s.id AND c.kind='open') AS has_chart,
      (SELECT COUNT(*) FROM signal_charts c WHERE c.signal_id=s.id AND c.kind='close') AS has_close_chart FROM signals s WHERE s.id=?`).bind(int(params.id) || 0).first();
  if (!r || r.decision === 'WAIT') fail(404, 'Sinyal tidak ditemukan');
  const v = { ...signalView(r), has_chart: !!r.has_chart, has_close_chart: !!r.has_close_chart };
  if (isLive(r.status) && !user) { v.price = null; v.sl = null; v.tp = null; v.reason = ''; v.news = ''; v.reason_en = ''; v.news_en = ''; v.locked = true; v.has_chart = false; }
  const m = await getSymbol(env, r.symbol);
  return json({ ok: true, member: !!user, signal: v, market: { symbol: m.symbol, digits: m.digits, pip: m.pip, pip_label: m.pip_label } });
});

// ---- Garuda AI master settings (Admin > Garuda AI), fetched by the MASTER EA ----
const AI_MODELS = {
  'claude-fable-5-1': { label: 'Claude Fable 5.1 (paling kuat)', in: 10, out: 50 },
  'claude-opus-5-5': { label: 'Claude Opus 5.5', in: 4, out: 20 },
  'claude-sonnet-5-5': { label: 'Claude Sonnet 5.5 (hemat)', in: 2, out: 10 },
};
const AI_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const AI_KEYS = {               // key: [type, min, max]
  ai_paused: ['bool'], ai_model: ['model'], ai_effort: ['effort'], ai_news: ['bool'], ai_news_effort: ['effort'],
  ai_news_max: ['int', 1, 10], ai_research_every: ['int', 1, 12], ai_web_tool: ['tool'], ai_intermarket: ['bool'], ai_vision: ['bool'], ai_chart: ['bool'],
  ai_session_start: ['int', 0, 23], ai_session_end: ['int', 1, 24], ai_friday_last: ['int', 0, 24],
  ai_interval_min: ['int', 15, 240], ai_level_trigger: ['bool'], ai_momentum: ['bool'], ai_momentum_24h: ['bool'],
  ai_min_conf: ['int', 0, 100], ai_min_rr: ['num', 0.5, 10], ai_min_sl: ['num', 0.5, 200], ai_max_sl: ['num', 1, 500], ai_valid_min: ['int', 1, 60],
  ai_cost_cap: ['num', 0, 1000], ai_master_trade: ['bool'], ai_min_conf_pending: ['int', 0, 100], ai_min_ev: ['num', 0, 3],
  ai_max_trades_day: ['int', 1, 50], ai_max_daily_loss: ['num', 0, 20], ai_news_mode: ['bool'],
};
function aiConfig(s) {
  const out = {};
  for (const [k, [t]] of Object.entries(AI_KEYS)) {
    const v = s[k];
    out[k.slice(3)] = t === 'bool' ? v === '1' : (t === 'int' || t === 'num') ? Number(v) : String(v ?? '');
  }
  const m = AI_MODELS[out.model] || AI_MODELS['claude-fable-5-1'];
  out.price_in = m.in; out.price_out = m.out;
  return out;
}
const signalFilters = (s) => ({ min_conf: Number(s.ai_min_conf || 65), min_rr: Number(s.ai_min_rr || 1.5), min_sl: Number(s.ai_min_sl || 3), max_sl: Number(s.ai_max_sl || 20),
  min_conf_pending: Number(s.ai_min_conf_pending || 55), min_ev: Number(s.ai_min_ev ?? 0.5),
  max_trades_day: Number(s.ai_max_trades_day || 10), max_daily_loss: Number(s.ai_max_daily_loss ?? 3) });

// MASTER EA: all settings incl. the Claude API key (only with the master secret). Also records that the master is alive.
route('GET', '/master/config', 'signal_pub', async ({ env, url }) => {
  const sym = canonSymbol(url.searchParams.get('symbol') || 'XAUUSD');
  // Claude cost of every master today (UTC), so the daily cap covers all markets together
  const t0 = now() - (now() % DAY);
  // independent reads in parallel: the masters give up after a few seconds when D1 round trips are slow
  const [s, m, all, ct] = await Promise.all([
    getSettings(env),
    getSymbol(env, sym),
    allSymbols(env),
    env.DB.prepare('SELECT COALESCE(SUM(cost_usd),0) AS c FROM signals WHERE created_at > ?').bind(t0).first(),
  ]);
  const cfg = aiConfig(s);
  cfg.claude_key = s.ai_claude_key_enc ? await decrypt(env, s.ai_claude_key_enc) : '';
  cfg.market = symView(m);
  cfg.research_role = sym === canonSymbol(s.ai_research_symbol || 'XAUUSD');
  cfg.markets = all.filter((x) => x.enabled).map((x) => x.symbol);
  cfg.cost_today = Number(ct.c) || 0;
  cfg.tg_wait = s.telegram_wait === '1' || s.web_wait_chart !== '0';      // picture also shown on /sinyal
  cfg.tg_wait_hours = Math.max(1, Math.min(Number(s.telegram_wait_hours) || 3, 24));
  const info = `${str(url.searchParams.get('acct'), 30)} · ${str(url.searchParams.get('ver'), 12)} · ${str(url.searchParams.get('status'), 80)}`;
  await Promise.all([
    putSetting(env, 'ai_master_seen', String(now())),
    putSetting(env, 'ai_master_info', `${sym} · ${info}`),
    m.symbol && m.pip ? env.DB.prepare('UPDATE ai_symbols SET master_seen=?, master_info=? WHERE symbol=?').bind(now(), info, sym).run() : null,
  ]);
  return json({ ok: true, server_time: now(), config: cfg });
});

// Shared news research: one master researches once per hour, the other masters reuse it
route('POST', '/master/research', 'signal_pub', async ({ request, env }) => {
  const b = await readJson(request);
  const text = str(b.text, 6000);
  if (!text) fail(400, 'Riset kosong');
  await env.DB.prepare('INSERT INTO ai_research (created_at, symbol, text, cost_usd) VALUES (?,?,?,?)')
    .bind(now(), canonSymbol(b.symbol), text, Number(b.cost_usd) || 0).run();
  await env.DB.prepare('DELETE FROM ai_research WHERE created_at < ?').bind(now() - 30 * DAY).run();
  return json({ ok: true });
});
route('GET', '/master/research', 'signal_pub', async ({ env }) => {
  const r = await env.DB.prepare('SELECT created_at, symbol, text FROM ai_research ORDER BY id DESC LIMIT 1').first();
  const every = Number((await getSettings(env)).ai_research_every) || 1;
  if (!r || now() - r.created_at > (every + 2) * 3600) return json({ ok: true, text: '', created_at: 0 });
  return json({ ok: true, text: r.text, created_at: r.created_at, symbol: r.symbol });
});

route('GET', '/admin/ai', 'admin', async ({ env }) => {
  const s = await getSettings(env);
  const t = now();
  const [recent, stat] = await Promise.all([
    env.DB.prepare('SELECT id, symbol, created_at, decision, confidence, price, sl, tp, status, pips, cost_usd, model FROM signals ORDER BY id DESC LIMIT 25').all(),
    env.DB.prepare(`SELECT COUNT(*) AS analyses, COALESCE(SUM(cost_usd),0) AS cost, COALESCE(SUM(CASE WHEN decision IN ('BUY','SELL') THEN 1 ELSE 0 END),0) AS trades,
        COALESCE(SUM(CASE WHEN pips > 0 THEN 1 ELSE 0 END),0) AS wins, COALESCE(SUM(CASE WHEN pips < 0 THEN 1 ELSE 0 END),0) AS losses, COALESCE(SUM(pips),0) AS pips
        FROM signals WHERE created_at > ?`).bind(t - 30 * DAY).first(),
  ]);
  const today = await env.DB.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(cost_usd),0) AS cost FROM signals WHERE created_at > ?').bind(t - (t % DAY)).first();
  const research = await env.DB.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(cost_usd),0) AS cost FROM ai_research WHERE created_at > ?').bind(t - 30 * DAY).first();
  const { results: perSym } = await env.DB.prepare(`SELECT symbol, COUNT(*) AS analyses, COALESCE(SUM(cost_usd),0) AS cost,
      COALESCE(SUM(CASE WHEN pips > 0 THEN 1 ELSE 0 END),0) AS wins, COALESCE(SUM(CASE WHEN pips < 0 THEN 1 ELSE 0 END),0) AS losses, COALESCE(SUM(pips),0) AS pips
      FROM signals WHERE created_at > ? GROUP BY symbol`).bind(t - 30 * DAY).all();
  const markets = (await allSymbols(env)).map((m) => ({ ...symView(m), master_seen: m.master_seen || 0, master_info: m.master_info || '',
    stats30: perSym.find((x) => x.symbol === m.symbol) || null }));
  return json({
    config: aiConfig(s), key_set: !!s.ai_claude_key_enc, models: AI_MODELS, efforts: AI_EFFORTS,
    master: { seen: Number(s.ai_master_seen || 0), info: s.ai_master_info || '' },
    keys: { master: env.SIGNAL_SECRET || '', client: env.SIGNAL_KEY || '' },
    stats30: stat, today, recent: recent.results, markets, research30: research, research_symbol: s.ai_research_symbol || 'XAUUSD',
    ea: garudaEa(s), ea_master: garudaEa(s, true),
  });
});

route('PUT', '/admin/ai', 'admin', async ({ request, env }) => {
  const b = await readJson(request);
  for (const [k, [t, mn, mx]] of Object.entries(AI_KEYS)) {
    const name = k.slice(3);
    if (b[name] === undefined) continue;
    let v = b[name];
    if (t === 'bool') v = v === true || v === '1' || v === 'on' ? '1' : '0';
    else if (k === 'ai_interval_min') { if (![15, 30, 60, 120, 240].includes(Number(v))) fail(400, 'Interval analisis harus 15, 30, 60, 120 atau 240 menit'); v = String(Number(v)); }
    else if (t === 'int' || t === 'num') {
      const n = Number(v);
      if (!Number.isFinite(n) || n < mn || n > mx) fail(400, `Nilai ${name} harus ${mn} sampai ${mx}`);
      v = String(t === 'int' ? Math.round(n) : n);
    } else if (t === 'model') { if (!AI_MODELS[v]) fail(400, 'Model tidak dikenal'); }
    else if (t === 'effort') { if (!AI_EFFORTS.includes(v)) fail(400, 'Tingkat ketelitian tidak dikenal'); }
    else if (t === 'tool') { if (!['web_search_20260209', 'web_search_20250305'].includes(v)) fail(400, 'Versi tool pencarian tidak dikenal'); }
    await putSetting(env, k, v);
  }
  if (Number(b.min_sl) >= Number(b.max_sl)) fail(400, 'SL minimal harus lebih kecil dari SL maksimal');
  if (typeof b.claude_key === 'string' && b.claude_key.trim()) {
    const key = b.claude_key.trim();
    if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key)) fail(400, 'Format API key Claude tidak valid (diawali sk-ant-)');
    await putSetting(env, 'ai_claude_key_enc', await encrypt(env, key));
  }
  if (b.claude_key_clear) await env.DB.prepare(`DELETE FROM settings WHERE key='ai_claude_key_enc'`).run();
  if (Array.isArray(b.markets)) {
    for (const m of b.markets) {
      const sym = canonSymbol(m.symbol);
      const row = await env.DB.prepare('SELECT symbol FROM ai_symbols WHERE symbol=?').bind(sym).first();
      if (!row) continue;
      const st = int(m.session_start), en = int(m.session_end), mn = Number(m.min_sl), mx = Number(m.max_sl);
      if (!(st >= 0 && st <= 23 && en >= 1 && en <= 24 && st < en)) fail(400, `${sym}: jam sesi tidak valid`);
      if (!(mn > 0 && mx > mn && mx <= 100000)) fail(400, `${sym}: batas SL tidak valid (minimal harus lebih kecil dari maksimal)`);
      await env.DB.prepare('UPDATE ai_symbols SET enabled=?, session_start=?, session_end=?, weekend=?, min_sl=?, max_sl=?, profile=?, scalp=? WHERE symbol=?')
        .bind(m.enabled ? 1 : 0, st, en, m.weekend ? 1 : 0, mn, mx, str(m.profile, 2500), m.scalp ? 1 : 0, sym).run();
    }
  }
  if (b.research_symbol) {
    const sym = canonSymbol(b.research_symbol);
    if (!(await env.DB.prepare('SELECT symbol FROM ai_symbols WHERE symbol=?').bind(sym).first())) fail(400, 'Pasar riset tidak dikenal');
    await putSetting(env, 'ai_research_symbol', sym);
  }
  return json({ ok: true });
});

// Test the Claude connection with the saved key and model (a tiny request)
// ---- EA Garuda AI file: uploaded by the builder on the admin's PC whenever the compiled .ex5 changes ----
function garudaEa(s, master = false) {
  let v = s[master ? 'garuda_ai_master_ea' : 'garuda_ai_ea'];
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = null; } }
  return v && v.file_id ? v : null;
}
route('POST', '/builder/garuda-ai', 'builder', async ({ request, env }) => {
  const b = await readJson(request);
  const data = String(b.data_b64 || '');
  if (!data || data.length > 2.6e6) fail(400, 'File EA kosong atau terlalu besar');
  const bytes = unb64(data);
  const sha = await sha256(data);
  const master = b.variant === 'master';
  const kind = master ? 'garuda_ai_master' : 'garuda_ai';
  const name = `GarudaAI_${master ? 'MASTER' : 'OneShot'}_v${str(b.version, 12).replace(/[^0-9A-Za-z.]/g, '') || 'x'}.ex5`;
  const r = await env.DB.prepare('INSERT INTO files (user_id, kind, name, mime, size, data_b64, created_at) VALUES (NULL, ?, ?, ?, ?, ?, ?)')
    .bind(kind, name, 'application/octet-stream', bytes.length, data, now()).run();
  const id = r.meta.last_row_id;
  await env.DB.prepare('DELETE FROM files WHERE kind=? AND id<>?').bind(kind, id).run();
  await putSetting(env, master ? 'garuda_ai_master_ea' : 'garuda_ai_ea', JSON.stringify({ file_id: id, name, version: str(b.version, 12), size: bytes.length, sha, at: now() }));
  return json({ ok: true, sha });
});
route('GET', '/admin/ai/ea', 'admin', async ({ env, url }) => {
  const master = url.searchParams.get('v') === 'master';
  const e = garudaEa(await getSettings(env), master);
  const f = e ? await env.DB.prepare('SELECT name, data_b64 FROM files WHERE id=? AND kind=?').bind(e.file_id, master ? 'garuda_ai_master' : 'garuda_ai').first() : null;
  if (!f) fail(404, 'File EA Garuda AI belum di-upload builder');
  return new Response(unb64(f.data_b64), { headers: { 'content-type': 'application/octet-stream',
    'content-disposition': `attachment; filename="${f.name}"`, 'cache-control': 'private, no-store' } });
});
// Master key as the file the MASTER EA reads (MT5 data folder > ..\Common\Files). Admin only, never stored
route('GET', '/admin/ai/master-key', 'admin', async ({ env }) => {
  if (!env.SIGNAL_SECRET) fail(400, 'Kunci master belum diatur di server');
  return new Response(env.SIGNAL_SECRET, { headers: { 'content-type': 'text/plain; charset=us-ascii',
    'content-disposition': 'attachment; filename="GarudaAI_master_key.txt"', 'cache-control': 'private, no-store' } });
});
// Ready-made input presets (.set, UTF-16 like MT5 saves them). MASTER carries the master key: keep it private
route('GET', '/admin/ai/preset', 'admin', async ({ env, url }) => {
  const master = url.searchParams.get('mode') === 'master';
  const lines = [
    `; Garuda AI preset ${master ? 'MASTER' : 'CLIENT'} - goldhuntergaruda.com`,
    `InpMode=${master ? 1 : 0}`,
    'InpServerUrl=https://goldhuntergaruda.com',
    `InpSignalKey=${master ? '' : env.SIGNAL_KEY || ''}`,
    `InpSignalSecret=${master ? env.SIGNAL_SECRET || '' : ''}`,
    'InpUseServerFilters=true',
    'InpRiskPct=1.0',
  ];
  const text = '\ufeff' + lines.join('\r\n') + '\r\n';
  const buf = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); buf[i * 2] = c & 255; buf[i * 2 + 1] = c >> 8; }
  return new Response(buf, { headers: { 'content-type': 'application/octet-stream',
    'content-disposition': `attachment; filename="GarudaAI_${master ? 'MASTER' : 'CLIENT'}.set"`, 'cache-control': 'private, no-store' } });
});

route('POST', '/admin/ai/test', 'admin', async ({ env }) => {
  const s = await getSettings(env);
  if (!s.ai_claude_key_enc) fail(400, 'API key Claude belum disimpan');
  const key = await decrypt(env, s.ai_claude_key_enc);
  const model = AI_MODELS[s.ai_model] ? s.ai_model : 'claude-fable-5-1';
  const t0 = Date.now();
  let r, j;
  try {
    r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 2000, output_config: { effort: 'low' },
        messages: [{ role: 'user', content: 'Tes koneksi. Balas hanya dengan: Garuda AI siap.' }] }),
    });
    j = await r.json();
  } catch (e) { fail(502, 'Tidak bisa menghubungi Claude: ' + (e.message || e)); }
  if (!r.ok) fail(400, `Claude menolak (HTTP ${r.status}): ${(j && j.error && j.error.message) || 'cek API key & saldo'}`);
  const text = (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join(' ').trim();
  const u = j.usage || {};
  const m = AI_MODELS[model];
  return json({ ok: true, model: j.model, ms: Date.now() - t0, text, cost_usd: ((u.input_tokens || 0) * m.in + (u.output_tokens || 0) * m.out) / 1e6 });
});

route('GET', '/signal/latest', 'signal_read', async ({ env, url }) => {
  const symbol = canonSymbol(url.searchParams.get('symbol') || 'XAUUSD');      // old clients without ?symbol= follow gold
  let row = await env.DB.prepare('SELECT * FROM signals WHERE symbol=? ORDER BY id DESC LIMIT 1').bind(symbol).first();
  const t = now();
  const m = await getSymbol(env, symbol);
  if (m.scalp && row && row.tag !== 'SCALP' && !['BUY', 'SELL'].includes(row.decision)) {
    const sc = await env.DB.prepare("SELECT * FROM signals WHERE symbol=? AND tag='SCALP' AND decision IN ('BUY','SELL') AND status='open' AND created_at > ? ORDER BY id DESC LIMIT 1")
      .bind(symbol, t - 150).first();
    if (sc) row = sc;
  }
  const st = await getSettings(env);
  const f = signalFilters(st);
  f.min_sl = m.min_sl * m.pip;                 // price units, like the client's own checks
  f.max_sl = m.max_sl * m.pip;
  const trackId = int(url.searchParams.get('track')) || 0;
  const tr = trackId && trackId !== (row && row.id) ? await env.DB.prepare('SELECT * FROM signals WHERE id=? AND symbol=?').bind(trackId, symbol).first() : null;
  return json({ ok: true, server_time: t, symbol, enabled: !!m.enabled, signal: signalView(row) || null, tracked: signalView(tr) || null,
    next: Math.min(nextSignalCheck(t, row, st), trackId ? 60 : 3600, m.scalp ? 40 : 3600), filters: f, market: symView(m) });
});

// ---- Admin: Telegram bot ----
route('POST', '/admin/telegram/test', 'admin', async ({ env }) => {
  const c = await tgConfig(env);
  if (!c.token) fail(400, 'Token bot belum disimpan');
  if (!c.targets.length) fail(400, 'Belum ada target aktif');
  const results = await Promise.all(c.targets.map(async (t) => {
    const r = await tgSend(c.token, t.chat_id, '🦅 <b>GARUDA AI</b>\nTes koneksi berhasil. Sinyal BUY / SELL beserta chart dan hasilnya akan dikirim ke sini.');
    return { name: t.name, chat_id: t.chat_id, ok: r.ok, error: r.error || '' };
  }));
  return json({ ok: true, enabled: c.on, results });
});
// Chats the bot has seen recently (helps the admin find the chat id of a group / channel)
route('POST', '/admin/telegram/chats', 'admin', async ({ env }) => {
  const c = await tgConfig(env);
  if (!c.token) fail(400, 'Token bot belum disimpan');
  const r = await (await fetch(`https://api.telegram.org/bot${c.token}/getUpdates?limit=100&allowed_updates=${encodeURIComponent('["message","channel_post","my_chat_member"]')}`)).json();
  if (!r.ok) fail(400, 'Telegram menolak token: ' + (r.description || ''));
  const me = await (await fetch(`https://api.telegram.org/bot${c.token}/getMe`)).json();
  const chats = {};
  for (const u of r.result || []) {
    const ch = (u.message || u.channel_post || u.my_chat_member || {}).chat;
    if (ch && ch.type !== 'private') chats[ch.id] = { chat_id: String(ch.id), title: ch.title || ch.username || String(ch.id), type: ch.type };
  }
  return json({ ok: true, bot: me.ok ? '@' + me.result.username : '', chats: Object.values(chats) });
});

route('GET', '/admin/signals', 'admin', async ({ env, url }) => {
  const limit = Math.max(1, Math.min(int(url.searchParams.get('limit')) || 100, 500));
  const { results } = await env.DB.prepare('SELECT * FROM signals ORDER BY id DESC LIMIT ?').bind(limit).all();
  const cost = await env.DB.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(cost_usd),0) AS usd FROM signals WHERE created_at > ?').bind(now() - 30 * DAY).first();
  return json({ signals: results.map((r) => ({ ...signalView(r), cost_usd: r.cost_usd, tokens_in: r.tokens_in, tokens_out: r.tokens_out })), last30: cost });
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

route('GET', '/orders/:id', 'member', async ({ env, user, params, waitUntil }) => {
  const o = await env.DB.prepare(`SELECT o.*, p.name AS product_name, p.billing, p.includes_ea, p.includes_vps, p.requires_ib, p.managed_vps, p.kind AS product_kind
      FROM orders o JOIN products p ON p.id=o.product_id WHERE o.id=? AND o.user_id=?`).bind(int(params.id), user.id).first();
  if (!o) fail(404, 'Pesanan tidak ditemukan');
  delete o.trading_pass_enc;
  const s = await getSettings(env);
  return json({ order: { ...o, status_label: orderStatusLabel(o.status) }, banks: activeBanks(s), whatsapp: s.whatsapp || '',
    usdt: await usdtPay(env, s, o.total, waitUntil) });
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
  let sql = LICENSE_SQL.replace('FROM licenses l', 'FROM licenses l LEFT JOIN builds cb ON cb.id = l.current_build_id').replace('SELECT l.*', 'SELECT l.*, cb.file_id AS ea_file_id, cb.status AS ea_build_status') + ' WHERE 1=1';
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
      ea_file_id: l.ea_build_status === 'done' ? l.ea_file_id : null, includes_ea: l.includes_ea,
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
// Signed risk statement of one member (the PDF is generated in the admin's browser, nothing is stored)
route('GET', '/admin/users/:id/consent', 'admin', async ({ env, params }) => {
  const u = await env.DB.prepare('SELECT id, email, name, phone, address, created_at FROM users WHERE id=?').bind(int(params.id) || 0).first();
  if (!u) fail(404, 'Member tidak ditemukan');
  const { results } = await env.DB.prepare(`SELECT c.*, t.text FROM consents c LEFT JOIN legal_texts t ON t.version = c.version AND t.lang = c.lang
      WHERE c.user_id=? ORDER BY c.id`).bind(u.id).all();
  const st = await getSettings(env);
  return json({ user: u, consents: results, site: 'goldhuntergaruda.com', risk_version: RISK_VERSION, risk_text: RISK_TEXT,
    contact: { whatsapp: st.whatsapp || '', email: st.email_from || '' } });
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

const EDITABLE_SETTINGS = ['durations', 'discounts', 'bank_list', 'admin_notify_email', 'whatsapp', 'pay_deadline_hours', 'reminder_days', 'mt4_enabled',
  'ib_brokers', 'auto_complete_ea', 'auto_process_paid', 'welcome_email_password', 'email_provider', 'email_from', 'email_from_name', 'vps_spec',
  'min_capital_usd', 'invoice_days_before', 'auto_rebuild_on_version', 'report_interval_min', 'board_enabled', 'board_name_mode', 'board_landing_top', 'board_stale_days', 'profit_est_enabled', 'profit_est_min_idr', 'profit_est_max_idr', 'profit_est_basis',
  'telegram_enabled', 'telegram_targets', 'telegram_wait', 'telegram_wait_hours', 'usdt_enabled', 'usdt_address',
  'ea_master_key', 'ea_report_hour', 'ea_tg_min_layers', 'ea_offline_min', 'ea_tg_enabled'];
route('GET', '/admin/settings', 'admin', async ({ env }) => {
  const s = await getSettings(env);
  const out = Object.fromEntries(EDITABLE_SETTINGS.map((k) => [k, s[k] ?? '']));
  out.email_api_key_set = !!s.email_api_key_enc;
  out.telegram_bot_token_set = !!s.telegram_bot_token_enc;
  out.usdt_qr_set = !!s.usdt_qr_file_id;
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
    if (k === 'bank_list') {
      if (!Array.isArray(v)) fail(400, 'Daftar rekening tidak valid');
      v = v.map((x) => ({ bank: str(x.bank, 40), number: str(x.number, 40).replace(/[^\d\s-]/g, '').trim(), name: str(x.name, 80), active: x.active !== false }))
        .filter((x) => x.bank || x.number);
      for (const x of v) if (!x.bank || !x.number) fail(400, 'Setiap rekening wajib punya nama bank dan nomor');
    }
    if (k === 'telegram_targets') {
      if (!Array.isArray(v)) fail(400, 'Daftar target Telegram tidak valid');
      v = v.map((x) => ({ name: str(x.name, 60), chat_id: str(x.chat_id, 64).replace(/\s/g, ''), active: x.active !== false })).filter((x) => x.chat_id);
      for (const x of v) if (!/^(-?\d+|@[A-Za-z0-9_]{4,})$/.test(x.chat_id)) fail(400, `Chat ID "${x.chat_id}" tidak valid (angka seperti -1001234567890 atau @namachannel)`);
    }
    if (k === 'usdt_address' && v && !TRC20_RE.test(str(v, 60))) fail(400, 'Alamat USDT TRC20 tidak valid (34 karakter, diawali huruf T)');
    if (k === 'usdt_enabled') v = v === '1' || v === true ? '1' : '0';
    if (k === 'telegram_wait_hours') { const n = Math.round(Number(v)); if (!(n >= 1 && n <= 24)) fail(400, 'Jeda analisis TUNGGU harus 1 sampai 24 jam'); v = String(n); }
    if (k === 'ib_brokers') v = v.map((x) => ({ name: str(x.name, 40), link: str(x.link, 300), active: !!x.active })).filter((x) => x.name);
    if (k === 'email_provider' && !['', 'log', 'resend', 'brevo'].includes(v)) fail(400, 'Penyedia email tidak dikenal');
    if (k === 'email_from' && v && !isEmail(str(v, 120))) fail(400, 'Alamat pengirim email tidak valid');
    await putSetting(env, k, typeof v === 'string' ? v.trim() : v);
  }
  if (typeof b.email_api_key === 'string' && b.email_api_key.trim()) await putSetting(env, 'email_api_key_enc', await encrypt(env, b.email_api_key.trim()));
  if (b.email_api_key_clear) await env.DB.prepare(`DELETE FROM settings WHERE key='email_api_key_enc'`).run();
  if (typeof b.telegram_bot_token === 'string' && b.telegram_bot_token.trim()) {
    const tok = b.telegram_bot_token.trim();
    if (!/^\d+:[A-Za-z0-9_-]{30,}$/.test(tok)) fail(400, 'Format token bot tidak valid (contoh 123456789:AAH...)');
    await putSetting(env, 'telegram_bot_token_enc', await encrypt(env, tok));
  }
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
  waitUntil(eaOfflineCheck(env, s, base).catch((e) => console.error('ea offline', e)));
  let last = 0;
  try { last = JSON.parse(s.daily_last_run || '{}').at || 0; } catch {}
  if (now() - last > 20 * 3600) {
    await putSetting(env, 'daily_last_run', JSON.stringify({ at: now(), running: true }));
    waitUntil(runDaily(env, base).catch((e) => console.error('daily', e)));
  }
  const ea = garudaEa(s), eam = garudaEa(s, true);
  return json({ job: await claimBuild(env, str(b.builder_id, 60) || 'builder', b.versions && typeof b.versions === 'object' ? b.versions : {}),
    garuda_ai_sha: ea ? ea.sha : '', garuda_ai_master_sha: eam ? eam.sha : '' });
});
route('POST', '/builder/result', 'builder', async ({ request, env, base }) => {
  const b = await readJson(request);
  return json(await finishBuild(env, base, {
    id: int(b.id), ok: !!b.ok, log: String(b.log || ''), filename: str(b.filename, 120) || 'GoldHunter_Garuda.ex5',
    data_b64: b.data_b64 || '', ea_version: str(b.ea_version, 20),
  }));
});
route('POST', '/cron/daily', 'cron', async ({ env, base }) => json({ ok: true, result: await runDaily(env, base) }));
