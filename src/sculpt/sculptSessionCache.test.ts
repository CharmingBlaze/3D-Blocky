import { describe, expect, it, afterEach } from 'vitest'
import { prepareSceneObject } from '../mesh/objectTransform'
import {
  clearSculptSession,
  getSculptSessionMesh,
  hasSculptSession,
} from './sculptSessionCache'

const box = prepareSceneObject({
  id: 'sculpt-box',
  name: 'Sculpt box',
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

afterEach(() => clearSculptSession())

describe('sculptSessionCache', () => {
  it('reuses the same HalfEdgeMesh across dabs', () => {
    const a = getSculptSessionMesh(box)
    const b = getSculptSessionMesh(box)
    expect(a).toBe(b)
    expect(hasSculptSession(box.id)).toBe(true)
  })

  it('keeps mutated positions for the next dab', () => {
    const mesh = getSculptSessionMesh(box)
    mesh.positions[0] = { x: 9, y: 9, z: 9 }
    const again = getSculptSessionMesh({
      ...box,
      positions: box.positions.map((p) => ({ ...p })),
    })
    expect(again).toBe(mesh)
    expect(again.positions[0]).toEqual({ x: 9, y: 9, z: 9 })
  })

  it('rebuilds after clear', () => {
    const a = getSculptSessionMesh(box)
    clearSculptSession(box.id)
    expect(hasSculptSession(box.id)).toBe(false)
    const b = getSculptSessionMesh(box)
    expect(b).not.toBe(a)
  })
})
