"""GOLD HUNTER GARUDA: build the 12 setup EAs (XAU 1-3, BTC 1-3, EUR 1-3, JPY 1-3) from the main source.

Each EA = the main GOLD HUNTER GARUDA.mq5 with its input DEFAULTS replaced (no preset needed), its own magic
number, setup name, pair guard and budget (anggaran dana), plus an explanation in #property description.
Output: <folder of the main source>/setup/GOLD HUNTER GARUDA <PAIR> <n>.mq5 + .ex5 (and a copy in MQL5/Experts).

    python ghg_variants.py            build all 12 (uses builder config.json for MetaEditor / MQL5 paths)
    python ghg_variants.py --check    only regenerate the sources, no compile
"""
import json, os, re, shutil, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
TIERS = [('LOW', 'WR_LOW', 'risiko rendah'), ('MEDIUM', 'WR_MEDIUM', 'risiko sedang'), ('HIGH', 'WR_HIGH', 'risiko tinggi')]


def read_text(p):
    raw = open(p, 'rb').read()
    for enc in ('utf-8-sig', 'utf-16'):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            pass
    return raw.decode('latin-1')


def set_input(src, name, value):
    rx = re.compile(r'^(input\s+\S+\s+' + re.escape(name) + r'\s*=\s*)([^;]+)(;.*)$', re.M)
    out, n = rx.subn(lambda m: m.group(1) + value + m.group(3), src, count=1)
    if n != 1:
        raise RuntimeError(f'input {name} tidak ditemukan di source EA')
    return out


def th(x):
    return f'{int(x):,}'.replace(',', '.')


def money(pts, point, unit):
    if unit == '$':
        v = pts * point
        return ('$%.2f' % v).replace('.00', '')
    return ('%.1f pip' % (pts / 10)).replace('.0 ', ' ')


def variants(cfg_path=None):
    setups = json.load(open(os.path.join(HERE, 'setups.json'), encoding='utf-8'))
    out = []
    for code, p in setups['pairs'].items():
        for i, (risk, enum, txt) in enumerate(TIERS):
            n = i + 1
            cap = p['caps'][i]
            lot = round(0.01 * p['budget'] / cap, 2)
            out.append(dict(code=code, n=n, risk=risk, enum=enum, txt=txt, cap=cap, lot=lot, name=f'{code} {n}',
                            file=f'GOLD HUNTER GARUDA {code} {n}', **p))
    return out


def build_source(main_src, v):
    s = main_src
    vals = {
        'InpMagicNumber': str(v['magic'] + v['n']), 'InpComment': f'"GH {v["code"]} {v["n"]}"', 'InpSetupName': f'"{v["name"]}"',
        'InpOnlySymbol': f'"{v["symbol"]}"', 'InpBudget': f'{v["budget"]:.1f}', 'InpBudgetCompoundYN': 'YA', 'InpStartLot': '0.01',
        'InpUseAutoLotYN': 'YA', 'InpLotCapital': f'{v["cap"]:.1f}', 'InpFixDistancePts': str(v['dist']), 'InpTakeProfitPts': str(v['tp']),
        'InpReentryPts': str(v['back']), 'InpMaxSpreadPts': str(v['spread']), 'InpWebRisk': v['enum'],
    }
    for k, val in vals.items():
        s = set_input(s, k, val)
    budget_usd = v['budget'] / 100
    desc = [
        f'GOLD HUNTER GARUDA {v["name"]} - {v["risk"]} ({v["txt"]}), khusus {v["symbol"]}. Setelan sudah tertanam, tidak perlu Load preset.',
        f'Anggaran dana {th(v["budget"])} USC (${th(round(budget_usd))}): lot pertama {v["lot"]:.2f} (0.01 per {th(v["cap"])} USC), ikut profit setup ini.',
        f'Jarak {money(v["dist"], v["point"], v["unit"])}, TP bersama {money(v["tp"], v["point"], v["unit"])}, seri baru setelah mundur {money(v["back"], v["point"], v["unit"])}.',
        'Profit & persen dihitung dari anggaran. Banyak setup boleh di 1 akun (magic beda); saldo akun minimal = total anggaran.',
        'Pasang di chart pair-nya, isi 13.2 kunci web agar dilaporkan ke goldhuntergaruda.com. Akun HEDGING.',
    ]
    s = re.sub(r'^#property description[^\n]*\n', '', s, flags=re.M)
    s = re.sub(r'^(#property version[^\n]*\n)', lambda m: m.group(1) + ''.join(f'#property description "{d}"\n' for d in desc), s, count=1, flags=re.M)
    return s


def metaedit(p, target, logfile):
    # MetaEditor wants /compile:"path with spaces" (quote after the colon), so pass one raw command line
    cmd = f'"{p["metaeditor"]}" /compile:"{target}" /inc:"{p["mql_dir"]}" /log:"{logfile}"'
    subprocess.run(cmd, timeout=240)


def build_all(cfg, compile_=True, log=print):
    p = cfg.get('mt5') or {}
    src_path = p['ea_source']
    main_src = read_text(src_path).replace('\r\n', '\n')
    outdir = os.path.join(os.path.dirname(src_path), 'setup')
    os.makedirs(outdir, exist_ok=True)
    results = []
    for v in variants():
        target = os.path.join(outdir, v['file'] + '.mq5')
        open(target, 'w', encoding='utf-8-sig', newline='\r\n').write(build_source(main_src, v))
        if not compile_:
            results.append(target)
            continue
        logfile = os.path.join(outdir, v['file'] + '.log')
        metaedit(p, target, logfile)
        txt = read_text(logfile) if os.path.exists(logfile) else ''
        m = re.search(r'(\d+)\s+errors?,\s*(\d+)\s+warnings?', txt)
        ex5 = target[:-4] + '.ex5'
        if not os.path.exists(ex5) or os.path.getmtime(ex5) < os.path.getmtime(target) or (m and int(m.group(1)) > 0):
            raise RuntimeError(f'compile {v["file"]} gagal:\n' + txt[-1200:])
        os.remove(logfile)
        if p.get('mql_dir'):
            shutil.copy2(ex5, os.path.join(p['mql_dir'], 'Experts', os.path.basename(ex5)))
        results.append(ex5)
        log(f'  {v["file"]}: {m.group(0) if m else "ok"} · magic {v["magic"] + v["n"]} · anggaran {v["budget"]} · lot {v["lot"]:.2f}')
    return results


def setup_ex5s(cfg):
    """Compiled setup EAs that are newer than their generated source (for the VPS release)."""
    src_path = (cfg.get('mt5') or {}).get('ea_source') or ''
    outdir = os.path.join(os.path.dirname(src_path), 'setup')
    files = []
    for v in variants():
        ex5 = os.path.join(outdir, v['file'] + '.ex5')
        if os.path.exists(ex5):
            files.append(ex5)
    return files


if __name__ == '__main__':
    cfg = json.load(open(os.path.join(HERE, 'config.json'), encoding='utf-8'))
    out = build_all(cfg, compile_='--check' not in sys.argv)
    print(f'{len(out)} file')
