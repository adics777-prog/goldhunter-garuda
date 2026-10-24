// Unit test of the payment gateway signatures (node scripts/test-gateway-signature.mjs).
// Reference = Node's own crypto.createHmac, i.e. PHP hash_hmac('sha256', data, key) as in the providers' docs.
import { createHmac } from 'node:crypto';
import { hmacHex, safeEqual } from '../server/gateway/hmac.js';
import tripay, { tripaySignature, tripayCallbackValid } from '../server/gateway/tripay.js';
import linkqu from '../server/gateway/linkqu.js';
import { PROVIDERS, gatewayReady, gwKey } from '../server/gateway/index.js';

let fail = 0;
const ok = (cond, name) => { console.log(`${cond ? '✔' : '✖'} ${name}`); if (!cond) fail++; };
const ref = (key, data) => createHmac('sha256', key).update(data).digest('hex');
const hdr = (o) => new Headers(o);

// ---- shared HMAC
ok(await hmacHex('kunci', 'pesan ü 🦅') === ref('kunci', 'pesan ü 🦅'), 'HMAC-SHA256 UTF-8 sama dengan Node');
ok(safeEqual('abc', 'abc') && !safeEqual('abc', 'abd') && !safeEqual('abc', 'abcd'), 'safeEqual');

// ---- Tripay adapter
const privateKey = 'abcde-fghij-klmno-pqrst-uvwxy';
const merchant = 'T12345', merchantRef = 'GHG-261024-AB12-1', amount = 870000;
ok(await tripaySignature(privateKey, merchant, merchantRef, amount) === ref(privateKey, merchant + merchantRef + amount), 'Tripay: signature transaksi = HMAC(merchant_code + merchant_ref + amount)');
const body = JSON.stringify({ reference: 'DEV-T12345000001', merchant_ref: merchantRef, payment_method: 'QRIS', total_amount: 870750, fee_customer: 750,
  amount_received: 870000, is_closed_payment: 1, status: 'PAID', paid_at: 1761300000, note: null });
const good = ref(privateKey, body);
const cfg = { creds: { private_key: privateKey } };
ok(await tripay.verifyCallback(cfg, body, hdr({ 'x-callback-signature': good })), 'Tripay callback: signature benar diterima');
ok(await tripayCallbackValid(privateKey, body, good.toUpperCase()), 'Tripay callback: hex huruf besar diterima');
ok(!(await tripay.verifyCallback(cfg, body, hdr({ 'x-callback-signature': ref('kunci-lain', body) }))), 'Tripay callback: private key lain ditolak');
ok(!(await tripay.verifyCallback(cfg, body.replace('PAID', 'UNPAID'), hdr({ 'x-callback-signature': good }))), 'Tripay callback: body diubah ditolak');
ok(!(await tripay.verifyCallback(cfg, body, hdr({}))), 'Tripay callback: tanpa signature ditolak');
ok(!(await tripayCallbackValid('', body, good)), 'Tripay callback: private key kosong ditolak');
const pc = tripay.parseCallback(body, hdr({ 'x-callback-event': 'payment_status' }));
ok(pc.ok && pc.status === 'PAID' && pc.ref === merchantRef && pc.amount === 870750, 'Tripay callback: isi dibaca (PAID, merchant_ref, total)');
ok(!tripay.parseCallback(body, hdr({ 'x-callback-event': 'lain' })).ok, 'Tripay callback: event lain ditolak');

// ---- LinkQu stub: never accepts anything until implemented against the official docs
ok(linkqu.implemented === false, 'LinkQu: ditandai belum diimplementasikan');
ok(!(await linkqu.verifyCallback({ creds: {} }, body, hdr({ 'x-signature': good }))), 'LinkQu: callback selalu ditolak (stub)');
let threw = false; try { await linkqu.create({}, {}); } catch { threw = true; }
ok(threw, 'LinkQu: create() menolak (stub)');
const s = { gateway_provider: 'linkqu', gateway_enabled: '1' };
for (const f of linkqu.fields) s[gwKey('linkqu', f)] = 'x-terisi';
ok(!gatewayReady(s), 'LinkQu: opsi tetap tersembunyi walau kredensial terisi');
const t = { gateway_provider: 'tripay', gateway_enabled: '1' };
for (const f of tripay.fields) t[gwKey('tripay', f)] = 'x';
ok(gatewayReady(t) && !gatewayReady({ ...t, gateway_enabled: '0' }) && !gatewayReady({ ...t, [gwKey('tripay', tripay.fields[1])]: '' }), 'Opsi tampil hanya bila aktif + semua kredensial terisi');
ok(Object.keys(PROVIDERS).sort().join() === 'linkqu,tripay', 'Daftar penyedia');

console.log(fail ? `\n${fail} tes gagal` : '\nSemua tes lulus');
process.exit(fail ? 1 : 0);
