/**
 * Adobe-style soft paint brush: hardness falloff, opacity/flow, spaced dabs, alpha blend.
 * Used by the Pixel Editor "Paint Brush" tool (not the hard Pencil).
 */

export type SoftBrushParams = {
  /** Brush diameter in pixels (min 1). */
  size: number
  /** 0 = fully soft edge, 1 = hard edge. */
  hardness: number
  /** 0–1 overall stroke opacity. */
  opacity: number
  /** 0–1 paint deposited per dab (accumulates under opacity). */
  flow: number
  /** Tip shape. */
  shape: 'round' | 'square'
  /** Spacing as a fraction of diameter (Photoshop default ~0.15–0.25). */
  spacing?: number
}

export type SoftBrushColor = [number, number, number, number]

type StrokeState = {
  x: number
  y: number
  carry: number
}

type StampMask = {
  /** Half-extent in pixels from dab center (bbox is 2*extent+1). */
  extent: number
  /** Row-major coverage, length (2*extent+1)^2. */
  coverage: Float32Array
}

let strokeState: StrokeState | null = null

/** Reused stamp masks keyed by size/hardness/shape/subpixel quadrant. */
const stampMaskCache = new Map<string, StampMask>()
const STAMP_CACHE_MAX = 64

export function resetSoftBrushStroke(): void {
  strokeState = null
}

/** Test helper — drop cached stamp masks. */
export function clearSoftBrushStampCache(): void {
  stampMaskCache.clear()
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 <= edge0) return x >= edge1 ? 1 : 0
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

/** Coverage at offset (dx, dy) from brush center for a given radius/hardness/shape. */
export function softBrushCoverage(
  dx: number,
  dy: number,
  radius: number,
  hardness: number,
  shape: 'round' | 'square'
): number {
  if (radius <= 0.5) {
    // Sub-pixel / 1px tip — treat as a soft single sample.
    const d = shape === 'square' ? Math.max(Math.abs(dx), Math.abs(dy)) : Math.hypot(dx, dy)
    return d <= 0.55 ? 1 : 0
  }
  const hard = clamp01(hardness)
  if (shape === 'square') {
    const ax = Math.abs(dx) / radius
    const ay = Math.abs(dy) / radius
    const t = Math.max(ax, ay)
    if (t >= 1) return 0
    if (t <= hard) return 1
    return 1 - smoothstep(hard, 1, t)
  }
  const distSq = dx * dx + dy * dy
  const radiusSq = radius * radius
  if (distSq >= radiusSq) return 0
  const hardR = radius * hard
  if (distSq <= hardR * hardR) return 1
  const t = Math.sqrt(distSq) / radius
  return 1 - smoothstep(hard, 1, t)
}

function blendSourceOver(
  pixels: Uint8ClampedArray,
  i: number,
  sr: number,
  sg: number,
  sb: number,
  sa: number
): void {
  if (sa <= 0) return
  const dr = pixels[i]!
  const dg = pixels[i + 1]!
  const db = pixels[i + 2]!
  const da = pixels[i + 3]! / 255
  const saN = sa / 255
  const outA = saN + da * (1 - saN)
  if (outA <= 1e-6) {
    pixels[i] = 0
    pixels[i + 1] = 0
    pixels[i + 2] = 0
    pixels[i + 3] = 0
    return
  }
  pixels[i] = Math.round((sr * saN + dr * da * (1 - saN)) / outA)
  pixels[i + 1] = Math.round((sg * saN + dg * da * (1 - saN)) / outA)
  pixels[i + 2] = Math.round((sb * saN + db * da * (1 - saN)) / outA)
  pixels[i + 3] = Math.round(outA * 255)
}

function eraseWithCoverage(
  pixels: Uint8ClampedArray,
  i: number,
  coverage: number
): void {
  if (coverage <= 0) return
  const keep = 1 - clamp01(coverage)
  pixels[i + 3] = Math.round(pixels[i + 3]! * keep)
  if (pixels[i + 3]! === 0) {
    pixels[i] = 0
    pixels[i + 1] = 0
    pixels[i + 2] = 0
  }
}

function stampCacheKey(
  diameter: number,
  hardness: number,
  shape: 'round' | 'square',
  fracX: number,
  fracY: number
): string {
  // Quantize size/hardness and dab subpixel so stamps reuse across a stroke.
  const sizeQ = Math.round(diameter * 4)
  const hardQ = Math.round(clamp01(hardness) * 50)
  const fx = Math.round(fracX * 4)
  const fy = Math.round(fracY * 4)
  return `${sizeQ}:${hardQ}:${shape}:${fx}:${fy}`
}

