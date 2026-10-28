"""GhgInputsJson() inside GOLD HUNTER GARUDA.mq5: every input of the EA as a JSON array of "Name=value" strings, sent to the
web with the heartbeat so the downloadable preset of a live setup always matches the chart (no waiting for an MT5 profile
backup). The function is generated from the input list; the builder regenerates it on every compile, so a new input is
never missing. Secrets (the web key 13.2) are always sent blank."""
import re
import sys

BEGIN = '//@GHG-SETDUMP-BEGIN'
END = '//@GHG-SETDUMP-END'
INPUT_RE = re.compile(r'^\s*(?:sinput|input)\s+(\w+)\s+(\w+)\s*=', re.M)
SECRET = {'InpWebKey'}


def generate(src):
    lines = [BEGIN + ' (dibuat otomatis oleh builder/ghg_setdump.py dari daftar input; jangan diubah manual)',
             'string GhgInputsJson()',
             '  {',
             '   string s = "[";']
    first = True
    for typ, name in INPUT_RE.findall(src):
        if typ == 'group':
            continue
        if name in SECRET:
            val = '""'
        elif typ == 'double':
            val = f'GhgSetNum({name})'
        elif typ == 'string':
            val = name
        elif typ == 'bool':
            val = f'({name} ? "true" : "false")'
        else:
            val = f'IntegerToString((long){name})'
        sep = '' if first else ','
        first = False
        lines.append(f'   s += "{sep}\\"" + JsonEsc("{name}=" + {val}) + "\\"";')
    lines += ['   return s + "]";', '  }', END]
    return '\n'.join(lines)


def apply(src):
    """Source text with the GhgInputsJson() region regenerated (unchanged when the source has no region)."""
    i, j = src.find(BEGIN), src.find(END)
    if i < 0 or j < i:
        return src
    nl = '\r\n' if '\r\n' in src else '\n'
    return src[:i] + generate(src).replace('\n', nl) + src[j + len(END):]


if __name__ == '__main__':
    path = sys.argv[1]
    text = open(path, encoding='utf-8-sig', newline='').read()
    out = apply(text)
    if out != text:
        open(path, 'w', encoding='utf-8-sig', newline='').write(out)
        print('regenerated')
    else:
        print('unchanged')
