import * as THREE from 'three'
import type { ViewType } from '../store/appStore'
import type { OrthoViewType } from '../scene/viewTypes'
import {
  isOrthoView,
  normalizeViewType,
  ORTHO_VIEW_OPTIONS,
  getViewLabel,
} from '../scene/viewTypes'
import {
  orthoViewFromLegacy,
  planePointToWorld,
  worldToPlanePoint,
} from '../primitives/viewAxes'
import {
  planePointToStrokeFrame,
  worldPointToStrokePlane2D,
  type StrokePlaneFrame,
} from '../stroke/worldProjection'

const _raycaster = new THREE.Raycaster()
const _ndc = new THREE.Vector2()
const _hit = new THREE.Vector3()
const _normal = new THREE.Vector3()
const _right = new THREE.Vector3()
const _up = new THREE.Vector3()
const _forward = new THREE.Vector3()

function orthoWorkPlane(view: OrthoViewType, depth: number): THREE.Plane {
  switch (view) {
    case 'front':
      return new THREE.Plane(new THREE.Vector3(0, 0, 1), -depth)
    case 'back':
      return new THREE.Plane(new THREE.Vector3(0, 0, -1), depth)
    case 'right':
      return new THREE.Plane(new THREE.Vector3(1, 0, 0), -depth)
    case 'left':
      return new THREE.Plane(new THREE.Vector3(-1, 0, 0), depth)
    case 'top':
      return new THREE.Plane(new THREE.Vector3(0, 1, 0), -depth)
    case 'bottom':
      return new THREE.Plane(new THREE.Vector3(0, -1, 0), depth)
  }
}

function strokeOffset(view: OrthoViewType): Vec3 {
  const offset = 1
  switch (view) {
    case 'front':
      return { x: 0, y: 0, z: offset }
    case 'back':
      return { x: 0, y: 0, z: -offset }
    case 'right':
      return { x: offset, y: 0, z: 0 }
    case 'left':
      return { x: -offset, y: 0, z: 0 }
    case 'top':
      return { x: 0, y: offset, z: 0 }
    case 'bottom':
      return { x: 0, y: -offset, z: 0 }
  }
}

type Vec3 = { x: number; y: number; z: number }

/** Convert client mouse position to world-space point via camera unprojection */
export function clientToWorld(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  camera: THREE.Camera
): THREE.Vector3 {
  const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1
  const ndcY = -(((clientY - rect.top) / rect.height) * 2 - 1)
  const vec = new THREE.Vector3(ndcX, ndcY, 0)
  vec.unproject(camera)
  return vec
}

/** Raycast onto the orthographic work plane at the given depth-along-view. */
export function clientToWorkPlane(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  camera: THREE.Camera,
  view: OrthoViewType,
  depth = 0
): { x: number; y: number } | null {
  const plane = orthoWorkPlane(view, depth)
  const hit = clientToCameraPlane(clientX, clientY, rect, camera, plane)
  if (!hit) return null
  return worldToPlanePoint(view, { x: hit.x, y: hit.y, z: hit.z })
}

/**
 * Build a camera-facing stroke plane through a world focus point.
 * Right/up match the camera so cursor motion maps stably onto the plane.
 */
export function buildPerspectiveStrokeFrame(
  camera: THREE.Camera,
  throughPoint: { x: number; y: number; z: number }
): StrokePlaneFrame {
  camera.updateMatrixWorld()
  camera.matrixWorld.extractBasis(_right, _up, _forward)
  _right.normalize()
  camera.getWorldDirection(_normal)
  // Plane normal faces the camera (opposite look direction).
  _normal.negate()
  // Re-orthogonalize up so right × up = toward-camera.
  _up.crossVectors(_normal, _right).normalize()
  _right.crossVectors(_up, _normal).normalize()
  return {
    origin: { x: throughPoint.x, y: throughPoint.y, z: throughPoint.z },
    right: { x: _right.x, y: _right.y, z: _right.z },
    up: { x: _up.x, y: _up.y, z: _up.z },
  }
}

