import { describe, expect, it } from 'vitest'
import { primitiveBoxToSceneObject } from '../primitives/primitiveBoxCommit'
import { heightAxisForView } from '../primitives/viewAxes'
import { prepareSceneObject } from './objectTransform'
import {
  subdivideSurfaceLevels,
  weldSceneObjectCoincidentVertices,
} from './subdivisionSurface'

describe('subdivisionSurface', () => {
  it('welds UV-seam box corners before SubD', () => {
    const obj = prepareSceneObject(
      primitiveBoxToSceneObject(
        'box',
        { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } },
        heightAxisForView('front'),
        0xffffff,
        64
      )!
    )
    expect(obj.positions.length).toBeGreaterThan(8)

    const welded = weldSceneObjectCoincidentVertices(obj)
    expect(welded.positions.length).toBe(8)
    expect(welded.faces.length).toBeGreaterThan(0)
  })

  it('SubD level 1 on a box stays compact (no exploded spikes)', () => {
    const obj = prepareSceneObject(
      primitiveBoxToSceneObject(
        'box',
        { min: { x: -2, y: -2, z: -2 }, max: { x: 2, y: 2, z: 2 } },
        heightAxisForView('front'),
        0xffffff,
        64
      )!
    )

    const subd = subdivideSurfaceLevels(obj, 1)
    expect(subd.positions.length).toBeLessThan(200)
    expect(subd.faces.length).toBeLessThan(400)

    let minX = Infinity
    let maxX = -Infinity
    for (const p of subd.positions) {
      minX = Math.min(minX, p.x)
      maxX = Math.max(maxX, p.x)
      expect(Number.isFinite(p.x)).toBe(true)
      expect(Number.isFinite(p.y)).toBe(true)
      expect(Number.isFinite(p.z)).toBe(true)
    }
    expect(maxX - minX).toBeLessThan(8)
    expect(maxX - minX).toBeGreaterThan(3)
  })
})
