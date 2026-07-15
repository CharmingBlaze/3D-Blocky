import { generateId } from '../utils/math'
import type { CustomPalette, Rgba4 } from '../material/materialTypes'
import { hexToRgba4 } from '../material/materialTypes'
import { compositeLayers } from './compositeLayers'
import {
  clonePixelDocument,
  clonePixelLayer,
  createEmptyLayer,
  createPixelDocument,
  documentFromImageData,
  getActiveLayer,
  loadImageFileToImageData,
} from './pixelDocument'
import type { PixelDocument, PixelLayer, PixelSelection, PixelTool } from './pixelTypes'
import type { PixelBrushShape } from './pixelBrushTypes'
import {
  drawEllipseOnLayer,
  drawLineOnLayer,
  drawRectOnLayer,
  drawStrokeWithSymmetry,
  floodFillLayer,
  getPixel,
  paintWithSymmetry,
  rgbaToBytes,
} from './pixelTools'
import type { SoftBrushParams } from './softBrush'
import {
  beginSoftBrushStroke,
  continueSoftBrushStroke,
  paintSoftBrushDab,
  resetSoftBrushStroke,
} from './softBrush'
import { uploadPixelDocumentTexture } from '../rendering/textureCache'
import {
  clearPixelCompositeCache,
  setPixelCompositeCache,
  acquirePixelCompositeBuffer,
} from './pixelCompositeCache'

export interface PixelEditorState {
  pixelEditorOpen: boolean
  pixelEditorPanel: {
    x: number
    y: number
    width: number
    height: number
    minimized: boolean
  }
  pixelEditorDocId: string | null
  pixelEditorTool: PixelTool
  pixelEditorBrushSize: number
  pixelEditorBrushShape: PixelBrushShape
  /** Paint Brush hardness 0–1 (0 = soft edge, 1 = hard). */
  pixelEditorBrushHardness: number
  /** Paint Brush opacity 0–1. */
  pixelEditorBrushOpacity: number
  /** Paint Brush flow 0–1 (paint per dab). */
  pixelEditorBrushFlow: number
  pixelEditorPixelPerfect: boolean
  pixelEditorSymmetryH: boolean
  pixelEditorSymmetryV: boolean
  pixelEditorPaintOnModel: boolean
  /** Show UV island outlines on the pixel canvas (realtime when UVs change). */
  pixelEditorShowUvOverlay: boolean
  pixelEditorShapeFilled: boolean
  pixelEditorZoom: number
  pixelEditorPanX: number
  pixelEditorPanY: number
  pixelEditorSelection: PixelSelection | null
  pixelEditorFillTolerance: number
  /** Floating tool strip position inside the pixel canvas viewport. */
  pixelEditorToolbarPosition: { x: number; y: number }
  /** Active pen color for canvas + paint-on-model — does not change object materials. */
  pixelEditorColor: Rgba4
  pixelEditorPaletteId: string
  pixelEditorCustomPalettes: CustomPalette[]
  pixelDocuments: Record<string, PixelDocument>
  pixelTextureRevision: number
}

export const pixelEditorInitialState: PixelEditorState = {
  pixelEditorOpen: false,
  pixelEditorPanel: { x: 112, y: 112, width: 840, height: 560, minimized: false },
  pixelEditorDocId: null,
  pixelEditorTool: 'pencil',
  pixelEditorBrushSize: 1,
  pixelEditorBrushShape: 'round',
  pixelEditorBrushHardness: 0.35,
  pixelEditorBrushOpacity: 1,
  pixelEditorBrushFlow: 0.8,
  pixelEditorPixelPerfect: false,
  pixelEditorSymmetryH: false,
  pixelEditorSymmetryV: false,
  pixelEditorPaintOnModel: true,
  pixelEditorShowUvOverlay: false,
  pixelEditorShapeFilled: false,
  pixelEditorZoom: 8,
  pixelEditorPanX: 0,
  pixelEditorPanY: 0,
  pixelEditorSelection: null,
  pixelEditorFillTolerance: 32,
  pixelEditorToolbarPosition: { x: 10, y: 10 },
  pixelEditorColor: hexToRgba4('#6ecbf5'),
  pixelEditorPaletteId: 'pico8',
  pixelEditorCustomPalettes: [],
  pixelDocuments: {},
  pixelTextureRevision: 0,
}

