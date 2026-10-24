// LinkQu adapter: STUB, NOT ACTIVE.
//
// The only public LinkQu documentation found (2026-10-24) is the signature guide
// https://www.linkqu.id/en/support/panduan-signatur-untuk-api-linkqu/ :
//   signature = hash_hmac('sha256', path . METHOD . <lowercase alphanumeric concatenation of the request fields>, server_key)
//   paths: /transaction/create/va (VA other bank), /transaction/create/vapermata, /transaction/create/qris, ...
//   field order given for VA Permata: amount, expired, bank_code, partner_reff, customer_id, customer_name, customer_email, client-id
// NOT documented publicly: the QRIS / VA-other-bank field order, request headers (client-id / client-secret), base URLs
// (sandbox / production), the response format, the callback payload and how a callback is authenticated, the status query.
// Guessing any of these would risk accepting forged "paid" callbacks, so nothing is implemented. Once LinkQu sends the API
// document (after merchant registration, or from support: https://linkqu-desk.freshdesk.com/support/tickets/new):
//   TODO(linkqu) channels(): fixed list (QRIS + the banks LinkQu supports), or their channel endpoint if any
//   TODO(linkqu) create(): POST /transaction/create/qris and /transaction/create/va with the documented signature; map the reply
//                to { reference, payment_name, pay_code (VA number), qr_string (QRIS payload), amount, fee_customer, expired_time }
//   TODO(linkqu) status(): documented inquiry endpoint -> PAID | PENDING | EXPIRED | FAILED
//   TODO(linkqu) verifyCallback(): exactly the documented check (signature header / fields, IP allow-list ...)
//   TODO(linkqu) parseCallback() / reply(): documented payload + the response LinkQu expects
//   then set implemented: true and add a unit test to scripts/test-gateway-signature.mjs.
const todo = () => { throw new Error('LinkQu belum diimplementasikan: menunggu dokumentasi API resmi LinkQu'); };

export default {
  id: 'linkqu',
  name: 'LinkQu',
  implemented: false,                 // hidden from members until the adapter is written against the official docs
  docs: 'https://www.linkqu.id/en/support/panduan-signatur-untuk-api-linkqu/',
  note: 'Belum aktif: menunggu dokumentasi API resmi LinkQu (QRIS / VA, callback). Kredensial boleh disimpan dulu.',
  // credential names from the public signature guide (client-id, server key); confirm against the official API document
  fields: [
    { key: 'client_id', label: 'Client ID', secret: false, re: /^[A-Za-z0-9._-]{2,80}$/ },
    { key: 'client_secret', label: 'Client secret', secret: true, re: /^[A-Za-z0-9._-]{4,200}$/ },
    { key: 'server_key', label: 'Server key (signature)', secret: true, re: /^[A-Za-z0-9._-]{4,200}$/ },
  ],
  fallbackChannels: [],
  channels: async () => todo(),
  create: async () => todo(),
  status: async () => todo(),
  verifyCallback: async () => false,  // never trust a callback the adapter cannot verify
  parseCallback: () => ({ ok: false, error: 'LinkQu belum diimplementasikan' }),
  reply: (ok, message) => [ok ? 200 : 400, { success: ok, message: message || '' }],
};
