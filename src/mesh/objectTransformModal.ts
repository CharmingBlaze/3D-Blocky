import type { ObjectTransform } from './HalfEdgeMesh'
import type { Vec3 } from '../utils/math'
import { cloneTransform } from './objectTransform'
import * as THREE from 'three'

export type ObjectTransformModalOp = 'rotate' | 'scale' | 'move'

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
  pivotWorld: Vec3,
  deltaWorldX: number = 0,
  deltaWorldY: number = 0,
  axisLock?: 'x' | 'y' | 'z' | null,
  view: string = 'perspective'
): ObjectTransform {
  if (op === 'move') {
    let dx = 0, dy = 0, dz = 0
    if (axisLock === 'x') {
      dx = deltaWorldX + deltaWorldY
    } else if (axisLock === 'y') {
      dy = deltaWorldX + deltaWorldY
    } else if (axisLock === 'z') {
      dz = deltaWorldX + deltaWorldY
    } else {
      // Smart view defaults
      if (view === 'front') {
        dx = deltaWorldX
        dy = deltaWorldY
      } else if (view === 'top') {
        dx = deltaWorldX
        dz = deltaWorldY
      } else if (view === 'right') {
        dz = deltaWorldX
        dy = deltaWorldY
      } else {
        dx = deltaWorldX
        dy = deltaWorldY
      }
    }
    return {
      position: { x: base.position.x + dx, y: base.position.y + dy, z: base.position.z + dz },
      rotation: { ...base.rotation },
      scale: { ...base.scale }
    }
  }

  if (op === 'rotate') {
    if (Math.abs(value) < 1e-8) return cloneTransform(base)

    _pos.set(base.position.x, base.position.y, base.position.z)
    _pivot.set(pivotWorld.x, pivotWorld.y, pivotWorld.z)
    
    let ax = _axisY
    if (axisLock === 'x') ax = new THREE.Vector3(1, 0, 0)
    else if (axisLock === 'y') ax = new THREE.Vector3(0, 1, 0)
    else if (axisLock === 'z') ax = new THREE.Vector3(0, 0, 1)
    else {
      // Smart view defaults
      if (view === 'front') ax = new THREE.Vector3(0, 0, 1)
      else if (view === 'right') ax = new THREE.Vector3(1, 0, 0)
      else if (view === 'top') ax = new THREE.Vector3(0, 1, 0)
    }

    _q.setFromAxisAngle(ax, value)
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

  let scaleX = factor
  let scaleY = factor
  let scaleZ = factor

  if (axisLock) {
    scaleX = axisLock === 'y' || axisLock === 'z' ? 1 : factor
    scaleY = axisLock === 'x' || axisLock === 'z' ? 1 : factor
    scaleZ = axisLock === 'x' || axisLock === 'y' ? 1 : factor
  } else {
    // Smart view defaults
    if (view === 'front') scaleZ = 1
    else if (view === 'top') scaleY = 1
    else if (view === 'right') scaleX = 1
  }

  return {
    position: { x: _pos.x, y: _pos.y, z: _pos.z },
    rotation: { ...base.rotation },
    scale: {
      x: base.scale.x * scaleX,
      y: base.scale.y * scaleY,
      z: base.scale.z * scaleZ,
    },
  }
}

export function formatObjectTransformModalValue(op: ObjectTransformModalOp, value: number): string {
  if (op === 'rotate') {
    return `${((value * 180) / Math.PI).toFixed(1)}°`
  }
  return value.toFixed(3)
}