export function syncPixelDocumentGpu(
  docs: Record<string, PixelDocument>,
  docId: string
): void {
  const doc = docs[docId]
  if (!doc) return
  const buffer = acquirePixelCompositeBuffer(docId, doc.width, doc.height)
  const composite = compositeLayers(doc, buffer)
  setPixelCompositeCache(docId, composite, doc.width, doc.height)
  uploadPixelDocumentTexture(docId, composite, doc.width, doc.height)
}

/** Coalesce rapid stroke updates into one composite+GPU upload per animation frame. */
let pendingSyncDocs: Record<string, PixelDocument> | null = null
const pendingSyncIds = new Set<string>()
let pendingSyncRaf = 0

function flushPendingPixelGpuSync(): void {
  if (pendingSyncRaf) {
    cancelAnimationFrame(pendingSyncRaf)
    pendingSyncRaf = 0
  }
  const docs = pendingSyncDocs
  const ids = [...pendingSyncIds]
  pendingSyncDocs = null
  pendingSyncIds.clear()
  if (!docs) return
  for (const id of ids) syncPixelDocumentGpu(docs, id)
}

export function schedulePixelDocumentGpuSync(
  docs: Record<string, PixelDocument>,
  docId: string
): void {
  pendingSyncDocs = docs
  pendingSyncIds.add(docId)
  if (pendingSyncRaf) return
  pendingSyncRaf = requestAnimationFrame(() => {
    pendingSyncRaf = 0
    flushPendingPixelGpuSync()
  })
}

export function flushPixelDocumentGpuSync(): void {
  flushPendingPixelGpuSync()
}

export function resyncAllPixelDocuments(docs: Record<string, PixelDocument>): void {
  flushPixelDocumentGpuSync()
  for (const id of Object.keys(docs)) syncPixelDocumentGpu(docs, id)
}

/**
 * Shallow-clone doc structure for immutable updates. Pixel buffers stay shared until
 * an updater replaces a layer's `pixels` (avoids cloning every layer on each stroke).
 */
function draftPixelDocument(doc: PixelDocument): PixelDocument {
  return {
    ...doc,
    layers: doc.layers.map((l) => ({ ...l })),
  }
}

export function updatePixelDocument(
  docs: Record<string, PixelDocument>,
  docId: string,
  updater: (doc: PixelDocument) => PixelDocument,
  options?: { sync?: 'immediate' | 'raf' }
): Record<string, PixelDocument> {
  const doc = docs[docId]
  if (!doc) return docs
  const next = { ...docs, [docId]: updater(draftPixelDocument(doc)) }
  if (options?.sync === 'raf') schedulePixelDocumentGpuSync(next, docId)
  else syncPixelDocumentGpu(next, docId)
  return next
}

/**
 * Clone the open document once so in-place stroke painting cannot mutate undo history.
 * Returns the same `docs` reference when already detached / missing.
 */
export function detachPixelDocumentForEditing(
  docs: Record<string, PixelDocument>,
  docId: string
): Record<string, PixelDocument> {
  const doc = docs[docId]
  if (!doc) return docs
  return { ...docs, [docId]: clonePixelDocument(doc) }
}

/**
 * Publish a new document/layer object identity after in-place strokes so React
 * effects keyed on `pixelDoc` (UV editor, hair preview, etc.) reload.
 * Pixel buffers are reused — no deep clone.
 */
export function publishPixelDocumentIdentity(
  docs: Record<string, PixelDocument>,
  docId: string
): Record<string, PixelDocument> {
  const doc = docs[docId]
  if (!doc) return docs
  return {
    ...docs,
    [docId]: {
      ...doc,
      layers: doc.layers.map((l) => ({ ...l })),
    },
  }
}

