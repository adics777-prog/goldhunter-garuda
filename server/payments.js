// Payments: one confirmation path for every method, USDT TRC20 checked on chain, automatic gateway (QRIS / Virtual Account).
//
// Methods per order (orders.pay_method, the member can switch while the order is unpaid):
//   bank    : amount + unique code, member uploads proof, admin clicks "Sudah Bayar"
//   usdt    : unique USDT amount locked per order (usdt_amount); incoming TRC20 transfers to settings.usdt_address are read
//             from TronGrid on a schedule and when the member clicks "Saya sudah bayar"; an exact match pays the order
//   gateway : provider-agnostic QRIS / VA (server/gateway: adapter per provider, settings.gateway_provider). The provider
//             notifies /api/pay/gateway/<provider>/callback (verified by the adapter); open transactions are also re-checked
// Paid -> confirmPaid(): new / renewal orders go through processOrder (licence + EA build, completed automatically when
// the build is done), sharing invoices through settleSharePaid (licence moves to the next week).
import { now, DAY, fail, esc, rupiah, decrypt } from './util.js';
import { getSettings, putSetting, getUsdIdr, processOrder, getUser, notify, emailAdmin, TRC20_RE } from './logic.js';
import { settleSharePaid } from './share.js';
import { PROVIDERS, gatewayConfig, gatewayReady } from './gateway/index.js';
export { gatewayReady };

// ---------- one confirmation path ----------
// via: bank (admin checked the statement) | usdt | gateway. Returns { ok, already?, waiting_ib?, license_id? }.
export async function confirmPaid(env, base, orderId, { via, ref = '' }) {
  const o = await env.DB.prepare('SELECT o.*, p.requires_ib, p.name AS product_name FROM orders o JOIN products p ON p.id=o.product_id WHERE o.id=?').bind(orderId).first();
  if (!o) fail(404, 'Order tidak ditemukan');
  if (!['awaiting_payment', 'awaiting_verification'].includes(o.status)) return { ok: false, already: true, status: o.status };
  if (!o.total) fail(400, 'Order gratis tidak perlu pembayaran');
  const t = now();
  // claim: two checkers (cron + member click) never process the same payment twice
  const claim = await env.DB.prepare(`UPDATE orders SET paid_via=?, paid_ref=?, paid_at=COALESCE(paid_at, ?) WHERE id=? AND paid_via=''
      AND status IN ('awaiting_payment','awaiting_verification')`).bind(via, String(ref).slice(0, 120), t, o.id).run();
  if (!claim.meta.changes && via !== 'bank') return { ok: false, already: true };
  if (o.kind === 'share') return settleSharePaid(env, base, o.id);
  if (o.requires_ib && o.kind === 'new' && o.ib_status !== 'yes') {
    // paid VPS package for an IB account: money is in, the admin still checks the IB first
    await env.DB.prepare(`UPDATE orders SET status='awaiting_verification', confirmed_at=COALESCE(confirmed_at, ?) WHERE id=?`).bind(t, o.id).run();
    await notify(env, o.user_id, `Pembayaran ${o.code} diterima`, 'Admin mengecek akun Anda di bawah IB kami, lalu pesanan diproses.', '#/pesanan/' + o.id);
    await emailAdmin(env, base, `Pembayaran ${o.code} masuk (${via}), cek IB`,
      `<p>Pembayaran <b>${rupiah(o.total)}</b> untuk ${esc(o.product_name)} akun <b>${esc(o.account_number)}</b> masuk lewat <b>${esc(via)}</b>. Cek akun di portal partner, klik "Ya, under IB" lalu Proses.</p>`, '/admin#/pesanan/' + o.id);
    return { ok: true, waiting_ib: true };
  }
  const licenseId = await processOrder(env, base, o.id, { paid: true, auto: via !== 'bank' });
  if (via !== 'bank') await emailAdmin(env, base, `Pembayaran ${o.code} otomatis (${via})`,
    `<p>Pembayaran <b>${rupiah(o.total)}</b> untuk ${esc(o.product_name)} akun <b>${esc(o.account_number)}</b> terverifikasi otomatis lewat <b>${esc(via)}</b>${ref ? ` (ref <span style="font-family:monospace">${esc(ref)}</span>)` : ''}. Pesanan langsung diproses.</p>`, '/admin#/pesanan/' + o.id);
  return { ok: true, license_id: licenseId };
}

