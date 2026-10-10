// GOLD HUNTER GARUDA: one picture with the trading result of every setup (Telegram report).
// Closed profit only (today, since start, % of capital) - floating is deliberately left out.
// SVG -> PNG with the vendored resvg WebAssembly build and Plus Jakarta Sans.
import { initWasm, Resvg } from './vendor/resvg/index.mjs';
import wasm from './vendor/resvg/index_bg.wasm';
import regular from './vendor/resvg/jakarta-400.bin';
import bold from './vendor/resvg/jakarta-700.bin';

let ready = null;
async function toPng(svg) {
  ready ??= initWasm(wasm).catch((e) => { ready = null; throw e; });
  await ready;
  const r = new Resvg(svg, { fitTo: { mode: 'original' }, font: { fontBuffers: [new Uint8Array(regular), new Uint8Array(bold)], defaultFontFamily: 'Plus Jakarta Sans', loadSystemFonts: false } });
  const img = r.render();
  const png = img.asPng();
  img.free();
  r.free();
  return png;
}

const X = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (v) => {
  if (v == null || !Number.isFinite(Number(v))) return '-';
  const n = Number(v);
  return (n > 0 ? '+' : n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const pct = (v) => (v == null || !Number.isFinite(Number(v)) ? '' : (v > 0 ? '+' : '') + Number(v).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%');
const col = (v) => (v > 0 ? '#5ee39a' : v < 0 ? '#ff7d89' : '#a3a3b2');
const RISK = { LOW: ['Low', '#2ecc71'], MEDIUM: ['Medium', '#f5c542'], HIGH: ['High', '#ef4d5a'] };
const ICON = { XAUUSD: 'Emas', BTCUSD: 'Bitcoin', EURUSD: 'Euro', USDJPY: 'Yen' };
const running = (sec) => { const d = Math.floor(sec / 86400); return d >= 1 ? `${d} hari` : sec >= 3600 ? `${Math.floor(sec / 3600)} jam` : 'baru mulai'; };

/**
 * rows: [{ symbol, risk, label, online, day_usd, day_pct, total_usd, total_pct, running, series, wins }]
 * head: { date, clock, total_day_usd, total_usd, online, count }
 */
export async function reportPng(rows, head) {
  const W = 1080, PAD = 48, TOP = 300, RH = 74, FOOT = 120;
  const H = TOP + Math.max(1, rows.length) * RH + 30 + FOOT;
  // columns (x = right edge for numbers)
  const C = { setup: PAD + 24, day: 530, total: 720, pctx: 880, run: W - PAD - 24 };
  const bg = `<defs><radialGradient id="glow" cx="0.85" cy="0" r="0.9"><stop offset="0" stop-color="#f5c542" stop-opacity="0.18"/><stop offset="1" stop-color="#f5c542" stop-opacity="0"/></radialGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff1b8"/><stop offset="0.45" stop-color="#f5c542"/><stop offset="1" stop-color="#b8860b"/></linearGradient></defs>
    <rect width="${W}" height="${H}" fill="#07070a"/><rect width="${W}" height="${H}" fill="url(#glow)"/>`;
  const title = `
    <text x="${PAD}" y="${PAD + 40}" font-size="40" font-weight="700" fill="url(#gold)" letter-spacing="1.5">GOLD HUNTER GARUDA</text>
    <text x="${PAD}" y="${PAD + 78}" font-size="22" fill="#a3a3b2">Laporan hasil trading · ${X(head.date)} · ${X(head.clock)}</text>
    <text x="${W - PAD}" y="${PAD + 40}" font-size="20" font-weight="700" fill="#5ee39a" text-anchor="end">● ${head.online}/${head.count} akun online</text>`;
  const tile = (x, w, k, v, sub, c) => `<rect x="${x}" y="${PAD + 104}" width="${w}" height="104" rx="18" fill="#14141c" stroke="#2a2a36"/>
    <text x="${x + 24}" y="${PAD + 140}" font-size="18" fill="#a3a3b2">${X(k)}</text>
    <text x="${x + 24}" y="${PAD + 184}" font-size="36" font-weight="700" fill="${c}">${X(v)}</text>
    ${sub ? `<text x="${x + w - 24}" y="${PAD + 184}" font-size="20" fill="#a3a3b2" text-anchor="end">${X(sub)}</text>` : ''}`;
  const half = (W - PAD * 2 - 20) / 2;
  const tiles = tile(PAD, half, 'Profit hari ini · semua akun', money(head.total_day_usd), '', col(head.total_day_usd))
    + tile(PAD + half + 20, half, 'Profit sejak mulai · semua akun', money(head.total_usd), '', col(head.total_usd));
  const th = `<text x="${C.setup}" y="${TOP - 18}" font-size="16" font-weight="700" fill="#7c7c8c" letter-spacing="1.5">SETUP</text>
    <text x="${C.day}" y="${TOP - 18}" font-size="16" font-weight="700" fill="#7c7c8c" text-anchor="end" letter-spacing="1.5">HARI INI</text>
    <text x="${C.total}" y="${TOP - 18}" font-size="16" font-weight="700" fill="#7c7c8c" text-anchor="end" letter-spacing="1.5">SEJAK MULAI</text>
    <text x="${C.pctx}" y="${TOP - 18}" font-size="16" font-weight="700" fill="#7c7c8c" text-anchor="end" letter-spacing="1.5">% MODAL</text>
    <text x="${C.run}" y="${TOP - 18}" font-size="16" font-weight="700" fill="#7c7c8c" text-anchor="end" letter-spacing="1.5">LAMA</text>`;
  const body = rows.length ? rows.map((r, i) => {
    const y = TOP + i * RH;
    const [rn, rc] = RISK[r.risk] || ['Master', '#4da3ff'];
    const pillW = rn.length * 11 + 26;
    const nameX = C.setup + 132;
    return `<rect x="${PAD}" y="${y}" width="${W - PAD * 2}" height="${RH - 8}" rx="14" fill="${i % 2 ? '#101016' : '#14141c'}"/>
      <circle cx="${PAD + 12}" cy="${y + (RH - 8) / 2}" r="5" fill="${r.online ? '#5ee39a' : '#ff7d89'}"/>
      <text x="${C.setup}" y="${y + 30}" font-size="24" font-weight="700" fill="#ececf1">${X(r.symbol)}</text>
      <text x="${C.setup}" y="${y + 54}" font-size="15" fill="#7c7c8c">${X(ICON[r.symbol] || '')}${r.series ? ` · ${r.series} seri hari ini` : ''}</text>
      <rect x="${nameX}" y="${y + 12}" width="${pillW}" height="28" rx="14" fill="${rc}" fill-opacity="0.14" stroke="${rc}" stroke-opacity="0.6"/>
      <text x="${nameX + pillW / 2}" y="${y + 32}" font-size="15" font-weight="700" fill="${rc}" text-anchor="middle">${X(rn)}</text>
      <text x="${C.day}" y="${y + 32}" font-size="24" font-weight="700" fill="${col(r.day_usd)}" text-anchor="end">${X(money(r.day_usd))}</text>
      <text x="${C.day}" y="${y + 54}" font-size="15" fill="#7c7c8c" text-anchor="end">${X(pct(r.day_pct))}</text>
      <text x="${C.total}" y="${y + 40}" font-size="24" font-weight="700" fill="${col(r.total_usd)}" text-anchor="end">${X(r.total_usd == null ? 'menghitung' : money(r.total_usd))}</text>
      <text x="${C.pctx}" y="${y + 40}" font-size="24" font-weight="700" fill="${col(r.total_pct)}" text-anchor="end">${X(pct(r.total_pct) || '-')}</text>
      <text x="${C.run}" y="${y + 40}" font-size="18" fill="#a3a3b2" text-anchor="end">${X(running(r.running))}</text>`;
  }).join('') : `<text x="${W / 2}" y="${TOP + 40}" font-size="22" fill="#a3a3b2" text-anchor="middle">Belum ada akun yang melapor.</text>`;
  const fy = TOP + Math.max(1, rows.length) * RH + 40;
  const foot = `<line x1="${PAD}" y1="${fy}" x2="${W - PAD}" y2="${fy}" stroke="#2a2a36"/>
    <text x="${PAD}" y="${fy + 38}" font-size="17" fill="#7c7c8c">Profit tertutup saja (floating tidak dihitung) · modal = saldo awal + deposit − penarikan · 100 USC = $1</text>
    <text x="${PAD}" y="${fy + 70}" font-size="17" fill="#7c7c8c">Hasil masa lalu bukan jaminan. Trading berisiko tinggi.</text>
    <text x="${W - PAD}" y="${fy + 70}" font-size="20" font-weight="700" fill="#f5c542" text-anchor="end">goldhuntergaruda.com/live</text>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Plus Jakarta Sans">${bg}${title}${tiles}${th}${body}${foot}</svg>`;
  return toPng(svg);
}