function paintLiveOnActiveLayer(
  docs: Record<string, PixelDocument>,
  docId: string,
  paint: (pixels: Uint8ClampedArray, doc: PixelDocument) => void
): boolean {
  const doc = docs[docId]
  if (!doc) return false
  const layer = getActiveLayer(doc)
  if (!layer) return false
  paint(layer.pixels, doc)
  schedulePixelDocumentGpuSync(docs, docId)
  return true
}

/** In-place pencil/eraser stamp — no document clone, no Zustand publish. */
export function paintAtPixelLive(
  docs: Record<string, PixelDocument>,
  docId: string,
  x: number,
  y: number,
  color: Rgba4,
  brushSize: number,
  tool: 'pencil' | 'eraser',
  symH: boolean,
  symV: boolean,
  options?: { round?: boolean }
): void {
  const round = options?.round ?? true
  paintLiveOnActiveLayer(docs, docId, (pixels, doc) => {
    const bytes =
      tool === 'eraser' ? ([0, 0, 0, 0] as [number, number, number, number]) : rgbaToBytes(color)
    paintWithSymmetry(
      pixels,
      doc.width,
      doc.height,
      Math.floor(x),
      Math.floor(y),
      brushSize,
      bytes,
      symH,
      symV,
      round
    )
  })
}

/** In-place hard stroke segment — no document clone, no Zustand publish. */
export function paintStrokeOnDocumentLive(
  docs: Record<string, PixelDocument>,
  docId: string,
  points: { x: number; y: number }[],
  color: Rgba4,
  brushSize: number,
  tool: 'pencil' | 'eraser',
  pixelPerfect: boolean,
  symH: boolean,
  symV: boolean,
  options?: { round?: boolean }
): void {
  if (points.length === 0) return
  const round = options?.round ?? true
  paintLiveOnActiveLayer(docs, docId, (pixels, doc) => {
    const bytes =
      tool === 'eraser' ? ([0, 0, 0, 0] as [number, number, number, number]) : rgbaToBytes(color)
    drawStrokeWithSymmetry(
      pixels,
      doc.width,
      doc.height,
      points.map((p) => ({ x: Math.floor(p.x), y: Math.floor(p.y) })),
      brushSize,
      bytes,
      pixelPerfect,
      symH,
      symV,
      round
    )
  })
}

/** In-place soft brush — no document clone, no Zustand publish. */
export function paintSoftBrushStrokeOnDocumentLive(
  docs: Record<string, PixelDocument>,
  docId: string,
  points: { x: number; y: number }[],
  color: Rgba4,
  params: SoftBrushParams,
  symH: boolean,
  symV: boolean,
  options?: { erase?: boolean; restart?: boolean }
): void {
  if (points.length === 0) return
  const erase = options?.erase ?? false
  if (options?.restart) resetSoftBrushStroke()
  const brushColor = rgbaToBytes(color) as [number, number, number, number]

  paintLiveOnActiveLayer(docs, docId, (pixels, doc) => {
    const stampMirrors =
      symH || symV
        ? (px: number, py: number) => {
            for (const c of mirrorSoftBrushCoords(px, py, doc.width, doc.height, symH, symV)) {
              if (Math.abs(c.x - px) < 1e-6 && Math.abs(c.y - py) < 1e-6) continue
              paintSoftBrushDab(pixels, doc.width, doc.height, c.x, c.y, brushColor, params, erase)
            }
          }
        : undefined

    const first = points[0]!
    if (points.length === 1 || options?.restart) {
      beginSoftBrushStroke(
        pixels,
        doc.width,
        doc.height,
        first.x,
        first.y,
        brushColor,
        params,
        erase,
        stampMirrors
      )
      for (let i = 1; i < points.length; i++) {
        const p = points[i]!
        continueSoftBrushStroke(
          pixels,
          doc.width,
          doc.height,
          p.x,
          p.y,
          brushColor,
          params,
          erase,
          stampMirrors
        )
      }
    } else {
      for (let i = 0; i < points.length; i++) {
        const p = points[i]!
        continueSoftBrushStroke(
          pixels,
          doc.width,
          doc.height,
          p.x,
          p.y,
          brushColor,
          params,
          erase,
          stampMirrors
        )
      }
    }
  })
}