function getStampMask(
  diameter: number,
  hardness: number,
  shape: 'round' | 'square',
  fracX: number,
  fracY: number
): StampMask {
  const qFracX = Math.round(fracX * 4) / 4
  const qFracY = Math.round(fracY * 4) / 4
  const key = stampCacheKey(diameter, hardness, shape, qFracX, qFracY)
  const cached = stampMaskCache.get(key)
  if (cached) return cached

  const radius = diameter / 2
  const extent = Math.max(1, Math.ceil(radius + 1))
  const side = extent * 2 + 1
  const coverage = new Float32Array(side * side)
  // Stamp assumes dab center at (qFracX, qFracY) within its pixel; samples at pixel centers.
  for (let oy = -extent; oy <= extent; oy++) {
    for (let ox = -extent; ox <= extent; ox++) {
      const dx = ox + 0.5 - qFracX
      const dy = oy + 0.5 - qFracY
      coverage[(oy + extent) * side + (ox + extent)] = softBrushCoverage(
        dx,
        dy,
        radius,
        hardness,
        shape
      )
    }
  }

  const mask: StampMask = { extent, coverage }
  if (stampMaskCache.size >= STAMP_CACHE_MAX) {
    const first = stampMaskCache.keys().next().value
    if (first !== undefined) stampMaskCache.delete(first)
  }
  stampMaskCache.set(key, mask)
  return mask
}

/** Stamp one soft dab at a floating-point center. */
export function paintSoftBrushDab(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  cx: number,
  cy: number,
  color: SoftBrushColor,
  params: SoftBrushParams,
  erase = false
): void {
  const diameter = Math.max(1, params.size)
  const opacity = clamp01(params.opacity)
  const flow = clamp01(params.flow)
  const strength = opacity * flow
  if (strength <= 0) return

  const baseX = Math.floor(cx)
  const baseY = Math.floor(cy)
  const fracX = cx - baseX
  const fracY = cy - baseY
  const mask = getStampMask(diameter, params.hardness, params.shape, fracX, fracY)
  const { extent, coverage } = mask
  const side = extent * 2 + 1

  const minX = Math.max(0, baseX - extent)
  const maxX = Math.min(width - 1, baseX + extent)
  const minY = Math.max(0, baseY - extent)
  const maxY = Math.min(height - 1, baseY + extent)

  for (let y = minY; y <= maxY; y++) {
    const my = y - baseY + extent
    const row = my * side
    for (let x = minX; x <= maxX; x++) {
      const cov = coverage[row + (x - baseX + extent)]!
      if (cov <= 0) continue
      const i = (y * width + x) * 4
      if (erase) {
        eraseWithCoverage(pixels, i, cov * strength)
      } else {
        blendSourceOver(
          pixels,
          i,
          color[0],
          color[1],
          color[2],
          color[3] * cov * strength
        )
      }
    }
  }
}

function dabSpacingPx(params: SoftBrushParams): number {
  const diameter = Math.max(1, params.size)
  const frac = params.spacing ?? 0.18
  return Math.max(0.35, diameter * frac)
}

/**
 * Begin a new continuous soft stroke (always stamps the first dab).
 * Call again after pointer-up / commit.
 */
export function beginSoftBrushStroke(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  color: SoftBrushColor,
  params: SoftBrushParams,
  erase = false,
  stampMirrors?: (x: number, y: number) => void
): void {
  strokeState = { x, y, carry: 0 }
  const stamp = (px: number, py: number) => {
    paintSoftBrushDab(pixels, width, height, px, py, color, params, erase)
    stampMirrors?.(px, py)
  }
  stamp(x, y)
}

/** Continue an active soft stroke to a new point with Adobe-like spacing. */
export function continueSoftBrushStroke(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  color: SoftBrushColor,
  params: SoftBrushParams,
  erase = false,
  stampMirrors?: (x: number, y: number) => void
): void {
  if (!strokeState) {
    beginSoftBrushStroke(pixels, width, height, x, y, color, params, erase, stampMirrors)
    return
  }

  const spacing = dabSpacingPx(params)
  const stamp = (px: number, py: number) => {
    paintSoftBrushDab(pixels, width, height, px, py, color, params, erase)
    stampMirrors?.(px, py)
  }

  let lx = strokeState.x
  let ly = strokeState.y
  let carry = strokeState.carry
  const dx = x - lx
  const dy = y - ly
  const dist = Math.hypot(dx, dy)
  if (dist < 1e-6) return

  const nx = dx / dist
  const ny = dy / dist
  let traveled = 0

  while (carry + (dist - traveled) >= spacing - 1e-6) {
    const need = spacing - carry
    traveled += need
    const px = lx + nx * traveled
    const py = ly + ny * traveled
    stamp(px, py)
    carry = 0
  }

  carry += dist - traveled
  strokeState = { x, y, carry }
}

/** Paint a polyline with soft brush spacing (resets stroke state). */
export function paintSoftBrushPolyline(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  points: readonly { x: number; y: number }[],
  color: SoftBrushColor,
  params: SoftBrushParams,
  erase = false,
  stampMirrors?: (x: number, y: number) => void
): void {
  if (points.length === 0) return
  resetSoftBrushStroke()
  const first = points[0]!
  beginSoftBrushStroke(pixels, width, height, first.x, first.y, color, params, erase, stampMirrors)
  for (let i = 1; i < points.length; i++) {
    const p = points[i]!
    continueSoftBrushStroke(pixels, width, height, p.x, p.y, color, params, erase, stampMirrors)
  }
}
