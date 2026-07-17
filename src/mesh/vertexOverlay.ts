import * as THREE from 'three'
import type { SceneObject } from './HalfEdgeMesh'
import { localPointFromWorld, worldPointFromObject } from './objectTransform'
import { collectCoincidentVertexGroups, groupCoincidentVertexIndices } from './meshTopology'
import { edgeKey } from './meshSelection'
import { getMeshAdjacency } from './meshAdjacencyCache'
import {
  buildVertexToFacesMap,
  isBoundaryOrDoubleSidedEdge,
  isFaceFrontFacing,
} from './overlayVisibility'

const _world = new THREE.Vector3()
const _viewDir = new THREE.Vector3()

/** One screen handle per welded position (box corners share 3 indices → 1 cube). */
export type VertexOverlayGroup = {
  key: string
  indices: number[]
  position: { x: number; y: number; z: number }
}

export function buildVertexOverlayGroups(
  object: SceneObject,
  onlyIndices?: number[]
): VertexOverlayGroup[] {
  const raw =
    onlyIndices !== undefined
      ? collectCoincidentVertexGroups(object, onlyIndices)
      : [...groupCoincidentVertexIndices(object).values()]

  return raw.map((indices) => {
    const position = object.positions[indices[0]!]!
    return {
      key: indices.join('+'),
      indices,
      position,
    }
  })
}

function viewDirectionToWorldPoint(camera: THREE.Camera, worldPoint: THREE.Vector3, out: THREE.Vector3): void {
  if (camera instanceof THREE.OrthographicCamera) {
    camera.getWorldDirection(out)
    out.negate()
    return
  }
  out.copy(camera.position).sub(worldPoint).normalize()
}

/** Pull handles slightly toward the camera so they clear the surface and near plane. */
export function vertexHandleLocalPosition(
  object: SceneObject,
  localPosition: { x: number; y: number; z: number },
  camera: THREE.Camera,
  surfaceEpsilon: number
): { x: number; y: number; z: number } {
  const world = worldPointFromObject(object, localPosition)
  _world.set(world.x, world.y, world.z)
  viewDirectionToWorldPoint(camera, _world, _viewDir)
  _world.addScaledVector(_viewDir, surfaceEpsilon)
  return localPointFromWorld(object, { x: _world.x, y: _world.y, z: _world.z })
}

/** Pick / marquee: skip verts with no front-facing adjacent face (X-ray off). */
export function isVertexOverlayGroupPickable(
  object: SceneObject,
  group: VertexOverlayGroup | number[],
  camera: THREE.Camera,
  vertexFaces = buildVertexToFacesMap(object)
): boolean {
  const indices = Array.isArray(group) ? group : group.indices
  let sawFace = false
  for (const vi of indices) {
    for (const fi of vertexFaces.get(vi) ?? []) {
      sawFace = true
      if (isFaceFrontFacing(object, fi, camera)) return true
    }
  }
  if (!sawFace) return true

  // Extruded edge tips only touch the bridge wall. Keep those boundary verts
  // selectable even when the wall is edge-on or facing away. After Make Double
  // Sided the wall has two reverse faces, so treat that thin sheet the same.
  const { edgeToFaces } = getMeshAdjacency(object)
  for (const vi of indices) {
    for (const fi of vertexFaces.get(vi) ?? []) {
      const face = object.faces[fi]
      if (!face) continue
      for (let i = 0; i < face.length; i++) {
        const a = face[i]!
        const b = face[(i + 1) % face.length]!
        if (a !== vi && b !== vi) continue
        if (isBoundaryOrDoubleSidedEdge(object, edgeToFaces.get(edgeKey(a, b)))) {
          return true
        }
      }
    }
  }

  return false
}

export function viewSpaceZ(camera: THREE.Camera, world: { x: number; y: number; z: number }): number {
  _world.set(world.x, world.y, world.z)
  _world.applyMatrix4(camera.matrixWorldInverse)
  return _world.z
}
