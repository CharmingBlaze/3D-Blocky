import type { ViewType } from '../store/appStore'
import type { VectorPath } from './types'
import type { Vec2 } from '../utils/math'

export interface PathEndpointHit {
  pathId: string
  path: VectorPath
  anchorIndex: number
  position: Vec2
  isStart: boolean
  isEnd: boolean
}

export function pathEndpoints(path: VectorPath): { index: number; position: Vec2; isStart: boolean; isEnd: boolean }[] {
  const n = path.anchors.length
  if (n === 0) return []
  const out: { index: number; position: Vec2; isStart: boolean; isEnd: boolean }[] = [
    { index: 0, position: path.anchors[0].position, isStart: true, isEnd: n === 1 },
  ]
  if (n > 1) {
    out.push({
      index: n - 1,
      position: path.anchors[n - 1].position,
      isStart: false,
      isEnd: true,
    })
  }
  return out
}

export function findNearestPathEndpoint(
  point: Vec2,
  view: ViewType,
  paths: VectorPath[],
  threshold: number
): PathEndpointHit | null {
  let best: PathEndpointHit | null = null
  let bestDist = threshold

  for (const path of paths) {
    if (path.view !== view || path.source !== 'pen') continue
    for (const ep of pathEndpoints(path)) {
      if (!path.closed && ep.isStart && path.anchors.length >= 3) {
        // open path start can close — handled separately in pen tool
      }
      const d = Math.hypot(point.x - ep.position.x, point.y - ep.position.y)
      if (d <= bestDist) {
        bestDist = d
        best = {
          pathId: path.id,
          path,
          anchorIndex: ep.index,
          position: { ...ep.position },
          isStart: ep.isStart,
          isEnd: ep.isEnd,
        }
      }
    }
  }

  return best
}

export function snapPointToEndpoint(
  point: Vec2,
  hit: PathEndpointHit | null
): Vec2 {
  return hit ? { ...hit.position } : point
}

export function cloneAnchors(path: VectorPath): VectorPath['anchors'] {
  return path.anchors.map((a) => ({
    ...a,
    position: { ...a.position },
    inHandle: a.inHandle ? { ...a.inHandle } : null,
    outHandle: a.outHandle ? { ...a.outHandle } : null,
  }))
}
