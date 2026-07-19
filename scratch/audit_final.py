import re
from pathlib import Path

text = Path(r'C:\Users\Snow\Documents\Projects\blocky3D - Copy\src\theme\themes.ts').read_text(encoding='utf-8')
pattern = re.compile(
    r"theme\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*\{(.*?)\}\s*(?:,\s*'([^']+)')?\s*\)",
    re.S,
)
keys = ['--bg-dark', '--bg-panel', '--accent', '--text', '--viewport-bg']
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
groups = {}
for tid, name, group, _ in themes:
    groups.setdefault(group, []).append(f'{tid} ({name})')
for g, items in groups.items():
    print(f'\n{g}: {len(items)}')
    if g == 'Movie Screens':
        for i in items:
            print(f'  {i}')


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


# Only flag true palette clones (avg < 25 OR panel+viewport+accent all very close)
pairs = []
for i, (id1, n1, g1, c1) in enumerate(themes):
    for id2, n2, g2, c2 in themes[i + 1 :]:
        scores = {
            k: dist(hex_to_rgb(c1.get(k, '')), hex_to_rgb(c2.get(k, ''))) for k in keys
        }
        avg = sum(scores.values()) / len(scores)
        clone = (
            scores['--bg-panel'] < 30
            and scores['--viewport-bg'] < 30
            and scores['--accent'] < 40
            and avg < 35
        )
        if clone or avg < 18:
            pairs.append((avg, id1, n1, id2, n2, scores))

pairs.sort()
print(f'\nTrue clones remaining: {len(pairs)}')
for avg, id1, n1, id2, n2, scores in pairs[:25]:
    print(f'{id1}/{id2} avg={avg:.1f} accent_d={scores["--accent"]:.0f} panel_d={scores["--bg-panel"]:.0f}')
