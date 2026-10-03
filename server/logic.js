// Business rules: settings, pricing, orders, licenses, builds, reminders.
import { now, DAY, fail, addMonths, fmtDate, rupiah, esc, randomToken } from './util.js';
import { layout, sendEmail } from './email.js';

// ---------- settings ----------
const JSON_KEYS = ['durations', 'discounts', 'reminder_days', 'ib_brokers'];
export async function getSettings(env) {
  const { results } = await env.DB.prepare('SELECT key, value FROM settings').all();
  const s = {};
  for (const r of results) {
    if (JSON_KEYS.includes(r.key)) { try { s[r.key] = JSON.parse(r.value); } catch { s[r.key] = null; } }
    else s[r.key] = r.value;
  }
  s.durations ||= [1, 3, 4, 5, 6, 12];
  s.discounts ||= { 12: 25 };
  s.reminder_days ||= [7, 3, 1];
  s.ib_brokers ||= [];
  return s;
}
export async function putSetting(env, key, value) {
  const v = JSON_KEYS.includes(key) ? JSON.stringify(value) : String(value);
  await env.DB.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .bind(key, v).run();
}

// ---------- pricing ----------
export function quote(product, months, settings) {
  if (product.billing === 'free') return { months: null, unit_price: 0, discount_pct: 0, subtotal: 0 };
  if (product.billing === 'lifetime') {
    return { months: null, unit_price: product.price, discount_pct: 0, subtotal: product.price };
  }
  if (!settings.durations.includes(months)) fail(400, 'Durasi sewa tidak tersedia');
  const discount_pct = Number(settings.discounts[String(months)] || 0);
  const gross = product.price * months;
  return { months, unit_price: product.price, discount_pct, subtotal: Math.round(gross * (100 - discount_pct) / 100) };
}

// ---------- notifications ----------
export async function notify(env, userId, title, body = '', link = '') {
  await env.DB.prepare('INSERT INTO notifications (user_id, title, body, link, created_at) VALUES (?,?,?,?,?)')
    .bind(userId, title, body, link, now()).run();
}
export async function emailUser(env, user, subject, html, cta) {
  return sendEmail(env, user.email, subject, layout(env, subject, html, cta));
}
export async function emailAdmin(env, base, subject, html, link) {
  const s = await getSettings(env);
  const targets = new Set(String(s.admin_notify_email || env.ADMIN_EMAILS || '').split(/[,\s]+/).filter(Boolean));
  for (const to of targets) await sendEmail(env, to, `[Admin] ${subject}`, layout(env, subject, html, link ? { text: 'Buka Admin', url: base + link } : null));
}

