import { generateId } from '../utils/math'
import type { VectorAnchor, VectorPath, ShapeKind } from './types'
import type { ViewType } from '../store/appStore'

const KAPPA = 0.5522847498

function anchor(x: number, y: number, inH: boolean, outH: boolean): VectorAnchor {
  return {
    id: generateId(),
    position: { x, y },
    inHandle: inH ? { x, y } : null,
    outHandle: outH ? { x, y } : null,
  }
}

export function ellipsePath(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  view: ViewType,
  color: number
): VectorPath {
  const ox = rx * KAPPA
  const oy = ry * KAPPA
  return {
    id: generateId(),
    anchors: [
      { id: generateId(), position: { x: cx, y: cy - ry }, inHandle: { x: cx - ox, y: cy - ry }, outHandle: { x: cx + ox, y: cy - ry } },
      { id: generateId(), position: { x: cx + rx, y: cy }, inHandle: { x: cx + rx, y: cy - oy }, outHandle: { x: cx + rx, y: cy + oy } },
      { id: generateId(), position: { x: cx, y: cy + ry }, inHandle: { x: cx + ox, y: cy + ry }, outHandle: { x: cx - ox, y: cy + ry } },
      { id: generateId(), position: { x: cx - rx, y: cy }, inHandle: { x: cx - rx, y: cy + oy }, outHandle: { x: cx - rx, y: cy - oy } },
    ],
    closed: true,
    view,
    color,
    source: 'shape',
    shapeKind: 'circle',
    shapeParams: { center: { x: cx, y: cy }, rx, ry },
  }
}

export function rectPath(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  view: ViewType,
  color: number,
  kind: ShapeKind = 'box'
): VectorPath {
  const minX = Math.min(x0, x1)
  const maxX = Math.max(x0, x1)
  const minY = Math.min(y0, y1)
  const maxY = Math.max(y0, y1)
  return {
    id: generateId(),
    anchors: [
      anchor(minX, minY, false, false),
      anchor(maxX, minY, false, false),
      anchor(maxX, maxY, false, false),
      anchor(minX, maxY, false, false),
    ],
    closed: true,
    view,
    color,
    source: 'shape',
    shapeKind: kind,
    shapeParams: { width: maxX - minX, height: maxY - minY, center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 } },
  }
}

export function polygonPath(
  cx: number,
  cy: number,
  radius: number,
  sides: number,
  view: ViewType,
  color: number
): VectorPath {
  const anchors: VectorAnchor[] = []
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2 - Math.PI / 2
    anchors.push(anchor(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius, false, false))
  }
  return {
    id: generateId(),
    anchors,
    closed: true,
    view,
    color,
    source: 'shape',
    shapeKind: 'pyramid',
    shapeParams: { center: { x: cx, y: cy }, sides },
  }
}

export function starPath(
  cx: number,
  cy: number,
  outerR: number,
  innerR: number,
  points: number,
  view: ViewType,
  color: number
): VectorPath {
  const anchors: VectorAnchor[] = []
  const total = points * 2
  for (let i = 0; i < total; i++) {
    const a = (i / total) * Math.PI * 2 - Math.PI / 2
    const r = i % 2 === 0 ? outerR : innerR
    anchors.push(anchor(cx + Math.cos(a) * r, cy + Math.sin(a) * r, false, false))
  }
  return {
    id: generateId(),
    anchors,
    closed: true,
    view,
    color,
    source: 'shape',
    shapeKind: 'cone',
    shapeParams: { center: { x: cx, y: cy }, starPoints: points, innerRatio: innerR / outerR },
  }
}
