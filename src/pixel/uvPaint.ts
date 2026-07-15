import * as THREE from 'three'
import type { SceneObject } from '../mesh/HalfEdgeMesh'
import type { Uv2 } from '../uv/uvTypes'
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

const _ndc = new THREE.Vector2()
const _ray = new THREE.Raycaster()
const _v0 = new THREE.Vector3()
const _v1 = new THREE.Vector3()
const _v2 = new THREE.Vector3()
const _hit = new THREE.Vector3()
const _edge1 = new THREE.Vector3()
const _edge2 = new THREE.Vector3()
const _normal = new THREE.Vector3()
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

type FaceAabb = { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }

type ObjectAccel = {
  positionsRef: Vec3[]
  facesRef: number[][]
  faceAabbs: FaceAabb[]
}

const accelCache = new WeakMap<SceneObject, ObjectAccel>()

function getFaceAccel(obj: SceneObject): FaceAabb[] {
  const cached = accelCache.get(obj)
  if (cached && cached.positionsRef === obj.positions && cached.facesRef === obj.faces) {
    return cached.faceAabbs
  }
  const faceAabbs: FaceAabb[] = new Array(obj.faces.length)
  for (let fi = 0; fi < obj.faces.length; fi++) {
    const face = obj.faces[fi]!
    let minX = Infinity
    let minY = Infinity
    let minZ = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    let maxZ = -Infinity
    for (let i = 0; i < face.length; i++) {
      const p = obj.positions[face[i]!]!
      if (p.x < minX) minX = p.x
      if (p.y < minY) minY = p.y
      if (p.z < minZ) minZ = p.z
      if (p.x > maxX) maxX = p.x
      if (p.y > maxY) maxY = p.y
      if (p.z > maxZ) maxZ = p.z
    }
    faceAabbs[fi] = { minX, minY, minZ, maxX, maxY, maxZ }
  }
  accelCache.set(obj, { positionsRef: obj.positions, facesRef: obj.faces, faceAabbs })
  return faceAabbs
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

function rayHitsAabb(ray: THREE.Ray, box: FaceAabb): boolean {
  // Slab test in local space (axis-aligned).
  const ox = ray.origin.x
  const oy = ray.origin.y
  const oz = ray.origin.z
  const dx = ray.direction.x
  const dy = ray.direction.y
  const dz = ray.direction.z
  let tmin = -Infinity
  let tmax = Infinity

  const testAxis = (o: number, d: number, minV: number, maxV: number): boolean => {
    if (Math.abs(d) < 1e-12) {
      return o >= minV && o <= maxV
    }
    const inv = 1 / d
    let t0 = (minV - o) * inv
    let t1 = (maxV - o) * inv
    if (t0 > t1) {
      const tmp = t0
      t0 = t1
      t1 = tmp
    }
    if (t0 > tmin) tmin = t0
    if (t1 < tmax) tmax = t1
    return tmax >= tmin && tmax >= 0
  }

  return (
    testAxis(ox, dx, box.minX, box.maxX) &&
    testAxis(oy, dy, box.minY, box.maxY) &&
    testAxis(oz, dz, box.minZ, box.maxZ)
  )
}

function testTriangle(
  obj: SceneObject,
  face: number[],
  fi: number,
  ti: number,
  rayLocal: THREE.Ray,
  bestFront: FaceTriHit | null,
  bestAny: FaceTriHit | null
): { bestFront: FaceTriHit | null; bestAny: FaceTriHit | null } {
  const corners: [number, number, number] = [0, ti + 1, ti + 2]
  const a = obj.positions[face[corners[0]]!]!
  const b = obj.positions[face[corners[1]]!]!
  const c = obj.positions[face[corners[2]]!]!
  _v0.set(a.x, a.y, a.z)
  _v1.set(b.x, b.y, b.z)
  _v2.set(c.x, c.y, c.z)

  const hit = rayLocal.intersectTriangle(_v0, _v1, _v2, false, _hit)
  if (!hit) return { bestFront, bestAny }

  const bary = barycentricCoords(hit, _v0, _v1, _v2)
  if (!bary) return { bestFront, bestAny }

  _edge1.subVectors(_v1, _v0)
  _edge2.subVectors(_v2, _v0)
  _normal.crossVectors(_edge1, _edge2)
  const frontFacing = rayLocal.direction.dot(_normal) < 0
  const t = rayLocal.origin.distanceTo(hit)
  const candidate: FaceTriHit = {
    faceIndex: fi,
    triIndex: ti,
    t,
    pointLocal: { x: hit.x, y: hit.y, z: hit.z },
    barycentric: bary,
    corners,
  }

  let nextFront = bestFront
  let nextAny = bestAny
  if (frontFacing && (!nextFront || t < nextFront.t)) nextFront = candidate
  if (!nextAny || t < nextAny.t) nextAny = candidate
  return { bestFront: nextFront, bestAny: nextAny }
}

function raycastObjectUv(
  obj: SceneObject,
  rayWorld: THREE.Ray,
  hint?: MeshPickHint | null
): FaceTriHit | null {
  const matrix = buildObjectLocalMatrix(obj)
  _inv.copy(matrix).invert()
  _rayLocal.copy(rayWorld).applyMatrix4(_inv)

  let bestFront: FaceTriHit | null = null
  let bestAny: FaceTriHit | null = null
  const aabbs = getFaceAccel(obj)

  // Warm-start: test the previous triangle first (common during continuous strokes).
  if (hint && hint.objectId === obj.id && hint.faceIndex >= 0 && hint.faceIndex < obj.faces.length) {
    const face = obj.faces[hint.faceIndex]!
    if (hint.triIndex >= 0 && hint.triIndex < face.length - 2) {
      const warmed = testTriangle(obj, face, hint.faceIndex, hint.triIndex, _rayLocal, bestFront, bestAny)
      bestFront = warmed.bestFront
      bestAny = warmed.bestAny
    }
  }

  for (let fi = 0; fi < obj.faces.length; fi++) {
    const face = obj.faces[fi]!
    if (face.length < 3) continue
    const box = aabbs[fi]!
    if (!rayHitsAabb(_rayLocal, box)) continue

    for (let ti = 0; ti < face.length - 2; ti++) {
      if (hint && hint.objectId === obj.id && hint.faceIndex === fi && hint.triIndex === ti) {
        continue // already tested
      }
      const next = testTriangle(obj, face, fi, ti, _rayLocal, bestFront, bestAny)
      bestFront = next.bestFront
      bestAny = next.bestAny
    }
  }

  return bestFront ?? bestAny
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
