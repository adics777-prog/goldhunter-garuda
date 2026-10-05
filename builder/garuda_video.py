"""
Garuda AI promo video: vertical 1080x1920 (TikTok / Reels / Shorts) built from real signal data.

render_video(job, out_path) -> seconds
  job = {
    'kind': 'signal' | 'weekly',
    'lang': 'id' | 'en',
    'voice': 'id-ID-ArdiNeural',
    'script': {'scenes': [{'id': 'hook' | 'signal' | 'result' | 'stats' | 'cta', 'say': '...', 'title': '...'}], 'hook': '...'},
    'signal': {...} (kind signal: symbol, name, decision, entry, sl, tp, close, pips, pip_label, digits, result, created_at, closed_at, confidence),
    'chart_open': bytes | None, 'chart_close': bytes | None,
    'stats': {'wr30': 75, 'tp30': 6, 'sl30': 2, 'markets': [{'symbol': 'XAUUSD', 'pips30': 505, 'pip_label': 'pips', 'wins30': 4, 'losses30': 1}]},
  }
Frames are drawn with Pillow and piped to ffmpeg (bundled by imageio-ffmpeg); narration from Microsoft Edge TTS.
"""
import asyncio, io, os, subprocess, tempfile, time

from PIL import Image, ImageDraw, ImageFont

W, H, FPS = 1080, 1920, 30
BG = (11, 14, 20)
CARD = (19, 24, 33)
LINE = (40, 48, 62)
TEXT = (236, 238, 242)
MUTED = (146, 154, 170)
GOLD = (245, 197, 66)
UP = (38, 194, 129)
DN = (239, 83, 80)
HERE = os.path.dirname(os.path.abspath(__file__))
LOGO = os.path.join(HERE, '..', 'public', 'assets', 'brand', 'goldhunter-garuda-logo-256.png')
FONT_DIR = os.path.join(os.environ.get('WINDIR', r'C:\Windows'), 'Fonts')
FONT_FILES = {'black': 'seguibl.ttf', 'bold': 'segoeuib.ttf', 'semi': 'seguisb.ttf', 'reg': 'segoeui.ttf'}
_fonts = {}


def F(kind, size):
    k = (kind, size)
    if k not in _fonts:
        try:
            _fonts[k] = ImageFont.truetype(os.path.join(FONT_DIR, FONT_FILES[kind]), size)
        except OSError:
            _fonts[k] = ImageFont.load_default()
    return _fonts[k]


def T(lang, id_, en):
    return en if lang == 'en' else id_


def wrap(draw, text, font, width):
    words, lines, cur = str(text).split(), [], ''
    for w in words:
        nxt = (cur + ' ' + w).strip()
        if draw.textlength(nxt, font=font) <= width or not cur:
            cur = nxt
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def text_block(draw, text, font, x, y, width, fill, align='center', spacing=1.18, max_lines=6):
    lines = wrap(draw, text, font, width)[:max_lines]
    lh = font.size * spacing
    for i, ln in enumerate(lines):
        tw = draw.textlength(ln, font=font)
        tx = x + (width - tw) / 2 if align == 'center' else x
        draw.text((tx + 3, y + i * lh + 3), ln, font=font, fill=(0, 0, 0))
        draw.text((tx, y + i * lh), ln, font=font, fill=fill)
    return y + len(lines) * lh


def ease(t):
    t = max(0.0, min(1.0, t))
    return 1 - (1 - t) ** 3


def fmt(v, d):
    return f'{float(v):,.{d}f}'


def pips_txt(p, label, lang):
    lab = T(lang, label, 'points') if label == 'poin' else label
    return f"{'+' if p > 0 else ''}{p:,.1f} {lab}" if label == 'pips' else f"{'+' if p > 0 else ''}{round(p):,} {lab}"


