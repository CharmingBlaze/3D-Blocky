import { describe, expect, it } from 'vitest'
import { HalfEdgeMesh } from './HalfEdgeMesh'
import { buildTopologyVertexNormals } from './meshNormals'
import { prepareSceneObject } from './objectTransform'

function unitBoxMesh() {
  const obj = prepareSceneObject({
    id: 'n-box',
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
    smoothShading: true,
    facetExaggeration: 0,
  })
  return HalfEdgeMesh.fromObject(obj)
}

describe('buildTopologyVertexNormals', () => {
  it('matches per-vertex getVertexNormal for a box', () => {
    const mesh = unitBoxMesh()
    const batch = buildTopologyVertexNormals(mesh)
    for (let vi = 0; vi < mesh.positions.length; vi++) {
      const single = mesh.getVertexNormal(vi, true)
      expect(batch[vi]!.x).toBeCloseTo(single.x, 5)
      expect(batch[vi]!.y).toBeCloseTo(single.y, 5)
      expect(batch[vi]!.z).toBeCloseTo(single.z, 5)
    }
  })

  it('produces diagonal corner normals on a cube', () => {
    const mesh = unitBoxMesh()
    const n = buildTopologyVertexNormals(mesh)[0]!
    expect(Math.abs(n.x)).toBeGreaterThan(0.3)
    expect(Math.abs(n.y)).toBeGreaterThan(0.3)
    expect(Math.abs(n.z)).toBeGreaterThan(0.3)
  })
})
