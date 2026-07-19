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

print(f'Total themes parsed: {len(themes)}')


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


# Stricter: true clones
pairs = []
for i, (id1, n1, g1, c1) in enumerate(themes):
    for id2, n2, g2, c2 in themes[i + 1 :]:
        scores = {
            k: dist(hex_to_rgb(c1.get(k, '')), hex_to_rgb(c2.get(k, ''))) for k in keys
        }
        close = sum(1 for s in scores.values() if s < 28)
        avg = sum(scores.values()) / len(scores)
        # Flag if panel+viewport+accent all close, OR overall very similar
        panel_vp_accent = scores['--bg-panel'] < 40 and scores['--viewport-bg'] < 40 and scores['--accent'] < 50
        if (close >= 4 and avg < 55) or (panel_vp_accent and avg < 70) or avg < 32:
            pairs.append((avg, close, id1, n1, id2, n2, {k: (c1.get(k), c2.get(k), scores[k]) for k in keys}))

pairs.sort()
print(f'\nStrict near-duplicates: {len(pairs)}')
for avg, close, id1, n1, id2, n2, cols in pairs:
    print(f'\n{id1} ({n1}) <-> {id2} ({n2}) | avg={avg:.1f} close={close}')
    for k, (a, b, d) in cols.items():
        mark = ' ***' if d < 28 else ''
        print(f'  {k}: {a} vs {b} (d={d:.1f}){mark}')

# Also print green/CRT-ish themes for movie screen differentiation
print('\n\n=== Green / CRT / cyber candidates ===')
for tid, name, group, css in themes:
    accent = css.get('--accent', '')
    textc = css.get('--text', '')
    rgb = hex_to_rgb(accent)
    if not rgb:
        continue
    r, g, b = rgb
    is_green = g > 160 and g > r * 1.3 and g > b * 1.2
    is_cyan = b > 160 and g > 140 and r < 100
    is_amber = r > 180 and g > 100 and g < 200 and b < 80
    if is_green or is_cyan or is_amber or tid in (
        'matrix', 'terminal', 'neon', 'radar', 'circuit', 'vaporwave',
        'poison', 'electric', 'deep-space', 'obsidian', 'midnight', 'forest',
    ):
        print(f'{tid:16} {name:22} vp={css.get("--viewport-bg")} panel={css.get("--bg-panel")} accent={accent} text={textc}')
