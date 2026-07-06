import { describe, expect, it } from 'vitest'
import { primitiveBoxToSceneObject } from '../primitives/primitiveBoxCommit'
import { heightAxisForView } from '../primitives/viewAxes'
import { ensureObjectUVs, collectUvIndicesForFaces } from './uvObject'
import { uvBoundsFromIndices } from './uvEditing'
import { unwrapSelectedFaces } from './uvUnwrap'

const TEST_BOX = { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } }

function makeCube() {
  return ensureObjectUVs(
    primitiveBoxToSceneObject('box', TEST_BOX, heightAxisForView('front'), 'test-cube')
  )
}

describe('unwrapSelectedFaces', () => {
  it('unwraps only selected faces for auto without repacking the whole mesh', () => {
    const cube = makeCube()
    const untouchedBefore = collectUvIndicesForFaces(cube, [0, 1, 2, 3, 4])
    const untouchedCoords = untouchedBefore.map((ui) => ({ ...cube.uvs[ui]! }))

    const { uvs, faceUvIndices } = unwrapSelectedFaces(cube, [5], 'auto', { repackAll: true })

    for (let i = 0; i < untouchedBefore.length; i++) {
      const ui = untouchedBefore[i]!
      const before = untouchedCoords[i]!
      const after = uvs[ui]!
      expect(after.u).toBeCloseTo(before.u, 5)
      expect(after.v).toBeCloseTo(before.v, 5)
    }

    const selectedUi = collectUvIndicesForFaces({ ...cube, uvs, faceUvIndices }, [5])
    const selectedBounds = uvBoundsFromIndices(uvs, selectedUi)
    expect(selectedBounds.maxU - selectedBounds.minU).toBeGreaterThan(0.01)
    expect(selectedBounds.maxV - selectedBounds.minV).toBeGreaterThan(0.01)
  })

  it('supports smart UV on a partial ring selection', () => {
    const cube = makeCube()
    const { uvs, faceUvIndices } = unwrapSelectedFaces(cube, [0, 1], 'smart', {
      angleLimitDeg: 66,
      repackAll: true,
    })
    const selectedUi = collectUvIndicesForFaces({ ...cube, uvs, faceUvIndices }, [0, 1])
    expect(selectedUi.length).toBeGreaterThan(0)
    const bounds = uvBoundsFromIndices(uvs, selectedUi)
    expect(bounds.maxU).toBeLessThanOrEqual(1.05)
    expect(bounds.maxV).toBeLessThanOrEqual(1.05)
  })

  it('still repacks the entire mesh when all faces are selected', () => {
    const cube = makeCube()
    const allFaces = cube.faces.map((_, i) => i)
    const { uvs, faceUvIndices, uvAutoPacked } = unwrapSelectedFaces(cube, allFaces, 'auto', {
      repackAll: true,
      markPacked: true,
    })
    expect(uvAutoPacked).toBe(true)
    const allUi = collectUvIndicesForFaces({ ...cube, uvs, faceUvIndices }, allFaces)
    const bounds = uvBoundsFromIndices(uvs, allUi)
    expect(bounds.minU).toBeGreaterThanOrEqual(-0.02)
    expect(bounds.maxU).toBeLessThanOrEqual(1.02)
  })
})
