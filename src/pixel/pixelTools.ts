import type { Rgba4 } from '../material/materialTypes'

export interface PixelStrokePoint {
  x: number
  y: number
}

function idx(x: number, y: number, width: number): number {
  return (y * width + x) * 4
}

function inBounds(x: number, y: number, width: number, height: number): boolean {
  return x >= 0 && y >= 0 && x < width && y < height
}

export function rgbaToBytes([r, g, b, a]: Rgba4): [number, number, number, number] {
  return [
    Math.round(r * 255),
    Math.round(g * 255),
    Math.round(b * 255),
    Math.round(a * 255),
  ]
}

export function bytesToRgba4(pixels: Uint8ClampedArray, i: number): Rgba4 {
  return [pixels[i] / 255, pixels[i + 1] / 255, pixels[i + 2] / 255, pixels[i + 3] / 255]
}

export function setPixel(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  color: [number, number, number, number]
): void {
  if (!inBounds(x, y, width, height)) return
  const i = idx(x, y, width)
  pixels[i] = color[0]
  pixels[i + 1] = color[1]
  pixels[i + 2] = color[2]
  pixels[i + 3] = color[3]
}

export function getPixel(
  pixels: Uint8ClampedArray,
  width: number,
  x: number,
  y: number
): [number, number, number, number] {
  const i = idx(x, y, width)
  return [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]]
}

const brushOffsetCache = new Map<string, { dx: number; dy: number }[]>()

function brushOffsets(size: number, round: boolean): { dx: number; dy: number }[] {
  const key = `${Math.max(1, Math.floor(size))}:${round ? 1 : 0}`
  const cached = brushOffsetCache.get(key)
  if (cached) return cached
  const r = Math.max(0, Math.floor(size / 2))
  const out: { dx: number; dy: number }[] = []
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (round && dx * dx + dy * dy > r * r + 0.25) continue
      out.push({ dx, dy })
    }
  }
  brushOffsetCache.set(key, out)
  return out
}

export function paintBrush(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  cx: number,
  cy: number,
  size: number,
  color: [number, number, number, number],
  round = true
): void {
  const [cr, cg, cb, ca] = color
  for (const { dx, dy } of brushOffsets(size, round)) {
    const x = cx + dx
    const y = cy + dy
    if (!inBounds(x, y, width, height)) continue
    const i = idx(x, y, width)
    pixels[i] = cr
    pixels[i + 1] = cg
    pixels[i + 2] = cb
    pixels[i + 3] = ca
  }
}

/** Remove redundant elbow pixels on diagonal freehand strokes. */
export function pixelPerfectFilter(points: PixelStrokePoint[]): PixelStrokePoint[] {
  if (points.length < 3) return points
  const out: PixelStrokePoint[] = [points[0]]
  for (let i = 1; i < points.length - 1; i++) {
    const prev = out[out.length - 1]
    const curr = points[i]
    const next = points[i + 1]
    const dx1 = curr.x - prev.x
    const dy1 = curr.y - prev.y
    const dx2 = next.x - curr.x
    const dy2 = next.y - curr.y
    if (
      Math.sign(dx1) === Math.sign(dx2) &&
      Math.sign(dy1) === Math.sign(dy2) &&
      Math.abs(dx1) === Math.abs(dy1) &&
      Math.abs(dx2) === Math.abs(dy2) &&
      Math.abs(dx1) === 1
    ) {
      continue
    }
    out.push(curr)
  }
  out.push(points[points.length - 1])
  return out
}

export function bresenhamLine(
  x0: number,
  y0: number,
  x1: number,
  y1: number
): PixelStrokePoint[] {
  const points: PixelStrokePoint[] = []
  let x = x0
  let y = y0
  const dx = Math.abs(x1 - x0)
  const dy = Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let err = dx - dy
  while (true) {
    points.push({ x, y })
    if (x === x1 && y === y1) break
    const e2 = err * 2
    if (e2 > -dy) {
      err -= dy
      x += sx
    }
    if (e2 < dx) {
      err += dx
      y += sy
    }
  }
  return points
}

export function drawStrokeOnLayer(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  points: PixelStrokePoint[],
  size: number,
  color: [number, number, number, number],
  pixelPerfect: boolean,
  round = true
): void {
  const filtered = pixelPerfect ? pixelPerfectFilter(points) : points
  if (filtered.length === 0) return
  if (filtered.length === 1) {
    paintBrush(pixels, width, height, filtered[0]!.x, filtered[0]!.y, size, color, round)
    return
  }
  // Large hard brushes: stamp with spacing so we do not redo O(size²) work every texel.
  const stampStep = size <= 1 ? 1 : Math.max(1, Math.floor(size * 0.35))
  for (let i = 1; i < filtered.length; i++) {
    const seg = bresenhamLine(filtered[i - 1]!.x, filtered[i - 1]!.y, filtered[i]!.x, filtered[i]!.y)
    for (let si = 0; si < seg.length; si++) {
      if (si !== 0 && si !== seg.length - 1 && si % stampStep !== 0) continue
      const p = seg[si]!
      paintBrush(pixels, width, height, p.x, p.y, size, color, round)
    }
  }
}

export function drawLineOnLayer(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  size: number,
  color: [number, number, number, number],
  round = true
): void {
  const pts = bresenhamLine(x0, y0, x1, y1)
  for (const p of pts) paintBrush(pixels, width, height, p.x, p.y, size, color, round)
}

