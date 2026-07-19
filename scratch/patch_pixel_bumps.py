"""Patch appStore pixelTextureRevision bumps to also bump per-doc revisions."""
from pathlib import Path
import re

p = Path('src/store/appStore.ts')
text = p.read_text(encoding='utf-8')

# commitPixelEdit special case (uses get() not s)
old_commit = """    set({
      pixelEditHistoryPending: false,
      pixelTextureRevision: get().pixelTextureRevision + 1,
      pixelDocuments: published,
    })"""
new_commit = """    set((s) =>
      withPixelTextureBump(s, pixelEditorDocId, {
        pixelEditHistoryPending: false,
        pixelDocuments: published,
      })
    )"""
if old_commit not in text:
    raise SystemExit('commitPixelEdit block not found')
text = text.replace(old_commit, new_commit, 1)

# Generic: inside set((s) => ({ ... pixelTextureRevision: s.pixelTextureRevision + 1 ...}))
# We'll handle known patterns with docId in scope.

replacements = [
    # openPixelEditor blank create — docId!
    (
        """      set((s) => ({
        pixelDocuments: docs,
        pixelEditorDocId: docId,
        objectTextures: {
          ...s.objectTextures,
          [docId!]: { url: '', name: 'Pixel texture', width, height },
        },
        pixelTextureRevision: s.pixelTextureRevision + 1,
      }))""",
        """      set((s) =>
        withPixelTextureBump(s, docId, {
          pixelDocuments: docs,
          pixelEditorDocId: docId,
          objectTextures: {
            ...s.objectTextures,
            [docId!]: { url: '', name: 'Pixel texture', width, height },
          },
        })
      )""",
    ),
    # deletePixelSelection / similar — need to read file for remaining
]

# Broader approach: replace every `pixelTextureRevision: s.pixelTextureRevision + 1,` 
# that appears inside set callbacks — but we need docId. Manual list of remaining sites
# by reading surrounding function context via regex.

# Pattern A: set((s) => ({ ... pixelTextureRevision: s.pixelTextureRevision + 1 }))
# with pixelDocuments: docs and a known docId variable nearby.

def wrap_set_arrow(block: str, doc_expr: str) -> str:
    """Convert set((s) => ({ ... revision ...})) to withPixelTextureBump form."""
    # Remove pixelTextureRevision line from inner object
    inner = re.sub(
        r"\n\s*pixelTextureRevision: s\.pixelTextureRevision \+ 1,? ?",
        "\n",
        block,
    )
    # set((s) => ({  -> set((s) => withPixelTextureBump(s, DOC, {
    inner = inner.replace(
        "set((s) => ({",
        f"set((s) => withPixelTextureBump(s, {doc_expr}, {{",
        1,
    )
    # closing })) -> }))
    # Find last })) of this set call — fragile. Use replace of trailing `}))` once at end.
    if not inner.rstrip().endswith('}))'):
        # maybe `}))\n` with return after
        pass
    # Replace the final `}))` that closes set
    idx = inner.rfind('}))')
    if idx < 0:
        raise ValueError('no close')
    inner = inner[:idx] + '})' + inner[idx + 3:]
    return inner

# Do targeted replacements for each known site by unique surrounding text.

