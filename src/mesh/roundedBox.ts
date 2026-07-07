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

/** Catmull-Clark levels required before SDF rounding reads as a rounded box (not spiky corners). */
export const MIN_ROUNDED_BOX_SUBDIVISIONS = 2

function resolveRoundedBoxSubdivisions(
  params: RoundedBoxParams,
  polyBudget: number | undefined,
  vertexCount: number
): number {
  let subs = clampRoundedBoxSubdivisions(params.subdivisions)
  if (clampRoundness(params.roundness) > 0) {
    const budgetLevels =
      polyBudget != null ? maxSubdLevelsForBudget(polyBudget, vertexCount) : MIN_ROUNDED_BOX_SUBDIVISIONS
    subs = Math.max(subs, Math.min(MIN_ROUNDED_BOX_SUBDIVISIONS, budgetLevels))
  }
  if (polyBudget != null) {
    subs = Math.min(subs, maxRoundedBoxSubdivisionsForBudget(polyBudget))
  }
  if (subs > 0) {
    subs = Math.min(subs, maxSubdLevelsForBudget(polyBudget ?? 48, vertexCount))
  }
  return subs
}

function buildRoundedBoxObject(
  obj: SceneObject,
  targetCenter: Vec3,
  targetHalf: Vec3,
  params: RoundedBoxParams,
  polyBudget?: number
): SceneObject {
  let out = obj
  const subs = resolveRoundedBoxSubdivisions(params, polyBudget, out.positions.length)
  if (subs > 0) {
    out = subdivideSurfaceLevels(out, subs)
  }
  if (clampRoundness(params.roundness) > 0) {
    applyRoundedBoxDeform(out, targetCenter, targetHalf, params.roundness)
  }
  out.smoothShading = false
  return out
}

/** Scale a point onto the axis-aligned box shell (avoids radial SDF hub spikes on faces). */
export function projectToBoxShell(
  lx: number,
  ly: number,
  lz: number,
  hx: number,
  hy: number,
  hz: number
): Vec3 {
  const t = Math.max(Math.abs(lx) / hx, Math.abs(ly) / hy, Math.abs(lz) / hz, 1e-8)
  return { x: lx / t, y: ly / t, z: lz / t }
}

/** Symmetric shell point → rounded-box surface (identical fillets on all eight corners). */
export function shellToRoundedBox(
  shell: Vec3,
  hx: number,
  hy: number,
  hz: number,
  r: number
): Vec3 {
  const sx = shell.x >= 0 ? 1 : -1
  const sy = shell.y >= 0 ? 1 : -1
  const sz = shell.z >= 0 ? 1 : -1
  const ax = Math.abs(shell.x)
  const ay = Math.abs(shell.y)
  const az = Math.abs(shell.z)

  const bx = Math.max(hx - r, 0)
  const by = Math.max(hy - r, 0)
  const bz = Math.max(hz - r, 0)

  const qx = ax - bx
  const qy = ay - by
  const qz = az - bz

  if (qx > 0 && qy > 0 && qz > 0) {
    const ox = sx * bx
    const oy = sy * by
    const oz = sz * bz
    const dx = sx * hx - ox
    const dy = sy * hy - oy
    const dz = sz * hz - oz
    const len = Math.hypot(dx, dy, dz)
    return { x: ox + (dx / len) * r, y: oy + (dy / len) * r, z: oz + (dz / len) * r }
  }

  if (qx > 0 && qy > 0 && qz <= 0) {
    const ox = sx * bx
    const oy = sy * by
    const dx = sx * hx - ox
    const dy = sy * hy - oy
    const len = Math.hypot(dx, dy)
    return { x: ox + (dx / len) * r, y: oy + (dy / len) * r, z: shell.z }
  }

  if (qx > 0 && qy <= 0 && qz > 0) {
    const ox = sx * bx
    const oz = sz * bz
    const dx = sx * hx - ox
    const dz = sz * hz - oz
    const len = Math.hypot(dx, dz)
    return { x: ox + (dx / len) * r, y: shell.y, z: oz + (dz / len) * r }
  }

  if (qx <= 0 && qy > 0 && qz > 0) {
    const oy = sy * by
    const oz = sz * bz
    const dy = sy * hy - oy
    const dz = sz * hz - oz
    const len = Math.hypot(dy, dz)
    return { x: shell.x, y: oy + (dy / len) * r, z: oz + (dz / len) * r }
  }

  if (qx > 0 && qy <= 0 && qz <= 0) {
    return { x: sx * hx, y: shell.y, z: shell.z }
  }
  if (qx <= 0 && qy > 0 && qz <= 0) {
    return { x: shell.x, y: sy * hy, z: shell.z }
  }
  if (qx <= 0 && qy <= 0 && qz > 0) {
    return { x: shell.x, y: shell.y, z: sz * hz }
  }

  return shell
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
    const shell = projectToBoxShell(lx, ly, lz, half.x, half.y, half.z)
    const surf = shellToRoundedBox(shell, half.x, half.y, half.z, r)
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
  const { center, half } = boundsCenterHalf(obj)
  return buildRoundedBoxObject(obj, center, half, params, polyBudget)
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
  const obj = mesh.toObject('temp', 'RoundedBox', {
    color,
    polyBudget: polyBudget ?? 48,
    polyBudgetMode: 'strict',
    smoothShading: false,
  })
  return buildRoundedBoxObject(obj, center, half, params, polyBudget)
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
