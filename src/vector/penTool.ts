import type { Vec2 } from '../utils/math'
import type { VectorAnchor } from './types'

const HANDLE_DRAG_PX = 4

export function createAnchor(position: Vec2, id: string): VectorAnchor {
  return {
    id,
    position: { ...position },
    inHandle: null,
    outHandle: null,
  }
}

export function mirrorHandle(anchor: Vec2, handle: Vec2): Vec2 {
  return {
    x: 2 * anchor.x - handle.x,
    y: 2 * anchor.y - handle.y,
  }
}

export function isNearPoint(a: Vec2, b: Vec2, threshold: number): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= threshold
}

/** Apply Illustrator-style symmetric handles when click-dragging a new smooth point. */
export function applySmoothHandles(
  anchors: VectorAnchor[],
  index: number,
  dragPoint: Vec2
): void {
  const current = anchors[index]
  if (!current) return

  current.outHandle = { ...dragPoint }
  current.inHandle = mirrorHandle(current.position, dragPoint)

  if (index > 0) {
    const prev = anchors[index - 1]
    const vx = dragPoint.x - current.position.x
    const vy = dragPoint.y - current.position.y
    prev.outHandle = {
      x: prev.position.x - vx,
      y: prev.position.y - vy,
    }
  }
}

export function clearAnchorHandles(anchor: VectorAnchor): void {
  anchor.inHandle = null
  anchor.outHandle = null
}

export function finalizePendingAnchor(
  anchors: VectorAnchor[],
  index: number,
  releasePoint: Vec2,
  forceCorner = false
): void {
  const anchor = anchors[index]
  if (!anchor) return

  const dragged =
    !forceCorner &&
    Math.hypot(releasePoint.x - anchor.position.x, releasePoint.y - anchor.position.y) >=
      HANDLE_DRAG_PX

  if (dragged) {
    applySmoothHandles(anchors, index, releasePoint)
  } else {
    clearAnchorHandles(anchor)
  }
}