// ---------- USDT (TRC20) ----------
export const USDT_TRC20 = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';   // Tether USD on TRON
export const usdtOn = (s) => s.usdt_enabled === '1' && TRC20_RE.test(s.usdt_address || '');
const cents = (v) => Math.round(Number(v) * 100);

// Amount before the unique cents: sharing invoices = commission in USD, other orders = Rupiah subtotal / live rate
export async function usdtBase(env, o, waitUntil) {
  const { rate } = await getUsdIdr(env, waitUntil);
  if (o.amount_usd > 0) return { amount: Math.ceil(o.amount_usd * 100) / 100, rate: rate || 0 };
  if (!rate) return { amount: 0, rate: 0 };
  return { amount: Math.ceil((o.subtotal / rate) * 100) / 100, rate };
}
// Lock a USDT amount that no other open USDT order has (+0.01 steps), so an incoming transfer points at one order only
export async function usdtLock(env, o, waitUntil) {
  if (o.pay_method === 'usdt' && o.usdt_amount > 0) return o.usdt_amount;
  const { amount, rate } = await usdtBase(env, o, waitUntil);
  if (!amount) fail(503, 'Kurs USD/IDR belum tersedia, coba lagi sebentar');
  const { results } = await env.DB.prepare(`SELECT usdt_amount FROM orders WHERE usdt_amount > 0 AND id<>? AND pay_method='usdt'
      AND status IN ('awaiting_payment','awaiting_verification')`).bind(o.id).all();
  const used = new Set(results.map((r) => cents(r.usdt_amount)));
  let c = cents(amount);
  for (let k = 0; k < 1000 && used.has(c); k++) c++;
  const val = c / 100;
  await env.DB.prepare(`UPDATE orders SET pay_method='usdt', usdt_amount=?, usdt_rate=?, usdt_locked_at=? WHERE id=?`).bind(val, rate || 0, now(), o.id).run();
  return val;
}

// Incoming USDT transfers to the wallet since fromSec (TronGrid; env.TRONGRID_BASE overrides the host for tests)
async function trc20Incoming(env, s, address, fromSec) {
  const host = String(env.TRONGRID_BASE || 'https://api.trongrid.io').replace(/\/$/, '');
  const key = s.trongrid_api_key_enc ? await decrypt(env, s.trongrid_api_key_enc) : '';
  const headers = { accept: 'application/json' };
  if (key && key !== '(gagal didekripsi)') headers['TRON-PRO-API-KEY'] = key;
  let url = `${host}/v1/accounts/${address}/transactions/trc20?only_to=true&only_confirmed=true&limit=200&contract_address=${USDT_TRC20}&min_timestamp=${Math.max(0, fromSec) * 1000}`;
  const out = [];
  for (let page = 0; page < 5 && url; page++) {
    const r = await fetch(url, { headers });
    if (!r.ok) throw new Error(`TronGrid HTTP ${r.status}`);
    const j = await r.json();
    for (const x of j.data || []) {
      const tok = x.token_info || {};
      if (x.to !== address || (tok.address && tok.address !== USDT_TRC20) || (x.type && x.type !== 'Transfer')) continue;
      out.push({ id: String(x.transaction_id || '').toLowerCase(), value: Number(x.value) / 10 ** (Number(tok.decimals) || 6), ts: Math.floor(Number(x.block_timestamp) / 1000), from: x.from || '' });
    }
    url = j.meta && j.meta.links && j.meta.links.next ? j.meta.links.next : '';
  }
  return out;
}

