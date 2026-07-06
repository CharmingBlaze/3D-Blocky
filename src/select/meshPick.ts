import * as THREE from 'three'
import type { SceneObject } from '../mesh/HalfEdgeMesh'
import type { Vec3 } from '../utils/math'
import type { SelectionMode } from '../store/appStore'
import { ensureTransform, getObjectPivot, worldPointFromObject } from '../mesh/objectTransform'
import {
  buildEdgeOverlays,
  isEdgeOverlayPickable,
} from '../mesh/edgeOverlay'
import {
  buildFaceOverlayGroups,
  isFaceOverlayGroupPickable,
} from '../mesh/faceOverlay'
import {
  buildVertexOverlayGroups,
  isVertexOverlayGroupPickable,
  viewSpaceZ,
} from '../mesh/vertexOverlay'
import { buildEdgeToFacesMap, buildVertexToFacesMap } from '../mesh/overlayVisibility'
import { objectsInScreenRect, pickObjectAt } from './objectPick'

export interface MeshPickHit {
  objectId: string
  vertex?: number
  edge?: [number, number]
  face?: number
}

const _ndc = new THREE.Vector2()
const _ray = new THREE.Raycaster()
const _v0 = new THREE.Vector3()
const _v1 = new THREE.Vector3()
const _v2 = new THREE.Vector3()
const _world = new THREE.Vector3()
const _hitLocal = new THREE.Vector3()
const _matrix = new THREE.Matrix4()
const _invMatrix = new THREE.Matrix4()
const _rotMatrix = new THREE.Matrix4()
const _scaleMatrix = new THREE.Matrix4()
const _pivotMatrix = new THREE.Matrix4()
const _euler = new THREE.Euler()
const _rayLocal = new THREE.Ray()
const _bestPointLocal = new THREE.Vector3()

export interface MeshPickOptions {
  /** When true, ignore back-facing verts/edges (matches overlay when X-ray is off). */
  cullBackVertices?: boolean
}

function getObjectLocalMatrix(obj: SceneObject, target: THREE.Matrix4): THREE.Matrix4 {
  const pivot = getObjectPivot(obj)
  const tr = ensureTransform(obj)
  _euler.set(tr.rotation.x, tr.rotation.y, tr.rotation.z, 'XYZ')
  _rotMatrix.makeRotationFromEuler(_euler)
  _scaleMatrix.makeScale(tr.scale.x, tr.scale.y, tr.scale.z)
  _pivotMatrix.makeTranslation(-pivot.x, -pivot.y, -pivot.z)
  return target
    .makeTranslation(tr.position.x, tr.position.y, tr.position.z)
    .multiply(_rotMatrix)
    .multiply(_scaleMatrix)
    .multiply(_pivotMatrix)
}

interface FaceHit {
  objectId: string
  faceIndex: number
  t: number
  pointLocal: THREE.Vector3
}

function raycastObject(obj: SceneObject, rayWorld: THREE.Ray): FaceHit | null {
  getObjectLocalMatrix(obj, _matrix)
  _invMatrix.copy(_matrix).invert()
  _rayLocal.origin.copy(rayWorld.origin).applyMatrix4(_invMatrix)
  _rayLocal.direction.copy(rayWorld.direction).transformDirection(_invMatrix)

  let bestT = Infinity
  let bestFace = -1
  let bestPoint: THREE.Vector3 | null = null

  for (let fi = 0; fi < obj.faces.length; fi++) {
    const face = obj.faces[fi]
    if (face.length < 3) continue

    for (let i = 1; i < face.length - 1; i++) {
      const a = obj.positions[face[0]]
      const b = obj.positions[face[i]]
      const c = obj.positions[face[i + 1]]
      _v0.set(a.x, a.y, a.z)
      _v1.set(b.x, b.y, b.z)
      _v2.set(c.x, c.y, c.z)

      const hit = _rayLocal.intersectTriangle(_v0, _v1, _v2, false, _hitLocal)
      if (!hit) continue

      const t = _rayLocal.origin.distanceTo(hit)
      if (t < bestT) {
        bestT = t
        bestFace = fi
        bestPoint = _bestPointLocal.copy(hit)
      }
    }
  }

  if (bestFace < 0 || !bestPoint) return null
  return {
    objectId: obj.id,
    faceIndex: bestFace,
    t: bestT,
    pointLocal: _bestPointLocal.clone(),
  }
}

