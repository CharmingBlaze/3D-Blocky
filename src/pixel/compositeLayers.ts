import type { PixelBlendMode, PixelDocument, PixelLayer } from './pixelTypes'

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

/** Flatten all visible layers top-down into RGBA pixels (top-left origin). */
export function compositeLayers(doc: PixelDocument): Uint8ClampedArray {
  const { width, height, layers } = doc
  const out = new Uint8ClampedArray(width * height * 4)
  for (const layer of layers) {
    if (!layer.visible) continue
    blendLayer(out, layer, width, height)
  }
  return out
}
