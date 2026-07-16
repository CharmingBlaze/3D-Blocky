import { type Vec2 } from '../utils/math'
import { HalfEdgeMesh } from './HalfEdgeMesh'
import { ensurePositiveVolume } from './meshWinding'

export type HairRibbonStyle = 'path' | 'strip'

/** Tip shape for all hair draw modes: taper to a point, or keep full width/radius. */
export type HairTipStyle = 'pointed' | 'square'

export interface HairRibbonOptions {
  /** Maximum half-width at the thickest mid-stroke section. */
  halfWidth: number
  /** Thin prism depth along local Z. Ignored when `flat` (Hair Strips). */
  depth: number
  color?: number
  /** Fraction of arc length at each end that tapers (0–0.49). Default 0.35. Ignored when tipStyle is square. */
  taperFraction?: number
  /** Pointed pinches tips; square keeps full half-width to blunt ends. Default pointed. */
  tipStyle?: HairTipStyle
  startTipStyle?: HairTipStyle
  endTipStyle?: HairTipStyle
  /**
   * Flat double-sided hair card (Hair Strips): single plane of quads + reverse
   * backfaces, zero extrusion thickness. Matches low-poly plane double-sided topology.
   */
  flat?: boolean
}

function pushUv(mesh: HalfEdgeMesh, u: number, v: number): number {
  const idx = mesh.uvs.length
  mesh.uvs.push({ u, v })
  return idx
}

/**
 * Smooth taper: 0 at both tips, 1 through the mid section.
 * Uses smoothstep in the end zones so tips pinch cleanly.
 */
export function hairTaperFactor(t: number, taperFraction = 0.35): number {
  const f = Math.max(0.05, Math.min(0.49, taperFraction))
  const clamped = Math.max(0, Math.min(1, t))
  if (clamped < f) {
    const x = clamped / f
    return x * x * (3 - 2 * x)
  }
  if (clamped > 1 - f) {
    const x = (1 - clamped) / f
    return x * x * (3 - 2 * x)
  }
  return 1
}

function cumulativeArcLengths(points: Vec2[]): { lengths: number[]; total: number } {
  const lengths = [0]
  let total = 0
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y)
    lengths.push(total)
  }
  return { lengths, total }
}

/**
 * Build left/right offset polylines with per-point half-width.
 * Pointed: tip half-widths approach ~0 so the ribbon pinches visually.
 * Square: full half-width maintained to blunt rectangular ends.
 */
export function strokeToTaperedRibbon(
  points: Vec2[],
  halfWidth: number,
  taperFraction = 0.35,
  tipStyle: HairTipStyle = 'pointed',
  startTipStyle: HairTipStyle = tipStyle,
  endTipStyle: HairTipStyle = tipStyle
): { left: Vec2[]; right: Vec2[]; halfWidths: number[]; arcT: number[] } | null {
  if (points.length < 2 || halfWidth <= 0) return null

  const { lengths, total } = cumulativeArcLengths(points)
  const denom = Math.max(total, 1e-8)
  const left: Vec2[] = []
  const right: Vec2[] = []
  const halfWidths: number[] = []
  const arcT: number[] = []

  // Near-zero but non-zero so tip cross-sections stay valid for quads (pointed only).
  const minHalf = Math.max(1e-3, halfWidth * 0.002)

  for (let i = 0; i < points.length; i++) {
    const prev = points[Math.max(0, i - 1)]!
    const curr = points[i]!
    const next = points[Math.min(points.length - 1, i + 1)]!

    let tx = next.x - prev.x
    let ty = next.y - prev.y
    let len = Math.hypot(tx, ty)
    if (len < 1e-8) {
      tx = next.x - curr.x
      ty = next.y - curr.y
      len = Math.hypot(tx, ty) || 1
    }
    tx /= len
    ty /= len

    const nx = -ty
    const ny = tx

    const t = lengths[i]! / denom
    const startFactor = startTipStyle === 'square' || t >= taperFraction
      ? 1
      : hairTaperFactor(Math.min(t, 0.5), taperFraction)
    const endFactor = endTipStyle === 'square' || t <= 1 - taperFraction
      ? 1
      : hairTaperFactor(Math.max(t, 0.5), taperFraction)
    const hw = Math.max(minHalf, halfWidth * Math.min(startFactor, endFactor))
    halfWidths.push(hw)
    arcT.push(t)
    left.push({ x: curr.x + nx * hw, y: curr.y + ny * hw })
    right.push({ x: curr.x - nx * hw, y: curr.y - ny * hw })
  }

  return { left, right, halfWidths, arcT }
}

/**
 * Flat double-sided tapered ribbon (Hair Strips).
 * Single coplanar quad strip + reverse-wound backfaces (same as low-poly plane).
 */
