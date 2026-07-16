import * as THREE from 'three'
import type { SceneObject } from '../mesh/HalfEdgeMesh'
import type { Uv2 } from '../uv/uvTypes'
import { getFaceTriangulation } from '../select/meshPickGeometryCache'
import { acceleratedRaycast } from 'three-mesh-bvh'
import { ensureObjectUVs } from '../uv/uvObject'
import { uvToPixel } from '../uv/uvEditing'
import type { Vec3 } from '../utils/math'
import { ensureTransform, getObjectPivot, worldPointFromObject } from '../mesh/objectTransform'

export interface MeshSurfaceUvHit {
  objectId: string
  faceIndex: number
  /** Fan triangle index within the face (0 = first triangle). */
  triIndex: number
  pointLocal: Vec3
  world: Vec3
  uv: Uv2
  barycentric: [number, number, number]
  corners: [number, number, number]
}

export type MeshPickHint = {
  objectId: string
  faceIndex: number
  triIndex: number
}

/**
 * Whether two surface samples may be joined by a texture-space stroke.
 * Faces in separate UV islands can be neighbours in 3D but far apart in the
 * atlas; joining those samples creates the long, seemingly random lines seen
 * when a brush crosses a seam.
 */
export function areSurfaceHitsUvContinuous(
  object: SceneObject,
  previous: MeshSurfaceUvHit,
  next: MeshSurfaceUvHit,
  epsilon = 1e-5
): boolean {
  if (previous.objectId !== next.objectId) return false
  if (previous.faceIndex === next.faceIndex) return true

  const withUvs = ensureObjectUVs(object)
  const faceA = object.faces[previous.faceIndex]
  const faceB = object.faces[next.faceIndex]
  const uvA = withUvs.faceUvIndices[previous.faceIndex]
  const uvB = withUvs.faceUvIndices[next.faceIndex]
  if (!faceA || !faceB || !uvA || !uvB || !withUvs.uvs) return false

  let matchingSharedVertices = 0
  for (let ca = 0; ca < faceA.length; ca++) {
    const cb = faceB.indexOf(faceA[ca]!)
    if (cb < 0) continue
    const a = withUvs.uvs[uvA[ca]!]
    const b = withUvs.uvs[uvB[cb]!]
    if (!a || !b || Math.abs(a.u - b.u) > epsilon || Math.abs(a.v - b.v) > epsilon) {
      return false
    }
    matchingSharedVertices++
  }

  // A continuous boundary is a shared edge, not merely a shared corner.
  return matchingSharedVertices >= 2
}

const _ndc = new THREE.Vector2()
const _ray = new THREE.Raycaster()
const _v0 = new THREE.Vector3()
const _v1 = new THREE.Vector3()
const _v2 = new THREE.Vector3()
const _hit = new THREE.Vector3()
const _matrix = new THREE.Matrix4()
const _rot = new THREE.Matrix4()
const _scl = new THREE.Matrix4()
const _piv = new THREE.Matrix4()
const _inv = new THREE.Matrix4()
const _rayLocal = new THREE.Ray()
const _euler = new THREE.Euler()
const _world = new THREE.Vector3()
const _baryA = new THREE.Vector3()
const _baryB = new THREE.Vector3()
const _baryC = new THREE.Vector3()

/** Max screen samples per pointer-move for paint-on-model (keeps raycasts bounded). */
// Ray/triangle tests are the expensive part of 3D painting. Four samples per
// pointer event are enough because the texel stroke engine joins the UV points.
export const MAX_PAINT_SCREEN_SAMPLES = 4

function rayFromPointer(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  camera: THREE.Camera
): THREE.Ray {
  // Pointer events can arrive before a demand-rendered orthographic viewport has
  // rendered its newly activated camera. Keep ray construction independent of a
  // render frame so paint-on-model works immediately in every viewport.
  camera.updateMatrixWorld(true)
  if ('updateProjectionMatrix' in camera && typeof camera.updateProjectionMatrix === 'function') {
    camera.updateProjectionMatrix()
  }
  _ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1
  _ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1
  _ray.setFromCamera(_ndc, camera)
  return _ray.ray
}

