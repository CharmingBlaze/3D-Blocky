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

let strokeState: StrokeState | null = null

export function resetSoftBrushStroke(): void {
  strokeState = null
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
  const t = Math.hypot(dx, dy) / radius
  if (t >= 1) return 0
  if (t <= hard) return 1
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
  const radius = diameter / 2
  const hardness = clamp01(params.hardness)
  const opacity = clamp01(params.opacity)
  const flow = clamp01(params.flow)
  const strength = opacity * flow
  if (strength <= 0) return

  const minX = Math.max(0, Math.floor(cx - radius - 1))
  const maxX = Math.min(width - 1, Math.ceil(cx + radius + 1))
  const minY = Math.max(0, Math.floor(cy - radius - 1))
  const maxY = Math.min(height - 1, Math.ceil(cy + radius + 1))

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      // Sample at pixel center for smoother AA.
      const coverage = softBrushCoverage(
        x + 0.5 - cx,
        y + 0.5 - cy,
        radius,
        hardness,
        params.shape
      )
      if (coverage <= 0) continue
      const i = (y * width + x) * 4
      if (erase) {
        eraseWithCoverage(pixels, i, coverage * strength)
      } else {
        blendSourceOver(
          pixels,
          i,
          color[0],
          color[1],
          color[2],
          color[3] * coverage * strength
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
