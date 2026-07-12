import * as THREE from 'three'
import type { SceneObject } from '../mesh/HalfEdgeMesh'

export interface LocalAabb {
  minX: number
  minY: number
  minZ: number
  maxX: number
  maxY: number
  maxZ: number
}

/** Packed triangles: 9 floats per tri (a,b,c) + parallel face index. */
export interface FaceTriangulation {
  positions: Float32Array
  faceIndices: Uint32Array
  triangleCount: number
}

const aabbByObject = new WeakMap<SceneObject, LocalAabb>()
const trisByObject = new WeakMap<SceneObject, FaceTriangulation>()

const _box = new THREE.Box3()
const _hit = new THREE.Vector3()

export function getLocalAabb(object: SceneObject): LocalAabb | null {
  if (object.positions.length === 0) return null
  let aabb = aabbByObject.get(object)
  if (aabb) return aabb

  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  for (const p of object.positions) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.z < minZ) minZ = p.z
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
    if (p.z > maxZ) maxZ = p.z
  }
  // Tiny pad for ray precision on axis-aligned faces.
  const pad = 1e-6
  aabb = {
    minX: minX - pad,
    minY: minY - pad,
    minZ: minZ - pad,
    maxX: maxX + pad,
    maxY: maxY + pad,
    maxZ: maxZ + pad,
  }
  aabbByObject.set(object, aabb)
  return aabb
}

export function rayIntersectsLocalAabb(ray: THREE.Ray, aabb: LocalAabb): boolean {
  _box.min.set(aabb.minX, aabb.minY, aabb.minZ)
  _box.max.set(aabb.maxX, aabb.maxY, aabb.maxZ)
  if (_box.containsPoint(ray.origin)) return true
  return ray.intersectBox(_box, _hit) !== null
}

export function getFaceTriangulation(object: SceneObject): FaceTriangulation {
  let cached = trisByObject.get(object)
  if (cached) return cached

  let triCount = 0
  for (const face of object.faces) {
    if (face.length >= 3) triCount += face.length - 2
  }

  const positions = new Float32Array(triCount * 9)
  const faceIndices = new Uint32Array(triCount)
  let ti = 0
  let po = 0

  for (let fi = 0; fi < object.faces.length; fi++) {
    const face = object.faces[fi]
    if (!face || face.length < 3) continue
    const a = object.positions[face[0]!]
    if (!a) continue
    for (let i = 1; i < face.length - 1; i++) {
      const b = object.positions[face[i]!]
      const c = object.positions[face[i + 1]!]
      if (!b || !c) continue
      positions[po++] = a.x
      positions[po++] = a.y
      positions[po++] = a.z
      positions[po++] = b.x
      positions[po++] = b.y
      positions[po++] = b.z
      positions[po++] = c.x
      positions[po++] = c.y
      positions[po++] = c.z
      faceIndices[ti++] = fi
    }
  }

  cached = {
    positions,
    faceIndices,
    triangleCount: ti,
  }
  trisByObject.set(object, cached)
  return cached
}

/** Test helper */
export function clearMeshPickGeometryCacheForTests(objects: SceneObject[]): void {
  for (const obj of objects) {
    aabbByObject.delete(obj)
    trisByObject.delete(obj)
  }
}
