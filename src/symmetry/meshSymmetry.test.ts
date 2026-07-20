import { describe, expect, it } from 'vitest'
import type { SceneObject } from '../mesh/HalfEdgeMesh'
import { applyMeshModalOpWithSymmetry } from '../mesh/meshOps'
import {
  buildVertexMirrorMap,
  expandMeshSelectionWithSymmetry,
  propagateSymmetricVertexPositions,
} from './meshSymmetry'

function symmetricBox(): SceneObject {
  // Unit box centered on origin — X symmetry pairs left/right faces.
  return {
    id: 'box',
    name: 'Box',
    positions: [
      { x: -1, y: -1, z: -1 }, // 0
      { x: 1, y: -1, z: -1 }, // 1
      { x: 1, y: 1, z: -1 }, // 2
      { x: -1, y: 1, z: -1 }, // 3
      { x: -1, y: -1, z: 1 }, // 4
      { x: 1, y: -1, z: 1 }, // 5
      { x: 1, y: 1, z: 1 }, // 6
      { x: -1, y: 1, z: 1 }, // 7
    ],
    faces: [
      [0, 1, 2, 3], // back
      [4, 5, 6, 7], // front
      [0, 4, 7, 3], // left (-X)
      [1, 5, 6, 2], // right (+X)
      [3, 2, 6, 7], // top
      [0, 1, 5, 4], // bottom
    ],
    faceColors: [0xffffff, 0xffffff, 0xffffff, 0xffffff, 0xffffff, 0xffffff],
    topologyLocked: false,
    polyBudget: 64,
    polyBudgetMode: 'strict',
    smoothShading: false,
    facetExaggeration: 0,
    color: 0xffffff,
    pivot: { x: 0, y: 0, z: 0 },
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
  }
}

describe('meshSymmetry', () => {
  it('maps left/right vertices across the X plane', () => {
    const box = symmetricBox()
    const map = buildVertexMirrorMap(box, 'x', 0)
    expect(map.get(0)).toBe(1)
    expect(map.get(3)).toBe(2)
    expect(map.get(4)).toBe(5)
    expect(map.get(7)).toBe(6)
  })

  it('expands a left-face selection to the right face', () => {
    const box = symmetricBox()
    const expanded = expandMeshSelectionWithSymmetry(
      box,
      { objectId: 'box', vertices: [], edges: [], faces: [2] },
      'x',
      0
    )
    expect(expanded.faces.sort()).toEqual([2, 3])
  })

  it('propagates a move on +X verts to mirrored -X verts', () => {
    const box = symmetricBox()
    const selected = new Set([1, 2, 5, 6])
    const moved = box.positions.map((p, i) =>
      selected.has(i) ? { x: p.x + 0.5, y: p.y, z: p.z } : { ...p }
    )
    const result = propagateSymmetricVertexPositions(box, selected, moved, 'x', 0)
    expect(result[0]!.x).toBeCloseTo(-1.5)
    expect(result[1]!.x).toBeCloseTo(1.5)
    expect(result[3]!.x).toBeCloseTo(-1.5)
    expect(result[2]!.x).toBeCloseTo(1.5)
  })

  it('extrudes both sides when symmetry is enabled', () => {
    const box = symmetricBox()
    const oneSide = applyMeshModalOpWithSymmetry(
      box,
      { objectId: 'box', vertices: [], edges: [], faces: [3] },
      'face',
      'extrude',
      0.5,
      { x: 1, y: 0, z: 0 },
      0,
      0,
      null,
      'perspective',
      1,
      { enabled: false, axis: 'x', plane: 0 }
    )
    const bothSides = applyMeshModalOpWithSymmetry(
      box,
      { objectId: 'box', vertices: [], edges: [], faces: [3] },
      'face',
      'extrude',
      0.5,
      { x: 1, y: 0, z: 0 },
      0,
      0,
      null,
      'perspective',
      1,
      { enabled: true, axis: 'x', plane: 0 }
    )
    expect(bothSides.faces.length).toBeGreaterThan(oneSide.faces.length)
    expect(bothSides.positions.length).toBeGreaterThan(oneSide.positions.length)
  })
})
