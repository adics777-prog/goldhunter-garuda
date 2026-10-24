// Business rules: settings, pricing, orders, licenses, builds, reminders.
import { now, DAY, fail, addMonths, fmtDate, rupiah, esc, randomToken } from './util.js';
import { layout, sendEmail } from './email.js';
import { gatewayReady } from './gateway/index.js';

// ---------- settings ----------
const JSON_KEYS = ['durations', 'discounts', 'reminder_days', 'ib_brokers', 'bank_list', 'telegram_targets', 'gateway_channels'];
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
  s.bank_list ||= [];
  return s;
}
export async function putSetting(env, key, value) {
  const v = JSON_KEYS.includes(key) ? JSON.stringify(value) : String(value);
  await env.DB.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .bind(key, v).run();
}

// Payment accounts shown to members (only the active ones)
export const activeBanks = (s) => (s.bank_list || []).filter((b) => b.active !== false && b.bank && b.number)
  .map((b) => ({ bank: b.bank, number: b.number, name: b.name || '' }));

// ---------- pricing ----------
// billing: free (IB) | trial | share (sharing profit, weekly invoices) | lifetime | monthly (rent / VPS)
export const NO_UPFRONT = ['free', 'trial', 'share'];
// Rent with its own price per duration: products.prices = {"1":300000,...,"12":...,"18":...,"24":...} (Rupiah)
export function parsePrices(p) {
  if (!p || !p.prices) return null;
  let o;
  try { o = typeof p.prices === 'string' ? JSON.parse(p.prices) : p.prices; } catch { return null; }
  const out = {};
  for (const [m, v] of Object.entries(o || {})) {
    const mi = parseInt(m, 10), vi = Math.round(Number(v));
    if (mi >= 1 && mi <= 36 && vi > 0) out[mi] = vi;
  }
  return Object.keys(out).length ? out : null;
}
// months a product can be ordered / renewed for: its own price table, else the global durations (VPS packages)
export const productDurations = (p, s) => { const t = parsePrices(p); return t ? Object.keys(t).map(Number).sort((a, b) => a - b) : s.durations; };
export const durationLabel = (m) => m === 18 ? '1,5 tahun' : m >= 12 && m % 12 === 0 ? `${m / 12} tahun` : `${m} bulan`;
export const trialDays = (s) => Math.max(1, Math.min(60, Number(s.trial_days) || 7));
export const shareDueDays = (s) => Math.max(1, Math.min(14, Number(s.share_due_days) || 3));
export const sharePct = (s) => Math.max(0, Math.min(90, Number(s.share_commission_pct ?? 10) || 0));

// Sharing profit runs in weeks that end on Sunday 00:00 WIB: the Sunday 08:00 WIB cron bills the 7 days before
// (Sunday..Saturday). shareWeekEnd(t) = first Sunday 00:00 WIB strictly after t.
const WIB = 7 * 3600;
export function shareWeekEnd(t) {
  const local = t + WIB;
  const day0 = local - (((local % DAY) + DAY) % DAY);
  const dow = new Date(day0 * 1000).getUTCDay();          // 0 = Sunday
  return day0 + (((7 - dow) % 7) || 7) * DAY - WIB;
}
// EA expiry of a sharing licence = due date of the invoice of the running week: Sunday + N days, 23:59 WIB.
// Settled (paid / nothing to pay) -> moved to the next week's due date; unpaid -> the EA pauses new orders there.
export const shareDueFor = (t, s) => shareWeekEnd(t) + shareDueDays(s) * DAY + DAY - 60;

