from pathlib import Path
import re

p = Path('src/store/appStore.ts')
text = p.read_text(encoding='utf-8')

# Fix: set((s) => withPixelTextureBump(...})  followed by `  },` without closing set's paren
# Pattern after wrap_set_arrow for multi-line: ends with `    })\n  },` but should be `    })\n  )` wait
# Looking at broken:
#   set((s) => withPixelTextureBump(s, docId, {
#     ...
#     })
#   },
# The `},` is the next method separator wrongly using the old set close.
# Should be:
#   set((s) => withPixelTextureBump(s, docId, {
#     ...
#   }))
# or
#   set((s) =>
#     withPixelTextureBump(...)
#   )

# Find broken: `withPixelTextureBump` ... `})\n  },` where set( is on same/previous lines without extra )

def fix_unclosed_set_bumps(src: str) -> str:
    # Match set((s) => withPixelTextureBump(s, EXPR, { ... })\n  },
    pattern = re.compile(
        r'set\(\(s\) => withPixelTextureBump\(s, ([^,]+), \{\n'
        r'((?:.*\n)*?)'
        r'(\s*)\}\)\n'
        r'(\s*)\},',
        re.M,
    )

    def repl(m: re.Match) -> str:
        doc = m.group(1)
        body = m.group(2)
        # Clean empty lines left from removed revision line
        body = re.sub(r'\n\s*\n', '\n', body)
        indent = m.group(3)
        return (
            f'set((s) =>\n'
            f'{indent}withPixelTextureBump(s, {doc}, {{\n'
            f'{body}'
            f'{indent}}})\n'
            f'{indent})\n'
            f'{m.group(4)},'
        )

    new, n = pattern.subn(repl, src)
    print(f'fixed unclosed multiline sets: {n}')
    return new

text = fix_unclosed_set_bumps(text)

# Also one-liners that are already `set((s) => withPixelTextureBump(...))` — OK

# Verify brace balance roughly around withPixelTextureBump usages
# Compile check via typescript later

# Remaining broken: set((s) => withPixelTextureBump...}) without paren — search
for m in re.finditer(r'set\(\(s\) => withPixelTextureBump', text):
    window = text[m.start():m.start()+500]
    # Find end of this statement
    if re.search(r'\}\)\n\s*\),', window) or re.search(r'\}\)\)\n', window) or re.search(r'\}\)\)\s*\n', window):
        status = 'ok'
    elif re.search(r'withPixelTextureBump\([^;]+\)\)\n', window):
        status = 'ok-oneline'
    else:
        status = 'CHECK'
    first_line = window.split('\n')[0][:80]
    if status == 'CHECK':
        print(status, first_line)
        print(window[:350])
        print('====')

p.write_text(text, encoding='utf-8')
print('wrote')
