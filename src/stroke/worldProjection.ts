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

/**
 * Canonical mesh: plane coords in p.x/p.y, extrusion offset in p.z.
 * Project into world space for the active orthographic view.
 */
export function projectMeshToView(
  mesh: HalfEdgeMesh,
  view: ViewType,
  depth: number
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

    p.x = planeX
    p.y = planeY
    p.z = depth + localZ
  }

  if (ortho && viewProjectionMirrorsWinding(ortho)) {
    flipMeshFaces(mesh)
  }
}

/** Map a 2D stroke path in plane coords to world-space centerline points. */
export function planePathToWorld(path: Vec2[], view: ViewType, depth: number): Vec3[] {
  const ortho = orthoViewFromLegacy(view)
  if (!ortho) {
    return path.map((p) => ({ x: p.x, y: p.y, z: depth }))
  }
  return path.map((p) => planePointToWorld(ortho, p.x, p.y, depth))
}

/** Plane 2D offset → canonical XY translation before view projection */
export function offsetMeshInPlane(mesh: HalfEdgeMesh, cx: number, cy: number): void {
  for (const p of mesh.positions) {
    p.x += cx
    p.y += cy
  }
}

export { isOrthoView, normalizeViewType }
