import { type Vec2 } from '../utils/math'

function cross2(o: Vec2, a: Vec2, b: Vec2): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
}

/** Signed area — positive = CCW */
export function signedArea(polygon: Vec2[]): number {
  let area = 0
  for (let i = 0; i < polygon.length; i++) {
    const j = (i + 1) % polygon.length
    area += polygon[i].x * polygon[j].y - polygon[j].x * polygon[i].y
  }
  return area / 2
}

export function ensureCCW(polygon: Vec2[]): Vec2[] {
  return signedArea(polygon) < 0 ? [...polygon].reverse() : [...polygon]
}

/** True if polygon has any reflex (concave) interior angles */
export function isConcavePolygon(polygon: Vec2[]): boolean {
  if (polygon.length < 4) return false
  const poly = ensureCCW(polygon)
  for (let i = 0; i < poly.length; i++) {
    const prev = poly[(i + poly.length - 1) % poly.length]
    const curr = poly[i]
    const next = poly[(i + 1) % poly.length]
    if (cross2(prev, curr, next) < -1e-6) return true
  }
  return false
}

function pointInTriangle(p: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean {
  const c1 = cross2(a, b, p)
  const c2 = cross2(b, c, p)
  const c3 = cross2(c, a, p)
  const hasNeg = c1 < 0 || c2 < 0 || c3 < 0
  const hasPos = c1 > 0 || c2 > 0 || c3 > 0
  return !(hasNeg && hasPos)
}

/** Ear-clipping triangulation for simple polygons (convex or concave) */
export function earClipTriangulate(polygon: Vec2[]): [number, number, number][] {
  const poly = ensureCCW(polygon)
  if (poly.length < 3) return []

  const indices = poly.map((_, i) => i)
  const triangles: [number, number, number][] = []

  let guard = 0
  while (indices.length > 3 && guard++ < 10000) {
    let earFound = false
    for (let i = 0; i < indices.length; i++) {
      const prev = indices[(i + indices.length - 1) % indices.length]
      const curr = indices[i]
      const next = indices[(i + 1) % indices.length]

      const a = poly[prev]
      const b = poly[curr]
      const c = poly[next]

      if (cross2(a, b, c) <= 0) continue

      let contains = false
      for (const idx of indices) {
        if (idx === prev || idx === curr || idx === next) continue
        if (pointInTriangle(poly[idx], a, b, c)) {
          contains = true
          break
        }
      }
      if (contains) continue

      triangles.push([prev, curr, next])
      indices.splice(i, 1)
      earFound = true
      break
    }
    if (!earFound) break
  }

  if (indices.length === 3) {
    triangles.push([indices[0], indices[1], indices[2]])
  }

  return triangles
}

/** Convex hull area ratio — low means highly concave */
export function concavityScore(polygon: Vec2[]): number {
  const poly = ensureCCW(polygon)
  const hull = convexHull(poly)
  const hullArea = Math.abs(signedArea(hull))
  const polyArea = Math.abs(signedArea(poly))
  if (hullArea < 1e-6) return 0
  return 1 - polyArea / hullArea
}

function convexHull(points: Vec2[]): Vec2[] {
  if (points.length < 3) return [...points]
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y)

  const lower: Vec2[] = []
  for (const p of sorted) {
    while (lower.length >= 2 && cross2(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop()
    }
    lower.push(p)
  }

  const upper: Vec2[] = []
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i]
    while (upper.length >= 2 && cross2(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop()
    }
    upper.push(p)
  }

  lower.pop()
  upper.pop()
  return [...lower, ...upper]
}

export function countReflexVertices(polygon: Vec2[]): number {
  const poly = ensureCCW(polygon)
  let count = 0
  for (let i = 0; i < poly.length; i++) {
    const prev = poly[(i + poly.length - 1) % poly.length]
    const curr = poly[i]
    const next = poly[(i + 1) % poly.length]
    if (cross2(prev, curr, next) < -1e-6) count++
  }
  return count
}
