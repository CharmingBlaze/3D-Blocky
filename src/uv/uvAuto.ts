import type { SceneObject } from '../mesh/HalfEdgeMesh'
import { isSketchDoodleObject } from '../stroke/sketchSource'
import { isVectorDoodleObject } from '../vector/vectorSource'
import { uvBoundsFromIndices } from './uvEditing'

/** Heuristic: many faces share the same full-texture 0–1 bounds → unpaked overlap. */
export function needsUvRepack(obj: SceneObject): boolean {
  if (obj.uvMappingMode === 'box') return false
  if (obj.uvAutoPacked) return false
  if (!obj.uvs?.length || !obj.faceUvIndices?.length) return true
  if (obj.faces.length <= 1) return false

  let fullSquare = 0
  for (let fi = 0; fi < obj.faces.length; fi++) {
    const idx = obj.faceUvIndices?.[fi] ?? []
    if (idx.length === 0) continue
    const b = uvBoundsFromIndices(obj.uvs, idx)
    const w = b.maxU - b.minU
    const h = b.maxV - b.minV
    if (w > 0.85 && h > 0.85 && b.minU < 0.08 && b.minV < 0.08) fullSquare++
  }
  return fullSquare >= Math.max(2, Math.floor(obj.faces.length * 0.25))
}

/** Doodle meshes need bucket Blockbench layout instead of smart/per-face scatter. */
export function needsDoodleUvRepack(obj: SceneObject): boolean {
  if (!isSketchDoodleObject(obj) && !isVectorDoodleObject(obj)) return false
  if (!obj.uvs?.length || !obj.faceUvIndices?.length) return true
  if (!obj.uvAutoPacked) return true
  if (obj.faces.length <= 3) return false

  let tinyIslands = 0
  let fullSquare = 0
  let checked = 0
  for (let fi = 0; fi < obj.faces.length; fi++) {
    const idx = obj.faceUvIndices[fi] ?? []
    if (idx.length === 0) continue
    checked++
    const b = uvBoundsFromIndices(obj.uvs, idx)
    const w = b.maxU - b.minU
    const h = b.maxV - b.minV
    if (w < 0.12 && h < 0.12) tinyIslands++
    if (w > 0.85 && h > 0.85 && b.minU < 0.08 && b.minV < 0.08) fullSquare++
  }
  if (checked < 4) return false
  if (tinyIslands / checked > 0.5) return true
  return fullSquare >= Math.max(2, Math.floor(checked * 0.25))
}
