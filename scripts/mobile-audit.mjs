// Usage: node scripts/mobile-audit.mjs <adminSessionToken> <memberSessionToken> 320,360,390,768 "none|http://127.0.0.1:8790/" "member|http://127.0.0.1:8790/member#/" ...
// Mobile overflow audit: open every page at phone widths and list elements that stick out of the screen.
// Elements inside horizontally scrollable boxes (tables) are allowed.
import { spawn } from 'node:child_process';
const [, , adminTok, memberTok, widthsArg, ...pages] = process.argv;
const widths = widthsArg.split(',').map(Number);
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--remote-debugging-port=9335', '--hide-scrollbars', '--user-data-dir=' + process.env.TEMP + '/ghg-audit-profile', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let t; for (let i = 0; i < 40 && !t; i++) { try { t = (await (await fetch('http://127.0.0.1:9335/json/list')).json()).find((x) => x.type === 'page'); } catch {} await sleep(250); }
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => ws.onopen = r);
let id = 0; const p = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && p.has(d.id)) { p.get(d.id)(d); p.delete(d.id); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; p.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
const DETECT = `(() => {
  const W = document.documentElement.clientWidth, bad = [];
  const scrollBox = (el) => { for (let a = el.parentElement; a; a = a.parentElement) { const s = getComputedStyle(a); if (/(auto|scroll|hidden)/.test(s.overflowX) && a !== document.body && a !== document.documentElement) return a; } return null; };
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || getComputedStyle(el).visibility === 'hidden') continue;
    if (r.right > W + 1 || r.left < -1) {
      const box = scrollBox(el);
      if (box) { const b = box.getBoundingClientRect(); if (b.right <= W + 1 && b.left >= -1) continue; }
      if (el.closest('.side:not(.open)') || el.closest('.menu') || el.closest('.pm-viewport') || el.closest('.strip') || el.closest('#toast')) continue;
      bad.push((el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).join('.') : '') + ' [' + Math.round(r.left) + '..' + Math.round(r.right) + '/' + W + '] ' + (el.innerText || el.value || '').trim().slice(0, 50).replace(/\\s+/g, ' ')));
    }
  }
  // keep only the outermost offenders
  return { scrollW: document.documentElement.scrollWidth, W, bad: bad.slice(0, 12) };
})()`;
let problems = 0;
for (const w of widths) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: 800, deviceScaleFactor: 2, mobile: true });
  for (const spec of pages) {
    const [who, url] = spec.split('|');
    await send('Network.clearBrowserCookies');
    const tok = who === 'admin' ? adminTok : who === 'member' ? memberTok : '';
    if (tok) await send('Network.setCookie', { name: 'ghg_session', value: tok, domain: '127.0.0.1', path: '/', httpOnly: true });
    await send('Page.navigate', { url: 'about:blank' }); await sleep(150);
    await send('Page.navigate', { url }); await sleep(2800);
    await send('Runtime.evaluate', { expression: "document.querySelectorAll('.reveal').forEach(e=>e.classList.add('show'))" });
    await sleep(300);
    const r = (await send('Runtime.evaluate', { expression: DETECT, returnByValue: true })).result.result.value;
    const pageOverflow = r.scrollW > r.W + 1;
    if (pageOverflow || r.bad.length) {
      problems++;
      console.log(`✖ ${w}px ${url.replace(/^https?:\/\/[^/]+/, '')}  page=${r.scrollW}/${r.W}`);
      r.bad.forEach((b) => console.log('     ' + b));
    } else console.log(`✔ ${w}px ${url.replace(/^https?:\/\/[^/]+/, '')}`);
  }
}
console.log(problems ? `\n${problems} halaman bermasalah` : '\nSemua halaman aman');
ws.close(); chrome.kill(); process.exit(0);