// ---------- orders ----------
export async function newOrderCode(env) {
  const d = new Date((now() + 7 * 3600) * 1000);
  const ymd = `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  for (;;) {
    const code = `GHG-${ymd}-${randomToken(4).replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase()}`;
    if (code.length < 15) continue;
    const ex = await env.DB.prepare('SELECT 1 FROM orders WHERE code=?').bind(code).first();
    if (!ex) return code;
  }
}

export async function getUser(env, id) {
  return env.DB.prepare('SELECT id, email, name, phone, role FROM users WHERE id=?').bind(id).first();
}
export async function getProduct(env, id) {
  return env.DB.prepare('SELECT * FROM products WHERE id=?').bind(id).first();
}

// 3-digit unique transfer code (100-999), never shared by two orders created within 30 days.
export async function pickUniqueCode(env, excludeId = 0) {
  const { results } = await env.DB.prepare(`SELECT unique_code FROM orders WHERE created_at > ? AND unique_code > 0 AND id <> ?`)
    .bind(now() - 30 * DAY, excludeId).all();
  const used = new Set(results.map((r) => r.unique_code));
  let free = [];
  for (let c = 100; c <= 999; c++) if (!used.has(c)) free.push(c);
  if (!free.length) for (let c = 1000; c <= 9999; c++) if (!used.has(c)) free.push(c); // >900 orders/month
  return free[Math.floor(Math.random() * free.length)];
}
// Two orders created at the same moment could draw the same code: re-draw until it is unique.
export async function ensureUniqueCode(env, orderId) {
  for (let i = 0; i < 5; i++) {
    const o = await env.DB.prepare('SELECT id, unique_code, subtotal, created_at FROM orders WHERE id=?').bind(orderId).first();
    if (!o.unique_code) return o.unique_code;
    const dup = await env.DB.prepare(`SELECT id FROM orders WHERE unique_code=? AND id<>? AND created_at > ? AND id < ? LIMIT 1`)
      .bind(o.unique_code, o.id, now() - 30 * DAY, o.id).first();
    if (!dup) return o.unique_code;
    const code = await pickUniqueCode(env, o.id);
    await env.DB.prepare('UPDATE orders SET unique_code=?, total=subtotal+? WHERE id=?').bind(code, code, o.id).run();
  }
}

// Admin clicks "Proses" (or "Sudah Bayar"): create/extend the license and queue the EA build.
export async function processOrder(env, base, orderId, { paid = false } = {}) {
  const o = await env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(orderId).first();
  if (!o) fail(404, 'Order tidak ditemukan');
  if (!['awaiting_payment', 'awaiting_verification'].includes(o.status)) fail(409, 'Order ini tidak bisa diproses (status: ' + o.status + ')');
  const p = await getProduct(env, o.product_id);
  if (p.requires_ib && o.kind === 'new' && o.ib_status !== 'yes') fail(409, 'Cek dulu akun ini di portal partner, lalu klik "Ya, under IB"');
  const t = now();
  let licenseId = o.license_id;

  if (o.kind === 'renew') {
    const lic = await env.DB.prepare('SELECT * FROM licenses WHERE id=?').bind(licenseId).first();
    if (!lic) fail(404, 'Lisensi untuk perpanjangan tidak ditemukan');
    const from = Math.max(t, lic.expires_at || t);
    const exp = addMonths(from, o.months);
    await env.DB.prepare(`UPDATE licenses SET expires_at=?, reminder_exp=NULL, reminders_sent='',
        status=CASE WHEN status='expired' THEN 'processing' ELSE status END, updated_at=? WHERE id=?`)
      .bind(exp, t, licenseId).run();
  } else {
    const exp = o.months ? addMonths(t, o.months) : null;
    const r = await env.DB.prepare(`INSERT INTO licenses (user_id, product_id, platform, account_number, broker, broker_server,
        trading_pass_enc, expires_at, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?, 'processing', ?, ?)`)
      .bind(o.user_id, o.product_id, o.platform, o.account_number, o.broker, o.broker_server, o.trading_pass_enc, exp, t, t).run();
    licenseId = r.meta.last_row_id;
  }
  await env.DB.prepare(`UPDATE orders SET status='processing', license_id=?, processed_at=?,
      confirmed_at=COALESCE(confirmed_at, ?), paid_at=CASE WHEN ? THEN ? ELSE paid_at END WHERE id=?`)
    .bind(licenseId, t, t, paid ? 1 : 0, t, o.id).run();
  if (p.includes_ea) await queueBuild(env, licenseId, o.kind === 'renew' ? 'Perpanjangan ' + o.code : 'Order ' + o.code);

  const user = await getUser(env, o.user_id);
  const subj = paid ? `Pembayaran ${o.code} diterima, pesanan diproses` : `Pesanan ${o.code} sedang diproses`;
  await notify(env, o.user_id, subj, paid ? `Pembayaran ${rupiah(o.total)} sudah kami terima. Admin sedang menyiapkan pesanan Anda.` : 'Admin sedang menyiapkan pesanan Anda.', '#/pesanan/' + o.id);
  await emailUser(env, user, subj,
    `<p>Halo ${esc(user.name)},</p>${paid ? `<p>Pembayaran <b>${rupiah(o.total)}</b> untuk pesanan <b>${esc(o.code)}</b> sudah kami terima. Terima kasih!</p>` : ''}<p>Pesanan <b>${esc(o.code)}</b> (${esc(p.name)}) untuk akun <b>${esc(o.account_number)}</b> sedang diproses oleh admin. Kami akan mengabari Anda lagi begitu selesai.</p>`,
    { text: 'Lihat Pesanan', url: `${base}/member#/pesanan/${o.id}` });
  return licenseId;
}

