import type { ViewType } from '../store/appStore'
import type { Vec2, Vec3 } from '../utils/math'
import {
  axisComponent,
  boundsFromWorldPoints,
  boundsCenter,
  boundsSize,
  heightAxisForView,
  orthoViewFromLegacy,
  planePointToWorld,
  setAxisComponent,
  VIEW_AXIS_TABLE,
  type Axis,
  type OrthoViewType,
} from './viewAxes'

export interface WorldBox {
  min: Vec3
  max: Vec3
}

export function boxCenterSize(box: WorldBox): { center: Vec3; size: Vec3 } {
  return {
    center: boundsCenter(box.min, box.max),
    size: boundsSize(box.min, box.max),
  }
}

const MIN_EXTENT = 0.5

export function clampBoxMinSize(box: WorldBox): WorldBox {
  const center = boundsCenter(box.min, box.max)
  const size = boundsSize(box.min, box.max)
  const sx = Math.max(size.x, MIN_EXTENT)
  const sy = Math.max(size.y, MIN_EXTENT)
  const sz = Math.max(size.z, MIN_EXTENT)
  return {
    min: { x: center.x - sx / 2, y: center.y - sy / 2, z: center.z - sz / 2 },
    max: { x: center.x + sx / 2, y: center.y + sy / 2, z: center.z + sz / 2 },
  }
}

/** Base rectangle from two plane corners — min/max per axis, any drag direction. */
export function baseBoxFromPlaneCorners(
  view: OrthoViewType,
  cornerA: Vec2,
  cornerB: Vec2,
  depthAlongView: number,
  shiftKey: boolean
): WorldBox {
  const w0 = planePointToWorld(view, cornerA.x, cornerA.y, depthAlongView)
  const w1 = planePointToWorld(view, cornerB.x, cornerB.y, depthAlongView)
  let { min, max } = boundsFromWorldPoints([w0, w1])

  if (shiftKey) {
    const { h, v } = VIEW_AXIS_TABLE[view]
    const extH = axisComponent(max, h) - axisComponent(min, h)
    const extV = axisComponent(max, v) - axisComponent(min, v)
    const side = Math.max(extH, extV, MIN_EXTENT)
    const center = boundsCenter(min, max)
    min = setAxisComponent(min, h, axisComponent(center, h) - side / 2)
    max = setAxisComponent(max, h, axisComponent(center, h) + side / 2)
    min = setAxisComponent(min, v, axisComponent(center, v) - side / 2)
    max = setAxisComponent(max, v, axisComponent(center, v) + side / 2)
  }

  return clampBoxMinSize({ min, max })
}

/** After base is fixed, collapse depth axis to a slab at center (zero height). */
export function flattenBoxOnHeightAxis(box: WorldBox, heightAxis: Axis): WorldBox {
  const center = boundsCenter(box.min, box.max)
  const c = axisComponent(center, heightAxis)
  return clampBoxMinSize({
    min: setAxisComponent(box.min, heightAxis, c),
    max: setAxisComponent(box.max, heightAxis, c),
  })
}

/** Extrude heightAxis extent from drag in a completing ortho view. */
export function extrudeBoxOnHeightAxis(
  baseBox: WorldBox,
  heightAxis: Axis,
  view: OrthoViewType,
  planeA: Vec2,
  planeB: Vec2,
  depthAlongView: number,
  shiftKey: boolean
): WorldBox {
  const w0 = planePointToWorld(view, planeA.x, planeA.y, depthAlongView)
  const w1 = planePointToWorld(view, planeB.x, planeB.y, depthAlongView)
  const v0 = axisComponent(w0, heightAxis)
  const v1 = axisComponent(w1, heightAxis)
  const hMin = Math.min(v0, v1)
  const hMax = Math.max(v0, v1)

  let box: WorldBox = {
    min: setAxisComponent(baseBox.min, heightAxis, hMin),
    max: setAxisComponent(baseBox.max, heightAxis, hMax),
  }

  if (shiftKey) {
    const { size } = boxCenterSize(baseBox)
    const others = ([0, 1, 2] as Axis[]).filter((a) => a !== heightAxis)
    const cubeSide = Math.max(
      Math.min(axisComponent(size, others[0]), axisComponent(size, others[1])),
      MIN_EXTENT
    )
    const center = boundsCenter(box.min, box.max)
    const hc = axisComponent(center, heightAxis)
    box = {
      ...box,
      min: setAxisComponent(box.min, heightAxis, hc - cubeSide / 2),
      max: setAxisComponent(box.max, heightAxis, hc + cubeSide / 2),
    }
  }

  return clampBoxMinSize(box)
}

export function startPrimitiveBoxSession(
  view: ViewType,
  planePoint: Vec2,
  depthAlongView: number
): {
  baseView: OrthoViewType
  heightAxis: Axis
  box: WorldBox
  cornerA: Vec2
  cornerB: Vec2
} | null {
  const ortho = orthoViewFromLegacy(view)
  if (!ortho) return null
  const heightAxis = heightAxisForView(ortho)
  const cornerA = { ...planePoint }
  const cornerB = { ...planePoint }
  const box = baseBoxFromPlaneCorners(ortho, cornerA, cornerB, depthAlongView, false)
  return { baseView: ortho, heightAxis, box, cornerA, cornerB }
}

