import { describe, expect, it } from 'vitest'
import { primitiveBoxToSceneObject } from '../primitives/primitiveBoxCommit'
import { heightAxisForView } from '../primitives/viewAxes'
import { prepareSceneObject } from './objectTransform'
import { knifeCutObject } from './meshKnife'

function makeBox() {
  return prepareSceneObject(
    primitiveBoxToSceneObject(
      'box',
      { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } },
      heightAxisForView('front'),
      0xffffff,
      64
    )!
  )
}

describe('meshKnife', () => {
  it('cuts a box along a view-aligned plane without exploding vertex count', () => {
    const obj = makeBox()
    const beforeFaces = obj.faces.length

    const cut = knifeCutObject(
      obj,
      { x: -2, y: 0, z: -2 },
      { x: 2, y: 0, z: 2 },
      { x: 0, y: 0, z: -1 }
    )

    expect(cut.faces.length).toBeGreaterThan(beforeFaces)
    expect(cut.positions.length).toBeGreaterThan(8)
    expect(cut.positions.length).toBeLessThan(64)
    for (const p of cut.positions) {
      expect(Number.isFinite(p.x)).toBe(true)
      expect(Math.abs(p.x)).toBeLessThanOrEqual(2.01)
      expect(Math.abs(p.y)).toBeLessThanOrEqual(2.01)
      expect(Math.abs(p.z)).toBeLessThanOrEqual(2.01)
    }
  })

  it('returns unchanged mesh when cut line is too short', () => {
    const obj = makeBox()
    const same = knifeCutObject(obj, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 })
    expect(same.positions.length).toBe(obj.positions.length)
    expect(same.faces.length).toBe(obj.faces.length)
  })
})
