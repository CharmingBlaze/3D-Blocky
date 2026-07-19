import re
from pathlib import Path

text = Path(r'C:\Users\Snow\Documents\Projects\blocky3D - Copy\src\theme\themes.ts').read_text(encoding='utf-8')
pattern = re.compile(
    r"theme\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*\{(.*?)\}\s*(?:,\s*'([^']+)')?\s*\)",
    re.S,
)
keys = [
    '--bg-dark',
    '--bg-panel',
    '--accent',
    '--text',
    '--viewport-bg',
    '--viewport-bg-deep',
    '--grid-cell',
    '--grid-section',
]
themes = []
for m in pattern.finditer(text):
    tid, name, body, group = m.group(1), m.group(2), m.group(3), m.group(4) or 'Classic'
    css = {}
    for k in keys:
        mm = re.search(rf"'{re.escape(k)}':\s*'([^']+)'", body)
        if mm:
            css[k] = mm.group(1).lower()
    themes.append((tid, name, group, css))

print(f'Total themes: {len(themes)}')
by_group = {}
for tid, name, group, _ in themes:
    by_group.setdefault(group, []).append(f'{tid} ({name})')
for g, items in by_group.items():
    print(f'\n{g} ({len(items)}):')
    for item in items:
        print(f'  {item}')


def hex_to_rgb(h):
    if not h:
        return None
    h = h.lstrip('#')
    if len(h) != 6:
        return None
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))


def dist(a, b):
    if not a or not b:
        return 999.0
    return sum((x - y) ** 2 for x, y in zip(a, b)) ** 0.5


pairs = []
compare_keys = ['--viewport-bg', '--bg-panel', '--accent', '--bg-dark', '--text']
for i, (id1, n1, g1, c1) in enumerate(themes):
    for id2, n2, g2, c2 in themes[i + 1 :]:
        scores = [
            dist(hex_to_rgb(c1.get(k, '')), hex_to_rgb(c2.get(k, ''))) for k in compare_keys
        ]
        close = sum(1 for s in scores if s < 35)
        avg = sum(scores) / len(scores)
        if close >= 3 or avg < 45:
            pairs.append((avg, close, id1, n1, id2, n2, {k: (c1.get(k), c2.get(k)) for k in compare_keys}))

pairs.sort()
print('\nNear-duplicates (avg dist < 45 or 3+ keys close):')
for avg, close, id1, n1, id2, n2, cols in pairs:
    print(f'\n{id1} ({n1}) <-> {id2} ({n2}) | avg={avg:.1f} close={close}')
    for k, (a, b) in cols.items():
        d = dist(hex_to_rgb(a or ''), hex_to_rgb(b or ''))
        print(f'  {k}: {a} vs {b} (d={d:.1f})')