# ---------------------------------------------------------------- static background with header / footer
def background(lang):
    im = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(im)
    for y in range(0, 700):                             # warm glow at the top
        a = (1 - y / 700) ** 2 * 0.22
        d.line([(0, y), (W, y)], fill=tuple(int(BG[i] * (1 - a) + GOLD[i] * a * 0.35) for i in range(3)))
    try:
        logo = Image.open(LOGO).convert('RGBA').resize((104, 104), Image.LANCZOS)
        im.paste(logo, (64, 70), logo)
    except OSError:
        pass
    d.text((186, 78), 'GARUDA AI', font=F('black', 58), fill=GOLD)
    d.text((190, 148), T(lang, 'Sinyal trading berbasis AI', 'AI-powered trading signals'), font=F('semi', 30), fill=MUTED)
    d.rectangle([64, 214, W - 64, 217], fill=GOLD)
    d.text((W / 2, H - 70), 'goldhuntergaruda.com', font=F('bold', 34), fill=GOLD, anchor='mm')
    return im


def subtitle(im, text):
    if not text:
        return
    d = ImageDraw.Draw(im, 'RGBA')
    f = F('bold', 46)
    lines = wrap(d, text, f, W - 200)[:3]
    lh = 58
    h = len(lines) * lh + 36
    y0 = 1585 - h / 2
    d.rounded_rectangle([70, y0, W - 70, y0 + h], radius=26, fill=(0, 0, 0, 170))
    for i, ln in enumerate(lines):
        d.text((W / 2, y0 + 18 + i * lh + lh / 2), ln, font=f, fill=(255, 255, 255), anchor='mm')


def paste_chart(im, png, y, t, dur, width=980):
    if not png:
        return y
    if not hasattr(paste_chart, 'cache'):
        paste_chart.cache = {}
    key = id(png)
    if key not in paste_chart.cache:
        paste_chart.cache[key] = Image.open(io.BytesIO(png)).convert('RGB')
    src = paste_chart.cache[key]
    if src.size == (1600, 900):                         # Garuda picture: keep the chart area, the side panel is too small on a phone
        src = src.crop((0, 92, 1112, 842))
    z = 1.0 + 0.07 * (t / max(dur, 0.1))                 # slow zoom in
    cw, ch = src.size
    vw, vh = cw / z, ch / z
    box = (int((cw - vw) / 2), int((ch - vh) / 2), int((cw + vw) / 2), int((ch + vh) / 2))
    h = int(width * ch / cw)
    crop = src.crop(box).resize((width, h), Image.BILINEAR)
    x = (W - width) // 2
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([x - 6, y - 6, x + width + 6, y + h + 6], radius=18, fill=LINE)
    im.paste(crop, (x, y))
    return y + h


# ---------------------------------------------------------------- scenes: draw(im, t, dur)
def scene_hook(job):
    lang, s = job['lang'], job.get('signal') or {}
    hook = job['script'].get('hook') or ''

    def draw(im, t, dur):
        d = ImageDraw.Draw(im)
        k = ease(t / 0.5)
        if s:
            side = s['decision']
            col = UP if side == 'BUY' else DN
            chip = f"{'▲' if side == 'BUY' else '▼'} {side} {s['symbol']}"
            f = F('black', 44)
            tw = d.textlength(chip, font=f)
            d.rounded_rectangle([W / 2 - tw / 2 - 34, 430, W / 2 + tw / 2 + 34, 510], radius=40, fill=col)
            d.text((W / 2, 470), chip, font=f, fill=(255, 255, 255), anchor='mm')
        y = 600 + (1 - k) * 60
        text_block(d, hook, F('black', 92), 70, y, W - 140, TEXT if k > 0.2 else MUTED, max_lines=5)
        d.text((W / 2, 1300), T(lang, 'Dianalisis oleh Claude AI', 'Analysed by Claude AI'), font=F('semi', 36), fill=GOLD, anchor='mm')
    return draw


