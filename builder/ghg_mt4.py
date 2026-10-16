"""Generate the MT4 version of GOLD HUNTER GARUDA from the MT5 source.

The MQL5 logic stays the single source of truth: ghg_mt4_compat.mqh imitates the MQL5 functions the EA uses
(positions, deals, CTrade, iMA handles, OnTradeTransaction) with MQL4 calls, and this script only rewrites the
few things MQL4 cannot parse. Output: Robot Trading\\MT4\\GOLD HUNTER GARUDA.mq4 (+ compiled .ex4).

    python ghg_mt4.py            generate + compile
    python ghg_mt4.py --no-compile
"""
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = r'C:\Users\User\Documents\Robot Trading\GOLD HUNTER GARUDA.mq5'
OUT_DIR = r'C:\Users\User\Documents\Robot Trading\MT4'
OUT = os.path.join(OUT_DIR, 'GOLD HUNTER GARUDA.mq4')
OUT_EX4 = os.path.join(OUT_DIR, 'GOLD HUNTER GARUDA.ex4')
MT4_EDITOR = r'C:\Program Files (x86)\MetaTrader 4 EXNESS\metaeditor.exe'
MT4_DATA = r'C:\Users\User\AppData\Roaming\MetaQuotes\Terminal\2191F4A3D14D7B4B1EBB84F924777883'
CONST = re.compile(r"-?[\d.]+|\"[^\"]*\"|clr\w+|C'[\d,]+'|true|false")


def rep(s, a, b, n=1):
    c = s.count(a)
    if c != n:
        raise RuntimeError(f'MT4: pola ditemukan {c}x (harus {n}x): {a[:80]!r}')
    return s.replace(a, b)


def split_args(vals):
    parts, depth, cur = [], 0, ''
    for ch in vals:
        if ch in '([':
            depth += 1
        elif ch in ')]':
            depth -= 1
        if ch == ',' and depth == 0:
            parts.append(cur.strip())
            cur = ''
        else:
            cur += ch
    parts.append(cur.strip())
    return parts


def arr_init(m):
    """MQL4: a local array initialiser must be constants -> declaration + one assignment per element."""
    ind, typ, name, size, vals = m.groups()
    parts = split_args(vals)
    if all(CONST.fullmatch(v) for v in parts):
        return m.group(0)
    return f'{ind}{typ} {name}[{size}];\n' + '\n'.join(f'{ind}{name}[{i}] = {v};' for i, v in enumerate(parts))


def generate():
    s = open(SRC, encoding='utf-8-sig').read().replace('\r\n', '\n')
    shim = open(os.path.join(HERE, 'ghg_mt4_compat.mqh'), encoding='utf-8').read().replace('\r\n', '\n')
    version = re.search(r'#property\s+version\s+"([^"]+)"', s).group(1)

    # --- input groups do not exist in MQL4: a string input carries the title
    gi = [0]

    def grp(m):
        gi[0] += 1
        return f'input string InpGroup{gi[0]:02d} = "{m.group(1)}";'
    s = re.sub(r'^input group "([^"]*)"', grp, s, flags=re.M)
    s = s.replace('10. BERITA (kalender MT5, dampak tinggi)', '10. BERITA (tidak tersedia di MT4)')
    # --- MQL5 functions that clash with MQL4 built-ins (EA part only, before the shim is inserted)
    s = re.sub(r'\biMA\(', 'C4iMA(', s)
    s = re.sub(r'\bCopyBuffer\(', 'C4CopyBuffer(', s)
    s = re.sub(r'\bIndicatorRelease\(', 'C4Release(', s)
    s = re.sub(r'\bArrayRemove\(', 'C4ArrayRemove(', s)
    s = re.sub(r'\bOnTradeTransaction\(', 'C4OnTradeTransaction(', s)
    s = s.replace('TimeTradeServer()', 'C4TimeTradeServer()')
    # --- CCanvas MQL4 has no LineThick: a thick line = parallel anti-aliased lines
    s = rep(s, '      g_cvp.LineThick(KX(x1), KX(y1), KX(x2), KX(y2), AR(c), MathMax(1, KX(w)), STYLE_SOLID, LINE_END_ROUND);',
            '     {\n'
            '      int ww = MathMax(1, KX(w));\n'
            '      bool hz = MathAbs(x2 - x1) >= MathAbs(y2 - y1);\n'
            '      for(int o = -(ww / 2); o <= (ww - 1) / 2; o++)\n'
            '         g_cvp.LineAA(KX(x1) + (hz ? 0 : o), KX(y1) + (hz ? o : 0), KX(x2) + (hz ? 0 : o), KX(y2) + (hz ? o : 0), AR(c));\n'
            '     }')
    s = re.sub(r'^( +)(color|double|int|string|long) (\w+)\[(\d+)\] = \{(.*)\};$', arr_init, s, flags=re.M)
    # --- MT4 accounts always allow BUY and SELL together
    s = rep(s, 'AccountInfoInteger(ACCOUNT_MARGIN_MODE) != ACCOUNT_MARGIN_MODE_RETAIL_HEDGING', 'false')
    s = s.replace('   ChartSetInteger(0, CHART_SHOW_TRADE_HISTORY, false);\n', '')
    s = s.replace('OBJPROP_RAY_RIGHT', 'OBJPROP_RAY')
    # --- trade events: opened / closed positions are detected at the start of every tick and timer
    s = rep(s, 'void OnTick()\n  {\n', 'void OnTick()\n  {\n   C4Poll();\n   C4SrvOffTick();\n')
    s = rep(s, 'int OnInit()\n  {\n', 'int OnInit()\n  {\n'
            '   if(!C4InitCheck((long)InpMagicNumber, InpNewsMode == NEWS_HOLD))\n'
            '      return INIT_PARAMETERS_INCORRECT;\n'
            '   C4Poll();                                       // daftar posisi awal dicatat sebelum riwayat dibaca\n')
    s = rep(s, 'void OnTimer()\n  {\n', 'void OnTimer()\n  {\n   C4Poll();\n')
    # --- platform marker in the log and the web heartbeat
    s = s.replace(f'GOLD HUNTER GARUDA v{version} |', f'GOLD HUNTER GARUDA v{version} MT4 |')
    s = s.replace(f'\\"version\\":\\"{version}\\"', f'\\"version\\":\\"{version}-mt4\\"')
    # --- compatibility layer replaces Trade.mqh
    shim = shim.replace('OnTradeTransaction(', 'C4OnTradeTransaction(')
    s = rep(s, '#include <Trade\\Trade.mqh>\n', '#property strict\n' + shim + '\n')
    os.makedirs(OUT_DIR, exist_ok=True)
    open(OUT, 'w', encoding='utf-8-sig', newline='\r\n').write(s)
    return version


