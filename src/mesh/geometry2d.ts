import { earClipTriangulate, ensureCCW } from './concaveTriangulate'
import type { Vec2, Vec3 } from '../utils/math'

export { earClipTriangulate, ensureCCW, signedArea, isConcavePolygon } from './concaveTriangulate'

/** Newell's method — robust polygon normal for non-planar loops */
export function newellNormal(points: Vec3[]): Vec3 {
  const n = points.length
  if (n < 3) return { x: 0, y: 1, z: 0 }

  let nx = 0
  let ny = 0
  let nz = 0
  for (let i = 0; i < n; i++) {
    const cur = points[i]
    const next = points[(i + 1) % n]
    nx += (cur.y - next.y) * (cur.z + next.z)
    ny += (cur.z - next.z) * (cur.x + next.x)
    nz += (cur.x - next.x) * (cur.y + next.y)
  }

  const len = Math.hypot(nx, ny, nz)
  if (len < 1e-10) return { x: 0, y: 1, z: 0 }
  return { x: nx / len, y: ny / len, z: nz / len }
}

export function planeBasisFromPoints(points: Vec3[]): {
  origin: Vec3
  normal: Vec3
  u: Vec3
  v: Vec3
} {
  const origin = centroid3(points)
  const normal = newellNormal(points)

  let u: Vec3 = { x: 1, y: 0, z: 0 }
  if (points.length >= 2) {
    u = normalize3(sub3(points[1], points[0]))
  }

  let v = cross3(normal, u)
  if (length3(v) < 1e-8) {
    u = Math.abs(normal.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 }
    v = cross3(normal, u)
  }
  v = normalize3(v)
  u = normalize3(cross3(v, normal))

  return { origin, normal, u, v }
}

export function projectPointToPlane2D(
  point: Vec3,
  origin: Vec3,
  u: Vec3,
  v: Vec3
): Vec2 {
  const dx = point.x - origin.x
  const dy = point.y - origin.y
  const dz = point.z - origin.z
  return {
    x: dx * u.x + dy * u.y + dz * u.z,
    y: dx * v.x + dy * v.y + dz * v.z,
  }
}

export function centroid3(points: Vec3[]): Vec3 {
  if (points.length === 0) return { x: 0, y: 0, z: 0 }
  let x = 0
  let y = 0
  let z = 0
  for (const p of points) {
    x += p.x
    y += p.y
    z += p.z
  }
  const inv = 1 / points.length
  return { x: x * inv, y: y * inv, z: z * inv }
}

function sub3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

function cross3(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
}

function length3(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z)
}

function normalize3(v: Vec3): Vec3 {
  const len = length3(v)
  if (len < 1e-10) return { x: 0, y: 1, z: 0 }
  return { x: v.x / len, y: v.y / len, z: v.z / len }
}

/**
 * Ear-clipping triangulation for a simple polygon (convex or concave).
 * Non-planar 3D loops are projected onto a best-fit plane first.
 */
export function triangulatePolygon(points3D: Vec3[]): [number, number, number][] {
  if (points3D.length < 3) return []

  const { origin, u, v } = planeBasisFromPoints(points3D)
  const poly2D = points3D.map((p) => projectPointToPlane2D(p, origin, u, v))
  return earClipTriangulate(ensureCCW(poly2D))
}

export function triangulateQuad(indices: [number, number, number, number]): [number, number, number][] {
  const [a, b, c, d] = indices
  return [
    [a, b, c],
    [a, c, d],
  ]
}

/** @deprecated Use triangulatePolygon */
export function triangulatePolygon2D(polygon: Vec2[]): [number, number, number][] {
  return earClipTriangulate(ensureCCW(polygon))
}
