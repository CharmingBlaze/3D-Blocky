import { dist2, type Vec2 } from '../utils/math'

/** Resample polyline to roughly uniform arc-length spacing */
export function resampleUniform(points: Vec2[], spacing: number): Vec2[] {
  if (points.length < 2) return [...points]
  const minSpacing = Math.max(spacing, 0.5)
  const result: Vec2[] = [{ ...points[0] }]
  let prev = points[0]

  for (let i = 1; i < points.length; i++) {
    const curr = points[i]
    const segLen = dist2(prev, curr)
    if (segLen < minSpacing) continue

    const steps = Math.floor(segLen / minSpacing)
    for (let s = 1; s <= steps; s++) {
      const t = (s * minSpacing) / segLen
      result.push({
        x: prev.x + (curr.x - prev.x) * t,
        y: prev.y + (curr.y - prev.y) * t,
      })
    }
    result.push({ ...curr })
    prev = curr
  }

  return result
}

/** Resample a closed loop with uniform spacing, including the edge back to the start. */
export function resampleUniformClosed(points: Vec2[], spacing: number): Vec2[] {
  if (points.length < 3) return points.map((p) => ({ ...p }))
  const minSpacing = Math.max(spacing, 0.5)
  const verts = points.map((p) => ({ ...p }))
  const n = verts.length

  const edgeLen: number[] = []
  let perimeter = 0
  for (let i = 0; i < n; i++) {
    const len = dist2(verts[i]!, verts[(i + 1) % n]!)
    edgeLen.push(len)
    perimeter += len
  }
  if (perimeter < minSpacing) return verts

  const sampleCount = Math.max(8, Math.round(perimeter / minSpacing))
  const stepLen = perimeter / sampleCount
  const result: Vec2[] = []

  let currEdgeIdx = 0
  let currEdgePos = 0

  for (let s = 0; s < sampleCount; s++) {
    const targetDist = s * stepLen
    let accum = 0
    for (let j = 0; j < currEdgeIdx; j++) {
      accum += edgeLen[j]!
    }
    accum += currEdgePos

    let needed = targetDist - accum
    while (needed > 1e-9) {
      const len = edgeLen[currEdgeIdx]!
      const remainingOnEdge = len - currEdgePos
      if (needed <= remainingOnEdge) {
        currEdgePos += needed
        needed = 0
      } else {
        needed -= remainingOnEdge
        currEdgeIdx = (currEdgeIdx + 1) % n
        currEdgePos = 0
      }
    }

    const a = verts[currEdgeIdx]!
    const b = verts[(currEdgeIdx + 1) % n]!
    const len = edgeLen[currEdgeIdx]!
    const t = len > 1e-8 ? clamp01(currEdgePos / len) : 0
    result.push({
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
    })
  }

  return result
}

function clamp01(t: number): number {
  return Math.max(0, Math.min(1, t))
}

/** Exponential moving average — steady freehand tracking toward the pointer. */
export function emaSmoothPoint(prev: Vec2, next: Vec2, alpha = 0.32): Vec2 {
  const a = Math.max(0.05, Math.min(1, alpha))
  return {
    x: prev.x + (next.x - prev.x) * a,
    y: prev.y + (next.y - prev.y) * a,
  }
}

/** Light centered moving average for a finished stroke (keeps endpoints fixed). */
export function movingAverageSmoothStroke(points: Vec2[], radius = 2): Vec2[] {
  if (points.length < 3 || radius <= 0) return points.map((p) => ({ ...p }))
  const out: Vec2[] = [{ ...points[0]! }]
  for (let i = 1; i < points.length - 1; i++) {
    let sx = 0
    let sy = 0
    let count = 0
    const lo = Math.max(0, i - radius)
    const hi = Math.min(points.length - 1, i + radius)
    for (let j = lo; j <= hi; j++) {
      sx += points[j]!.x
      sy += points[j]!.y
      count++
    }
    out.push({ x: sx / count, y: sy / count })
  }
  out.push({ ...points[points.length - 1]! })
  return out
}

/** Measure total absolute turning angle along a path (radians) */
export function totalCurvature(points: Vec2[]): number {
  if (points.length < 3) return 0
  let total = 0
  for (let i = 1; i < points.length - 1; i++) {
    const v1 = { x: points[i].x - points[i - 1].x, y: points[i].y - points[i - 1].y }
    const v2 = { x: points[i + 1].x - points[i].x, y: points[i + 1].y - points[i].y }
    const l1 = Math.hypot(v1.x, v1.y)
    const l2 = Math.hypot(v2.x, v2.y)
    if (l1 < 1e-8 || l2 < 1e-8) continue
    const dot = (v1.x * v2.x + v1.y * v2.y) / (l1 * l2)
    total += Math.acos(Math.max(-1, Math.min(1, dot)))
  }
  return total
}

/** Per-point curvature angles for adaptive sampling */
export function curvatureAtPoints(points: Vec2[]): number[] {
  const angles: number[] = [0]
  for (let i = 1; i < points.length - 1; i++) {
    const v1 = { x: points[i].x - points[i - 1].x, y: points[i].y - points[i - 1].y }
    const v2 = { x: points[i + 1].x - points[i].x, y: points[i + 1].y - points[i].y }
    const l1 = Math.hypot(v1.x, v1.y)
    const l2 = Math.hypot(v2.x, v2.y)
    if (l1 < 1e-8 || l2 < 1e-8) {
      angles.push(0)
      continue
    }
    const dot = (v1.x * v2.x + v1.y * v2.y) / (l1 * l2)
    angles.push(Math.acos(Math.max(-1, Math.min(1, dot))))
  }
  angles.push(0)
  return angles
}

export interface EllipseFit {
  cx: number
  cy: number
  rx: number
  ry: number
  aspectRatio: number
  circularity: number
}

/** Fit axis-aligned ellipse to closed stroke */
export function fitEllipse(points: Vec2[]): EllipseFit {
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length

  let rx = 0
  let ry = 0
  for (const p of points) {
    rx = Math.max(rx, Math.abs(p.x - cx))
    ry = Math.max(ry, Math.abs(p.y - cy))
  }
  rx = Math.max(rx, 0.5)
  ry = Math.max(ry, 0.5)

  const aspectRatio = Math.min(rx, ry) / Math.max(rx, ry)
  const radii = points.map((p) => Math.hypot(p.x - cx, p.y - cy))
  const meanR = radii.reduce((a, b) => a + b, 0) / radii.length
  const variance = radii.reduce((s, r) => s + (r - meanR) ** 2, 0) / radii.length
  const circularity = 1 - Math.sqrt(variance) / (meanR + 1e-6)

  return { cx, cy, rx, ry, aspectRatio, circularity }
}
