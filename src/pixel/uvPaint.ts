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

const _ndc = new THREE.Vector2()
const _ray = new THREE.Raycaster()
const _v0 = new THREE.Vector3()
const _v1 = new THREE.Vector3()
const _v2 = new THREE.Vector3()
const _hit = new THREE.Vector3()
const _edge1 = new THREE.Vector3()
const _edge2 = new THREE.Vector3()
const _normal = new THREE.Vector3()

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
  const v0 = new THREE.Vector3().subVectors(b, a)
  const v1 = new THREE.Vector3().subVectors(c, a)
  const v2 = new THREE.Vector3().subVectors(p, a)
  const d00 = v0.dot(v0)
  const d01 = v0.dot(v1)
  const d11 = v1.dot(v1)
  const d20 = v2.dot(v0)
  const d21 = v2.dot(v1)
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
  const uv0 = uvs[uvIndices[cornerIndices[0]]]
  const uv1 = uvs[uvIndices[cornerIndices[1]]]
  const uv2 = uvs[uvIndices[cornerIndices[2]]]
  return {
    u: uv0.u * bary[0] + uv1.u * bary[1] + uv2.u * bary[2],
    v: uv0.v * bary[0] + uv1.v * bary[1] + uv2.v * bary[2],
  }
}

interface FaceTriHit {
  faceIndex: number
  triIndex: number
  t: number
  pointLocal: THREE.Vector3
  barycentric: [number, number, number]
  corners: [number, number, number]
}

const _world = new THREE.Vector3()

function getObjectLocalMatrix(obj: SceneObject): THREE.Matrix4 {
  const pivot = getObjectPivot(obj)
  const tr = ensureTransform(obj)
  return new THREE.Matrix4()
    .makeTranslation(tr.position.x, tr.position.y, tr.position.z)
    .multiply(
      new THREE.Matrix4().makeRotationFromEuler(
        new THREE.Euler(tr.rotation.x, tr.rotation.y, tr.rotation.z, 'XYZ')
      )
    )
    .multiply(new THREE.Matrix4().makeScale(tr.scale.x, tr.scale.y, tr.scale.z))
    .multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z))
}

function raycastObjectUv(obj: SceneObject, rayWorld: THREE.Ray): FaceTriHit | null {
  const matrix = getObjectLocalMatrix(obj)
  const inv = matrix.clone().invert()
  const rayLocal = rayWorld.clone().applyMatrix4(inv)

  let bestFront: FaceTriHit | null = null
  let bestAny: FaceTriHit | null = null

  for (let fi = 0; fi < obj.faces.length; fi++) {
    const face = obj.faces[fi]
    if (face.length < 3) continue

    for (let ti = 0; ti < face.length - 2; ti++) {
      const corners: [number, number, number] = [0, ti + 1, ti + 2]
      const a = obj.positions[face[corners[0]]]
      const b = obj.positions[face[corners[1]]]
      const c = obj.positions[face[corners[2]]]
      _v0.set(a.x, a.y, a.z)
      _v1.set(b.x, b.y, b.z)
      _v2.set(c.x, c.y, c.z)

      // Two-sided: orthographic edge-on faces and DoubleSide preview need any hit.
      const hit = rayLocal.intersectTriangle(_v0, _v1, _v2, false, _hit)
      if (!hit) continue

      const bary = barycentricCoords(hit, _v0, _v1, _v2)
      if (!bary) continue

      _edge1.subVectors(_v1, _v0)
      _edge2.subVectors(_v2, _v0)
      _normal.crossVectors(_edge1, _edge2)
      const frontFacing = rayLocal.direction.dot(_normal) < 0

      const t = rayLocal.origin.distanceTo(hit)
      const candidate: FaceTriHit = {
        faceIndex: fi,
        triIndex: ti,
        t,
        pointLocal: hit.clone(),
        barycentric: bary,
        corners,
      }

      if (frontFacing && (!bestFront || t < bestFront.t)) bestFront = candidate
      if (!bestAny || t < bestAny.t) bestAny = candidate
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
  preferredObjectId?: string | null
): MeshSurfaceUvHit | null {
  const ray = rayFromPointer(clientX, clientY, rect, camera)
  const candidates = preferredObjectId
    ? objects.filter((o) => o.id === preferredObjectId)
    : objects

  let bestObj: SceneObject | null = null
  let bestHit: FaceTriHit | null = null

  for (const obj of candidates) {
    const hit = raycastObjectUv(obj, ray)
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
  const local = {
    x: bestHit.pointLocal.x,
    y: bestHit.pointLocal.y,
    z: bestHit.pointLocal.z,
  }

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

/** UV → canvas pixel (top-left origin, matches UV Editor). */
export function uvToPixelCoords(uv: Uv2, texW: number, texH: number): { x: number; y: number } {
  return uvToPixel(uv, texW, texH)
}

/** Interpolate screen-space paint path for continuous 3D strokes. */
export function interpolateScreenPaintSamples(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  stepPx: number
): { x: number; y: number }[] {
  const dist = Math.hypot(x1 - x0, y1 - y0)
  const step = Math.max(1, stepPx)
  const count = Math.max(1, Math.ceil(dist / step))
  const samples: { x: number; y: number }[] = []
  for (let i = 0; i <= count; i++) {
    const t = i / count
    samples.push({ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t })
  }
  return samples
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
  const vi0 = face[c[0]]
  const vi1 = face[c[1]]
  const p0 = worldPointFromObject(obj, obj.positions[vi0])
  const p1 = worldPointFromObject(obj, obj.positions[vi1])
  const uv0 = withUvs.uvs![uvIdx[c[0]]]
  const uv1 = withUvs.uvs![uvIdx[c[1]]]

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
