import * as THREE from 'three'
import type { SceneObject } from '../mesh/HalfEdgeMesh'
import type { Uv2 } from './uvTypes'

type UvWritePlan = {
  /** For each geometry UV slot: source pool index, or -1 if unused. */
  poolIndexPerSlot: Int32Array
  slotCount: number
  flatShading: boolean
  faceCount: number
  uvCornerCount: number
}

const planByGeometry = new WeakMap<THREE.BufferGeometry, UvWritePlan>()

function countUvCorners(object: SceneObject): number {
  let n = 0
  for (let fi = 0; fi < object.faces.length; fi++) n += object.faces[fi]?.length ?? 0
  return n
}

function buildFlatPlan(object: SceneObject): Int32Array {
  const corners = countUvCorners(object)
  const poolIndexPerSlot = new Int32Array(corners)
  let offset = 0
  for (let fi = 0; fi < object.faces.length; fi++) {
    const face = object.faces[fi]!
    for (let ci = 0; ci < face.length; ci++) {
      poolIndexPerSlot[offset++] = object.faceUvIndices?.[fi]?.[ci] ?? 0
    }
  }
  return poolIndexPerSlot
}

function buildSmoothPlan(object: SceneObject): Int32Array {
  const weldMap = new Map<string, number>()
  const indices: number[] = []
  for (let fi = 0; fi < object.faces.length; fi++) {
    const face = object.faces[fi]!
    for (let ci = 0; ci < face.length; ci++) {
      const vi = face[ci]!
      const uvIdx = object.faceUvIndices?.[fi]?.[ci] ?? 0
      const key = `${vi}:${uvIdx}`
      if (weldMap.has(key)) continue
      weldMap.set(key, indices.length)
      indices.push(uvIdx)
    }
  }
  return Int32Array.from(indices)
}

function getWritePlan(
  geometry: THREE.BufferGeometry,
  object: SceneObject,
  flatShading: boolean
): UvWritePlan {
  const faceCount = object.faces.length
  const uvCornerCount = countUvCorners(object)
  const cached = planByGeometry.get(geometry)
  if (
    cached &&
    cached.flatShading === flatShading &&
    cached.faceCount === faceCount &&
    cached.uvCornerCount === uvCornerCount
  ) {
    return cached
  }

  const poolIndexPerSlot = flatShading ? buildFlatPlan(object) : buildSmoothPlan(object)
  const plan: UvWritePlan = {
    poolIndexPerSlot,
    slotCount: poolIndexPerSlot.length,
    flatShading,
    faceCount,
    uvCornerCount,
  }
  planByGeometry.set(geometry, plan)
  return plan
}

/**
 * Patch rendered mesh UVs in-place from a UV pool.
 * Uses a cached write plan so live UV dragging does not rebuild weld maps every frame.
 */
export function patchMeshGeometryUvs(
  geometry: THREE.BufferGeometry,
  object: SceneObject,
  uvs: readonly Uv2[],
  flatShading: boolean
): boolean {
  const attr = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined
  if (!attr || !object.faceUvIndices?.length || object.faces.length === 0) return false

  const plan = getWritePlan(geometry, object, flatShading)
  const arr = attr.array as Float32Array
  const { poolIndexPerSlot, slotCount } = plan

  for (let slot = 0; slot < slotCount; slot++) {
    const uvIdx = poolIndexPerSlot[slot]!
    const uv = uvs[uvIdx] ?? { u: 0, v: 0 }
    const o = slot * 2
    arr[o] = uv.u
    arr[o + 1] = uv.v
  }

  attr.needsUpdate = true
  return true
}

/** Drop cached write plans (tests / geometry rebuild). */
export function clearMeshGeometryUvWritePlansForTests(): void {
  // WeakMap cannot be cleared; plans are geometry-scoped and refresh on topology change.
}