// Match open USDT orders with incoming transfers. orderId + txid: the member pasted a transaction id, which may be a
// little more than the amount (exchange fee settings); otherwise only an exact amount after the lock counts.
export async function usdtScan(env, base, { orderId = 0, txid = '' } = {}) {
  const s = await getSettings(env);
  if (!usdtOn(s) || s.usdt_auto === '0') return { ok: false, off: true };
  const { results: open } = await env.DB.prepare(`SELECT id, code, usdt_amount, usdt_locked_at FROM orders WHERE pay_method='usdt' AND usdt_amount > 0
      AND paid_via='' AND status IN ('awaiting_payment','awaiting_verification')${orderId ? ' AND id=?' : ''}`).bind(...(orderId ? [orderId] : [])).all();
  if (!open.length) return { ok: true, open: 0, matched: 0 };
  let txs;
  try { txs = await trc20Incoming(env, s, s.usdt_address, Math.min(...open.map((o) => o.usdt_locked_at)) - 900); }
  catch (e) {
    await putSetting(env, 'usdt_scan_last', JSON.stringify({ at: now(), ok: false, error: String(e.message || e) }));
    return { ok: false, error: String(e.message || e) };
  }
  const ids = txs.map((x) => x.id).filter(Boolean);
  const used = new Set();
  for (let i = 0; i < ids.length; i += 50) {
    const part = ids.slice(i, i + 50);
    const { results } = await env.DB.prepare(`SELECT usdt_tx FROM orders WHERE usdt_tx IN (${part.map(() => '?').join(',')})`).bind(...part).all();
    results.forEach((r) => used.add(r.usdt_tx));
  }
  let matched = 0;
  for (const o of open) {
    let tx = txid && o.id === orderId ? txs.find((x) => x.id === txid && !used.has(x.id) && x.value + 1e-6 >= o.usdt_amount) : null;
    if (!tx) tx = txs.find((x) => !used.has(x.id) && Math.abs(x.value - o.usdt_amount) < 5e-7 && x.ts >= o.usdt_locked_at - 900);
    if (!tx) continue;
    used.add(tx.id);
    try {
      const u = await env.DB.prepare('UPDATE orders SET usdt_tx=? WHERE id=? AND usdt_tx IS NULL').bind(tx.id, o.id).run();
      if (!u.meta.changes) continue;
    } catch { continue; }                          // unique index: this transfer already paid another order
    try { const r = await confirmPaid(env, base, o.id, { via: 'usdt', ref: tx.id }); if (r.ok) matched++; }
    catch (e) { console.error('usdt confirm', o.id, e); }
  }
  await putSetting(env, 'usdt_scan_last', JSON.stringify({ at: now(), ok: true, open: open.length, seen: txs.length, matched }));
  return { ok: true, open: open.length, seen: txs.length, matched };
}

// ---------- automatic gateway (QRIS / Virtual Account) ----------
export const gatewayView = (o) => { try { return o.gateway_data ? JSON.parse(o.gateway_data) : null; } catch { return null; } };
const sameProvider = (o, c) => !o.gateway_provider || o.gateway_provider === c.id;

// Active channels of the configured provider (cached 6 hours in settings.gateway_channels)
export async function gatewayChannels(env, s, { refresh = false } = {}) {
  const c = await gatewayConfig(env, s);
  if (!c.configured) return [];
  const cache = s.gateway_channels && typeof s.gateway_channels === 'object' ? s.gateway_channels : null;
  if (!refresh && cache && cache.provider === c.id && cache.mode === c.mode && cache.at > now() - 6 * 3600 && Array.isArray(cache.list)) return cache.list;
  try {
    const list = await c.provider.channels(c);
    await putSetting(env, 'gateway_channels', { at: now(), provider: c.id, mode: c.mode, list });
    return list;
  } catch (e) {
    if (refresh) throw e;
    return cache && cache.provider === c.id && Array.isArray(cache.list) ? cache.list : c.provider.fallbackChannels || [];
  }
}

// One payment for one order; another channel = a new transaction (our ref = order code + -n)
export async function gatewayCreate(env, base, s, o, channel) {
  const c = await gatewayConfig(env, s);
  if (!c.on) fail(400, 'Pembayaran QRIS / Virtual Account belum aktif');
  const chans = await gatewayChannels(env, s);
  if (!chans.some((x) => x.code === channel)) fail(400, 'Metode pembayaran tidak tersedia');
  const user = await getUser(env, o.user_id);
  const p = await env.DB.prepare('SELECT code, name FROM products WHERE id=?').bind(o.product_id).first();
  const amount = Math.round(o.subtotal);
  const seq = (o.gateway_seq || 0) + 1;
  const ref = `${o.code}-${seq}`;
  const t = now();
  const expires = o.pay_deadline > t + 3600 ? Math.min(t + DAY, o.pay_deadline) : t + DAY;
  const name = (o.kind === 'share' ? 'Komisi sharing profit ' : o.kind === 'renew' ? 'Perpanjangan ' : '') + (p ? p.name : 'GOLD HUNTER GARUDA');
  const v = await c.provider.create(c, {
    ref, amount, channel, expires, customer: { name: user.name, email: user.email, phone: user.phone || '' },
    item: { sku: String((p && p.code) || 'GHG').slice(0, 50), name: name.slice(0, 100) },
    callback_url: `${base}/api/pay/gateway/${c.id}/callback`, return_url: `${base}/member#/bayar/${o.id}`,
  });
  const view = { provider: c.id, provider_name: c.name, method: channel, ref, ...v };
  await env.DB.prepare(`UPDATE orders SET pay_method='gateway', gateway_provider=?, gateway_ref=?, gateway_method=?, gateway_data=?, gateway_seq=? WHERE id=?`)
    .bind(c.id, view.reference, channel, JSON.stringify(view), seq, o.id).run();
  return view;
}

