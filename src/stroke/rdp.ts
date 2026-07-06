import { perpendicularDistance, type Vec2 } from '../utils/math'

/** Ramer–Douglas–Peucker polyline simplification */
export function rdpSimplify(points: Vec2[], tolerance: number): Vec2[] {
  if (points.length <= 2) return [...points]

  let maxDist = 0
  let maxIndex = 0
  const end = points.length - 1

  for (let i = 1; i < end; i++) {
    const d = perpendicularDistance(points[i], points[0], points[end])
    if (d > maxDist) {
      maxDist = d
      maxIndex = i
    }
  }

  if (maxDist > tolerance) {
    const left = rdpSimplify(points.slice(0, maxIndex + 1), tolerance)
    const right = rdpSimplify(points.slice(maxIndex), tolerance)
    return [...left.slice(0, -1), ...right]
  }

  return [points[0], points[end]]
}

/** Adaptive angular deviation sampling along a 2D profile */
export function curvatureSampleProfile(
  profile: Vec2[],
  minAngleDeg: number,
  maxPoints?: number
): Vec2[] {
  if (profile.length <= 2) return [...profile]

  const minAngle = (minAngleDeg * Math.PI) / 180
  const result: Vec2[] = [profile[0]]

  for (let i = 1; i < profile.length - 1; i++) {
    const prev = profile[i - 1]
    const curr = profile[i]
    const next = profile[i + 1]

    const v1 = { x: curr.x - prev.x, y: curr.y - prev.y }
    const v2 = { x: next.x - curr.x, y: next.y - curr.y }
    const len1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y)
    const len2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y)
    if (len1 < 1e-10 || len2 < 1e-10) continue

    const dot = (v1.x * v2.x + v1.y * v2.y) / (len1 * len2)
    const angle = Math.acos(Math.max(-1, Math.min(1, dot)))

    if (angle > minAngle) {
      result.push(curr)
    }
  }

  result.push(profile[profile.length - 1])

  if (maxPoints && result.length > maxPoints) {
    const step = (result.length - 1) / (maxPoints - 1)
    const reduced: Vec2[] = []
    for (let i = 0; i < maxPoints; i++) {
      reduced.push(result[Math.round(i * step)])
    }
    return reduced
  }

  return result
}

/** Curvature sampling for closed loops (organic silhouettes) */
export function curvatureSampleClosedLoop(
  loop: Vec2[],
  minAngleDeg: number,
  maxPoints?: number
): Vec2[] {
  let working = [...loop]
  if (working.length >= 2) {
    const first = working[0]!
    const last = working[working.length - 1]!
    if (Math.hypot(first.x - last.x, first.y - last.y) <= 0.01) {
      working = working.slice(0, -1)
    }
  }
  if (working.length <= 3) {
    return capClosedLoopPoints(working, maxPoints)
  }

  const minAngle = (minAngleDeg * Math.PI) / 180
  const n = working.length
  const result: Vec2[] = []

  for (let i = 0; i < n; i++) {
    const prev = working[(i + n - 1) % n]!
    const curr = working[i]!
    const next = working[(i + 1) % n]!

    const v1 = { x: curr.x - prev.x, y: curr.y - prev.y }
    const v2 = { x: next.x - curr.x, y: next.y - curr.y }
    const len1 = Math.hypot(v1.x, v1.y)
    const len2 = Math.hypot(v2.x, v2.y)
    if (len1 < 1e-10 || len2 < 1e-10) continue

    const dot = (v1.x * v2.x + v1.y * v2.y) / (len1 * len2)
    const angle = Math.acos(Math.max(-1, Math.min(1, dot)))

    if (angle > minAngle) {
      result.push(curr)
    }
  }

  if (result.length < 3) {
    return capClosedLoopPoints(working, maxPoints)
  }

  return capClosedLoopPoints(result, maxPoints)
}

function capClosedLoopPoints(points: Vec2[], maxPoints?: number): Vec2[] {
  if (!maxPoints || points.length <= maxPoints) return [...points]

  const scored = points.map((p, i) => {
    const prevPt = points[(i + points.length - 1) % points.length]!
    const nextPt = points[(i + 1) % points.length]!
    const v1 = { x: p.x - prevPt.x, y: p.y - prevPt.y }
    const v2 = { x: nextPt.x - p.x, y: nextPt.y - p.y }
    const len1 = Math.hypot(v1.x, v1.y)
    const len2 = Math.hypot(v2.x, v2.y)
    let score = 0
    if (len1 > 1e-10 && len2 > 1e-10) {
      const dot = (v1.x * v2.x + v1.y * v2.y) / (len1 * len2)
      score = Math.acos(Math.max(-1, Math.min(1, dot)))
    }
    return { i, score }
  })
  scored.sort((a, b) => b.score - a.score)
  const keep = new Set<number>()
  for (const s of scored.slice(0, maxPoints)) keep.add(s.i)
  return points.filter((_, i) => keep.has(i))
}
