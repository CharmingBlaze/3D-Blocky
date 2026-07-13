import { describe, expect, it } from 'vitest'
import { heightAxisForView } from './viewAxes'
import { boxCenterSize, type WorldBox } from './primitiveBoxMath'
import { primitiveBoxToSceneObject, regeneratePrimitiveObject } from './primitiveBoxCommit'

const BOX: WorldBox = {
  min: { x: -2, y: -3, z: -4 },
  max: { x: 2, y: 3, z: 4 },
}

describe('retained primitive source', () => {
  it('stores creation parameters on a new CAD primitive', () => {
    const object = primitiveBoxToSceneObject(
      'cylinder',
      BOX,
      heightAxisForView('front'),
      0x6ecbf5,
      96
    )!
    expect(object.primitiveSource?.type).toBe('cylinder')
    expect(object.primitiveSource?.polyBudget).toBe(96)
    expect(boxCenterSize(object.primitiveSource!.box).size).toEqual({ x: 4, y: 6, z: 8 })
  })

  it('regenerates dimensions while preserving scene identity', () => {
    const object = primitiveBoxToSceneObject(
      'sphere',
      BOX,
      heightAxisForView('front'),
      0x6ecbf5,
      64
    )!
    const updated = regeneratePrimitiveObject(object, {
      size: { x: 12, z: 5 },
      polyBudget: 128,
    })!
    expect(updated.id).toBe(object.id)
    expect(boxCenterSize(updated.primitiveSource!.box).size).toEqual({ x: 12, y: 6, z: 5 })
    expect(updated.primitiveSource?.polyBudget).toBe(128)
  })
})
