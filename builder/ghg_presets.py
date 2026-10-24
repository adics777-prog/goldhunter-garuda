"""Keep the GOLD HUNTER GARUDA presets in step with the EA's inputs.

Every preset (.set, UTF-16 as MT5 writes them) in MQL5\\Presets and MQL5\\Profiles\\Tester keeps the values it
already has; inputs that are new in the EA are added with the EA's default, inputs that no longer exist are dropped,
and the order follows the EA. The first comment line gets the current version. The builder runs this after every
new EA build, so presets never miss an input.

    python ghg_presets.py            sync and print a short report
"""
import glob
import os
import re

SRC = r'C:\Users\User\Documents\Robot Trading\GOLD HUNTER GARUDA.mq5'
MQL = r'C:\Users\User\AppData\Roaming\MetaQuotes\Terminal\53785E099C927DB68A545C249CDBCE06\MQL5'
NAME = 'GOLD HUNTER GARUDA'
TF = {'PERIOD_CURRENT': 0, 'PERIOD_M1': 1, 'PERIOD_M2': 2, 'PERIOD_M3': 3, 'PERIOD_M4': 4, 'PERIOD_M5': 5, 'PERIOD_M6': 6,
      'PERIOD_M10': 10, 'PERIOD_M12': 12, 'PERIOD_M15': 15, 'PERIOD_M20': 20, 'PERIOD_M30': 30, 'PERIOD_H1': 16385,
      'PERIOD_H2': 16386, 'PERIOD_H3': 16387, 'PERIOD_H4': 16388, 'PERIOD_H6': 16390, 'PERIOD_H8': 16392,
      'PERIOD_H12': 16396, 'PERIOD_D1': 16408, 'PERIOD_W1': 32769, 'PERIOD_MN1': 49153}
MA = {'MODE_SMA': 0, 'MODE_EMA': 1, 'MODE_SMMA': 2, 'MODE_LWMA': 3}


def ea_inputs(src_text):
    """[(name, default as the .set writes it)] in the EA's order."""
    enums = {}
    for m in re.finditer(r'enum\s+\w+\s*\{(.*?)\};', src_text, re.S):
        val = -1
        for line in m.group(1).split('\n'):
            mm = re.match(r'\s*(\w+)\s*(?:=\s*(-?\d+))?\s*,?', line)
            if not mm or not mm.group(1) or line.strip().startswith('//'):
                continue
            val = int(mm.group(2)) if mm.group(2) is not None else val + 1
            enums[mm.group(1)] = val
    out = []
    for m in re.finditer(r'^input\s+(\w+)\s+(\w+)\s*=\s*([^;]+);', src_text, re.M):
        typ, name, v = m.group(1), m.group(2), m.group(3).strip()
        if typ == 'group':
            continue
        if v.startswith('"'):
            v = v.strip('"')
        elif v in enums:
            v = str(enums[v])
        elif v in TF:
            v = str(TF[v])
        elif v in MA:
            v = str(MA[v])
        elif v in ('true', 'false'):
            v = 'true' if v == 'true' else 'false'
        elif v.startswith("C'"):
            r, g, b = [int(x) for x in re.findall(r'\d+', v)]
            v = str(r + g * 256 + b * 65536)
        out.append((name, v))
    return out


def read_set(path):
    raw = open(path, 'rb').read()
    txt = raw.decode('utf-16') if raw[:2] in (b'\xff\xfe', b'\xfe\xff') else raw.decode('utf-8', 'replace')
    head, vals = [], {}
    for ln in txt.replace('\r\n', '\n').split('\n'):
        if ln.startswith(';'):
            head.append(ln)
        elif '=' in ln:
            k, v = ln.split('=', 1)
            vals.setdefault(k.strip(), v)
    return head, vals


def sync(src=SRC, mql=MQL):
    s = open(src, encoding='utf-8-sig').read()
    version = re.search(r'#property\s+version\s+"([^"]+)"', s).group(1)
    inputs = ea_inputs(s)
    report = []
    for d in (os.path.join(mql, 'Presets'), os.path.join(mql, 'Profiles', 'Tester')):
        for f in sorted(glob.glob(os.path.join(d, glob.escape(NAME) + '*.set'))):
            head, vals = read_set(f)
            added = [n for n, _ in inputs if n not in vals]
            dropped = [k for k in vals if k not in dict(inputs)]
            first = head[0] if head else f'; {NAME} v{version}'
            first = re.sub(r'v\d+\.\d+', f'v{version}', first, count=1)
            lines = [first] + head[1:] + [f'{n}={vals.get(n, v)}' for n, v in inputs]
            body = '\r\n'.join(lines) + '\r\n'
            old = open(f, 'rb').read()
            new = b'\xff\xfe' + body.encode('utf-16-le')
            if new != old:
                open(f, 'wb').write(new)
            report.append((os.path.basename(f), len(added), len(dropped)))
    return version, len(inputs), report


if __name__ == '__main__':
    v, n, rep = sync()
    print(f'EA v{v}: {n} input')
    for name, a, d in rep:
        print(f'  {name}: +{a} input baru, -{d} input lama')
