import * as THREE from 'three'
import { acceleratedRaycast } from 'three-mesh-bvh'
import type { SceneObject } from '../mesh/HalfEdgeMesh'
import type { Vec3 } from '../utils/math'
import type { SelectionMode } from '../store/appStore'
import { ensureTransform, getObjectPivot, worldPointFromObject } from '../mesh/objectTransform'
import {
  isEdgeOverlayPickable,
} from '../mesh/edgeOverlay'
import {
  isFaceOverlayGroupPickable,
} from '../mesh/faceOverlay'
import {
  isVertexOverlayGroupPickable,
  viewSpaceZ,
} from '../mesh/vertexOverlay'
import { objectsInScreenRect, pickObjectAt } from './objectPick'
import {
  getFaceTriangulation,
} from './meshPickGeometryCache'
import { getOverlayPickData } from './overlayPickCache'
import { isSceneObjectVisible } from '../scene/objectVisibility'

export interface MeshPickHit {
  objectId: string
  vertex?: number
  edge?: [number, number]
  face?: number
  /** Viewport that produced this hit (hover / pick source). */
  viewportSlot?: number
}

const _ndc = new THREE.Vector2()
const _ray = new THREE.Raycaster()
const _world = new THREE.Vector3()
const _hitLocal = new THREE.Vector3()
const _hitWorld = new THREE.Vector3()
const _triA = new THREE.Vector3()
const _triB = new THREE.Vector3()
const _triC = new THREE.Vector3()
const _rayLocal = new THREE.Ray()
const _matrix = new THREE.Matrix4()
const _invMatrix = new THREE.Matrix4()
const _rotMatrix = new THREE.Matrix4()
const _scaleMatrix = new THREE.Matrix4()
const _pivotMatrix = new THREE.Matrix4()
const _euler = new THREE.Euler()
const _bvhRaycaster = new THREE.Raycaster()
const _bvhMesh = new THREE.Mesh(
  undefined,
  new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
)
_bvhMesh.matrixAutoUpdate = false
_bvhMesh.raycast = acceleratedRaycast

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

/** Correctness path for unsupported or stale BVH state. */
function raycastObjectLinear(
  obj: SceneObject,
  rayWorld: THREE.Ray,
  triData: ReturnType<typeof getFaceTriangulation>,
  matrix: THREE.Matrix4
): FaceHit | null {
  _invMatrix.copy(matrix).invert()
  _rayLocal.copy(rayWorld).applyMatrix4(_invMatrix)
  let best: FaceHit | null = null

  for (let ti = 0; ti < triData.triangleCount; ti++) {
    const fi = triData.faceIndices[ti]
    if (fi === undefined || fi >= obj.faces.length) continue
    const face = obj.faces[fi]
    if (!face) continue
    const ca = triData.cornerIndices[ti * 3]
    const cb = triData.cornerIndices[ti * 3 + 1]
    const cc = triData.cornerIndices[ti * 3 + 2]
    if (ca === undefined || cb === undefined || cc === undefined) continue
    const a = obj.positions[face[ca]!]
    const b = obj.positions[face[cb]!]
    const c = obj.positions[face[cc]!]
    if (!a || !b || !c) continue
    _triA.set(a.x, a.y, a.z)
    _triB.set(b.x, b.y, b.z)
    _triC.set(c.x, c.y, c.z)
    const local = _rayLocal.intersectTriangle(_triA, _triB, _triC, false, _hitLocal)
    if (!local) continue
    _hitWorld.copy(local).applyMatrix4(matrix)
    const distance = rayWorld.origin.distanceTo(_hitWorld)
    if (best && best.t <= distance) continue
    best = {
      objectId: obj.id,
      faceIndex: fi,
      t: distance,
      pointLocal: local.clone(),
    }
  }
  return best
}

