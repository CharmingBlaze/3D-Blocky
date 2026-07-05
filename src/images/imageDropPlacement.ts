import * as THREE from 'three'
import type { ViewType } from '../store/appStore'
import type { Vec3 } from '../utils/math'
import {
  VIEW_AXIS_TABLE,
  axisComponent,
  isOrthoView,
  planePointToWorld,
  worldToPlanePoint,
} from '../primitives/viewAxes'
import {
  buildCameraDragPlane,
  clientToCameraPlane,
  clientToGroundPlane,
  clientToPlane,
  planeToWorld3D,
} from '../utils/screenToWorld'

export interface ViewDropContext {
  view: ViewType
  clientX: number
  clientY: number
  rect: DOMRect
  camera: THREE.Camera
  defaultDepth: number
}

export function normalizedViewportPoint(
  clientX: number,
  clientY: number,
  rect: DOMRect
): { x: number; y: number } {
  return {
    x: (clientX - rect.left) / rect.width,
    y: (clientY - rect.top) / rect.height,
  }
}

export function worldPointFromViewDrop(ctx: ViewDropContext): Vec3 {
  const { view, clientX, clientY, rect, camera, defaultDepth } = ctx

  if (isOrthoView(view)) {
    const planePt = clientToPlane(clientX, clientY, rect, camera, view, defaultDepth)
    if (planePt) {
      return planeToWorld3D(planePt.x, planePt.y, view, defaultDepth)
    }
  }

  const ground = clientToGroundPlane(clientX, clientY, rect, camera, 0)
  if (ground) return ground

  const through = new THREE.Vector3(0, 0, 0)
  const dragPlane = buildCameraDragPlane(camera, through)
  const hit = clientToCameraPlane(clientX, clientY, rect, camera, dragPlane)
  if (hit) return { x: hit.x, y: hit.y, z: hit.z }

  return { x: 0, y: 0, z: 0 }
}

export function quadCornersForViewPlane(
  view: ViewType,
  center: Vec3,
  halfWidth: number,
  halfHeight: number
): Vec3[] {
  if (isOrthoView(view)) {
    const plane = worldToPlanePoint(view, center)
    const depth = axisComponent(center, VIEW_AXIS_TABLE[view].d)
    return [
      planePointToWorld(view, plane.x - halfWidth, plane.y - halfHeight, depth),
      planePointToWorld(view, plane.x + halfWidth, plane.y - halfHeight, depth),
      planePointToWorld(view, plane.x + halfWidth, plane.y + halfHeight, depth),
      planePointToWorld(view, plane.x - halfWidth, plane.y + halfHeight, depth),
    ]
  }

  // Perspective: horizontal plane (XZ) centered on drop point
  return [
    { x: center.x - halfWidth, y: center.y, z: center.z - halfHeight },
    { x: center.x + halfWidth, y: center.y, z: center.z - halfHeight },
    { x: center.x + halfWidth, y: center.y, z: center.z + halfHeight },
    { x: center.x - halfWidth, y: center.y, z: center.z + halfHeight },
  ]
}
