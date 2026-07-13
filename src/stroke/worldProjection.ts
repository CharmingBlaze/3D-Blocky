import type { ViewType } from '../store/appStore'
import type { HalfEdgeMesh } from '../mesh/HalfEdgeMesh'
import type { Vec2, Vec3 } from '../utils/math'
import {
  isOrthoView,
  normalizeViewType,
  orthoViewFromLegacy,
  planePointToWorld,
  setAxisComponent,
  VIEW_AXIS_TABLE,
  type OrthoViewType,
} from '../primitives/viewAxes'
import { flipMeshFaces } from '../mesh/meshWinding'

/**
 * Locked camera-facing draw plane for perspective strokes.
 * Plane axes match the camera at stroke start; local +Z extrudes toward the viewer.
 */
export interface StrokePlaneFrame {
  origin: Vec3
  right: Vec3
  up: Vec3
}

/** Axis-permutation views mirror triangle winding (det < 0). */
function viewProjectionMirrorsWinding(view: OrthoViewType): boolean {
  switch (view) {
    case 'top':
    case 'right':
    case 'bottom':
    case 'left':
      return true
    default:
      return false
  }
}

/** Unit vector from scene origin toward the orthographic camera for `view`. */
export function viewTowardCamera(view: OrthoViewType): Vec3 {
  const { d, dSign } = VIEW_AXIS_TABLE[view]
  return setAxisComponent({ x: 0, y: 0, z: 0 }, d, dSign)
}

function strokeFrameNormal(frame: StrokePlaneFrame): Vec3 {
  const { right, up } = frame
  const x = right.y * up.z - right.z * up.y
  const y = right.z * up.x - right.x * up.z
  const z = right.x * up.y - right.y * up.x
  const len = Math.hypot(x, y, z) || 1
  return { x: x / len, y: y / len, z: z / len }
}

/** Map plane (x,y) + local extrusion z onto a locked perspective stroke frame. */
export function planePointToStrokeFrame(
  x: number,
  y: number,
  frame: StrokePlaneFrame,
  localZ = 0
): Vec3 {
  const n = strokeFrameNormal(frame)
  return {
    x: frame.origin.x + frame.right.x * x + frame.up.x * y + n.x * localZ,
    y: frame.origin.y + frame.right.y * x + frame.up.y * y + n.y * localZ,
    z: frame.origin.z + frame.right.z * x + frame.up.z * y + n.z * localZ,
  }
}

/** Project a world point onto a stroke frame as 2D plane coords. */
export function worldPointToStrokePlane2D(world: Vec3, frame: StrokePlaneFrame): Vec2 {
  const dx = world.x - frame.origin.x
  const dy = world.y - frame.origin.y
  const dz = world.z - frame.origin.z
  return {
    x: dx * frame.right.x + dy * frame.right.y + dz * frame.right.z,
    y: dx * frame.up.x + dy * frame.up.y + dz * frame.up.z,
  }
}

/**
 * Canonical mesh: plane coords in p.x/p.y, extrusion offset in p.z.
 * Project into world space for the active view (ortho remapping, or locked perspective frame).
 */
export function projectMeshToView(
  mesh: HalfEdgeMesh,
  view: ViewType,
  depth: number,
  frame?: StrokePlaneFrame | null
): void {
  const ortho = orthoViewFromLegacy(view)
  for (const p of mesh.positions) {
    const planeX = p.x
    const planeY = p.y
    const localZ = p.z

    if (ortho) {
      const w = planePointToWorld(ortho, planeX, planeY, depth + localZ)
      p.x = w.x
      p.y = w.y
      p.z = w.z
      continue
    }

    if (frame) {
      const w = planePointToStrokeFrame(planeX, planeY, frame, localZ)
      p.x = w.x
      p.y = w.y
      p.z = w.z
      continue
    }

    p.x = planeX
    p.y = planeY
    p.z = depth + localZ
  }

  if (ortho && viewProjectionMirrorsWinding(ortho)) {
    flipMeshFaces(mesh)
  }
}

/** Map a 2D stroke path in plane coords to world-space centerline points. */
export function planePathToWorld(
  path: Vec2[],
  view: ViewType,
  depth: number,
  frame?: StrokePlaneFrame | null
): Vec3[] {
  const ortho = orthoViewFromLegacy(view)
  if (ortho) {
    return path.map((p) => planePointToWorld(ortho, p.x, p.y, depth))
  }
  if (frame) {
    return path.map((p) => planePointToStrokeFrame(p.x, p.y, frame, 0))
  }
  return path.map((p) => ({ x: p.x, y: p.y, z: depth }))
}

/** Plane 2D offset → canonical XY translation before view projection */
export function offsetMeshInPlane(mesh: HalfEdgeMesh, cx: number, cy: number): void {
  for (const p of mesh.positions) {
    p.x += cx
    p.y += cy
  }
}

export { isOrthoView, normalizeViewType }
