import type { SceneObject } from '../mesh/HalfEdgeMesh'
import { assignPlanarUVs, type SceneObjectWithUVs } from '../uv/uvObject'
import { unwrapSelectedFaces } from '../uv/uvUnwrap'

/**
 * Build a paint-safe atlas: every mesh face owns unique, non-overlapping UV
 * space. This is intentionally different from organic Smart UV, where welded
 * islands are useful for texturing but can overlap after aggressive flattening.
 */
export function preparePixelPaintUvLayout(obj: SceneObject): SceneObject {
  const seeded = assignPlanarUVs(obj) as SceneObjectWithUVs
  const faces = seeded.faces.map((_, index) => index)
  const result = unwrapSelectedFaces(seeded, faces, 'planar', {
    margin: 0.02,
    repackAll: true,
    markPacked: true,
  })
  return {
    ...obj,
    uvs: result.uvs,
    faceUvIndices: result.faceUvIndices,
    uvMappingMode: 'perFace',
    uvAutoPacked: true,
  }
}