function generateFlatHairRibbon(
  left: Vec2[],
  right: Vec2[],
  arcT: number[],
  color: number
): HalfEdgeMesh {
  const mesh = new HalfEdgeMesh()
  const n = left.length
  const L: number[] = []
  const R: number[] = []

  for (let i = 0; i < n; i++) {
    const lp = left[i]!
    const rp = right[i]!
    L.push(mesh.positions.length)
    mesh.positions.push({ x: lp.x, y: lp.y, z: 0 })
    R.push(mesh.positions.length)
    mesh.positions.push({ x: rp.x, y: rp.y, z: 0 })
  }

  for (let i = 0; i < n - 1; i++) {
    const u0 = arcT[i]!
    const u1 = arcT[i + 1]!
    const uv0 = pushUv(mesh, u0, 0)
    const uv1 = pushUv(mesh, u0, 1)
    const uv2 = pushUv(mesh, u1, 1)
    const uv3 = pushUv(mesh, u1, 0)

    // Front: L→R→R'→L'
    mesh.faces.push([L[i]!, R[i]!, R[i + 1]!, L[i + 1]!])
    mesh.faceUvIndices.push([uv0, uv1, uv2, uv3])
    mesh.faceColors.push(color)

    // Back: reverse winding, shared UV corners (paint matches both sides)
    mesh.faces.push([L[i]!, L[i + 1]!, R[i + 1]!, R[i]!])
    mesh.faceUvIndices.push([uv0, uv3, uv2, uv1])
    mesh.faceColors.push(color)
  }

  mesh.buildHalfEdges()
  return mesh
}

/**
 * Tapered hair card / ribbon along a centerline.
 * Paths: thin prism (front/back + side walls). Strips (`flat`): coplanar double-sided quads.
 * U along length, V across width.
 */
export function generateHairRibbon(points: Vec2[], options: HairRibbonOptions): HalfEdgeMesh {
  const {
    halfWidth,
    depth,
    color = 0x7ecba1,
    taperFraction = 0.35,
    tipStyle = 'pointed',
    startTipStyle = tipStyle,
    endTipStyle = tipStyle,
    flat = false,
  } = options
  const ribbon = strokeToTaperedRibbon(points, halfWidth, taperFraction, tipStyle, startTipStyle, endTipStyle)
  if (!ribbon || ribbon.left.length < 2) return new HalfEdgeMesh()

  const { left, right, arcT } = ribbon
  const useFlat = flat || Math.abs(depth) < 1e-4
  if (useFlat) {
    return generateFlatHairRibbon(left, right, arcT, color)
  }

  const mesh = new HalfEdgeMesh()
  const n = left.length
  // Signed depth matches silhouette extrude: negative flips front/back along local Z.
  const half = (Math.sign(depth) || 1) * Math.max(0.4, Math.abs(depth) / 2)

  // Per cross-section: LF, RF, LB, RB
  const lf: number[] = []
  const rf: number[] = []
  const lb: number[] = []
  const rb: number[] = []

  for (let i = 0; i < n; i++) {
    const L = left[i]!
    const R = right[i]!
    lf.push(mesh.positions.length)
    mesh.positions.push({ x: L.x, y: L.y, z: half })
    rf.push(mesh.positions.length)
    mesh.positions.push({ x: R.x, y: R.y, z: half })
    lb.push(mesh.positions.length)
    mesh.positions.push({ x: L.x, y: L.y, z: -half })
    rb.push(mesh.positions.length)
    mesh.positions.push({ x: R.x, y: R.y, z: -half })
  }

  for (let i = 0; i < n - 1; i++) {
    const u0 = arcT[i]!
    const u1 = arcT[i + 1]!

    // Front (+Z): LF→RF→RF'→LF' — CCW from outside
    {
      const uv0 = pushUv(mesh, u0, 0)
      const uv1 = pushUv(mesh, u0, 1)
      const uv2 = pushUv(mesh, u1, 1)
      const uv3 = pushUv(mesh, u1, 0)
      mesh.faces.push([lf[i]!, rf[i]!, rf[i + 1]!, lf[i + 1]!])
      mesh.faceUvIndices.push([uv0, uv1, uv2, uv3])
      mesh.faceColors.push(color)
    }

    // Back (−Z): LB→LB'→RB'→RB — CCW from outside (−Z)
    {
      const uv0 = pushUv(mesh, u0, 0)
      const uv1 = pushUv(mesh, u1, 0)
      const uv2 = pushUv(mesh, u1, 1)
      const uv3 = pushUv(mesh, u0, 1)
      mesh.faces.push([lb[i]!, lb[i + 1]!, rb[i + 1]!, rb[i]!])
      mesh.faceUvIndices.push([uv0, uv1, uv2, uv3])
      mesh.faceColors.push(color)
    }

    // Left wall (along left edge)
    {
      const uv0 = pushUv(mesh, u0, 0)
      const uv1 = pushUv(mesh, u1, 0)
      const uv2 = pushUv(mesh, u1, 0.15)
      const uv3 = pushUv(mesh, u0, 0.15)
      mesh.faces.push([lf[i]!, lf[i + 1]!, lb[i + 1]!, lb[i]!])
      mesh.faceUvIndices.push([uv0, uv1, uv2, uv3])
      mesh.faceColors.push(color)
    }

    // Right wall
    {
      const uv0 = pushUv(mesh, u0, 0.85)
      const uv1 = pushUv(mesh, u0, 1)
      const uv2 = pushUv(mesh, u1, 1)
      const uv3 = pushUv(mesh, u1, 0.85)
      mesh.faces.push([rf[i]!, rb[i]!, rb[i + 1]!, rf[i + 1]!])
      mesh.faceUvIndices.push([uv0, uv1, uv2, uv3])
      mesh.faceColors.push(color)
    }
  }

  // Tip caps (start / end) — small quads so the solid stays closed
  {
    const u = 0
    const uv0 = pushUv(mesh, u, 0)
    const uv1 = pushUv(mesh, u, 1)
    const uv2 = pushUv(mesh, u, 1)
    const uv3 = pushUv(mesh, u, 0)
    mesh.faces.push([lf[0]!, lb[0]!, rb[0]!, rf[0]!])
    mesh.faceUvIndices.push([uv0, uv3, uv2, uv1])
    mesh.faceColors.push(color)
  }
  {
    const u = 1
    const last = n - 1
    const uv0 = pushUv(mesh, u, 0)
    const uv1 = pushUv(mesh, u, 1)
    const uv2 = pushUv(mesh, u, 1)
    const uv3 = pushUv(mesh, u, 0)
    mesh.faces.push([lf[last]!, rf[last]!, rb[last]!, lb[last]!])
    mesh.faceUvIndices.push([uv0, uv1, uv2, uv3])
    mesh.faceColors.push(color)
  }

  mesh.buildHalfEdges()
  return ensurePositiveVolume(mesh)
}