export function releasePixelDocumentResources(docId: string): void {
  clearPixelCompositeCache(docId)
}

export function paintAtPixel(
  docs: Record<string, PixelDocument>,
  docId: string,
  x: number,
  y: number,
  color: Rgba4,
  brushSize: number,
  tool: 'pencil' | 'eraser',
  symH: boolean,
  symV: boolean,
  options?: { sync?: 'immediate' | 'raf'; round?: boolean }
): Record<string, PixelDocument> {
  const round = options?.round ?? true
  return updatePixelDocument(
    docs,
    docId,
    (doc) => {
      const layer = getActiveLayer(doc)
      if (!layer) return doc
      const px = Math.floor(x)
      const py = Math.floor(y)
      const bytes =
        tool === 'eraser' ? ([0, 0, 0, 0] as [number, number, number, number]) : rgbaToBytes(color)
      const pixels = clonePixelLayer(layer).pixels
      paintWithSymmetry(pixels, doc.width, doc.height, px, py, brushSize, bytes, symH, symV, round)
      return {
        ...doc,
        layers: doc.layers.map((l) => (l.id === layer.id ? { ...l, pixels } : l)),
      }
    },
    options
  )
}

export function paintStrokeOnDocument(
  docs: Record<string, PixelDocument>,
  docId: string,
  points: { x: number; y: number }[],
  color: Rgba4,
  brushSize: number,
  tool: 'pencil' | 'eraser',
  pixelPerfect: boolean,
  symH: boolean,
  symV: boolean,
  options?: { sync?: 'immediate' | 'raf'; round?: boolean }
): Record<string, PixelDocument> {
  if (points.length === 0) return docs
  const round = options?.round ?? true
  return updatePixelDocument(
    docs,
    docId,
    (doc) => {
      const layer = getActiveLayer(doc)
      if (!layer) return doc
      const bytes =
        tool === 'eraser' ? ([0, 0, 0, 0] as [number, number, number, number]) : rgbaToBytes(color)
      const pixels = clonePixelLayer(layer).pixels
      drawStrokeWithSymmetry(
        pixels,
        doc.width,
        doc.height,
        points.map((p) => ({ x: Math.floor(p.x), y: Math.floor(p.y) })),
        brushSize,
        bytes,
        pixelPerfect,
        symH,
        symV,
        round
      )
      return {
        ...doc,
        layers: doc.layers.map((l) => (l.id === layer.id ? { ...l, pixels } : l)),
      }
    },
    options
  )
}

function mirrorSoftBrushCoords(
  x: number,
  y: number,
  width: number,
  height: number,
  symH: boolean,
  symV: boolean
): { x: number; y: number }[] {
  const coords = [{ x, y }]
  if (symH) coords.push({ x: width - 1 - x, y })
  if (symV) coords.push({ x, y: height - 1 - y })
  if (symH && symV) coords.push({ x: width - 1 - x, y: height - 1 - y })
  return coords
}

