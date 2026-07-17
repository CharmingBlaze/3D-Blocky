import * as THREE from 'three'
import type { SceneObject } from '../mesh/HalfEdgeMesh'
import type { PolyDrawDraftPoint, PolyDrawPointSnap } from '../store/appStore'
import type { Vec3 } from '../utils/math'
import { worldPointFromObject } from '../mesh/objectTransform'
import { getMeshAdjacency } from '../mesh/meshAdjacencyCache'
import { isSceneObjectVisible } from '../scene/objectVisibility'
import { SCENE_GRID_CELL } from '../scene/units'

/** Generous enough for trackpads without making nearby vertices feel ambiguous. */
export const POLY_DRAW_SNAP_RADIUS_PX = 20

export interface PolyDrawSnapTarget {
  world: Vec3
  snap: PolyDrawPointSnap | null
}

export interface PolyDrawSnapOptions {
  snapVertex: boolean
  snapEdge: boolean
  selectionObjectIds: string[]
  draftPoints: PolyDrawDraftPoint[]
  allowCloseLoop: boolean
}

const _world = new THREE.Vector3()

function screenFromWorld(world: Vec3, camera: THREE.Camera, rect: DOMRect) {
  _world.set(world.x, world.y, world.z).project(camera)
  return {
    x: rect.left + (_world.x * 0.5 + 0.5) * rect.width,
    y: rect.top + (-_world.y * 0.5 + 0.5) * rect.height,
  }
}

function distPointToSegment2D(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): { dist: number; t: number } {
  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy
  if (lenSq < 1e-8) {
    return { dist: Math.hypot(px - ax, py - ay), t: 0 }
  }
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  return {
    dist: Math.hypot(px - (ax + t * dx), py - (ay + t * dy)),
    t,
  }
}

/** Quantize a world point to the scene grid used by the viewport. */
export function snapWorldToSceneGrid(world: Vec3, cell = SCENE_GRID_CELL): Vec3 {
  const size = cell > 1e-8 ? cell : SCENE_GRID_CELL
  return {
    x: Math.round(world.x / size) * size,
    y: Math.round(world.y / size) * size,
    z: Math.round(world.z / size) * size,
  }
}

export function findPolyDrawSnapTarget(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  camera: THREE.Camera,
  objects: SceneObject[],
  options: PolyDrawSnapOptions,
  thresholdPx = POLY_DRAW_SNAP_RADIUS_PX
): PolyDrawSnapTarget | null {
  let best: PolyDrawSnapTarget | null = null
  let bestDist = thresholdPx

  const objectSet = new Set<string>()
  if (options.snapVertex || options.snapEdge) {
    for (const o of objects) if (isSceneObjectVisible(o)) objectSet.add(o.id)
  }
  for (const id of options.selectionObjectIds) objectSet.add(id)

  if (options.snapVertex) {
    for (const obj of objects) {
      if (!objectSet.has(obj.id) || !isSceneObjectVisible(obj)) continue
      for (let vi = 0; vi < obj.positions.length; vi++) {
        const world = worldPointFromObject(obj, obj.positions[vi])
        const screen = screenFromWorld(world, camera, rect)
        const dist = Math.hypot(clientX - screen.x, clientY - screen.y)
        if (dist < bestDist) {
          bestDist = dist
          best = {
            world,
            snap: { kind: 'mesh', objectId: obj.id, vertexIndex: vi },
          }
        }
      }
    }
  }

  if (options.snapEdge) {
    for (const obj of objects) {
      if (!objectSet.has(obj.id) || !isSceneObjectVisible(obj)) continue
      const { uniqueEdges } = getMeshAdjacency(obj)
      for (const [a, b] of uniqueEdges) {
        const wa = worldPointFromObject(obj, obj.positions[a]!)
        const wb = worldPointFromObject(obj, obj.positions[b]!)
        const sa = screenFromWorld(wa, camera, rect)
        const sb = screenFromWorld(wb, camera, rect)
        const { dist, t } = distPointToSegment2D(clientX, clientY, sa.x, sa.y, sb.x, sb.y)
        if (dist >= bestDist) continue
        bestDist = dist
        const world = {
          x: wa.x + (wb.x - wa.x) * t,
          y: wa.y + (wb.y - wa.y) * t,
          z: wa.z + (wb.z - wa.z) * t,
        }
        best = {
          world,
          snap: { kind: 'edge', objectId: obj.id, a, b, t },
        }
      }
    }
  }

  // Draft points stay snappable so Line can close a loop even when mesh snaps are off.
  for (let i = 0; i < options.draftPoints.length; i++) {
    if (i === 0 && !options.allowCloseLoop) continue
    const pt = options.draftPoints[i]
    const screen = screenFromWorld(pt.world, camera, rect)
    const dist = Math.hypot(clientX - screen.x, clientY - screen.y)
    if (dist < bestDist) {
      bestDist = dist
      if (pt.snap?.kind === 'mesh') {
        best = {
          world: { ...pt.world },
          snap: { kind: 'mesh', objectId: pt.snap.objectId, vertexIndex: pt.snap.vertexIndex },
        }
      } else {
        best = {
          world: { ...pt.world },
          snap: { kind: 'draft', draftIndex: i },
        }
      }
    }
  }

  return best
}

export function snapHighlightFromTarget(target: PolyDrawSnapTarget | null) {
  if (!target) return null
  return {
    world: target.world,
    isDraft: target.snap?.kind === 'draft',
  }
}
