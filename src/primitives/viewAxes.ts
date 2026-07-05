import type { OrthoViewType, ViewType } from '../scene/viewTypes'
import { isOrthoView, normalizeViewType } from '../scene/viewTypes'
import type { Vec3 } from '../utils/math'

/** 0=X, 1=Y, 2=Z */
export type Axis = 0 | 1 | 2

export interface ViewAxisMapping {
  /** Screen horizontal (+right) world axis */
  h: Axis
  /** Screen vertical (+up) world axis */
  v: Axis
  /** Depth axis (perpendicular to screen, not drawn directly) */
  d: Axis
  hSign: 1 | -1
  vSign: 1 | -1
  dSign: 1 | -1
}

/** Single source of truth — world X=right, Y=up, Z=toward viewer */
export const VIEW_AXIS_TABLE: Record<OrthoViewType, ViewAxisMapping> = {
  front: { h: 0, v: 1, d: 2, hSign: 1, vSign: 1, dSign: 1 },
  back: { h: 0, v: 1, d: 2, hSign: -1, vSign: 1, dSign: -1 },
  right: { h: 2, v: 1, d: 0, hSign: -1, vSign: 1, dSign: 1 },
  left: { h: 2, v: 1, d: 0, hSign: 1, vSign: 1, dSign: -1 },
  top: { h: 0, v: 2, d: 1, hSign: 1, vSign: -1, dSign: 1 },
  bottom: { h: 0, v: 2, d: 1, hSign: 1, vSign: 1, dSign: -1 },
}

export { isOrthoView, normalizeViewType }
export type { OrthoViewType, ViewType }

export function orthoViewFromLegacy(view: ViewType): OrthoViewType | null {
  if (!isOrthoView(view)) return null
  return normalizeViewType(view) as OrthoViewType
}

export function heightAxisForView(view: OrthoViewType): Axis {
  return VIEW_AXIS_TABLE[view].d
}

export function axisComponent(v: Vec3, axis: Axis): number {
  if (axis === 0) return v.x
  if (axis === 1) return v.y
  return v.z
}

export function setAxisComponent(v: Vec3, axis: Axis, value: number): Vec3 {
  const out = { ...v }
  if (axis === 0) out.x = value
  else if (axis === 1) out.y = value
  else out.z = value
  return out
}

/** Map world XYZ to 2D plane coords for an orthographic view. */
export function worldToPlanePoint(view: OrthoViewType, world: Vec3): { x: number; y: number } {
  const { h, v, hSign, vSign } = VIEW_AXIS_TABLE[view]
  return {
    x: axisComponent(world, h) * hSign,
    y: axisComponent(world, v) * vSign,
  }
}

/** Map 2D plane coords + depth-along-view to world XYZ. */
export function planePointToWorld(
  view: OrthoViewType,
  planeX: number,
  planeY: number,
  depthAlongView: number
): Vec3 {
  const { h, v, d, hSign, vSign, dSign } = VIEW_AXIS_TABLE[view]
  let w: Vec3 = { x: 0, y: 0, z: 0 }
  w = setAxisComponent(w, h, planeX * hSign)
  w = setAxisComponent(w, v, planeY * vSign)
  w = setAxisComponent(w, d, depthAlongView * dSign)
  return w
}

export function axisScreenRole(
  view: OrthoViewType,
  axis: Axis
): 'horizontal' | 'vertical' | null {
  const t = VIEW_AXIS_TABLE[view]
  if (t.h === axis) return 'horizontal'
  if (t.v === axis) return 'vertical'
  return null
}

const ORTHO_VIEWS: OrthoViewType[] = [
  'front',
  'back',
  'left',
  'right',
  'top',
  'bottom',
]

/** Views where heightAxis appears on screen (not as depth). */
export function completingViewsForHeight(
  baseView: OrthoViewType,
  heightAxis: Axis
): OrthoViewType[] {
  return ORTHO_VIEWS.filter(
    (v) => v !== baseView && axisScreenRole(v, heightAxis) !== null
  )
}

export function canExtrudeHeightInView(
  baseView: OrthoViewType,
  view: OrthoViewType,
  heightAxis: Axis
): boolean {
  return view !== baseView && axisScreenRole(view, heightAxis) !== null
}

export function mergeBounds(a: Vec3, b: Vec3): { min: Vec3; max: Vec3 } {
  return {
    min: {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      z: Math.min(a.z, b.z),
    },
    max: {
      x: Math.max(a.x, b.x),
      y: Math.max(a.y, b.y),
      z: Math.max(a.z, b.z),
    },
  }
}

export function boundsCenter(min: Vec3, max: Vec3): Vec3 {
  return {
    x: (min.x + max.x) / 2,
    y: (min.y + max.y) / 2,
    z: (min.z + max.z) / 2,
  }
}

export function boundsSize(min: Vec3, max: Vec3): Vec3 {
  return {
    x: Math.max(max.x - min.x, 0),
    y: Math.max(max.y - min.y, 0),
    z: Math.max(max.z - min.z, 0),
  }
}

export function boundsFromWorldPoints(points: Vec3[]): { min: Vec3; max: Vec3 } {
  let min: Vec3 = { x: Infinity, y: Infinity, z: Infinity }
  let max: Vec3 = { x: -Infinity, y: -Infinity, z: -Infinity }
  for (const p of points) {
    min = {
      x: Math.min(min.x, p.x),
      y: Math.min(min.y, p.y),
      z: Math.min(min.z, p.z),
    }
    max = {
      x: Math.max(max.x, p.x),
      y: Math.max(max.y, p.y),
      z: Math.max(max.z, p.z),
    }
  }
  return { min, max }
}
