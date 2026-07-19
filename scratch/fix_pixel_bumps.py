from pathlib import Path
import re

p = Path('src/store/appStore.ts')
text = p.read_text(encoding='utf-8')

# Fix broken one-liners that still include revision inside bump and miss closing paren
broken = [
    (
        "set((s) => withPixelTextureBump(s, docId, { pixelDocuments: docs, pixelTextureRevision: s.pixelTextureRevision + 1 })",
        "set((s) => withPixelTextureBump(s, docId, { pixelDocuments: docs }))",
    ),
    (
        "set((s) => withPixelTextureBump(s, pixelEditorDocId, { pixelDocuments: docs, pixelTextureRevision: s.pixelTextureRevision + 1 })",
        "set((s) => withPixelTextureBump(s, pixelEditorDocId, { pixelDocuments: docs }))",
    ),
]
for old, new in broken:
    count = text.count(old)
    text = text.replace(old, new)
    print(f'fixed broken x{count}')

# Selection ops
sel = [
    (
        """    set((s) => ({
      pixelDocuments: next,
      pixelEditorSelection: null,
      pixelTextureRevision: s.pixelTextureRevision + 1,
    }))
    get().commitPixelEdit()
    return true
  },

  pastePixelClipboard""",
        """    set((s) =>
      withPixelTextureBump(s, pixelEditorDocId, {
        pixelDocuments: next,
        pixelEditorSelection: null,
      })
    )
    get().commitPixelEdit()
    return true
  },

  pastePixelClipboard""",
    ),
    (
        """    set((s) => ({
      pixelDocuments: result.docs,
      pixelEditorSelection: result.pasted,
      pixelTextureRevision: s.pixelTextureRevision + 1,
    }))
    get().commitPixelEdit()
    return true
  },

  deletePixelSelection""",
        """    set((s) =>
      withPixelTextureBump(s, pixelEditorDocId, {
        pixelDocuments: result.docs,
        pixelEditorSelection: result.pasted,
      })
    )
    get().commitPixelEdit()
    return true
  },

  deletePixelSelection""",
    ),
    (
        """    set((s) => ({
      pixelDocuments: next,
      pixelTextureRevision: s.pixelTextureRevision + 1,
    }))
    get().commitPixelEdit()
    return true
  },

  setPixelEditorTool""",
        """    set((s) =>
      withPixelTextureBump(s, pixelEditorDocId, {
        pixelDocuments: next,
      })
    )
    get().commitPixelEdit()
    return true
  },

  setPixelEditorTool""",
    ),
]

for old, new in sel:
    if old not in text:
        print('MISSING sel block')
        continue
    text = text.replace(old, new, 1)
    print('OK sel')

# openPixelEditor blank create
old_open = """      set((s) => ({
        pixelDocuments: docs,
        pixelEditorDocId: docId,
        objectTextures: {
          ...s.objectTextures,
          [docId!]: { url: '', name: 'Pixel texture', width, height },
        },
        pixelTextureRevision: s.pixelTextureRevision + 1,
      }))"""
new_open = """      set((s) =>
        withPixelTextureBump(s, docId, {
          pixelDocuments: docs,
          pixelEditorDocId: docId,
          objectTextures: {
            ...s.objectTextures,
            [docId!]: { url: '', name: 'Pixel texture', width, height },
          },
        })
      )"""
if old_open not in text:
    print('MISSING openPixelEditor')
else:
    text = text.replace(old_open, new_open, 1)
    print('OK open')

remaining = list(re.finditer(r'pixelTextureRevision: s\.pixelTextureRevision \+ 1', text))
# Helper itself has one — expected
print('Remaining (incl helper):', len(remaining))
for m in remaining:
    ctx = text[max(0, m.start()-60):m.end()+40]
    if 'withPixelTextureBump' in text[max(0,m.start()-400):m.start()] and 'bumpPixelDocRevision' in ctx:
        print('  (helper ok)')
    else:
        print('---', ctx.replace('\n','\\n'))

# Verify no broken withPixelTextureBump missing closing
if re.search(r'withPixelTextureBump\([^)]+\{[^}]+\}(?!\))', text):
    # crude check
    pass

# Count unbalanced - look for lines with withPixelTextureBump that don't end with ))
bad = []
for i, line in enumerate(text.splitlines(), 1):
    if 'withPixelTextureBump' in line and 'pixelTextureRevision: s.pixelTextureRevision' in line:
        bad.append(i)
    if 'withPixelTextureBump' in line and line.strip().endswith('+ 1 })'):
        bad.append(i)
print('bad lines', bad)

p.write_text(text, encoding='utf-8')
print('wrote')
