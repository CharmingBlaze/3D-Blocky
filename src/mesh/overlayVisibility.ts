import * as THREE from 'three'
import type { SceneObject } from './HalfEdgeMesh'
import { ensureTransform, worldPointFromObject } from './objectTransform'
import { boundsCenterHalf } from './roundedBox'
import { faceNormal3D } from '../uv/uvObject'
import { edgeKey } from './meshSelection'

const _euler = new THREE.Euler()
const _normal = new THREE.Vector3()
const _viewDir = new THREE.Vector3()
const _centroid = new THREE.Vector3()
const _meshCenter = new THREE.Vector3()
const _outwardHint = new THREE.Vector3()

function faceLocalCentroid(object: SceneObject, faceIndex: number, out: THREE.Vector3): void {
  const face = object.faces[faceIndex]
  if (!face || face.length === 0) {
    out.set(0, 0, 0)
    return
  }
  out.set(0, 0, 0)
  for (const vi of face) {
    const p = object.positions[vi]!
    out.x += p.x
    out.y += p.y
    out.z += p.z
  }
  out.multiplyScalar(1 / face.length)
}

/** Face normal pointing away from the mesh interior (handles mixed winding). */
function outwardFaceNormalLocal(object: SceneObject, faceIndex: number, out: THREE.Vector3): void {
  const n = faceNormal3D(object, faceIndex)
  out.set(n.x, n.y, n.z)

  faceLocalCentroid(object, faceIndex, _centroid)
  const { center } = boundsCenterHalf(object)
  _outwardHint.set(
    _centroid.x - center.x,
    _centroid.y - center.y,
    _centroid.z - center.z
  )
  if (out.dot(_outwardHint) < 0) out.negate()
}

function outwardFaceNormalWorld(object: SceneObject, faceIndex: number, out: THREE.Vector3): void {
  outwardFaceNormalLocal(object, faceIndex, out)
  const tr = ensureTransform(object)
  _euler.set(tr.rotation.x, tr.rotation.y, tr.rotation.z)
  out.applyEuler(_euler)
  const sx = tr.scale.x || 1
  const sy = tr.scale.y || 1
  const sz = tr.scale.z || 1
  if (sx !== sy || sy !== sz) {
    out.x /= sx
    out.y /= sy
    out.z /= sz
  }
  out.normalize()
}

function viewDirectionToWorldPoint(camera: THREE.Camera, worldPoint: THREE.Vector3, out: THREE.Vector3): void {
  if (camera instanceof THREE.OrthographicCamera) {
    camera.getWorldDirection(out)
    out.negate()
    return
  }
  out.copy(camera.position).sub(worldPoint).normalize()
}

function faceWorldCentroid(object: SceneObject, faceIndex: number, out: THREE.Vector3): void {
  faceLocalCentroid(object, faceIndex, _meshCenter)
  const local = { x: _meshCenter.x, y: _meshCenter.y, z: _meshCenter.z }
  const world = worldPointFromObject(object, local)
  out.set(world.x, world.y, world.z)
}

export function isFaceFrontFacing(
  object: SceneObject,
  faceIndex: number,
  camera: THREE.Camera,
  threshold = 0.001
): boolean {
  const face = object.faces[faceIndex]
  if (!face || face.length < 3) return true

  faceWorldCentroid(object, faceIndex, _centroid)
  viewDirectionToWorldPoint(camera, _centroid, _viewDir)
  outwardFaceNormalWorld(object, faceIndex, _normal)
  return _normal.dot(_viewDir) > threshold
}

function buildVertexToFaces(object: SceneObject): Map<number, number[]> {
  const map = new Map<number, number[]>()
  for (let fi = 0; fi < object.faces.length; fi++) {
    for (const vi of object.faces[fi]!) {
      const list = map.get(vi)
      if (list) list.push(fi)
      else map.set(vi, [fi])
    }
  }
  return map
}

function buildEdgeToFaces(object: SceneObject): Map<string, number[]> {
  const map = new Map<string, number[]>()
  for (let fi = 0; fi < object.faces.length; fi++) {
    const face = object.faces[fi]!
    const n = face.length
    for (let i = 0; i < n; i++) {
      const a = face[i]!
      const b = face[(i + 1) % n]!
      const key = edgeKey(a, b)
      const list = map.get(key)
      if (list) list.push(fi)
      else map.set(key, [fi])
    }
  }
  return map
}

export function buildVertexToFacesMap(object: SceneObject): Map<number, number[]> {
  return buildVertexToFaces(object)
}

export function buildEdgeToFacesMap(object: SceneObject): Map<string, number[]> {
  return buildEdgeToFaces(object)
}
