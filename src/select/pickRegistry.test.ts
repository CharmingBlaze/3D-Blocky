import { afterEach, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  clearPickRegistryForTests,
  getPickTarget,
  getPickTargets,
  registerPickTarget,
  unregisterPickTarget,
} from './pickRegistry'

afterEach(() => {
  clearPickRegistryForTests()
})

describe('viewport-scoped pick registry', () => {
  it('keeps pick targets isolated per slot', () => {
    const a = new THREE.Object3D()
    const b = new THREE.Object3D()
    registerPickTarget(0, 'obj-1', a)
    registerPickTarget(1, 'obj-1', b)

    expect(getPickTargets(0)).toEqual([a])
    expect(getPickTargets(1)).toEqual([b])
    expect(getPickTarget(0, 'obj-1')).toBe(a)
    expect(getPickTarget(1, 'obj-1')).toBe(b)
    expect(a.userData.sceneObjectId).toBe('obj-1')
  })

  it('unregister only affects the given slot', () => {
    const a = new THREE.Object3D()
    const b = new THREE.Object3D()
    registerPickTarget(0, 'obj-1', a)
    registerPickTarget(2, 'obj-1', b)
    unregisterPickTarget(0, 'obj-1')

    expect(getPickTargets(0)).toEqual([])
    expect(getPickTargets(2)).toEqual([b])
  })
})
