import type * as THREE from 'three'
import type { SceneObject } from './HalfEdgeMesh'
import {
  expandFaceToPlanarRegion,
  getFaceGroupMap,
  type FaceGroup,
} from './faceGroups'
import { isFaceFrontFacing } from './overlayVisibility'

export type FaceOverlayGroup = FaceGroup

export function buildFaceOverlayGroups(
  object: SceneObject,
  onlyGroupIds?: number[]
): FaceOverlayGroup[] {
  const { groups } = getFaceGroupMap(object)
  if (onlyGroupIds === undefined) return groups
  const allowed = new Set(onlyGroupIds)
  return groups.filter((g) => allowed.has(g.id))
}

export function resolveFaceOverlayGroupState(
  group: FaceOverlayGroup,
  objectId: string,
  meshSelection: { objectId: string; faces: number[] } | null,
  meshHover: { objectId: string; face?: number } | null,
  faceToGroup: number[]
): 'idle' | 'hover' | 'selected' {
  if (meshSelection?.objectId === objectId) {
    if (group.faceIndices.some((fi) => meshSelection.faces.includes(fi))) {
      return 'selected'
    }
  }
  if (meshHover?.objectId === objectId && meshHover.face !== undefined) {
    if (faceToGroup[meshHover.face] === group.id) return 'hover'
  }
  return 'idle'
}

export function collectHighlightedFaceIndices(
  object: SceneObject,
  selectedFaces: number[] | undefined,
  hoverFace: number | undefined
): Set<number> {
  const out = new Set<number>()
  if (selectedFaces?.length) {
    for (const fi of selectedFaces) out.add(fi)
  }
  if (hoverFace !== undefined) {
    for (const fi of expandFaceToPlanarRegion(object, hoverFace)) out.add(fi)
  }
  return out
}

/** Pick / marquee: skip face regions with no front-facing triangle (X-ray off). */
export function isFaceOverlayGroupPickable(
  object: SceneObject,
  group: FaceOverlayGroup,
  camera: THREE.Camera
): boolean {
  return group.faceIndices.some((fi) => isFaceFrontFacing(object, fi, camera))
}

export function allFaceOverlayIndices(groups: FaceOverlayGroup[]): number[] {
  return groups.flatMap((g) => g.faceIndices)
}