/** Sketch thickness → max ribbon half-width (before tip taper). */
export function hairHalfWidthFromBrush(brushDensity: number, style: HairRibbonStyle): number {
  if (style === 'strip') {
    return Math.max(4, Math.min(18, brushDensity * 0.55))
  }
  return Math.max(3, Math.min(14, brushDensity * 0.48))
}

/**
 * Sketch thickness → max tube radius for Rounded Hair (before tip taper).
 * Primary size control for the circular cross-section.
 */
export function roundedHairRadiusFromBrush(brushDensity: number): number {
  return Math.max(2.5, Math.min(12, brushDensity * 0.42))
}

/**
 * Max tube radius for Rounded Hair.
 * Thickness sets the base radius; Extrude depth (magnitude) scales overall size
 * when set (circular tube — sign ignored). Poly budget controls lengthwise samples.
 */
export function resolveRoundedHairRadius(
  extrudeAmount: number | undefined,
  brushDensity: number
): number {
  const base = roundedHairRadiusFromBrush(brushDensity)
  if (extrudeAmount == null || !Number.isFinite(extrudeAmount)) return base
  const scale = Math.max(0.5, Math.min(2.2, Math.abs(extrudeAmount) / 12))
  return Math.max(2, Math.min(16, base * scale))
}

/** Fallback prism depth when Extrude depth is unset (Hair Paths only). */
export function hairDepthFromBrush(brushDensity: number, style: HairRibbonStyle): number {
  if (style === 'strip') return 0
  return Math.max(1.2, Math.min(4, brushDensity * 0.1))
}

/**
 * Extrude depth → hair card thickness along local Z (signed; negative flips direction).
 * Hair Strips are always flat (depth 0) — Extrude depth does not thicken them.
 * Hair Paths fall back to a brush-scaled default when extrude amount is omitted.
 * (Rounded Hair uses resolveRoundedHairRadius — not this helper.)
 */
export function resolveHairDepth(
  extrudeAmount: number | undefined,
  brushDensity: number,
  style: HairRibbonStyle
): number {
  if (style === 'strip') return 0
  if (extrudeAmount != null && Number.isFinite(extrudeAmount)) {
    const mag = Math.max(0.8, Math.abs(extrudeAmount))
    return (Math.sign(extrudeAmount) || 1) * mag
  }
  return hairDepthFromBrush(brushDensity, style)
}
