import type { Vec3 } from '../utils/math'
import type { GradientDirection, GradientHandle2D, Rgba4 } from './materialTypes'

export interface GradientBbox {
  minX: number
  minY: number
  minZ: number
  maxX: number
  maxY: number
  maxZ: number
  cx: number
  cy: number
  cz: number
}

type BboxPlane = 'xy' | 'xz' | 'yz'

export function dominantBboxPlane(box: GradientBbox): BboxPlane {
  const sx = box.maxX - box.minX
  const sy = box.maxY - box.minY
  const sz = box.maxZ - box.minZ
  if (sz <= sx && sz <= sy) return 'xy'
  if (sy <= sx && sy <= sz) return 'xz'
  return 'yz'
}

/** Map normalized editor coords (u left→right, v top→bottom) to a point on the bbox face. */
export function editorHandleToMeshPoint(
  handle: GradientHandle2D,
  box: GradientBbox,
  plane: BboxPlane
): Vec3 {
  const u = Math.max(0, Math.min(1, handle.u))
  const v = Math.max(0, Math.min(1, handle.v))
  switch (plane) {
    case 'xy':
      return {
        x: box.minX + u * (box.maxX - box.minX),
        y: box.maxY - v * (box.maxY - box.minY),
        z: box.cz,
      }
    case 'xz':
      return {
        x: box.minX + u * (box.maxX - box.minX),
        y: box.cy,
        z: box.maxZ - v * (box.maxZ - box.minZ),
      }
    case 'yz':
      return {
        x: box.cx,
        y: box.maxY - v * (box.maxY - box.minY),
        z: box.minZ + u * (box.maxZ - box.minZ),
      }
  }
}

export function lineGradientT(p: Vec3, start: Vec3, end: Vec3): number {
  const abx = end.x - start.x
  const aby = end.y - start.y
  const abz = end.z - start.z
  const lenSq = abx * abx + aby * aby + abz * abz
  if (lenSq < 1e-12) return 0
  const apx = p.x - start.x
  const apy = p.y - start.y
  const apz = p.z - start.z
  const t = (apx * abx + apy * aby + apz * abz) / lenSq
  return Math.max(0, Math.min(1, t))
}

export function radialGradientT(p: Vec3, center: Vec3, edge: Vec3): number {
  const dx = p.x - center.x
  const dy = p.y - center.y
  const dz = p.z - center.z
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
  const ex = edge.x - center.x
  const ey = edge.y - center.y
  const ez = edge.z - center.z
  const maxDist = Math.sqrt(ex * ex + ey * ey + ez * ez)
  if (maxDist < 1e-6) return 0
  return Math.max(0, Math.min(1, dist / maxDist))
}

export function gradientHandlesForDirection(direction: GradientDirection): [GradientHandle2D, GradientHandle2D] {
  switch (direction) {
    case 'x':
      return [
        { u: 0.08, v: 0.5 },
        { u: 0.92, v: 0.5 },
      ]
    case 'y':
      return [
        { u: 0.5, v: 0.92 },
        { u: 0.5, v: 0.08 },
      ]
    case 'z':
      return [
        { u: 0.5, v: 0.92 },
        { u: 0.5, v: 0.08 },
      ]
    case 'radial':
      return [
        { u: 0.5, v: 0.5 },
        { u: 0.92, v: 0.5 },
      ]
  }
}

export function lerpRgba(a: Rgba4, b: Rgba4, t: number): Rgba4 {
  const u = Math.max(0, Math.min(1, t))
  return [
    a[0] + (b[0] - a[0]) * u,
    a[1] + (b[1] - a[1]) * u,
    a[2] + (b[2] - a[2]) * u,
    a[3] + (b[3] - a[3]) * u,
  ]
}

export function lerpGradientStops(stops: Rgba4[], t: number): Rgba4 {
  if (stops.length === 0) return [1, 1, 1, 1]
  if (stops.length === 1) return [...stops[0]!] as Rgba4
  const u = Math.max(0, Math.min(1, t))
  const seg = u * (stops.length - 1)
  const i = Math.min(Math.floor(seg), stops.length - 2)
  const f = seg - i
  return lerpRgba(stops[i]!, stops[i + 1]!, f)
}
