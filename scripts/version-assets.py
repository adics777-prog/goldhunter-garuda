"""Add ?v=<content hash> to /assets/*.js and /assets/app.css in every page, so browsers
load a new file right after each deploy (Cloudflare keeps old ones in browser cache for hours).
Run before every commit:  python scripts/version-assets.py"""
import hashlib, pathlib, re

pub = pathlib.Path(__file__).resolve().parent.parent / 'public'
def ver(name):
    return hashlib.sha1((pub / 'assets' / name).read_bytes()).hexdigest()[:8]

for page in pub.glob('*.html'):
    s = page.read_text(encoding='utf-8')
    n = re.sub(r'(["\'])/assets/([\w.-]+\.(?:js|css))(\?v=\w+)?\1', lambda m: f'{m.group(1)}/assets/{m.group(2)}?v={ver(m.group(2))}{m.group(1)}', s)
    if n != s:
        page.write_text(n, encoding='utf-8')
        print('versioned', page.name)
