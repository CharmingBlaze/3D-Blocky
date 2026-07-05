import type { ObjectTransform } from './HalfEdgeMesh'
import type { Vec3 } from '../utils/math'
import { cloneTransform } from './objectTransform'
import * as THREE from 'three'

export type ObjectTransformModalOp = 'rotate' | 'scale'

const _pos = new THREE.Vector3()
const _pivot = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _euler = new THREE.Euler()
const _axisY = new THREE.Vector3(0, 1, 0)

/** Apply modal rotate/scale to an object transform around a shared world pivot. */
export function applyObjectTransformModal(
  base: ObjectTransform,
  op: ObjectTransformModalOp,
  value: number,
  pivotWorld: Vec3
): ObjectTransform {
  if (op === 'rotate') {
    if (Math.abs(value) < 1e-8) return cloneTransform(base)

    _pos.set(base.position.x, base.position.y, base.position.z)
    _pivot.set(pivotWorld.x, pivotWorld.y, pivotWorld.z)
    _q.setFromAxisAngle(_axisY, value)
    _pos.sub(_pivot).applyQuaternion(_q).add(_pivot)

    _euler.set(base.rotation.x, base.rotation.y, base.rotation.z, 'XYZ')
    const objQuat = new THREE.Quaternion().setFromEuler(_euler)
    objQuat.premultiply(_q)
    const out = new THREE.Euler().setFromQuaternion(objQuat, 'XYZ')

    return {
      position: { x: _pos.x, y: _pos.y, z: _pos.z },
      rotation: { x: out.x, y: out.y, z: out.z },
      scale: { ...base.scale },
    }
  }

  const factor = Math.max(value, 0.001)
  if (Math.abs(factor - 1) < 1e-8) return cloneTransform(base)

  _pos.set(base.position.x, base.position.y, base.position.z)
  _pivot.set(pivotWorld.x, pivotWorld.y, pivotWorld.z)
  _pos.sub(_pivot).multiplyScalar(factor).add(_pivot)

  return {
    position: { x: _pos.x, y: _pos.y, z: _pos.z },
    rotation: { ...base.rotation },
    scale: {
      x: base.scale.x * factor,
      y: base.scale.y * factor,
      z: base.scale.z * factor,
    },
  }
}

export function formatObjectTransformModalValue(op: ObjectTransformModalOp, value: number): string {
  if (op === 'rotate') {
    return `${((value * 180) / Math.PI).toFixed(1)}°`
  }
  return value.toFixed(3)
}
