"""
GOLD HUNTER GARUDA promo video: vertical 1080x1920 (TikTok / Reels / Shorts) about the EA.

render_video(job, out_path) -> seconds
  job = {
    'kind': 'edu',
    'topic': 'Edukasi: ...' (the part before ':' becomes the category chip),
    'lang': 'id' | 'en',
    'voice': 'id-ID-ArdiNeural',
    'script': {'scenes': [{'id': 'hook' | 'point' | 'cta', 'say': '...', 'text': '...', 'title': '...', 'icon': '...'}], 'hook': '...'},
  }
Scenes with any other id are skipped. Frames are drawn with Pillow and piped to ffmpeg (bundled by imageio-ffmpeg);
narration from Microsoft Edge TTS.
"""
import asyncio, os, subprocess, tempfile, time

from PIL import Image, ImageDraw, ImageFont

W, H, FPS = 1080, 1920, 30
BG = (11, 14, 20)
CARD = (19, 24, 33)
TEXT = (236, 238, 242)
MUTED = (146, 154, 170)
GOLD = (245, 197, 66)
UP = (38, 194, 129)
HERE = os.path.dirname(os.path.abspath(__file__))
LOGO = os.path.join(HERE, '..', 'public', 'assets', 'brand', 'goldhunter-garuda-logo-256.png')
FONT_DIR = os.path.join(os.environ.get('WINDIR', r'C:\Windows'), 'Fonts')
FONT_FILES = {'black': 'seguibl.ttf', 'bold': 'segoeuib.ttf', 'semi': 'seguisb.ttf', 'reg': 'segoeui.ttf', 'emoji': 'seguiemj.ttf'}
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
    d.text((186, 78), 'GOLD HUNTER GARUDA', font=F('black', 58), fill=GOLD)
    d.text((190, 148), T(lang, 'Expert Advisor MT5 / MT4 · laporan live', 'Expert Advisor for MT5 / MT4 · live reports'), font=F('semi', 30), fill=MUTED)
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


# ---------------------------------------------------------------- scenes: draw(im, t, dur)
def scene_hook(job):
    lang = job['lang']
    hook = job['script'].get('hook') or ''
    cat = category(job)

    def draw(im, t, dur):
        d = ImageDraw.Draw(im)
        k = ease(t / 0.5)
        if cat:
            f = F('black', 44)
            tw = d.textlength(cat, font=f)
            d.rounded_rectangle([W / 2 - tw / 2 - 34, 430, W / 2 + tw / 2 + 34, 510], radius=40, fill=GOLD)
            d.text((W / 2, 470), cat, font=f, fill=(26, 18, 0), anchor='mm')
        y = 600 + (1 - k) * 60
        text_block(d, hook, F('black', 92), 70, y, W - 140, TEXT if k > 0.2 else MUTED, max_lines=5)
        d.text((W / 2, 1300), T(lang, 'Hasil live dari akun nyata', 'Live results from real accounts'), font=F('semi', 36), fill=GOLD, anchor='mm')
    return draw


def category(job):
    topic = str(job.get('topic') or '')
    return topic.split(':', 1)[0].strip().upper()[:28] if job.get('kind') == 'edu' and ':' in topic else ''


def scene_point(job, sc=None):
    """Educational point: big number + icon + title, the earlier points stay listed below as a checklist."""
    lang = job['lang']
    pts = [x for x in job['script']['scenes'] if x.get('id') == 'point']
    idx = next((i for i, x in enumerate(pts) if x is sc), 0)
    cat = category(job) or T(lang, 'EDUKASI', 'LEARN')

    def draw(im, t, dur):
        d = ImageDraw.Draw(im)
        k = ease(t / 0.45)
        d.text((W / 2, 300), cat, font=F('bold', 38), fill=MUTED, anchor='mm')
        cx, cy = W / 2, 470
        r = 88 * (0.85 + 0.15 * k)
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=GOLD)
        d.text((cx, cy - 4), str(idx + 1), font=F('black', 110), fill=(26, 18, 0), anchor='mm')
        icon = (sc or {}).get('icon') or ''
        if icon:
            try:
                d.text((cx + 120, cy - 150), icon[:2], font=F('emoji', 109), embedded_color=True)
            except Exception:
                pass
        y = 610 + (1 - k) * 40
        y = text_block(d, (sc or {}).get('title') or '', F('black', 84), 70, y, W - 140, TEXT, max_lines=3)
        y = max(y + 60, 900)
        for i, p in enumerate(pts[:idx]):                 # earlier points as a small checklist
            d.rounded_rectangle([110, y, W - 110, y + 92], radius=22, fill=CARD)
            d.line([(146, y + 47), (157, y + 59), (178, y + 33)], fill=UP, width=7, joint='curve')
            d.text((205, y + 46), f"{i + 1}. {p.get('title') or ''}"[:38], font=F('bold', 40), fill=MUTED, anchor='lm')
            y += 112
    return draw


