import * as THREE from 'three'
import { getPickTargets } from './pickRegistry'
import type { SceneObject } from '../mesh/HalfEdgeMesh'
import { ensureTransform, worldPointFromObject } from '../mesh/objectTransform'
import { getLocalAabb } from './meshPickGeometryCache'
import type { ViewportSlotIndex } from '../scene/viewTypes'
import { isSceneObjectVisible } from '../scene/objectVisibility'

const raycaster = new THREE.Raycaster()
const ndc = new THREE.Vector2()
const _projected = new THREE.Vector3()

export function pickObjectAt(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  camera: THREE.Camera,
  slotIndex: ViewportSlotIndex = 0
): string | null {
  const targets = getPickTargets(slotIndex)
  if (targets.length === 0) return null

  ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1
  ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(ndc, camera)

  for (const target of targets) {
    target.updateWorldMatrix(true, true)
  }

  const hits = raycaster.intersectObjects(targets, true)
  if (hits.length === 0) return null

  let node: THREE.Object3D | null = hits[0].object
  while (node) {
    const id = node.userData.sceneObjectId as string | undefined
    if (id) return id
    node = node.parent
  }

  return null
}

/**
 * Screen-space bounds from the object's local AABB (8 corners).
 * O(1) in vertex count — used for marquee object culling.
 */
export function objectScreenBounds(
  obj: SceneObject,
  camera: THREE.Camera,
  rect: DOMRect
): { left: number; top: number; right: number; bottom: number } | null {
  const aabb = getLocalAabb(obj)
  if (!aabb) return null

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (let i = 0; i < 8; i++) {
    const lx = i & 1 ? aabb.maxX : aabb.minX
    const ly = i & 2 ? aabb.maxY : aabb.minY
    const lz = i & 4 ? aabb.maxZ : aabb.minZ
    const world = worldPointFromObject(obj, { x: lx, y: ly, z: lz })
    _projected.set(world.x, world.y, world.z).project(camera)
    const sx = rect.left + ((_projected.x + 1) / 2) * rect.width
    const sy = rect.top + ((-_projected.y + 1) / 2) * rect.height
    if (sx < minX) minX = sx
    if (sx > maxX) maxX = sx
    if (sy < minY) minY = sy
    if (sy > maxY) maxY = sy
  }

  return { left: minX, top: minY, right: maxX, bottom: maxY }
}

export function objectsInScreenRect(
  objects: SceneObject[],
  screenRect: { x0: number; y0: number; x1: number; y1: number },
  camera: THREE.Camera,
  viewportRect: DOMRect
): string[] {
  const left = Math.min(screenRect.x0, screenRect.x1)
  const right = Math.max(screenRect.x0, screenRect.x1)
  const top = Math.min(screenRect.y0, screenRect.y1)
  const bottom = Math.max(screenRect.y0, screenRect.y1)

  const ids: string[] = []
  for (const obj of objects) {
    if (!isSceneObjectVisible(obj)) continue
    const b = objectScreenBounds(obj, camera, viewportRect)
    if (!b) continue
    if (b.right >= left && b.left <= right && b.bottom >= top && b.top <= bottom) {
      ids.push(obj.id)
    }
  }
  return ids
}

/** Gizmo / pivot world position for the selected object */
export function objectPivotWorld(obj: SceneObject): THREE.Vector3 {
  const tr = ensureTransform(obj)
  return new THREE.Vector3(tr.position.x, tr.position.y, tr.position.z)
}
