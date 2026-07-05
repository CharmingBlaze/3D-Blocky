import { type Vec2 } from '../utils/math'
import {
  ensureCCW as ensureCCWPoly,
  isConcavePolygon,
  signedArea,
} from '../mesh/concaveTriangulate'

export interface LobeAnalysis {
  lobes: Vec2[][]
  lobeCount: number
  isMultiLobe: boolean
  neckIndices: number[]
}

function cross2(o: Vec2, a: Vec2, b: Vec2): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
}

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq < 1e-10) return dist(p, a)
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq))
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy })
}

function normalize(v: Vec2): Vec2 {
  const len = Math.hypot(v.x, v.y)
  if (len < 1e-10) return { x: 0, y: 1 }
  return { x: v.x / len, y: v.y / len }
}

/** Detect narrow necks between lobes using local width minima */
export function findNeckVertices(polygon: Vec2[]): number[] {
  const poly = ensureCCWPoly(polygon)
  const n = poly.length
  if (n < 6) return []

  const widths: number[] = []
  for (let i = 0; i < n; i++) {
    const prev = poly[(i + n - 1) % n]
    const curr = poly[i]
    const next = poly[(i + 1) % n]

    const bisector = normalize({
      x: curr.x - prev.x + curr.x - next.x,
      y: curr.y - prev.y + curr.y - next.y,
    })

    let maxDist = 0
    for (let j = 0; j < n; j++) {
      if (j === i) continue
      const d = distToSegment(poly[j], curr, {
        x: curr.x + bisector.x * 1000,
        y: curr.y + bisector.y * 1000,
      })
      maxDist = Math.max(maxDist, d)
    }
    widths.push(maxDist)
  }

  const avg = widths.reduce((a, b) => a + b, 0) / widths.length
  const necks: number[] = []
  for (let i = 0; i < n; i++) {
    const prev = widths[(i + n - 1) % n]
    const curr = widths[i]
    const next = widths[(i + 1) % n]
    if (curr < avg * 0.45 && curr <= prev && curr <= next) {
      necks.push(i)
    }
  }
  return necks
}

function countReflex(poly: Vec2[]): number {
  let count = 0
  for (let i = 0; i < poly.length; i++) {
    const prev = poly[(i + poly.length - 1) % poly.length]
    const curr = poly[i]
    const next = poly[(i + 1) % poly.length]
    if (cross2(prev, curr, next) < -1e-6) count++
  }
  return count
}

function splitAtNecks(polygon: Vec2[], necks: number[]): Vec2[][] {
  if (necks.length === 0) return [polygon]

  const sorted = [...necks].sort((a, b) => a - b)
  const lobes: Vec2[][] = []

  for (let ni = 0; ni < sorted.length; ni++) {
    const start = sorted[ni]
    const end = sorted[(ni + 1) % sorted.length]
    const lobe: Vec2[] = []

    if (start < end) {
      for (let i = start; i <= end; i++) lobe.push({ ...polygon[i] })
    } else {
      for (let i = start; i < polygon.length; i++) lobe.push({ ...polygon[i] })
      for (let i = 0; i <= end; i++) lobe.push({ ...polygon[i] })
    }

    if (lobe.length >= 3 && Math.abs(signedArea(lobe)) > 10) {
      lobes.push(lobe)
    }
  }

  return lobes.length >= 2 ? lobes : [polygon]
}

/** Split concave outline into lobe segments at detected necks */
export function detectLobes(polygon: Vec2[]): LobeAnalysis {
  const poly = ensureCCWPoly(polygon)
  const reflexCount = countReflex(poly)

  if (reflexCount === 0 || poly.length < 6) {
    return { lobes: [poly], lobeCount: 1, isMultiLobe: false, neckIndices: [] }
  }

  const necks = findNeckVertices(poly)
  if (necks.length === 0) {
    return {
      lobes: [poly],
      lobeCount: 1,
      isMultiLobe: reflexCount >= 2,
      neckIndices: [],
    }
  }

  const lobes = splitAtNecks(poly, necks.slice(0, 4))
  return {
    lobes: lobes.length > 1 ? lobes : [poly],
    lobeCount: lobes.length > 1 ? lobes.length : 1,
    isMultiLobe: lobes.length > 1 || reflexCount >= 3,
    neckIndices: necks,
  }
}

export { isConcavePolygon }