/** Adobe-style soft Paint Brush stroke (hardness / opacity / flow / spacing). */
export function paintSoftBrushStrokeOnDocument(
  docs: Record<string, PixelDocument>,
  docId: string,
  points: { x: number; y: number }[],
  color: Rgba4,
  params: SoftBrushParams,
  symH: boolean,
  symV: boolean,
  options?: { sync?: 'immediate' | 'raf'; erase?: boolean; restart?: boolean }
): Record<string, PixelDocument> {
  if (points.length === 0) return docs
  const erase = options?.erase ?? false
  if (options?.restart) resetSoftBrushStroke()
  const brushColor = rgbaToBytes(color) as [number, number, number, number]

  return updatePixelDocument(
    docs,
    docId,
    (doc) => {
      const layer = getActiveLayer(doc)
      if (!layer) return doc
      const pixels = clonePixelLayer(layer).pixels
      const stampMirrors =
        symH || symV
          ? (px: number, py: number) => {
              for (const c of mirrorSoftBrushCoords(px, py, doc.width, doc.height, symH, symV)) {
                if (Math.abs(c.x - px) < 1e-6 && Math.abs(c.y - py) < 1e-6) continue
                paintSoftBrushDab(pixels, doc.width, doc.height, c.x, c.y, brushColor, params, erase)
              }
            }
          : undefined

      const first = points[0]!
      if (points.length === 1 || options?.restart) {
        beginSoftBrushStroke(
          pixels,
          doc.width,
          doc.height,
          first.x,
          first.y,
          brushColor,
          params,
          erase,
          stampMirrors
        )
        for (let i = 1; i < points.length; i++) {
          const p = points[i]!
          continueSoftBrushStroke(
            pixels,
            doc.width,
            doc.height,
            p.x,
            p.y,
            brushColor,
            params,
            erase,
            stampMirrors
          )
        }
      } else {
        for (let i = 0; i < points.length; i++) {
          const p = points[i]!
          continueSoftBrushStroke(
            pixels,
            doc.width,
            doc.height,
            p.x,
            p.y,
            brushColor,
            params,
            erase,
            stampMirrors
          )
        }
      }

      return {
        ...doc,
        layers: doc.layers.map((l) => (l.id === layer.id ? { ...l, pixels } : l)),
      }
    },
    options
  )
}

export { resetSoftBrushStroke }

export function applyShapeToDocument(
  docs: Record<string, PixelDocument>,
  docId: string,
  tool: 'line' | 'rectangle' | 'ellipse',
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: Rgba4,
  brushSize: number,
  filled: boolean,
  symH: boolean,
  symV: boolean
): Record<string, PixelDocument> {
  return updatePixelDocument(docs, docId, (doc) => {
    const layer = getActiveLayer(doc)
    if (!layer) return doc
    const bytes = rgbaToBytes(color)
    const pixels = clonePixelLayer(layer).pixels
    const fx0 = Math.floor(x0)
    const fy0 = Math.floor(y0)
    const fx1 = Math.floor(x1)
    const fy1 = Math.floor(y1)

    const draw = () => {
      if (tool === 'line') drawLineOnLayer(pixels, doc.width, doc.height, fx0, fy0, fx1, fy1, brushSize, bytes)
      else if (tool === 'rectangle')
        drawRectOnLayer(pixels, doc.width, doc.height, fx0, fy0, fx1, fy1, brushSize, bytes, filled)
      else drawEllipseOnLayer(pixels, doc.width, doc.height, fx0, fy0, fx1, fy1, brushSize, bytes, filled)
    }

    if (!symH && !symV) draw()
    else {
      const coords = [
        { x0: fx0, y0: fy0, x1: fx1, y1: fy1 },
        ...(symH
          ? [
              {
                x0: doc.width - 1 - fx0,
                y0: fy0,
                x1: doc.width - 1 - fx1,
                y1: fy1,
              },
            ]
          : []),
        ...(symV
          ? [
              {
                x0: fx0,
                y0: doc.height - 1 - fy0,
                x1: fx1,
                y1: doc.height - 1 - fy1,
              },
            ]
          : []),
      ]
      if (symH && symV) {
        coords.push({
          x0: doc.width - 1 - fx0,
          y0: doc.height - 1 - fy0,
          x1: doc.width - 1 - fx1,
          y1: doc.height - 1 - fy1,
        })
      }
      for (const c of coords) {
        if (tool === 'line')
          drawLineOnLayer(pixels, doc.width, doc.height, c.x0, c.y0, c.x1, c.y1, brushSize, bytes)
        else if (tool === 'rectangle')
          drawRectOnLayer(pixels, doc.width, doc.height, c.x0, c.y0, c.x1, c.y1, brushSize, bytes, filled)
        else
          drawEllipseOnLayer(pixels, doc.width, doc.height, c.x0, c.y0, c.x1, c.y1, brushSize, bytes, filled)
      }
    }

    return {
      ...doc,
      layers: doc.layers.map((l) => (l.id === layer.id ? { ...l, pixels } : l)),
    }
  })
}

