import type { Vec2 } from '../utils/math'
import type { VectorPath } from './types'

function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

/** Split a cubic at t = 0.5 (de Casteljau). */
function subdivideCubic(
  p0: Vec2,
  p1: Vec2,
  p2: Vec2,
  p3: Vec2
): [[Vec2, Vec2, Vec2, Vec2], [Vec2, Vec2, Vec2, Vec2]] {
  const p01 = lerp(p0, p1, 0.5)
  const p12 = lerp(p1, p2, 0.5)
  const p23 = lerp(p2, p3, 0.5)
  const p012 = lerp(p01, p12, 0.5)
  const p123 = lerp(p12, p23, 0.5)
  const mid = lerp(p012, p123, 0.5)
  return [
    [p0, p01, p012, mid],
    [mid, p123, p23, p3],
  ]
}

export function evalCubic(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 {
  const u = 1 - t
  const uu = u * u
  const tt = t * t
  return {
    x: uu * u * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + tt * t * p3.x,
    y: uu * u * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + tt * t * p3.y,
  }
}

const FLATTEN_MAX_DEPTH = 24

function flattenSegment(
  p0: Vec2,
  p1: Vec2,
  p2: Vec2,
  p3: Vec2,
  error: number,
  out: Vec2[],
  depth = 0
): void {
  const mid = evalCubic(p0, p1, p2, p3, 0.5)
  const chord = Math.hypot(p3.x - p0.x, p3.y - p0.y)
  const dev = Math.hypot(mid.x - (p0.x + p3.x) / 2, mid.y - (p0.y + p3.y) / 2)

  if (dev <= error || chord < error || depth >= FLATTEN_MAX_DEPTH) {
    if (
      out.length === 0 ||
      Math.hypot(out[out.length - 1].x - p3.x, out[out.length - 1].y - p3.y) > 0.01
    ) {
      out.push({ ...p3 })
    }
    return
  }

  const [first, second] = subdivideCubic(p0, p1, p2, p3)
  flattenSegment(first[0], first[1], first[2], first[3], error, out, depth + 1)
  flattenSegment(second[0], second[1], second[2], second[3], error, out, depth + 1)
}

export function flattenVectorPath(path: VectorPath, maxError = 0.5): Vec2[] {
  return sampleAnchors(path.anchors, path.closed, maxError)
}

export function sampleAnchors(
  anchors: VectorPath['anchors'],
  closed: boolean,
  maxError = 0.5,
  previewPoint?: Vec2 | null
): Vec2[] {
  if (anchors.length === 0) return []
  if (anchors.length === 1) {
    return previewPoint ? [{ ...anchors[0].position }, previewPoint] : [{ ...anchors[0].position }]
  }

  const out: Vec2[] = [{ ...anchors[0].position }]
  const n = anchors.length
  const segs = closed ? n : n - 1

  for (let i = 0; i < segs; i++) {
    const a0 = anchors[i]
    const a1 = anchors[(i + 1) % n]
    const p0 = a0.position
    const p3 = a1.position
    const p1 = a0.outHandle ?? p0
    const p2 = a1.inHandle ?? p3
    flattenSegment(p0, p1, p2, p3, maxError, out)
  }

  if (!closed && previewPoint) {
    const last = anchors[n - 1]
    const p0 = last.position
    const p3 = previewPoint
    const p1 = last.outHandle ?? p0
    const p2 = previewPoint
    flattenSegment(p0, p1, p2, p3, maxError, out)
  }

  if (closed && out.length > 1) {
    const first = out[0]
    const last = out[out.length - 1]
    if (Math.hypot(first.x - last.x, first.y - last.y) < maxError) out.pop()
  }

  return out
}

/** Points for rendering handle tangents (pairs: anchor → handle). */
export function handleSegments(anchors: VectorPath['anchors']): [Vec2, Vec2][] {
  const lines: [Vec2, Vec2][] = []
  for (const a of anchors) {
    if (a.inHandle) lines.push([a.position, a.inHandle])
    if (a.outHandle) lines.push([a.position, a.outHandle])
  }
  return lines
}