/** Raycast pointer onto a locked perspective stroke frame → 2D plane coords. */
export function clientToPerspectiveStrokePlane(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  camera: THREE.Camera,
  frame: StrokePlaneFrame
): { x: number; y: number } | null {
  const nx = frame.right.y * frame.up.z - frame.right.z * frame.up.y
  const ny = frame.right.z * frame.up.x - frame.right.x * frame.up.z
  const nz = frame.right.x * frame.up.y - frame.right.y * frame.up.x
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
    new THREE.Vector3(nx, ny, nz).normalize(),
    new THREE.Vector3(frame.origin.x, frame.origin.y, frame.origin.z)
  )
  const hit = clientToCameraPlane(clientX, clientY, rect, camera, plane)
  if (!hit) return null
  return worldPointToStrokePlane2D({ x: hit.x, y: hit.y, z: hit.z }, frame)
}

/** 2D coords on the active orthographic work plane (matches stroke-to-mesh) */
export function clientToPlane(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  camera: THREE.Camera,
  view: ViewType,
  depth = 0,
  frame?: StrokePlaneFrame | null
): { x: number; y: number } | null {
  const ortho = orthoViewFromLegacy(view)
  if (ortho) {
    const onPlane = clientToWorkPlane(clientX, clientY, rect, camera, ortho, depth)
    if (onPlane) return onPlane
  }

  if (view === 'perspective' && frame) {
    return clientToPerspectiveStrokePlane(clientX, clientY, rect, camera, frame)
  }

  const w = clientToWorld(clientX, clientY, rect, camera)
  if (ortho) {
    return worldToPlanePoint(ortho, { x: w.x, y: w.y, z: w.z })
  }

  return { x: w.x, y: w.y }
}

export function planeToWorld3D(
  x: number,
  y: number,
  view: ViewType,
  depth = 0,
  frame?: StrokePlaneFrame | null
): { x: number; y: number; z: number } {
  const ortho = orthoViewFromLegacy(view)
  if (ortho) {
    return planePointToWorld(ortho, x, y, depth)
  }
  if (frame) {
    return planePointToStrokeFrame(x, y, frame, 0)
  }
  return { x, y, z: depth }
}

/** Slight offset toward camera so stroke line renders above geometry */
export function planeToStroke3D(
  x: number,
  y: number,
  view: ViewType,
  depth = 0,
  frame?: StrokePlaneFrame | null
): THREE.Vector3 {
  const ortho = orthoViewFromLegacy(view)
  if (ortho) {
    const w = planePointToWorld(ortho, x, y, depth)
    const o = strokeOffset(ortho)
    return new THREE.Vector3(w.x + o.x, w.y + o.y, w.z + o.z)
  }
  if (frame) {
    const w = planePointToStrokeFrame(x, y, frame, 1)
    return new THREE.Vector3(w.x, w.y, w.z)
  }
  return new THREE.Vector3(x, y, depth + 1)
}

export type { StrokePlaneFrame }

/** Raycast pointer onto horizontal ground plane (Y = groundY). */
export function clientToGroundPlane(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  camera: THREE.Camera,
  groundY = 0
): { x: number; y: number; z: number } | null {
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -groundY)
  const hit = clientToCameraPlane(clientX, clientY, rect, camera, plane)
  if (!hit) return null
  return { x: hit.x, y: groundY, z: hit.z }
}

/** Plane facing the camera, passing through a world point — for perspective dragging. */
export function buildCameraDragPlane(
  camera: THREE.Camera,
  throughPoint: THREE.Vector3
): THREE.Plane {
  camera.getWorldDirection(_normal).negate()
  return new THREE.Plane().setFromNormalAndCoplanarPoint(_normal, throughPoint)
}

/** Camera look direction (into the scene). */
export function getCameraViewForward(camera: THREE.Camera): { x: number; y: number; z: number } {
  const dir = new THREE.Vector3()
  camera.getWorldDirection(dir)
  return { x: dir.x, y: dir.y, z: dir.z }
}

export function clientToCameraPlane(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  camera: THREE.Camera,
  plane: THREE.Plane
): THREE.Vector3 | null {
  _ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1
  _ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1
  _raycaster.setFromCamera(_ndc, camera)
  const hit = _raycaster.ray.intersectPlane(plane, _hit)
  return hit ? hit.clone() : null
}

export { isOrthoView, normalizeViewType, getViewLabel, ORTHO_VIEW_OPTIONS }
