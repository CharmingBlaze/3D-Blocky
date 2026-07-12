import * as THREE from 'three'
import type { SceneObject } from '../mesh/HalfEdgeMesh'
import type { PolyDrawDraftPoint, PolyDrawPointSnap } from '../store/appStore'
import type { Vec3 } from '../utils/math'
import { worldPointFromObject } from '../mesh/objectTransform'

/** Generous enough for trackpads without making nearby vertices feel ambiguous. */
export const POLY_DRAW_SNAP_RADIUS_PX = 20

export interface PolyDrawSnapTarget {
  world: Vec3
  snap: PolyDrawPointSnap | null
}

export interface PolyDrawSnapOptions {
  includeAllScene: boolean
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
  if (options.includeAllScene) {
    for (const o of objects) objectSet.add(o.id)
  }
  for (const id of options.selectionObjectIds) objectSet.add(id)

  for (const obj of objects) {
    if (!objectSet.has(obj.id)) continue
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
