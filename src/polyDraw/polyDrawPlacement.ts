import * as THREE from 'three'
import type { SceneObject } from '../mesh/HalfEdgeMesh'
import type { ViewType } from '../store/appStore'
import type { Vec3 } from '../utils/math'
import { clientToGroundPlane, clientToWorkPlane, planeToWorld3D } from '../utils/screenToWorld'
import {
  isOrthoView,
  axisComponent,
  heightAxisForView,
} from '../primitives/viewAxes'
import { ensureTransform, getObjectPivot } from '../mesh/objectTransform'

const _ndc = new THREE.Vector2()
const _raycaster = new THREE.Raycaster()
const _v0 = new THREE.Vector3()
const _v1 = new THREE.Vector3()
const _v2 = new THREE.Vector3()
const _hit = new THREE.Vector3()

function rayFromPointer(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  camera: THREE.Camera
): THREE.Ray {
  _ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1
  _ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1
  _raycaster.setFromCamera(_ndc, camera)
  return _raycaster.ray
}

function getObjectLocalMatrix(obj: SceneObject): THREE.Matrix4 {
  const pivot = getObjectPivot(obj)
  const tr = ensureTransform(obj)
  return new THREE.Matrix4()
    .makeTranslation(tr.position.x, tr.position.y, tr.position.z)
    .multiply(
      new THREE.Matrix4().makeRotationFromEuler(
        new THREE.Euler(tr.rotation.x, tr.rotation.y, tr.rotation.z, 'XYZ')
      )
    )
    .multiply(new THREE.Matrix4().makeScale(tr.scale.x, tr.scale.y, tr.scale.z))
    .multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z))
}

function raycastSceneSurface(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  camera: THREE.Camera,
  objects: SceneObject[]
): Vec3 | null {
  const ray = rayFromPointer(clientX, clientY, rect, camera)
  let bestT = Infinity
  let bestWorld: Vec3 | null = null

  for (const obj of objects) {
    const matrix = getObjectLocalMatrix(obj)
    const inv = matrix.clone().invert()
    const rayLocal = ray.clone().applyMatrix4(inv)

    for (const face of obj.faces) {
      if (face.length < 3) continue
      for (let i = 1; i < face.length - 1; i++) {
        const a = obj.positions[face[0]]
        const b = obj.positions[face[i]]
        const c = obj.positions[face[i + 1]]
        _v0.set(a.x, a.y, a.z)
        _v1.set(b.x, b.y, b.z)
        _v2.set(c.x, c.y, c.z)
        const hit = rayLocal.intersectTriangle(_v0, _v1, _v2, false, _hit)
        if (!hit) continue
        const t = rayLocal.origin.distanceTo(hit)
        if (t < bestT) {
          bestT = t
          hit.applyMatrix4(matrix)
          bestWorld = { x: hit.x, y: hit.y, z: hit.z }
        }
      }
    }
  }

  return bestWorld
}

/** Resolve a free (non-snapped) click to a world-space point. */
export function resolveFreeClickWorld(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  camera: THREE.Camera,
  view: ViewType,
  workPlaneDepth: number,
  existingPoints: Vec3[],
  objects: SceneObject[]
): Vec3 {
  if (view === 'perspective') {
    const surface = raycastSceneSurface(clientX, clientY, rect, camera, objects)
    if (surface) return surface
    const ground = clientToGroundPlane(clientX, clientY, rect, camera, workPlaneDepth)
    if (ground) return ground
    return { x: 0, y: workPlaneDepth, z: 0 }
  }

  if (!isOrthoView(view)) {
    return { x: 0, y: 0, z: 0 }
  }

  const plane = clientToWorkPlane(clientX, clientY, rect, camera, view, workPlaneDepth)
  if (!plane) {
    return planeToWorld3D(0, 0, view, workPlaneDepth)
  }

  let depth = workPlaneDepth
  if (existingPoints.length > 0) {
    const depthAxis = heightAxisForView(view)
    depth = axisComponent(existingPoints[existingPoints.length - 1], depthAxis)
  }

  return planeToWorld3D(plane.x, plane.y, view, depth)
}

/** Work-plane depth for continuing clicks in the same ortho view. */
export function workPlaneDepthForView(
  view: ViewType,
  draftPoints: Vec3[],
  globalDefault: number
): number {
  if (draftPoints.length === 0) return globalDefault
  if (!isOrthoView(view)) return globalDefault
  const depthAxis = heightAxisForView(view)
  return axisComponent(draftPoints[0], depthAxis)
}
