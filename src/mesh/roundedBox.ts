import { HalfEdgeMesh, type SceneObject } from './HalfEdgeMesh'
import type { Vec3 } from '../utils/math'
import { meshDataToHalfEdgeMesh } from '../blob/adapters'
import { createBoxMesh } from '../primitives/primitivesBox'
import type { MeshData } from '../blob/types'
import { boxCenterSize, type WorldBox } from '../primitives/primitiveBoxMath'
import { subdivideSurfaceLevels, clampSubdLevels } from './subdivisionSurface'
import {
  maxRoundedBoxSubdivisionsForBudget,
  maxSubdLevelsForBudget,
} from './meshPolyBudget'

export interface RoundedBoxParams {
  roundness: number
  subdivisions: number
}

export function clampRoundness(value: number): number {
  return Math.max(0, Math.min(1, value))
}

export function clampRoundedBoxSubdivisions(value: number): number {
  return clampSubdLevels(value)
}

function sdfRoundedBox(p: Vec3, hx: number, hy: number, hz: number, r: number): number {
  const qx = Math.abs(p.x) - hx + r
  const qy = Math.abs(p.y) - hy + r
  const qz = Math.abs(p.z) - hz + r
  return (
    Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) +
    Math.min(Math.max(qx, qy, qz), 0) -
    r
  )
}

function roundedBoxSurfaceAlongDir(
  dx: number,
  dy: number,
  dz: number,
  hx: number,
  hy: number,
  hz: number,
  r: number
): Vec3 {
  const len = Math.hypot(dx, dy, dz)
  if (len < 1e-8) return { x: 0, y: 0, z: 0 }
  const nd = { x: dx / len, y: dy / len, z: dz / len }
  let lo = 0
  let hi = Math.hypot(hx, hy, hz) * 2 + r * 2
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) * 0.5
    const p = { x: nd.x * mid, y: nd.y * mid, z: nd.z * mid }
    if (sdfRoundedBox(p, hx, hy, hz, r) > 0) hi = mid
    else lo = mid
  }
  const t = lo
  return { x: nd.x * t, y: nd.y * t, z: nd.z * t }
}

export function boundsCenterHalf(obj: SceneObject): { center: Vec3; half: Vec3 } {
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  for (const p of obj.positions) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    minZ = Math.min(minZ, p.z)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
    maxZ = Math.max(maxZ, p.z)
  }
  return {
    center: {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
      z: (minZ + maxZ) / 2,
    },
    half: {
      x: (maxX - minX) / 2 || 0.5,
      y: (maxY - minY) / 2 || 0.5,
      z: (maxZ - minZ) / 2 || 0.5,
    },
  }
}

export function applyRoundedBoxDeform(
  obj: SceneObject,
  center: Vec3,
  half: Vec3,
  roundness: number
): void {
  const r = clampRoundness(roundness) * Math.min(half.x, half.y, half.z) * 0.98
  if (r <= 1e-5) return

  for (const p of obj.positions) {
    const lx = p.x - center.x
    const ly = p.y - center.y
    const lz = p.z - center.z
    const surf = roundedBoxSurfaceAlongDir(lx, ly, lz, half.x, half.y, half.z, r)
    p.x = center.x + surf.x
    p.y = center.y + surf.y
    p.z = center.z + surf.z
  }
}

export function applyRoundedBoxParams(
  obj: SceneObject,
  params: RoundedBoxParams,
  polyBudget?: number
): SceneObject {
  let out = obj
  let subs = clampRoundedBoxSubdivisions(params.subdivisions)
  if (polyBudget != null) {
    subs = Math.min(subs, maxRoundedBoxSubdivisionsForBudget(polyBudget))
  }
  if (subs > 0) {
    subs = Math.min(subs, maxSubdLevelsForBudget(polyBudget ?? 48, out.positions.length))
    out = subdivideSurfaceLevels(out, subs)
  }
  const { center, half } = boundsCenterHalf(out)
  applyRoundedBoxDeform(out, center, half, params.roundness)
  out.smoothShading = false
  return out
}

export function roundedBoxFromMeshData(
  data: MeshData,
  color: number,
  center: Vec3,
  half: Vec3,
  params: RoundedBoxParams,
  polyBudget?: number
): SceneObject {
  const mesh = meshDataToHalfEdgeMesh(data, color)
  let obj = mesh.toObject('temp', 'RoundedBox', {
    color,
    polyBudget: polyBudget ?? 48,
    polyBudgetMode: 'strict',
    smoothShading: false,
  })

  let subs = clampRoundedBoxSubdivisions(params.subdivisions)
  if (polyBudget != null) {
    subs = Math.min(subs, maxRoundedBoxSubdivisionsForBudget(polyBudget))
  }
  if (subs > 0) {
    subs = Math.min(subs, maxSubdLevelsForBudget(polyBudget ?? 48, obj.positions.length))
    obj = subdivideSurfaceLevels(obj, subs)
  }

  applyRoundedBoxDeform(obj, center, half, params.roundness)
  return obj
}

export function roundedBoxFromWorldBox(
  box: WorldBox,
  color: number,
  params: RoundedBoxParams,
  polyBudget?: number
): SceneObject {
  const { center, size } = boxCenterSize(box)
  const half = { x: size.x / 2, y: size.y / 2, z: size.z / 2 }
  const data = createBoxMesh(center, size)
  if (data.indices.length === 0) {
    return meshDataToHalfEdgeMesh(data, color).toObject('temp', 'RoundedBox', { color })
  }
  return roundedBoxFromMeshData(data, color, center, half, params, polyBudget)
}

export function roundedBoxHalfEdgeFromWorldBox(
  box: WorldBox,
  color: number,
  params: RoundedBoxParams,
  polyBudget?: number
): HalfEdgeMesh {
  return HalfEdgeMesh.fromObject(roundedBoxFromWorldBox(box, color, params, polyBudget))
}