// Admin clicks "Selesai Proses".
export async function completeOrder(env, base, orderId, adminNote) {
  const o = await env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(orderId).first();
  if (!o) fail(404, 'Order tidak ditemukan');
  if (o.status !== 'processing') fail(409, 'Klik "Proses" dulu sebelum "Selesai"');
  const t = now();
  const lic = await env.DB.prepare('SELECT * FROM licenses WHERE id=?').bind(o.license_id).first();
  const p = await getProduct(env, o.product_id);
  await env.DB.batch([
    env.DB.prepare(`UPDATE orders SET status='completed', completed_at=?, admin_note=? WHERE id=?`).bind(t, adminNote || o.admin_note, o.id),
    env.DB.prepare(`UPDATE licenses SET status=CASE WHEN expires_at IS NULL OR expires_at > ? THEN 'active' ELSE 'expired' END, updated_at=? WHERE id=?`)
      .bind(t, t, o.license_id),
  ]);
  const user = await getUser(env, o.user_id);
  const parts = [];
  if (p.includes_ea) parts.push('File EA berlisensi bisa diunduh di menu <b>Lisensi &amp; VPS</b>.');
  if (p.includes_vps && p.managed_vps) parts.push('Akun Anda sudah dipasang di VPS kami dan EA sudah berjalan (VPS dikelola admin). Pantau dari HP lewat aplikasi MetaTrader dengan <b>password investor (akun pantau)</b>; panduannya ada di menu <b>Lisensi &amp; VPS</b>.');
  else if (p.includes_vps) parts.push('VPS pribadi Anda sudah siap. Alamat IP, username dan password Remote Desktop ada di menu <b>Lisensi &amp; VPS</b>; silakan login lalu pasang MetaTrader dan EA.');
  await notify(env, o.user_id, `Pesanan ${o.code} selesai`, `Masa aktif: ${fmtDate(lic.expires_at)}.`, '#/lisensi');
  await emailUser(env, user, `Pesanan ${o.code} selesai`,
    `<p>Halo ${esc(user.name)},</p><p>Pesanan <b>${esc(o.code)}</b> (${esc(p.name)}) untuk akun <b>${esc(o.account_number)}</b> sudah selesai diproses.</p>
     <p>Masa aktif: <b>${fmtDate(lic.expires_at)}</b></p><p>${parts.join('<br>')}</p>${adminNote ? `<p>Catatan admin: ${esc(adminNote)}</p>` : ''}`,
    { text: 'Buka Member Area', url: `${base}/member#/lisensi` });
}

// ---------- builds ----------
export async function queueBuild(env, licenseId, reason = '') {
  const lic = await env.DB.prepare(`SELECT l.*, p.requires_ib FROM licenses l JOIN products p ON p.id=l.product_id WHERE l.id=?`).bind(licenseId).first();
  if (!lic) fail(404, 'Lisensi tidak ditemukan');
  const t = now();
  // IB products: the EA itself is free and never expires; only the VPS rental (licenses.expires_at) does.
  const eaExpiry = lic.requires_ib ? null : lic.expires_at;
  await env.DB.prepare(`UPDATE builds SET status='replaced' WHERE license_id=? AND status IN ('queued','building')`).bind(licenseId).run();
  const r = await env.DB.prepare(`INSERT INTO builds (license_id, platform, account_number, expires_at, status, reason, created_at)
      VALUES (?,?,?,?, 'queued', ?, ?)`).bind(licenseId, lic.platform, lic.account_number, eaExpiry, reason, t).run();
  return r.meta.last_row_id;
}

export async function claimBuild(env, builderId) {
  const t = now();
  await putSetting(env, 'builder_seen', JSON.stringify({ at: t, id: builderId }));
  // Jobs stuck "building" for 15 min go back to the queue.
  await env.DB.prepare(`UPDATE builds SET status='queued' WHERE status='building' AND started_at < ?`).bind(t - 900).run();
  const job = await env.DB.prepare(`SELECT * FROM builds WHERE status='queued' ORDER BY id LIMIT 1`).first();
  if (!job) return null;
  const upd = await env.DB.prepare(`UPDATE builds SET status='building', started_at=? WHERE id=? AND status='queued'`).bind(t, job.id).run();
  if (!upd.meta.changes) return null;
  return { id: job.id, license_id: job.license_id, platform: job.platform, account_number: job.account_number, expires_at: job.expires_at || 0 };
}

