// Usage: node scripts/page-shots.mjs <outDir> <width,width> <url> [url...]
// Full-page screenshots (every reveal shown), cut into 1600 px tall pieces so each piece is easy to review.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
const [, , outDir, widthsArg, ...urls] = process.argv;
mkdirSync(outDir, { recursive: true });
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--remote-debugging-port=9337', '--hide-scrollbars', '--user-data-dir=' + process.env.TEMP + '/ghg-shots-profile', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let t; for (let i = 0; i < 40 && !t; i++) { try { t = (await (await fetch('http://127.0.0.1:9337/json/list')).json()).find((x) => x.type === 'page'); } catch {} await sleep(250); }
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => ws.onopen = r);
let id = 0; const p = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && p.has(d.id)) { p.get(d.id)(d); p.delete(d.id); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; p.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Page.enable'); await send('Runtime.enable');
const PIECE = 1600;
for (const w of widthsArg.split(',').map(Number)) {
  const mobile = w < 700;
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: mobile ? 820 : 900, deviceScaleFactor: 1, mobile });
  for (const url of urls) {
    const tag = url.replace(/^https?:\/\/[^/]+\/?/, '').replace(/[^\w]+/g, '_') || 'home';
    await send('Page.navigate', { url }); await sleep(4500);
    await send('Runtime.evaluate', { expression: "document.querySelectorAll('.reveal').forEach(e=>e.classList.add('show')); window.scrollTo(0, document.body.scrollHeight); 0" });
    await sleep(900);
    await send('Runtime.evaluate', { expression: 'window.scrollTo(0,0)' }); await sleep(300);
    const H = (await send('Runtime.evaluate', { expression: 'Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)', returnByValue: true })).result.result.value;
    for (let y = 0, k = 0; y < H; y += PIECE, k++) {
      const h = Math.min(PIECE, H - y);
      const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 70, captureBeyondViewport: true, clip: { x: 0, y, width: w, height: h, scale: 1 } });
      if (shot.result) writeFileSync(`${outDir}/${tag}_${w}_${k}.jpg`, Buffer.from(shot.result.data, 'base64'));
    }
    console.log(`${tag} ${w}px ${H}px -> ${Math.ceil(H / PIECE)} piece(s)`);
  }
}
ws.close(); chrome.kill(); process.exit(0);