def scene_signal(job):
    lang, s = job['lang'], job['signal']
    col = UP if s['decision'] == 'BUY' else DN
    dg = int(s.get('digits') or 2)

    def draw(im, t, dur):
        d = ImageDraw.Draw(im)
        d.text((W / 2, 300), T(lang, 'SINYAL DARI AI', 'THE AI SIGNAL'), font=F('bold', 38), fill=MUTED, anchor='mm')
        d.text((W / 2, 362), f"{s['decision']} {s['symbol']}", font=F('black', 70), fill=col, anchor='mm')
        yb = paste_chart(im, job.get('chart_open'), 440, t, dur)
        y = (yb if job.get('chart_open') else 440) + 40
        rows = [('Entry', fmt(s['entry'], dg), TEXT), ('Stop loss', fmt(s['sl'], dg), DN), ('Take profit', fmt(s['tp'], dg), UP)]
        d.rounded_rectangle([90, y, W - 90, y + 300], radius=24, fill=CARD)
        for i, (k_, v, c) in enumerate(rows):
            if t < 0.25 + i * 0.25:
                continue
            yy = y + 52 + i * 92
            d.text((130, yy), k_, font=F('semi', 40), fill=MUTED, anchor='lm')
            d.text((W - 130, yy), v, font=F('black', 54), fill=c, anchor='rm')
    return draw


