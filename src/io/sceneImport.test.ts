import { describe, expect, it } from 'vitest'
import type { SceneObject } from '../mesh/HalfEdgeMesh'
import {
  importSceneFromFile,
  MAX_SCENE_IMPORT_BYTES,
  validateImportedSceneObjects,
} from './sceneImport'

function triangle(): SceneObject {
  return {
    id: 'triangle',
    name: 'Triangle',
    positions: [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
    ],
    faces: [[0, 1, 2]],
    faceColors: [0xffffff],
    topologyLocked: false,
    polyBudget: 128,
    polyBudgetMode: 'adaptive',
    smoothShading: false,
    facetExaggeration: 0,
    color: 0xffffff,
  }
}

describe('scene import validation', () => {
  it('rejects non-finite loader output', () => {
    const object = triangle()
    object.positions[1]!.x = Number.NaN
    expect(() => validateImportedSceneObjects([object])).toThrow(
      'is not a finite 3D point'
    )
  })

  it('rejects oversized files before invoking a format loader', async () => {
    const file = new File([], 'large.obj')
    Object.defineProperty(file, 'size', { value: MAX_SCENE_IMPORT_BYTES + 1 })
    await expect(importSceneFromFile(file)).rejects.toThrow('Import file is too large')
  })
})
