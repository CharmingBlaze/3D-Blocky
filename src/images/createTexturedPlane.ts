import { HalfEdgeMesh, type SceneObject } from '../mesh/HalfEdgeMesh'
import { identityFaceGroups } from '../mesh/faceGroups'
import { isOrthoView, normalizeViewType, type OrthoViewType } from '../primitives/viewAxes'
import type { ViewType } from '../scene/viewTypes'
import { generateId, type Vec3 } from '../utils/math'
import { uv2, type Uv2 } from '../uv/uvTypes'

function localQuadCorners(view: OrthoViewType, halfWidth: number, halfHeight: number): Vec3[] {
  switch (view) {
    case 'front':
      return [
        { x: -halfWidth, y: -halfHeight, z: 0 },
        { x: halfWidth, y: -halfHeight, z: 0 },
        { x: halfWidth, y: halfHeight, z: 0 },
        { x: -halfWidth, y: halfHeight, z: 0 },
      ]
    case 'back':
      return [
        { x: halfWidth, y: -halfHeight, z: 0 },
        { x: -halfWidth, y: -halfHeight, z: 0 },
        { x: -halfWidth, y: halfHeight, z: 0 },
        { x: halfWidth, y: halfHeight, z: 0 },
      ]
    case 'right':
      return [
        { x: 0, y: -halfHeight, z: -halfWidth },
        { x: 0, y: -halfHeight, z: halfWidth },
        { x: 0, y: halfHeight, z: halfWidth },
        { x: 0, y: halfHeight, z: -halfWidth },
      ]
    case 'left':
      return [
        { x: 0, y: -halfHeight, z: halfWidth },
        { x: 0, y: -halfHeight, z: -halfWidth },
        { x: 0, y: halfHeight, z: -halfWidth },
        { x: 0, y: halfHeight, z: halfWidth },
      ]
    case 'top':
      return [
        { x: -halfWidth, y: 0, z: -halfHeight },
        { x: halfWidth, y: 0, z: -halfHeight },
        { x: halfWidth, y: 0, z: halfHeight },
        { x: -halfWidth, y: 0, z: halfHeight },
      ]
    case 'bottom':
      return [
        { x: -halfWidth, y: 0, z: halfHeight },
        { x: halfWidth, y: 0, z: halfHeight },
        { x: halfWidth, y: 0, z: -halfHeight },
        { x: -halfWidth, y: 0, z: -halfHeight },
      ]
  }
}

/**
 * Full-bleed image UVs in face winding order (BL → BR → TR → TL).
 * Matches Three.js / DataTexture flipY so the photo reads upright from the front.
 */
export const FULL_IMAGE_FACE_UVS: readonly Uv2[] = [
  uv2(0, 0),
  uv2(1, 0),
  uv2(1, 1),
  uv2(0, 1),
]

/**
 * Back-face UVs for a reversed-winding quad so the image stays upright and
 * left→right when you look at the reverse side (same rotation as the front).
 * Face corners are v0,v3,v2,v1 relative to the front's v0,v1,v2,v3.
 */
export const BACK_IMAGE_FACE_UVS: readonly Uv2[] = [
  uv2(1, 0),
  uv2(1, 1),
  uv2(0, 1),
  uv2(0, 0),
]

/** World width × height that preserve image aspect for a given target width. */
export function planeSizeFromAspect(
  worldWidth: number,
  aspect: number
): { width: number; height: number } {
  const safeAspect = Math.max(aspect, 1e-6)
  return { width: worldWidth, height: worldWidth / safeAspect }
}

/** True when front uses FULL_IMAGE_FACE_UVS and back uses BACK_IMAGE_FACE_UVS. */
export function hasMatchingFullImageFaceUVs(obj: SceneObject): boolean {
  const uvs = obj.uvs
  const faceUv = obj.faceUvIndices
  if (!uvs?.length || faceUv?.length !== 2) return false
  const expectedFaces = [FULL_IMAGE_FACE_UVS, BACK_IMAGE_FACE_UVS]
  for (let f = 0; f < 2; f++) {
    const indices = faceUv[f]!
    const expected = expectedFaces[f]!
    if (indices.length !== 4) return false
    for (let i = 0; i < 4; i++) {
      const uv = uvs[indices[i]!]
      const e = expected[i]!
      if (!uv || Math.abs(uv.u - e.u) > 1e-6 || Math.abs(uv.v - e.v) > 1e-6) {
        return false
      }
    }
  }
  return true
}

export function createTexturedPlaneObject(
  name: string,
  view: ViewType,
  center: Vec3,
  worldWidth: number,
  aspect: number,
  textureDocId?: string
): SceneObject {
  const { width, height } = planeSizeFromAspect(worldWidth, aspect)
  const halfW = width / 2
  const halfH = height / 2
  const ortho = isOrthoView(view) ? (normalizeViewType(view) as OrthoViewType) : 'top'
  const corners = localQuadCorners(ortho, halfW, halfH)

  const mesh = new HalfEdgeMesh()
  const indices = corners.map((c) => {
    mesh.positions.push({ ...c })
    return mesh.positions.length - 1
  })

  const color = 0xffffff
  // Front + back faces (FrontSide material) so each side is visible without DoubleSide z-fighting.
  mesh.faces.push([indices[0], indices[1], indices[2], indices[3]])
  mesh.faceColors.push(color)
  mesh.faces.push([indices[0], indices[3], indices[2], indices[1]])
  mesh.faceColors.push(color)
  mesh.buildHalfEdges()

  // Independent full-image UVs per face — back compensates for reversed winding
  // so both sides read upright with the same rotation.
  const uvs = [
    ...FULL_IMAGE_FACE_UVS.map((uv) => ({ ...uv })),
    ...BACK_IMAGE_FACE_UVS.map((uv) => ({ ...uv })),
  ]
  const faceUvIndices = [
    [0, 1, 2, 3],
    [4, 5, 6, 7],
  ]

  return {
    id: generateId(),
    name,
    positions: mesh.positions.map((p) => ({ ...p })),
    faces: mesh.faces.map((f) => [...f]),
    faceColors: [...mesh.faceColors],
    faceGroups: identityFaceGroups(mesh.faces.length),
    uvs,
    faceUvIndices,
    // Keep these exact UVs — needsUvRepack would otherwise pack two full-square faces away.
    uvMappingMode: 'perFace',
    uvAutoPacked: true,
    topologyLocked: false,
    polyBudget: 128,
    polyBudgetMode: 'strict',
    smoothShading: false,
    facetExaggeration: 0,
    color,
    material: {
      mode: 'texture',
      textureId: textureDocId ?? '',
      textureWrap: 'clamp',
      textureRepeat: [1, 1],
      textureOffset: [0, 0],
      textureRotation: 0,
      textureTint: [1, 1, 1, 1],
      textureTintStrength: 0,
      opacity: 1,
      // Front + back are separate faces; DoubleSide would z-fight and hide PNG holes.
      doubleSided: false,
    },
    transform: {
      position: { ...center },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
  }
}

/** Build an aspect-correct image plane linked to an existing pixel/scene texture document. */
export function createEditableImagePlaneObject(
  name: string,
  view: ViewType,
  center: Vec3,
  worldWidth: number,
  imageWidth: number,
  imageHeight: number,
  textureDocId: string
): SceneObject {
  const aspect = imageWidth / Math.max(imageHeight, 1)
  return createTexturedPlaneObject(name, view, center, worldWidth, aspect, textureDocId)
}
