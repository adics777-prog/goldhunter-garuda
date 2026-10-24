// Tripay adapter (closed payment), written against Tripay's documented API (https://tripay.co.id/developer):
//   GET  /merchant/payment-channel                   (Authorization: Bearer <api key>)
//   POST /transaction/create   signature = hex HMAC-SHA256(merchant_code + merchant_ref + amount, private key)
//   GET  /transaction/detail?reference=...
//   callback: header X-Callback-Signature = hex HMAC-SHA256(raw JSON body, private key), X-Callback-Event: payment_status
// Hosts: https://tripay.co.id/api (production), https://tripay.co.id/api-sandbox (sandbox); env.TRIPAY_BASE overrides (tests).
import { hmacHex, safeEqual } from './hmac.js';

export const tripaySignature = (privateKey, merchantCode, merchantRef, amount) => hmacHex(privateKey, `${merchantCode}${merchantRef}${amount}`);
export async function tripayCallbackValid(privateKey, rawBody, header) {
  if (!privateKey || !header) return false;
  return safeEqual(await hmacHex(privateKey, rawBody), String(header).trim().toLowerCase());
}

const host = (cfg) => String((cfg.env && cfg.env.TRIPAY_BASE) || (cfg.production ? 'https://tripay.co.id/api' : 'https://tripay.co.id/api-sandbox')).replace(/\/$/, '');
async function call(cfg, path, { method = 'GET', body } = {}) {
  const headers = { authorization: 'Bearer ' + cfg.creds.api_key, accept: 'application/json' };
  if (body) headers['content-type'] = 'application/json';
  const r = await fetch(host(cfg) + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let j = {};
  try { j = await r.json(); } catch {}
  if (!r.ok || j.success === false) throw new Error(`Tripay: ${j.message || 'HTTP ' + r.status}`);
  return j.data;
}
const STATUS = { PAID: 'PAID', EXPIRED: 'EXPIRED', FAILED: 'FAILED', REFUND: 'FAILED', UNPAID: 'PENDING' };

export default {
  id: 'tripay',
  name: 'Tripay',
  implemented: true,
  docs: 'https://tripay.co.id/developer',
  note: 'Callback URL dipasang di pengaturan merchant Tripay.',
  fields: [
    { key: 'merchant_code', label: 'Kode merchant', secret: false, re: /^[A-Za-z0-9_-]{3,30}$/, placeholder: 'T12345' },
    { key: 'api_key', label: 'API key', secret: true, re: /^[A-Za-z0-9._-]{10,200}$/ },
    { key: 'private_key', label: 'Private key', secret: true, re: /^[A-Za-z0-9._-]{5,200}$/ },
  ],
  fallbackChannels: [
    { code: 'QRIS', name: 'QRIS (semua e-wallet & m-banking)', group: 'QRIS' },
    { code: 'BRIVA', name: 'BRI Virtual Account', group: 'Virtual Account' },
    { code: 'BNIVA', name: 'BNI Virtual Account', group: 'Virtual Account' },
    { code: 'MANDIRIVA', name: 'Mandiri Virtual Account', group: 'Virtual Account' },
    { code: 'PERMATAVA', name: 'Permata Virtual Account', group: 'Virtual Account' },
  ],
  // [{ code, name, group: 'QRIS' | 'Virtual Account' }]
  async channels(cfg) {
    const d = await call(cfg, '/merchant/payment-channel');
    return (Array.isArray(d) ? d : []).filter((x) => x.active !== false && (x.group === 'Virtual Account' || /QRIS/i.test(x.code || '')))
      .map((x) => ({ code: String(x.code), name: String(x.name || x.code), group: /QRIS/i.test(x.code) ? 'QRIS' : 'Virtual Account' }));
  },
  // req: { ref (unique per attempt), amount (IDR int), channel, expires (unix), customer {name,email,phone}, item {sku,name}, callback_url, return_url }
  async create(cfg, req) {
    const body = {
      method: req.channel, merchant_ref: req.ref, amount: req.amount,
      customer_name: req.customer.name, customer_email: req.customer.email, customer_phone: req.customer.phone || '',
      order_items: [{ sku: req.item.sku, name: req.item.name, price: req.amount, quantity: 1 }],
      callback_url: req.callback_url, return_url: req.return_url, expired_time: req.expires,
      signature: await tripaySignature(cfg.creds.private_key, cfg.creds.merchant_code, req.ref, req.amount),
    };
    const d = await call(cfg, '/transaction/create', { method: 'POST', body });
    return {
      reference: d.reference, payment_name: d.payment_name || req.channel, pay_code: d.pay_code || '', qr_string: d.qr_string || '', qr_url: d.qr_url || '',
      checkout_url: d.checkout_url || '', amount: Number(d.amount) || req.amount, fee_customer: Number(d.fee_customer) || 0, expired_time: Number(d.expired_time) || req.expires,
      instructions: (Array.isArray(d.instructions) ? d.instructions : []).slice(0, 6).map((i) => ({ title: String(i.title || ''), steps: (i.steps || []).slice(0, 15).map(String) })),
    };
  },
  // -> { status: PAID | PENDING | EXPIRED | FAILED, reference }
  async status(cfg, reference) {
    const d = await call(cfg, '/transaction/detail?reference=' + encodeURIComponent(reference));
    return { status: STATUS[String(d && d.status).toUpperCase()] || 'PENDING', reference: d && d.reference, amount: Number(d && d.amount) || 0 };
  },
  verifyCallback: (cfg, raw, headers) => tripayCallbackValid(cfg.creds.private_key, raw, headers.get('x-callback-signature')),
  // -> { ok, ref (our merchant ref), reference, status, amount } | { ok: false, error }
  parseCallback(raw, headers) {
    const ev = headers.get('x-callback-event');
    if (ev && ev !== 'payment_status') return { ok: false, error: 'Unrecognized callback event: ' + ev };
    let d;
    try { d = JSON.parse(raw); } catch { return { ok: false, error: 'Invalid JSON' }; }
    return { ok: true, ref: String(d.merchant_ref || ''), reference: String(d.reference || ''), status: STATUS[String(d.status || '').toUpperCase()] || 'PENDING', amount: Number(d.total_amount) || 0 };
  },
  reply: (ok, message) => (ok ? [200, { success: true }] : [message === 'Invalid signature' ? 403 : 400, { success: false, message }]),
};
