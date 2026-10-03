// Shared helpers for the Pages Functions API (Web Crypto only, no npm deps).

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const fail = (status, message) => { throw new HttpError(status, message); };

export const now = () => Math.floor(Date.now() / 1000);
export const DAY = 86400;

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

export async function readJson(request) {
  const ct = request.headers.get('content-type') || '';
  // Requiring JSON blocks cross-site form posts (CSRF) together with SameSite cookies.
  if (!ct.includes('application/json')) fail(415, 'Content-Type harus application/json');
  try { return await request.json(); } catch { fail(400, 'JSON tidak valid'); }
}

export const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
export const int = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };
export const isEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

// ---------- encoding ----------
const enc = new TextEncoder();
const dec = new TextDecoder();
export function b64(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function unb64(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export const b64url = (buf) => b64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function randomToken(bytes = 32) {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}
export async function sha256(text) {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

// ---------- passwords (PBKDF2; Workers caps iterations at 100k) ----------
export async function hashPassword(password, saltB64) {
  const salt = saltB64 ? unb64(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256);
  return { hash: b64(bits), salt: b64(salt) };
}
export async function verifyPassword(password, hash, salt) {
  const h = await hashPassword(password, salt);
  if (h.hash.length !== hash.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= h.hash.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}

// ---------- field encryption (trading / VPS passwords) ----------
async function dataKey(env) {
  if (!env.DATA_KEY) fail(500, 'DATA_KEY belum diatur di server');
  return crypto.subtle.importKey('raw', unb64(env.DATA_KEY), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function encrypt(env, text) {
  if (text == null || text === '') return null;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await dataKey(env), enc.encode(String(text)));
  return `v1:${b64(iv)}:${b64(ct)}`;
}
export async function decrypt(env, value) {
  if (!value) return '';
  try {
    const [, iv, ct] = value.split(':');
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await dataKey(env), unb64(ct));
    return dec.decode(pt);
  } catch { return '(gagal didekripsi)'; }
}

// ---------- sessions ----------
export const SESSION_COOKIE = 'ghg_session';
// Browsers cap cookie lifetime at ~400 days; the session is renewed on every visit, so it never runs out in practice.
const SESSION_DAYS = 400;

export function getCookie(request, name) {
  const c = request.headers.get('cookie') || '';
  for (const part of c.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}
function cookieHeader(request, value, maxAge) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}
export async function createSession(env, request, userId) {
  const token = randomToken(32);
  const t = now();
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?,?,?,?)')
    .bind(await sha256(token), userId, t + SESSION_DAYS * DAY, t).run();
  await env.DB.prepare('UPDATE users SET last_login_at=? WHERE id=?').bind(t, userId).run();
  return cookieHeader(request, token, SESSION_DAYS * DAY);
}
export async function destroySession(env, request) {
  const token = getCookie(request, SESSION_COOKIE);
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await sha256(token)).run();
  return cookieHeader(request, '', 0);
}
// Returns { user, cookie }: cookie is a refreshed Set-Cookie header (sliding expiry) or null.
export async function sessionUser(env, request) {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return { user: null, cookie: null };
  const th = await sha256(token);
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.phone, u.address, u.role, u.status, u.created_at, s.expires_at AS sess_exp
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash=? AND s.expires_at > ?`
  ).bind(th, now()).first();
  if (!row || row.status !== 'active') return { user: null, cookie: null };
  let cookie = null;
  if (row.sess_exp - now() < (SESSION_DAYS - 1) * DAY) {   // renew at most once a day
    await env.DB.prepare('UPDATE sessions SET expires_at=? WHERE token_hash=?').bind(now() + SESSION_DAYS * DAY, th).run();
    cookie = cookieHeader(request, token, SESSION_DAYS * DAY);
  }
  delete row.sess_exp;
  return { user: row, cookie };
}

export function isAdminEmail(env, email) {
  return String(env.ADMIN_EMAILS || '').toLowerCase().split(/[,\s]+/).filter(Boolean).includes(email.toLowerCase());
}

// ---------- misc ----------
export function rupiah(n) {
  return 'Rp ' + Math.round(n || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
export function addMonths(unixSec, months) {
  const d = new Date(unixSec * 1000);
  d.setUTCMonth(d.getUTCMonth() + months);
  return Math.floor(d.getTime() / 1000);
}
export function fmtDate(unixSec) {
  if (!unixSec) return 'Selamanya';
  const d = new Date((unixSec + 7 * 3600) * 1000); // WIB
  const m = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  return `${d.getUTCDate()} ${m[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function siteUrl(env, request) {
  return (env.SITE_URL && !env.SITE_URL.includes('localhost')) ? env.SITE_URL.replace(/\/$/, '') : new URL(request.url).origin;
}
