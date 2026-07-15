import { describe, expect, it } from 'vitest'
import { primitiveBoxToSceneObject } from '../primitives/primitiveBoxCommit'
import { heightAxisForView } from '../primitives/viewAxes'
import { preparePixelPaintUvLayout } from './pixelPaintUv'

function makeSphere() {
  return primitiveBoxToSceneObject(
    'icosphere',
    { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } },
    heightAxisForView('front'),
    0x8899aa,
    48
  )!
}

describe('Pixel Editor UV layout', () => {
  it('gives every face unique paintable UV corners inside the canvas', () => {
    const sphere = preparePixelPaintUvLayout(makeSphere())
    const used = new Set<number>()
    for (let fi = 0; fi < sphere.faces.length; fi++) {
      const indices = sphere.faceUvIndices![fi]!
      expect(indices).toHaveLength(sphere.faces[fi]!.length)
      for (const ui of indices) {
        expect(used.has(ui)).toBe(false)
        used.add(ui)
        const uv = sphere.uvs![ui]!
        expect(uv.u).toBeGreaterThanOrEqual(0)
        expect(uv.u).toBeLessThanOrEqual(1)
        expect(uv.v).toBeGreaterThanOrEqual(0)
        expect(uv.v).toBeLessThanOrEqual(1)
      }
    }
  })

  it('is deterministic when rebuilt', () => {
    const source = makeSphere()
    const first = preparePixelPaintUvLayout(source)
    const second = preparePixelPaintUvLayout(first)
    expect(second.uvs).toEqual(first.uvs)
    expect(second.faceUvIndices).toEqual(first.faceUvIndices)
  })
})
