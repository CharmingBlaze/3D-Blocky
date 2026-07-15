import type { PixelBlendMode, PixelDocument, PixelLayer } from './pixelTypes'
import {
  clearRgbaRect,
  copyRgbaRect,
  type PixelDirtyRect,
} from './pixelDirtyRect'

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

function blendChannel(
  dst: number,
  src: number,
  mode: PixelBlendMode,
  opacity: number
): number {
  const s = (src / 255) * opacity
  const d = dst / 255
  let out: number
  switch (mode) {
    case 'multiply':
      out = d * s + d * (1 - s)
      break
    case 'add':
      out = Math.min(1, d + s)
      break
    case 'screen':
      out = 1 - (1 - d) * (1 - s)
      break
    case 'normal':
    default:
      out = s + d * (1 - s)
      break
  }
  return Math.round(clamp01(out) * 255)
}

function compositePixel(
  dst: Uint8ClampedArray,
  di: number,
  src: Uint8ClampedArray,
  si: number,
  mode: PixelBlendMode,
  layerOpacity: number
): void {
  const sr = src[si]
  const sg = src[si + 1]
  const sb = src[si + 2]
  const sa = (src[si + 3] / 255) * layerOpacity
  if (sa <= 0) return

  const dr = dst[di]
  const dg = dst[di + 1]
  const db = dst[di + 2]
  const da = dst[di + 3] / 255

  if (mode === 'normal') {
    const inv = 1 - sa
    dst[di] = Math.round(sr * sa + dr * inv)
    dst[di + 1] = Math.round(sg * sa + dg * inv)
    dst[di + 2] = Math.round(sb * sa + db * inv)
    dst[di + 3] = Math.round((sa + da * inv) * 255)
    return
  }

  const alpha = clamp01(sa + da * (1 - sa))
  if (alpha <= 0) {
    dst[di + 3] = 0
    return
  }
  dst[di] = blendChannel(dr, sr, mode, 1)
  dst[di + 1] = blendChannel(dg, sg, mode, 1)
  dst[di + 2] = blendChannel(db, sb, mode, 1)
  dst[di + 3] = Math.round(alpha * 255)
}

function blendLayer(
  dst: Uint8ClampedArray,
  layer: PixelLayer,
  width: number,
  height: number
): void {
  const { pixels, blendMode, opacity } = layer
  if (opacity <= 0) return
  const len = width * height * 4
  for (let i = 0; i < len; i += 4) {
    if (pixels[i + 3] === 0) continue
    compositePixel(dst, i, pixels, i, blendMode, opacity)
  }
}

function blendLayerRegion(
  dst: Uint8ClampedArray,
  layer: PixelLayer,
  width: number,
  rect: PixelDirtyRect
): void {
  const { pixels, blendMode, opacity } = layer
  if (opacity <= 0) return
  const x1 = rect.x + rect.w
  const y1 = rect.y + rect.h
  for (let y = rect.y; y < y1; y++) {
    for (let x = rect.x; x < x1; x++) {
      const i = (y * width + x) * 4
      if (pixels[i + 3] === 0) continue
      compositePixel(dst, i, pixels, i, blendMode, opacity)
    }
  }
}

function visibleLayers(doc: PixelDocument): PixelLayer[] {
  return doc.layers.filter((l) => l.visible && l.opacity > 0)
}

type UnderLayerEntry = {
  activeLayerId: string
  width: number
  height: number
  pixels: Uint8ClampedArray
}

const underLayerCache = new Map<string, UnderLayerEntry>()

export function invalidateUnderLayerCache(docId: string): void {
  underLayerCache.delete(docId)
}

/** Composite all visible layers except the active one (stable during live strokes). */
function getUnderActiveComposite(doc: PixelDocument): Uint8ClampedArray | null {
  const visible = visibleLayers(doc)
  if (visible.length <= 1) return null
  const activeId = doc.activeLayerId
  const cached = underLayerCache.get(doc.id)
  if (
    cached &&
    cached.activeLayerId === activeId &&
    cached.width === doc.width &&
    cached.height === doc.height
  ) {
    return cached.pixels
  }

  const belowActive = visible.filter((l) => l.id !== activeId)
  if (belowActive.length === 0) return null

  const len = doc.width * doc.height * 4
  const buf = new Uint8ClampedArray(len)
  const subDoc: PixelDocument = { ...doc, layers: belowActive }
  compositeLayers(subDoc, buf)
  underLayerCache.set(doc.id, {
    activeLayerId: activeId,
    width: doc.width,
    height: doc.height,
    pixels: buf,
  })
  return buf
}

function isSingleOpaqueNormal(visible: PixelLayer[]): boolean {
  return (
    visible.length === 1 &&
    visible[0]!.blendMode === 'normal' &&
    visible[0]!.opacity >= 1 - 1e-6
  )
}

/** Flatten all visible layers top-down into RGBA pixels (top-left origin). */
export function compositeLayers(
  doc: PixelDocument,
  outBuffer?: Uint8ClampedArray
): Uint8ClampedArray {
  const { width, height } = doc
  const len = width * height * 4
  const visible = visibleLayers(doc)
  // Fast path: single full-opacity normal layer — copy (or alias via outBuffer).
  if (isSingleOpaqueNormal(visible)) {
    const src = visible[0]!.pixels
    if (outBuffer && outBuffer.length === len) {
      outBuffer.set(src)
      return outBuffer
    }
    return new Uint8ClampedArray(src)
  }

  const out =
    outBuffer && outBuffer.length === len ? outBuffer : new Uint8ClampedArray(len)
  if (outBuffer && outBuffer.length === len) out.fill(0)
  for (const layer of visible) {
    blendLayer(out, layer, width, height)
  }
  return out
}

/**
 * Flatten only a dirty rectangle into an existing composite buffer.
 * Caller must provide a sized `outBuffer` (typically the shared composite cache).
 */
export function compositeLayersRegion(
  doc: PixelDocument,
  outBuffer: Uint8ClampedArray,
  rect: PixelDirtyRect
): void {
  const { width, height } = doc
  const len = width * height * 4
  if (outBuffer.length !== len || rect.w <= 0 || rect.h <= 0) return

  const visible = visibleLayers(doc)
  if (isSingleOpaqueNormal(visible)) {
    copyRgbaRect(outBuffer, visible[0]!.pixels, width, rect)
    return
  }

  clearRgbaRect(outBuffer, width, rect)
  for (const layer of visible) {
    blendLayerRegion(outBuffer, layer, width, rect)
  }
}

/**
 * Fast dirty-rect composite during live strokes on multi-layer docs:
 * reuses a cached "all layers except active" flatten, then blends only the active layer.
 */
export function compositeLayersRegionFast(
  doc: PixelDocument,
  outBuffer: Uint8ClampedArray,
  rect: PixelDirtyRect
): void {
  const { width, height } = doc
  const len = width * height * 4
  if (outBuffer.length !== len || rect.w <= 0 || rect.h <= 0) return

  const visible = visibleLayers(doc)
  if (isSingleOpaqueNormal(visible)) {
    copyRgbaRect(outBuffer, visible[0]!.pixels, width, rect)
    return
  }

  const active = visible.find((l) => l.id === doc.activeLayerId)
  const under = getUnderActiveComposite(doc)
  if (under && active) {
    copyRgbaRect(outBuffer, under, width, rect)
    blendLayerRegion(outBuffer, active, width, rect)
    return
  }

  compositeLayersRegion(doc, outBuffer, rect)
}