// Status of the current transaction (member "Saya sudah bayar", payments cron)
export async function gatewayCheck(env, base, s, o) {
  if (!o.gateway_ref) return null;
  const c = await gatewayConfig(env, s);
  if (!c.configured || !sameProvider(o, c)) return null;
  const d = await c.provider.status(c, o.gateway_ref);
  if (d.status === 'PAID') await confirmPaid(env, base, o.id, { via: 'gateway', ref: `${c.id}:${d.reference || o.gateway_ref}` });
  else if (['EXPIRED', 'FAILED'].includes(d.status)) {
    await env.DB.prepare(`UPDATE orders SET gateway_ref='', gateway_data='' WHERE id=? AND gateway_ref=? AND status='awaiting_payment'`).bind(o.id, o.gateway_ref).run();
  }
  return d.status;
}

// Notification from a provider. Returns [httpStatus, body].
export async function gatewayCallback(env, base, providerId, raw, headers) {
  const p = PROVIDERS[providerId];
  if (!p) return [404, { success: false, message: 'Unknown provider' }];
  const s = await getSettings(env);
  const c = await gatewayConfig(env, s);
  if (!c.configured || c.id !== providerId) return p.reply(false, 'Provider not configured');
  if (!(await c.provider.verifyCallback(c, raw, headers))) return p.reply(false, 'Invalid signature');
  const d = p.parseCallback(raw, headers);
  if (!d.ok) return p.reply(false, d.error);
  const code = String(d.ref || '').replace(/-\d+$/, '');
  const o = await env.DB.prepare('SELECT * FROM orders WHERE code=?').bind(code).first();
  if (!o) return [404, { success: false, message: 'Order not found' }];
  if (d.status === 'PAID') {
    if (d.amount && d.amount + 0.5 < o.subtotal) {
      await emailAdmin(env, base, `${p.name} ${o.code}: nominal kurang`, `<p>Notifikasi PAID ${esc(d.reference)} sebesar ${rupiah(d.amount)}, tagihan ${rupiah(o.subtotal)}. Cek manual.</p>`, '/admin#/pesanan/' + o.id);
      return p.reply(true);
    }
    await confirmPaid(env, base, o.id, { via: 'gateway', ref: `${p.id}:${d.reference || d.ref}` });
  } else if (['EXPIRED', 'FAILED'].includes(d.status) && d.reference && d.reference === o.gateway_ref) {
    await env.DB.prepare(`UPDATE orders SET gateway_ref='', gateway_data='' WHERE id=? AND status='awaiting_payment'`).bind(o.id).run();
  }
  return p.reply(true);
}

// Scheduled check (payments cron, builder poll): USDT scan + open gateway transactions
export async function paymentsTick(env, base) {
  const out = { usdt: await usdtScan(env, base).catch((e) => ({ ok: false, error: String(e.message || e) })), gateway: 0 };
  const s = await getSettings(env);
  const c = await gatewayConfig(env, s);
  if (c.configured) {
    const { results } = await env.DB.prepare(`SELECT * FROM orders WHERE pay_method='gateway' AND gateway_ref<>'' AND paid_via='' AND status='awaiting_payment' ORDER BY id DESC LIMIT 20`).all();
    for (const o of results) { try { await gatewayCheck(env, base, s, o); out.gateway++; } catch (e) { console.error('gateway check', o.id, e); } }
  }
  return out;
}