def scene_cta(job, sc=None):
    lang = job['lang']
    head = T(lang, 'Follow untuk edukasi & laporan live EA tiap hari', 'Follow for daily lessons & live EA reports')

    def draw(im, t, dur):
        d = ImageDraw.Draw(im)
        text_block(d, head, F('black', 78), 80, 520, W - 160, TEXT)
        k = ease(t / 0.6)
        pw = 860 * (0.9 + 0.1 * k)
        d.rounded_rectangle([W / 2 - pw / 2, 900, W / 2 + pw / 2, 1030], radius=65, fill=GOLD)
        d.text((W / 2, 965), 'goldhuntergaruda.com', font=F('black', 60), fill=(26, 18, 0), anchor='mm')
        d.text((W / 2, 1105), T(lang, 'Daftar gratis · laporan di Telegram', 'Free sign-up · reports on Telegram'), font=F('semi', 40), fill=MUTED, anchor='mm')
        d.rounded_rectangle([110, 1200, W - 110, 1380], radius=22, fill=(40, 18, 20))
        text_block(d, T(lang, 'Bukan saran investasi. Trading berisiko tinggi dan bisa rugi; hasil masa lalu tidak menjamin hasil berikutnya.',
                        'Not investment advice. Trading is high risk and can lose money; past results do not guarantee future results.'),
                   F('semi', 32), 140, 1226, W - 280, (255, 170, 170), max_lines=4)
    return draw


SCENES = {'hook': scene_hook, 'cta': scene_cta, 'point': scene_point}
WITH_SCENE = ('point', 'cta')                             # these builders also get their own scene dict


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
    scenes = [sc for sc in job['script']['scenes'] if sc.get('id') in SCENES]
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
        plan.append({'draw': SCENES[sc['id']](job, sc) if sc['id'] in WITH_SCENE else SCENES[sc['id']](job), 'dur': dur, 'mp3': mp3, 'sents': sents, 'say': say})
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
    cmd += ['-filter_complex', ';'.join(filt), '-map', '0:v', '-map', '[aout]', '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-profile:v', 'high', '-level', '4.2',
            '-g', str(FPS * 2), '-maxrate', '12M', '-bufsize', '24M', '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-colorspace', 'bt709',
            '-color_primaries', 'bt709', '-color_trc', 'bt709', '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-movflags', '+faststart', '-shortest', out_path]
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
    job = {'kind': 'edu', 'lang': sys.argv[1] if len(sys.argv) > 1 else 'id', 'topic': 'Cara kerja: apa itu basket dan TP bersama',
           'script': {'hook': 'Kenapa EA ini menutup banyak posisi sekaligus?', 'scenes': [
               {'id': 'hook', 'say': 'Kenapa EA ini menutup banyak posisi sekaligus? Ini rahasianya.'},
               {'id': 'point', 'icon': '🪜', 'title': 'Basket = kumpulan layer', 'say': 'Saat harga melawan, EA menambah layer. Semua layer satu sisi disebut basket.'},
               {'id': 'point', 'icon': '🎯', 'title': 'TP dari harga rata-rata', 'say': 'Semua posisi ditutup bersamaan di harga rata-rata ditambah target.'},
               {'id': 'point', 'icon': '⚠️', 'title': 'Jujur soal risiko', 'say': 'Tidak ada stop loss per posisi, jadi tren panjang bisa membuat floating dalam.'},
               {'id': 'cta', 'say': 'Lihat hasil live-nya di goldhunter garuda dot com.', 'text': 'Cek goldhuntergaruda.com/live'}]}}
    out = sys.argv[2] if len(sys.argv) > 2 else 'test_edu.mp4'
    t0 = time.time()
    print(f'OK {out}: {render_video(job, out):.1f} s video, render {time.time() - t0:.0f} s')
