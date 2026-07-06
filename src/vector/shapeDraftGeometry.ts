import type { ShapeKind } from './types'
import type { Vec2 } from '../utils/math'

export interface DragBounds {
  minU: number
  maxU: number
  minV: number
  maxV: number
  w: number
  h: number
  cu: number
  cv: number
  rx: number
  ry: number
}

export function dragBounds(a: Vec2, b: Vec2): DragBounds {
  const minU = Math.min(a.x, b.x)
  const maxU = Math.max(a.x, b.x)
  const minV = Math.min(a.y, b.y)
  const maxV = Math.max(a.y, b.y)
  const w = maxU - minU
  const h = maxV - minV
  return {
    minU,
    maxU,
    minV,
    maxV,
    w,
    h,
    cu: (minU + maxU) / 2,
    cv: (minV + maxV) / 2,
    rx: Math.max(w / 2, 0.5),
    ry: Math.max(h / 2, 0.5),
  }
}

/** Depth extrusion along canonical +Z (maps to view-facing depth after projection) */
export function extrusionDepth(w: number, h: number): number {
  return Math.max(Math.min(w, h), 1)
}

/** Capsule axis length — longer drag side becomes the pill axis (→ view depth after projection). */
export function capsuleExtrusionDepth(w: number, h: number): number {
  return Math.max(Math.max(w, h), 1)
}

/** Triangle silhouette: apex at top center, base along bottom edge (vertical extrusion). */
export function dragTriangle(a: Vec2, b: Vec2): [Vec2, Vec2, Vec2] {
  const { minU, maxU, minV, maxV, cu } = dragBounds(a, b)
  return [
    { x: minU, y: minV },
    { x: maxU, y: minV },
    { x: cu, y: maxV },
  ]
}

export function dragEllipsePoints(a: Vec2, b: Vec2, segments = 32): Vec2[] {
  const { cu, cv, rx, ry } = dragBounds(a, b)
  const pts: Vec2[] = []
  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * Math.PI * 2
    pts.push({ x: cu + Math.cos(t) * rx, y: cv + Math.sin(t) * ry })
  }
  return pts
}

export function dragRectPoints(a: Vec2, b: Vec2): Vec2[] {
  const { minU, maxU, minV, maxV } = dragBounds(a, b)
  return [
    { x: minU, y: minV },
    { x: maxU, y: minV },
    { x: maxU, y: maxV },
    { x: minU, y: maxV },
    { x: minU, y: minV },
  ]
}

export function dragTriangleOutline(a: Vec2, b: Vec2): Vec2[] {
  const tri = dragTriangle(a, b)
  return [...tri, tri[0]]
}

export function shapeDraftOutline(kind: ShapeKind, a: Vec2, b: Vec2): Vec2[] {
  if (kind === 'sphere' || kind === 'circle' || kind === 'capsule') {
    return dragEllipsePoints(a, b)
  }
  if (kind === 'pyramid' || kind === 'cone') {
    return dragTriangleOutline(a, b)
  }
  return dragRectPoints(a, b)
}