sites = [
    (
        'ensureTextureDocumentForObject',
        """    set((s) => ({
      pixelDocuments: docs,
      pixelEditorDocId: newId,
      objectTextures: {
        ...s.objectTextures,
        [newId]: { url: '', name: 'Pixel texture', width: 64, height: 64 },
      },
      pixelTextureRevision: s.pixelTextureRevision + 1,
    }))""",
        'newId',
    ),
    (
        'createNewPixelDocument',
        """    set((s) => ({
      pixelDocuments: docs,
      pixelEditorDocId: docId,
      objectTextures: {
        ...s.objectTextures,
        [docId]: { url: '', name: 'Pixel texture', width, height },
      },
      pixelTextureRevision: s.pixelTextureRevision + 1,
    }))""",
        'docId',
    ),
    (
        'resizeOpenPixelDocument',
        """    set((s) => ({
      pixelDocuments: nextDocs,
      objectTextures: {
        ...s.objectTextures,
        [pixelEditorDocId]: {
          ...(s.objectTextures[pixelEditorDocId] ?? { url: '', name: 'Pixel texture' }),
          width,
          height,
        },
      },
      pixelTextureRevision: s.pixelTextureRevision + 1,
    }))""",
        'pixelEditorDocId',
    ),
    (
        'importPixelImage new',
        """        set((s) => ({
          pixelDocuments: docs,
          pixelEditorDocId: docId,
          objectTextures: {
            ...s.objectTextures,
            [docId]: { url: '', name: file.name, width: doc.width, height: doc.height },
          },
          pixelTextureRevision: s.pixelTextureRevision + 1,
        }))""",
        'docId',
    ),
    (
        'importPixelImage layer',
        """      set((s) => ({ pixelDocuments: docs, pixelTextureRevision: s.pixelTextureRevision + 1 }))""",
        'docId',
    ),
    (
        'importHairTextureImage',
        """      set((s) => ({
        pixelDocuments: docs,
        objectTextures: {
          ...s.objectTextures,
          [docId]: { url: '', name: file.name, width: doc.width, height: doc.height },
        },
        pixelTextureRevision: s.pixelTextureRevision + 1,
        hairTextureId: docId,
      }))""",
        'docId',
    ),
    (
        'importPixelDocumentProject',
        """      set((s) => ({
        pixelDocuments: registerPixelDocument(s.pixelDocuments, doc),
        pixelEditorDocId: docId,
        objectTextures: {
          ...s.objectTextures,
          [docId]: {
            url: '',
            name: file.name.replace(/\\.[^.]+$/, ''),
            width: doc.width,
            height: doc.height,
          },
        },
        pixelTextureRevision: s.pixelTextureRevision + 1,
      }))""",
        'docId',
    ),
    (
        'addPixelEditorLayer',
        """    set((s) => ({
      pixelDocuments: addPixelLayer(s.pixelDocuments, docId),
      pixelTextureRevision: s.pixelTextureRevision + 1,
    }))""",
        'docId',
    ),
    (
        'deletePixelEditorLayer',
        """    set((s) => ({
      pixelDocuments: deletePixelLayer(s.pixelDocuments, docId, layerId),
      pixelTextureRevision: s.pixelTextureRevision + 1,
    }))""",
        'docId',
    ),
    (
        'duplicatePixelEditorLayer',
        """    set((s) => ({
      pixelDocuments: duplicatePixelLayer(s.pixelDocuments, docId, layerId),
      pixelTextureRevision: s.pixelTextureRevision + 1,
    }))""",
        'docId',
    ),
    (
        'mergePixelEditorLayerDown',
        """    set((s) => ({
      pixelDocuments: mergeLayerDown(s.pixelDocuments, docId, layerId),
      pixelTextureRevision: s.pixelTextureRevision + 1,
    }))""",
        'docId',
    ),
    (
        'reorderPixelEditorLayer',
        """    set((s) => ({
      pixelDocuments: reorderPixelLayer(s.pixelDocuments, docId, layerId, toIndex),
      pixelTextureRevision: s.pixelTextureRevision + 1,
    }))""",
        'docId',
    ),
    (
        'patchPixelEditorLayer',
        """    set((s) => ({
      pixelDocuments: patchPixelLayer(s.pixelDocuments, docId, layerId, patch),
      pixelTextureRevision: s.pixelTextureRevision + 1,
    }))""",
        'docId',
    ),
    (
        'paintPixelShape',
        """    set((s) => ({ pixelDocuments: docs, pixelTextureRevision: s.pixelTextureRevision + 1 }))""",
        'pixelEditorDocId',
    ),
    (
        'bucketFillPixelAt',
        """    set((s) => ({ pixelDocuments: docs, pixelTextureRevision: s.pixelTextureRevision + 1 }))""",
        'docId',
    ),
    (
        'paintOnModelShape',
        """    set((s) => ({ pixelDocuments: docs, pixelTextureRevision: s.pixelTextureRevision + 1 }))""",
        'docId',
    ),
]

# paintPixelShape / bucketFill / paintOnModelShape / import layer share similar one-liners —
# replace from bottom of file upward / with unique surrounding context.

