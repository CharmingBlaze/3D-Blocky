import { describe, expect, it, afterEach } from 'vitest'
import { prepareSceneObject } from './objectTransform'
import {
  clearFaceTriangulationCacheForTests,
  getObjectFaceTriangulation,
  triangulateFaceLoop,
} from './faceTriangulation'
import { HalfEdgeMesh } from './HalfEdgeMesh'

afterEach(() => {
  // no persistent refs required
})

describe('faceTriangulation', () => {
  it('returns identity for triangles', () => {
    expect(
      triangulateFaceLoop([
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 },
      ])
    ).toEqual([[0, 1, 2]])
  })

  it('fans convex quads as two triangles', () => {
    expect(
      triangulateFaceLoop([
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 0, y: 1, z: 0 },
      ])
    ).toEqual([
      [0, 1, 2],
      [0, 2, 3],
    ])
  })

  it('triangulates a concave quad without spanning outside', () => {
    // Arrowhead concave quad in XY
    const pts = [
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 1, y: 0.2, z: 0 },
      { x: 2, y: 1, z: 0 },
    ]
    const tris = triangulateFaceLoop(pts)
    expect(tris.length).toBeGreaterThanOrEqual(2)
    for (const [a, b, c] of tris) {
      expect(new Set([a, b, c]).size).toBe(3)
      expect(a).toBeGreaterThanOrEqual(0)
      expect(a).toBeLessThan(4)
    }
  })

  it('caches per SceneObject and matches toMeshData corner count', () => {
    const obj = prepareSceneObject({
      id: 'tri-box',
      name: 'Box',
      positions: [
        { x: -1, y: -1, z: -1 },
        { x: 1, y: -1, z: -1 },
        { x: 1, y: 1, z: -1 },
        { x: -1, y: 1, z: -1 },
        { x: -1, y: -1, z: 1 },
        { x: 1, y: -1, z: 1 },
        { x: 1, y: 1, z: 1 },
        { x: -1, y: 1, z: 1 },
      ],
      faces: [
        [0, 1, 2, 3],
        [5, 4, 7, 6],
        [4, 0, 3, 7],
        [1, 5, 6, 2],
        [3, 2, 6, 7],
        [4, 5, 1, 0],
      ],
      faceColors: [0xffffff, 0xffffff, 0xffffff, 0xffffff, 0xffffff, 0xffffff],
      color: 0xffffff,
      topologyLocked: false,
      polyBudget: 32,
      polyBudgetMode: 'adaptive',
      smoothShading: false,
      facetExaggeration: 0,
    })
    const a = getObjectFaceTriangulation(obj)
    const b = getObjectFaceTriangulation(obj)
    expect(a).toBe(b)
    expect(a.every((tris) => tris.length === 2)).toBe(true)

    const mesh = HalfEdgeMesh.fromObject(obj)
    const data = mesh.toMeshData(true, 0)
    expect(data.indices.length / 3).toBe(12)

    clearFaceTriangulationCacheForTests([obj])
  })
})