function barycentricCoords(
  p: THREE.Vector3,
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3
): [number, number, number] | null {
  _baryA.subVectors(b, a)
  _baryB.subVectors(c, a)
  _baryC.subVectors(p, a)
  const d00 = _baryA.dot(_baryA)
  const d01 = _baryA.dot(_baryB)
  const d11 = _baryB.dot(_baryB)
  const d20 = _baryC.dot(_baryA)
  const d21 = _baryC.dot(_baryB)
  const denom = d00 * d11 - d01 * d01
  if (Math.abs(denom) < 1e-12) return null
  const v = (d11 * d20 - d01 * d21) / denom
  const w = (d00 * d21 - d01 * d20) / denom
  const u = 1 - v - w
  if (u < -0.001 || v < -0.001 || w < -0.001) return null
  return [u, v, w]
}

function interpolateUv(
  uvs: Uv2[],
  uvIndices: number[],
  cornerIndices: [number, number, number],
  bary: [number, number, number]
): Uv2 {
  const uv0 = uvs[uvIndices[cornerIndices[0]]!]!
  const uv1 = uvs[uvIndices[cornerIndices[1]]!]!
  const uv2 = uvs[uvIndices[cornerIndices[2]]!]!
  return {
    u: uv0.u * bary[0] + uv1.u * bary[1] + uv2.u * bary[2],
    v: uv0.v * bary[0] + uv1.v * bary[1] + uv2.v * bary[2],
  }
}

interface FaceTriHit {
  faceIndex: number
  triIndex: number
  t: number
  pointLocal: { x: number; y: number; z: number }
  barycentric: [number, number, number]
  corners: [number, number, number]
}

function buildObjectLocalMatrix(obj: SceneObject): THREE.Matrix4 {
  const pivot = getObjectPivot(obj)
  const tr = ensureTransform(obj)
  _euler.set(tr.rotation.x, tr.rotation.y, tr.rotation.z, 'XYZ')
  _matrix.makeTranslation(tr.position.x, tr.position.y, tr.position.z)
  _rot.makeRotationFromEuler(_euler)
  _scl.makeScale(tr.scale.x, tr.scale.y, tr.scale.z)
  _piv.makeTranslation(-pivot.x, -pivot.y, -pivot.z)
  return _matrix.multiply(_rot).multiply(_scl).multiply(_piv)
}

const _bvhRaycaster = new THREE.Raycaster()
const _bvhMesh = new THREE.Mesh(
  undefined,
  new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
)
_bvhMesh.matrixAutoUpdate = false
_bvhMesh.raycast = acceleratedRaycast

/** Correctness fallback for stale or unsupported BVH state. Runs only on a BVH miss. */
function raycastObjectUvLinear(
  obj: SceneObject,
  rayWorld: THREE.Ray,
  triData: ReturnType<typeof getFaceTriangulation>,
  matrix: THREE.Matrix4
): FaceTriHit | null {
  _inv.copy(matrix).invert()
  _rayLocal.copy(rayWorld).applyMatrix4(_inv)
  let best: FaceTriHit | null = null

  for (let ti = 0; ti < triData.triangleCount; ti++) {
    const fi = triData.faceIndices[ti]!
    const face = obj.faces[fi]
    if (!face) continue
    const corners: [number, number, number] = [
      triData.cornerIndices[ti * 3]!,
      triData.cornerIndices[ti * 3 + 1]!,
      triData.cornerIndices[ti * 3 + 2]!,
    ]
    const a = obj.positions[face[corners[0]]!]
    const b = obj.positions[face[corners[1]]!]
    const c = obj.positions[face[corners[2]]!]
    if (!a || !b || !c) continue
    _v0.set(a.x, a.y, a.z)
    _v1.set(b.x, b.y, b.z)
    _v2.set(c.x, c.y, c.z)
    const point = _rayLocal.intersectTriangle(_v0, _v1, _v2, false, _hit)
    if (!point) continue
    const barycentric = barycentricCoords(point, _v0, _v1, _v2)
    if (!barycentric) continue
    const distance = _rayLocal.origin.distanceTo(point)
    if (best && best.t <= distance) continue
    best = {
      faceIndex: fi,
      triIndex: triData.triIndices[ti]!,
      t: distance,
      pointLocal: { x: point.x, y: point.y, z: point.z },
      barycentric,
      corners,
    }
  }
  return best
}

