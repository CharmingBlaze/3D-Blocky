import { describe, expect, it, afterEach } from 'vitest'
import {
  clearObjectIndex,
  getObjectIndex,
  objectIndexSizeForTests,
  rebuildObjectIndex,
} from './objectIndex'
import type { SceneObject } from '../mesh/HalfEdgeMesh'

function stub(id: string): SceneObject {
  return {
    id,
    name: id,
    positions: [],
    faces: [],
    faceColors: [],
    topologyLocked: false,
    polyBudget: 32,
    polyBudgetMode: 'adaptive',
    smoothShading: false,
    facetExaggeration: 0,
    color: 0xffffff,
  }
}

afterEach(() => clearObjectIndex())

describe('objectIndex', () => {
  it('maps ids to array positions', () => {
    rebuildObjectIndex([stub('a'), stub('b'), stub('c')])
    expect(getObjectIndex('a')).toBe(0)
    expect(getObjectIndex('b')).toBe(1)
    expect(getObjectIndex('c')).toBe(2)
    expect(objectIndexSizeForTests()).toBe(3)
  })

  it('rebuilds after removal', () => {
    rebuildObjectIndex([stub('a'), stub('b'), stub('c')])
    rebuildObjectIndex([stub('a'), stub('c')])
    expect(getObjectIndex('b')).toBeUndefined()
    expect(getObjectIndex('c')).toBe(1)
  })
})