function rayFromPointer(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  camera: THREE.Camera
): THREE.Ray {
  _ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1
  _ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1
  _ray.setFromCamera(_ndc, camera)
  return _ray.ray
}

function projectWorldToScreen(
  world: Vec3,
  camera: THREE.Camera,
  rect: DOMRect
): { x: number; y: number } {
  _world.set(world.x, world.y, world.z).project(camera)
  return {
    x: rect.left + (_world.x * 0.5 + 0.5) * rect.width,
    y: rect.top + (-_world.y * 0.5 + 0.5) * rect.height,
  }
}

function pickNearestVertex(
  obj: SceneObject,
  clientX: number,
  clientY: number,
  rect: DOMRect,
  camera: THREE.Camera,
  thresholdPx = 14,
  cullBackVertices = false
): number | null {
  const groups = buildVertexOverlayGroups(obj)
  const vertexFaces = buildVertexToFacesMap(obj)

  let bestVi: number | null = null
  let bestDist = thresholdPx
  let bestViewZ = -Infinity

  for (const group of groups) {
    const vi = group.indices[0]!
    if (
      cullBackVertices &&
      !isVertexOverlayGroupPickable(obj, group, camera, vertexFaces)
    ) {
      continue
    }

    const world = worldPointFromObject(obj, group.position)
    const screen = projectWorldToScreen(world, camera, rect)
    const dist = Math.hypot(clientX - screen.x, clientY - screen.y)
    if (dist > thresholdPx) continue

    const vz = viewSpaceZ(camera, world)
    const isCloser =
      bestVi === null ||
      dist < bestDist - 0.5 ||
      (dist <= bestDist + 0.5 && vz > bestViewZ)

    if (isCloser) {
      bestDist = dist
      bestViewZ = vz
      bestVi = vi
    }
  }

  return bestVi
}