function raycastObjectUv(
  obj: SceneObject,
  rayWorld: THREE.Ray,
  _hint?: MeshPickHint | null
): FaceTriHit | null {
  const triData = getFaceTriangulation(obj)
  _bvhMesh.geometry = triData.geometry
  const matrix = buildObjectLocalMatrix(obj)
  _bvhMesh.matrixWorld.copy(matrix)

  _bvhRaycaster.ray.copy(rayWorld)
  const intersects = _bvhRaycaster.intersectObject(_bvhMesh)
  if (intersects.length === 0) {
    return raycastObjectUvLinear(obj, rayWorld, triData, matrix)
  }

  // Find the first valid intersection
  // intersect.faceIndex is the triangle index (from 0 to triangleCount - 1)
  // We need to map it back to original face index and local tri index
  for (const hit of intersects) {
    if (hit.faceIndex == null) continue
    const ti = hit.faceIndex as number
    const fi = triData.faceIndices[ti]!
    const localTriIndex = triData.triIndices[ti]!
    const face = obj.faces[fi]
    if (!face) continue

    const corners: [number, number, number] = [
      triData.cornerIndices[ti * 3]!,
      triData.cornerIndices[ti * 3 + 1]!,
      triData.cornerIndices[ti * 3 + 2]!,
    ]
    const v0 = obj.positions[face[corners[0]]!]
    const v1 = obj.positions[face[corners[1]]!]
    const v2 = obj.positions[face[corners[2]]!]
    if (!v0 || !v1 || !v2) continue
    _v0.set(v0.x, v0.y, v0.z)
    _v1.set(v1.x, v1.y, v1.z)
    _v2.set(v2.x, v2.y, v2.z)

    // Raycaster point is in world space, convert to local
    _inv.copy(matrix).invert()
    _hit.copy(hit.point).applyMatrix4(_inv)

    const bary = barycentricCoords(_hit, _v0, _v1, _v2)
    if (!bary) continue

    return {
      faceIndex: fi,
      triIndex: localTriIndex,
      t: hit.distance,
      pointLocal: { x: _hit.x, y: _hit.y, z: _hit.z },
      barycentric: bary,
      corners,
    }
  }
  return raycastObjectUvLinear(obj, rayWorld, triData, matrix)
}

/** Raycast mesh surface and return barycentric-interpolated UV. */
export function pickMeshSurfaceUv(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  camera: THREE.Camera,
  objects: SceneObject[],
  preferredObjectId?: string | null,
  hint?: MeshPickHint | null
): MeshSurfaceUvHit | null {
  const ray = rayFromPointer(clientX, clientY, rect, camera)
  const candidates = preferredObjectId
    ? objects.filter((o) => o.id === preferredObjectId)
    : objects

  let bestObj: SceneObject | null = null
  let bestHit: FaceTriHit | null = null

  for (const obj of candidates) {
    const hit = raycastObjectUv(obj, ray, hint)
    if (!hit) continue
    if (!bestHit || hit.t < bestHit.t) {
      bestHit = hit
      bestObj = obj
    }
  }

  if (!bestObj || !bestHit) return null

  const withUvs = ensureObjectUVs(bestObj)
  const uvIndices = withUvs.faceUvIndices[bestHit.faceIndex]
  if (!uvIndices || uvIndices.length < 3) return null

  const uv = interpolateUv(withUvs.uvs!, uvIndices, bestHit.corners, bestHit.barycentric)
  const local = bestHit.pointLocal

  return {
    objectId: bestObj.id,
    faceIndex: bestHit.faceIndex,
    triIndex: bestHit.triIndex,
    pointLocal: local,
    world: worldPointFromObject(bestObj, local),
    uv,
    barycentric: bestHit.barycentric,
    corners: bestHit.corners,
  }
}