# Handle one-liners with more context
one_liners = [
    (
        """  paintPixelShape: (tool, x0, y0, x1, y1) => {
    const {
      pixelEditorDocId,
      pixelDocuments,
      pixelEditorColor,
      pixelEditorBrushSize,
      pixelEditorShapeFilled,
      pixelEditorSymmetryH,
      pixelEditorSymmetryV,
    } = get()
    if (!pixelEditorDocId) return
    const docs = applyShapeToDocument(
      pixelDocuments,
      pixelEditorDocId,
      tool,
      x0,
      y0,
      x1,
      y1,
      pixelEditorColor,
      pixelEditorBrushSize,
      pixelEditorShapeFilled,
      pixelEditorSymmetryH,
      pixelEditorSymmetryV
    )
    set((s) => ({ pixelDocuments: docs, pixelTextureRevision: s.pixelTextureRevision + 1 }))
  },""",
        """  paintPixelShape: (tool, x0, y0, x1, y1) => {
    const {
      pixelEditorDocId,
      pixelDocuments,
      pixelEditorColor,
      pixelEditorBrushSize,
      pixelEditorShapeFilled,
      pixelEditorSymmetryH,
      pixelEditorSymmetryV,
    } = get()
    if (!pixelEditorDocId) return
    const docs = applyShapeToDocument(
      pixelDocuments,
      pixelEditorDocId,
      tool,
      x0,
      y0,
      x1,
      y1,
      pixelEditorColor,
      pixelEditorBrushSize,
      pixelEditorShapeFilled,
      pixelEditorSymmetryH,
      pixelEditorSymmetryV
    )
    set((s) => withPixelTextureBump(s, pixelEditorDocId, { pixelDocuments: docs }))
  },""",
    ),
    (
        """    const docs = bucketFillDocument(
      pixelDocuments,
      docId,
      x,
      y,
      pixelEditorColor,
      pixelEditorFillTolerance,
      global,
      pixelEditorSymmetryH,
      pixelEditorSymmetryV
    )
    set((s) => ({ pixelDocuments: docs, pixelTextureRevision: s.pixelTextureRevision + 1 }))
  },""",
        """    const docs = bucketFillDocument(
      pixelDocuments,
      docId,
      x,
      y,
      pixelEditorColor,
      pixelEditorFillTolerance,
      global,
      pixelEditorSymmetryH,
      pixelEditorSymmetryV
    )
    set((s) => withPixelTextureBump(s, docId, { pixelDocuments: docs }))
  },""",
    ),
    (
        """    const docs = applyShapeToDocument(
      pixelDocuments,
      docId,
      tool,
      x0,
      y0,
      x1,
      y1,
      pixelEditorColor,
      pixelEditorBrushSize,
      pixelEditorShapeFilled,
      pixelEditorSymmetryH,
      pixelEditorSymmetryV
    )
    set((s) => ({ pixelDocuments: docs, pixelTextureRevision: s.pixelTextureRevision + 1 }))
  },
}))""",
        """    const docs = applyShapeToDocument(
      pixelDocuments,
      docId,
      tool,
      x0,
      y0,
      x1,
      y1,
      pixelEditorColor,
      pixelEditorBrushSize,
      pixelEditorShapeFilled,
      pixelEditorSymmetryH,
      pixelEditorSymmetryV
    )
    set((s) => withPixelTextureBump(s, docId, { pixelDocuments: docs }))
  },
}))""",
    ),
    (
        """      const docs = await importImageAsLayer(get().pixelDocuments, docId, file)
      set((s) => ({ pixelDocuments: docs, pixelTextureRevision: s.pixelTextureRevision + 1 }))""",
        """      const docs = await importImageAsLayer(get().pixelDocuments, docId, file)
      set((s) => withPixelTextureBump(s, docId, { pixelDocuments: docs }))""",
    ),
]

for name, old, doc_expr in sites:
    if old not in text:
        # may already be converted or one-liner handled elsewhere
        if 'pixelTextureRevision: s.pixelTextureRevision + 1' in old:
            print(f'SKIP missing: {name}')
        continue
    new = wrap_set_arrow(old, doc_expr)
    text = text.replace(old, new, 1)
    print(f'OK: {name}')

for i, (old, new) in enumerate(one_liners):
    if old not in text:
        print(f'SKIP one_liner {i}')
        continue
    text = text.replace(old, new, 1)
    print(f'OK one_liner {i}')

# Remaining selection ops that bump revision — read deletePixelSelection etc.
# Also openPixelEditor and clear/copy selection

remaining = list(re.finditer(r'pixelTextureRevision: s\.pixelTextureRevision \+ 1', text))
print(f'Remaining s. bumps: {len(remaining)}')
for m in remaining:
    start = max(0, m.start() - 200)
    end = min(len(text), m.end() + 80)
    print('---')
    print(text[start:end].replace('\n', '\\n'))

get_bumps = list(re.finditer(r'pixelTextureRevision: get\(\)\.pixelTextureRevision \+ 1', text))
print(f'Remaining get() bumps: {len(get_bumps)}')

p.write_text(text, encoding='utf-8')
print('wrote')
