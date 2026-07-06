import { faceNormal, type Vec3 } from '../utils/math'
import type { SceneObject } from '../mesh/HalfEdgeMesh'
import { isSketchDoodleObject } from '../stroke/sketchSource'
import { isVectorDoodleObject } from '../vector/vectorSource'
import { planarProjectFaceUVs } from './uvEditing'
import type { Uv2 } from './uvTypes'
import { cloneUv2, uv2 } from './uvTypes'
import { autoUnwrapObject as autoUnwrapMesh, unwrapSelectedFaces, AUTO_SEAM_ANGLE_DEG } from './uvUnwrap'
import { needsUvRepack, needsDoodleUvRepack } from './uvAuto'

export type UvMappingMode = 'box' | 'perFace'
export type SceneObjectWithUVs = SceneObject & { uvs: Uv2[]; faceUvIndices: number[][] }

/** Sketch/pen extruded meshes — use directional Blockbench atlas instead of smart UV. */
export function isDoodleLikeObject(obj: SceneObject): boolean {
  return isSketchDoodleObject(obj) || isVectorDoodleObject(obj)
}

export function resolveUvMappingMode(obj: SceneObject): UvMappingMode {
  return obj.uvMappingMode ?? 'perFace'
}

function ensureUvTopology(obj: SceneObject): SceneObjectWithUVs {
  if (obj.uvs?.length && obj.faceUvIndices?.length === obj.faces.length) {
    return obj as SceneObjectWithUVs
  }
  const uvs: Uv2[] = []
  const faceUvIndices: number[][] = []
  for (const face of obj.faces) {
    const indices: number[] = []
    for (let i = 0; i < face.length; i++) {
      indices.push(uvs.length)
      uvs.push({ u: 0, v: 0 })
    }
    faceUvIndices.push(indices)
  }
  return { ...obj, uvs, faceUvIndices }
}

/** Automatic seams + packing — no manual seam marking. */
export function autoUnwrapObject(obj: SceneObject): SceneObjectWithUVs {
  const base = ensureUvTopology(obj)
  const { uvs, faceUvIndices, uvAutoPacked } = autoUnwrapMesh(base, AUTO_SEAM_ANGLE_DEG)
  return {
    ...base,
    uvs,
    faceUvIndices,
    uvAutoPacked: uvAutoPacked ?? true,
  }
}

export function ensureObjectUVs(obj: SceneObject): SceneObjectWithUVs {
  if (needsDoodleUvRepack(obj)) {
    const base = ensureUvTopology(obj)
    const allFaces = base.faces.map((_, i) => i)
    const { uvs, faceUvIndices, uvAutoPacked } = unwrapSelectedFaces(
      base,
      allFaces,
      'blockbench',
      { angleLimitDeg: AUTO_SEAM_ANGLE_DEG, margin: 0.04, repackAll: true, markPacked: true }
    )
    return {
      ...base,
      uvs,
      faceUvIndices,
      uvMappingMode: 'perFace',
      uvAutoPacked: uvAutoPacked ?? true,
    }
  }
  if (!obj.uvs?.length || obj.faceUvIndices?.length !== obj.faces.length || needsUvRepack(obj)) {
    return autoUnwrapObject(obj)
  }
  return obj as SceneObjectWithUVs
}

export function packFaceUvIslandsForObject(obj: SceneObject): SceneObject {
  return autoUnwrapObject(obj)
}

export function assignUvMappingForMode(obj: SceneObject, mode: UvMappingMode, packIslands = false): SceneObject {
  const mapped = mode === 'box' ? assignBoxFaceUVs(obj) : assignPlanarUVs(obj)
  if (!packIslands || !mapped.uvs?.length || !mapped.faceUvIndices?.length) return mapped
  const allFaces = mapped.faces.map((_, i) => i)
  const method = mode === 'box' || isDoodleLikeObject(mapped) ? 'blockbench' : 'auto'
  const { uvs, faceUvIndices, uvAutoPacked } = unwrapSelectedFaces(
    mapped as SceneObjectWithUVs,
    allFaces,
    method,
    { angleLimitDeg: AUTO_SEAM_ANGLE_DEG, margin: 0.02, repackAll: true, markPacked: true }
  )
  return { ...mapped, uvs, faceUvIndices, uvAutoPacked: uvAutoPacked ?? true }
}

export function cloneObjectUVs(obj: SceneObject): { uvs: Uv2[]; faceUvIndices: number[][] } {
  return {
    uvs: (obj.uvs ?? []).map(cloneUv2),
    faceUvIndices: (obj.faceUvIndices ?? []).map((f) => [...f]),
  }
}

export function assignPlanarUVs(obj: SceneObject): SceneObject {
  const uvs: Uv2[] = []
  const faceUvIndices: number[][] = []

  for (const face of obj.faces) {
    const corners = face.map((vi) => obj.positions[vi])
    const normal = faceNormal(corners[0], corners[1], corners[2])
    const projected = planarProjectFaceUVs(normal, corners)
    const indices: number[] = []
    for (const p of projected) {
      indices.push(uvs.length)
      uvs.push(p)
    }
    faceUvIndices.push(indices)
  }

  return { ...obj, uvs, faceUvIndices, uvMappingMode: 'perFace' as const }
}

