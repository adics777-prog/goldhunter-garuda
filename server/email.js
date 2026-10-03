// Email sending: Resend or Brevo HTTP API, or "log" (only stored in the emails table, for testing).
// Provider, sender and API key are set in Admin > Pengaturan > Email (stored in D1, key encrypted);
// environment variables are the fallback.
import { now, esc, decrypt } from './util.js';

async function emailConfig(env) {
  const { results } = await env.DB.prepare(
    `SELECT key, value FROM settings WHERE key IN ('email_provider','email_from','email_from_name','email_api_key_enc')`).all();
  const s = Object.fromEntries(results.map((r) => [r.key, r.value]));
  const provider = (s.email_provider || env.EMAIL_PROVIDER || 'log').toLowerCase();
  const envKey = provider === 'brevo' ? env.BREVO_API_KEY : provider === 'resend' ? env.RESEND_API_KEY : '';
  return {
    provider,
    from: s.email_from || env.EMAIL_FROM || '',
    fromName: s.email_from_name || env.EMAIL_FROM_NAME || env.SITE_NAME || 'GoldHunter Garuda',
    apiKey: s.email_api_key_enc ? await decrypt(env, s.email_api_key_enc) : (envKey || ''),
  };
}

const siteBase = (env) => (env.SITE_URL || 'https://goldhuntergaruda.com').replace(/\/$/, '');

// Same look as the website: black + gold, Garuda logo.
export function layout(env, title, bodyHtml, cta) {
  const base = siteBase(env);
  const button = cta
    ? `<p style="margin:28px 0 8px"><a href="${esc(cta.url)}" style="background:#f5c542;background-image:linear-gradient(135deg,#fff1b8,#f5c542 35%,#d4a017 70%);color:#1a1200;padding:13px 30px;border-radius:30px;font-weight:bold;text-decoration:none;display:inline-block">${esc(cta.text)}</a></p>`
    : '';
  return `<!doctype html><html><head><meta name="color-scheme" content="dark light"></head>
<body style="margin:0;background:#07070a;font-family:Poppins,Arial,Helvetica,sans-serif;color:#ececf1">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#07070a"><tr><td align="center" style="padding:28px 12px">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:580px">
<tr><td align="center" style="padding:0 0 20px">
  <a href="${base}" style="text-decoration:none"><img src="${base}/assets/brand/goldhunter-garuda-logo-128.png" width="64" height="64" alt="" style="display:block;margin:0 auto 8px">
  <span style="font-family:Cinzel,Georgia,serif;font-weight:900;font-size:22px;letter-spacing:2px;color:#f5c542">GOLDHUNTER GARUDA</span></a></td></tr>
<tr><td style="background:#14141c;border:1px solid #2a2a36;border-top:3px solid #f5c542;border-radius:14px;padding:30px 28px;font-size:15px;line-height:1.65;color:#ececf1">
<h2 style="margin:0 0 16px;font-size:20px;color:#f5c542;font-family:Cinzel,Georgia,serif">${esc(title)}</h2>
${bodyHtml}
${button}
</td></tr>
<tr><td align="center" style="padding:18px 10px;color:#7d7d8c;font-size:12px;line-height:1.6">
  Email otomatis dari <a href="${base}" style="color:#d4a017">${esc(base.replace(/^https?:\/\//, ''))}</a>. Mohon tidak membalas email ini.<br>
  Trading forex &amp; emas berisiko tinggi.</td></tr>
</table></td></tr></table></body></html>`;
}

// logHtml: what is stored in the emails table (e.g. with the password removed). Defaults to html.
export async function sendEmail(env, to, subject, html, logHtml) {
  const cfg = await emailConfig(env);
  let status = 'logged', error = '';
  try {
    if (cfg.provider === 'brevo' || cfg.provider === 'resend') {
      if (!cfg.apiKey) throw new Error('API key email belum diisi (Admin > Pengaturan > Email)');
      if (!cfg.from) throw new Error('Alamat pengirim belum diisi (Admin > Pengaturan > Email)');
    }
    if (cfg.provider === 'brevo') {
      const r = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': cfg.apiKey, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ sender: { email: cfg.from, name: cfg.fromName }, to: [{ email: to }], subject, htmlContent: html }),
      });
      if (!r.ok) throw new Error(`Brevo ${r.status}: ${(await r.text()).slice(0, 300)}`);
      status = 'sent';
    } else if (cfg.provider === 'resend') {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${cfg.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: `${cfg.fromName} <${cfg.from}>`, to: [to], subject, html }),
      });
      if (!r.ok) throw new Error(`Resend ${r.status}: ${(await r.text()).slice(0, 300)}`);
      status = 'sent';
    }
  } catch (e) {
    status = 'failed';
    error = String(e.message || e);
  }
  await env.DB.prepare('INSERT INTO emails (to_addr, subject, body_html, status, error, created_at) VALUES (?,?,?,?,?,?)')
    .bind(to, subject, logHtml || html, status, error, now()).run();
  return { ok: status !== 'failed', status, error };
}