export async function finishBuild(env, base, { id, ok, log, filename, data_b64, ea_version }) {
  const b = await env.DB.prepare('SELECT * FROM builds WHERE id=?').bind(id).first();
  if (!b) fail(404, 'Build tidak ditemukan');
  const t = now();
  if (b.status === 'replaced') return { ignored: true };
  if (!ok || !data_b64) {
    await env.DB.prepare(`UPDATE builds SET status='failed', log=?, finished_at=? WHERE id=?`).bind(String(log || '').slice(-8000), t, id).run();
    await emailAdmin(env, base, `Generate EA gagal (build #${id})`, `<pre style="white-space:pre-wrap">${esc(String(log || '').slice(-3000))}</pre>`, '/admin#/lisensi/' + b.license_id);
    return { ok: false };
  }
  const size = Math.floor(data_b64.length * 3 / 4);
  const f = await env.DB.prepare(`INSERT INTO files (user_id, kind, name, mime, size, data_b64, created_at) VALUES (NULL,'ea',?,?,?,?,?)`)
    .bind(filename, 'application/octet-stream', size, data_b64, t).run();
  // Older EA files for this license are removed: only the newest build can be downloaded.
  const old = await env.DB.prepare(`SELECT id, file_id FROM builds WHERE license_id=? AND status='done'`).bind(b.license_id).all();
  const stmts = [];
  for (const o of old.results) {
    stmts.push(env.DB.prepare(`UPDATE builds SET status='replaced' WHERE id=?`).bind(o.id));
    if (o.file_id) stmts.push(env.DB.prepare(`DELETE FROM files WHERE id=?`).bind(o.file_id));
  }
  stmts.push(env.DB.prepare(`UPDATE builds SET status='done', file_id=?, log=?, ea_version=?, finished_at=? WHERE id=?`)
    .bind(f.meta.last_row_id, String(log || '').slice(-8000), ea_version || '', t, id));
  stmts.push(env.DB.prepare(`UPDATE licenses SET current_build_id=?, updated_at=? WHERE id=?`).bind(id, t, b.license_id));
  await env.DB.batch(stmts);

  // Auto mode: an EA-only order waiting for this build is completed straight away.
  const s = await getSettings(env);
  if (s.auto_complete_ea === '1') {
    const o = await env.DB.prepare(`SELECT o.id, o.code, o.account_number FROM orders o JOIN products p ON p.id=o.product_id
        WHERE o.license_id=? AND o.status='processing' AND p.includes_vps=0 ORDER BY o.id DESC LIMIT 1`).bind(b.license_id).first();
    if (o) {
      await completeOrder(env, base, o.id, 'Selesai otomatis setelah file EA dibuat.');
      await emailAdmin(env, base, `Order ${o.code} selesai otomatis`,
        `<p>File EA untuk akun <b>${esc(o.account_number)}</b> sudah dibuat (build #${id}) dan pesanan <b>${esc(o.code)}</b> otomatis ditandai selesai. Member sudah dikirimi email.</p>`,
        '/admin#/pesanan/' + o.id);
      return { ok: true, auto_completed: o.id };
    }
  }
  const lic = await env.DB.prepare('SELECT * FROM licenses WHERE id=?').bind(b.license_id).first();
  if (lic.status === 'active') {
    const user = await getUser(env, lic.user_id);
    await notify(env, lic.user_id, 'File EA baru siap diunduh', `Akun ${lic.account_number}, berlaku: ${fmtDate(lic.expires_at)}.`, '#/lisensi');
    await emailUser(env, user, 'File EA baru siap diunduh',
      `<p>Halo ${esc(user.name)},</p><p>File EA untuk akun <b>${esc(lic.account_number)}</b> sudah dibuat ulang (berlaku: <b>${fmtDate(lic.expires_at)}</b>). Silakan unduh dan ganti file lama di MetaTrader Anda.</p>`,
      { text: 'Unduh EA', url: `${base}/member#/lisensi` });
  }
  return { ok: true };
}