function iterRect(x0: number, y0: number, x1: number, y1: number, filled: boolean): PixelStrokePoint[] {
  const minX = Math.min(x0, x1)
  const maxX = Math.max(x0, x1)
  const minY = Math.min(y0, y1)
  const maxY = Math.max(y0, y1)
  const pts: PixelStrokePoint[] = []
  if (filled) {
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) pts.push({ x, y })
    }
    return pts
  }
  for (let x = minX; x <= maxX; x++) {
    pts.push({ x, y: minY }, { x, y: maxY })
  }
  for (let y = minY + 1; y < maxY; y++) {
    pts.push({ x: minX, y }, { x: maxX, y })
  }
  return pts
}

export function drawRectOnLayer(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  size: number,
  color: [number, number, number, number],
  filled: boolean,
  round = true
): void {
  for (const p of iterRect(x0, y0, x1, y1, filled)) {
    paintBrush(pixels, width, height, p.x, p.y, size, color, round)
  }
}

function iterEllipse(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  filled: boolean
): PixelStrokePoint[] {
  const pts: PixelStrokePoint[] = []
  const rxi = Math.max(0, Math.round(rx))
  const ryi = Math.max(0, Math.round(ry))
  if (rxi === 0 && ryi === 0) return [{ x: cx, y: cy }]
  for (let y = -ryi; y <= ryi; y++) {
    for (let x = -rxi; x <= rxi; x++) {
      const norm = (x * x) / (rxi * rxi + 1e-6) + (y * y) / (ryi * ryi + 1e-6)
      if (filled) {
        if (norm <= 1.05) pts.push({ x: cx + x, y: cy + y })
      } else if (Math.abs(norm - 1) < 0.15 + 1 / Math.max(rxi, ryi, 1)) {
        pts.push({ x: cx + x, y: cy + y })
      }
    }
  }
  return pts
}

export function drawEllipseOnLayer(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  size: number,
  color: [number, number, number, number],
  filled: boolean,
  round = true
): void {
  const cx = Math.round((x0 + x1) / 2)
  const cy = Math.round((y0 + y1) / 2)
  const rx = Math.abs(x1 - x0) / 2
  const ry = Math.abs(y1 - y0) / 2
  for (const p of iterEllipse(cx, cy, rx, ry, filled)) {
    paintBrush(pixels, width, height, p.x, p.y, size, color, round)
  }
}

function colorDist(a: [number, number, number, number], b: [number, number, number, number]): number {
  return (
    Math.abs(a[0] - b[0]) +
    Math.abs(a[1] - b[1]) +
    Math.abs(a[2] - b[2]) +
    Math.abs(a[3] - b[3])
  )
}

export function floodFillLayer(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  sx: number,
  sy: number,
  fillColor: [number, number, number, number],
  tolerance: number,
  global: boolean
): void {
  if (!inBounds(sx, sy, width, height)) return
  const start = getPixel(pixels, width, sx, sy)
  if (colorDist(start, fillColor) === 0) return

  const match = (x: number, y: number) =>
    colorDist(getPixel(pixels, width, x, y), start) <= tolerance

  if (global) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (match(x, y)) setPixel(pixels, width, height, x, y, fillColor)
      }
    }
    return
  }

  const stack: [number, number][] = [[sx, sy]]
  const visited = new Uint8Array(width * height)
  while (stack.length > 0) {
    const [x, y] = stack.pop()!
    const vi = y * width + x
    if (visited[vi]) continue
    if (!match(x, y)) continue
    visited[vi] = 1
    setPixel(pixels, width, height, x, y, fillColor)
    if (x > 0) stack.push([x - 1, y])
    if (x < width - 1) stack.push([x + 1, y])
    if (y > 0) stack.push([x, y - 1])
    if (y < height - 1) stack.push([x, y + 1])
  }
}

/** Mirror pixel coords across canvas center axes (top-left origin). */
export function mirrorPixelCoords(
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

export function paintWithSymmetry(
  pixels: Uint8ClampedArray,
  docW: number,
  docH: number,
  x: number,
  y: number,
  size: number,
  color: [number, number, number, number],
  symH: boolean,
  symV: boolean,
  round = true
): void {
  for (const c of mirrorPixelCoords(x, y, docW, docH, symH, symV)) {
    paintBrush(pixels, docW, docH, c.x, c.y, size, color, round)
  }
}

export function drawStrokeWithSymmetry(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  points: PixelStrokePoint[],
  size: number,
  color: [number, number, number, number],
  pixelPerfect: boolean,
  symH: boolean,
  symV: boolean,
  round = true
): void {
  if (!symH && !symV) {
    drawStrokeOnLayer(pixels, width, height, points, size, color, pixelPerfect, round)
    return
  }
  const filtered = pixelPerfect ? pixelPerfectFilter(points) : points
  if (filtered.length === 0) return
  if (filtered.length === 1) {
    paintWithSymmetry(pixels, width, height, filtered[0]!.x, filtered[0]!.y, size, color, symH, symV, round)
    return
  }
  const stampStep = size <= 1 ? 1 : Math.max(1, Math.floor(size * 0.35))
  for (let i = 1; i < filtered.length; i++) {
    const seg = bresenhamLine(filtered[i - 1]!.x, filtered[i - 1]!.y, filtered[i]!.x, filtered[i]!.y)
    for (let si = 0; si < seg.length; si++) {
      if (si !== 0 && si !== seg.length - 1 && si % stampStep !== 0) continue
      const p = seg[si]!
      paintWithSymmetry(pixels, width, height, p.x, p.y, size, color, symH, symV, round)
    }
  }
}

export function exportCompositeToPngBlob(composite: Uint8ClampedArray, width: number, height: number): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  ctx.putImageData(new ImageData(new Uint8ClampedArray(composite), width, height), 0, 0)
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Export failed'))), 'image/png')
  })
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