/** Perspective CAD: drag footprint on XZ ground, drag up/down or scroll wheel sets height. */
export const PERSPECTIVE_PRIMITIVE_HEIGHT_AXIS: Axis = 1
/** World units gained per screen pixel when dragging perspective primitive height. */
export const PERSPECTIVE_PRIMITIVE_HEIGHT_DRAG_SCALE = 0.1

export function baseBoxFromGroundCorners(
  cornerA: Vec3,
  cornerB: Vec3,
  groundY: number,
  shiftKey: boolean
): WorldBox {
  let min: Vec3 = {
    x: Math.min(cornerA.x, cornerB.x),
    y: groundY,
    z: Math.min(cornerA.z, cornerB.z),
  }
  let max: Vec3 = {
    x: Math.max(cornerA.x, cornerB.x),
    y: groundY,
    z: Math.max(cornerA.z, cornerB.z),
  }

  if (shiftKey) {
    const extX = max.x - min.x
    const extZ = max.z - min.z
    const side = Math.max(extX, extZ, MIN_EXTENT)
    const center = boundsCenter(min, max)
    min = { x: center.x - side / 2, y: groundY, z: center.z - side / 2 }
    max = { x: center.x + side / 2, y: groundY, z: center.z + side / 2 }
  }

  return clampBoxMinSize({ min, max })
}

export function flattenBoxToGroundSlab(box: WorldBox, heightAxis: Axis, groundY: number): WorldBox {
  return clampBoxMinSize({
    min: setAxisComponent(box.min, heightAxis, groundY),
    max: setAxisComponent(box.max, heightAxis, groundY),
  })
}

export function extrudeFlatBoxToHeight(
  flatBase: WorldBox,
  heightAxis: Axis,
  height: number
): WorldBox {
  const h0 = axisComponent(flatBase.min, heightAxis)
  const h = Math.max(height, MIN_EXTENT)
  return clampBoxMinSize({
    min: setAxisComponent(flatBase.min, heightAxis, h0),
    max: setAxisComponent(flatBase.max, heightAxis, h0 + h),
  })
}

export function startPerspectivePrimitiveBoxSession(
  worldPoint: Vec3,
  groundY: number
): {
  baseView: 'perspective'
  heightAxis: Axis
  box: WorldBox
  worldCornerA: Vec3
  worldCornerB: Vec3
  groundY: number
} {
  const worldCornerA: Vec3 = { x: worldPoint.x, y: groundY, z: worldPoint.z }
  const worldCornerB = { ...worldCornerA }
  const box = baseBoxFromGroundCorners(worldCornerA, worldCornerB, groundY, false)
  return {
    baseView: 'perspective',
    heightAxis: PERSPECTIVE_PRIMITIVE_HEIGHT_AXIS,
    box,
    worldCornerA,
    worldCornerB,
    groundY,
  }
}

/** 8 corners of an axis-aligned world box */
export function boxWireCorners(box: WorldBox): Vec3[] {
  const { min, max } = box
  return [
    { x: min.x, y: min.y, z: min.z },
    { x: max.x, y: min.y, z: min.z },
    { x: max.x, y: max.y, z: min.z },
    { x: min.x, y: max.y, z: min.z },
    { x: min.x, y: min.y, z: max.z },
    { x: max.x, y: min.y, z: max.z },
    { x: max.x, y: max.y, z: max.z },
    { x: min.x, y: max.y, z: max.z },
  ]
}

const BOX_EDGES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
]

export function boxWireSegments(box: WorldBox): [Vec3, Vec3][] {
  const corners = boxWireCorners(box)
  return BOX_EDGES.map(([a, b]) => [corners[a], corners[b]])
}

export type PrimitivePreviewPhase = 'drawingBase' | 'drawingHeight' | 'scrollHeight'

export interface PrimitivePreviewDraft {
  phase: PrimitivePreviewPhase
  heightAxis: Axis
  box: WorldBox
}

const Y_UP_GROUND_PREVIEW_TYPES = new Set(['dome', 'stairs'])

/** Dome/stairs are Y-up on the ground — inflate thin extrusion axis while the box is still being drawn. */
export function primitivePreviewBox(type: string, draft: PrimitivePreviewDraft): WorldBox {
  if (!Y_UP_GROUND_PREVIEW_TYPES.has(type)) return draft.box

  const { box, heightAxis, phase } = draft
  const size = boundsSize(box.min, box.max)
  const extDepth = axisComponent(size, heightAxis)
  const otherAxes = ([0, 1, 2] as Axis[]).filter((a) => a !== heightAxis)
  const estDepth = Math.max(
    axisComponent(size, otherAxes[0]!),
    axisComponent(size, otherAxes[1]!),
    MIN_EXTENT
  )

  const needsInflate =
    phase === 'drawingBase' ||
    (phase === 'drawingHeight' && extDepth <= MIN_EXTENT * 1.01)

  if (!needsInflate) return box

  const center = boundsCenter(box.min, box.max)
  const half = estDepth / 2
  const c = axisComponent(center, heightAxis)
  return clampBoxMinSize({
    min: setAxisComponent(box.min, heightAxis, c - half),
    max: setAxisComponent(box.max, heightAxis, c + half),
  })
}