// ---------- daily job: reminders, expiries, cleanup ----------
export async function runDaily(env, base) {
  const t = now();
  const s = await getSettings(env);
  const days = [...s.reminder_days].map(Number).filter((d) => d > 0).sort((a, b) => b - a);
  const out = { reminders: 0, expired: 0, unpaid_expired: 0 };

  const maxDay = days[0] || 7;
  const { results: soon } = await env.DB.prepare(`
    SELECT l.*, p.name AS product_name, p.includes_vps, p.requires_ib, u.email, u.name AS user_name
      FROM licenses l JOIN products p ON p.id=l.product_id JOIN users u ON u.id=l.user_id
     WHERE l.status='active' AND l.expires_at IS NOT NULL AND l.expires_at > ? AND l.expires_at <= ?`)
    .bind(t, t + maxDay * DAY).all();
  for (const l of soon) {
    const left = Math.ceil((l.expires_at - t) / DAY);
    const sent = l.reminder_exp === l.expires_at ? l.reminders_sent.split(',').filter(Boolean).map(Number) : [];
    const stage = days.filter((d) => left <= d && !sent.includes(d)).pop(); // smallest due stage
    if (stage === undefined) continue;
    const allDue = days.filter((d) => left <= d);
    const what = l.includes_vps ? (l.requires_ib ? 'sewa VPS' : 'sewa VPS + EA') : 'sewa EA';
    const title = `Masa ${what} akun ${l.account_number} tinggal ${left} hari`;
    await notify(env, l.user_id, title, `Berakhir ${fmtDate(l.expires_at)}. Klik Perpanjang di menu Lisensi & VPS.`, '#/lisensi');
    await emailUser(env, { email: l.email }, title,
      `<p>Halo ${esc(l.user_name)},</p><p>Masa ${what} (<b>${esc(l.product_name)}</b>) untuk akun <b>${esc(l.account_number)}</b> tinggal <b>${left} hari</b> lagi dan berakhir pada <b>${fmtDate(l.expires_at)}</b>.</p>
       <p>Untuk memperpanjang, login ke <a href="${base}/masuk">${esc(base.replace(/^https?:\/\//, ''))}</a>, buka menu <b>Lisensi &amp; VPS</b>, lalu klik <b>Perpanjang</b> pada akun yang terdaftar.</p>`,
      { text: 'Perpanjang Sekarang', url: `${base}/member#/lisensi` });
    await env.DB.prepare('UPDATE licenses SET reminder_exp=?, reminders_sent=? WHERE id=?')
      .bind(l.expires_at, [...new Set([...sent, ...allDue])].join(','), l.id).run();
    out.reminders++;
  }

  const { results: gone } = await env.DB.prepare(`
    SELECT l.*, p.name AS product_name, u.email, u.name AS user_name
      FROM licenses l JOIN products p ON p.id=l.product_id JOIN users u ON u.id=l.user_id
     WHERE l.status='active' AND l.expires_at IS NOT NULL AND l.expires_at <= ?`).bind(t).all();
  for (const l of gone) {
    await env.DB.prepare(`UPDATE licenses SET status='expired', updated_at=? WHERE id=?`).bind(t, l.id).run();
    const title = `Masa aktif akun ${l.account_number} sudah berakhir`;
    await notify(env, l.user_id, title, 'Perpanjang agar EA aktif kembali.', '#/lisensi');
    await emailUser(env, { email: l.email }, title,
      `<p>Halo ${esc(l.user_name)},</p><p>Masa aktif <b>${esc(l.product_name)}</b> untuk akun <b>${esc(l.account_number)}</b> berakhir pada ${fmtDate(l.expires_at)}. EA akan berhenti membuka posisi baru.</p>`,
      { text: 'Perpanjang', url: `${base}/member#/lisensi` });
    out.expired++;
  }

  const r = await env.DB.prepare(`UPDATE orders SET status='expired' WHERE status='awaiting_payment' AND pay_deadline < ?`).bind(t).run();
  out.unpaid_expired = r.meta.changes || 0;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(t),
    env.DB.prepare('DELETE FROM password_resets WHERE expires_at < ?').bind(t),
    env.DB.prepare('DELETE FROM login_attempts WHERE created_at < ?').bind(t - DAY),
  ]);
  await putSetting(env, 'daily_last_run', JSON.stringify({ at: t, ...out }));
  return out;
}

export function orderStatusLabel(s) {
  return {
    awaiting_payment: 'Menunggu Pembayaran', awaiting_verification: 'Menunggu Verifikasi', processing: 'Diproses',
    completed: 'Selesai', rejected: 'Ditolak', cancelled: 'Dibatalkan', expired: 'Kedaluwarsa',
  }[s] || s;
}
export { rupiah, fmtDate };