def scene_result(job):
    lang, s = job['lang'], job['signal']
    res = s.get('result') or ('TP' if s['pips'] > 0 else 'SL')
    col = UP if s['pips'] > 0 else (DN if s['pips'] < 0 else GOLD)
    head = {'TP': T(lang, 'TARGET TERCAPAI', 'TARGET HIT'), 'SL': T(lang, 'STOP LOSS', 'STOP LOSS'), 'BE': 'BREAK EVEN'}.get(res, T(lang, 'DITUTUP', 'CLOSED'))
    dg = int(s.get('digits') or 2)
    mins = max(0, int((s.get('closed_at') or 0) - (s.get('created_at') or 0)) // 60)
    dur_txt = (f'{mins // 60}j {mins % 60}m' if mins >= 60 else f'{mins}m') if lang != 'en' else (f'{mins // 60}h {mins % 60}m' if mins >= 60 else f'{mins}m')

    def draw(im, t, dur):
        d = ImageDraw.Draw(im)
        d.text((W / 2, 300), T(lang, 'HASILNYA', 'THE RESULT'), font=F('bold', 38), fill=MUTED, anchor='mm')
        d.text((W / 2, 362), head, font=F('black', 70), fill=col, anchor='mm')
        yb = paste_chart(im, job.get('chart_close') or job.get('chart_open'), 440, t, dur)
        y = (yb if (job.get('chart_close') or job.get('chart_open')) else 440) + 40
        d.rounded_rectangle([90, y, W - 90, y + 300], radius=24, fill=CARD, outline=col, width=4)
        v = s['pips'] * ease(t / 0.9)
        d.text((W / 2, y + 120), pips_txt(v, s.get('pip_label') or 'pips', lang), font=F('black', 104), fill=col, anchor='mm')
        d.text((W / 2, y + 232), f"{fmt(s['entry'], dg)} → {fmt(s['close'], dg)}  ·  {dur_txt}", font=F('semi', 38), fill=MUTED, anchor='mm')
    return draw


def scene_stats(job):
    lang, st = job['lang'], job.get('stats') or {}

    def draw(im, t, dur):
        d = ImageDraw.Draw(im)
        d.text((W / 2, 330), st.get('title') or T(lang, 'TRACK RECORD 30 HARI', '30-DAY TRACK RECORD'), font=F('black', 56), fill=GOLD, anchor='mm')
        wr = st.get('wr30')
        d.text((W / 2, 560), f"{round((wr or 0) * ease(t / 0.9))}%" if wr is not None else '-', font=F('black', 220), fill=TEXT, anchor='mm')
        d.text((W / 2, 720), T(lang, 'win rate', 'win rate') + f"  ·  {st.get('tp30', 0)} TP / {st.get('sl30', 0)} SL", font=F('bold', 44), fill=MUTED, anchor='mm')
        y = 820
        for m in (st.get('markets') or [])[:4]:
            if t < 0.4:
                break
            p = float(m.get('pips30') or 0)
            d.rounded_rectangle([110, y, W - 110, y + 110], radius=22, fill=CARD)
            d.text((150, y + 55), m['symbol'], font=F('black', 46), fill=TEXT, anchor='lm')
            d.text((W - 150, y + 55), pips_txt(p, m.get('pip_label') or 'pips', lang), font=F('black', 46), fill=UP if p > 0 else (DN if p < 0 else TEXT), anchor='rm')
            y += 130
        d.text((W / 2, y + 40), T(lang, 'Semua sinyal tercatat, termasuk yang rugi', 'Every signal is recorded, losses included'), font=F('semi', 36), fill=MUTED, anchor='mm')
    return draw


def scene_cta(job):
    lang = job['lang']

    def draw(im, t, dur):
        d = ImageDraw.Draw(im)
        text_block(d, T(lang, 'Cek semua sinyal dan hasilnya sendiri', 'Check every signal and its result yourself'), F('black', 78), 80, 520, W - 160, TEXT)
        k = ease(t / 0.6)
        pw = 860 * (0.9 + 0.1 * k)
        d.rounded_rectangle([W / 2 - pw / 2, 900, W / 2 + pw / 2, 1030], radius=65, fill=GOLD)
        d.text((W / 2, 965), 'goldhuntergaruda.com', font=F('black', 60), fill=(26, 18, 0), anchor='mm')
        d.text((W / 2, 1105), T(lang, 'Daftar gratis · notifikasi Telegram', 'Free sign-up · Telegram alerts'), font=F('semi', 40), fill=MUTED, anchor='mm')
        d.rounded_rectangle([110, 1200, W - 110, 1380], radius=22, fill=(40, 18, 20))
        text_block(d, T(lang, 'Bukan saran investasi. Trading berisiko tinggi dan bisa rugi; hasil masa lalu tidak menjamin hasil berikutnya.',
                        'Not investment advice. Trading is high risk and can lose money; past results do not guarantee future results.'),
                   F('semi', 32), 140, 1226, W - 280, (255, 170, 170), max_lines=4)
    return draw


SCENES = {'hook': scene_hook, 'signal': scene_signal, 'result': scene_result, 'stats': scene_stats, 'cta': scene_cta}


# ---------------------------------------------------------------- narration
async def _tts(text, voice, path):
    import edge_tts
    c = edge_tts.Communicate(text, voice, rate='+6%', boundary='SentenceBoundary')
    sents = []
    with open(path, 'wb') as f:
        async for ch in c.stream():
            if ch['type'] == 'audio':
                f.write(ch['data'])
            elif ch['type'] == 'SentenceBoundary':
                sents.append((ch['offset'] / 1e7, ch['duration'] / 1e7, ch['text']))
    end = max((a + b for a, b, _ in sents), default=1.0)
    return end, sents


def render_video(job, out_path):
    import imageio_ffmpeg
    ff = imageio_ffmpeg.get_ffmpeg_exe()
    voice = job.get('voice') or ('en-US-AndrewNeural' if job.get('lang') == 'en' else 'id-ID-ArdiNeural')
    scenes = [sc for sc in job['script']['scenes'] if sc.get('id') in SCENES and (sc['id'] not in ('signal', 'result') or job.get('signal'))]
    tmp = tempfile.mkdtemp(prefix='garuda_video_')
    plan = []
    for i, sc in enumerate(scenes):
        mp3 = os.path.join(tmp, f'v{i}.mp3')
        say = (sc.get('say') or '').strip()
        if say:
            end, sents = asyncio.run(_tts(say, voice, mp3))
        else:
            end, sents, mp3 = 0.0, [], None
        dur = max(end + 0.45, float(sc.get('min', 2.4)))
        shown = (sc.get('text') or '').strip()            # subtitle text when it differs from the spoken words (URLs, numbers)
        if shown and sents:
            sents = [(sents[0][0], sents[-1][0] + sents[-1][1] - sents[0][0], shown)]
        plan.append({'draw': SCENES[sc['id']](job), 'dur': dur, 'mp3': mp3, 'sents': sents, 'say': say})
    total = sum(p['dur'] for p in plan)
    bg = background(job.get('lang', 'id'))
    cmd = [ff, '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-']
    filt, labels, n_in = [], [], 1
    for p in plan:
        if p['mp3']:
            cmd += ['-i', p['mp3']]
            filt.append(f"[{n_in}:a]aresample=44100,apad=whole_dur={p['dur']:.3f}[a{n_in}]")
            labels.append(f'[a{n_in}]')
            n_in += 1
        else:
            filt.append(f"anullsrc=r=44100:cl=mono,atrim=duration={p['dur']:.3f}[s{len(labels)}]")
            labels.append(f'[s{len(labels)}]')
    filt.append(''.join(labels) + f'concat=n={len(labels)}:v=0:a=1[aout]')
    cmd += ['-filter_complex', ';'.join(filt), '-map', '0:v', '-map', '[aout]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21',
            '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-shortest', out_path]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    prev = None
    fade = int(FPS * 0.25)
    for p in plan:
        frames = int(round(p['dur'] * FPS))
        for fi in range(frames):
            t = fi / FPS
            im = bg.copy()
            p['draw'](im, t, p['dur'])
            cur = next((txt for a, b, txt in p['sents'] if a <= t < a + b + 0.25), '')
            subtitle(im, cur)
            if job.get('watermark'):                 # test / sample videos are marked on every frame
                wd = ImageDraw.Draw(im, 'RGBA')
                wd.rectangle([0, 236, W, 290], fill=(200, 30, 40, 215))
                wd.text((W / 2, 263), job['watermark'], font=F('black', 32), fill=(255, 255, 255), anchor='mm')
            if prev is not None and fi < fade:
                im = Image.blend(prev, im, (fi + 1) / (fade + 1))
            proc.stdin.write(im.tobytes())
            if fi == frames - 1:
                prev = im
    proc.stdin.close()
    if proc.wait() != 0:
        raise RuntimeError('ffmpeg gagal merender video')
    return total


if __name__ == '__main__':                               # quick local test with sample data
    import sys
    job = {
        'kind': 'signal', 'lang': sys.argv[1] if len(sys.argv) > 1 else 'id',
        'signal': {'symbol': 'XAUUSD', 'decision': 'SELL', 'entry': 4140.31, 'sl': 4152.31, 'tp': 4122.31, 'close': 4122.31, 'pips': 180.0,
                   'pip_label': 'pips', 'digits': 2, 'result': 'TP', 'created_at': time.time() - 8100, 'closed_at': time.time(), 'confidence': 72},
        'stats': {'wr30': 75, 'tp30': 6, 'sl30': 2, 'markets': [{'symbol': 'XAUUSD', 'pips30': 505, 'pip_label': 'pips'}, {'symbol': 'BTCUSD', 'pips30': 1100, 'pip_label': 'poin'}]},
        'script': {'hook': 'AI kami bilang SELL emas. Hasilnya?', 'scenes': [
            {'id': 'hook', 'say': 'AI kami bilang SELL emas. Hasilnya?'},
            {'id': 'signal', 'say': 'Claude membaca chart dan berita, lalu memberi sinyal SELL di 4140 dengan stop loss dan target yang jelas.'},
            {'id': 'result', 'say': 'Dua jam kemudian target tercapai. Plus 180 pips.'},
            {'id': 'stats', 'say': 'Win rate tiga puluh hari tujuh puluh lima persen, dan semua sinyal tercatat, termasuk yang rugi.'},
            {'id': 'cta', 'say': 'Cek sendiri semua sinyal dan hasilnya di goldhunter garuda dot com.'}]},
        'chart_open': open(sys.argv[2], 'rb').read() if len(sys.argv) > 2 else None,
        'chart_close': open(sys.argv[3], 'rb').read() if len(sys.argv) > 3 else None,
    }
    out = sys.argv[4] if len(sys.argv) > 4 else 'test_video.mp4'
    t0 = time.time()
    secs = render_video(job, out)
    print(f'OK {out}: {secs:.1f} s video, render {time.time() - t0:.0f} s')
