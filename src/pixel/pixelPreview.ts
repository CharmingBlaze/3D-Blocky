/**
 * Unified pixel-document preview pipeline:
 *   stamp layer → composite dirty rect → notify 2D canvas → RAF GPU upload
 */

import type { PixelDocument } from './pixelTypes'
import { compositeLayers, compositeLayersRegionFast, invalidateUnderLayerCache } from './compositeLayers'
import {
  acquirePixelCompositeBuffer,
  getPixelCompositeCache,
  setPixelCompositeCache,
  uploadPixelDocGpu,
} from '../rendering/pixelDocTexture'
import { unionDirtyRects, type PixelDirtyRect } from './pixelDirtyRect'

const pendingGpu = new Map<string, PixelDirtyRect | null>()
let pendingGpuRaf = 0
let lastGpuFlushAt = 0
const LIVE_GPU_INTERVAL_MS = 1000 / 30

function mergePendingDirty(
  prev: PixelDirtyRect | null | undefined,
  next: PixelDirtyRect | null
): PixelDirtyRect | null {
  if (prev === null || next === null) return null
  if (!prev) return next
  if (!next) return prev
  return unionDirtyRects(prev, next)
}

function flushPendingGpu(): void {
  if (pendingGpuRaf) {
    cancelAnimationFrame(pendingGpuRaf)
    pendingGpuRaf = 0
  }
  const batch = [...pendingGpu.entries()]
  pendingGpu.clear()
  lastGpuFlushAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
  for (const [docId, dirty] of batch) {
    const cached = getPixelCompositeCache(docId)
    if (!cached) continue
    uploadPixelDocGpu(docId, cached.pixels, cached.width, cached.height, dirty)
  }
}

/** Composite flattened pixels and notify 2D subscribers immediately. */
export function syncDocPreview(
  docs: Record<string, PixelDocument>,
  docId: string,
  dirty: PixelDirtyRect | null = null
): Uint8ClampedArray | null {
  const doc = docs[docId]
  if (!doc) return null

  const prev = getPixelCompositeCache(docId)
  const canDirty =
    Boolean(dirty) &&
    Boolean(prev) &&
    prev!.width === doc.width &&
    prev!.height === doc.height &&
    prev!.version > 0

  const buffer = acquirePixelCompositeBuffer(docId, doc.width, doc.height)
  if (canDirty && dirty) {
    compositeLayersRegionFast(doc, buffer, dirty)
    setPixelCompositeCache(docId, buffer, doc.width, doc.height, dirty)
    return buffer
  }
  invalidateUnderLayerCache(docId)
  const composite = compositeLayers(doc, buffer)
  setPixelCompositeCache(docId, composite, doc.width, doc.height, null)
  return composite
}

export function syncDocPreviewGpu(
  docs: Record<string, PixelDocument>,
  docId: string,
  dirty: PixelDirtyRect | null = null
): void {
  const composite = syncDocPreview(docs, docId, dirty)
  if (!composite) return
  uploadPixelDocGpu(docId, composite, docs[docId]!.width, docs[docId]!.height, dirty)
}

/** Live strokes: 2D immediate, GPU coalesced to one RAF per doc. */
export function scheduleDocPreview(
  docs: Record<string, PixelDocument>,
  docId: string,
  dirty: PixelDirtyRect | null = null,
  options?: { gpu?: boolean }
): void {
  syncDocPreview(docs, docId, dirty)
  const prev = pendingGpu.get(docId)
  pendingGpu.set(docId, mergePendingDirty(prev, dirty))
  if (options?.gpu === false) return
  if (pendingGpuRaf) return
  const schedule = () => {
    pendingGpuRaf = requestAnimationFrame((now) => {
      if (now - lastGpuFlushAt < LIVE_GPU_INTERVAL_MS) {
        schedule()
        return
      }
      pendingGpuRaf = 0
      flushPendingGpu()
    })
  }
  schedule()
}

export function flushDocPreviewGpu(): void {
  flushPendingGpu()
}

export function resyncAllDocPreviews(docs: Record<string, PixelDocument>): void {
  flushDocPreviewGpu()
  for (const id of Object.keys(docs)) syncDocPreviewGpu(docs, id)
}

export function invalidateDocCompositeCaches(docId: string): void {
  invalidateUnderLayerCache(docId)
}

// Legacy aliases
export const syncPixelDocumentComposite = syncDocPreview
export const syncPixelDocumentGpu = syncDocPreviewGpu
export const schedulePixelDocumentGpuSync = scheduleDocPreview
export const flushPixelDocumentGpuSync = flushDocPreviewGpu
export const resyncAllPixelDocuments = resyncAllDocPreviews
