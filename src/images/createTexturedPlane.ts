import { HalfEdgeMesh, type SceneObject } from '../mesh/HalfEdgeMesh'
import { identityFaceGroups } from '../mesh/faceGroups'
import type { ViewType } from '../store/appStore'
import { isOrthoView, normalizeViewType, type OrthoViewType } from '../primitives/viewAxes'
import { generateId, type Vec3 } from '../utils/math'
import { uv2 } from '../uv/uvTypes'

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

export function createTexturedPlaneObject(
  name: string,
  view: ViewType,
  center: Vec3,
  worldWidth: number,
  aspect: number
): SceneObject {
  const halfW = worldWidth / 2
  const halfH = worldWidth / aspect / 2
  const ortho = isOrthoView(view) ? normalizeViewType(view) as OrthoViewType : 'top'
  const corners = localQuadCorners(ortho, halfW, halfH)

  const mesh = new HalfEdgeMesh()
  const indices = corners.map((c) => {
    mesh.positions.push({ ...c })
    return mesh.positions.length - 1
  })

  const color = 0xffffff
  mesh.faces.push([indices[0], indices[1], indices[2], indices[3]])
  mesh.faceColors.push(color)
  mesh.faces.push([indices[0], indices[3], indices[2], indices[1]])
  mesh.faceColors.push(color)
  mesh.buildHalfEdges()

  const uvs = [uv2(0, 1), uv2(1, 1), uv2(1, 0), uv2(0, 0)]
  const faceUvIndices = [
    [0, 1, 2, 3],
    [0, 3, 2, 1],
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
    uvMappingMode: 'box',
    topologyLocked: false,
    polyBudget: 128,
    polyBudgetMode: 'strict',
    smoothShading: false,
    facetExaggeration: 0,
    color,
    transform: {
      position: { ...center },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
  }
}
