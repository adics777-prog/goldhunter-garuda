// Automatic payment gateway (QRIS / Virtual Account), provider-agnostic.
//
// Adapter interface (one file per provider in this folder):
//   id, name, implemented, docs, note
//   fields:            [{ key, label, secret, re, placeholder }]  credentials; secret ones are stored encrypted
//   channels(cfg)      -> [{ code, name, group: 'QRIS' | 'Virtual Account' }]
//   create(cfg, req)   -> { reference, payment_name, pay_code, qr_string, qr_url, checkout_url, amount, fee_customer, expired_time, instructions }
//                         req = { ref, amount, channel, expires, customer {name,email,phone}, item {sku,name}, callback_url, return_url }
//   status(cfg, ref)   -> { status: PAID | PENDING | EXPIRED | FAILED, reference, amount }
//   verifyCallback(cfg, rawBody, headers) -> boolean   (authenticity of a notification)
//   parseCallback(rawBody, headers)       -> { ok, ref, reference, status, amount } | { ok: false, error }
//   reply(ok, message) -> [httpStatus, body]          (what the provider expects back)
// Settings: gateway_provider ('' = off), gateway_enabled, gateway_mode (sandbox | production),
//           gw_<provider>_<field> (plain) / gw_<provider>_<field>_enc (secret, AES-GCM like the other secrets).
// Members only see the option when the provider is implemented, switched on and every credential is saved.
import { decrypt } from '../util.js';
import tripay from './tripay.js';
import linkqu from './linkqu.js';

export const PROVIDERS = { linkqu, tripay };
export const gwKey = (pid, f) => `gw_${pid}_${f.key}${f.secret ? '_enc' : ''}`;
export const gatewayProvider = (s) => PROVIDERS[s.gateway_provider] || null;
const hasAll = (s, p) => p.fields.every((f) => !!String(s[gwKey(p.id, f)] || '').trim());
// sync check without decrypting (catalog, emails)
export const gatewayReady = (s) => { const p = gatewayProvider(s); return !!p && p.implemented && s.gateway_enabled === '1' && hasAll(s, p); };

export async function gatewayConfig(env, s) {
  const p = gatewayProvider(s);
  if (!p) return { provider: null, configured: false, on: false };
  const creds = {};
  for (const f of p.fields) {
    const v = s[gwKey(p.id, f)] || '';
    const x = f.secret ? (v ? await decrypt(env, v) : '') : String(v).trim();
    creds[f.key] = x === '(gagal didekripsi)' ? '' : x;
  }
  const configured = p.implemented && p.fields.every((f) => !!creds[f.key]);
  const production = s.gateway_mode === 'production';
  return { provider: p, id: p.id, name: p.name, creds, production, mode: production ? 'production' : 'sandbox', configured, on: configured && s.gateway_enabled === '1', env };
}