function raycastObject(obj: SceneObject, rayWorld: THREE.Ray): FaceHit | null {
  const triData = getFaceTriangulation(obj)
  _bvhMesh.geometry = triData.geometry
  getObjectLocalMatrix(obj, _matrix)
  _bvhMesh.matrixWorld.copy(_matrix)

  _bvhRaycaster.ray.copy(rayWorld)
  const intersects = _bvhRaycaster.intersectObject(_bvhMesh)

  if (intersects.length === 0) return raycastObjectLinear(obj, rayWorld, triData, _matrix)

  // Find the first valid face intersection
  for (const hit of intersects) {
    if (hit.faceIndex == null) continue
    const ti = hit.faceIndex as number
    const fi = triData.faceIndices[ti]
    if (fi === undefined || fi >= obj.faces.length) continue

    _invMatrix.copy(_matrix).invert()
    _hitLocal.copy(hit.point).applyMatrix4(_invMatrix)

    return {
      objectId: obj.id,
      faceIndex: fi,
      t: hit.distance,
      pointLocal: _hitLocal.clone(),
    }
  }

  return raycastObjectLinear(obj, rayWorld, triData, _matrix)
}

function rayFromPointer(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  camera: THREE.Camera
): THREE.Ray {
  camera.updateMatrixWorld(true)
  if ('updateProjectionMatrix' in camera && typeof camera.updateProjectionMatrix === 'function') {
    camera.updateProjectionMatrix()
  }
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
  const { vertexGroups: groups, vertexToFaces } = getOverlayPickData(obj)

  let bestVi: number | null = null
  let bestDist = thresholdPx
  let bestViewZ = -Infinity

  for (const group of groups) {
    const vi = group.indices[0]!
    if (
      cullBackVertices &&
      !isVertexOverlayGroupPickable(obj, group, camera, vertexToFaces)
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
  const { edgeOverlays, edgeToFaces } = getOverlayPickData(obj)
  let best: [number, number] | null = null
  let bestDist = thresholdPx
  let bestViewZ = -Infinity

  for (const overlay of edgeOverlays) {
    const [a, b] = overlay.edge
    if (cullBackEdges && !isEdgeOverlayPickable(obj, overlay, camera, edgeToFaces)) {
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
    ? objects.filter((o) => o.id === preferredId && isSceneObjectVisible(o))
    : objects.filter(isSceneObjectVisible)

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
 * Knife placement: raycast mesh under the cursor, optionally snap to nearby verts/edges.
 * Face hit under the mouse wins unless a vert/edge is clearly closer on screen.
 */
export function pickKnifeHit(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  camera: THREE.Camera,
  objects: SceneObject[],
  preferredObjectId?: string | null,
  modifiers: { shiftKey?: boolean; ctrlKey?: boolean } = {}
): {
  objectId: string
  world: Vec3
  local: Vec3
  snap: 'vertex' | 'edge' | 'face' | 'face-center' | 'grid' | 'space'
  vertexIndex: number | null
  edge: [number, number] | null
  faceIndex: number | null
} | null {
  const ray = rayFromPointer(clientX, clientY, rect, camera)

  // Prefer the active object, but fall back so the cursor still tracks when the ray
  // grazes a different mesh or leaves the preferred silhouette.
  let faceHit =
    (preferredObjectId
      ? pickClosestObject(objects, ray, preferredObjectId)
      : null) ?? pickClosestObject(objects, ray, null)

  if (!faceHit) {
    // Ray missed faces — still allow screen-space snap on the preferred object.
    const targetId = preferredObjectId ??
      objects.find((o) => !o.topologyLocked)?.id ??
      objects[0]?.id
    const obj = targetId ? objects.find((o) => o.id === targetId) : null
    if (!obj) return null

    const vi = pickNearestVertex(obj, clientX, clientY, rect, camera, 12, true)
    if (vi !== null) {
      const local = { ...obj.positions[vi]! }
      return {
        objectId: obj.id,
        world: worldPointFromObject(obj, local),
        local,
        snap: 'vertex',
        vertexIndex: vi,
        edge: null,
        faceIndex: null,
      }
    }
    const edge = pickNearestEdge(obj, clientX, clientY, rect, camera, 10, true)
    if (edge) {
      const local = closestPointOnEdgeLocal(
        obj,
        edge,
        clientX,
        clientY,
        rect,
        camera,
        modifiers.shiftKey ? 0.25 : null
      )
      return {
        objectId: obj.id,
        world: worldPointFromObject(obj, local),
        local,
        snap: 'edge',
        vertexIndex: null,
        edge,
        faceIndex: null,
      }
    }

    return null
  }

  const obj = objects.find((o) => o.id === faceHit!.objectId)
  if (!obj) return null

  const faceLocal = {
    x: faceHit.pointLocal.x,
    y: faceHit.pointLocal.y,
    z: faceHit.pointLocal.z,
  }
  const faceWorld = worldPointFromObject(obj, faceLocal)

  const vi = pickNearestVertex(obj, clientX, clientY, rect, camera, 11, true)
  if (vi !== null) {
    const local = { ...obj.positions[vi]! }
    const world = worldPointFromObject(obj, local)
    const screen = projectWorldToScreen(world, camera, rect)
    const dist = Math.hypot(clientX - screen.x, clientY - screen.y)
    if (dist <= 11) {
      return {
        objectId: obj.id,
        world,
        local,
        snap: 'vertex',
        vertexIndex: vi,
        edge: null,
        faceIndex: faceHit.faceIndex,
      }
    }
  }

  // Edge snap is the main Blockbench cue — prefer edges whenever nearby.
  const edge = pickNearestEdge(obj, clientX, clientY, rect, camera, 18, true)
  if (edge) {
    const local = closestPointOnEdgeLocal(
      obj,
      edge,
      clientX,
      clientY,
      rect,
      camera,
      modifiers.shiftKey ? 0.25 : null
    )
    const world = worldPointFromObject(obj, local)
    const screen = projectWorldToScreen(world, camera, rect)
    const dist = Math.hypot(clientX - screen.x, clientY - screen.y)
    if (dist <= 18) {
      return {
        objectId: obj.id,
        world,
        local,
        snap: 'edge',
        vertexIndex: null,
        edge,
        faceIndex: faceHit.faceIndex,
      }
    }
  }

  if (modifiers.shiftKey) {
    const local = faceCentroidLocal(obj, faceHit.faceIndex)
    return {
      objectId: obj.id,
      world: worldPointFromObject(obj, local),
      local,
      snap: 'face-center',
      vertexIndex: null,
      edge: null,
      faceIndex: faceHit.faceIndex,
    }
  }

  if (modifiers.ctrlKey) {
    const local = snapPointToFaceGrid(obj, faceHit.faceIndex, faceLocal)
    return {
      objectId: obj.id,
      world: worldPointFromObject(obj, local),
      local,
      snap: 'grid',
      vertexIndex: null,
      edge: null,
      faceIndex: faceHit.faceIndex,
    }
  }

  return {
    objectId: obj.id,
    world: faceWorld,
    local: faceLocal,
    snap: 'face',
    vertexIndex: null,
    edge: null,
    faceIndex: faceHit.faceIndex,
  }
}

function closestPointOnEdgeLocal(
  obj: SceneObject,
  edge: [number, number],
  clientX: number,
  clientY: number,
  rect: DOMRect,
  camera: THREE.Camera,
  quantizeStep: number | null = null
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
  if (quantizeStep) t = Math.round(t / quantizeStep) * quantizeStep
  return {
    x: pa.x + (pb.x - pa.x) * t,
    y: pa.y + (pb.y - pa.y) * t,
    z: pa.z + (pb.z - pa.z) * t,
  }
}

function faceCentroidLocal(obj: SceneObject, faceIndex: number): Vec3 {
  const face = obj.faces[faceIndex] ?? []
  if (face.length === 0) return { x: 0, y: 0, z: 0 }
  const center = { x: 0, y: 0, z: 0 }
  for (const vi of face) {
    const point = obj.positions[vi]!
    center.x += point.x
    center.y += point.y
    center.z += point.z
  }
  center.x /= face.length
  center.y /= face.length
  center.z /= face.length
  return center
}

/** Snap within the hit face without moving the point away from its surface plane. */
function snapPointToFaceGrid(
  obj: SceneObject,
  faceIndex: number,
  point: Vec3,
  step = 0.25
): Vec3 {
  const face = obj.faces[faceIndex] ?? []
  if (face.length < 3) return point
  const origin = obj.positions[face[0]!]!
  const edgeEnd = obj.positions[face[1]!]!
  const edge = new THREE.Vector3()
    .subVectors(
      new THREE.Vector3(edgeEnd.x, edgeEnd.y, edgeEnd.z),
      new THREE.Vector3(origin.x, origin.y, origin.z)
    )
    .normalize()
  const normal = new THREE.Vector3()
  for (let i = 1; i + 1 < face.length && normal.lengthSq() < 1e-10; i++) {
    const a = obj.positions[face[i]!]!
    const b = obj.positions[face[i + 1]!]!
    normal.crossVectors(
      new THREE.Vector3(a.x - origin.x, a.y - origin.y, a.z - origin.z),
      new THREE.Vector3(b.x - origin.x, b.y - origin.y, b.z - origin.z)
    )
  }
  if (edge.lengthSq() < 1e-10 || normal.lengthSq() < 1e-10) return point
  normal.normalize()
  const across = new THREE.Vector3().crossVectors(normal, edge).normalize()
  const delta = new THREE.Vector3(point.x - origin.x, point.y - origin.y, point.z - origin.z)
  const u = Math.round(delta.dot(edge) / step) * step
  const v = Math.round(delta.dot(across) / step) * step
  return {
    x: origin.x + edge.x * u + across.x * v,
    y: origin.y + edge.y * u + across.y * v,
    z: origin.z + edge.z * u + across.z * v,
  }
}

function pickNearestFace(
  obj: SceneObject,
  clientX: number,
  clientY: number,
  rect: DOMRect,
  camera: THREE.Camera,
  thresholdPx = 18,
  cullBackFaces = false
): number | null {
  let bestFi: number | null = null
  let bestDist = thresholdPx
  let bestViewZ = -Infinity

  for (const group of getOverlayPickData(obj).faceGroups) {
    if (cullBackFaces && !isFaceOverlayGroupPickable(obj, group, camera)) {
      continue
    }
    const world = worldPointFromObject(obj, group.centroid)
    const screen = projectWorldToScreen(world, camera, rect)
    const dist = Math.hypot(clientX - screen.x, clientY - screen.y)
    if (dist > thresholdPx) continue

    const vz = viewSpaceZ(camera, world)
    const isCloser =
      bestFi === null ||
      dist < bestDist - 0.5 ||
      (dist <= bestDist + 0.5 && vz > bestViewZ)

    if (isCloser) {
      bestDist = dist
      bestViewZ = vz
      bestFi = group.faceIndices[0] ?? null
    }
  }

  return bestFi
}

function isSubdivisionPreviewActive(obj: SceneObject): boolean {
  return Boolean(obj.subdEnabled && (obj.subdLevels ?? 0) > 0)
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
    const targetId = preferredObjectId ?? faceHit?.objectId
    const obj = targetId ? objects.find((o) => o.id === targetId) : null

    // X-ray: centroid dots including back faces.
    // SubD preview (X-ray off): cage raycast mismatches the smooth surface — use
    // cage centroid pick (same indices overlays use) instead of cage triangle hits.
    if (!cullBackVertices || (obj && isSubdivisionPreviewActive(obj))) {
      if (obj) {
        const fi = pickNearestFace(
          obj,
          clientX,
          clientY,
          rect,
          camera,
          18,
          cullBackVertices
        )
        if (fi !== null) return { objectId: obj.id, face: fi }
      }
      return null
    }
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
    const { vertexGroups, vertexToFaces } = getOverlayPickData(obj)
    for (const group of vertexGroups) {
      const vi = group.indices[0]!
      if (
        cullBackVertices &&
        !isVertexOverlayGroupPickable(obj, group, camera, vertexToFaces)
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
    const { edgeOverlays, edgeToFaces } = getOverlayPickData(obj)
    for (const overlay of edgeOverlays) {
      const [a, b] = overlay.edge
      if (
        cullBackVertices &&
        !isEdgeOverlayPickable(obj, overlay, camera, edgeToFaces)
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
    for (const group of getOverlayPickData(obj).faceGroups) {
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
    slotIndex?: import('../scene/viewTypes').ViewportSlotIndex
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
    slotIndex = 0,
  } = hints

  if (meshSelectionObjectId) return meshSelectionObjectId
  if (selectedObjectId) return selectedObjectId
  if (selectionObjectIds.length === 1) return selectionObjectIds[0]!

  const pickStart = pickObjectAt(startX, startY, viewportRect, camera, slotIndex)
  if (pickStart) return pickStart
  const pickEnd = pickObjectAt(endX, endY, viewportRect, camera, slotIndex)
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
