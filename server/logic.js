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

// Create an order (new purchase, member renewal or automatic monthly invoice).
// fields: kind, product_id, license_id, months, platform, account_number, broker, broker_server, trading_pass_enc,
//         pay_deadline (optional override), invoice (true = automatic renewal invoice)
export async function createOrder(env, base, user, fields) {
  const s = await getSettings(env);
  const p = await getProduct(env, fields.product_id);
  // Hidden products can still be renewed by existing customers.
  if (!p || (!p.active && fields.kind !== 'renew')) fail(400, 'Produk tidak tersedia');
  const q = quote(p, fields.months, s);
  const free = p.billing === 'free';
  let uniq = free ? 0 : await pickUniqueCode(env);
  const t = now();
  const code = await newOrderCode(env);
  const deadline = fields.pay_deadline || t + Number(s.pay_deadline_hours || 24) * 3600;
  const r = await env.DB.prepare(`INSERT INTO orders (code, user_id, kind, product_id, license_id, platform, account_number, broker, broker_server,
      trading_pass_enc, months, unit_price, discount_pct, subtotal, unique_code, total, status, created_at, pay_deadline, confirmed_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(code, user.id, fields.kind, p.id, fields.license_id || null, fields.platform, fields.account_number, fields.broker, fields.broker_server,
      fields.trading_pass_enc, q.months, q.unit_price, q.discount_pct, q.subtotal, uniq, q.subtotal + uniq,
      free ? 'awaiting_verification' : 'awaiting_payment', t, deadline, free ? t : null).run();
  const id = r.meta.last_row_id;
  if (!free) uniq = await ensureUniqueCode(env, id);
  const total = q.subtotal + uniq;
  if (free) {
    await notify(env, user.id, `Pengajuan ${code} diterima`, `Admin akan mengecek akun ${fields.account_number} terdaftar di bawah IB kami, lalu memproses EA Anda.`, '#/pesanan/' + id);
    await emailUser(env, user, `Pengajuan EA gratis ${code} diterima`,
      `<p>Halo ${esc(user.name)},</p><p>Pengajuan EA gratis untuk akun ${esc(fields.broker)} <b>${esc(fields.account_number)}</b> sudah kami terima. Admin akan mengecek bahwa akun tersebut terdaftar di bawah IB kami, lalu segera memprosesnya.</p>`,
      { text: 'Lihat Status', url: `${base}/member#/pesanan/${id}` });
    await emailAdmin(env, base, `Pengajuan EA gratis IB ${code}`,
      `<p>${esc(user.name)} (${esc(user.email)}) mengajukan EA gratis untuk akun ${esc(fields.broker)} <b>${esc(fields.account_number)}</b>. Cek di portal partner bahwa akun ini di bawah IB Anda, lalu klik Proses.</p>`, '/admin#/pesanan/' + id);
    return id;
  }
  const banks = String(s.bank_accounts || '').split(/\r?\n/).filter(Boolean).map((l) => `<li>${esc(l)}</li>`).join('');
  const wa = s.whatsapp ? `https://wa.me/${String(s.whatsapp).replace(/\D/g, '').replace(/^0/, '62')}` : '';
  const payBlock = `<p>Silakan transfer <b>tepat</b> sebesar:</p><p style="font-size:24px;font-weight:bold;color:#f5c542;margin:6px 0">${rupiah(total)}</p>
       <p style="color:#a3a3b2;font-size:13px;margin-top:0">sudah termasuk 3 digit kode unik <b>${uniq}</b> agar pembayaran Anda mudah dikenali.</p>
       ${banks ? `<p>Ke salah satu rekening berikut:</p><ul>${banks}</ul>` : ''}
       <p>Setelah transfer, buka halaman <b>Tagihan &amp; Pembayaran</b> dan upload bukti transfer.</p>
       ${wa ? `<p>Ada kendala? <a href="${wa}" style="color:#f5c542">Chat admin via WhatsApp</a>.</p>` : ''}`;
  if (fields.invoice) {
    const lic = await env.DB.prepare('SELECT expires_at FROM licenses WHERE id=?').bind(fields.license_id).first();
    const what = p.includes_ea ? (p.includes_vps ? 'sewa VPS + EA' : 'sewa EA') : 'sewa VPS';
    const subj = `Tagihan ${what} akun ${fields.account_number}: ${rupiah(total)}`;
    await notify(env, user.id, subj, `Masa aktif berakhir ${fmtDate(lic && lic.expires_at)}. Bayar sebelum ${fmtDate(deadline)} agar tidak terputus.`, '#/bayar/' + id);
    await emailUser(env, user, subj,
      `<p>Halo ${esc(user.name)},</p><p>Berikut tagihan perpanjangan <b>${esc(p.name)}</b> (${q.months} bulan) untuk akun <b>${esc(fields.account_number)}</b>. Masa aktif saat ini berakhir <b>${fmtDate(lic && lic.expires_at)}</b>.</p>
       ${payBlock}<p style="color:#a3a3b2;font-size:13px">Ingin durasi lain (misal 12 bulan, lebih hemat)? Ganti durasinya di halaman tagihan sebelum membayar.</p>`,
      { text: 'Lihat & Bayar Tagihan', url: `${base}/member#/bayar/${id}` });
  } else {
    await notify(env, user.id, `Pesanan ${code} dibuat`, `Silakan transfer ${rupiah(total)} (termasuk kode unik ${uniq}) lalu konfirmasi pembayaran.`
      + (p.requires_ib ? ' Admin juga akan mengecek akun Anda terdaftar di bawah IB kami.' : ''), '#/pesanan/' + id);
    await emailUser(env, user, `Pesanan ${code}: silakan transfer ${rupiah(total)}`,
      `<p>Halo ${esc(user.name)},</p><p>Terima kasih atas pesanan <b>${esc(code)}</b> (${esc(p.name)}${q.months ? `, ${q.months} bulan` : ''}) untuk akun <b>${esc(fields.account_number)}</b>.</p>${payBlock}`,
      { text: 'Konfirmasi Pembayaran', url: `${base}/member#/bayar/${id}` });
  }
  return id;
}