/** Fast path for painting an already-selected object (avoids scene-wide filtering). */
export function pickObjectSurfaceUv(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  camera: THREE.Camera,
  object: SceneObject,
  hint?: MeshPickHint | null
): MeshSurfaceUvHit | null {
  const ray = rayFromPointer(clientX, clientY, rect, camera)
  const hit = raycastObjectUv(object, ray, hint)
  if (!hit) return null
  const withUvs = ensureObjectUVs(object)
  const uvIndices = withUvs.faceUvIndices[hit.faceIndex]
  if (!uvIndices || uvIndices.length < 3) return null
  return {
    objectId: object.id,
    faceIndex: hit.faceIndex,
    triIndex: hit.triIndex,
    pointLocal: hit.pointLocal,
    world: worldPointFromObject(object, hit.pointLocal),
    uv: interpolateUv(withUvs.uvs!, uvIndices, hit.corners, hit.barycentric),
    barycentric: hit.barycentric,
    corners: hit.corners,
  }
}

/** UV → canvas pixel (top-left origin, matches UV Editor). */
export function uvToPixelCoords(uv: Uv2, texW: number, texH: number): { x: number; y: number } {
  if (texW <= 0 || texH <= 0) return { x: 0, y: 0 }
  const px = uvToPixel(uv, texW, texH)
  // UV edges are inclusive, pixel arrays are not. Keep exact 0/1 UV hits on
  // the first/last texel so painting seams and silhouette edges never vanishes.
  return {
    x: Math.max(0, Math.min(texW - 1, px.x)),
    y: Math.max(0, Math.min(texH - 1, px.y)),
  }
}

/**
 * Interpolate screen-space paint path for continuous 3D strokes.
 * Caps sample count so complex meshes stay interactive while dragging.
 */
export function interpolateScreenPaintSamples(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  stepPx: number,
  maxSamples = MAX_PAINT_SCREEN_SAMPLES
): { x: number; y: number }[] {
  const dist = Math.hypot(x1 - x0, y1 - y0)
  const step = Math.max(1, stepPx)
  const uncapped = Math.max(1, Math.ceil(dist / step))
  const count = Math.min(Math.max(1, maxSamples), uncapped)
  const samples: { x: number; y: number }[] = []
  for (let i = 0; i <= count; i++) {
    const t = i / count
    samples.push({ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t })
  }
  return samples
}

export type PixelShapeTool = 'line' | 'rectangle' | 'ellipse'

/** Shift-constrain shape endpoints (matches Pixel Editor canvas). */
export function constrainPixelShape(
  tool: PixelShapeTool,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  shiftKey: boolean
): { x0: number; y0: number; x1: number; y1: number } {
  if (!shiftKey) return { x0, y0, x1, y1 }
  if (tool === 'line') {
    if (Math.abs(x1 - x0) > Math.abs(y1 - y0)) return { x0, y0, x1, y1: y0 }
    return { x0, y0, x1: x0, y1 }
  }
  const side = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))
  return {
    x0,
    y0,
    x1: x0 + Math.sign(x1 - x0 || 1) * side,
    y1: y0 + Math.sign(y1 - y0 || 1) * side,
  }
}

/** Estimate screen pixels per texel at hit for stroke stepping. */
export function estimateTexelScreenSize(
  hit: MeshSurfaceUvHit,
  obj: SceneObject,
  camera: THREE.Camera,
  rect: DOMRect,
  texW: number,
  texH: number
): number {
  const withUvs = ensureObjectUVs(obj)
  const face = obj.faces[hit.faceIndex]
  const uvIdx = withUvs.faceUvIndices[hit.faceIndex]
  if (!face || !uvIdx) return 4

  const c = hit.corners
  const vi0 = face[c[0]]!
  const vi1 = face[c[1]]!
  const p0 = worldPointFromObject(obj, obj.positions[vi0]!)
  const p1 = worldPointFromObject(obj, obj.positions[vi1]!)
  const uv0 = withUvs.uvs![uvIdx[c[0]]!]!
  const uv1 = withUvs.uvs![uvIdx[c[1]]!]!

  const worldDist = Math.hypot(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z)
  const uvDist = Math.hypot((uv1.u - uv0.u) * texW, (uv1.v - uv0.v) * texH)
  if (uvDist < 1e-6) return 4
  void worldDist

  const project = (p: Vec3) => {
    _world.set(p.x, p.y, p.z).project(camera)
    return {
      x: rect.left + (_world.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (-_world.y * 0.5 + 0.5) * rect.height,
    }
  }
  const s0 = project(p0)
  const s1 = project(p1)
  const screenDist = Math.hypot(s1.x - s0.x, s1.y - s0.y)
  return Math.max(1, screenDist / uvDist)
}
