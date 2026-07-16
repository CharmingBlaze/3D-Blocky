import type { OrthoViewType } from '../primitives/viewAxes'
import type { ViewType } from '../store/appStore'
import type { SceneObject } from '../mesh/HalfEdgeMesh'
import { cloneTransform, prepareSceneObject } from '../mesh/objectTransform'
import { cloneSceneObject } from '../mesh/meshOps'
import { generateId, type Vec3 } from '../utils/math'
import { planeToWorld3D } from '../utils/screenToWorld'
import {
  axisScreenRole,
  normalizeViewType,
  setAxisComponent,
  VIEW_AXIS_TABLE,
  worldToPlanePoint,
  type Axis,
} from '../primitives/viewAxes'
import type { VectorAnchor, VectorPath } from '../vector/types'

export type SymmetryAxis = 'x' | 'y' | 'z'

export function symmetryAxisToIndex(axis: SymmetryAxis): Axis {
  if (axis === 'x') return 0
  if (axis === 'y') return 1
  return 2
}

export function mirrorWorldPoint(point: Vec3, axis: SymmetryAxis, plane: number): Vec3 {
  const idx = symmetryAxisToIndex(axis)
  const component = idx === 0 ? point.x : idx === 1 ? point.y : point.z
  const mirrored = 2 * plane - component
  return setAxisComponent({ ...point }, idx, mirrored)
}

export function mirrorPlanePoint(
  point: { x: number; y: number },
  view: OrthoViewType,
  depth: number,
  axis: SymmetryAxis,
  plane: number
): { x: number; y: number } {
  const world = planeToWorld3D(point.x, point.y, view, depth)
  const mirrored = mirrorWorldPoint(world, axis, plane)
  return worldToPlanePoint(view, mirrored)
}

/** Read symmetry plane position from a 2D ortho pick/drag point. */
export function symmetryPlaneFromPlanePoint(
  point: { x: number; y: number },
  view: OrthoViewType,
  axis: SymmetryAxis
): number | null {
  const axisIdx = symmetryAxisToIndex(axis)
  const map = VIEW_AXIS_TABLE[view]
  if (map.h === axisIdx) return point.x
  if (map.v === axisIdx) return point.y
  return null
}

export type SymmetryLineOrientation = 'vertical' | 'horizontal'

export interface SymmetryLineInView {
  orientation: SymmetryLineOrientation
}

/** Whether the mirror plane appears as a draggable line in this ortho view. */
export function symmetryLineInView(
  view: OrthoViewType,
  axis: SymmetryAxis
): SymmetryLineInView | null {
  const axisIdx = symmetryAxisToIndex(axis)
  const role = axisScreenRole(view, axisIdx)
  if (!role) return null
  return {
    orientation: role === 'horizontal' ? 'vertical' : 'horizontal',
  }
}

export function worldSymmetryLineEndpoints(
  view: OrthoViewType,
  axis: SymmetryAxis,
  plane: number,
  depth: number,
  span = 5000
): [Vec3, Vec3] | null {
  const axisIdx = symmetryAxisToIndex(axis)
  const role = axisScreenRole(view, axisIdx)
  if (!role) return null

  const map = VIEW_AXIS_TABLE[view]
  let a: Vec3 = { x: 0, y: 0, z: 0 }
  let b: Vec3 = { x: 0, y: 0, z: 0 }
  a = setAxisComponent(a, axisIdx, plane)
  b = setAxisComponent(b, axisIdx, plane)
  a = setAxisComponent(a, map.d, depth)
  b = setAxisComponent(b, map.d, depth)

  const perpAxis = role === 'horizontal' ? map.v : map.h
  a = setAxisComponent(a, perpAxis, -span)
  b = setAxisComponent(b, perpAxis, span)
  return [a, b]
}

export function mirrorSceneObject(
  obj: SceneObject,
  axis: SymmetryAxis,
  plane: number,
  newId = generateId()
): SceneObject {
  const base = cloneSceneObject(obj)
  const mirrored: SceneObject = {
    ...base,
    id: newId,
    name: `${obj.name} (mirror)`,
    positions: base.positions.map((p) => mirrorWorldPoint(p, axis, plane)),
    faces: base.faces.map((f) => [...f].reverse()),
    pivot: base.pivot ? mirrorWorldPoint(base.pivot, axis, plane) : undefined,
    transform: base.transform
      ? {
          ...cloneTransform(base.transform),
          position: mirrorWorldPoint(base.transform.position, axis, plane),
        }
      : undefined,
    // Mirroring bakes world-space geometry. Retained source coordinates would
    // otherwise regenerate the unmirrored original when edited later.
    sketchSource: undefined,
    vectorSource: undefined,
    latheSource: undefined,
    primitiveSource: undefined,
  }
  return prepareSceneObject(mirrored)
}

export function mirrorVectorAnchor(
  anchor: VectorAnchor,
  view: OrthoViewType,
  depth: number,
  axis: SymmetryAxis,
  plane: number
): VectorAnchor {
  const mirrorPt = (p: { x: number; y: number }) =>
    mirrorPlanePoint(p, view, depth, axis, plane)
  return {
    ...anchor,
    id: generateId(),
    position: mirrorPt(anchor.position),
    inHandle: anchor.inHandle ? mirrorPt(anchor.inHandle) : null,
    outHandle: anchor.outHandle ? mirrorPt(anchor.outHandle) : null,
  }
}

export function mirrorVectorPath(
  path: VectorPath,
  depth: number,
  axis: SymmetryAxis,
  plane: number
): VectorPath {
  if (path.view === 'perspective') return path
  const view = normalizeViewType(path.view) as OrthoViewType
  return {
    ...path,
    id: generateId(),
    anchors: [...path.anchors].reverse().map((a) => mirrorVectorAnchor(a, view, depth, axis, plane)),
  }
}

export function shouldApplySymmetry(enabled: boolean, view: ViewType): boolean {
  return enabled && view !== 'perspective'
}

export function symmetryAxisLabel(axis: SymmetryAxis): string {
  return axis.toUpperCase()
}