// Member changes the duration of an unpaid renewal invoice; the unique code stays the same.
export async function changeOrderMonths(env, order, months) {
  if (order.kind !== 'renew' || order.status !== 'awaiting_payment' || order.proof_file_id) fail(409, 'Durasi hanya bisa diganti sebelum bukti transfer dikirim');
  const s = await getSettings(env);
  const p = await getProduct(env, order.product_id);
  const q = quote(p, months, s);
  await env.DB.prepare('UPDATE orders SET months=?, unit_price=?, discount_pct=?, subtotal=?, total=?+unique_code WHERE id=?')
    .bind(q.months, q.unit_price, q.discount_pct, q.subtotal, q.subtotal, order.id).run();
}

// Monthly products: an invoice is always open from `invoice_days_before` days before expiry until 30 days after it.
// One-time purchases (lifetime / free EA) have no expiry and are never invoiced.
export async function createDueInvoices(env, base) {
  const t = now();
  const s = await getSettings(env);
  const days = Number(s.invoice_days_before || 7);
  const { results } = await env.DB.prepare(`
    SELECT l.* FROM licenses l JOIN products p ON p.id=l.product_id
     WHERE p.billing='monthly' AND l.expires_at IS NOT NULL AND l.status IN ('active','expired')
       AND l.expires_at <= ? AND l.expires_at > ?
       AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.license_id=l.id AND o.kind='renew'
                       AND o.status IN ('awaiting_payment','awaiting_verification','processing'))`)
    .bind(t + days * DAY, t - 30 * DAY).all();
  let n = 0;
  for (const l of results) {
    const last = await env.DB.prepare(`SELECT months FROM orders WHERE license_id=? AND status IN ('processing','completed') AND months IS NOT NULL ORDER BY id DESC LIMIT 1`).bind(l.id).first();
    const months = last && s.durations.includes(last.months) ? last.months : s.durations[0] || 1;
    const user = await getUser(env, l.user_id);
    if (!user) continue;
    await createOrder(env, base, user, {
      kind: 'renew', invoice: true, product_id: l.product_id, license_id: l.id, months, platform: l.platform,
      account_number: l.account_number, broker: l.broker, broker_server: l.broker_server, trading_pass_enc: l.trading_pass_enc,
      pay_deadline: Math.max(l.expires_at, t + 3 * DAY),
    });
    n++;
  }
  return n;
}

