import type { OrthoViewType } from '../primitives/viewAxes'
import type { ViewType } from '../store/appStore'
import type { SceneObject } from '../mesh/HalfEdgeMesh'
import { cloneTransform, prepareSceneObject } from '../mesh/objectTransform'
import { cloneSceneObject } from '../mesh/meshOps'
import { generateId, type Vec2, type Vec3 } from '../utils/math'
import { planeToWorld3D } from '../utils/screenToWorld'
import {
  axisScreenRole,
  isOrthoView,
  normalizeViewType,
  setAxisComponent,
  VIEW_AXIS_TABLE,
  worldToPlanePoint,
  type Axis,
} from '../primitives/viewAxes'
import type { VectorAnchor, VectorPath } from '../vector/types'
import type { SketchSource } from '../stroke/sketchSource'
import type { LatheSource } from '../stroke/latheSource'
import type { PrimitiveSource } from '../primitives/primitiveBoxCommit'
import type { StrokePlaneFrame } from '../stroke/worldProjection'
import type { VectorSource } from '../vector/vectorSource'

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

export function mirrorWorldDirection(dir: Vec3, axis: SymmetryAxis): Vec3 {
  if (axis === 'x') return { x: -dir.x, y: dir.y, z: dir.z }
  if (axis === 'y') return { x: dir.x, y: -dir.y, z: dir.z }
  return { x: dir.x, y: dir.y, z: -dir.z }
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

function reverseCornerRings(rings: number[][] | undefined): number[][] | undefined {
  if (!rings) return undefined
  return rings.map((ring) => [...ring].reverse())
}

function mirrorPlaneFrame(
  frame: StrokePlaneFrame,
  axis: SymmetryAxis,
  plane: number
): StrokePlaneFrame {
  return {
    origin: mirrorWorldPoint(frame.origin, axis, plane),
    right: mirrorWorldDirection(frame.right, axis),
    up: mirrorWorldDirection(frame.up, axis),
  }
}

function mirrorPlanePolyline(
  points: Vec2[],
  view: OrthoViewType,
  depth: number,
  axis: SymmetryAxis,
  plane: number
): Vec2[] {
  return [...points]
    .map((p) => mirrorPlanePoint(p, view, depth, axis, plane))
    .reverse()
}

function mirrorSketchSource(
  source: SketchSource,
  axis: SymmetryAxis,
  plane: number
): SketchSource {
  const view = isOrthoView(source.view)
    ? (normalizeViewType(source.view) as OrthoViewType)
    : null
  const planeFrame = source.planeFrame
    ? mirrorPlaneFrame(source.planeFrame, axis, plane)
    : source.planeFrame

  if (!view) {
    return {
      ...source,
      relative: [...source.relative].reverse().map((p) => ({ ...p })),
      center: { ...source.center },
      planeFrame,
    }
  }

  const depth = source.defaultDepth
  const absolute = source.relative.map((p) => ({
    x: p.x + source.center.x,
    y: p.y + source.center.y,
  }))
  const mirroredAbsolute = mirrorPlanePolyline(absolute, view, depth, axis, plane)
  const mirroredCenter = mirrorPlanePoint(source.center, view, depth, axis, plane)
  return {
    ...source,
    center: mirroredCenter,
    relative: mirroredAbsolute.map((p) => ({
      x: p.x - mirroredCenter.x,
      y: p.y - mirroredCenter.y,
    })),
    planeFrame,
  }
}

function mirrorLatheSource(
  source: LatheSource,
  axis: SymmetryAxis,
  plane: number
): LatheSource {
  if (!isOrthoView(source.view)) {
    return {
      ...source,
      points: source.points.map((p) => ({ ...p })),
    }
  }
  const view = normalizeViewType(source.view) as OrthoViewType
  return {
    ...source,
    points: mirrorPlanePolyline(source.points, view, source.defaultDepth, axis, plane),
  }
}

function mirrorPrimitiveSource(
  source: PrimitiveSource,
  axis: SymmetryAxis,
  plane: number
): PrimitiveSource {
  const { min, max } = source.box
  const corners: Vec3[] = [
    { x: min.x, y: min.y, z: min.z },
    { x: max.x, y: min.y, z: min.z },
    { x: min.x, y: max.y, z: min.z },
    { x: max.x, y: max.y, z: min.z },
    { x: min.x, y: min.y, z: max.z },
    { x: max.x, y: min.y, z: max.z },
    { x: min.x, y: max.y, z: max.z },
    { x: max.x, y: max.y, z: max.z },
  ]
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  for (const corner of corners) {
    const mirrored = mirrorWorldPoint(corner, axis, plane)
    minX = Math.min(minX, mirrored.x)
    minY = Math.min(minY, mirrored.y)
    minZ = Math.min(minZ, mirrored.z)
    maxX = Math.max(maxX, mirrored.x)
    maxY = Math.max(maxY, mirrored.y)
    maxZ = Math.max(maxZ, mirrored.z)
  }
  return {
    ...source,
    box: {
      min: { x: minX, y: minY, z: minZ },
      max: { x: maxX, y: maxY, z: maxZ },
    },
    roundedParams: source.roundedParams ? { ...source.roundedParams } : undefined,
  }
}

function mirrorVectorSource(
  source: VectorSource,
  axis: SymmetryAxis,
  plane: number,
  newObjectId: string
): VectorSource {
  const depth = source.defaultDepth
  const path = mirrorVectorPath(source.path, depth, axis, plane)
  return {
    ...source,
    path: {
      ...path,
      objectId: newObjectId,
    },
  }
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
    // Keep corner attributes aligned with reversed face winding.
    faceUvIndices: reverseCornerRings(base.faceUvIndices),
    faceColorIndices: reverseCornerRings(base.faceColorIndices),
    pivot: base.pivot ? mirrorWorldPoint(base.pivot, axis, plane) : undefined,
    transform: base.transform
      ? {
          ...cloneTransform(base.transform),
          position: mirrorWorldPoint(base.transform.position, axis, plane),
        }
      : undefined,
    sketchSource: base.sketchSource
      ? mirrorSketchSource(base.sketchSource, axis, plane)
      : undefined,
    vectorSource: base.vectorSource
      ? mirrorVectorSource(base.vectorSource, axis, plane, newId)
      : undefined,
    latheSource: base.latheSource
      ? mirrorLatheSource(base.latheSource, axis, plane)
      : undefined,
    primitiveSource: base.primitiveSource
      ? mirrorPrimitiveSource(base.primitiveSource, axis, plane)
      : undefined,
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
