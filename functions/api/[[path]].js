// GoldHunter Garuda API (Cloudflare Pages Functions + D1). All routes live under /api/.
import {
  HttpError, fail, json, readJson, now, DAY, str, int, isEmail, hashPassword, verifyPassword,
  encrypt, decrypt, createSession, destroySession, sessionUser, isAdminEmail, randomToken, sha256,
  siteUrl, esc, rupiah, fmtDate, unb64, b64, b64url, addMonths,
} from '../../server/util.js';
import {
  getSettings, putSetting, quote, notify, emailUser, emailAdmin, newOrderCode, getUser, getProduct,
  processOrder, completeOrder, queueBuild, claimBuild, rebuildAll, finishBuild, runDaily, orderStatusLabel, pickUniqueCode, ensureUniqueCode, createOrder, changeOrderMonths, getUsdIdr, toIdr, boardName, maskAccount, reportInterval, activeBanks,
  TRC20_RE, ensureReportToken, licKey, b64Len, parsePrices, productDurations, durationLabel, trialDays, sharePct, shareDueDays, shareDueFor, NO_UPFRONT,
} from '../../server/logic.js';
import { confirmPaid, gatewayReady, usdtOn, usdtBase, usdtLock, usdtScan, gatewayChannels, gatewayCreate, gatewayCheck, gatewayCallback, gatewayView, paymentsTick } from '../../server/payments.js';
import { PROVIDERS, gwKey, gatewayConfig } from '../../server/gateway/index.js';
import { runShareBilling, shareMaybeExtend } from '../../server/share.js';
import { layout, sendEmail } from '../../server/email.js';
import { reportPng } from '../../server/report-image.js';
import AGENT_PS1 from '../../server/vps/GHG-VPS-Agent.ps1.txt';
import AGENT_BAT from '../../server/vps/Pasang-Agen-VPS.bat.txt';
import INSTALLER_PS1 from '../../server/vps/GHG-Installer.ps1.txt';
// Current agent version, read from the script itself so every release tells older agents to self-update.
const AGENT_VERSION = (AGENT_PS1.match(/\$AgentVersion\s*=\s*'([^']+)'/) || [])[1] || '';
const AGENT_PS1_BODY = '﻿' + AGENT_PS1.replace(/\r?\n/g, '\r\n');
const agentUpdate = { agent_version: AGENT_VERSION, agent_url: '/vps/agent' };
const licAgentUpdate = { agent_version: AGENT_VERSION, agent_url: '/vps/lic/agent' };

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

