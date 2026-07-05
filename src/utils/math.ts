import { Vector3 } from 'three'

export type Vec2 = { x: number; y: number }
export type Vec3 = { x: number; y: number; z: number }

export function vec2(x = 0, y = 0): Vec2 {
  return { x, y }
}

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z }
}

export function dist2(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.sqrt(dx * dx + dy * dy)
}

export function dist3(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  const dz = a.z - b.z
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

export function perpendicularDistance(point: Vec2, lineStart: Vec2, lineEnd: Vec2): number {
  const dx = lineEnd.x - lineStart.x
  const dy = lineEnd.y - lineStart.y
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return dist2(point, lineStart)
  const t = clamp(((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / lenSq, 0, 1)
  const proj = { x: lineStart.x + t * dx, y: lineStart.y + t * dy }
  return dist2(point, proj)
}

export function polygonArea2D(points: Vec2[]): number {
  let area = 0
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length
    area += points[i].x * points[j].y - points[j].x * points[i].y
  }
  return Math.abs(area) / 2
}

export function polygonCentroid2D(points: Vec2[]): Vec2 {
  let cx = 0
  let cy = 0
  for (const p of points) {
    cx += p.x
    cy += p.y
  }
  return { x: cx / points.length, y: cy / points.length }
}

export function toThree(v: Vec3): Vector3 {
  return new Vector3(v.x, v.y, v.z)
}

export function fromThree(v: Vector3): Vec3 {
  return { x: v.x, y: v.y, z: v.z }
}

export function normalize3(v: Vec3): Vec3 {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z)
  if (len < 1e-10) return { x: 0, y: 1, z: 0 }
  return { x: v.x / len, y: v.y / len, z: v.z / len }
}

export function cross3(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
}

export function dot3(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

export function add3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }
}

export function sub3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

export function scale3(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s }
}

export function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    z: lerp(a.z, b.z, t),
  }
}

export function faceNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  return normalize3(cross3(sub3(b, a), sub3(c, a)))
}

export function angleBetween2D(a: Vec2, b: Vec2, c: Vec2): number {
  const v1 = { x: a.x - b.x, y: a.y - b.y }
  const v2 = { x: c.x - b.x, y: c.y - b.y }
  const dot = v1.x * v2.x + v1.y * v2.y
  const len1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y)
  const len2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y)
  if (len1 < 1e-10 || len2 < 1e-10) return 0
  return Math.acos(clamp(dot / (len1 * len2), -1, 1))
}

export function generateId(): string {
  return Math.random().toString(36).slice(2, 11)
}
