import { describe, expect, it } from 'vitest'
import { applyActiveHairTexture, inheritTextureMaterial } from '../material/materialEditorSlice'
import { strokeToMesh } from './strokeToMesh'
import { defaultMaterial } from '../material/materialTypes'
import type { SceneObject } from '../mesh/HalfEdgeMesh'

const wavy = Array.from({ length: 40 }, (_, i) => ({
  x: i * 4,
  y: Math.sin(i * 0.35) * 18,
}))

const base = {
  points: wavy,
  view: 'front' as const,
  polyBudget: 128,
  brushDensity: 12,
  rdpTolerance: 2,
  closeThreshold: 12,
  defaultDepth: 0,
  color: 0xaa6633,
  extrudeAmount: 16,
}

function texturedSource(textureId: string): SceneObject {
  return {
    id: 'src',
    name: 'Tex Source',
    positions: [],
    faces: [],
    color: 0xffffff,
    material: {
      mode: 'texture',
      textureId,
      opacity: 1,
      doubleSided: false,
    },
  } as unknown as SceneObject
}

describe('hair texture assignment', () => {
  it('with hair texture → textured material on Hair Paths', () => {
    const obj = strokeToMesh({ ...base, strokeMode: 'hair-paths' })!
    const textured = applyActiveHairTexture(obj, 'tex-hair-1')
    expect(textured.material?.mode).toBe('texture')
    expect(textured.material?.textureId).toBe('tex-hair-1')
  })

  it('with hair texture → textured material on Hair Strips and Rounded Hair', () => {
    for (const mode of ['hair-strips', 'hair-round'] as const) {
      const obj = strokeToMesh({ ...base, strokeMode: mode })!
      const textured = applyActiveHairTexture(obj, 'tex-shared')
      expect(textured.material?.mode).toBe('texture')
      expect(textured.material?.textureId).toBe('tex-shared')
    }
  })

  it('without hair texture → leaves color path untouched', () => {
    const obj = strokeToMesh({ ...base, strokeMode: 'hair-paths' })!
    const before = obj.material ?? defaultMaterial(obj.color)
    const after = applyActiveHairTexture(obj, null)
    expect(after).toBe(obj)
    expect(after.material?.mode ?? before.mode).not.toBe('texture')
    expect(after.color).toBe(0xaa6633)
  })

  it('undefined hair texture id does not switch to texture mode', () => {
    const obj = strokeToMesh({ ...base, strokeMode: 'hair-round' })!
    const after = applyActiveHairTexture(obj, undefined)
    expect(after).toBe(obj)
    expect(after.material?.mode).not.toBe('texture')
  })

  it('legacy inheritTextureMaterial still copies from a textured selection', () => {
    const obj = strokeToMesh({ ...base, strokeMode: 'hair-strips' })!
    const inherited = inheritTextureMaterial(obj, texturedSource('from-selection'))
    expect(inherited.material?.mode).toBe('texture')
    expect(inherited.material?.textureId).toBe('from-selection')
  })
})