// ---- Risk warning the member agrees to when signing up. The exact text of every version is archived in
// legal_texts and each acceptance in consents (time, IP, country, browser, language, text hash), so an admin can
// print the signed statement later. Change RISK_VERSION whenever the wording changes.
const RISK_VERSION = 'RW-2026-10-16';
const RISK_TEXT = {
  id: [
    'Saya memahami bahwa trading forex, emas (XAUUSD) dan kripto dengan leverage berisiko sangat tinggi dan dapat menyebabkan kehilangan sebagian atau SELURUH modal saya.',
    'EA GOLD HUNTER GARUDA adalah alat bantu trading otomatis, bukan nasihat investasi, bukan produk investasi, bukan pengelolaan dana, dan TIDAK menjamin profit.',
    'EA bisa mengalami rugi dan drawdown besar. Hasil live, hasil backtest dan contoh perhitungan yang ditampilkan adalah catatan masa lalu atau ilustrasi dan tidak menjamin hasil di masa depan.',
    'Keputusan memakai EA, besar modal, setting, dan seluruh risiko yang timbul sepenuhnya menjadi tanggung jawab saya. GoldHunter Garuda dan admin tidak bertanggung jawab atas kerugian akibat kondisi pasar, broker, VPS, koneksi, maupun penggunaan EA.',
    'GoldHunter Garuda bukan broker dan tidak menerima, menyimpan atau mengelola dana trading saya. Dana saya berada di akun broker atas nama saya sendiri.',
    'Saya hanya memakai dana yang siap saya tanggung risikonya, dan saya menyetujui peringatan risiko ini dengan sadar, tanpa paksaan.',
  ],
  en: [
    'I understand that trading forex, gold (XAUUSD) and crypto with leverage carries a very high risk and can lead to the loss of part or ALL of my capital.',
    'The GOLD HUNTER GARUDA EA is an automated trading tool, not investment advice, not an investment product, not fund management, and it does NOT guarantee profit.',
    'The EA can make losses and deep drawdowns. The live results, backtest results and examples shown are past records or illustrations and do not guarantee future results.',
    'The decision to use the EA, the capital, the settings and all resulting risk are entirely my own responsibility. GoldHunter Garuda and its admin are not liable for losses caused by market conditions, brokers, VPS, connections or the use of the EA.',
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
  await notify(env, userId, 'Selamat datang di GOLD HUNTER GARUDA!', 'Pantau hasil live EA GOLD HUNTER GARUDA di halaman /live, ikuti channel Telegram, dan lihat paket di menu Order.', '#/');
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
  const { results } = await env.DB.prepare(`SELECT id, code, name, kind, billing, includes_ea, includes_vps, requires_ib, managed_vps, price, prices, description, features,
      name_en, description_en, features_en FROM products WHERE active=1 ORDER BY sort, id`).all();
  // rent: one price per duration (prices); other monthly packages: price per month with the global durations / discounts
  const products = results.map((p) => ({ ...p, prices: parsePrices(p), durations: p.billing === 'monthly' ? productDurations(p, s) : [] }));
  return json({
    products, durations: s.durations, discounts: s.discounts, mt4_enabled: s.mt4_enabled === '1', vps_spec: s.vps_spec || '',
    share: { pct: sharePct(s), due_days: shareDueDays(s) }, trial_days: trialDays(s),
    pay: { bank: activeBanks(s).length > 0, usdt: usdtOn(s), usdt_auto: usdtOn(s) && s.usdt_auto !== '0', gateway: gatewayReady(s) },
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
  const last = await env.DB.prepare('SELECT updated_at, started_at FROM ea_stats WHERE license_id=?').bind(l.id).first();
  const since = last && last.started_at ? last.started_at : t;     // track record starts with the first report (admin can reset)
  if (last && t - last.updated_at < 60) return json({ ok: true, throttled: true, next, since });
  const totalOk = int(b.since_used) === since ? 1 : 0;
  const cur = str(b.currency, 8).toUpperCase();
  const wib = new Date((t + 7 * 3600) * 1000).toISOString().slice(0, 10);
  const wibOf = (x) => new Date((x + 7 * 3600) * 1000).toISOString().slice(0, 10);
  // Save writes: the daily history row is refreshed at most every 30 minutes (and at each new day)
  const writeDaily = !last || wibOf(last.updated_at) !== wib || t - last.updated_at >= 1800 || next >= 1800;
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO ea_stats (license_id, login, server, currency, balance, equity, profit_day, profit_week, profit_month, positions, ea_version, updated_at, started_at, total_profit, total_ok)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(license_id) DO UPDATE SET login=excluded.login, server=excluded.server, currency=excluded.currency,
        balance=excluded.balance, equity=excluded.equity, profit_day=excluded.profit_day, profit_week=excluded.profit_week, profit_month=excluded.profit_month,
        positions=excluded.positions, ea_version=excluded.ea_version, updated_at=excluded.updated_at,
        started_at=CASE WHEN started_at > 0 THEN started_at ELSE excluded.started_at END,
        total_profit=CASE WHEN excluded.total_ok=1 THEN excluded.total_profit ELSE total_profit END, total_ok=CASE WHEN excluded.total_ok=1 THEN 1 ELSE total_ok END`)
      .bind(l.id, str(b.login, 20), str(b.server, 80), cur, num(b.balance), num(b.equity), num(b.day), num(b.week), num(b.month), int(b.positions) || 0, str(b.version, 20), t,
        since, num(b.total), totalOk),
    env.DB.prepare(`INSERT INTO ea_stats_daily (license_id, day, profit, balance, currency) VALUES (?,?,?,?,?)
        ON CONFLICT(license_id, day) DO UPDATE SET profit=excluded.profit, balance=excluded.balance, currency=excluded.currency`)
      .bind(l.id, wib, num(b.day), num(b.balance), cur),
  ].slice(0, writeDaily ? 2 : 1));
  return json({ ok: true, next, since });
});

// ======================= GOLD HUNTER GARUDA LIVE (one row per EA chart -> website & Telegram) =======================
// Every chart running the EA with input 13.2 = ea_master_key is one EA instance (table ea_setups), keyed by
// account login + pair + magic number. The EA posts a snapshot every minute plus the events since the last post.
// The reply carries `since` (start of the instance's track record, editable by the admin); the EA answers with the
// closed profit since then, so modal = balance - closed profit of the account since `since` (deposits count as
// capital), or the EA's budget (input 4.0) when set. Telegram gets reports and warnings.
const eaNum = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; };
const eaPx = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100000) / 100000 : 0; };
const wibDay = (t) => new Date((t + 7 * 3600) * 1000).toISOString().slice(0, 10);
const wibHour = (t) => new Date((t + 7 * 3600) * 1000).getUTCHours();
const wibDayStart = (t) => t - ((t + 7 * 3600) % 86400);
const wibClock = (t) => { const d = new Date((t + 7 * 3600) * 1000); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} WIB`; };
const wibDate = (t) => { const d = new Date((t + 7 * 3600) * 1000); const m = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']; return `${d.getUTCDate()} ${m[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const eaMoney = (v, cur) => `${Number(v) > 0 ? '+' : (Number(v) < 0 ? '-' : '')}${Math.abs(Number(v) || 0).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${cur ? ' ' + cur : ''}`;
const eaPlain = (v) => Math.abs(Number(v) || 0).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const eaDur = (sec) => { const m = Math.max(0, Math.round(sec / 60)); return m >= 1440 ? `${Math.floor(m / 1440)} hari ${Math.floor((m % 1440) / 60)} jam` : m >= 60 ? `${Math.floor(m / 60)} jam ${m % 60} mnt` : `${m} menit`; };
const EA_LIVE_KEYS = ['ea_master_key', 'ea_report_hour', 'ea_report_every', 'ea_tg_min_layers', 'ea_offline_min', 'ea_tg_enabled', 'ea_tg_events'];
// broker symbol -> plain name: XAUUSDc / XAUUSDm / EURUSD.pro -> XAUUSD / EURUSD, US500c -> US500
const eaSym = (v) => { const x = String(v || '').replace(/[.#_-].*$/, '').replace(/[a-z]+$/, '').toUpperCase(); const m = x.match(/^([A-Z]{6})/); return m ? m[1] : x.slice(0, 12); };
const EA_SYM_NAME = { XAUUSD: 'Emas', BTCUSD: 'Bitcoin', EURUSD: 'EURUSD', USDJPY: 'USDJPY', US500: 'S&P 500' };
const EA_SYM_ORDER = ['XAUUSD', 'USDJPY', 'BTCUSD', 'EURUSD'];
const eaSymTitle = (sym) => `${sym}${EA_SYM_NAME[sym] ? ` (${EA_SYM_NAME[sym]})` : ''}`;
const eaParse = (txt) => { try { return JSON.parse(txt || '{}') || {}; } catch { return {}; } };
// admin label wins, then the EA's own name (input), then the pair
const eaLabel = (r) => r.label || r.setup_name || r.symbol;
// account currency -> US dollar (cent accounts: 100 USC = $1)
const eaUsd = (v, cur) => { if (v == null || !Number.isFinite(Number(v))) return null; const c = String(cur || '').toUpperCase(); if (c === 'USC' || c === 'USX' || c === 'UST' || c === 'CNT') return Math.round(v) / 100; if (c === 'USD') return Math.round(v * 100) / 100; return null; };
function eaCfg(s) {
  return { key: String(s.ea_master_key || '').trim(), hour: Number.isFinite(Number(s.ea_report_hour)) && s.ea_report_hour !== '' ? int(s.ea_report_hour) : 21,
    minLayers: s.ea_tg_min_layers === '' || s.ea_tg_min_layers == null ? 4 : int(s.ea_tg_min_layers), offlineMin: int(s.ea_offline_min) || 5, tg: s.ea_tg_enabled !== '0',
    // Telegram = one picture with every EA's closed profit; text per event (series, warnings, offline) only when switched on
    every: Math.max(0, Math.min(24, int(s.ea_report_every) || 0)), events: s.ea_tg_events === '1' };
}
// ---- Showcase accounts: the public board (/live, landing, member home, /api/live, Telegram picture + messages) shows
// ONLY the EA rows whose account login the admin listed in settings.showcase_logins (and that are visible).
// Empty list = nothing public ("akun live sedang disiapkan"). Filtered here on the server: hidden rows never leave it.
const showcaseLogins = (s) => [...new Set(String(s.showcase_logins || '').split(/[\s,;]+/).map((x) => x.trim()).filter((x) => /^[0-9A-Za-z_-]{1,20}$/.test(x)))];
// SQL condition (+ binds) for the public rows of ea_setups; alias = table alias in joins ('' = no alias)
function eaPublicWhere(s, alias = '') {
  const L = showcaseLogins(s), p = alias ? alias + '.' : '';
  const any = [`${p}showcase=1`];
  if (L.length) any.push(`${p}login IN (${L.map(() => '?').join(',')})`);
  return { sql: `${p}visible=1 AND (${any.join(' OR ')})`, binds: L };
}
// public = visible AND (its account is a showcase account OR this one setup is marked "tayang")
const eaIsPublic = (s, r) => !!r && !!r.visible && (!!r.showcase || showcaseLogins(s).includes(String(r.login)));
async function eaTg(env, cfg, text, base, setupId) {
  if (!cfg.tg) return;
  const link = base ? `\n📈 <a href="${base}/live${setupId ? '?setup=' + setupId : ''}">goldhuntergaruda.com/live</a>` : '';
  try { await tgBroadcast(env, text + link); } catch (e) { console.error('ea telegram', e); }
}
// Public view of one EA instance (no login, no server name).
function eaSetupView(r, t, cfg) {
  const d = eaParse(r.data);
  const total = r.total_ok ? r.total : null;
  // budget mode (EA input 4.0): the EA's own capital is its budget; otherwise the account capital since the start
  const modal = r.modal_override > 0 ? r.modal_override : r.budget > 0 ? r.budget : (r.total_ok ? Math.round((r.balance - r.acct_total) * 100) / 100 : null);
  // capital that the EA's lot sizing stands for: first lot / 0.01 x input 4.3 (e.g. 0.01 per 10,000 -> 10,000)
  const lotCap = d.cfg && Number(d.cfg.lot_capital) > 0 && Number(d.first_lot) > 0 ? Math.round(Number(d.first_lot) / 0.01 * Number(d.cfg.lot_capital)) : null;
  const pctOf = (v) => (v != null && modal > 0 ? Math.round(v / modal * 10000) / 100 : null);
  const side = (x) => (x && x.count ? { count: x.count, lots: x.lots, profit: x.profit } : { count: 0 });
  const floating = ((d.buy && d.buy.profit) || 0) + ((d.sell && d.sell.profit) || 0);
  // record (re)started today / this month: the EA's day / month figures still hold trades from before the start
  const sd = r.since ? wibDay(r.since) : '', td = wibDay(t);
  const dayV = sd === td ? (total == null ? 0 : total) : eaNum(d.day);
  const monV = sd && sd.slice(0, 7) === td.slice(0, 7) && total != null ? total : eaNum(d.month);
  return {
    id: r.id, symbol: r.symbol, broker_symbol: r.broker_symbol, server: r.server || '', connected_at: r.created_at || 0, label: eaLabel(r), setup_name: r.setup_name || '', budget: r.budget || 0,
    modal_kind: r.modal_override > 0 ? 'set' : r.budget > 0 ? 'budget' : 'account', lot_modal: lotCap, lot_modal_usd: eaUsd(lotCap, r.currency),
    budget_usd: r.budget > 0 ? eaUsd(r.budget, r.currency) : null, magic: r.magic, account: maskAccount(r.login), currency: r.currency,
    since: r.since, days: r.since ? Math.max(0, Math.floor((t - r.since) / DAY)) : 0, running: r.since ? t - r.since : 0,
    online: !!r.updated_at && t - r.updated_at <= cfg.offlineMin * 60, at: r.updated_at,
    balance: r.balance, equity: r.equity, modal, total, total_pct: pctOf(total),
    modal_usd: eaUsd(modal, r.currency), total_usd: eaUsd(total, r.currency), balance_usd: eaUsd(r.balance, r.currency),
    day: dayV, week: eaNum(d.week), month: monV, day_pct: pctOf(dayV), month_pct: pctOf(monV),
    day_usd: eaUsd(dayV, r.currency), month_usd: eaUsd(monV, r.currency),
    floating: eaNum(floating), floating_pct: pctOf(floating), max_dd_pct: r.max_dd_pct, min_float: r.min_float, min_float_pct: pctOf(r.min_float), max_layers: r.max_layers,
    version: d.version || '', mode: d.mode || '', status: d.status || '', buy: side(d.buy), sell: side(d.sell),
    tp_pts: d.tp_pts || 0, dist_pts: d.dist_pts || 0, first_lot: d.first_lot || 0, lot_mult: d.lot_mult || 0, reduction_from: d.reduction_from || 0,
    pocket_pct: d.pocket_pct || 0, pocket_layers: d.pocket_layers || 0, cfg: d.cfg && typeof d.cfg === 'object' ? d.cfg : {},
  };
}
const eaSymIdx = (sym) => { const i = EA_SYM_ORDER.indexOf(sym); return i < 0 ? 99 : i; };
// admin order first, then pair (gold, bitcoin, EUR, JPY), then account login
const EA_SETUP_ORDER = (a, b) => (a.sort - b.sort) || (eaSymIdx(a.symbol) - eaSymIdx(b.symbol)) || String(a.login).localeCompare(String(b.login)) || (a.id - b.id);
// No heartbeat for more than x minutes -> one warning per EA; the next heartbeat sends "online again".
// Checked by the public page and the builder poll.
async function eaOfflineCheck(env, s, base) {
  const cfg = eaCfg(s);
  if (!cfg.key) return;
  const t = now();
  const pw = eaPublicWhere(s);
  const { results } = await env.DB.prepare(`SELECT * FROM ea_setups WHERE ${pw.sql} AND offline_state=0 AND updated_at > 0 AND updated_at < ?`).bind(...pw.binds, t - cfg.offlineMin * 60).all();
  if (!results.length) return;
  await env.DB.batch(results.map((r) => env.DB.prepare('UPDATE ea_setups SET offline_state=1 WHERE id=?').bind(r.id)));
  if (!cfg.events) return;
  const lines = results.map((r) => `• ${esc(eaLabel(r))} (akun ${maskAccount(r.login)}): data terakhir ${wibClock(r.updated_at)}, ${eaDur(t - r.updated_at)} lalu`);
  await eaTg(env, cfg, [`🔴 <b>EA GOLD HUNTER GARUDA TIDAK MENGIRIM DATA</b>`, ...lines, 'Cek VPS / MT5 / koneksi internet.'].join('\n'), base);
}
// Claim a once-only job across parallel heartbeats: only the request that changes the value sends.
async function eaClaim(env, key, value) {
  await env.DB.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').bind(key, '').run();
  const r = await env.DB.prepare('UPDATE settings SET value=? WHERE key=? AND value IS NOT ?').bind(String(value), key, String(value)).run();
  return (r.meta && r.meta.changes) === 1;
}
// Data of the picture: every visible EA, closed profit only (today, since start, % of capital).
async function eaReportRows(env, s, t, cfg) {
  const pw = eaPublicWhere(s);
  const [{ results: rows }, { results: ser }] = await Promise.all([
    env.DB.prepare(`SELECT * FROM ea_setups WHERE ${pw.sql}`).bind(...pw.binds).all(),
    env.DB.prepare(`SELECT setup_id, COUNT(*) AS n, COALESCE(SUM(CASE WHEN profit>0 THEN 1 ELSE 0 END),0) AS wins FROM ea_series WHERE closed_at >= ? GROUP BY setup_id`).bind(wibDayStart(t)).all(),
  ]);
  rows.sort(EA_SETUP_ORDER);
  const out = rows.map((r) => {
    const v = eaSetupView(r, t, cfg);
    const sr = ser.find((x) => x.setup_id === r.id) || { n: 0, wins: 0 };
    return { symbol: v.symbol, name: v.setup_name || v.symbol, budget_usd: v.budget_usd, account: v.account, label: v.label, online: v.online, day_usd: v.day_usd, day_pct: v.day_pct, total_usd: v.total_usd, total_pct: v.total_pct, running: v.running, series: sr.n, wins: sr.wins };
  });
  const sum = (k) => Math.round(out.reduce((a, x) => a + (x[k] || 0), 0) * 100) / 100;
  return { rows: out, head: { date: wibDate(t), clock: wibClock(t), total_day_usd: sum('day_usd'), total_usd: sum('total_usd'), online: out.filter((x) => x.online).length, count: out.length } };
}
async function eaSendReport(env, s, t, cfg, base) {
  if (tgHeld(s)) return { ok: false, held: true, error: 'Semua notifikasi Telegram sedang DITAHAN (Media Sosial > Telegram). Matikan "Tahan semua notifikasi Telegram" dulu.' };
  const { rows, head } = await eaReportRows(env, s, t, cfg);
  if (!rows.length) return { ok: false, error: 'Belum ada akun contoh live yang tampil di web (Pengaturan > EA Live > Akun contoh live)' };
  const png = await reportPng(rows, head);
  const caption = [`📊 <b>GOLD HUNTER GARUDA</b> · ${head.date} ${head.clock}`,
    `Profit hari ini ${eaMoney(head.total_day_usd)} USD · sejak mulai ${eaMoney(head.total_usd)} USD`,
    base ? `📈 <a href="${base}/live">goldhuntergaruda.com/live</a>` : ''].filter(Boolean).join('\n');
  const sent = await tgBroadcast(env, caption, { photo: b64(png) });
  return { ok: !!sent && Object.keys(sent).length > 0, targets: sent ? Object.keys(sent).length : 0 };
}
// Picture report: once a day after ea_report_hour (WIB), plus every x hours when ea_report_every > 0.
async function eaDailyReport(env, s, cfg, t, base) {
  if (!cfg.tg || tgHeld(s)) return;
  const day = wibDay(t);
  let due = wibHour(t) >= cfg.hour && s.ea_report_day !== day && await eaClaim(env, 'ea_report_day', day);
  if (!due && cfg.every > 0) {
    const slot = Math.floor(t / (cfg.every * 3600));
    due = String(s.ea_report_slot || '') !== String(slot) && await eaClaim(env, 'ea_report_slot', slot);
  }
  if (due) await eaSendReport(env, s, t, cfg, base);
}

// Key: the master key (owner's own accounts) or a licence key lic.<id>.<token> compiled into a member's EA
// (header x-ea-key, or x-lic-key). A licence key only reports its own account; its rows record the owner and start hidden.
route('POST', '/ea/live', 'public', async ({ request, env, waitUntil, base }) => {
  const s = await getSettings(env);
  const cfg = eaCfg(s);
  const lk = String(request.headers.get('x-lic-key') || '').trim();
  const hk = isLicKey(lk) ? lk : String(request.headers.get('x-ea-key') || '').trim();
  const lic = isLicKey(hk) ? await licAuth(env, hk) : null;
  if (!lic && (!cfg.key || !ctEq(hk, cfg.key))) fail(403, 'Kunci master salah (Admin > Pengaturan > EA Live)');
  const b = await readJson(request);
  const t = now();
  const login = str(b.login, 20);
  if (!login) fail(400, 'Nomor akun kosong');
  if (lic && login !== String(lic.account_number)) fail(403, `Akun ${login} tidak cocok dengan lisensi ini (lisensi untuk akun ${lic.account_number})`);
  const side = (x) => x && typeof x === 'object' && int(x.count) > 0
    ? { count: int(x.count), lots: eaNum(x.lots), avg: eaPx(x.avg), tp: eaPx(x.tp), profit: eaNum(x.profit), next_lot: eaNum(x.next_lot), next_price: eaPx(x.next_price), since: int(x.since) || 0, red_px: eaPx(x.red_px) }
    : { count: 0 };
  const pk = b.pocket && typeof b.pocket === 'object' ? b.pocket : {};
  const nw = b.news && typeof b.news === 'object' ? b.news : {};
  const c = b.cfg && typeof b.cfg === 'object' ? b.cfg : {};
  const cfgSnap = { start_lot: eaNum(c.start_lot), lot_capital: eaNum(c.lot_capital), auto_lot: !!c.auto_lot, max_lot: eaNum(c.max_lot), dist_from: int(c.dist_from) || 0,
    dist_mult: eaNum(c.dist_mult), reentry_pts: int(c.reentry_pts) || 0, new_series: int(c.new_series) || 0, tp_mode: str(c.tp_mode, 8), tp_net: !!c.tp_net,
    reduction: !!c.reduction, reduction_pct: eaNum(c.reduction_pct), pocket: !!c.pocket, pocket_min_loss: eaNum(c.pocket_min_loss), news_mode: str(c.news_mode, 8),
    max_spread: int(c.max_spread) || 0, equity_stop: eaNum(c.equity_stop), point: Number(c.point) || 0, digits: int(c.digits) || 0 };
  const snap = { currency: str(b.currency, 8).toUpperCase(), version: str(b.version, 12), symbol: str(b.symbol, 16), magic: int(b.magic) || 0,
    balance: eaNum(b.balance), equity: eaNum(b.equity), floating: eaNum(b.floating), day: eaNum(b.day), week: eaNum(b.week), month: eaNum(b.month),
    spread: int(b.spread) || 0, margin_level: eaNum(b.margin_level), status: str(b.status, 200), mode: str(b.mode, 12), trend_tf: str(b.trend_tf, 6), trend: int(b.trend) || 0, trend_why: str(b.trend_why, 120),
    tp_pts: int(b.tp_pts) || 0, lot_mult: eaNum(b.lot_mult), dist_pts: int(b.dist_pts) || 0, first_lot: eaNum(b.first_lot), reduction_from: int(b.reduction_from) || 0,
    pocket_pct: eaNum(b.pocket_pct), pocket_layers: int(b.pocket_layers) || 0,
    buy: side(b.buy), sell: side(b.sell), pocket: { saldo: eaNum(pk.saldo), in: eaNum(pk.in), out: eaNum(pk.out), cuts: int(pk.cuts) || 0 },
    news: { name: str(nw.name, 80), time: int(nw.time) || 0, active: !!nw.active, mode: str(nw.mode, 8) }, cfg: cfgSnap,
    pause: { buy: !!(b.pause && b.pause.buy), sell: !!(b.pause && b.pause.sell) } };
  const sym = eaSym(snap.symbol);
  const budget = Math.max(0, eaNum(b.budget));
  const setupName = str(b.setup, 40);
  snap.budget = budget;
  snap.setup = setupName;
  // member EAs (licence key) start hidden from the public board; the admin can show them in Pengaturan > EA Live
  await env.DB.prepare(`INSERT INTO ea_setups (login, symbol, magic, broker_symbol, server, currency, setup_name, budget, since, created_at, updated_at, license_id, user_id, visible)
      VALUES (?,?,?,?,?,?,?,?,?,?,0,?,?,?) ON CONFLICT(login, symbol, magic) DO NOTHING`)
    .bind(login, sym, snap.magic, snap.symbol, str(b.server, 60), snap.currency, setupName, budget, t, t, lic ? lic.id : null, lic ? lic.user_id : null, lic ? 0 : 1).run();
  const row = await env.DB.prepare('SELECT * FROM ea_setups WHERE login=? AND symbol=? AND magic=?').bind(login, sym, snap.magic).first();
  // default start = the EA's first own deal on this account (not the first report), unless the admin set a date
  // sharing profit licences: never before the licence itself (profit made before it is not billed)
  const ownStart0 = int(b.own_start_utc);
  const ownStart = ownStart0 > 1e9 && lic && lic.product_kind === 'ea_share' ? Math.max(ownStart0, lic.created_at || 0) : ownStart0;
  if (!row.since_manual && ownStart > 1e9 && ownStart < t && ownStart < row.since - 60) {
    await env.DB.batch([
      env.DB.prepare('UPDATE ea_setups SET since=?, total=0, acct_total=0, total_ok=0, deal_cur=-1 WHERE id=?').bind(ownStart, row.id),
      env.DB.prepare('DELETE FROM ea_setup_deals WHERE setup_id=?').bind(row.id),
    ]);
    row.since = ownStart;
    row.deal_cur = -1;
  }
  const totalOk = row.since > 0 && int(b.since_used) === row.since ? 1 : 0;
  const day = wibDay(t);
  const symFloat = (snap.buy.profit || 0) + (snap.sell.profit || 0);
  const layers = Math.max(snap.buy.count || 0, snap.sell.count || 0);
  // drawdown: the EA's own peak-to-trough max DD of the account equity (deposits excluded, EA v2.95+);
  // older EAs: the EA's baskets vs its budget, or the whole account vs the balance at this moment
  const ddEa = b.dd_max != null && Number.isFinite(Number(b.dd_max)) ? Math.max(0, Number(b.dd_max)) : null;
  const dd = ddEa != null && parseFloat(String(b.version || '0')) >= 2.95 ? Math.round(ddEa * 100) / 100
    : budget > 0 ? Math.round(Math.max(0, -symFloat) / budget * 10000) / 100
    : snap.balance > 0 ? Math.round(Math.max(0, (snap.balance - snap.equity) / snap.balance * 100) * 100) / 100 : 0;
  await env.DB.batch([
    env.DB.prepare(`UPDATE ea_setups SET broker_symbol=?, server=?, currency=?, setup_name=?, budget=?, balance=?, equity=?, updated_at=?, data=?, offline_state=0,
        total=CASE WHEN ?=1 THEN ? ELSE total END, acct_total=CASE WHEN ?=1 THEN ? ELSE acct_total END, total_ok=CASE WHEN ?=1 THEN 1 ELSE total_ok END,
        max_dd_pct=MAX(max_dd_pct, ?), min_float=MIN(min_float, ?), max_layers=MAX(max_layers, ?),
        license_id=COALESCE(?, license_id), user_id=COALESCE(?, user_id) WHERE id=?`)
      .bind(snap.symbol, str(b.server, 60), snap.currency, setupName, budget, snap.balance, snap.equity, t, JSON.stringify(snap),
        totalOk, eaNum(b.total), totalOk, eaNum(b.acct_total), totalOk, dd, symFloat, layers, lic ? lic.id : null, lic ? lic.user_id : null, row.id),
    // total_end = the EA's cumulative closed profit since `since` at the last heartbeat of the day (sharing profit weeks)
    env.DB.prepare(`INSERT INTO ea_setup_days (setup_id, day, profit, balance, equity, min_equity, max_dd_pct, max_layers, min_float, currency, updated_at, total_end, tot_ok, since_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(setup_id, day) DO UPDATE SET profit=excluded.profit, balance=excluded.balance, equity=excluded.equity,
        min_equity=CASE WHEN min_equity > 0 THEN MIN(min_equity, excluded.equity) ELSE excluded.equity END, max_dd_pct=MAX(max_dd_pct, excluded.max_dd_pct),
        max_layers=MAX(max_layers, excluded.max_layers), min_float=MIN(min_float, excluded.min_float), currency=excluded.currency, updated_at=excluded.updated_at,
        total_end=CASE WHEN excluded.tot_ok=1 THEN excluded.total_end ELSE total_end END, tot_ok=CASE WHEN excluded.tot_ok=1 THEN 1 ELSE tot_ok END,
        since_at=CASE WHEN excluded.tot_ok=1 THEN excluded.since_at ELSE since_at END`)
      .bind(row.id, day, snap.day, snap.balance, snap.equity, snap.equity, dd, layers, Math.min(0, symFloat), snap.currency, t, eaNum(b.total), totalOk, row.since),
  ]);
  // sharing licence close to (or past) its weekly due date and nothing unpaid: move it to the next week (hourly at most)
  if (lic && lic.product_kind === 'ea_share' && (lic.status === 'expired' || (lic.expires_at && lic.expires_at - t < 2 * DAY))) {
    waitUntil((async () => { if (await eaClaim(env, 'share_ext_' + lic.id, Math.floor(t / 3600))) await shareMaybeExtend(env, base, lic.id, 'Sharing profit: EA melapor, minggu berikutnya'); })()
      .catch((e) => console.error('share extend', e)));
  }
  // trading history (EA v3.28+): new deals of this EA, duplicates ignored by ticket
  const deals = Array.isArray(b.deals) ? b.deals.slice(0, 200).filter((x) => x && int(x.t) > 0 && int(x.tm) > 1e9) : [];
  for (let i = 0; i < deals.length; i += 50) {
    await env.DB.batch(deals.slice(i, i + 50).map((x) => env.DB.prepare(`INSERT OR IGNORE INTO ea_setup_deals (setup_id, ticket, pos, time, type, entry, volume, price, profit, swap, commission, fee)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(row.id, int(x.t), int(x.p) || 0, int(x.tm), int(x.ty) === 1 ? 1 : 0, Math.max(0, Math.min(3, int(x.e) || 0)),
      eaNum(x.v), eaPx(x.px), eaNum(x.pf), eaNum(x.sw), eaNum(x.c), eaNum(x.f))));
  }
  // every input as the chart runs it (sent when it changes): the downloadable preset; the web key never stored
  if (Array.isArray(b.inputs) && b.inputs.length) {
    const lines = b.inputs.slice(0, 400).map((l) => str(l, 300)).filter((l) => /^\w+=/.test(l)).map((l) => (l.startsWith('InpWebKey=') ? 'InpWebKey=' : l));
    if (lines.length) await env.DB.prepare(`INSERT INTO ea_setup_inputs (setup_id, set_text, version, updated_at) VALUES (?,?,?,?)
        ON CONFLICT(setup_id) DO UPDATE SET set_text=excluded.set_text, version=excluded.version, updated_at=excluded.updated_at`).bind(row.id, lines.join('\n'), snap.version, t).run();
  }
  // where the EA sends its deals from: EA v3.29+ says where its list starts (deal_from); the cursor only moves on when
  // that is not after the cursor, so a gap (record restarted, EA restarted) is always filled from the cursor first
  const s0 = Math.max(0, (row.since || 0) - 1);
  let dealLast;
  if (b.deal_from != null) {
    let cur = row.deal_cur == null || row.deal_cur < s0 ? s0 : row.deal_cur;
    if (deals.length && int(b.deal_from) <= cur) cur = Math.max(cur, ...deals.map((x) => int(x.tm)));
    if (cur !== row.deal_cur) await env.DB.prepare('UPDATE ea_setups SET deal_cur=? WHERE id=?').bind(cur, row.id).run();
    dealLast = cur;
  } else {
    const dlast = await env.DB.prepare('SELECT MAX(time) AS m FROM ea_setup_deals WHERE setup_id=? AND time >= ?').bind(row.id, row.since || 0).first();
    dealLast = dlast && dlast.m ? dlast.m : s0;
  }
  const label = eaLabel({ ...row, setup_name: setupName || row.setup_name });
  const msgs = [];
  const evs = Array.isArray(b.events) ? b.events.slice(0, 50) : [];
  const TITLE = { kantong: '🟡 KANTONG PROFIT', pengaman: '🛑 PENGAMAN EQUITY', dd: '⚠️ FLOATING RUGI BESAR', layer: '⚠️ BASKET PANJANG', reduction: '🔁 REDUCTION', pause: '⏸ PAUSE', trailing: '🪂 TRAILING PROFIT' };
  for (const e of evs) {
    const kind = str(e.kind, 12);
    if (!TITLE[kind] && kind !== 'seri') continue;
    const at = int(e.at) || t, sd = str(e.side, 4).toUpperCase(), profit = eaNum(e.profit), positions = int(e.positions) || 0, lots = eaNum(e.lots), dur = int(e.duration) || 0, text = str(e.text, 300);
    // "large floating loss" only from 10% of the setup's capital (older EAs warned from 1%)
    const cap = budget > 0 ? budget : snap.balance;
    if (kind === 'dd' && cap > 0 && -profit < cap * 0.1) continue;
    if (kind === 'seri') {
      await env.DB.batch([
        env.DB.prepare('INSERT INTO ea_series (closed_at, side, positions, lots, profit, duration, currency, symbol, setup_id) VALUES (?,?,?,?,?,?,?,?,?)').bind(at, sd, positions, lots, profit, dur, snap.currency, sym, row.id),
        env.DB.prepare('INSERT INTO ea_setup_days (setup_id, day, series, wins, currency, updated_at) VALUES (?,?,1,?,?,?) ON CONFLICT(setup_id, day) DO UPDATE SET series=series+1, wins=wins+excluded.wins')
          .bind(row.id, wibDay(at), profit > 0 ? 1 : 0, snap.currency, t),
      ]);
      if (positions >= cfg.minLayers) msgs.push(`${profit >= 0 ? '✅' : '🟠'} <b>${esc(label)} · Seri ${sd} selesai ${eaMoney(profit, snap.currency)}</b>\n${positions} posisi · ${lots.toFixed(2)} lot · ${eaDur(dur)}`);
    } else {
      await env.DB.prepare('INSERT INTO ea_events (at, kind, side, text, profit, symbol, setup_id) VALUES (?,?,?,?,?,?,?)').bind(at, kind, sd, text, profit, sym, row.id).run();
      if (kind !== 'reduction') msgs.push(`<b>${TITLE[kind]} · ${esc(label)}</b>\n${esc(text)}`);
    }
  }
  if (row.offline_state === 1) msgs.push(`🟢 <b>${esc(label)} online kembali</b>`);
  // only showcase accounts (listed by the admin + visible) ever post to the public Telegram channel
  if (cfg.events && !tgHeld(s) && eaIsPublic(s, row)) for (const m of msgs) waitUntil(eaTg(env, cfg, m, base, row.id));
  waitUntil(eaDailyReport(env, s, cfg, t, base).catch((e) => console.error('ea daily', e)));
  return json({ ok: true, next: 60, since: row.since, deal_last: dealLast });
});

// Trading history check: the sum of every deal since `since` (profit + swap + commission + fee) against the EA's total;
// today / yesterday / this month (WIB) from the deals. ok = the history explains the reported total to the cent.
const DEAL_NET = '(profit + swap + commission + fee)';
async function dealCheck(env, r, t) {
  const since = r.since || 0;
  const [agg, byDay, inp] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(${DEAL_NET}),0) AS net, COALESCE(SUM(CASE WHEN entry>0 THEN 1 ELSE 0 END),0) AS closes,
        MIN(time) AS first, MAX(time) AS last FROM ea_setup_deals WHERE setup_id=? AND time >= ?`).bind(r.id, since).first(),
    env.DB.prepare(`SELECT date(time + 25200, 'unixepoch') AS day, SUM(${DEAL_NET}) AS net FROM ea_setup_deals WHERE setup_id=? AND time >= ? GROUP BY day`).bind(r.id, since).all(),
    env.DB.prepare('SELECT updated_at, version FROM ea_setup_inputs WHERE setup_id=?').bind(r.id).first(),
  ]);
  const net = Math.round((agg.net || 0) * 100) / 100;
  const day = (d) => Math.round(((byDay.results.find((x) => x.day === d) || {}).net || 0) * 100) / 100;
  const td = wibDay(t), m0 = td.slice(0, 7);
  const month = Math.round(byDay.results.filter((x) => String(x.day).slice(0, 7) === m0).reduce((a, x) => a + (x.net || 0), 0) * 100) / 100;
  const total = r.total_ok ? r.total : null;
  return { deals: agg.n || 0, closes: agg.closes || 0, net, first: agg.first || 0, last: agg.last || 0,
    today: day(td), yday: day(wibDay(t - DAY)), month, total,
    ok: total != null && (agg.n || 0) > 0 && Math.abs(net - total) < 0.02, diff: total == null ? null : Math.round((total - net) * 100) / 100,
    inputs_at: inp ? inp.updated_at : 0 };
}

// Public: all visible EA instances (overview), or ?setup=id with series, days and events since its start.
route('GET', '/live', 'public', async ({ env, url, waitUntil, base }) => {
  const s = await getSettings(env);
  const cfg = eaCfg(s);
  const t = now();
  waitUntil(eaOfflineCheck(env, s, base).catch((e) => console.error('ea offline', e)));
  const id = int(url.searchParams.get('setup')) || 0;
  const pw = eaPublicWhere(s), spw = eaPublicWhere(s, 's');
  // nothing chosen yet (no showcase account and no single showcase setup): pages say the live accounts are being prepared
  const prepared = !showcaseLogins(s).length && !(await env.DB.prepare('SELECT 1 AS x FROM ea_setups WHERE showcase=1 AND visible=1 LIMIT 1').first());
  const profLogins = new Set((await env.DB.prepare('SELECT DISTINCT login FROM ea_vps_master_profile').all()).results.map((x) => String(x.login)));
  const inSetups = new Set((await env.DB.prepare('SELECT setup_id FROM ea_setup_inputs').all()).results.map((x) => x.setup_id));
  const hasPreset = (r) => inSetups.has(r.id) || profLogins.has(String(r.login));
  const yd = wibDay(t - DAY);
  const ydOf = (v, p) => ({ yday: p == null ? null : eaNum(p), yday_usd: p == null ? null : eaUsd(eaNum(p), v.currency),
    yday_pct: p == null || !(v.modal > 0) ? null : Math.round(p / v.modal * 10000) / 100 });
  if (id) {
    const r = await env.DB.prepare(`SELECT * FROM ea_setups WHERE id=? AND ${pw.sql}`).bind(id, ...pw.binds).first();
    if (!r) fail(404, 'EA tidak ditemukan');
    const from = wibDay(r.since || 0);
    const [series, days, events, stat, hist, check] = await Promise.all([
      env.DB.prepare('SELECT closed_at, side, positions, lots, profit, duration, currency FROM ea_series WHERE setup_id=? AND closed_at >= ? ORDER BY id DESC LIMIT 60').bind(r.id, r.since).all(),
      env.DB.prepare('SELECT day, profit, series, wins, balance, equity, max_dd_pct, max_layers, min_float, currency, total_end, tot_ok, since_at FROM ea_setup_days WHERE setup_id=? AND day >= ? ORDER BY day DESC LIMIT 90').bind(r.id, from).all(),
      env.DB.prepare('SELECT at, kind, side, text, profit FROM ea_events WHERE setup_id=? AND at >= ? ORDER BY id DESC LIMIT 40').bind(r.id, r.since).all(),
      env.DB.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN profit>0 THEN 1 ELSE 0 END),0) AS wins, COALESCE(AVG(duration),0) AS dur, COALESCE(MAX(positions),0) AS maxpos
          FROM ea_series WHERE setup_id=? AND closed_at >= ?`).bind(r.id, r.since).first(),
      env.DB.prepare(`SELECT ticket, pos, time, type, entry, volume, price, ${DEAL_NET} AS net FROM ea_setup_deals WHERE setup_id=? AND time >= ? AND entry > 0
          ORDER BY time DESC, ticket DESC LIMIT 200`).bind(r.id, r.since || 0).all(),
      dealCheck(env, r, t),
    ]);
    const d = eaParse(r.data);
    const snap = { buy: d.buy || { count: 0 }, sell: d.sell || { count: 0 }, pocket: d.pocket || {}, news: d.news || {}, pause: d.pause || {}, spread: d.spread || 0, trend: d.trend || 0, trend_why: d.trend_why || '', trend_tf: d.trend_tf || '', margin_level: d.margin_level || 0 };
    const v1 = eaSetupView(r, t, cfg);
    const fd = (x) => (x.day === from ? { ...x, profit: x.tot_ok && x.since_at === r.since ? x.total_end : (x.day === wibDay(t) ? v1.day : x.profit) } : x);
    days.results = days.results.map(fd).map(({ total_end, tot_ok, since_at, ...x }) => x);
    const p1 = days.results.find((x) => x.day === yd);
    return json({ ok: true, configured: !!cfg.key, server_time: t, offline_min: cfg.offlineMin,
      setup: { ...v1, ...ydOf(v1, p1 ? p1.profit : null), preset: hasPreset(r), preset_live: !!check.inputs_at, preset_at: check.inputs_at, stats: stat, snapshot: snap },
      series: series.results, days: days.results, events: events.results, history: hist.results, check });
  }
  const { results: rows } = await env.DB.prepare(`SELECT * FROM ea_setups WHERE ${pw.sql}`).bind(...pw.binds).all();
  rows.sort(EA_SETUP_ORDER);
  const d30 = wibDay(t - 29 * DAY);
  const [{ results: days }, { results: ser }, { results: dls }] = rows.length ? await Promise.all([
    env.DB.prepare(`SELECT d.setup_id, d.day, d.profit, d.total_end, d.tot_ok, d.since_at FROM ea_setup_days d JOIN ea_setups s ON s.id=d.setup_id WHERE ${spw.sql} AND d.day >= ? ORDER BY d.day`).bind(...spw.binds, d30).all(),
    env.DB.prepare(`SELECT e.setup_id, COUNT(*) AS n, COALESCE(SUM(CASE WHEN e.profit>0 THEN 1 ELSE 0 END),0) AS wins FROM ea_series e JOIN ea_setups s ON s.id=e.setup_id
        WHERE ${spw.sql} AND e.closed_at >= s.since GROUP BY e.setup_id`).bind(...spw.binds).all(),
    env.DB.prepare(`SELECT d.setup_id, COUNT(*) AS n, COALESCE(SUM(d.profit + d.swap + d.commission + d.fee),0) AS net FROM ea_setup_deals d JOIN ea_setups s ON s.id=d.setup_id
        WHERE ${spw.sql} AND d.time >= s.since GROUP BY d.setup_id`).bind(...spw.binds).all(),
  ]) : [{ results: [] }, { results: [] }, { results: [] }];
  const setups = rows.map((r) => {
    const v = eaSetupView(r, t, cfg);
    const sr = ser.find((x) => x.setup_id === r.id) || { n: 0, wins: 0 };
    const sinceDay = wibDay(r.since || 0);
    // the record's first day counts only what closed since `since`
    const dp = (x) => (x.day !== sinceDay ? x.profit : x.tot_ok && x.since_at === r.since ? x.total_end : (x.day === wibDay(t) ? v.day : x.profit));
    const p0 = days.find((x) => x.setup_id === r.id && x.day === yd);
    const dl = dls.find((x) => x.setup_id === r.id) || { n: 0, net: 0 };
    return { ...v, ...ydOf(v, p0 && p0.day >= sinceDay ? dp(p0) : null), preset: hasPreset(r), series: sr.n, wins: sr.wins,
      deals: dl.n, verified: dl.n > 0 && v.total != null && Math.abs(Math.round(dl.net * 100) / 100 - v.total) < 0.02,
      spark: days.filter((x) => x.setup_id === r.id && x.day >= sinceDay).map((x) => [x.day, dp(x)]) };
  });
  return json({ ok: true, configured: !!cfg.key, prepared, server_time: t, offline_min: cfg.offlineMin, setups });
});

// ---- Preset of one public EA instance: every input exactly as that chart runs, read from the owner's VPS chart-profile
// backup (master agent, ea_vps_master_profile): the chart*.chr with the same symbol + magic. The web key (13.2) is blanked.
const chrText = (u8) => (u8[0] === 0xFF && u8[1] === 0xFE ? new TextDecoder('utf-16le').decode(u8.subarray(2)) : new TextDecoder().decode(u8));
const utf16Set = (txt) => { const b = new Uint8Array(2 + txt.length * 2); b[0] = 0xFF; b[1] = 0xFE; for (let i = 0; i < txt.length; i++) { const c = txt.charCodeAt(i); b[2 + i * 2] = c & 255; b[3 + i * 2] = c >> 8; } return b; };
async function liveSetupInputs(env, r) {
  const own = await env.DB.prepare('SELECT set_text, updated_at FROM ea_setup_inputs WHERE setup_id=?').bind(r.id).first();
  if (own && own.set_text) return { lines: own.set_text.split('\n').filter((l) => /^\w+=/.test(l)).map((l) => (l.startsWith('InpWebKey=') ? 'InpWebKey=' : l)), at: own.updated_at };
  const want = String(r.broker_symbol || r.symbol).toUpperCase();
  const { results } = await env.DB.prepare('SELECT files, updated_at FROM ea_vps_master_profile WHERE login=? ORDER BY updated_at DESC').bind(String(r.login)).all();
  for (const p of results) {
    let files = [];
    try { files = JSON.parse(p.files || '[]'); } catch { files = []; }
    for (const f of Array.isArray(files) ? files : []) {
      if (!/^chart\d+\.chr$/i.test(String(f && f.name || ''))) continue;
      let txt = '';
      try { txt = chrText(unb64(String(f.b64 || ''))); } catch { continue; }
      const sym = (txt.match(/^symbol=(.*)$/m) || [])[1];
      if (!sym || sym.trim().toUpperCase() !== want) continue;
      for (const ex of txt.match(/<expert>[\s\S]*?<\/expert>/g) || []) {
        if (!/GOLD HUNTER GARUDA/i.test(ex)) continue;
        const m = ex.match(/<inputs>\r?\n([\s\S]*?)<\/inputs>/);
        if (!m) continue;
        const lines = m[1].split(/\r?\n/).map((l) => l.trim()).filter((l) => /^\w+=/.test(l));
        const mg = lines.find((l) => l.startsWith('InpMagicNumber='));
        if (!mg || int(mg.slice(15)) !== int(r.magic)) continue;
        return { lines: lines.map((l) => (l.startsWith('InpWebKey=') ? 'InpWebKey=' : l)), at: p.updated_at };
      }
    }
  }
  return null;
}
route('GET', '/live/:id/preset', 'member', async ({ env, user, params }) => {
  const s = await getSettings(env);
  const r = await env.DB.prepare('SELECT * FROM ea_setups WHERE id=?').bind(int(params.id)).first();
  if (!r || (!eaIsPublic(s, r) && user.role !== 'admin')) fail(404, 'Setup tidak ditemukan');
  // free for every logged-in member (no licence needed); visitors are sent to the login page by the page itself
  const inp = await liveSetupInputs(env, r);
  if (!inp) fail(404, 'Preset setup ini belum tersedia (cadangan chart VPS belum masuk). Coba lagi nanti.');
  const v = eaSetupView(r, now(), eaCfg(s));
  const label = eaLabel(r);
  const head = `; GOLD HUNTER GARUDA v${v.version || ''} - preset setup live "${label}" ${r.symbol}` +
    (v.modal > 0 ? ` - modal ${Math.round(v.modal)} ${r.currency}` : '') + ` - setelan chart yang tampil di goldhuntergaruda.com/live`;
  const name = `GOLD HUNTER GARUDA ${r.symbol} ${label}`.replace(/[\\/:*?"<>|\r\n]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) + '.set';
  return new Response(utf16Set([head, ...inp.lines].join('\r\n') + '\r\n'), { headers: {
    'content-type': 'application/octet-stream',
    'content-disposition': `attachment; filename="${name.replace(/[^\w. ()-]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    'cache-control': 'private, no-store' } });
});

// Full trading history of a public setup since its start, as a CSV file (opens in Excel / Google Sheets).
route('GET', '/live/:id/history.csv', 'public', async ({ env, params }) => {
  const s = await getSettings(env);
  const r = await env.DB.prepare('SELECT * FROM ea_setups WHERE id=?').bind(int(params.id)).first();
  if (!r || !eaIsPublic(s, r)) fail(404, 'Setup tidak ditemukan');
  const { results } = await env.DB.prepare('SELECT * FROM ea_setup_deals WHERE setup_id=? AND time >= ? ORDER BY time, ticket').bind(r.id, r.since || 0).all();
  const ENTRY = ['MASUK', 'KELUAR', 'BALIK', 'KELUAR (BY)'];
  const wib = (x) => new Date((x + 7 * 3600) * 1000).toISOString().replace('T', ' ').slice(0, 19);
  const n2 = (x) => Number(x || 0).toFixed(2);
  const rows = [['Waktu (WIB)', 'Tiket', 'Posisi', 'Arah', 'Jenis', 'Lot', 'Harga', 'Profit', 'Swap', 'Komisi', 'Fee', 'Bersih', 'Mata uang']];
  let sum = 0;
  for (const x of results) {
    const net = (x.profit || 0) + (x.swap || 0) + (x.commission || 0) + (x.fee || 0);
    sum += net;
    rows.push([wib(x.time), x.ticket, x.pos, x.type === 1 ? 'SELL' : 'BUY', ENTRY[x.entry] || x.entry, n2(x.volume), x.price, n2(x.profit), n2(x.swap), n2(x.commission), n2(x.fee), n2(net), r.currency || '']);
  }
  rows.push(['TOTAL', '', '', '', '', '', '', '', '', '', '', n2(sum), r.currency || '']);
  const csv = '\ufeff' + rows.map((a) => a.map((c) => { const v = String(c); return /[",;\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(',')).join('\r\n') + '\r\n';
  const name = `GOLD HUNTER GARUDA ${r.symbol} ${eaLabel(r)} riwayat.csv`.replace(/[\\/:*?"<>|\r\n]/g, '').replace(/\s+/g, ' ').trim();
  return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename="${name.replace(/[^\w. ()-]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`, 'cache-control': 'no-store' } });
});

// Admin: preview the Telegram picture / send it now.
route('GET', '/admin/ea/report.png', 'admin', async ({ env }) => {
  const s = await getSettings(env);
  const t = now();
  const { rows, head } = await eaReportRows(env, s, t, eaCfg(s));
  return new Response(await reportPng(rows, head), { headers: { 'content-type': 'image/png', 'cache-control': 'no-store' } });
});
route('POST', '/admin/ea/report-send', 'admin', async ({ env, base }) => {
  const s = await getSettings(env);
  const cfg = eaCfg(s);
  const r = await eaSendReport(env, s, now(), cfg, base);
  if (!r.ok) fail(400, r.error || 'Telegram belum aktif atau belum ada target (Media Sosial > Telegram)');
  return json(r);
});

// Admin: manage the EA instances (label, visibility, order, start of the track record).
route('GET', '/admin/ea/setups', 'admin', async ({ env }) => {
  const s = await getSettings(env);
  const cfg = eaCfg(s);
  const t = now();
  const { results } = await env.DB.prepare('SELECT s.*, u.name AS owner_name, u.email AS owner_email FROM ea_setups s LEFT JOIN users u ON u.id=s.user_id').all();
  results.sort(EA_SETUP_ORDER);
  const L = showcaseLogins(s);
  return json({ showcase_logins: L, setups: results.map((r) => ({ ...eaSetupView(r, t, cfg), login: r.login, server: r.server, magic: r.magic,
    label_admin: r.label, visible: r.visible, sort: r.sort, created_at: r.created_at, listed: L.includes(String(r.login)), public: eaIsPublic(s, r),
    showcase: r.showcase ? 1 : 0, modal_override: r.modal_override || 0,
    license_id: r.license_id || null, owner_name: r.license_id ? r.owner_name || '' : '', owner_email: r.license_id ? r.owner_email || '' : '' })) });
});
route('PUT', '/admin/ea/setups/:id', 'admin', async ({ request, env, params }) => {
  const b = await readJson(request);
  const r = await env.DB.prepare('SELECT * FROM ea_setups WHERE id=?').bind(int(params.id)).first();
  if (!r) fail(404, 'EA tidak ditemukan');
  let since = b.reset ? now() : (b.since != null && b.since !== '' ? int(b.since) : r.since);
  if (!(since > 0) || since > now() + 60) fail(400, 'Tanggal mulai tidak valid');
  const restart = since !== r.since;
  const mo = b.modal_override == null || b.modal_override === '' ? (r.modal_override || 0) : Math.max(0, Math.min(1e9, Number(b.modal_override) || 0));
  const sc = b.showcase == null ? (r.showcase ? 1 : 0) : (b.showcase ? 1 : 0);
  await env.DB.prepare(`UPDATE ea_setups SET label=?, visible=?, sort=?, since=?, showcase=?, modal_override=?${restart ? ', since_manual=1, total=0, acct_total=0, total_ok=0, max_dd_pct=0, min_float=0, max_layers=0' : ''} WHERE id=?`)
    .bind(str(b.label, 60), b.visible ? 1 : 0, int(b.sort) || 0, since, sc, mo, r.id).run();
  if (restart) {
    await env.DB.batch([env.DB.prepare('DELETE FROM ea_setup_deals WHERE setup_id=?').bind(r.id), env.DB.prepare('UPDATE ea_setups SET deal_cur=-1 WHERE id=?').bind(r.id)]);
    // deepest DD / floating / longest basket rebuilt from the daily rows inside the new period
    const agg = await env.DB.prepare('SELECT COALESCE(MAX(max_dd_pct),0) AS dd, COALESCE(MIN(min_float),0) AS mf, COALESCE(MAX(max_layers),0) AS ml FROM ea_setup_days WHERE setup_id=? AND day >= ?')
      .bind(r.id, wibDay(since)).first();
    await env.DB.prepare('UPDATE ea_setups SET max_dd_pct=?, min_float=?, max_layers=? WHERE id=?').bind(agg.dd, agg.mf, agg.ml, r.id).run();
  }
  return json({ ok: true, restart });
});
route('DELETE', '/admin/ea/setups/:id', 'admin', async ({ env, params }) => {
  const id = int(params.id);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM ea_setup_days WHERE setup_id=?').bind(id),
    env.DB.prepare('DELETE FROM ea_series WHERE setup_id=?').bind(id),
    env.DB.prepare('DELETE FROM ea_events WHERE setup_id=?').bind(id),
    env.DB.prepare('DELETE FROM ea_setup_deals WHERE setup_id=?').bind(id),
    env.DB.prepare('DELETE FROM ea_setup_inputs WHERE setup_id=?').bind(id),
    env.DB.prepare('DELETE FROM ea_setups WHERE id=?').bind(id),
  ]);
  return json({ ok: true });
});

// ======================= TELEGRAM (EA live reports, content videos, admin tests) =======================
// Configured in Admin > Media Sosial > Telegram: bot token (stored encrypted) and any number of target channels / groups.
// Hold switch (settings.telegram_hold, default ON when missing): while held NOTHING goes to Telegram automatically
// (EA live messages / picture reports, content videos). Only the admin's explicit "Kirim pesan tes" still sends.
const tgHeld = (s) => String(s.telegram_hold ?? '1') !== '0';
async function tgConfig(env) {
  const s = await getSettings(env);
  const token = s.telegram_bot_token_enc ? await decrypt(env, s.telegram_bot_token_enc) : '';
  const targets = (Array.isArray(s.telegram_targets) ? s.telegram_targets : []).filter((t) => t.active !== false && t.chat_id);
  return { on: s.telegram_enabled === '1' && !!token && targets.length > 0, hold: tgHeld(s), token, targets };
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

// Send to every active target; replyTo is the {chat_id: message_id} map of the original post
async function tgBroadcast(env, text, { photo, replyTo } = {}) {
  const c = await tgConfig(env);
  if (!c.on || c.hold) return null;           // held: returns before any fetch to Telegram
  const out = {};
  await Promise.all(c.targets.map(async (t) => {
    const r = await tgSend(c.token, t.chat_id, text, { photo, replyTo: replyTo ? replyTo[t.chat_id] : null });
    if (r.ok) out[t.chat_id] = r.message_id;
    else console.error('telegram', t.chat_id, r.error);
  }));
  return out;
}

// ---- Promo videos (TikTok / Reels / Shorts, 9:16). The website queues a job, the builder on the admin PC asks for it,
// gets the topic + a script written by the content AI, renders the MP4 locally and sends it back to Telegram / social
// networks through here. For now only educational / introduction videos about GOLD HUNTER GARUDA are made
// (kind 'edu'); the content system will be rewritten later for the EA's live results.
// Rotating topics for the scheduled videos (admin can add more in Admin > Konten Video)
const CONTENT_TOPICS = [
  'Perkenalan: apa itu EA GOLD HUNTER GARUDA dan cara kerjanya di MetaTrader 5 / 4',
  'Cara kerja: seri BUY dan SELL berjalan bersamaan di mode BARBAR',
  'Cara kerja: apa itu basket dan TP bersama dari harga rata-rata',
  'Cara kerja: DD reduction, posisi terbaru yang untung membayar posisi terlama yang rugi',
  'Cara kerja: kantong profit, sebagian profit disisihkan untuk melunasi posisi rugi',
  'Cara kerja: kenapa jarak layer melebar sesudah layer 4',
  'Cara kerja: kenapa seri baru menunggu harga mundur dulu sesudah TP',
  'Transparansi: kenapa hasil EA dilaporkan live tiap menit, termasuk saat rugi',
  'Jujur soal risiko: kenapa EA martingale / averaging butuh stop loss equity',
  'Edukasi: apa itu floating dan drawdown, dan kenapa harus dipantau',
  'Edukasi: kenapa akun cent cocok untuk modal kecil ($100 = 10.000 USC)',
  'Edukasi: lot ikut balance (autocompound), lot membesar saat akun tumbuh',
  'Edukasi: kenapa profit sebaiknya ditarik secara berkala',
  'Edukasi: pengaman equity, batas rugi yang Anda pilih sendiri',
  'Edukasi: kenapa data CPI, NFP dan FOMC bisa membuat emas bergerak kencang',
  'Edukasi: spread melebar saat berita dan kenapa EA menunggu',
  'Edukasi: sesi Asia, London dan New York, kapan emas paling aktif',
  'Edukasi: hubungan dolar AS dan harga emas',
  'Psikologi trading: jangan menaikkan lot karena panik atau serakah',
  'Panduan: cara membaca laporan live di goldhuntergaruda.com/live',
  'Panduan: cara membaca panel EA di chart (rata-rata, TP basket, layer berikutnya)',
  'Edukasi: kenapa EA butuh VPS supaya berjalan 24 jam',
];
function contentTopics(s) {
  const extra = String(s.content_topics || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  return [...CONTENT_TOPICS, ...extra];
}
// Script writer for videos: a cheap OpenAI-compatible model (Qwen on Alibaba Cloud Model Studio, or DeepSeek)
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

// Educational / introduction video: 3 points about one topic, GOLD HUNTER GARUDA facts given so nothing is invented
async function eduScript(env, s, lang, data) {
  const L = lang === 'en' ? 'English' : 'Bahasa Indonesia (santai, jelas, gaya TikTok edukatif)';
  return qwenJson(env, s, `You write short educational vertical videos (25-35 seconds, TikTok / Reels / Shorts) for GOLD HUNTER GARUDA (goldhuntergaruda.com), an Expert Advisor (trading robot) for MetaTrader 5 / 4, mainly for gold. Write in ${L}.
Teach one topic clearly and correctly for beginners. Use only the GOLD HUNTER GARUDA facts given; never invent results or numbers. Never promise profit, never say "pasti untung" or "passive income"; be honest that drawdown can be deep and that the equity stop loss (setting 9.1) is the loss limit. Mention GOLD HUNTER GARUDA naturally (mostly in the last point and the cta).
Style: the hook must stop the scroll in 2 seconds (pick one: a sharp question, a common mistake, a surprising fact, or "stop doing X"). Speak like a friendly mentor, short punchy sentences, explain every term with an everyday analogy, give one concrete example (e.g. a gold basket of 5 layers closing together at its average price plus the target). Each point adds something new, no filler, no repeated words. Titles are catchy and readable in one glance.
Return JSON only: {"hook": "max 8 words that stop the scroll", "scenes": [{"id": "hook", "say": "...", "text": "..."}, {"id": "point", "icon": "one emoji", "title": "2-5 words", "say": "1-2 short sentences", "text": "short subtitle"} x3, {"id": "cta", "say": "invite to follow the channel and check the live results at goldhunter garuda dot com", "text": "..."}], "caption": "3-4 short lines ending with goldhuntergaruda.com/live and a one-line risk note", "hashtags": "5-8 hashtags"}
"say" is read by a voice (website as "goldhunter garuda dot com"), "text" is the subtitle (website written goldhuntergaruda.com). Total narration 70-90 words.`,
    `Topic: ${data.topic}\nGOLD HUNTER GARUDA facts: ${JSON.stringify(data.facts)}`);
}
const GARUDA_FACTS = ['GOLD HUNTER GARUDA is an Expert Advisor (trading robot) for MetaTrader 5 and MetaTrader 4, mainly for gold XAUUSD (it also runs on Bitcoin, EURUSD and USDJPY); a cent account suits small capital',
  'marty basket (martingale / averaging): when price moves against a side the EA adds a layer, the lot grows x1.15 per layer and the step widens x1.1 after layer 4',
  'all positions of one side close together at the average price plus the target (one shared take profit, swap included)',
  'BARBAR mode: BUY and SELL series run at the same time, so one side keeps closing baskets while the other waits; otherwise an EMA trend filter picks the direction',
  'DD reduction from 6 positions: the newest position in profit pays for the oldest losing one, which is closed only after the profit is received, so the basket shrinks without a loss',
  'profit pocket: part of every closed profit is saved and later pays off the oldest losing position of a long basket',
  'after a take profit the next series waits for a small pullback; high-impact news from the MT5 calendar can hold new series; orders wait while the spread is too wide',
  'the first lot follows the balance (auto-compound); an optional equity guard closes everything at a loss limit the user chooses',
  'stop loss: setting 9.1 closes every position when the floating loss reaches the % limit set for the account; before that limit a long one-way trend can still make the drawdown deep, and the EA does not guarantee profit',
  'every EA instance reports from a real account to goldhuntergaruda.com/live every minute, losses included; Telegram gets a picture report'];

route('POST', '/builder/content/claim', 'builder', async ({ env }) => {
  const s = await getSettings(env);
  if (s.content_enabled !== '1') return json({ job: null });
  // the script writer (cheap OpenAI-compatible model) must be configured: jobs simply wait until then
  if (!s.qwen_key_enc) return json({ job: null, waiting: 'API key AI konten belum diatur' });
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
  await env.DB.prepare("UPDATE content_jobs SET status='queued' WHERE status='rendering' AND created_at < ?").bind(now() - 3600).run();
  const job = await env.DB.prepare("SELECT * FROM content_jobs WHERE status='queued' AND kind='edu' ORDER BY id LIMIT 1").first();
  if (!job) return json({ job: null });
  await env.DB.prepare("UPDATE content_jobs SET status='rendering' WHERE id=?").bind(job.id).run();
  try {
    const out = { id: job.id, kind: job.kind, lang: job.lang, voice: job.lang === 'en' ? 'en-US-AndrewNeural' : (s.content_voice || 'id-ID-ArdiNeural'),
      send_telegram: s.content_tg === '1' && !tgHeld(s), send_social: Object.entries(socialReady(s)).filter(([k, ok]) => ok && s['content_' + k] === '1').map(([k]) => k),
      topic: job.topic || '' };
    let script = job.script ? JSON.parse(job.script) : null;
    if (!script) {
      script = await eduScript(env, s, job.lang, { topic: job.topic, facts: GARUDA_FACTS });
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
  if (c.hold) return json({ ok: false, held: true, error: 'Telegram ditahan (Admin > Media Sosial > Telegram)' });
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
    fd.append('video', new Blob([buf], { type: 'video/mp4' }), job.file_name || 'goldhunter-garuda.mp4');
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
  const { results } = await env.DB.prepare(`SELECT id, created_at, kind, ref_id, lang, status, caption, error, file_name, duration, size, rendered_at, topic,
      tg_file_id <> '' AS on_telegram, social FROM content_jobs ORDER BY id DESC LIMIT 60`).all();
  const bs = (() => { try { return JSON.parse(s.builder_seen || '{}'); } catch { return {}; } })();
  return json({ jobs: results, builder_seen: bs.at || 0,
    settings: { content_enabled: s.content_enabled, content_lang: s.content_lang,
      content_voice: s.content_voice, content_tg: s.content_tg, content_edu: s.content_edu, content_times: s.content_times || '', content_topics: s.content_topics || '',
      qwen_base: s.qwen_base || '', qwen_model: s.qwen_model || 'qwen-plus', qwen_key_set: !!s.qwen_key_enc },
    topics: contentTopics(s), next_topic: (Number(s.content_topic_idx) || 0) % contentTopics(s).length });
});
// Test the Qwen connection with the saved key / model
route('POST', '/admin/content/qwen-test', 'admin', async ({ env }) => {
  const s = await getSettings(env);
  if (!s.qwen_key_enc) fail(400, 'API key ' + aiName(s) + ' belum disimpan');
  const t0 = Date.now();
  const j = await qwenJson(env, s, 'Return JSON only.', 'Return {"ok": true, "text": "GOLD HUNTER GARUDA siap"}');
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
  if (b.retry && int(b.retry)) await env.DB.prepare("UPDATE content_jobs SET status='queued', error='' WHERE id=?").bind(int(b.retry)).run();
  else fail(400, 'Permintaan tidak dikenal');
  return json({ ok: true });
});
route('PUT', '/admin/content/settings', 'admin', async ({ request, env }) => {
  const b = await readJson(request);
  for (const k of ['content_enabled', 'content_tg', 'content_edu']) if (b[k] !== undefined) await putSetting(env, k, b[k] ? '1' : '0');
  if (b.content_times !== undefined) {
    const t = String(b.content_times).split(/[,\s]+/).filter(Boolean);
    if (t.some((x) => !/^([01]?\d|2[0-3]):[0-5]\d$/.test(x))) fail(400, 'Jam harus format HH:MM, pisahkan koma (contoh 12:00, 19:00)');
    await putSetting(env, 'content_times', t.join(', '));
  }
  if (b.content_topics !== undefined) await putSetting(env, 'content_topics', str(b.content_topics, 6000));
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
  return new Response(v.body, { headers: { 'content-type': 'video/mp4', 'content-disposition': `attachment; filename="${job.file_name || 'goldhunter-garuda.mp4'}"`, 'cache-control': 'private, no-store' } });
});

// ======================= VPS AUTO-UPDATE (GOLD HUNTER GARUDA ex5 + presets -> every MT5 on the VPS) =======================
// The builder on the owner's PC publishes a release when #property version changes (or the presets change);
// the VPS agent (PowerShell) polls GET /vps/release with x-ea-key = ea_master_key, downloads, installs into every
// MT5 data folder and restarts the terminals, then reports to POST /vps/status.
const vpsRelease = (s) => { try { const r = JSON.parse(s.vps_release || 'null'); return r && r.sha ? r : null; } catch { return null; } };
async function vpsAuth(env, request) {
  const s = await getSettings(env);
  const key = String(s.ea_master_key || '').trim();
  if (!key || request.headers.get('x-ea-key') !== key) fail(403, 'Kunci master salah (Admin > Pengaturan > EA Live)');
  return s;
}
// ---- Licence key `lic.<license_id>.<report_token>`: one key per member licence, used by the licensed EA's heartbeat
// (/ea/live) and the member's VPS agent (/vps/lic/*). Valid only while the licence is active and not expired.
// Constant-time compare: no early exit on the first different character.
function ctEq(a, b) {
  a = String(a ?? ''); b = String(b ?? '');
  let d = a.length ^ b.length;
  for (let i = 0, n = Math.max(a.length, b.length); i < n; i++) d |= (a.charCodeAt(i) | 0) ^ (b.charCodeAt(i) | 0);
  return d === 0;
}
const LIC_KEY_RE = /^lic\.(\d{1,10})\.([A-Za-z0-9_-]{16,64})$/;
const isLicKey = (k) => String(k || '').trim().startsWith('lic.');
async function licAuth(env, key) {
  const m = String(key || '').trim().match(LIC_KEY_RE);
  if (!m) fail(401, 'Kunci lisensi tidak valid (format lic.<id>.<token>)');
  const l = await env.DB.prepare('SELECT l.*, p.kind AS product_kind FROM licenses l JOIN products p ON p.id=l.product_id WHERE l.id=?').bind(int(m[1])).first();
  if (!l || !l.report_token || !ctEq(m[2], l.report_token)) fail(401, 'Kunci lisensi salah');
  // sharing profit: a paused licence (unpaid invoice / no report) keeps reporting, so its profit stays measurable;
  // the EA itself stops opening new orders at the expiry compiled into it
  const share = l.product_kind === 'ea_share' && ['active', 'expired'].includes(l.status);
  if (l.status !== 'active' && !share) fail(403, `Lisensi akun ${l.account_number} tidak aktif (status: ${l.status})`);
  if (l.expires_at && l.expires_at <= now() && !share) fail(403, `Lisensi akun ${l.account_number} sudah habis masa aktifnya`);
  return l;
}
// Current finished EA file of a licence, with the exact byte size (the agent checks it after downloading)
async function licCurrentFile(env, l) {
  if (!l.current_build_id) return null;
  const b = await env.DB.prepare(`SELECT b.id, b.ea_version, b.platform, b.account_number, b.expires_at, f.id AS file_id, f.name,
      length(f.data_b64) AS n, substr(f.data_b64, -2) AS tail FROM builds b JOIN files f ON f.id=b.file_id AND f.kind='ea'
      WHERE b.id=? AND b.license_id=? AND b.status='done'`).bind(l.current_build_id, l.id).first();
  if (!b) return null;
  b.size = Math.floor(b.n * 3 / 4) - (b.tail === '==' ? 2 : String(b.tail).endsWith('=') ? 1 : 0);
  return b;
}
const vpsAgents = (rows) => rows.map((r) => { let tm = []; try { tm = JSON.parse(r.terminals || '[]'); } catch { tm = []; } return { ...r, terminals: tm }; });
route('POST', '/builder/vps-release', 'builder', async ({ request, env }) => {
  const b = await readJson(request);
  const ex5 = String(b.ex5_b64 || '');
  if (!ex5 || ex5.length > 2.6e6) fail(400, 'File EA kosong atau terlalu besar');
  const presets = (Array.isArray(b.presets) ? b.presets : []).slice(0, 60)
    .map((p) => ({ name: str(p.name, 120).replace(/[\\/:*?"<>|]/g, ''), data: String(p.b64 || '') }))
    .filter((p) => p.name.toLowerCase().endsWith('.set') && p.data && p.data.length < 200000);
  const t = now();
  const name = str(b.ex5_name, 120).replace(/[\\/:*?"<>|]/g, '') || 'GOLD HUNTER GARUDA.ex5';
  const old = await env.DB.prepare("SELECT id FROM files WHERE kind IN ('vps_ex5','vps_preset')").all();
  const ins = (kind, nm, mime, data) => env.DB.prepare('INSERT INTO files (user_id, kind, name, mime, size, data_b64, created_at) VALUES (NULL, ?, ?, ?, ?, ?, ?)')
    .bind(kind, nm, mime, b64Len(data), data, t);
  const r1 = await ins('vps_ex5', name, 'application/octet-stream', ex5).run();
  const extras = [];
  for (const x of (Array.isArray(b.extras) ? b.extras : []).slice(0, 40)) {
    const nm = str(x.name, 120).replace(/[\\/:*?"<>|]/g, ''), data = String(x.b64 || '');
    if (!nm.toLowerCase().endsWith('.ex5') || !data || data.length > 2.6e6) continue;
    const r = await ins('vps_ex5', nm, 'application/octet-stream', data).run();
    extras.push({ id: r.meta.last_row_id, name: nm, size: b64Len(data) });
  }
  const pres = [];
  for (const p of presets) { const r = await ins('vps_preset', p.name, 'application/octet-stream', p.data).run(); pres.push({ id: r.meta.last_row_id, name: p.name, size: b64Len(p.data) }); }
  if (old.results.length) await env.DB.batch(old.results.map((x) => env.DB.prepare('DELETE FROM files WHERE id=?').bind(x.id)));
  const rel = { version: str(b.version, 12), sha: str(b.sha, 80), sha_ex5: str(b.sha_ex5, 80), sha_presets: str(b.sha_presets, 80), at: t,
    ex5: { id: r1.meta.last_row_id, name, size: b64Len(ex5) }, extras, presets: pres, by: str(b.host, 60) };
  await putSetting(env, 'vps_release', JSON.stringify(rel));
  return json({ ok: true, sha: rel.sha });
});
// ---------- EA feature documentation (the /*@GHG-FEATURES*/ block of the EA source, sent by the builder) ----------
// stored as one file (kind ea_features) so the big JSON is not loaded with every settings read; /fitur renders it
function cleanFeatures(doc) {
  const L = (x, n) => ({ id: str(x && x.id, n), en: str(x && (x.en || x.id), n) });
  const groups = (Array.isArray(doc && doc.groups) ? doc.groups : []).slice(0, 40).map((g) => {
    const out = { id: str(g.id, 30).replace(/[^a-z0-9-]/gi, '').toLowerCase(), icon: str(g.icon, 8), title: L(g.title, 80), intro: L(g.intro, 300),
      features: (Array.isArray(g.features) ? g.features : []).slice(0, 40).map((f) => ({ title: L(f.title, 90), setting: str(f.setting, 40), how: L(f.how, 700), use: L(f.use, 500) }))
        .filter((f) => f.title.id) };
    if (g.badge) out.badge = L(g.badge, 40);
    if (g.note) out.note = L(g.note, 400);
    if (Array.isArray(g.flow)) out.flow = g.flow.slice(0, 8).map((x) => ({ icon: str(x.icon, 8), title: L(x.title, 60), sub: L(x.sub, 90) }));
    return out;
  }).filter((g) => g.id && g.title.id && g.features.length);
  return { schema: 1, groups };
}
route('POST', '/builder/features', 'builder', async ({ request, env }) => {
  const b = await readJson(request);
  let doc;
  try { doc = JSON.parse(new TextDecoder().decode(unb64(String(b.json_b64 || '')))); } catch { fail(400, 'Dokumentasi fitur bukan JSON yang valid'); }
  const clean = cleanFeatures(doc);
  if (!clean.groups.length) fail(400, 'Dokumentasi fitur kosong');
  const data = b64(new TextEncoder().encode(JSON.stringify({ ...clean, version: str(b.version, 12), at: now() })));
  const t = now();
  const old = await env.DB.prepare("SELECT id FROM files WHERE kind='ea_features'").all();
  await env.DB.prepare("INSERT INTO files (user_id, kind, name, mime, size, data_b64, created_at) VALUES (NULL, 'ea_features', 'features.json', 'application/json', ?, ?, ?)")
    .bind(b64Len(data), data, t).run();
  if (old.results.length) await env.DB.batch(old.results.map((x) => env.DB.prepare('DELETE FROM files WHERE id=?').bind(x.id)));
  const meta = { version: str(b.version, 12), sha: str(b.sha, 80), at: t, groups: clean.groups.length, features: clean.groups.reduce((a, g) => a + g.features.length, 0) };
  await putSetting(env, 'ea_features_meta', JSON.stringify(meta));
  return json({ ok: true, ...meta });
});
route('GET', '/features', 'public', async ({ env }) => {
  const f = await env.DB.prepare("SELECT data_b64 FROM files WHERE kind='ea_features' ORDER BY id DESC LIMIT 1").first();
  if (!f) return json({ schema: 1, groups: [], version: '' }, 200, { 'cache-control': 'public, max-age=60' });
  return new Response(unb64(f.data_b64), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300' } });
});
route('GET', '/vps/release', 'public', async ({ request, env, url }) => {
  const rel = vpsRelease(await vpsAuth(env, request));
  if (!rel) return json({ ok: true, none: true, ...agentUpdate });
  if (url.searchParams.get('have') === rel.sha) return json({ ok: true, same: true, version: rel.version, sha: rel.sha, ...agentUpdate });
  return json({ ok: true, ...rel, ...agentUpdate });
});
// The agent script itself, so a running agent can self-update (master key).
route('GET', '/vps/agent', 'public', async ({ request, env }) => {
  await vpsAuth(env, request);
  return new Response(AGENT_PS1_BODY, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'private, no-store' } });
});
route('GET', '/vps/file/:id', 'public', async ({ request, env, params }) => {
  await vpsAuth(env, request);
  const f = await env.DB.prepare("SELECT name, data_b64 FROM files WHERE id=? AND kind IN ('vps_ex5','vps_preset')").bind(int(params.id)).first();
  if (!f) fail(404, 'File rilis tidak ada (sudah diganti rilis baru?)');
  return new Response(unb64(f.data_b64), { headers: { 'content-type': 'application/octet-stream', 'cache-control': 'private, no-store' } });
});
route('POST', '/vps/status', 'public', async ({ request, env }) => {
  await vpsAuth(env, request);
  const b = await readJson(request);
  const host = str(b.host, 60);
  if (!host) fail(400, 'Nama VPS kosong');
  const terms = (Array.isArray(b.terminals) ? b.terminals : []).slice(0, 40).map((x) => ({ data: str(x.data, 200), origin: str(x.origin, 200), running: !!x.running, ok: x.ok !== false }));
  const t = now();
  await env.DB.prepare(`INSERT INTO ea_vps (host, version, sha, terminals, note, updated_at, installed_at) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(host) DO UPDATE SET version=excluded.version, sha=excluded.sha, terminals=excluded.terminals, note=excluded.note, updated_at=excluded.updated_at,
      installed_at=CASE WHEN excluded.installed_at > 0 THEN excluded.installed_at ELSE installed_at END`)
    .bind(host, str(b.version, 12), str(b.sha, 80), JSON.stringify(terms), str(b.note, 300), t, b.installed ? t : 0).run();
  return json({ ok: true });
});
route('GET', '/admin/vps', 'admin', async ({ env }) => {
  const s = await getSettings(env);
  const { results } = await env.DB.prepare('SELECT * FROM ea_vps ORDER BY host').all();
  const profs = await env.DB.prepare('SELECT login, server, platform, host, profile_name, charts, ea_charts, size, updated_at, experts_ini FROM ea_vps_master_profile ORDER BY login, server').all();
  return json({ release: vpsRelease(s), key_set: !!String(s.ea_master_key || '').trim(), agent_version: AGENT_VERSION,
    agents: results.map((r) => { let tm = []; try { tm = JSON.parse(r.terminals || '[]'); } catch { tm = []; } return { ...r, terminals: tm }; }),
    profiles: profs.results.map((p) => ({ login: p.login, server: p.server, platform: p.platform, host: p.host, profile_name: p.profile_name,
      charts: p.charts, ea_charts: p.ea_charts, size: p.size, updated_at: p.updated_at, has_webrequest_urls: /^WebRequestUrl=/m.test(p.experts_ini || '') })) });
});
route('DELETE', '/admin/vps/:host', 'admin', async ({ env, params }) => {
  await env.DB.prepare('DELETE FROM ea_vps WHERE host=?').bind(decodeURIComponent(params.host)).run();
  return json({ ok: true });
});
// Agent files for the VPS (same agent + installer for the admin's master mode and the member's licence mode)
const agentFile = (name, body, mime) => new Response(body, { headers: { 'content-type': mime, 'content-disposition': `attachment; filename="${name}"`, 'cache-control': 'private, no-store' } });
function agentScript(f) {
  if (f === 'agent') return agentFile('GHG-VPS-Agent.ps1', '\ufeff' + AGENT_PS1.replace(/\r?\n/g, '\r\n'), 'text/plain; charset=utf-8');
  if (f === 'install') return agentFile('Pasang-Agen-VPS.bat', AGENT_BAT.replace(/\r?\n/g, '\r\n'), 'text/plain; charset=utf-8');
  return null;
}
const agentConfig = (base, fields) => agentFile('config.json', JSON.stringify(agentDefaults(base, fields), null, 2), 'application/json');
// ---- One-file installer "GOLD HUNTER GARUDA - Installer <account>.cmd": a CMD that elevates itself (UAC) and unpacks
// the agent + config.json (base64 blocks after the batch part, never executed by cmd) into THE FOLDER WHERE THE .cmd ITSELF
// IS (recommended C:\GOLD HUNTER GARUDA). Re-run from another folder = the old agent / task is stopped and moved there.
// The agent then runs -Setup: EA + presets into every MetaTrader logged into the account; a backed-up chart profile is
// restored ONLY into a terminal whose active profile has no GOLD HUNTER GARUDA EA yet (running setups are never changed),
// and the "GHG VPS Agent" task (logon, highest rights) is registered by the PowerShell part. Admin (master key): same, all accounts.
const crlf = (s) => String(s).replace(/\r?\n/g, '\r\n');
const b64Block = (name, text) => `::BEGIN ${name}\r\n${b64(new TextEncoder().encode(text)).match(/.{1,76}/g).join('\r\n')}\r\n::END ${name}`;
const INSTALLER_BAT = String.raw`@echo off
rem ============================================================================
rem  GOLD HUNTER GARUDA - Installer __LABEL__  (goldhuntergaruda.com)
rem  1. Buat folder C:\GOLD HUNTER GARUDA dan taruh file ini di sana.
rem  2. Klik dua kali file ini, klik Yes saat Windows meminta izin Administrator.
rem  Agen update otomatis dipasang di folder tempat file ini berada, EA berlisensi +
rem  preset dipasang di setiap MetaTrader yang login di akun ini. Setup chart yang
rem  sudah berjalan TIDAK diubah. Task "GHG VPS Agent" didaftarkan otomatis.
rem  Berisi kunci lisensi akun ini: JANGAN dibagikan ke orang lain.
rem ============================================================================
setlocal
title GOLD HUNTER GARUDA - Installer __LABEL__
set "GHG_SELF=%~f0"
net session >nul 2>&1
if not errorlevel 1 goto run
if /i "%~1"=="elevated" goto noadmin
echo Meminta izin Administrator... klik Yes pada jendela Windows.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath $env:GHG_SELF -ArgumentList 'elevated' -Verb RunAs"
if errorlevel 1 goto noadmin
exit /b 0
:noadmin
echo.
echo Installer butuh hak Administrator. Klik kanan file ini ^> Run as administrator.
echo.
pause
exit /b 1
:run
set "GHG_BOOT=%TEMP%\ghg-installer-%RANDOM%%RANDOM%.ps1"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$t=[IO.File]::ReadAllLines($env:GHG_SELF); $s=[array]::IndexOf($t,'::BEGIN BOOT'); $e=[array]::IndexOf($t,'::END BOOT'); [IO.File]::WriteAllBytes($env:GHG_BOOT,[Convert]::FromBase64String(($t[($s+1)..($e-1)] -join '')))"
if not exist "%GHG_BOOT%" goto broken
powershell -NoProfile -ExecutionPolicy Bypass -File "%GHG_BOOT%" -Installer "%GHG_SELF%"
set "GHG_RC=%errorlevel%"
del "%GHG_BOOT%" >nul 2>&1
echo.
pause
exit /b %GHG_RC%
:broken
echo Installer rusak / terpotong, atau diblokir antivirus. Unduh ulang dari member area.
pause
exit /b 1
`;
function installerCmd(label, cfg) {
  const bat = INSTALLER_BAT.replace(/__LABEL__/g, String(label).replace(/[^0-9A-Za-z ]/g, ''));
  return [crlf(bat).trimEnd(), b64Block('BOOT', '\ufeff' + crlf(INSTALLER_PS1)), b64Block('AGENT', '\ufeff' + crlf(AGENT_PS1)),
    b64Block('CONFIG', JSON.stringify(cfg, null, 2)), ''].join('\r\n');
}
const installerFile = (name, body) => new Response(body, { headers: { 'content-type': 'application/octet-stream',
  'content-disposition': `attachment; filename="${name}"`, 'cache-control': 'private, no-store' } });
const agentDefaults = (base, fields) => ({ web: base || 'https://goldhuntergaruda.com', ...fields,
  interval_seconds: 60, restart_terminals: true, restart_gap_seconds: 20, profile_backup_minutes: 10, extra_data_dirs: [] });
// Admin: config.json comes with the web address and the master key filled in.
route('GET', '/admin/vps/installer', 'admin', async ({ env, base }) => {
  const key = String((await getSettings(env)).ea_master_key || '').trim();
  if (!key) fail(400, 'Buat & simpan kunci master dulu (Pengaturan > EA Live)');
  return installerFile('GOLD HUNTER GARUDA - Installer Admin.cmd', installerCmd('VPS admin', agentDefaults(base, { key })));
});
route('GET', '/admin/vps/download', 'admin', async ({ env, url, base }) => {
  const f = url.searchParams.get('f');
  const script = agentScript(f);
  if (script) return script;
  if (f === 'config') {
    const s = await getSettings(env);
    const key = String(s.ea_master_key || '').trim();
    if (!key) fail(400, 'Buat & simpan kunci master dulu (Pengaturan > EA Live)');
    return agentConfig(base, { key });
  }
  fail(404, 'File tidak dikenal');
});

// ---- Member VPS agent (licence mode): installs the member's own licence-locked EA build on their VPS.
// GET /vps/lic/release?have=<build_id> -> none | same | the current build + the generic presets of the owner's release
// Presets fingerprint: the builder republishes presets via /builder/vps-release without a new licence build, so the
// release carries sha_presets (fallback: names + sizes). Agent 1.5+ sends it back as ?presets=<fp>; when the build is the
// same but the fingerprint differs, the reply carries the new preset list (presets_changed) and the agent installs only
// the presets (no MetaTrader restart).
async function presetsFp(rel) {
  if (!rel || !Array.isArray(rel.presets) || !rel.presets.length) return '';
  if (rel.sha_presets) return String(rel.sha_presets);
  return (await sha256(rel.presets.map((p) => `${p.name}:${p.size}`).sort().join('|'))).slice(0, 40);
}
route('GET', '/vps/lic/release', 'public', async ({ request, env, url }) => {
  const l = await licAuth(env, request.headers.get('x-lic-key'));
  const b = await licCurrentFile(env, l);
  if (!b) return json({ ok: true, none: true, account: l.account_number, platform: l.platform, ...licAgentUpdate });
  const rel = vpsRelease(await getSettings(env));
  const presets = rel ? rel.presets : [];
  const presets_sha = await presetsFp(rel);
  if (String(url.searchParams.get('have') || '') === String(b.id)) {
    const out = { ok: true, same: true, build_id: b.id, version: b.ea_version || '', account: l.account_number, presets_sha, ...licAgentUpdate };
    const hp = url.searchParams.get('presets');
    // only agents that send ?presets= (1.5+) get the list; older agents keep the light answer
    if (hp !== null && hp !== presets_sha && presets.length) Object.assign(out, { presets_changed: true, presets });
    return json(out);
  }
  return json({ ok: true, build_id: b.id, version: b.ea_version || '', platform: l.platform, account: l.account_number,
    ex5: { id: b.file_id, name: str(b.name, 120).replace(/[\\/:*?"<>|]/g, '') || `GOLD HUNTER GARUDA_${l.account_number}.${l.platform === 'mt4' ? 'ex4' : 'ex5'}`, size: b.size },
    presets, presets_sha, expires_at: b.expires_at || 0, license_expires_at: l.expires_at || 0, ...licAgentUpdate });
});
// the agent script (licence key), so a running member agent can self-update
route('GET', '/vps/lic/agent', 'public', async ({ request, env }) => {
  await licAuth(env, request.headers.get('x-lic-key'));
  return new Response(AGENT_PS1_BODY, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'private, no-store' } });
});
// only this licence's current EA file or one of the release presets
route('GET', '/vps/lic/file/:id', 'public', async ({ request, env, params }) => {
  const l = await licAuth(env, request.headers.get('x-lic-key'));
  const id = int(params.id);
  const b = await licCurrentFile(env, l);
  const f = b && b.file_id === id
    ? await env.DB.prepare("SELECT name, data_b64 FROM files WHERE id=? AND kind='ea'").bind(id).first()
    : await env.DB.prepare("SELECT name, data_b64 FROM files WHERE id=? AND kind='vps_preset'").bind(id).first();
  if (!f) fail(404, 'File tidak ada (sudah diganti build baru?)');
  return new Response(unb64(f.data_b64), { headers: { 'content-type': 'application/octet-stream', 'cache-control': 'private, no-store' } });
});
route('POST', '/vps/lic/status', 'public', async ({ request, env }) => {
  const l = await licAuth(env, request.headers.get('x-lic-key'));
  const b = await readJson(request);
  const host = str(b.host, 60);
  if (!host) fail(400, 'Nama VPS kosong');
  const terms = (Array.isArray(b.terminals) ? b.terminals : []).slice(0, 40).map((x) => ({ data: str(x.data, 200), origin: str(x.origin, 200), login: str(x.login, 20),
    matched: !!x.matched, running: !!x.running }));
  const t = now();
  await env.DB.prepare(`INSERT INTO ea_vps_lic (license_id, host, version, build_id, agent, terminals, note, updated_at, installed_at) VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(license_id, host) DO UPDATE SET version=excluded.version, build_id=excluded.build_id, agent=excluded.agent, terminals=excluded.terminals,
      note=excluded.note, updated_at=excluded.updated_at, installed_at=CASE WHEN excluded.installed_at > 0 THEN excluded.installed_at ELSE installed_at END`)
    .bind(l.id, host, str(b.version, 20), int(b.build_id) || 0, str(b.agent, 12), JSON.stringify(terms), str(b.note, 300), t, b.installed ? t : 0).run();
  return json({ ok: true });
});
// ---- Chart profile backup (agent 1.3+): the licensed terminal's active chart profile (charts, EA + inputs) and the
// [Experts] lines of its common.ini, uploaded when it changes. The one-file installer restores it on a new VPS.
const PROFILE_MAX_B64 = 1500000;                       // all files together, base64 characters (D1 row limit is 2 MB)
const PROFILE_FILE_RE = /^[A-Za-z0-9 _.()-]{1,80}$/;  // plain file names only, no folders
const PROFILE_SECRET_RE = /pass|login|token|secret|key/i;
const profileMeta = (p) => p ? { updated_at: p.updated_at, host: p.host, login: p.login, server: p.server, profile_name: p.profile_name,
  charts: p.charts, ea_charts: p.ea_charts, size: p.size, has_webrequest_urls: /^WebRequestUrl=/m.test(p.experts_ini || '') } : null;
// a chart file (UTF-16LE with BOM in MT5, ANSI / UTF-8 in MT4) with GOLD HUNTER GARUDA attached
function chrHasGhg(b64data) {
  try {
    const u = unb64(b64data);
    const text = new TextDecoder(u[0] === 0xff && u[1] === 0xfe ? 'utf-16le' : 'utf-8').decode(u);
    return /<expert>\s*name=GOLD HUNTER GARUDA/i.test(text);
  } catch { return false; }
}
// Validate an uploaded profile (shared by licence and master mode): plain file names, at least one .chr, size cap,
// no credential lines in [Experts]. Returns the cleaned fields or throws a 4xx.
function parseProfileUpload(b) {
  const sha = str(b.sha, 80);
  if (!/^[0-9a-f]{64}$/i.test(sha)) fail(400, 'sha tidak valid');
  const files = [];
  let total = 0;
  for (const f of (Array.isArray(b.files) ? b.files : []).slice(0, 120)) {
    const name = str(f && f.name, 80);
    const data = String((f && f.b64) || '');
    if (!PROFILE_FILE_RE.test(name) || name.startsWith('.') || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) fail(400, `Nama / isi file profil tidak valid: ${name}`);
    total += data.length;
    files.push({ name, b64: data });
  }
  if (!files.some((f) => /\.chr$/i.test(f.name))) fail(400, 'Profil tanpa chart (*.chr)');
  if (total > PROFILE_MAX_B64) fail(413, `Backup profil terlalu besar (${Math.round(total / 1024)} KB, maks ${Math.round(PROFILE_MAX_B64 / 1024)} KB)`);
  // only key=value lines of [Experts]; anything that looks like a credential is dropped
  const experts = String(b.experts_ini || '').split(/\r?\n/).map((x) => x.trim())
    .filter((x) => /^[A-Za-z][A-Za-z0-9_]{0,40}=[^\r\n]{0,8000}$/.test(x) && !PROFILE_SECRET_RE.test(x.split('=')[0])).slice(0, 40).join('\n');
  return { sha, files, experts, size: files.reduce((n, f) => n + b64Len(f.b64), 0),
    charts: files.filter((f) => /\.chr$/i.test(f.name)).length,
    eaCharts: files.filter((f) => /\.chr$/i.test(f.name) && chrHasGhg(f.b64)).length };
}
route('POST', '/vps/lic/profile', 'public', async ({ request, env }) => {
  const l = await licAuth(env, request.headers.get('x-lic-key'));
  if (int(request.headers.get('content-length')) > PROFILE_MAX_B64 + 200000) fail(413, 'Backup profil terlalu besar');
  const b = await readJson(request);
  const login = str(b.login, 20);
  if (login !== String(l.account_number)) fail(409, `Profil dari akun ${login || '?'} ditolak: lisensi ini untuk akun ${l.account_number}`);
  const old = await env.DB.prepare('SELECT sha FROM ea_vps_profile WHERE license_id=?').bind(l.id).first();
  const p = parseProfileUpload(b);
  const t = now();
  if (old && old.sha === p.sha) return json({ ok: true, same: true });
  await env.DB.prepare(`INSERT INTO ea_vps_profile (license_id, platform, login, server, host, profile_name, files, experts_ini, charts, ea_charts, size, sha, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(license_id) DO UPDATE SET platform=excluded.platform, login=excluded.login, server=excluded.server,
      host=excluded.host, profile_name=excluded.profile_name, files=excluded.files, experts_ini=excluded.experts_ini, charts=excluded.charts,
      ea_charts=excluded.ea_charts, size=excluded.size, sha=excluded.sha, updated_at=excluded.updated_at`)
    .bind(l.id, l.platform === 'mt4' ? 'mt4' : 'mt5', login, str(b.server, 80), str(b.host, 60), str(b.profile_name, 80).replace(/[\\/:*?"<>|]/g, ''),
      JSON.stringify(p.files), p.experts, p.charts, p.eaCharts, p.size, p.sha, t).run();
  return json({ ok: true, updated_at: t });
});
// latest backup (?meta=1: without the files)
route('GET', '/vps/lic/profile', 'public', async ({ request, env, url }) => {
  const l = await licAuth(env, request.headers.get('x-lic-key'));
  const p = await env.DB.prepare('SELECT * FROM ea_vps_profile WHERE license_id=?').bind(l.id).first();
  if (!p) return json({ ok: true, none: true });
  const meta = { ok: true, ...profileMeta(p), platform: p.platform, sha: p.sha };
  if (url.searchParams.get('meta') === '1') return json(meta);
  let files = []; try { files = JSON.parse(p.files || '[]'); } catch { files = []; }
  return json({ ...meta, files, experts_ini: p.experts_ini });
});

// ---- Master-mode profile backups (owner's VPS, master key). One row per account login + server + platform.
route('POST', '/vps/profile', 'public', async ({ request, env, url }) => {
  await vpsAuth(env, request);
  if (int(request.headers.get('content-length')) > PROFILE_MAX_B64 + 200000) fail(413, 'Backup profil terlalu besar');
  const b = await readJson(request);
  const login = str(b.login || url.searchParams.get('login'), 20);
  if (!/^\d{3,20}$/.test(login)) fail(400, 'Login akun tidak valid');
  const server = str(b.server, 80);
  const platform = b.platform === 'mt4' ? 'mt4' : 'mt5';
  const old = await env.DB.prepare('SELECT sha FROM ea_vps_master_profile WHERE login=? AND server=? AND platform=?').bind(login, server, platform).first();
  const p = parseProfileUpload(b);
  const t = now();
  if (old && old.sha === p.sha) return json({ ok: true, same: true });
  await env.DB.prepare(`INSERT INTO ea_vps_master_profile (login, server, platform, host, profile_name, files, experts_ini, charts, ea_charts, size, sha, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(login, server, platform) DO UPDATE SET host=excluded.host, profile_name=excluded.profile_name,
      files=excluded.files, experts_ini=excluded.experts_ini, charts=excluded.charts, ea_charts=excluded.ea_charts, size=excluded.size, sha=excluded.sha, updated_at=excluded.updated_at`)
    .bind(login, server, platform, str(b.host, 60), str(b.profile_name, 80).replace(/[\\/:*?"<>|]/g, ''),
      JSON.stringify(p.files), p.experts, p.charts, p.eaCharts, p.size, p.sha, t).run();
  return json({ ok: true, updated_at: t });
});
// one login's backup (for -Setup restore): ?login=&server=&platform=; best server match, then any server for the login
route('GET', '/vps/profile', 'public', async ({ request, env, url }) => {
  await vpsAuth(env, request);
  const login = str(url.searchParams.get('login'), 20);
  if (!login) fail(400, 'login kosong');
  const server = str(url.searchParams.get('server'), 80);
  const platform = url.searchParams.get('platform') === 'mt4' ? 'mt4' : 'mt5';
  let p = server ? await env.DB.prepare('SELECT * FROM ea_vps_master_profile WHERE login=? AND server=? AND platform=?').bind(login, server, platform).first() : null;
  if (!p) p = await env.DB.prepare('SELECT * FROM ea_vps_master_profile WHERE login=? AND platform=? ORDER BY updated_at DESC LIMIT 1').bind(login, platform).first();
  if (!p) return json({ ok: true, none: true });
  const meta = { ok: true, ...profileMeta(p), platform: p.platform, sha: p.sha };
  if (url.searchParams.get('meta') === '1') return json(meta);
  let files = []; try { files = JSON.parse(p.files || '[]'); } catch { files = []; }
  return json({ ...meta, files, experts_ini: p.experts_ini });
});
// all backed-up logins with meta (agent -Setup, admin page)
route('GET', '/vps/profiles', 'public', async ({ request, env }) => {
  await vpsAuth(env, request);
  const { results } = await env.DB.prepare('SELECT login, server, platform, host, profile_name, charts, ea_charts, size, updated_at, experts_ini FROM ea_vps_master_profile ORDER BY login, server').all();
  return json({ ok: true, profiles: results.map((p) => ({ ...profileMeta(p), platform: p.platform, experts_ini: undefined })) });
});

// ---- Admin: Telegram bot ----
route('POST', '/admin/telegram/test', 'admin', async ({ env }) => {
  const c = await tgConfig(env);
  if (!c.token) fail(400, 'Token bot belum disimpan');
  if (!c.targets.length) fail(400, 'Belum ada target aktif');
  const results = await Promise.all(c.targets.map(async (t) => {
    const r = await tgSend(c.token, t.chat_id, '🦅 <b>GOLD HUNTER GARUDA</b>\nTes koneksi berhasil. Laporan live EA GOLD HUNTER GARUDA (gambar laporan, peringatan) dan video konten akan dikirim ke sini.');
    return { name: t.name, chat_id: t.chat_id, ok: r.ok, error: r.error || '' };
  }));
  return json({ ok: true, enabled: c.on, held: c.hold, results });
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
    const usd = (v) => { if (v == null) return null; const x = toIdr(v, r.currency, rate); return x == null || !rate ? null : Math.round(x / rate * 100) / 100; };
    const pct = (p) => (r.balance - p) > 0 ? Math.round(p / (r.balance - p) * 10000) / 100 : null;
    const total = r.total_ok ? r.total_profit : null;
    const modal = total != null ? r.balance - total : null;           // start balance + deposits - withdrawals
    const totalPct = total != null && modal > 0 ? Math.round(total / modal * 10000) / 100 : null;
    const row = {
      name: boardName(r.user_name, mode, r.board_hide_name), account: maskAccount(r.account_number), broker: r.broker, platform: r.platform,
      day_idr: idr(r.profit_day), week_idr: idr(r.profit_week), month_idr: idr(r.profit_month), balance_idr: idr(r.balance),
      day_pct: pct(r.profit_day), week_pct: pct(r.profit_week), month_pct: pct(r.profit_month), updated_at: r.updated_at,
      day_usd: usd(r.profit_day), week_usd: usd(r.profit_week), month_usd: usd(r.profit_month), balance_usd: usd(r.balance),
      since: r.started_at || 0, days: r.started_at ? Math.max(0, Math.floor((now() - r.started_at) / DAY)) : 0,
      modal_usd: usd(modal), all_usd: usd(total), all_pct: totalPct,
    };
    if (includeHidden) Object.assign(row, { license_id: r.lid, user_name: r.user_name, user_email: r.user_email, account_number: r.account_number,
      product_name: r.product_name, status: r.status, currency: r.currency, balance: r.balance, equity: r.equity, positions: r.positions,
      ea_version: r.ea_version, board_show: r.board_show, board_hide_name: r.board_hide_name, stale: r.updated_at <= stale, started_at: r.started_at, total_ok: r.total_ok });
    return row;
  }).filter((r) => includeHidden || r.month_idr != null || r.month_usd != null);
}

route('GET', '/board', 'public', async ({ env, url, waitUntil }) => {
  const s = await getSettings(env);
  if (s.board_enabled !== '1') return json({ enabled: false, rows: [] });
  const period = ['day', 'week', 'month', 'all'].includes(url.searchParams.get('period')) ? url.searchParams.get('period') : 'all';
  const { rate, source } = await getUsdIdr(env, waitUntil);
  // ranked by % of capital, so small and large accounts compare fairly
  const rows = (await boardRows(env, rate)).sort((a, b) => ((b[period + '_pct'] ?? -1e9) - (a[period + '_pct'] ?? -1e9)) || ((b[period + '_usd'] || 0) - (a[period + '_usd'] || 0)));
  const limit = Math.min(int(url.searchParams.get('limit')) || 500, 500);
  return new Response(JSON.stringify({
    enabled: true, period, usd_idr: rate, rate_source: source, generated_at: now(), landing_top: Number(s.board_landing_top || 10),
    total_accounts: rows.length, total_idr: rows.reduce((a, r) => a + (r[period + '_idr'] || 0), 0),
    total_usd: Math.round(rows.reduce((a, r) => a + (r[period + '_usd'] || 0), 0) * 100) / 100, rows: rows.slice(0, limit),
  }), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=60' } });
});

route('GET', '/admin/board', 'admin', async ({ env, waitUntil }) => {
  const { rate } = await getUsdIdr(env, waitUntil);
  const rows = (await boardRows(env, rate, { includeHidden: true })).sort((a, b) => (b.month_idr || 0) - (a.month_idr || 0));
  return json({ usd_idr: rate, rows });
});
// Restart a member's track record (e.g. after the account was reused): lama trading, modal and total count from now.
route('PUT', '/admin/licenses/:id/board-reset', 'admin', async ({ env, params }) => {
  await env.DB.prepare('UPDATE ea_stats SET started_at=?, total_profit=0, total_ok=0 WHERE license_id=?').bind(now(), int(params.id)).run();
  return json({ ok: true });
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
    const dup = await env.DB.prepare(`SELECT 1 FROM orders o JOIN products p ON p.id=o.product_id WHERE p.kind='ea_ib' AND o.account_number=? AND o.broker=?
        AND o.status IN ('awaiting_verification','processing','completed')`).bind(acc.account_number, acc.broker).first();
    if (dup) fail(409, 'Akun ini sudah pernah diajukan untuk EA gratis');
  }
  if (p.kind === 'ea_trial') {
    // one trial per trading account (any member) and per member (any account)
    const dup = await env.DB.prepare(`SELECT o.account_number, o.user_id FROM orders o JOIN products p ON p.id=o.product_id WHERE p.kind='ea_trial'
        AND (o.account_number=? OR o.user_id=?) AND o.status NOT IN ('rejected','cancelled','expired') LIMIT 1`).bind(acc.account_number, user.id).first();
    if (dup) fail(409, dup.user_id === user.id && dup.account_number !== acc.account_number
      ? 'Trial hanya bisa sekali per member. Lanjutkan dengan Sewa EA atau Sharing Profit.'
      : `Akun ${acc.account_number} sudah pernah memakai trial. Lanjutkan dengan Sewa EA atau Sharing Profit.`);
  }
  if (p.kind === 'ea_share') {
    if (!b.agree_share) fail(400, 'Centang persetujuan sharing profit dulu');
    const dup = await env.DB.prepare(`SELECT 1 FROM licenses l JOIN products p ON p.id=l.product_id WHERE p.kind='ea_share' AND l.account_number=?
        AND l.status IN ('processing','active','expired')`).bind(acc.account_number).first();
    if (dup) fail(409, `Akun ${acc.account_number} sudah memakai Sharing Profit`);
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
  // trial and sharing profit are approved automatically: licence + EA build right away
  const auto = p.billing === 'trial' || p.billing === 'share';
  if (auto) await processOrder(env, base, id, { auto: true });
  return json({ ok: true, id, auto });
});

route('GET', '/orders', 'member', async ({ env, user }) => {
  const { results } = await env.DB.prepare(`SELECT o.id, o.code, o.kind, o.status, o.total, o.months, o.platform, o.account_number, o.broker, o.created_at, o.pay_deadline, o.license_id,
      o.pay_method, o.amount_usd, p.name AS product_name, p.billing, p.kind AS product_kind FROM orders o JOIN products p ON p.id=o.product_id WHERE o.user_id=? ORDER BY o.id DESC`).bind(user.id).all();
  return json({ orders: results.map((o) => ({ ...o, status_label: orderStatusLabel(o.status) })) });
});

// Everything the invoice page needs: the order, every payment method that is switched on, the sharing report
async function orderPayView(env, o, waitUntil) {
  const s = await getSettings(env);
  delete o.trading_pass_enc;
  const open = o.status === 'awaiting_payment' && o.total > 0;
  let usdt = null;
  if (usdtOn(s)) {
    const locked = o.pay_method === 'usdt' && o.usdt_amount > 0;
    const pre = locked ? { amount: o.usdt_amount, rate: o.usdt_rate } : open ? await usdtBase(env, o, waitUntil) : { amount: 0, rate: 0 };
    usdt = { network: 'TRC20', address: s.usdt_address, qr: !!s.usdt_qr_file_id, amount: pre.amount, rate: pre.rate, locked, auto: s.usdt_auto !== '0', tx: o.usdt_tx || '' };
  }
  const gc = await gatewayConfig(env, s);
  const cur = gatewayView(o);
  const gateway = gc.on ? { provider: gc.id, name: gc.name, channels: open ? await gatewayChannels(env, s) : [], current: cur && cur.provider === gc.id ? cur : null, sandbox: !gc.production } : null;
  let report = null;
  if (o.share_report_id) {
    report = await env.DB.prepare('SELECT * FROM share_reports WHERE id=?').bind(o.share_report_id).first();
    if (report) { try { report.rows = JSON.parse(report.rows || '[]'); } catch { report.rows = []; } }
  }
  ['usdt_rate', 'gateway_data', 'gateway_seq', 'checked_at', 'reminded_at'].forEach((k) => delete o[k]);
  return { order: { ...o, status_label: orderStatusLabel(o.status) }, banks: activeBanks(s), whatsapp: s.whatsapp || '', usdt, gateway, report,
    durations: o.kind === 'renew' && o.months ? productDurations(await getProduct(env, o.product_id), s) : [] };
}
const ORDER_SQL = `SELECT o.*, p.name AS product_name, p.billing, p.includes_ea, p.includes_vps, p.requires_ib, p.managed_vps, p.kind AS product_kind, p.price AS product_price, p.prices AS product_prices
      FROM orders o JOIN products p ON p.id=o.product_id`;

route('GET', '/orders/:id', 'member', async ({ env, user, params, waitUntil }) => {
  const o = await env.DB.prepare(ORDER_SQL + ' WHERE o.id=? AND o.user_id=?').bind(int(params.id), user.id).first();
  if (!o) fail(404, 'Pesanan tidak ditemukan');
  return json(await orderPayView(env, o, waitUntil));
});

// Member picks / switches the payment method of an unpaid order or invoice: bank | usdt | gateway (+ channel)
route('POST', '/orders/:id/method', 'member', async ({ request, env, user, params, base, waitUntil }) => {
  const b = await readJson(request);
  const o = await env.DB.prepare('SELECT * FROM orders WHERE id=? AND user_id=?').bind(int(params.id), user.id).first();
  if (!o) fail(404, 'Pesanan tidak ditemukan');
  if (o.status !== 'awaiting_payment' || !o.total) fail(409, 'Metode hanya bisa diganti selama tagihan belum dibayar');
  const s = await getSettings(env);
  const method = str(b.method, 12);
  if (method === 'bank') {
    await env.DB.prepare(`UPDATE orders SET pay_method='bank' WHERE id=?`).bind(o.id).run();
  } else if (method === 'usdt') {
    if (!usdtOn(s)) fail(400, 'Pembayaran USDT belum aktif');
    await usdtLock(env, o, waitUntil);
  } else if (method === 'gateway') {
    const channel = str(b.channel, 30).toUpperCase();
    const cur = gatewayView(o);
    // same provider + channel and the transaction is still valid: keep it (same pay code / QR)
    if (o.gateway_ref && cur && cur.provider === s.gateway_provider && o.gateway_method === channel && cur.expired_time > now() + 300) {
      await env.DB.prepare(`UPDATE orders SET pay_method='gateway' WHERE id=?`).bind(o.id).run();
    } else await gatewayCreate(env, base, s, o, channel);
  } else fail(400, 'Metode pembayaran tidak dikenal');
  return json({ ok: true });
});

// "Saya sudah bayar": look for the payment now (USDT on chain, gateway status). Optional tx = TRC20 transaction id.
route('POST', '/orders/:id/check', 'member', async ({ request, env, user, params, base }) => {
  const b = await readJson(request);
  let o = await env.DB.prepare('SELECT * FROM orders WHERE id=? AND user_id=?').bind(int(params.id), user.id).first();
  if (!o) fail(404, 'Pesanan tidak ditemukan');
  const tx = str(b.tx, 80).replace(/^0x/i, '');
  if (tx && !/^[0-9a-fA-F]{64}$/.test(tx)) fail(400, 'TX hash tidak valid (64 karakter heksadesimal)');
  let note = '';
  if (o.status === 'awaiting_payment' && o.total > 0 && (now() - (o.checked_at || 0) >= 15 || tx)) {
    await env.DB.prepare('UPDATE orders SET checked_at=? WHERE id=?').bind(now(), o.id).run();
    const s = await getSettings(env);
    if (o.pay_method === 'usdt') {
      const r = await usdtScan(env, base, { orderId: o.id, txid: tx.toLowerCase() });
      if (r.error) note = 'Blockchain belum bisa dicek: ' + r.error;
    } else if (o.pay_method === 'gateway') {
      try { await gatewayCheck(env, base, s, o); } catch (e) { note = String(e.message || e); }
    }
    o = await env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(o.id).first();
  }
  return json({ ok: true, status: o.status, status_label: orderStatusLabel(o.status), paid: !!o.paid_via || !['awaiting_payment'].includes(o.status), note });
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
  await env.DB.prepare(`UPDATE orders SET status='awaiting_verification', pay_method=CASE WHEN pay_method='' THEN 'bank' ELSE pay_method END, proof_file_id=?, payer_name=?, payer_bank=?, member_note=?, confirmed_at=?, admin_note='' WHERE id=?`)
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
  if (s.auto_process_paid === '1' && !p.requires_ib && o.kind !== 'share') await processOrder(env, base, o.id, { paid: true });
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
  // sharing invoices cannot be cancelled (the licence stays paused until they are paid)
  const r = await env.DB.prepare(`UPDATE orders SET status='cancelled' WHERE id=? AND user_id=? AND kind<>'share' AND paid_via='' AND status IN ('awaiting_payment','awaiting_verification') AND proof_file_id IS NULL`)
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
    report: await env.DB.prepare('SELECT currency, balance, equity, profit_day, profit_week, profit_month, positions, updated_at, started_at, total_profit, total_ok FROM ea_stats WHERE license_id=?').bind(l.id).first(),
    // member VPS agents installing this licence's EA automatically (newest heartbeat first)
    vps_agents: l.includes_ea ? vpsAgents((await env.DB.prepare('SELECT host, version, build_id, agent, terminals, note, updated_at, installed_at FROM ea_vps_lic WHERE license_id=? ORDER BY updated_at DESC LIMIT 10').bind(l.id).all()).results) : [],
    // latest chart-profile backup from the agent (restored by the one-file installer on a new VPS)
    profile_backup: l.includes_ea ? profileMeta(await env.DB.prepare('SELECT updated_at, host, login, server, profile_name, charts, ea_charts, size, experts_ini FROM ea_vps_profile WHERE license_id=?').bind(l.id).first()) : null,
  };
  if (l.billing === 'share') {
    // weekly reports (newest first) + open invoices
    const { results: reps } = await env.DB.prepare(`SELECT r.id, r.period_start, r.period_end, r.rows, r.profit_usd, r.commission_pct, r.commission_usd, r.commission_idr, r.status, r.note, r.order_id,
        o.code AS order_code, o.status AS order_status, o.total AS order_total FROM share_reports r LEFT JOIN orders o ON o.id=r.order_id
        WHERE r.license_id=? ORDER BY r.period_start DESC LIMIT ${forAdmin ? 26 : 8}`).bind(l.id).all();
    out.share = { reports: reps.map((r) => { let rows = []; try { rows = JSON.parse(r.rows || '[]'); } catch {} return { ...r, rows }; }),
      next_period_start: l.share_next || 0 };
  }
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
  const { results: renewals } = await env.DB.prepare(`SELECT id, license_id, code, kind, status, total, pay_deadline FROM orders WHERE user_id=? AND kind IN ('renew','share')
      AND status IN ('awaiting_payment','awaiting_verification','processing')`).bind(user.id).all();
  return json({ licenses, changes, renewals });
});

// Member: VPS agent files for one licence (?f=agent|install|config). config.json carries the licence key;
// ?all=1 puts every active EA licence of the member into one config (several accounts on one VPS).
route('GET', '/licenses/:id/agent', 'member', async ({ env, user, params, url, base }) => {
  const l = await env.DB.prepare(LICENSE_SQL + ' WHERE l.id=? AND l.user_id=?').bind(int(params.id), user.id).first();
  if (!l) fail(404, 'Lisensi tidak ditemukan');
  if (!l.includes_ea) fail(400, 'Paket ini tidak berisi EA');
  const f = url.searchParams.get('f');
  const script = agentScript(f);
  if (script) return script;
  if (f !== 'config') fail(404, 'File tidak dikenal');
  const entry = async (x) => ({ id: x.id, key: licKey(x.id, await ensureReportToken(env, x.id)), account: x.account_number, platform: x.platform });
  if (url.searchParams.get('all') === '1') {
    const { results } = await env.DB.prepare(LICENSE_SQL + ` WHERE l.user_id=? AND p.includes_ea=1 AND l.status='active' ORDER BY l.id`).bind(user.id).all();
    const list = results.some((x) => x.id === l.id) ? results : [l, ...results];
    const licenses = [];
    for (const x of list) licenses.push(await entry(x));
    return agentConfig(base, { licenses });
  }
  return agentConfig(base, { license: await entry(l) });
});

// Member: the one-file installer for a new PC / VPS (agent + this licence's config, runs -Setup)
route('GET', '/licenses/:id/installer', 'member', async ({ env, user, params, base }) => {
  const l = await env.DB.prepare(LICENSE_SQL + ' WHERE l.id=? AND l.user_id=?').bind(int(params.id), user.id).first();
  if (!l) fail(404, 'Lisensi tidak ditemukan');
  if (!l.includes_ea) fail(400, 'Paket ini tidak berisi EA');
  if (l.status !== 'active') fail(409, 'Lisensi belum / tidak aktif');
  const account = String(l.account_number).replace(/[^0-9A-Za-z]/g, '') || String(l.id);
  const cfg = agentDefaults(base, { license: { id: l.id, key: licKey(l.id, await ensureReportToken(env, l.id)), account: l.account_number, platform: l.platform } });
  return installerFile(`GOLD HUNTER GARUDA - Installer ${account}.cmd`, installerCmd(`akun ${account}`, cfg));
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
    // every other kind (master release vps_ex5 / presets, setup presets, QR, ...) has its own guarded route
    if (f.kind !== 'proof' && f.kind !== 'ea') fail(403, 'Tidak diizinkan');
  }
  return new Response(unb64(f.data_b64), {
    headers: {
      'content-type': f.mime,
      'content-disposition': `${f.kind === 'ea' ? 'attachment' : 'inline'}; filename="${f.name.replace(/[^\w.\-]/g, '_')}"`,
      'cache-control': 'private, no-store',
    },
  });
});

// =====================================================================
// RECOMMENDED SETUPS (one EA, one recommended preset per pair) - /setup, landing, member area, Admin > Setup Rekomendasi
// =====================================================================
const REC_RISK = ['low', 'medium', 'high'];
const REC_SYM_RE = /^[A-Z0-9._-]{3,20}$/;
// a member may download presets while one of their EA licences is active (sharing profit: also while paused)
async function hasActiveEaLicence(env, user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const r = await env.DB.prepare(`SELECT 1 FROM licenses l JOIN products p ON p.id=l.product_id WHERE l.user_id=? AND p.includes_ea=1
      AND l.status='active' AND (l.expires_at IS NULL OR l.expires_at > ? OR p.kind='ea_share') LIMIT 1`).bind(user.id, now()).first();
  return !!r;
}
// where the preset of a setup comes from: an uploaded file, else the builder's release preset with that name
function recPreset(r, rel) {
  if (r.preset_file_id) return { source: 'upload', file_id: r.preset_file_id, name: r.upload_name || r.preset_name || `${r.symbol}.set` };
  const p = r.preset_name && rel && Array.isArray(rel.presets) ? rel.presets.find((x) => x.name === r.preset_name) : null;
  return p ? { source: 'release', file_id: p.id, name: p.name, version: rel.version || '' } : null;
}
const recPublic = (r, rel) => {
  const p = recPreset(r, rel);
  return { id: r.id, symbol: r.symbol, title: r.title, title_en: r.title_en, style: r.style, style_en: r.style_en, risk: r.risk, account_type: r.account_type,
    capital_per_lot: r.capital_per_lot, budget: r.budget, timeframe: r.timeframe, summary: r.summary, summary_en: r.summary_en, settings: r.settings,
    settings_en: r.settings_en, updated_at: r.updated_at, has_preset: !!p, preset_name: p ? p.name : '', preset_version: p && p.version ? p.version : '' };
};
// visitors (not logged in): the pair and a short description only, the setup itself is for members
const recBrief = (r) => ({ id: r.id, symbol: r.symbol, title: r.title, title_en: r.title_en, summary: r.summary, summary_en: r.summary_en, updated_at: r.updated_at });
const REC_SQL = `SELECT r.*, f.name AS upload_name FROM rec_setups r LEFT JOIN files f ON f.id=r.preset_file_id AND f.kind='setup_preset'`;
route('GET', '/setups', 'public', async ({ env, user }) => {
  const s = await getSettings(env);
  const rel = vpsRelease(s);
  const { results } = await env.DB.prepare(REC_SQL + ' WHERE r.active=1 ORDER BY r.sort, r.id').all();
  return json({ setups: results.map((r) => (user ? recPublic(r, rel) : recBrief(r))), logged_in: !!user, can_download: await hasActiveEaLicence(env, user),
    ea_version: rel ? rel.version || '' : '' });
});
route('GET', '/setups/:id/preset', 'member', async ({ env, user, params }) => {
  const r = await env.DB.prepare(REC_SQL + ' WHERE r.id=?').bind(int(params.id)).first();
  if (!r || (!r.active && user.role !== 'admin')) fail(404, 'Setup tidak ditemukan');
  if (!(await hasActiveEaLicence(env, user))) fail(403, 'Preset bisa diunduh selama Anda punya lisensi EA aktif (Sewa, Trial, Free IB atau Sharing Profit)');
  const p = recPreset(r, vpsRelease(await getSettings(env)));
  if (!p) fail(404, 'Preset setup ini belum tersedia. Coba lagi nanti atau hubungi admin.');
  const f = await env.DB.prepare("SELECT name, data_b64 FROM files WHERE id=? AND kind IN ('setup_preset','vps_preset')").bind(p.file_id).first();
  if (!f) fail(404, 'File preset sedang diperbarui, coba lagi sebentar lagi');
  const name = String(p.name || f.name).replace(/[\\/:*?"<>|\r\n]/g, '').trim() || 'GOLD HUNTER GARUDA.set';
  return new Response(unb64(f.data_b64), { headers: {
    'content-type': 'application/octet-stream',
    'content-disposition': `attachment; filename="${name.replace(/[^\w. ()-]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    'cache-control': 'private, no-store' } });
});
route('GET', '/admin/setups', 'admin', async ({ env }) => {
  const rel = vpsRelease(await getSettings(env));
  const { results } = await env.DB.prepare(REC_SQL + ' ORDER BY r.sort, r.id').all();
  return json({ setups: results.map((r) => ({ ...recPublic(r, rel), active: r.active, sort: r.sort, preset_name: r.preset_name, preset_file_id: r.preset_file_id,
      upload_name: r.upload_name || '', preset_source: (recPreset(r, rel) || {}).source || '' })),
    release: rel ? { version: rel.version, at: rel.at, presets: (rel.presets || []).map((p) => p.name) } : null });
});
async function recSave(env, b, old) {
  const symbol = str(b.symbol ?? old?.symbol, 20).toUpperCase();
  if (!REC_SYM_RE.test(symbol)) fail(400, 'Pair tidak valid (contoh XAUUSD)');
  const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : d; };
  const v = {
    symbol, title: str(b.title ?? old?.title, 80), title_en: str(b.title_en ?? old?.title_en, 80), style: str(b.style ?? old?.style, 120), style_en: str(b.style_en ?? old?.style_en, 120),
    risk: REC_RISK.includes(b.risk) ? b.risk : old?.risk || 'medium', account_type: (b.account_type ?? old?.account_type) === 'standard' ? 'standard' : 'cent',
    capital_per_lot: num(b.capital_per_lot, old?.capital_per_lot || 0), budget: num(b.budget, old?.budget || 0), timeframe: str(b.timeframe ?? old?.timeframe ?? 'M1', 10) || 'M1',
    summary: str(b.summary ?? old?.summary, 600), summary_en: str(b.summary_en ?? old?.summary_en, 600), settings: str(b.settings ?? old?.settings, 2000), settings_en: str(b.settings_en ?? old?.settings_en, 2000),
    preset_name: str(b.preset_name ?? old?.preset_name, 120).replace(/[\\/:*?"<>|]/g, ''), active: b.active === undefined ? (old ? old.active : 1) : (b.active ? 1 : 0),
    sort: int(b.sort ?? old?.sort) ?? 0,
  };
  if (!v.title) fail(400, 'Nama setup wajib diisi');
  let fileId = old ? old.preset_file_id : null;
  const t = now();
  // new upload: .set file (UTF-16 as MT5 writes it, or plain text), max ~150 KB
  if (b.preset_upload && b.preset_upload.data_b64) {
    const nm = str(b.preset_upload.name, 120).replace(/[\\/:*?"<>|]/g, '');
    const data = String(b.preset_upload.data_b64);
    if (!nm.toLowerCase().endsWith('.set')) fail(400, 'File preset harus .set');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data) || data.length > 200000) fail(400, 'File preset kosong atau terlalu besar (maks 150 KB)');
    const r = await env.DB.prepare("INSERT INTO files (user_id, kind, name, mime, size, data_b64, created_at) VALUES (NULL, 'setup_preset', ?, 'application/octet-stream', ?, ?, ?)")
      .bind(nm, b64Len(data), data, t).run();
    if (fileId) await env.DB.prepare("DELETE FROM files WHERE id=? AND kind='setup_preset'").bind(fileId).run();
    fileId = r.meta.last_row_id;
  } else if (b.preset_clear_upload && fileId) {
    await env.DB.prepare("DELETE FROM files WHERE id=? AND kind='setup_preset'").bind(fileId).run();
    fileId = null;
  }
  const cols = Object.keys(v);
  if (old) {
    await env.DB.prepare(`UPDATE rec_setups SET ${cols.map((c) => c + '=?').join(', ')}, preset_file_id=?, updated_at=? WHERE id=?`).bind(...cols.map((c) => v[c]), fileId, t, old.id).run();
    return old.id;
  }
  const r = await env.DB.prepare(`INSERT INTO rec_setups (${cols.join(', ')}, preset_file_id, created_at, updated_at) VALUES (${cols.map(() => '?').join(', ')}, ?, ?, ?)`)
    .bind(...cols.map((c) => v[c]), fileId, t, t).run();
  return r.meta.last_row_id;
}
route('POST', '/admin/setups', 'admin', async ({ request, env }) => json({ ok: true, id: await recSave(env, await readJson(request), null) }));
route('PUT', '/admin/setups/:id', 'admin', async ({ request, env, params }) => {
  const old = await env.DB.prepare('SELECT * FROM rec_setups WHERE id=?').bind(int(params.id)).first();
  if (!old) fail(404, 'Setup tidak ditemukan');
  return json({ ok: true, id: await recSave(env, await readJson(request), old) });
});
route('DELETE', '/admin/setups/:id', 'admin', async ({ env, params }) => {
  const old = await env.DB.prepare('SELECT * FROM rec_setups WHERE id=?').bind(int(params.id)).first();
  if (!old) fail(404, 'Setup tidak ditemukan');
  if (old.preset_file_id) await env.DB.prepare("DELETE FROM files WHERE id=? AND kind='setup_preset'").bind(old.preset_file_id).run();
  await env.DB.prepare('DELETE FROM rec_setups WHERE id=?').bind(old.id).run();
  return json({ ok: true });
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
  const shareUnpaid = await one(`SELECT COUNT(*) n, COALESCE(SUM(total),0) amt FROM orders WHERE kind='share' AND status IN ('awaiting_payment','awaiting_verification')`);
  const shareOverdue = await one(`SELECT COUNT(*) n FROM orders WHERE kind='share' AND status='awaiting_payment' AND pay_deadline < ?`, t);
  let builder = null, daily = null, usdtScanLast = null;
  try { builder = JSON.parse(s.builder_seen || 'null'); } catch {}
  try { daily = JSON.parse(s.daily_last_run || 'null'); } catch {}
  try { usdtScanLast = JSON.parse(s.usdt_scan_last || 'null'); } catch {}
  return json({
    share_unpaid: shareUnpaid.n, share_unpaid_amount: shareUnpaid.amt, share_overdue: shareOverdue.n, prices_placeholder: s.prices_placeholder === '1',
    usdt_on: usdtOn(s), usdt_auto: s.usdt_auto !== '0', usdt_scan: usdtScanLast, gateway_on: gatewayReady(s), gateway_name: (PROVIDERS[s.gateway_provider] || {}).name || '',
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
  const kind = url.searchParams.get('kind') || '', method = url.searchParams.get('method') || '', pkind = url.searchParams.get('pkind') || '';
  let sql = `SELECT o.id, o.code, o.kind, o.status, o.total, o.months, o.platform, o.account_number, o.broker, o.broker_server, o.created_at, o.pay_deadline,
      o.confirmed_at, o.ib_status, o.proof_file_id, o.pay_method, o.paid_via, o.amount_usd, o.usdt_amount, p.name AS product_name, p.billing, p.requires_ib, p.includes_vps, p.kind AS product_kind,
      u.name AS user_name, u.email AS user_email, u.phone AS user_phone
      FROM orders o JOIN products p ON p.id=o.product_id JOIN users u ON u.id=o.user_id WHERE 1=1`;
  const args = [];
  if (group === 'ib') sql += ' AND p.requires_ib=1';
  if (group === 'paid') sql += ' AND p.requires_ib=0';
  if (['new', 'renew', 'share'].includes(kind)) { sql += ' AND o.kind=?'; args.push(kind); }
  if (['bank', 'usdt', 'gateway'].includes(method)) { sql += ' AND (o.pay_method=? OR o.paid_via=?)'; args.push(method, method); }
  if (/^[a-z_]{2,20}$/.test(pkind)) { sql += ' AND p.kind=?'; args.push(pkind); }
  if (status === 'overdue') { sql += ` AND o.status='awaiting_payment' AND o.pay_deadline < ?`; args.push(now()); }
  if (status === 'open') sql += ` AND o.status IN ('awaiting_payment','awaiting_verification','processing')`;
  else if (status && status !== 'overdue') { sql += ' AND o.status=?'; args.push(status); }
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
  let report = null;
  if (o.share_report_id) {
    report = await env.DB.prepare('SELECT * FROM share_reports WHERE id=?').bind(o.share_report_id).first();
    if (report) { try { report.rows = JSON.parse(report.rows || '[]'); } catch { report.rows = []; } }
  }
  o.gateway = gatewayView(o);
  delete o.gateway_data;
  return json({ order: { ...o, status_label: orderStatusLabel(o.status) }, proof, license, builds, report });
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
  if (!o.total) fail(400, 'Order gratis tidak perlu pembayaran');
  // same path as automatic payments: new / renewal -> processed, sharing invoice -> licence moves to the next week
  const r = await confirmPaid(env, base, o.id, { via: 'bank', ref: 'admin' });
  if (r.already) fail(409, 'Order ini sudah dibayar / diproses');
  return json({ ok: true, ...r });
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
  const { results: agents } = await env.DB.prepare('SELECT license_id, host, version, build_id, agent, note, updated_at, installed_at FROM ea_vps_lic ORDER BY updated_at DESC').all();
  return json({
    licenses: results.map((l) => ({
      vps_agents: agents.filter((a) => a.license_id === l.id),
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

// Admin extends any licence by days and / or months (from its expiry, or from now when already expired).
// The EA carries the expiry, so a new file is built (the member's VPS agent installs it by itself).
route('POST', '/admin/licenses/:id/extend', 'admin', async ({ request, env, params, base }) => {
  const b = await readJson(request);
  const l = await env.DB.prepare(LICENSE_SQL + ' WHERE l.id=?').bind(int(params.id)).first();
  if (!l) fail(404, 'Lisensi tidak ditemukan');
  if (!l.expires_at) fail(400, 'Lisensi ini tidak punya masa habis (selamanya), tidak perlu diperpanjang');
  if (!['active', 'expired', 'processing'].includes(l.status)) fail(409, 'Lisensi yang dinonaktifkan tidak bisa diperpanjang; ubah statusnya dulu');
  const days = Math.max(0, Math.min(3650, int(b.days) || 0)), months = Math.max(0, Math.min(60, int(b.months) || 0));
  if (!days && !months) fail(400, 'Isi jumlah hari atau bulan');
  const t = now();
  const exp = addMonths(Math.max(t, l.expires_at), months) + days * DAY;
  await env.DB.prepare(`UPDATE licenses SET expires_at=?, status=CASE WHEN status='expired' THEN 'active' ELSE status END, reminder_exp=NULL, reminders_sent='', updated_at=? WHERE id=?`)
    .bind(exp, t, l.id).run();
  const what = [months ? `${months} bulan` : '', days ? `${days} hari` : ''].filter(Boolean).join(' + ');
  const buildId = l.includes_ea ? await queueBuild(env, l.id, `Diperpanjang admin +${what}`) : null;
  const user = await getUser(env, l.user_id);
  await notify(env, l.user_id, `Masa aktif akun ${l.account_number} diperpanjang`, `+${what}, berlaku s/d ${fmtDate(exp)}.${buildId ? ' File EA baru sedang dibuat.' : ''}`, '#/lisensi');
  await emailUser(env, user, `Masa aktif akun ${l.account_number} diperpanjang`,
    `<p>Halo ${esc(user.name)},</p><p>Admin memperpanjang <b>${esc(l.product_name)}</b> untuk akun <b>${esc(l.account_number)}</b> sebanyak <b>${esc(what)}</b>. Berlaku sampai <b>${fmtDate(exp)}</b>.</p>
     ${buildId ? '<p>File EA baru dengan masa aktif ini sedang dibuat. Agen VPS memasangnya otomatis; tanpa agen, unduh ulang file EA di menu <b>Lisensi &amp; VPS</b>.</p>' : ''}`,
    { text: 'Buka Lisensi', url: `${base}/member#/lisensi` });
  return json({ ok: true, expires_at: exp, build_id: buildId });
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
const PRODUCT_KINDS = ['ea_rent', 'ea_ib', 'ea_share', 'ea_trial', 'ib_vps', 'ib_vps_shared', 'ea_lifetime', 'vps_ea', 'vps_ea_shared', 'vps', 'vps_shared'];
function productFields(b) {
  const kind = PRODUCT_KINDS.includes(b.kind) ? b.kind : fail(400, 'Jenis produk tidak valid');
  const billing = { ea_ib: 'free', ea_lifetime: 'lifetime', ea_share: 'share', ea_trial: 'trial' }[kind] || 'monthly';
  // rent: own price per duration (months -> Rupiah); the 1-month price (else the cheapest per month) is the base price
  let prices = '';
  if (billing === 'monthly' && b.prices && typeof b.prices === 'object') {
    const t = parsePrices({ prices: b.prices });
    if (t) prices = JSON.stringify(t);
  }
  let price = int(b.price);
  if (prices) { const t = JSON.parse(prices); price = t[1] || Math.round(Math.min(...Object.entries(t).map(([m, v]) => v / Number(m)))); }
  const free = ['free', 'share', 'trial'].includes(billing);
  if (!free && !(price > 0)) fail(400, 'Harga harus lebih dari 0');
  return [str(b.name, 80) || fail(400, 'Nama produk wajib'), kind, billing, ['vps', 'vps_shared'].includes(kind) ? 0 : 1, ['vps_ea', 'vps', 'vps_shared', 'ib_vps', 'ib_vps_shared', 'vps_ea_shared'].includes(kind) ? 1 : 0,
    ['ea_ib', 'ib_vps', 'ib_vps_shared'].includes(kind) ? 1 : 0, kind.endsWith('_shared') ? 1 : 0, free ? 0 : price, prices, str(b.description, 600), str(b.features, 1500),
    str(b.name_en, 80), str(b.description_en, 600), str(b.features_en, 1500), b.active ? 1 : 0, int(b.sort) || 0];
}
route('POST', '/admin/products', 'admin', async ({ request, env }) => {
  const b = await readJson(request);
  const f = productFields(b);
  await env.DB.prepare(`INSERT INTO products (code, name, kind, billing, includes_ea, includes_vps, requires_ib, managed_vps, price, prices, description, features, name_en, description_en, features_en, active, sort)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(`${f[1]}_${randomToken(4).toLowerCase()}`, ...f).run();
  if (f[8]) await putSetting(env, 'prices_placeholder', '0');
  return json({ ok: true });
});
route('PUT', '/admin/products/:id', 'admin', async ({ request, env, params }) => {
  const b = await readJson(request);
  const f = productFields(b);
  await env.DB.prepare(`UPDATE products SET name=?, kind=?, billing=?, includes_ea=?, includes_vps=?, requires_ib=?, managed_vps=?, price=?, prices=?, description=?, features=?,
      name_en=?, description_en=?, features_en=?, active=?, sort=? WHERE id=?`).bind(...f, int(params.id)).run();
  if (f[8]) await putSetting(env, 'prices_placeholder', '0');   // the owner saved a price table: the sample prices are gone
  return json({ ok: true });
});

const EDITABLE_SETTINGS = ['durations', 'discounts', 'bank_list', 'admin_notify_email', 'whatsapp', 'pay_deadline_hours', 'reminder_days', 'mt4_enabled',
  'ib_brokers', 'auto_complete_ea', 'auto_process_paid', 'welcome_email_password', 'email_provider', 'email_from', 'email_from_name', 'vps_spec',
  'min_capital_usd', 'invoice_days_before', 'auto_rebuild_on_version', 'report_interval_min', 'board_enabled', 'board_name_mode', 'board_landing_top', 'board_stale_days', 'profit_est_enabled', 'profit_est_min_idr', 'profit_est_max_idr', 'profit_est_basis',
  'telegram_enabled', 'telegram_targets', 'telegram_hold', 'usdt_enabled', 'usdt_address', 'usdt_auto',
  'gateway_provider', 'gateway_enabled', 'gateway_mode', 'share_commission_pct', 'share_due_days', 'share_min_idr', 'trial_days',
  'ea_master_key', 'showcase_logins', 'ea_report_hour', 'ea_report_every', 'ea_tg_min_layers', 'ea_offline_min', 'ea_tg_enabled', 'ea_tg_events'];
route('GET', '/admin/settings', 'admin', async ({ env, base }) => {
  const s = await getSettings(env);
  const out = Object.fromEntries(EDITABLE_SETTINGS.map((k) => [k, s[k] ?? '']));
  out.email_api_key_set = !!s.email_api_key_enc;
  out.telegram_bot_token_set = !!s.telegram_bot_token_enc;
  out.telegram_hold = tgHeld(s) ? '1' : '0';
  out.usdt_qr_set = !!s.usdt_qr_file_id;
  // payment secrets: only "saved" + the last 4 characters ever reach the browser
  const hint = async (v) => { if (!v) return ''; const x = await decrypt(env, v); return x && x !== '(gagal didekripsi)' ? '••••' + x.slice(-4) : '(tersimpan)'; };
  out.trongrid_api_key_set = !!s.trongrid_api_key_enc;
  // automatic gateway: every provider with its credential fields (plain values, or saved + hint for secrets)
  out.gateway_providers = [];
  for (const p of Object.values(PROVIDERS)) {
    const fields = [];
    for (const f of p.fields) {
      const v = s[gwKey(p.id, f)] || '';
      fields.push({ key: f.key, label: f.label, secret: !!f.secret, placeholder: f.placeholder || '', value: f.secret ? '' : v, set: !!v, hint: f.secret ? await hint(v) : '' });
    }
    out.gateway_providers.push({ id: p.id, name: p.name, implemented: !!p.implemented, docs: p.docs || '', note: p.note || '', fields, callback_url: `${base}/api/pay/gateway/${p.id}/callback` });
  }
  out.gateway_ready = gatewayReady(s);
  try { out.usdt_scan_last = JSON.parse(s.usdt_scan_last || 'null'); } catch { out.usdt_scan_last = null; }
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
    if (['usdt_enabled', 'telegram_hold', 'usdt_auto', 'gateway_enabled'].includes(k)) v = v === '1' || v === true ? '1' : '0';
    if (k === 'gateway_mode') v = v === 'production' ? 'production' : 'sandbox';
    if (k === 'gateway_provider' && v && !PROVIDERS[v]) fail(400, 'Penyedia pembayaran tidak dikenal');
    if (k === 'share_commission_pct') { v = Number(v); if (!(v >= 0 && v <= 90)) fail(400, 'Komisi sharing profit harus 0 - 90%'); v = String(Math.round(v * 100) / 100); }
    if (k === 'share_due_days') { v = int(v); if (!(v >= 1 && v <= 14)) fail(400, 'Jatuh tempo tagihan sharing 1 - 14 hari'); v = String(v); }
    if (k === 'share_min_idr') v = String(Math.max(0, int(v) || 0));
    if (k === 'trial_days') { v = int(v); if (!(v >= 1 && v <= 60)) fail(400, 'Lama trial 1 - 60 hari'); v = String(v); }
    if (k === 'showcase_logins') {
      const L = String(v || '').split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
      const bad = L.filter((x) => !/^[0-9A-Za-z_-]{1,20}$/.test(x));
      if (bad.length) fail(400, `Nomor akun contoh live tidak valid: ${bad.slice(0, 3).join(', ')} (isi nomor akun, pisahkan koma)`);
      v = [...new Set(L)].slice(0, 40).join(', ');
    }
    if (k === 'ib_brokers') v = v.map((x) => ({ name: str(x.name, 40), link: str(x.link, 300), active: !!x.active })).filter((x) => x.name);
    if (k === 'email_provider' && !['', 'log', 'resend', 'brevo'].includes(v)) fail(400, 'Penyedia email tidak dikenal');
    if (k === 'email_from' && v && !isEmail(str(v, 120))) fail(400, 'Alamat pengirim email tidak valid');
    await putSetting(env, k, typeof v === 'string' ? v.trim() : v);
  }
  if (typeof b.email_api_key === 'string' && b.email_api_key.trim()) await putSetting(env, 'email_api_key_enc', await encrypt(env, b.email_api_key.trim()));
  if (b.email_api_key_clear) await env.DB.prepare(`DELETE FROM settings WHERE key='email_api_key_enc'`).run();
  // TronGrid key + gateway credentials: secrets encrypted like the other secrets, only replaced when typed, cleared on request
  if (typeof b.trongrid_api_key === 'string' && b.trongrid_api_key.trim()) {
    if (!/^[A-Za-z0-9-]{10,100}$/.test(b.trongrid_api_key.trim())) fail(400, 'API key TronGrid tidak valid');
    await putSetting(env, 'trongrid_api_key_enc', await encrypt(env, b.trongrid_api_key.trim()));
  }
  if (b.trongrid_api_key_clear) await env.DB.prepare(`DELETE FROM settings WHERE key='trongrid_api_key_enc'`).run();
  // b.gateway_creds = { <provider>: { <field>: value } }, b.gateway_clear = { <provider>: [field, ...] }
  const creds = b.gateway_creds && typeof b.gateway_creds === 'object' ? b.gateway_creds : {};
  for (const [pid, vals] of Object.entries(creds)) {
    const p = PROVIDERS[pid];
    if (!p || !vals || typeof vals !== 'object') continue;
    for (const f of p.fields) {
      if (typeof vals[f.key] !== 'string') continue;
      const v = vals[f.key].trim();
      if (f.secret && !v) continue;                       // empty secret = keep the saved one
      if (v && f.re && !f.re.test(v)) fail(400, `${p.name}: ${f.label} tidak valid`);
      if (f.secret) await putSetting(env, gwKey(pid, f), await encrypt(env, v));
      else await putSetting(env, gwKey(pid, f), v);
    }
  }
  const clear = b.gateway_clear && typeof b.gateway_clear === 'object' ? b.gateway_clear : {};
  for (const [pid, keys] of Object.entries(clear)) {
    const p = PROVIDERS[pid];
    if (!p || !Array.isArray(keys)) continue;
    for (const f of p.fields) if (keys.includes(f.key)) await env.DB.prepare('DELETE FROM settings WHERE key=?').bind(gwKey(pid, f)).run();
  }
  if (Object.keys(creds).length || b.gateway_provider !== undefined || b.gateway_mode !== undefined) await env.DB.prepare(`DELETE FROM settings WHERE key='gateway_channels'`).run();
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

route('POST', '/admin/run-daily', 'admin', async ({ env, base }) => json({ ok: true, result: await dailyJob(env, base) }));
// Admin tools: gateway connection test (loads the channels), USDT scan now, weekly sharing run now
route('POST', '/admin/gateway/test', 'admin', async ({ env }) => {
  const s = await getSettings(env);
  const p = PROVIDERS[s.gateway_provider];
  if (!p) fail(400, 'Pilih penyedia pembayaran otomatis lalu Simpan dulu');
  if (!p.implemented) fail(400, `${p.name} belum diimplementasikan (menunggu dokumentasi API resmi)`);
  const c = await gatewayConfig(env, s);
  if (!c.configured) fail(400, `Isi semua kredensial ${p.name} lalu Simpan dulu`);
  const channels = await gatewayChannels(env, s, { refresh: true });
  return json({ ok: true, provider: p.name, mode: c.mode, channels });
});
route('POST', '/admin/usdt/scan', 'admin', async ({ env, base }) => json({ ok: true, result: await usdtScan(env, base) }));
route('POST', '/admin/share/run', 'admin', async ({ env, base }) => json({ ok: true, result: await runShareBilling(env, base) }));

// Daily job (GitHub Action 08:00 WIB, builder poll every 20 h, admin button): weekly sharing profit (on Sunday, catches up
// when late), renewal invoices, reminders, expiries, payment checks.
async function dailyJob(env, base) {
  const share = await runShareBilling(env, base).catch((e) => ({ error: String(e.message || e) }));
  const pay = await paymentsTick(env, base).catch((e) => ({ error: String(e.message || e) }));
  return runDaily(env, base, { share, payments: { usdt_matched: (pay.usdt && pay.usdt.matched) || 0, gateway_checked: pay.gateway || 0 } });
}

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
    waitUntil(dailyJob(env, base).catch((e) => console.error('daily', e)));
  }
  // automatic payments: USDT on chain + gateway status at most every 2 minutes while orders wait for them
  if (await eaClaim(env, 'payments_tick_slot', Math.floor(now() / 120))) {
    const open = await env.DB.prepare(`SELECT 1 FROM orders WHERE pay_method IN ('usdt','gateway') AND paid_via='' AND status='awaiting_payment' LIMIT 1`).first();
    if (open) waitUntil(paymentsTick(env, base).catch((e) => console.error('payments', e)));
  }
  const rel = vpsRelease(s);
  return json({ job: await claimBuild(env, str(b.builder_id, 60) || 'builder', b.versions && typeof b.versions === 'object' ? b.versions : {}),
    vps_release: rel ? { version: rel.version, sha: rel.sha, sha_ex5: rel.sha_ex5 || '', sha_presets: rel.sha_presets || '' } : { version: '', sha: '', sha_ex5: '', sha_presets: '' },
    // master key compiled into the owner's release EA (heartbeat to /ea/live); '' = not set yet
    ea_key: String(s.ea_master_key || '').trim() });
});
route('POST', '/builder/result', 'builder', async ({ request, env, base }) => {
  const b = await readJson(request);
  return json(await finishBuild(env, base, {
    id: int(b.id), ok: !!b.ok, log: String(b.log || ''), filename: str(b.filename, 120) || 'GoldHunter_Garuda.ex5',
    data_b64: b.data_b64 || '', ea_version: str(b.ea_version || b.version, 20),
  }));
});
route('POST', '/cron/daily', 'cron', async ({ env, base }) => json({ ok: true, result: await dailyJob(env, base) }));
// Every 10 minutes (GitHub Action payments.yml): USDT transfers + gateway transactions of unpaid orders
route('POST', '/cron/payments', 'cron', async ({ env, base }) => json({ ok: true, result: await paymentsTick(env, base) }));

// Payment notification of the automatic gateway; the provider's adapter verifies it (signature) before anything is paid
route('POST', '/pay/gateway/:provider/callback', 'public', async ({ request, env, base, params }) => {
  const raw = await request.text();
  const [status, body] = await gatewayCallback(env, base, params.provider, raw, request.headers);
  return json(body, status);
});