function distPointToSegment2D(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy
  if (lenSq < 1e-8) return Math.hypot(px - ax, py - ay)
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

function pickNearestEdge(
  obj: SceneObject,
  clientX: number,
  clientY: number,
  rect: DOMRect,
  camera: THREE.Camera,
  thresholdPx = 12,
  cullBackEdges = false
): [number, number] | null {
  const edgeFaces = buildEdgeToFacesMap(obj)
  let best: [number, number] | null = null
  let bestDist = thresholdPx
  let bestViewZ = -Infinity

  for (const overlay of buildEdgeOverlays(obj)) {
    const [a, b] = overlay.edge
    if (cullBackEdges && !isEdgeOverlayPickable(obj, overlay, camera, edgeFaces)) {
      continue
    }

    const wa = worldPointFromObject(obj, obj.positions[a]!)
    const wb = worldPointFromObject(obj, obj.positions[b]!)
    const sa = projectWorldToScreen(wa, camera, rect)
    const sb = projectWorldToScreen(wb, camera, rect)
    const dist = distPointToSegment2D(clientX, clientY, sa.x, sa.y, sb.x, sb.y)
    if (dist > thresholdPx) continue

    const mid = {
      x: (wa.x + wb.x) / 2,
      y: (wa.y + wb.y) / 2,
      z: (wa.z + wb.z) / 2,
    }
    const vz = viewSpaceZ(camera, mid)
    const isCloser =
      best === null ||
      dist < bestDist - 0.5 ||
      (dist <= bestDist + 0.5 && vz > bestViewZ)

    if (isCloser) {
      bestDist = dist
      bestViewZ = vz
      best = overlay.edge
    }
  }

  return best
}

function pickClosestObject(
  objects: SceneObject[],
  ray: THREE.Ray,
  preferredId?: string | null
): FaceHit | null {
  const candidates = preferredId
    ? objects.filter((o) => o.id === preferredId)
    : objects

  let best: FaceHit | null = null
  for (const obj of candidates) {
    const hit = raycastObject(obj, ray)
    if (!hit) continue
    if (!best || hit.t < best.t) best = hit
  }
  return best
}

/** Raycast surface hit in world space (for knife / placement). */
export function pickMeshSurfaceWorld(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  camera: THREE.Camera,
  objects: SceneObject[],
  preferredObjectId?: string | null
): { objectId: string; world: Vec3 } | null {
  const hit = pickKnifeHit(clientX, clientY, rect, camera, objects, preferredObjectId)
  if (!hit) return null
  return { objectId: hit.objectId, world: hit.world }
}

/**
 * Knife placement: raycast mesh, snap to nearby vertices/edges (Blockbench-style).
 * Returns both world and mesh-local coordinates.
 */
export function pickKnifeHit(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  camera: THREE.Camera,
  objects: SceneObject[],
  preferredObjectId?: string | null
): { objectId: string; world: Vec3; local: Vec3 } | null {
  const ray = rayFromPointer(clientX, clientY, rect, camera)
  const faceHit = pickClosestObject(objects, ray, preferredObjectId)
  if (!faceHit) return null

  const obj = objects.find((o) => o.id === faceHit.objectId)
  if (!obj) return null

  const vi = pickNearestVertex(obj, clientX, clientY, rect, camera, 14, false)
  if (vi !== null) {
    const local = { ...obj.positions[vi]! }
    return { objectId: obj.id, world: worldPointFromObject(obj, local), local }
  }

  const edge = pickNearestEdge(obj, clientX, clientY, rect, camera, 12, false)
  if (edge) {
    const local = closestPointOnEdgeLocal(obj, edge, clientX, clientY, rect, camera)
    return { objectId: obj.id, world: worldPointFromObject(obj, local), local }
  }

  const local = {
    x: faceHit.pointLocal.x,
    y: faceHit.pointLocal.y,
    z: faceHit.pointLocal.z,
  }
  return { objectId: obj.id, world: worldPointFromObject(obj, local), local }
}

function closestPointOnEdgeLocal(
  obj: SceneObject,
  edge: [number, number],
  clientX: number,
  clientY: number,
  rect: DOMRect,
  camera: THREE.Camera
): Vec3 {
  const [a, b] = edge
  const pa = obj.positions[a]!
  const pb = obj.positions[b]!
  const wa = worldPointFromObject(obj, pa)
  const wb = worldPointFromObject(obj, pb)
  const sa = projectWorldToScreen(wa, camera, rect)
  const sb = projectWorldToScreen(wb, camera, rect)
  const dx = sb.x - sa.x
  const dy = sb.y - sa.y
  const lenSq = dx * dx + dy * dy
  let t = lenSq < 1e-8 ? 0 : ((clientX - sa.x) * dx + (clientY - sa.y) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  return {
    x: pa.x + (pb.x - pa.x) * t,
    y: pa.y + (pb.y - pa.y) * t,
    z: pa.z + (pb.z - pa.z) * t,
  }
}

export function pickMeshComponent(
  mode: SelectionMode,
  clientX: number,
  clientY: number,
  rect: DOMRect,
  camera: THREE.Camera,
  objects: SceneObject[],
  preferredObjectId?: string | null,
  options?: MeshPickOptions
): MeshPickHit | null {
  const cullBackVertices = options?.cullBackVertices ?? false
  if (mode === 'object') return null

  const ray = rayFromPointer(clientX, clientY, rect, camera)
  const faceHit = pickClosestObject(objects, ray, preferredObjectId)

  if (mode === 'face') {
    if (!faceHit) return null
    return { objectId: faceHit.objectId, face: faceHit.faceIndex }
  }

  const targetId = faceHit?.objectId ?? preferredObjectId
  const obj = targetId ? objects.find((o) => o.id === targetId) : null
  if (!obj) {
    if (!faceHit) return null
    return { objectId: faceHit.objectId }
  }

  if (mode === 'vertex') {
    const vi = pickNearestVertex(
      obj,
      clientX,
      clientY,
      rect,
      camera,
      14,
      cullBackVertices
    )
    if (vi === null) return faceHit ? { objectId: faceHit.objectId } : null
    return { objectId: obj.id, vertex: vi }
  }

  if (mode === 'edge') {
    const edge = pickNearestEdge(obj, clientX, clientY, rect, camera, 12, cullBackVertices)
    if (!edge) return faceHit ? { objectId: faceHit.objectId } : null
    return { objectId: obj.id, edge }
  }

  return null
}

export interface ScreenRect {
  x0: number
  y0: number
  x1: number
  y1: number
}

function normalizeScreenRect(rect: ScreenRect) {
  return {
    left: Math.min(rect.x0, rect.x1),
    right: Math.max(rect.x0, rect.x1),
    top: Math.min(rect.y0, rect.y1),
    bottom: Math.max(rect.y0, rect.y1),
  }
}

function pointInScreenRect(x: number, y: number, rect: ScreenRect): boolean {
  const r = normalizeScreenRect(rect)
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
}

export function meshComponentsInScreenRect(
  mode: SelectionMode,
  obj: SceneObject,
  screenRect: ScreenRect,
  camera: THREE.Camera,
  viewportRect: DOMRect,
  cullBackVertices = false
): { vertices: number[]; edges: string[]; faces: number[] } {
  const vertices: number[] = []
  const edges: string[] = []
  const faces: number[] = []

  if (mode === 'vertex') {
    const vertexFaces = buildVertexToFacesMap(obj)
    for (const group of buildVertexOverlayGroups(obj)) {
      const vi = group.indices[0]!
      if (
        cullBackVertices &&
        !isVertexOverlayGroupPickable(obj, group, camera, vertexFaces)
      ) {
        continue
      }
      const world = worldPointFromObject(obj, group.position)
      const screen = projectWorldToScreen(world, camera, viewportRect)
      if (pointInScreenRect(screen.x, screen.y, screenRect)) {
        vertices.push(vi)
      }
    }
  }

  if (mode === 'edge') {
    const edgeFaces = buildEdgeToFacesMap(obj)
    for (const overlay of buildEdgeOverlays(obj)) {
      const [a, b] = overlay.edge
      if (
        cullBackVertices &&
        !isEdgeOverlayPickable(obj, overlay, camera, edgeFaces)
      ) {
        continue
      }

      const wa = worldPointFromObject(obj, obj.positions[a]!)
      const wb = worldPointFromObject(obj, obj.positions[b]!)
      const sa = projectWorldToScreen(wa, camera, viewportRect)
      const sb = projectWorldToScreen(wb, camera, viewportRect)
      const mx = (sa.x + sb.x) / 2
      const my = (sa.y + sb.y) / 2
      if (pointInScreenRect(mx, my, screenRect)) {
        edges.push(overlay.key)
      }
    }
  }

  if (mode === 'face') {
    for (const group of buildFaceOverlayGroups(obj)) {
      if (
        cullBackVertices &&
        !isFaceOverlayGroupPickable(obj, group, camera)
      ) {
        continue
      }
      const world = worldPointFromObject(obj, group.centroid)
      const screen = projectWorldToScreen(world, camera, viewportRect)
      if (!pointInScreenRect(screen.x, screen.y, screenRect)) continue
      for (const fi of group.faceIndices) {
        faces.push(fi)
      }
    }
  }

  return { vertices, edges, faces }
}

/** Resolve which mesh receives a component box-select (marquee). */
export function resolveMarqueeMeshObjectId(
  objects: SceneObject[],
  mode: SelectionMode,
  screenRect: ScreenRect,
  camera: THREE.Camera,
  viewportRect: DOMRect,
  hints: {
    meshSelectionObjectId?: string | null
    selectedObjectId?: string | null
    selectionObjectIds?: string[]
    startX: number
    startY: number
    endX: number
    endY: number
  },
  cullBackVertices = false
): string | null {
  const {
    meshSelectionObjectId,
    selectedObjectId,
    selectionObjectIds = [],
    startX,
    startY,
    endX,
    endY,
  } = hints

  if (meshSelectionObjectId) return meshSelectionObjectId
  if (selectedObjectId) return selectedObjectId
  if (selectionObjectIds.length === 1) return selectionObjectIds[0]!

  const pickStart = pickObjectAt(startX, startY, viewportRect, camera)
  if (pickStart) return pickStart
  const pickEnd = pickObjectAt(endX, endY, viewportRect, camera)
  if (pickEnd) return pickEnd

  const objectIds = objectsInScreenRect(objects, screenRect, camera, viewportRect)
  let bestId: string | null = null
  let bestCount = 0
  for (const id of objectIds) {
    const obj = objects.find((o) => o.id === id)
    if (!obj) continue
    const components = meshComponentsInScreenRect(
      mode,
      obj,
      screenRect,
      camera,
      viewportRect,
      cullBackVertices
    )
    const count =
      mode === 'vertex'
        ? components.vertices.length
        : mode === 'edge'
          ? components.edges.length
          : components.faces.length
    if (count > bestCount) {
      bestCount = count
      bestId = id
    }
  }
  return bestId
}
