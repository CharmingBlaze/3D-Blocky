/** Inclusive-exclusive axis-aligned dirty region in document pixels. */
export type PixelDirtyRect = {
  x: number
  y: number
  w: number
  h: number
}

export function clampDirtyRect(
  rect: PixelDirtyRect,
  width: number,
  height: number
): PixelDirtyRect | null {
  if (width <= 0 || height <= 0 || rect.w <= 0 || rect.h <= 0) return null
  const x0 = Math.max(0, Math.floor(rect.x))
  const y0 = Math.max(0, Math.floor(rect.y))
  const x1 = Math.min(width, Math.ceil(rect.x + rect.w))
  const y1 = Math.min(height, Math.ceil(rect.y + rect.h))
  if (x1 <= x0 || y1 <= y0) return null
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

export function unionDirtyRects(
  a: PixelDirtyRect | null | undefined,
  b: PixelDirtyRect | null | undefined
): PixelDirtyRect | null {
  if (!a) return b ?? null
  if (!b) return a
  const x0 = Math.min(a.x, b.x)
  const y0 = Math.min(a.y, b.y)
  const x1 = Math.max(a.x + a.w, b.x + b.w)
  const y1 = Math.max(a.y + a.h, b.y + b.h)
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** Brush stamp bounds around an integer pixel center (hard tip). */
export function hardBrushDirtyRect(
  cx: number,
  cy: number,
  brushSize: number,
  width: number,
  height: number
): PixelDirtyRect | null {
  const size = Math.max(1, Math.floor(brushSize))
  const r = Math.ceil(size / 2)
  return clampDirtyRect(
    { x: cx - r - 1, y: cy - r - 1, w: size + 3, h: size + 3 },
    width,
    height
  )
}

/** Soft dab bounds around a floating-point center. */
export function softBrushDirtyRect(
  cx: number,
  cy: number,
  brushSize: number,
  width: number,
  height: number
): PixelDirtyRect | null {
  const diameter = Math.max(1, brushSize)
  const radius = diameter / 2
  return clampDirtyRect(
    {
      x: cx - radius - 1,
      y: cy - radius - 1,
      w: diameter + 3,
      h: diameter + 3,
    },
    width,
    height
  )
}

/** Expand stroke points + optional axis mirrors into one dirty rect. */
export function strokePointsDirtyRect(
  points: readonly { x: number; y: number }[],
  brushSize: number,
  width: number,
  height: number,
  symH: boolean,
  symV: boolean,
  soft: boolean
): PixelDirtyRect | null {
  if (points.length === 0) return null
  let dirty: PixelDirtyRect | null = null
  const pad = soft
    ? Math.ceil(Math.max(1, brushSize) / 2) + 2
    : Math.ceil(Math.max(1, Math.floor(brushSize)) / 2) + 2

  const include = (px: number, py: number) => {
    dirty = unionDirtyRects(
      dirty,
      clampDirtyRect(
        { x: px - pad, y: py - pad, w: pad * 2 + 1, h: pad * 2 + 1 },
        width,
        height
      )
    )
  }

  for (const p of points) {
    include(p.x, p.y)
    if (symH) include(width - 1 - p.x, p.y)
    if (symV) include(p.x, height - 1 - p.y)
    if (symH && symV) include(width - 1 - p.x, height - 1 - p.y)
  }
  return dirty
}

/** Copy one row-span rectangle between same-sized RGBA buffers. */
export function copyRgbaRect(
  dst: Uint8ClampedArray | Uint8Array,
  src: Uint8ClampedArray | Uint8Array,
  width: number,
  rect: PixelDirtyRect
): void {
  const rowBytes = rect.w * 4
  for (let y = 0; y < rect.h; y++) {
    const start = ((rect.y + y) * width + rect.x) * 4
    dst.set(src.subarray(start, start + rowBytes), start)
  }
}

/** Zero one rectangle in an RGBA buffer. */
export function clearRgbaRect(
  dst: Uint8ClampedArray | Uint8Array,
  width: number,
  rect: PixelDirtyRect
): void {
  const rowBytes = rect.w * 4
  for (let y = 0; y < rect.h; y++) {
    const start = ((rect.y + y) * width + rect.x) * 4
    dst.fill(0, start, start + rowBytes)
  }
}
