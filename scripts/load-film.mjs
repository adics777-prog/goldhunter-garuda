// Usage: node scripts/load-film.mjs <outDir> <width> <url> [url...]
// Film of the first seconds of a page on a slow phone connection (no cache): screenshots at fixed moments, so blank
// screens, empty boxes or layout jumps while loading are visible. Also lists failed requests and console errors.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
const [, , outDir, widthArg, ...urls] = process.argv;
mkdirSync(outDir, { recursive: true });
const W = Number(widthArg) || 375;
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--remote-debugging-port=9336', '--hide-scrollbars', '--user-data-dir=' + process.env.TEMP + '/ghg-film-profile', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let t; for (let i = 0; i < 40 && !t; i++) { try { t = (await (await fetch('http://127.0.0.1:9336/json/list')).json()).find((x) => x.type === 'page'); } catch {} await sleep(250); }
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => ws.onopen = r);
let id = 0; const p = new Map(); const events = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && p.has(d.id)) { p.get(d.id)(d); p.delete(d.id); } else if (d.method) events.push(d); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; p.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable'); await send('Log.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
// slow 4G-ish phone: 150 ms latency, ~1.6 Mbit/s down
await send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 200 * 1024, uploadThroughput: 90 * 1024 });
await send('Emulation.setDeviceMetricsOverride', { width: W, height: W < 600 ? 780 : 900, deviceScaleFactor: 1, mobile: W < 600 });
const MOMENTS = [400, 900, 1500, 2500, 4000, 7000];
for (const url of urls) {
  const tag = url.replace(/^https?:\/\/[^/]+\/?/, '').replace(/[^\w]+/g, '_') || 'home';
  await send('Page.navigate', { url: 'about:blank' }); await sleep(200);
  events.length = 0;
  const t0 = Date.now();
  send('Page.navigate', { url });
  for (const ms of MOMENTS) {
    const wait = t0 + ms - Date.now(); if (wait > 0) await sleep(wait);
    const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 55 });
    if (shot.result) writeFileSync(`${outDir}/${tag}_${W}_${String(ms).padStart(4, '0')}.jpg`, Buffer.from(shot.result.data, 'base64'));
  }
  const fails = events.filter((e) => e.method === 'Network.loadingFailed').map((e) => e.params.errorText);
  const bad = events.filter((e) => e.method === 'Network.responseReceived' && e.params.response.status >= 400).map((e) => e.params.response.status + ' ' + e.params.response.url);
  const errs = events.filter((e) => (e.method === 'Runtime.exceptionThrown') || (e.method === 'Log.entryAdded' && e.params.entry.level === 'error')).map((e) => e.method === 'Runtime.exceptionThrown' ? e.params.exceptionDetails.exception?.description?.split('\n')[0] || e.params.exceptionDetails.text : e.params.entry.text);
  console.log(`${tag} ${W}px  failed:${fails.length} http>=400:${bad.length} errors:${errs.length}`);
  [...bad, ...errs].slice(0, 8).forEach((x) => console.log('   ' + String(x).slice(0, 160)));
}
ws.close(); chrome.kill(); process.exit(0);
