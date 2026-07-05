import { dist2, polygonArea2D, type Vec2 } from '../utils/math'

export type StrokeType = 'open' | 'closed'

export function classifyStroke(
  points: Vec2[],
  closeThreshold: number
): StrokeType {
  if (points.length < 3) return 'open'
  const start = points[0]
  const end = points[points.length - 1]
  return dist2(start, end) <= closeThreshold ? 'closed' : 'open'
}

/** Check if closed silhouette has near-radial symmetry (bead/eye detection) */
export function detectRadialSymmetry(points: Vec2[], threshold = 0.75): boolean {
  if (points.length < 6) return false

  const cx = points.reduce((s, p) => s + p.x, 0) / points.length
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length

  const radii = points.map((p) => Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2))
  const mean = radii.reduce((a, b) => a + b, 0) / radii.length
  if (mean < 1e-6) return false

  const variance = radii.reduce((s, r) => s + (r - mean) ** 2, 0) / radii.length
  const cv = Math.sqrt(variance) / mean

  const area = polygonArea2D(points)
  const circleArea = Math.PI * mean * mean
  const areaRatio = Math.min(area, circleArea) / Math.max(area, circleArea)

  return cv < 0.35 && areaRatio > threshold
}

/** Extract lathe profile (right half) from radial silhouette */
export function extractLatheProfile(points: Vec2[]): Vec2[] {
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length

  const sorted = [...points].sort((a, b) => a.y - b.y)
  const profile: Vec2[] = []

  for (const p of sorted) {
    const r = Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2)
    profile.push({ x: r, y: p.y - cy })
  }

  const deduped: Vec2[] = []
  for (const p of profile) {
    const last = deduped[deduped.length - 1]
    if (!last || Math.abs(p.y - last.y) > 0.5) {
      deduped.push(p)
    }
  }

  return deduped
}

/** Compute approximate medial axis points for loft generation */
export function computeMedialAxis(points: Vec2[]): Vec2[] {
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length

  const minY = Math.min(...points.map((p) => p.y))
  const maxY = Math.max(...points.map((p) => p.y))
  const steps = 8
  const axis: Vec2[] = []

  for (let i = 0; i <= steps; i++) {
    const y = minY + (maxY - minY) * (i / steps)
    const slice = points.filter((p) => Math.abs(p.y - y) < (maxY - minY) / steps + 1)
    if (slice.length >= 2) {
      const minX = Math.min(...slice.map((p) => p.x))
      const maxX = Math.max(...slice.map((p) => p.x))
      axis.push({ x: (minX + maxX) / 2, y })
    } else {
      axis.push({ x: cx, y })
    }
  }

  return axis
}

/** Get cross-section radius at a Y slice */
export function crossSectionRadius(points: Vec2[], y: number, tolerance: number): number {
  const slice = points.filter((p) => Math.abs(p.y - y) <= tolerance)
  if (slice.length < 2) return 0
  const minX = Math.min(...slice.map((p) => p.x))
  const maxX = Math.max(...slice.map((p) => p.x))
  return (maxX - minX) / 2
}
