import type { ObjectTransform, SceneObject } from './HalfEdgeMesh'
import type { Vec3 } from '../utils/math'
import * as THREE from 'three'

export const IDENTITY_TRANSFORM: ObjectTransform = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
}

export function ensureTransform(obj: SceneObject): ObjectTransform {
  return (
    obj.transform ?? {
      position: { ...IDENTITY_TRANSFORM.position },
      rotation: { ...IDENTITY_TRANSFORM.rotation },
      scale: { ...IDENTITY_TRANSFORM.scale },
    }
  )
}

export function cloneTransform(t: ObjectTransform): ObjectTransform {
  return {
    position: { ...t.position },
    rotation: { ...t.rotation },
    scale: { ...t.scale },
  }
}

const TRANSFORM_EPS = 1e-6

export function transformsEqual(
  a: ObjectTransform,
  b: ObjectTransform,
  eps = TRANSFORM_EPS
): boolean {
  return (
    Math.abs(a.position.x - b.position.x) <= eps &&
    Math.abs(a.position.y - b.position.y) <= eps &&
    Math.abs(a.position.z - b.position.z) <= eps &&
    Math.abs(a.rotation.x - b.rotation.x) <= eps &&
    Math.abs(a.rotation.y - b.rotation.y) <= eps &&
    Math.abs(a.rotation.z - b.rotation.z) <= eps &&
    Math.abs(a.scale.x - b.scale.x) <= eps &&
    Math.abs(a.scale.y - b.scale.y) <= eps &&
    Math.abs(a.scale.z - b.scale.z) <= eps
  )
}

export function transformFromObject3D(obj: THREE.Object3D): ObjectTransform {
  return {
    position: { x: obj.position.x, y: obj.position.y, z: obj.position.z },
    rotation: { x: obj.rotation.x, y: obj.rotation.y, z: obj.rotation.z },
    scale: { x: obj.scale.x, y: obj.scale.y, z: obj.scale.z },
  }
}

export function computeCentroid(positions: Vec3[]): Vec3 {
  if (positions.length === 0) return { x: 0, y: 0, z: 0 }
  let x = 0
  let y = 0
  let z = 0
  for (const p of positions) {
    x += p.x
    y += p.y
    z += p.z
  }
  const n = positions.length
  return { x: x / n, y: y / n, z: z / n }
}

/** Fixed pivot for gizmo + transform — defaults to mesh centroid */
export function getObjectPivot(obj: SceneObject): Vec3 {
  return obj.pivot ? { ...obj.pivot } : computeCentroid(obj.positions)
}

function isIdentityTransform(tr: ObjectTransform): boolean {
  return (
    tr.position.x === 0 &&
    tr.position.y === 0 &&
    tr.position.z === 0 &&
    tr.rotation.x === 0 &&
    tr.rotation.y === 0 &&
    tr.rotation.z === 0 &&
    tr.scale.x === 1 &&
    tr.scale.y === 1 &&
    tr.scale.z === 1
  )
}

/**
 * Ensures every scene object has a stable pivot at its centroid and
 * transform.position at the world-space pivot (for gizmo + selection).
 */
export function prepareSceneObject(obj: SceneObject): SceneObject {
  const pivot = getObjectPivot(obj)
  const tr = ensureTransform(obj)

  if (obj.pivot) {
    return { ...obj, pivot: { ...obj.pivot }, transform: cloneTransform(tr) }
  }

  return {
    ...obj,
    pivot: { ...pivot },
    transform: {
      ...tr,
      position:
        isIdentityTransform(tr) && obj.positions.length > 0
          ? { ...pivot }
          : { ...tr.position },
    },
  }
}

const _v = new THREE.Vector3()
const _euler = new THREE.Euler()
const _scale = new THREE.Vector3()
const _invRot = new THREE.Matrix4()

/** World position of a mesh vertex stored in scene-object space */
export function worldPointFromObject(obj: SceneObject, meshPoint: Vec3): Vec3 {
  const pivot = getObjectPivot(obj)
  const tr = ensureTransform(obj)

  _v.set(
    meshPoint.x - pivot.x,
    meshPoint.y - pivot.y,
    meshPoint.z - pivot.z
  )
  _scale.set(tr.scale.x, tr.scale.y, tr.scale.z)
  _euler.set(tr.rotation.x, tr.rotation.y, tr.rotation.z)
  _v.multiply(_scale).applyEuler(_euler).add(
    new THREE.Vector3(tr.position.x, tr.position.y, tr.position.z)
  )

  return { x: _v.x, y: _v.y, z: _v.z }
}

/** Inverse of {@link worldPointFromObject} — world point → mesh-local position */
export function localPointFromWorld(obj: SceneObject, world: Vec3): Vec3 {
  const pivot = getObjectPivot(obj)
  const tr = ensureTransform(obj)

  _v.set(world.x, world.y, world.z)
  _v.sub(new THREE.Vector3(tr.position.x, tr.position.y, tr.position.z))
  _invRot.makeRotationFromEuler(
    new THREE.Euler(-tr.rotation.x, -tr.rotation.y, -tr.rotation.z, 'XYZ')
  )
  _v.applyMatrix4(_invRot)
  _v.x /= tr.scale.x || 1
  _v.y /= tr.scale.y || 1
  _v.z /= tr.scale.z || 1

  return { x: _v.x + pivot.x, y: _v.y + pivot.y, z: _v.z + pivot.z }
}

const _dir = new THREE.Vector3()

/** Convert a world-space displacement into object-local mesh space. */
export function worldDeltaToLocal(obj: SceneObject, delta: Vec3): Vec3 {
  const tr = ensureTransform(obj)
  _dir.set(delta.x, delta.y, delta.z)
  _invRot.makeRotationFromEuler(
    new THREE.Euler(-tr.rotation.x, -tr.rotation.y, -tr.rotation.z, 'XYZ')
  )
  _dir.applyMatrix4(_invRot)
  _dir.x /= tr.scale.x || 1
  _dir.y /= tr.scale.y || 1
  _dir.z /= tr.scale.z || 1
  return { x: _dir.x, y: _dir.y, z: _dir.z }
}

export function worldBounds(obj: SceneObject): { min: Vec3; max: Vec3 } {
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity

  for (const p of obj.positions) {
    const w = worldPointFromObject(obj, p)
    minX = Math.min(minX, w.x)
    maxX = Math.max(maxX, w.x)
    minY = Math.min(minY, w.y)
    maxY = Math.max(maxY, w.y)
    minZ = Math.min(minZ, w.z)
    maxZ = Math.max(maxZ, w.z)
  }

  return {
    min: { x: minX, y: minY, z: minZ },
    max: { x: maxX, y: maxY, z: maxZ },
  }
}

export function selectionWorldCenter(objects: SceneObject[], ids: string[]): Vec3 {
  const selected = objects.filter((o) => ids.includes(o.id))
  if (selected.length === 0) return { x: 0, y: 0, z: 0 }
  if (selected.length === 1) {
    const tr = ensureTransform(selected[0])
    return { ...tr.position }
  }

  let x = 0
  let y = 0
  let z = 0
  for (const obj of selected) {
    const tr = ensureTransform(obj)
    x += tr.position.x
    y += tr.position.y
    z += tr.position.z
  }
  const n = selected.length
  return { x: x / n, y: y / n, z: z / n }
}