def compile_mt4():
    log = os.path.join(os.environ.get('TEMP', HERE), 'ghg_mt4_compile.log')
    if os.path.exists(log):
        os.remove(log)
    cmd = f'"{MT4_EDITOR}" /compile:"{OUT}" /inc:"{MT4_DATA}\\MQL4" /log:"{log}"'
    subprocess.run(cmd, timeout=240)
    txt = open(log, encoding='utf-16').read() if os.path.exists(log) else ''
    return [l for l in txt.splitlines() if 'error' in l.lower() or 'warning' in l.lower() or 'result' in l.lower()]


MT5_PRESETS = r'C:\Users\User\AppData\Roaming\MetaQuotes\Terminal\53785E099C927DB68A545C249CDBCE06\MQL5\Presets'
TF5_TO_4 = {16385: 60, 16386: 120, 16387: 180, 16388: 240, 16390: 360, 16392: 480, 16396: 720, 16408: 1440, 32769: 10080, 49153: 43200}
TF_INPUTS = ('InpSignalTF', 'InpTrendTF')


def make_presets():
    """MT5 presets -> MT4 presets (Robot Trading\MT4\Presets): same input names, timeframe codes converted,
    ANSI text as MT4 expects. Returns the number of files written."""
    import glob
    out_dir = os.path.join(OUT_DIR, 'Presets')
    os.makedirs(out_dir, exist_ok=True)
    n = 0
    for f in sorted(glob.glob(os.path.join(MT5_PRESETS, 'GOLD HUNTER GARUDA*.set'))):
        raw = open(f, 'rb').read()
        txt = raw.decode('utf-16') if raw[:2] in (b'\xff\xfe', b'\xfe\xff') else raw.decode('utf-8', 'replace')
        lines = []
        for ln in txt.replace('\r\n', '\n').replace('\r', '\n').split('\n'):
            if '=' in ln and not ln.startswith(';'):
                k, v = ln.split('=', 1)
                if k in TF_INPUTS and v.strip().isdigit():
                    v = str(TF5_TO_4.get(int(v), int(v)))
                lines.append(f'{k}={v}')
            elif ln.startswith(';'):
                lines.append(ln.replace('GOLD HUNTER GARUDA v', 'GOLD HUNTER GARUDA MT4 v'))
        open(os.path.join(out_dir, os.path.basename(f)), 'w', encoding='cp1252', errors='replace', newline='\r\n').write('\n'.join(lines) + '\n')
        n += 1
    return n


if __name__ == '__main__':
    v = generate()
    print('MT4 v' + v + ' ditulis:', OUT, '| preset MT4:', make_presets())
    if '--no-compile' not in sys.argv:
        for line in compile_mt4():
            print(line)
