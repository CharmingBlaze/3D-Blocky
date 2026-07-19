from pathlib import Path

p = Path('src/store/appStore.ts')
text = p.read_text(encoding='utf-8')

old_imp = """  pixelEditorInitialState,
  publishPixelDocumentIdentity,
  reorderPixelLayer,
  resetSoftBrushStroke,
  sampleColorFromDocument,
  syncPixelDocumentGpu,
  flushPixelDocumentGpuSync,
  resyncAllPixelDocuments,
} from '../pixel/pixelEditorSlice'"""
new_imp = """  bumpPixelDocRevision,
  pixelEditorInitialState,
  publishPixelDocumentIdentity,
  reorderPixelLayer,
  resetSoftBrushStroke,
  sampleColorFromDocument,
  syncPixelDocumentGpu,
  flushPixelDocumentGpuSync,
  resyncAllPixelDocuments,
} from '../pixel/pixelEditorSlice'"""
if old_imp not in text:
    raise SystemExit('import block not found')
text = text.replace(old_imp, new_imp, 1)

old_type = """  pixelDocuments: Record<string, import('../pixel/pixelTypes').PixelDocument>
  pixelTextureRevision: number
  pixelEditHistoryPending: boolean"""
new_type = """  pixelDocuments: Record<string, import('../pixel/pixelTypes').PixelDocument>
  pixelTextureRevision: number
  pixelDocRevisions: Record<string, number>
  pixelEditHistoryPending: boolean"""
if old_type not in text:
    raise SystemExit('type block not found')
text = text.replace(old_type, new_type, 1)

marker = "export const useAppStore = create"
idx = text.find(marker)
if idx < 0:
    raise SystemExit('create marker not found')
helper = '''
/** Bump global + per-doc texture revision for the painted document only. */
function withPixelTextureBump<T extends Record<string, unknown>>(
  s: { pixelTextureRevision: number; pixelDocRevisions: Record<string, number> },
  docId: string | null | undefined,
  patch: T
): T & { pixelTextureRevision: number; pixelDocRevisions: Record<string, number> } {
  return {
    ...patch,
    pixelTextureRevision: s.pixelTextureRevision + 1,
    pixelDocRevisions: bumpPixelDocRevision(s.pixelDocRevisions, docId),
  }
}

'''
text = text[:idx] + helper + text[idx:]
p.write_text(text, encoding='utf-8')
print('ok')
