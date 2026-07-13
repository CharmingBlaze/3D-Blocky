import type { PixelDocument, PixelSelection } from './pixelTypes'
import { clonePixelLayer, getActiveLayer } from './pixelDocument'
import { getPixel, setPixel } from './pixelTools'
import { updatePixelDocument } from './pixelEditorSlice'

export type PixelClipboard = {
  width: number
  height: number
  pixels: Uint8ClampedArray
}

let pixelClipboard: PixelClipboard | null = null
let pasteOffset = 0

export function getPixelClipboard(): PixelClipboard | null {
  return pixelClipboard
}

export function hasPixelClipboard(): boolean {
  return pixelClipboard != null
}

export function normalizeSelectionRect(sel: PixelSelection): {
  x0: number
  y0: number
  x1: number
  y1: number
  width: number
  height: number
} {
  const x0 = Math.min(sel.x0, sel.x1)
  const y0 = Math.min(sel.y0, sel.y1)
  const x1 = Math.max(sel.x0, sel.x1)
  const y1 = Math.max(sel.y0, sel.y1)
  return {
    x0,
    y0,
    x1,
    y1,
    width: x1 - x0 + 1,
    height: y1 - y0 + 1,
  }
}

/** Copy active-layer pixels inside the selection into the clipboard. */
export function copySelectionToClipboard(
  doc: PixelDocument,
  selection: PixelSelection
): boolean {
  const layer = getActiveLayer(doc)
  if (!layer) return false
  const { x0, y0, width, height } = normalizeSelectionRect(selection)
  const pixels = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = getPixel(layer.pixels, doc.width, x0 + x, y0 + y)
      const i = (y * width + x) * 4
      pixels[i] = r
      pixels[i + 1] = g
      pixels[i + 2] = b
      pixels[i + 3] = a
    }
  }
  pixelClipboard = { width, height, pixels }
  pasteOffset = 0
  return true
}

/** Clear (transparent) pixels inside the selection on the active layer. */
export function clearSelectionOnDocument(
  docs: Record<string, PixelDocument>,
  docId: string,
  selection: PixelSelection
): Record<string, PixelDocument> {
  return updatePixelDocument(docs, docId, (doc) => {
    const layer = getActiveLayer(doc)
    if (!layer) return doc
    const { x0, y0, x1, y1 } = normalizeSelectionRect(selection)
    const pixels = clonePixelLayer(layer).pixels
    const clear: [number, number, number, number] = [0, 0, 0, 0]
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        setPixel(pixels, doc.width, doc.height, x, y, clear)
      }
    }
    return {
      ...doc,
      layers: doc.layers.map((l) => (l.id === layer.id ? { ...l, pixels } : l)),
    }
  })
}

/**
 * Paste clipboard onto the active layer.
 * Places at selection top-left if present, otherwise with a slight nudge each paste.
 * Returns the pasted bounds for a new selection, or null if nothing to paste.
 */
export function pasteClipboardOnDocument(
  docs: Record<string, PixelDocument>,
  docId: string,
  selection: PixelSelection | null
): { docs: Record<string, PixelDocument>; pasted: PixelSelection } | null {
  const clip = pixelClipboard
  if (!clip) return null
  const doc = docs[docId]
  if (!doc) return null

  let destX = 0
  let destY = 0
  if (selection) {
    const r = normalizeSelectionRect(selection)
    destX = r.x0
    destY = r.y0
  } else {
    destX = Math.min(doc.width - 1, pasteOffset)
    destY = Math.min(doc.height - 1, pasteOffset)
    pasteOffset = (pasteOffset + 8) % Math.max(8, Math.min(doc.width, doc.height))
  }

  const nextDocs = updatePixelDocument(docs, docId, (d) => {
    const layer = getActiveLayer(d)
    if (!layer) return d
    const pixels = clonePixelLayer(layer).pixels
    for (let y = 0; y < clip.height; y++) {
      for (let x = 0; x < clip.width; x++) {
        const dx = destX + x
        const dy = destY + y
        if (dx < 0 || dy < 0 || dx >= d.width || dy >= d.height) continue
        const i = (y * clip.width + x) * 4
        const sa = clip.pixels[i + 3]!
        if (sa === 0) continue
        // Source-over blend for semi-transparent clipboard pixels
        const sr = clip.pixels[i]!
        const sg = clip.pixels[i + 1]!
        const sb = clip.pixels[i + 2]!
        if (sa === 255) {
          setPixel(pixels, d.width, d.height, dx, dy, [sr, sg, sb, sa])
        } else {
          const [dr, dg, db, da] = getPixel(pixels, d.width, dx, dy)
          const saN = sa / 255
          const daN = da / 255
          const outA = saN + daN * (1 - saN)
          if (outA <= 1e-6) {
            setPixel(pixels, d.width, d.height, dx, dy, [0, 0, 0, 0])
          } else {
            setPixel(pixels, d.width, d.height, dx, dy, [
              Math.round((sr * saN + dr * daN * (1 - saN)) / outA),
              Math.round((sg * saN + dg * daN * (1 - saN)) / outA),
              Math.round((sb * saN + db * daN * (1 - saN)) / outA),
              Math.round(outA * 255),
            ])
          }
        }
      }
    }
    return {
      ...d,
      layers: d.layers.map((l) => (l.id === layer.id ? { ...l, pixels } : l)),
    }
  })

  const pasted: PixelSelection = {
    kind: 'rect',
    x0: destX,
    y0: destY,
    x1: Math.min(doc.width - 1, destX + clip.width - 1),
    y1: Math.min(doc.height - 1, destY + clip.height - 1),
  }
  return { docs: nextDocs, pasted }
}

/** Cut = copy then clear. */
export function cutSelectionOnDocument(
  docs: Record<string, PixelDocument>,
  docId: string,
  selection: PixelSelection
): Record<string, PixelDocument> | null {
  const doc = docs[docId]
  if (!doc) return null
  if (!copySelectionToClipboard(doc, selection)) return null
  return clearSelectionOnDocument(docs, docId, selection)
}