export function bucketFillDocument(
  docs: Record<string, PixelDocument>,
  docId: string,
  x: number,
  y: number,
  color: Rgba4,
  tolerance: number,
  global: boolean,
  symH: boolean,
  symV: boolean
): Record<string, PixelDocument> {
  return updatePixelDocument(docs, docId, (doc) => {
    const layer = getActiveLayer(doc)
    if (!layer) return doc
    const bytes = rgbaToBytes(color)
    const pixels = clonePixelLayer(layer).pixels
    const coords = symH || symV
      ? (() => {
          const px = Math.floor(x)
          const py = Math.floor(y)
          const set = new Set<string>()
          const out: { x: number; y: number }[] = []
          for (const c of [
            { x: px, y: py },
            ...(symH ? [{ x: doc.width - 1 - px, y: py }] : []),
            ...(symV ? [{ x: px, y: doc.height - 1 - py }] : []),
            ...(symH && symV ? [{ x: doc.width - 1 - px, y: doc.height - 1 - py }] : []),
          ]) {
            const key = `${c.x},${c.y}`
            if (!set.has(key)) {
              set.add(key)
              out.push(c)
            }
          }
          return out
        })()
      : [{ x: Math.floor(x), y: Math.floor(y) }]

    for (const c of coords) {
      floodFillLayer(pixels, doc.width, doc.height, c.x, c.y, bytes, tolerance, global)
    }

    return {
      ...doc,
      layers: doc.layers.map((l) => (l.id === layer.id ? { ...l, pixels } : l)),
    }
  })
}

export function sampleColorFromDocument(
  docs: Record<string, PixelDocument>,
  docId: string,
  x: number,
  y: number
): Rgba4 | null {
  const doc = docs[docId]
  if (!doc) return null
  const layer = getActiveLayer(doc)
  if (!layer) return null
  const px = Math.floor(x)
  const py = Math.floor(y)
  if (px < 0 || py < 0 || px >= doc.width || py >= doc.height) return null
  const [r, g, b, a] = getPixel(layer.pixels, doc.width, px, py)
  return [r / 255, g / 255, b / 255, a / 255]
}

export function addPixelLayer(docs: Record<string, PixelDocument>, docId: string): Record<string, PixelDocument> {
  return updatePixelDocument(docs, docId, (doc) => {
    const layer = createEmptyLayer(doc.width, doc.height, `Layer ${doc.layers.length + 1}`)
    return { ...doc, layers: [...doc.layers, layer], activeLayerId: layer.id }
  })
}

export function deletePixelLayer(
  docs: Record<string, PixelDocument>,
  docId: string,
  layerId: string
): Record<string, PixelDocument> {
  return updatePixelDocument(docs, docId, (doc) => {
    if (doc.layers.length <= 1) return doc
    const layers = doc.layers.filter((l) => l.id !== layerId)
    const activeLayerId =
      doc.activeLayerId === layerId ? layers[layers.length - 1].id : doc.activeLayerId
    return { ...doc, layers, activeLayerId }
  })
}

export function duplicatePixelLayer(
  docs: Record<string, PixelDocument>,
  docId: string,
  layerId: string
): Record<string, PixelDocument> {
  return updatePixelDocument(docs, docId, (doc) => {
    const src = doc.layers.find((l) => l.id === layerId)
    if (!src) return doc
    const copy = clonePixelLayer(src)
    copy.id = generateId()
    copy.name = `${src.name} copy`
    const idx = doc.layers.findIndex((l) => l.id === layerId)
    const layers = [...doc.layers]
    layers.splice(idx + 1, 0, copy)
    return { ...doc, layers, activeLayerId: copy.id }
  })
}

