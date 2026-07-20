import { describe, expect, it } from 'vitest'
import { defaultMaterial } from '../material/materialTypes'
import type { SceneObject } from '../mesh/HalfEdgeMesh'
import { mirrorSceneObject } from './symmetry'

function makeTexturedObject(): SceneObject {
  return {
    id: 'src',
    name: 'Box',
    positions: [
      { x: 1, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 2, y: 1, z: 0 },
      { x: 1, y: 1, z: 0 },
    ],
    faces: [[0, 1, 2, 3]],
    faceColors: [0xff0000],
    uvs: [
      { u: 0, v: 0 },
      { u: 1, v: 0 },
      { u: 1, v: 1 },
      { u: 0, v: 1 },
    ],
    faceUvIndices: [[0, 1, 2, 3]],
    cornerColors: [
      [1, 0, 0, 1],
      [0, 1, 0, 1],
      [0, 0, 1, 1],
      [1, 1, 0, 1],
    ],
    faceColorIndices: [[0, 1, 2, 3]],
    material: {
      ...defaultMaterial(0xff0000),
      mode: 'texture',
      textureId: 'tex-1',
      textureRepeat: [2, 2],
    },
    faceMaterials: [null],
    topologyLocked: false,
    polyBudget: 64,
    polyBudgetMode: 'strict',
    smoothShading: true,
    facetExaggeration: 0,
    color: 0xff0000,
    pivot: { x: 1.5, y: 0.5, z: 0 },
    transform: {
      position: { x: 1.5, y: 0.5, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    sketchSource: {
      relative: [
        { x: -1, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
      ],
      center: { x: 4, y: 2 },
      view: 'front',
      brushDensity: 8,
      polyBudget: 64,
      closeThreshold: 8,
      defaultDepth: 0,
      isClosed: false,
      kind: 'outline',
      extrudeDepth: 12,
    },
    primitiveSource: {
      type: 'box',
      box: {
        min: { x: 1, y: 0, z: -1 },
        max: { x: 2, y: 1, z: 1 },
      },
      heightAxis: 1,
      polyBudget: 64,
    },
  }
}

describe('mirrorSceneObject', () => {
  it('copies materials, corner data, and mirrored procedural sources', () => {
    const src = makeTexturedObject()
    const mirrored = mirrorSceneObject(src, 'x', 0)

    expect(mirrored.id).not.toBe(src.id)
    expect(mirrored.material?.textureId).toBe('tex-1')
    expect(mirrored.material?.textureRepeat).toEqual([2, 2])
    expect(mirrored.material).not.toBe(src.material)
    expect(mirrored.faceUvIndices?.[0]).toEqual([3, 2, 1, 0])
    expect(mirrored.faceColorIndices?.[0]).toEqual([3, 2, 1, 0])
    expect(mirrored.cornerColors).toHaveLength(4)
    expect(mirrored.faces[0]).toEqual([3, 2, 1, 0])
    expect(mirrored.positions[0]?.x).toBeCloseTo(-1)
    expect(mirrored.sketchSource).toBeDefined()
    expect(mirrored.sketchSource?.center.x).toBeCloseTo(-4)
    expect(mirrored.sketchSource?.extrudeDepth).toBe(12)
    expect(mirrored.primitiveSource?.box.min.x).toBeCloseTo(-2)
    expect(mirrored.primitiveSource?.box.max.x).toBeCloseTo(-1)
    expect(mirrored.smoothShading).toBe(true)
  })
})