// ---------- USD -> IDR (free sources, cached 15 minutes at the edge) ----------
const RATE_SOURCES = [
  ['open.er-api.com', 'https://open.er-api.com/v6/latest/USD', (j) => j.rates && j.rates.IDR],
  ['fawazahmed0 currency-api', 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json', (j) => j.usd && j.usd.idr],
  ['frankfurter (ECB)', 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=IDR', (j) => j.rates && j.rates.IDR],
];
export async function getUsdIdr(env, waitUntil) {
  const cache = caches.default;
  const key = new Request('https://goldhuntergaruda.com/__cache/usd-idr-v2');
  const hit = await cache.match(key);
  if (hit) return hit.json();
  let rate = 0, source = '';
  for (const [name, url, pick] of RATE_SOURCES) {
    try {
      const r = await fetch(url, { cf: { cacheTtl: 900 } });
      const v = Number(pick(await r.json()));
      if (v > 1000 && v < 100000) { rate = v; source = name; break; }
    } catch {}
  }
  if (rate) {
    await putSetting(env, 'usd_idr_last', JSON.stringify({ rate, source, at: now() }));
    const res = new Response(JSON.stringify({ rate, source }), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=900' } });
    if (waitUntil) waitUntil(cache.put(key, res)); else await cache.put(key, res);
    return { rate, source };
  }
  const s = await getSettings(env);
  try { const last = JSON.parse(s.usd_idr_last || '{}'); return { rate: last.rate || 0, source: (last.source || '') + ' (terakhir)' }; } catch { return { rate: 0, source: '' }; }
}
// Account-currency amount -> Rupiah. Cent accounts report USC (1 USD = 100 USC).
export function toIdr(amount, currency, rate) {
  const c = String(currency || '').toUpperCase();
  if (c === 'IDR') return amount;
  if (!rate) return null;
  if (c === 'USC' || c === 'USX' || c === 'UST') return amount / 100 * rate;
  if (c === 'USD') return amount * rate;
  return null;
}
export function boardName(full, mode, hidden) {
  if (hidden || mode === 'hidden') return 'Member Anonim';
  const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Member';
  if (mode === 'full') return parts.join(' ');
  if (mode === 'first') return parts[0];
  return parts[0] + (parts[1] ? ' ' + parts[1][0].toUpperCase() + '.' : '');
}
export const maskAccount = (a) => { a = String(a || ''); return a.length <= 4 ? a : a.slice(0, 2) + '****' + a.slice(-2); };

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

// Every active EA licence of a platform gets a fresh build (new EA version or admin "rebuild all").
export async function rebuildAll(env, platform, reason) {
  const { results } = await env.DB.prepare(`SELECT l.id FROM licenses l JOIN products p ON p.id=l.product_id
      WHERE p.includes_ea=1 AND l.status='active' AND (? = '' OR l.platform=?)`).bind(platform || '', platform || '').all();
  for (const r of results) await queueBuild(env, r.id, reason);
  return results.length;
}

export async function claimBuild(env, builderId, versions = {}) {
  const t = now();
  const s = await getSettings(env);
  let seen = {};
  try { seen = JSON.parse(s.ea_versions_seen || '{}'); } catch {}
  const clean = {};
  for (const p of ['mt5', 'mt4']) if (versions[p]) clean[p] = String(versions[p]).slice(0, 20);
  await putSetting(env, 'builder_seen', JSON.stringify({ at: t, id: builderId, versions: clean }));
  // The admin edited the EA and raised #property version -> licensed files are rebuilt automatically
  let changed = false;
  for (const [p, v] of Object.entries(clean)) {
    if (seen[p] && seen[p] !== v && s.auto_rebuild_on_version !== '0') {
      const n = await rebuildAll(env, p, `Versi baru v${v} (sebelumnya v${seen[p]})`);
      await putSetting(env, 'ea_version_event', JSON.stringify({ at: t, platform: p, from: seen[p], to: v, rebuilt: n }));
    }
    if (seen[p] !== v) { seen[p] = v; changed = true; }
  }
  if (changed) await putSetting(env, 'ea_versions_seen', JSON.stringify(seen));
  // Jobs stuck "building" for 15 min go back to the queue.
  await env.DB.prepare(`UPDATE builds SET status='queued' WHERE status='building' AND started_at < ?`).bind(t - 900).run();
  const job = await env.DB.prepare(`SELECT * FROM builds WHERE status='queued' ORDER BY id LIMIT 1`).first();
  if (!job) return null;
  const upd = await env.DB.prepare(`UPDATE builds SET status='building', started_at=? WHERE id=? AND status='queued'`).bind(t, job.id).run();
  if (!upd.meta.changes) return null;
  // Secret baked into the EA so its profit reports can be trusted (one per license, stable across rebuilds)
  let lic = await env.DB.prepare('SELECT report_token FROM licenses WHERE id=?').bind(job.license_id).first();
  let token = lic && lic.report_token;
  if (!token) {
    token = randomToken(24);
    await env.DB.prepare('UPDATE licenses SET report_token=? WHERE id=?').bind(token, job.license_id).run();
  }
  return { id: job.id, license_id: job.license_id, platform: job.platform, account_number: job.account_number, expires_at: job.expires_at || 0, report_token: token };
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
      `<p>Halo ${esc(user.name)},</p><p>File EA${ea_version ? ` <b>versi ${esc(ea_version)}</b>` : ''} untuk akun <b>${esc(lic.account_number)}</b> sudah dibuat (berlaku: <b>${fmtDate(lic.expires_at)}</b>). Silakan unduh dan ganti file lama di MetaTrader Anda.</p>`,
      { text: 'Unduh EA', url: `${base}/member#/lisensi` });
  }
  return { ok: true };
}

// ---------- daily job: reminders, expiries, cleanup ----------
export async function runDaily(env, base) {
  const t = now();
  const s = await getSettings(env);
  const days = [...s.reminder_days].map(Number).filter((d) => d > 0).sort((a, b) => b - a);
  const out = { reminders: 0, expired: 0, unpaid_expired: 0, invoices: 0 };
  // Unpaid invoices past their deadline lapse first, so a fresh invoice can be issued below.
  out.unpaid_expired = (await env.DB.prepare(`UPDATE orders SET status='expired' WHERE status='awaiting_payment' AND pay_deadline < ?`).bind(t).run()).meta.changes || 0;
  out.invoices = await createDueInvoices(env, base);

  const maxDay = days[0] || 7;
  const { results: soon } = await env.DB.prepare(`
    SELECT l.*, p.name AS product_name, p.includes_vps, p.includes_ea, p.requires_ib, u.email, u.name AS user_name
      FROM licenses l JOIN products p ON p.id=l.product_id JOIN users u ON u.id=l.user_id
     WHERE p.billing='monthly' AND l.status='active' AND l.expires_at IS NOT NULL AND l.expires_at > ? AND l.expires_at <= ?`)
    .bind(t, t + maxDay * DAY).all();
  for (const l of soon) {
    const left = Math.ceil((l.expires_at - t) / DAY);
    const sent = l.reminder_exp === l.expires_at ? l.reminders_sent.split(',').filter(Boolean).map(Number) : [];
    const stage = days.filter((d) => left <= d && !sent.includes(d)).pop(); // smallest due stage
    if (stage === undefined) continue;
    const allDue = days.filter((d) => left <= d);
    const what = !l.includes_ea || (l.includes_vps && l.requires_ib) ? 'sewa VPS' : l.includes_vps ? 'sewa VPS + EA' : 'sewa EA';
    const title = `Masa ${what} akun ${l.account_number} tinggal ${left} hari`;
    const inv = await env.DB.prepare(`SELECT id, total FROM orders WHERE license_id=? AND kind='renew' AND status='awaiting_payment' ORDER BY id DESC LIMIT 1`).bind(l.id).first();
    await notify(env, l.user_id, title, inv ? `Berakhir ${fmtDate(l.expires_at)}. Tagihan ${rupiah(inv.total)} menunggu pembayaran.` : `Berakhir ${fmtDate(l.expires_at)}. Klik Perpanjang di menu Lisensi & VPS.`, inv ? '#/bayar/' + inv.id : '#/lisensi');
    await emailUser(env, { email: l.email }, title,
      `<p>Halo ${esc(l.user_name)},</p><p>Masa ${what} (<b>${esc(l.product_name)}</b>) untuk akun <b>${esc(l.account_number)}</b> tinggal <b>${left} hari</b> lagi dan berakhir pada <b>${fmtDate(l.expires_at)}</b>.</p>
       ${inv ? `<p>Tagihan perpanjangan <b>${rupiah(inv.total)}</b> sudah tersedia. Login ke <a href="${base}/masuk">${esc(base.replace(/^https?:\/\//, ''))}</a>, buka menu <b>Tagihan &amp; Pembayaran</b>, transfer sesuai nominal lalu upload bukti.</p>`
             : `<p>Untuk memperpanjang, login ke <a href="${base}/masuk">${esc(base.replace(/^https?:\/\//, ''))}</a>, buka menu <b>Lisensi &amp; VPS</b>, lalu klik <b>Perpanjang</b> pada akun yang terdaftar.</p>`}`,
      inv ? { text: 'Bayar Tagihan', url: `${base}/member#/bayar/${inv.id}` } : { text: 'Perpanjang Sekarang', url: `${base}/member#/lisensi` });
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