export function mergeLayerDown(
  docs: Record<string, PixelDocument>,
  docId: string,
  layerId: string
): Record<string, PixelDocument> {
  return updatePixelDocument(docs, docId, (doc) => {
    const idx = doc.layers.findIndex((l) => l.id === layerId)
    if (idx <= 0) return doc
    const below = clonePixelLayer(doc.layers[idx - 1])
    const top = doc.layers[idx]
    const subDoc: PixelDocument = {
      id: doc.id,
      width: doc.width,
      height: doc.height,
      activeLayerId: below.id,
      layers: [below, top],
    }
    const merged = compositeLayers(subDoc)
    below.pixels = new Uint8ClampedArray(merged)
    below.opacity = 1
    below.blendMode = 'normal'
    const layers = doc.layers.filter((_, i) => i !== idx)
    layers[idx - 1] = below
    return { ...doc, layers, activeLayerId: below.id }
  })
}

export function reorderPixelLayer(
  docs: Record<string, PixelDocument>,
  docId: string,
  layerId: string,
  toIndex: number
): Record<string, PixelDocument> {
  return updatePixelDocument(docs, docId, (doc) => {
    const from = doc.layers.findIndex((l) => l.id === layerId)
    if (from < 0) return doc
    const layers = [...doc.layers]
    const [item] = layers.splice(from, 1)
    layers.splice(Math.max(0, Math.min(toIndex, layers.length)), 0, item)
    return { ...doc, layers }
  })
}

export function patchPixelLayer(
  docs: Record<string, PixelDocument>,
  docId: string,
  layerId: string,
  patch: Partial<Pick<PixelLayer, 'name' | 'visible' | 'opacity' | 'blendMode'>>
): Record<string, PixelDocument> {
  return updatePixelDocument(docs, docId, (doc) => ({
    ...doc,
    layers: doc.layers.map((l) => (l.id === layerId ? { ...l, ...patch } : l)),
  }))
}

export function registerPixelDocument(
  docs: Record<string, PixelDocument>,
  doc: PixelDocument
): Record<string, PixelDocument> {
  const next = { ...docs, [doc.id]: doc }
  syncPixelDocumentGpu(next, doc.id)
  return next
}

export async function importImageAsNewDocument(
  docs: Record<string, PixelDocument>,
  file: File,
  id?: string
): Promise<{ docs: Record<string, PixelDocument>; docId: string }> {
  const imageData = await loadImageFileToImageData(file)
  const docId = id ?? generateId()
  const doc = documentFromImageData(docId, imageData, file.name.replace(/\.[^.]+$/, ''))
  return { docs: registerPixelDocument(docs, doc), docId }
}

export async function importImageAsLayer(
  docs: Record<string, PixelDocument>,
  docId: string,
  file: File
): Promise<Record<string, PixelDocument>> {
  const imageData = await loadImageFileToImageData(file)
  return updatePixelDocument(docs, docId, (doc) => {
    const layer = createEmptyLayer(doc.width, doc.height, file.name.replace(/\.[^.]+$/, ''))
    const canvas = document.createElement('canvas')
    canvas.width = doc.width
    canvas.height = doc.height
    const ctx = canvas.getContext('2d')!
    const src = document.createElement('canvas')
    src.width = imageData.width
    src.height = imageData.height
    src.getContext('2d')!.putImageData(imageData, 0, 0)
    ctx.drawImage(src, 0, 0, doc.width, doc.height)
    layer.pixels = new Uint8ClampedArray(ctx.getImageData(0, 0, doc.width, doc.height).data)
    return { ...doc, layers: [...doc.layers, layer], activeLayerId: layer.id }
  })
}

export function createBlankDocumentForObject(
  docs: Record<string, PixelDocument>,
  objectId: string,
  width = 64,
  height = 64
): { docs: Record<string, PixelDocument>; docId: string } {
  const doc = createPixelDocument(width, height, objectId)
  return { docs: registerPixelDocument(docs, doc), docId: objectId }
}

export { createPixelDocument, documentFromImageData, compositeLayers }
export { clonePixelDocuments } from './pixelDocument'
export { resizePixelDocument } from './pixelDocument'