export function quote(product, months, settings) {
  if (NO_UPFRONT.includes(product.billing)) return { months: null, unit_price: 0, discount_pct: 0, subtotal: 0 };
  if (product.billing === 'lifetime') {
    return { months: null, unit_price: product.price, discount_pct: 0, subtotal: product.price };
  }
  const table = parsePrices(product);
  if (table) {
    if (!table[months]) fail(400, 'Durasi sewa tidak tersedia');
    const gross = product.price * months;
    const discount_pct = gross > 0 ? Math.max(0, Math.round((1 - table[months] / gross) * 100)) : 0;
    return { months, unit_price: product.price, discount_pct, subtotal: table[months] };
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

// Admin clicks "Proses" (or "Sudah Bayar"), or a payment / trial / sharing order is handled automatically (auto = true):
// create/extend the license and queue the EA build.
export async function processOrder(env, base, orderId, { paid = false, auto = false } = {}) {
  const o = await env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(orderId).first();
  if (!o) fail(404, 'Order tidak ditemukan');
  if (o.kind === 'share') fail(409, 'Tagihan sharing profit selesai lewat konfirmasi pembayaran (Sudah Bayar)');
  if (!['awaiting_payment', 'awaiting_verification'].includes(o.status)) fail(409, 'Order ini tidak bisa diproses (status: ' + o.status + ')');
  const p = await getProduct(env, o.product_id);
  const s = await getSettings(env);
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
    // rent / VPS = months, trial = trial_days, sharing = due date of the running week's invoice, IB = no expiry
    const exp = o.months ? addMonths(t, o.months) : p.billing === 'trial' ? t + trialDays(s) * DAY : p.billing === 'share' ? shareDueFor(t, s) : null;
    const r = await env.DB.prepare(`INSERT INTO licenses (user_id, product_id, platform, account_number, broker, broker_server,
        trading_pass_enc, expires_at, status, created_at, updated_at, share_next) VALUES (?,?,?,?,?,?,?,?, 'processing', ?, ?, ?)`)
      .bind(o.user_id, o.product_id, o.platform, o.account_number, o.broker, o.broker_server, o.trading_pass_enc, exp, t, t, p.billing === 'share' ? t : 0).run();
    licenseId = r.meta.last_row_id;
  }
  await env.DB.prepare(`UPDATE orders SET status='processing', license_id=?, processed_at=?,
      confirmed_at=COALESCE(confirmed_at, ?), paid_at=CASE WHEN ? THEN ? ELSE paid_at END WHERE id=?`)
    .bind(licenseId, t, t, paid ? 1 : 0, t, o.id).run();
  if (p.includes_ea) await queueBuild(env, licenseId, o.kind === 'renew' ? 'Perpanjangan ' + o.code : 'Order ' + o.code);

  const user = await getUser(env, o.user_id);
  // EA-only orders finish by themselves once the builder has made the file (auto_complete_ea); VPS packages wait for the admin
  const byItself = p.includes_ea && !p.includes_vps && s.auto_complete_ea === '1';
  const who = byItself ? 'File EA berlisensi sedang dibuat otomatis (biasanya beberapa menit).' : 'Admin sedang menyiapkan pesanan Anda.';
  const subj = paid ? `Pembayaran ${o.code} diterima, pesanan diproses`
    : p.billing === 'trial' ? `Trial ${o.code} disetujui, EA sedang dibuat` : p.billing === 'share' ? `Sharing profit ${o.code} disetujui, EA sedang dibuat` : `Pesanan ${o.code} sedang diproses`;
  await notify(env, o.user_id, subj, paid ? `Pembayaran ${rupiah(o.total)} sudah kami terima. ${who}` : who, '#/pesanan/' + o.id);
  await emailUser(env, user, subj,
    `<p>Halo ${esc(user.name)},</p>${paid ? `<p>Pembayaran <b>${rupiah(o.total)}</b> untuk pesanan <b>${esc(o.code)}</b> sudah kami terima${auto ? ' dan terverifikasi otomatis' : ''}. Terima kasih!</p>` : ''}<p>Pesanan <b>${esc(o.code)}</b> (${esc(p.name)}) untuk akun <b>${esc(o.account_number)}</b> sedang diproses. ${who} Kami akan mengabari Anda lagi begitu selesai.</p>`,
    { text: 'Lihat Pesanan', url: `${base}/member#/pesanan/${o.id}` });
  if (auto && !paid) await emailAdmin(env, base, `${p.name}: ${o.code} aktif otomatis`,
    `<p>${esc(user.name)} (${esc(user.email)}) memulai <b>${esc(p.name)}</b> untuk akun ${esc(o.broker)} <b>${esc(o.account_number)}</b>. Lisensi dibuat otomatis dan EA masuk antrean compile.</p>`, '/admin#/pesanan/' + o.id);
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
  if (p.billing === 'share') {
    const s = await getSettings(env);
    parts.push(`<b>Sharing profit:</b> setiap hari Minggu Anda menerima laporan profit EA minggu itu dan tagihan komisi <b>${sharePct(s)}%</b> dari profit (minggu tanpa profit tidak ditagih). Bayar dalam ${shareDueDays(s)} hari agar EA tidak berhenti membuka posisi baru. Pastikan EA melapor ke web: izinkan WebRequest <b>https://goldhuntergaruda.com</b> di MetaTrader (installer di menu Lisensi sudah mengaturnya).`);
  }
  if (p.billing === 'trial') parts.push('Trial berlaku sampai tanggal di atas. Setelah itu EA berhenti membuka posisi baru; lanjutkan dengan <b>Sewa EA</b> atau <b>Sharing Profit</b> dari menu Order.');
  await notify(env, o.user_id, `Pesanan ${o.code} selesai`, `Masa aktif: ${fmtDate(lic.expires_at)}.`, '#/lisensi');
  await emailUser(env, user, `Pesanan ${o.code} selesai`,
    `<p>Halo ${esc(user.name)},</p><p>Pesanan <b>${esc(o.code)}</b> (${esc(p.name)}) untuk akun <b>${esc(o.account_number)}</b> sudah selesai diproses.</p>
     <p>Masa aktif: <b>${fmtDate(lic.expires_at)}</b></p><p>${parts.join('<br>')}</p>${adminNote ? `<p>Catatan admin: ${esc(adminNote)}</p>` : ''}`,
    { text: 'Buka Member Area', url: `${base}/member#/lisensi` });
}

// Payment instructions in emails: bank transfer with the unique code; USDT (automatic check) and QRIS / Virtual Account
// get their exact amount / pay code on the member's invoice page (the USDT amount is locked per order there).
export function payBlockHtml(s, total, uniq) {
  const banks = activeBanks(s).map((b) => `<li><b>${esc(b.bank)}</b> <span style="font-family:monospace;font-size:16px;color:#f5c542">${esc(b.number)}</span>${b.name ? ` a.n. <b>${esc(b.name)}</b>` : ''}</li>`).join('');
  const wa = s.whatsapp ? `https://wa.me/${String(s.whatsapp).replace(/\D/g, '').replace(/^0/, '62')}` : '';
  const other = [s.usdt_enabled === '1' && TRC20_RE.test(s.usdt_address || '') ? '<b>USDT TRC20</b> (dicek otomatis)' : '',
    gatewayReady(s) ? '<b>QRIS / Virtual Account</b> (otomatis)' : ''].filter(Boolean);
  return `<p>Transfer bank: kirim <b>tepat</b> sebesar:</p><p style="font-size:24px;font-weight:bold;color:#f5c542;margin:6px 0">${rupiah(total)}</p>
       <p style="color:#a3a3b2;font-size:13px;margin-top:0">sudah termasuk kode unik <b>${uniq}</b> agar pembayaran Anda mudah dikenali.</p>
       ${banks ? `<p>Ke rekening berikut:</p><ul>${banks}</ul>` : ''}
       <p>Setelah transfer, buka halaman <b>Tagihan &amp; Pembayaran</b> dan upload bukti transfer.</p>
       ${other.length ? `<p>Pilihan lain di halaman tagihan: ${other.join(' atau ')}. Metode bisa diganti kapan saja selama tagihan belum dibayar; pembayaran otomatis langsung memproses pesanan tanpa menunggu admin.</p>` : ''}
       ${wa ? `<p>Ada kendala? <a href="${wa}" style="color:#f5c542">Chat admin via WhatsApp</a>.</p>` : ''}`;
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
  // nothing to pay up front: free EA (IB, admin checks), trial and sharing profit (both approved automatically)
  const free = NO_UPFRONT.includes(p.billing);
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
    if (p.billing !== 'free') return id;   // trial / sharing: the caller processes the order right away
    await notify(env, user.id, `Pengajuan ${code} diterima`, `Admin akan mengecek akun ${fields.account_number} terdaftar di bawah IB kami, lalu memproses EA Anda.`, '#/pesanan/' + id);
    await emailUser(env, user, `Pengajuan EA gratis ${code} diterima`,
      `<p>Halo ${esc(user.name)},</p><p>Pengajuan EA gratis untuk akun ${esc(fields.broker)} <b>${esc(fields.account_number)}</b> sudah kami terima. Admin akan mengecek bahwa akun tersebut terdaftar di bawah IB kami, lalu segera memprosesnya.</p>`,
      { text: 'Lihat Status', url: `${base}/member#/pesanan/${id}` });
    await emailAdmin(env, base, `Pengajuan EA gratis IB ${code}`,
      `<p>${esc(user.name)} (${esc(user.email)}) mengajukan EA gratis untuk akun ${esc(fields.broker)} <b>${esc(fields.account_number)}</b>. Cek di portal partner bahwa akun ini di bawah IB Anda, lalu klik Proses.</p>`, '/admin#/pesanan/' + id);
    return id;
  }
  const payBlock = payBlockHtml(s, total, uniq);
  if (fields.invoice) {
    const lic = await env.DB.prepare('SELECT expires_at FROM licenses WHERE id=?').bind(fields.license_id).first();
    const what = p.includes_ea ? (p.includes_vps ? 'sewa VPS + EA' : 'sewa EA') : 'sewa VPS';
    const subj = `Tagihan ${what} akun ${fields.account_number}: ${rupiah(total)}`;
    await notify(env, user.id, subj, `Masa aktif berakhir ${fmtDate(lic && lic.expires_at)}. Bayar sebelum ${fmtDate(deadline)} agar tidak terputus.`, '#/bayar/' + id);
    await emailUser(env, user, subj,
      `<p>Halo ${esc(user.name)},</p><p>Berikut tagihan perpanjangan <b>${esc(p.name)}</b> (${durationLabel(q.months)}) untuk akun <b>${esc(fields.account_number)}</b>. Masa aktif saat ini berakhir <b>${fmtDate(lic && lic.expires_at)}</b>.</p>
       ${payBlock}<p style="color:#a3a3b2;font-size:13px">Ingin durasi lain (misal 1 tahun, lebih hemat)? Ganti durasinya di halaman tagihan sebelum membayar.</p>`,
      { text: 'Lihat & Bayar Tagihan', url: `${base}/member#/bayar/${id}` });
  } else {
    await notify(env, user.id, `Pesanan ${code} dibuat`, `Silakan transfer ${rupiah(total)} (termasuk kode unik ${uniq}) lalu konfirmasi pembayaran.`
      + (p.requires_ib ? ' Admin juga akan mengecek akun Anda terdaftar di bawah IB kami.' : ''), '#/pesanan/' + id);
    await emailUser(env, user, `Pesanan ${code}: silakan transfer ${rupiah(total)}`,
      `<p>Halo ${esc(user.name)},</p><p>Terima kasih atas pesanan <b>${esc(code)}</b> (${esc(p.name)}${q.months ? `, ${durationLabel(q.months)}` : ''}) untuk akun <b>${esc(fields.account_number)}</b>.</p>${payBlock}`,
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
  // a new amount: the locked USDT amount and any QRIS / VA transaction no longer fit and are made again on demand
  await env.DB.prepare(`UPDATE orders SET months=?, unit_price=?, discount_pct=?, subtotal=?, total=?+unique_code,
      usdt_amount=0, usdt_locked_at=0, gateway_ref='', gateway_data='', gateway_method='' WHERE id=?`)
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
    const durs = productDurations(await getProduct(env, l.product_id), s);
    const months = last && durs.includes(last.months) ? last.months : durs[0] || 1;
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
// USDT (TRC20) payment: shown next to the bank accounts when the admin enabled it. Amount = rupiah total / live rate,
// rounded up to 2 decimals (the 3-digit unique code already makes every order's amount different)
export const TRC20_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
export async function usdtPay(env, s, totalIdr, waitUntil) {
  if (s.usdt_enabled !== '1' || !TRC20_RE.test(s.usdt_address || '')) return null;
  const { rate } = await getUsdIdr(env, waitUntil);
  return { network: 'TRC20', address: s.usdt_address, qr: !!s.usdt_qr_file_id, rate: rate || 0,
    amount: rate && totalIdr ? Math.ceil((totalIdr / rate) * 100) / 100 : 0 };
}

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
  if (c === 'USC' || c === 'USX' || c === 'UST' || c === 'CNT') return amount / 100 * rate;
  if (c === 'USD') return amount * rate;
  return null;
}
export function boardName(full, mode, hidden) {
  if (hidden || mode === 'hidden') return 'Member Anonim';
  const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Member';
  if (mode === 'full') return parts.join(' ');
  const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
  if (mode === 'first') return cap(parts[0]).slice(0, 2) + '****';
  // default: first name + initial of the second word, e.g. "Budi S****"; a single name is censored too ("Bu****")
  if (!parts[1]) return cap(parts[0]).slice(0, 2) + '****';
  return cap(parts[0]) + ' ' + parts[1][0].toUpperCase() + '****';
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

export const reportInterval = (s) => Math.max(5, Math.min(1440, Number(s.report_interval_min || 30))) * 60;   // seconds

// Every active EA licence of a platform gets a fresh build (new EA version or admin "rebuild all").
export async function rebuildAll(env, platform, reason) {
  const { results } = await env.DB.prepare(`SELECT l.id FROM licenses l JOIN products p ON p.id=l.product_id
      WHERE p.includes_ea=1 AND l.status='active' AND (? = '' OR l.platform=?)`).bind(platform || '', platform || '').all();
  for (const r of results) await queueBuild(env, r.id, reason);
  return results.length;
}

// Per-licence secret (licenses.report_token), created on first use and stable afterwards. The licence key
// `lic.<license_id>.<report_token>` built from it is used by the licensed EA (heartbeat) and the member's VPS agent.
export async function ensureReportToken(env, licenseId) {
  const lic = await env.DB.prepare('SELECT report_token FROM licenses WHERE id=?').bind(licenseId).first();
  if (!lic) return '';
  if (lic.report_token) return lic.report_token;
  const token = randomToken(24);
  // two parallel callers: only the first token is kept, both read it back
  await env.DB.prepare(`UPDATE licenses SET report_token=? WHERE id=? AND (report_token IS NULL OR report_token='')`).bind(token, licenseId).run();
  const again = await env.DB.prepare('SELECT report_token FROM licenses WHERE id=?').bind(licenseId).first();
  return (again && again.report_token) || token;
}
export const licKey = (licenseId, token) => `lic.${licenseId}.${token}`;
// exact byte length of a base64 string (the '=' padding is not data)
export const b64Len = (v) => Math.floor(String(v).length * 3 / 4) - (String(v).endsWith('==') ? 2 : String(v).endsWith('=') ? 1 : 0);

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
  const token = await ensureReportToken(env, job.license_id);
  // licence type for the EA panel (builder maps it: ea_rent SEWA, ea_ib FREE IB, ea_share SHARING PROFIT, ea_trial TRIAL, vps_ea SEWA + VPS ...)
  const kind = await env.DB.prepare('SELECT p.kind FROM licenses l JOIN products p ON p.id=l.product_id WHERE l.id=?').bind(job.license_id).first();
  return { id: job.id, license_id: job.license_id, platform: job.platform, account_number: job.account_number, expires_at: job.expires_at || 0,
    lic_kind: (kind && kind.kind) || '',
    report_token: token, report_interval: reportInterval(s),
    // licence key for the EA heartbeat (/ea/live, header x-ea-key) = lic.<license_id>.<report_token>
    lic_key: licKey(job.license_id, token) };
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
  const size = b64Len(data_b64);   // exact: the VPS agent checks the downloaded size against it
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
    // The member's VPS agent reported in the last 24 h: it installs the new file by itself within a minute.
    const agent = await env.DB.prepare('SELECT host FROM ea_vps_lic WHERE license_id=? AND updated_at > ? ORDER BY updated_at DESC LIMIT 1').bind(lic.id, t - DAY).first();
    const ver = ea_version ? ` <b>versi ${esc(ea_version)}</b>` : '';
    if (agent) {
      await notify(env, lic.user_id, 'EA baru dipasang otomatis di VPS', `Akun ${lic.account_number}: agen VPS ${agent.host} memasangnya dalam ±1 menit.`, '#/lisensi');
      await emailUser(env, user, 'EA baru dipasang otomatis di VPS Anda',
        `<p>Halo ${esc(user.name)},</p><p>File EA${ver} untuk akun <b>${esc(lic.account_number)}</b> sudah dibuat (berlaku: <b>${fmtDate(lic.expires_at)}</b>).</p>
         <p>Agen VPS di <b>${esc(agent.host)}</b> akan memasangnya <b>otomatis dalam ±1 menit</b> dan me-restart MetaTrader akun ini, jadi Anda tidak perlu mengunduh apa pun. Status pemasangan tampil di menu <b>Lisensi &amp; VPS</b>.</p>`,
        { text: 'Lihat Status', url: `${base}/member#/lisensi` });
    } else {
      await notify(env, lic.user_id, 'File EA baru siap diunduh', `Akun ${lic.account_number}, berlaku: ${fmtDate(lic.expires_at)}.`, '#/lisensi');
      await emailUser(env, user, 'File EA baru siap diunduh',
        `<p>Halo ${esc(user.name)},</p><p>File EA${ver} untuk akun <b>${esc(lic.account_number)}</b> sudah dibuat (berlaku: <b>${fmtDate(lic.expires_at)}</b>). Silakan unduh dan ganti file lama di MetaTrader Anda.</p>
         <p style="color:#a3a3b2;font-size:13px">Ingin update berikutnya terpasang otomatis? Pasang agen VPS dari menu <b>Lisensi &amp; VPS</b> (bagian "Update otomatis VPS").</p>`,
        { text: 'Unduh EA', url: `${base}/member#/lisensi` });
    }
  }
  return { ok: true };
}

/// ---------- daily job: reminders, expiries, cleanup ----------
// Licence reminders (rent / VPS / trial): H-3 and H-1 (settings.reminder_days), on the expiry day, then one renewal email
// the day after. Sharing profit licences follow their weekly invoices instead (invoice email + H-1 before the due date).
// `extra` (e.g. the weekly sharing run) is stored with the result in daily_last_run.
export async function runDaily(env, base, extra = {}) {
  const t = now();
  const s = await getSettings(env);
  const days = [...s.reminder_days].map(Number).filter((d) => d > 0).sort((a, b) => b - a);
  const out = { reminders: 0, expired: 0, unpaid_expired: 0, invoices: 0, renewal_emails: 0, share_due_reminders: 0, ...extra };
  const host = esc(base.replace(/^https?:\/\//, ''));
  const tokens = (l) => (l.reminder_exp === l.expires_at ? String(l.reminders_sent || '').split(',').filter(Boolean) : []);
  // Unpaid orders past their deadline lapse first, so a fresh invoice can be issued below.
  // Sharing invoices never lapse: the licence stays paused until they are paid.
  out.unpaid_expired = (await env.DB.prepare(`UPDATE orders SET status='expired' WHERE status='awaiting_payment' AND kind<>'share' AND pay_deadline < ?`).bind(t).run()).meta.changes || 0;
  out.invoices = await createDueInvoices(env, base);

  const maxDay = days[0] || 3;
  const { results: soon } = await env.DB.prepare(`
    SELECT l.*, p.name AS product_name, p.billing, p.includes_vps, p.includes_ea, p.requires_ib, u.email, u.name AS user_name
      FROM licenses l JOIN products p ON p.id=l.product_id JOIN users u ON u.id=l.user_id
     WHERE p.billing IN ('monthly','trial') AND l.status='active' AND l.expires_at IS NOT NULL AND l.expires_at > ? AND l.expires_at <= ?`)
    .bind(t, t + maxDay * DAY).all();
  for (const l of soon) {
    const left = Math.ceil((l.expires_at - t) / DAY);
    const sent = tokens(l);
    const stage = days.filter((d) => left <= d && !sent.includes(String(d))).pop(); // smallest due stage
    if (stage === undefined) continue;
    const allDue = days.filter((d) => left <= d).map(String);
    const trial = l.billing === 'trial';
    const what = trial ? 'trial EA' : !l.includes_ea || (l.includes_vps && l.requires_ib) ? 'sewa VPS' : l.includes_vps ? 'sewa VPS + EA' : 'sewa EA';
    const title = `Masa ${what} akun ${l.account_number} tinggal ${left} hari`;
    const inv = trial ? null : await env.DB.prepare(`SELECT id, total FROM orders WHERE license_id=? AND kind='renew' AND status='awaiting_payment' ORDER BY id DESC LIMIT 1`).bind(l.id).first();
    await notify(env, l.user_id, title, inv ? `Berakhir ${fmtDate(l.expires_at)}. Tagihan ${rupiah(inv.total)} menunggu pembayaran.`
      : trial ? `Trial berakhir ${fmtDate(l.expires_at)}. Lanjutkan dengan Sewa EA atau Sharing Profit di menu Order.` : `Berakhir ${fmtDate(l.expires_at)}. Klik Perpanjang di menu Lisensi & VPS.`,
      inv ? '#/bayar/' + inv.id : trial ? '#/order' : '#/lisensi');
    await emailUser(env, { email: l.email }, title,
      `<p>Halo ${esc(l.user_name)},</p><p>Masa ${what} (<b>${esc(l.product_name)}</b>) untuk akun <b>${esc(l.account_number)}</b> tinggal <b>${left} hari</b> lagi dan berakhir pada <b>${fmtDate(l.expires_at)}</b>. Setelah itu EA berhenti membuka posisi baru (posisi yang berjalan tetap diurus sampai selesai).</p>
       ${inv ? `<p>Tagihan perpanjangan <b>${rupiah(inv.total)}</b> sudah tersedia. Login ke <a href="${base}/masuk">${host}</a>, buka menu <b>Tagihan &amp; Pembayaran</b>, lalu bayar dengan metode pilihan Anda.</p>`
         : trial ? `<p>Ingin lanjut? Pilih <b>Sewa EA</b> atau <b>Sharing Profit</b> (tanpa biaya di depan, komisi ${sharePct(s)}% dari profit mingguan) di menu <b>Order</b>.</p>`
         : `<p>Untuk memperpanjang, login ke <a href="${base}/masuk">${host}</a>, buka menu <b>Lisensi &amp; VPS</b>, lalu klik <b>Perpanjang</b> pada akun yang terdaftar.</p>`}`,
      inv ? { text: 'Bayar Tagihan', url: `${base}/member#/bayar/${inv.id}` } : trial ? { text: 'Lihat Paket', url: `${base}/member#/order` } : { text: 'Perpanjang Sekarang', url: `${base}/member#/lisensi` });
    await env.DB.prepare('UPDATE licenses SET reminder_exp=?, reminders_sent=? WHERE id=?')
      .bind(l.expires_at, [...new Set([...sent, ...allDue])].join(','), l.id).run();
    out.reminders++;
  }

  // Sharing invoices: one reminder about a day before the due date (the EA pauses new orders at that moment)
  const { results: dueShare } = await env.DB.prepare(`SELECT o.*, u.email, u.name AS user_name FROM orders o JOIN users u ON u.id=o.user_id
      WHERE o.kind='share' AND o.status='awaiting_payment' AND o.reminded_at=0 AND o.pay_deadline > ? AND o.pay_deadline <= ?`).bind(t, t + DAY + 3 * 3600).all();
  for (const o of dueShare) {
    const title = `Tagihan sharing profit ${o.code} jatuh tempo ${fmtDate(o.pay_deadline)}`;
    await notify(env, o.user_id, title, `Bayar ${rupiah(o.total)} agar EA akun ${o.account_number} tidak berhenti membuka posisi baru.`, '#/bayar/' + o.id);
    await emailUser(env, { email: o.email }, title,
      `<p>Halo ${esc(o.user_name)},</p><p>Tagihan komisi sharing profit <b>${esc(o.code)}</b> untuk akun <b>${esc(o.account_number)}</b> sebesar <b>${rupiah(o.total)}</b> jatuh tempo <b>${fmtDate(o.pay_deadline)} 23:59 WIB</b>.</p>
       <p>Bila belum dibayar sampai saat itu, EA berhenti membuka posisi baru (posisi berjalan tetap diurus) sampai tagihan lunas.</p>`,
      { text: 'Bayar Tagihan', url: `${base}/member#/bayar/${o.id}` });
    await env.DB.prepare('UPDATE orders SET reminded_at=? WHERE id=?').bind(t, o.id).run();
    out.share_due_reminders++;
  }

  const { results: gone } = await env.DB.prepare(`
    SELECT l.*, p.name AS product_name, p.billing, u.email, u.name AS user_name
      FROM licenses l JOIN products p ON p.id=l.product_id JOIN users u ON u.id=l.user_id
     WHERE l.status='active' AND l.expires_at IS NOT NULL AND l.expires_at <= ?`).bind(t).all();
  for (const l of gone) {
    await env.DB.prepare(`UPDATE licenses SET status='expired', reminder_exp=?, reminders_sent=?, updated_at=? WHERE id=?`)
      .bind(l.expires_at, [...new Set([...tokens(l), '0'])].join(','), t, l.id).run();
    let title = `Masa aktif akun ${l.account_number} sudah berakhir`, body = 'Perpanjang agar EA aktif kembali.', link = '#/lisensi', cta = { text: 'Perpanjang', url: `${base}/member#/lisensi` };
    let html = `<p>Masa aktif <b>${esc(l.product_name)}</b> untuk akun <b>${esc(l.account_number)}</b> berakhir pada ${fmtDate(l.expires_at)}. EA berhenti membuka posisi baru (posisi yang berjalan tetap diurus sampai selesai).</p>`;
    if (l.billing === 'share') {
      const inv = await env.DB.prepare(`SELECT id, code, total FROM orders WHERE license_id=? AND kind='share' AND status IN ('awaiting_payment','awaiting_verification') ORDER BY id LIMIT 1`).bind(l.id).first();
      title = `Sharing profit akun ${l.account_number} dijeda`;
      body = inv ? `Tagihan ${inv.code} (${rupiah(inv.total)}) belum dibayar. EA aktif lagi otomatis setelah lunas.` : 'EA belum melapor ke web. Aktifkan WebRequest agar laporan masuk dan lisensi diperpanjang otomatis.';
      link = inv ? '#/bayar/' + inv.id : '#/lisensi';
      cta = inv ? { text: 'Bayar Tagihan', url: `${base}/member#/bayar/${inv.id}` } : { text: 'Buka Lisensi', url: `${base}/member#/lisensi` };
      html = inv ? `<p>Tagihan komisi <b>${esc(inv.code)}</b> sebesar <b>${rupiah(inv.total)}</b> untuk akun <b>${esc(l.account_number)}</b> melewati jatuh tempo, jadi EA berhenti membuka posisi baru (posisi berjalan tetap diurus). Begitu tagihan lunas, lisensi aktif lagi dan file EA baru dibuat otomatis.</p>`
        : `<p>EA di akun <b>${esc(l.account_number)}</b> tidak mengirim laporan ke web, sehingga profit mingguan tidak bisa dihitung dan lisensi sharing profit tidak diperpanjang. Izinkan WebRequest <b>https://goldhuntergaruda.com</b> di MetaTrader (Tools → Options → Expert Advisors). Begitu EA melapor lagi, lisensi diperpanjang otomatis.</p>`;
    } else if (l.billing === 'trial') {
      title = `Trial EA akun ${l.account_number} sudah berakhir`;
      body = 'Lanjutkan dengan Sewa EA atau Sharing Profit di menu Order.';
      link = '#/order';
      cta = { text: 'Lihat Paket', url: `${base}/member#/order` };
    }
    await notify(env, l.user_id, title, body, link);
    await emailUser(env, { email: l.email }, title, `<p>Halo ${esc(l.user_name)},</p>${html}`, cta);
    out.expired++;
  }

  // Renewal email the day after the expiry (rent / VPS / trial), once per expiry date
  const { results: lapsed } = await env.DB.prepare(`
    SELECT l.*, p.name AS product_name, p.billing, u.email, u.name AS user_name
      FROM licenses l JOIN products p ON p.id=l.product_id JOIN users u ON u.id=l.user_id
     WHERE p.billing IN ('monthly','trial') AND l.status='expired' AND l.expires_at IS NOT NULL AND l.expires_at <= ? AND l.expires_at > ?`)
    .bind(t - DAY + 3600, t - 30 * DAY).all();
  for (const l of lapsed) {
    const sent = tokens(l);
    if (sent.includes('r')) continue;
    const trial = l.billing === 'trial';
    const inv = trial ? null : await env.DB.prepare(`SELECT id, total FROM orders WHERE license_id=? AND kind='renew' AND status='awaiting_payment' ORDER BY id DESC LIMIT 1`).bind(l.id).first();
    const title = trial ? 'Lanjutkan GOLD HUNTER GARUDA setelah trial' : `Aktifkan lagi EA akun ${l.account_number}`;
    await notify(env, l.user_id, title, inv ? `Tagihan perpanjangan ${rupiah(inv.total)} masih bisa dibayar.` : trial ? 'Pilih Sewa EA atau Sharing Profit.' : 'Perpanjang dari menu Lisensi & VPS.', inv ? '#/bayar/' + inv.id : trial ? '#/order' : '#/lisensi');
    await emailUser(env, { email: l.email }, title,
      `<p>Halo ${esc(l.user_name)},</p><p>${trial ? `Trial EA untuk akun <b>${esc(l.account_number)}</b> sudah selesai. Terima kasih sudah mencoba!` : `Masa aktif <b>${esc(l.product_name)}</b> untuk akun <b>${esc(l.account_number)}</b> sudah berakhir ${fmtDate(l.expires_at)}.`}</p>
       ${trial ? `<p>Lanjutkan dengan <b>Sewa EA</b> (pilih 1 bulan sampai 2 tahun, update otomatis gratis) atau <b>Sharing Profit</b> (tanpa biaya di depan, komisi ${sharePct(s)}% dari profit mingguan).</p>`
         : inv ? `<p>Tagihan perpanjangan <b>${rupiah(inv.total)}</b> masih bisa dibayar. Setelah lunas, file EA baru dibuat dan terpasang otomatis bila agen VPS aktif.</p>`
         : '<p>Perpanjang dari menu <b>Lisensi &amp; VPS</b>; setelah lunas, file EA baru dibuat otomatis.</p>'}`,
      inv ? { text: 'Bayar Tagihan', url: `${base}/member#/bayar/${inv.id}` } : trial ? { text: 'Lihat Paket', url: `${base}/member#/order` } : { text: 'Perpanjang', url: `${base}/member#/lisensi` });
    await env.DB.prepare('UPDATE licenses SET reminder_exp=?, reminders_sent=? WHERE id=?').bind(l.expires_at, [...new Set([...sent, 'r'])].join(','), l.id).run();
    out.renewal_emails++;
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