/** Per-face 0..1 square unwrap (Blockbench cube default). */
export function assignBoxFaceUVs(obj: SceneObject): SceneObject {
  const uvs: Uv2[] = []
  const faceUvIndices: number[][] = []

  for (const face of obj.faces) {
    const indices: number[] = []
    const n = face.length
    for (let i = 0; i < n; i++) {
      indices.push(uvs.length)
      uvs.push(cloneUv2(boxUVsForCornerCount(n, i)))
    }
    faceUvIndices.push(indices)
  }

  return { ...obj, uvs, faceUvIndices, uvMappingMode: 'box' as const }
}

/** UV corners for one face in box mode (0–1 unit square). */
export function boxUVsForCornerCount(cornerCount: number, cornerIndex: number): Uv2 {
  const square = [uv2(0, 0), uv2(1, 0), uv2(1, 1), uv2(0, 1)]
  if (cornerCount === 3) {
    const tri = [uv2(0, 0), uv2(1, 0), uv2(0.5, 1)]
    return tri[cornerIndex] ?? uv2(0, 0)
  }
  if (cornerCount === 4) {
    return square[cornerIndex] ?? uv2(0, 0)
  }
  const t = cornerCount <= 1 ? 0 : cornerIndex / (cornerCount - 1)
  const u = t <= 0.5 ? t * 2 : 1
  const v = t <= 0.5 ? 0 : (t - 0.5) * 2
  return uv2(u, v)
}

export function getFaceUvIndices(obj: SceneObject, faceIndex: number): number[] {
  const ensured = ensureObjectUVs(obj)
  return [...(ensured.faceUvIndices[faceIndex] ?? [])]
}

export function getFaceUVs(obj: SceneObject, faceIndex: number): Uv2[] {
  const ensured = ensureObjectUVs(obj)
  const idx = ensured.faceUvIndices[faceIndex] ?? []
  return idx.map((i) => cloneUv2(ensured.uvs[i]))
}

export function setUvPoint(obj: SceneObject, uvIndex: number, u: number, v: number): SceneObject {
  const uvs = (obj.uvs ?? []).map(cloneUv2)
  if (uvIndex < 0 || uvIndex >= uvs.length) return obj
  uvs[uvIndex] = { u, v }
  return { ...obj, uvs }
}

export function setUvPoints(
  obj: SceneObject,
  updates: Array<{ uvIndex: number; u: number; v: number }>
): SceneObject {
  if (updates.length === 0) return obj
  const uvs = (obj.uvs ?? []).map(cloneUv2)
  for (const { uvIndex, u, v } of updates) {
    if (uvIndex >= 0 && uvIndex < uvs.length) uvs[uvIndex] = { u, v }
  }
  return { ...obj, uvs }
}

export function collectUvIndicesForFaces(obj: SceneObject, faceIndices: number[]): number[] {
  const ensured = ensureObjectUVs(obj)
  const set = new Set<number>()
  for (const fi of faceIndices) {
    for (const ui of ensured.faceUvIndices[fi] ?? []) set.add(ui)
  }
  return [...set]
}

/** Duplicate UV corners shared with unselected faces so selected faces can move independently. */
export function detachFacesUvTopology(
  obj: SceneObject,
  faceIndices: number[]
): SceneObjectWithUVs {
  const base = ensureObjectUVs(obj)
  if (faceIndices.length === 0) return base

  const selected = new Set(faceIndices)
  const uvs = base.uvs.map(cloneUv2)
  const faceUvIndices = base.faceUvIndices.map((f) => [...f])

  for (const fi of faceIndices) {
    const cornerIndices = faceUvIndices[fi]
    if (!cornerIndices) continue
    for (let ci = 0; ci < cornerIndices.length; ci++) {
      const ui = cornerIndices[ci]!
      let sharedWithOutside = false
      for (let otherFi = 0; otherFi < faceUvIndices.length; otherFi++) {
        if (selected.has(otherFi)) continue
        if (faceUvIndices[otherFi]?.includes(ui)) {
          sharedWithOutside = true
          break
        }
      }
      if (!sharedWithOutside) continue
      const newUi = uvs.length
      uvs.push(cloneUv2(uvs[ui]!))
      cornerIndices[ci] = newUi
    }
  }

  return { ...base, uvs, faceUvIndices }
}

export function faceCorners3D(obj: SceneObject, faceIndex: number): Vec3[] {
  const face = obj.faces[faceIndex]
  if (!face) return []
  return face.map((vi) => ({ ...obj.positions[vi] }))
}

export function faceNormal3D(obj: SceneObject, faceIndex: number): Vec3 {
  const corners = faceCorners3D(obj, faceIndex)
  if (corners.length < 3) return { x: 0, y: 1, z: 0 }
  return faceNormal(corners[0], corners[1], corners[2])
}
