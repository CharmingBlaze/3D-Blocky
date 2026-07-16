import * as THREE from 'three'
import { computeBoundsTree } from 'three-mesh-bvh'
import type { SceneObject } from '../mesh/HalfEdgeMesh'
import { getObjectFaceTriangulation } from '../mesh/faceTriangulation'

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
  geometry: THREE.BufferGeometry
  faceIndices: Uint32Array
  triIndices: Uint32Array
  /** Three original face-corner indices for every generated triangle. */
  cornerIndices: Uint32Array
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

  const faceTris = getObjectFaceTriangulation(object)
  let triCount = 0
  for (const tris of faceTris) triCount += tris.length

  const positions = new Float32Array(triCount * 9)
  const faceIndices = new Uint32Array(triCount)
  const triIndices = new Uint32Array(triCount)
  const cornerIndices = new Uint32Array(triCount * 3)
  let ti = 0
  let po = 0

  for (let fi = 0; fi < object.faces.length; fi++) {
    const face = object.faces[fi]
    const tris = faceTris[fi]
    if (!face || !tris || tris.length === 0) continue
    for (let localTriIndex = 0; localTriIndex < tris.length; localTriIndex++) {
      const [ca, cb, cc] = tris[localTriIndex]!
      const a = object.positions[face[ca]!]
      const b = object.positions[face[cb]!]
      const c = object.positions[face[cc]!]
      if (!a || !b || !c) continue
      positions[po++] = a.x
      positions[po++] = a.y
      positions[po++] = a.z
      positions[po++] = b.x
      positions[po++] = b.y
      positions[po++] = b.z
      positions[po++] = c.x
      positions[po++] = c.y
      positions[po++] = c.z
      faceIndices[ti] = fi
      triIndices[ti] = localTriIndex
      cornerIndices[ti * 3] = ca
      cornerIndices[ti * 3 + 1] = cb
      cornerIndices[ti * 3 + 2] = cc
      ti++
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  // Face/triangle/UV lookup tables below use source triangle order. The BVH's
  // default build reorders the geometry index, making raycast faceIndex point
  // at the wrong source face. Indirect mode keeps those IDs stable.
  computeBoundsTree.call(geometry, { indirect: true })
  geometry.userData.faceIndices = faceIndices
  geometry.userData.triIndices = triIndices

  cached = {
    geometry,
    faceIndices,
    triIndices,
    cornerIndices,
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
