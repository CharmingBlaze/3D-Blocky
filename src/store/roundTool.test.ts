import { afterEach, describe, expect, it } from 'vitest'
import type { SceneObject } from '../mesh/HalfEdgeMesh'
import { emptySceneSnapshot, resetSceneHistory, snapshotFromState } from './historySlice'
import { useAppStore } from './appStore'

function makeObject(): SceneObject {
  return {
    id: 'round-object',
    name: 'Round object',
    positions: [
      { x: -3, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 2, z: 0 },
      { x: 0, y: 0, z: 5 },
    ],
    faces: [[0, 1, 2, 3]],
    faceColors: [0xffffff],
    topologyLocked: false,
    polyBudget: 128,
    polyBudgetMode: 'adaptive',
    smoothShading: false,
    facetExaggeration: 0,
    color: 0xffffff,
  }
}

function selectObjectForRound() {
  const object = makeObject()
  resetSceneHistory(emptySceneSnapshot())
  useAppStore.setState({
    objects: [object],
    selectedObjectId: object.id,
    selectionObjectIds: [object.id],
    selectionMode: 'object',
    meshSelection: null,
    meshModal: null,
    activeTool: 'round',
  })
  resetSceneHistory(snapshotFromState(useAppStore.getState()))
  return object
}

afterEach(() => {
  resetSceneHistory(emptySceneSnapshot())
  useAppStore.setState({
    objects: [],
    selectedObjectId: null,
    selectionObjectIds: [],
    meshSelection: null,
    meshModal: null,
    activeTool: 'draw',
  })
})

describe('Rounded modal history', () => {
  it('uses every vertex when an object selection starts Rounded', () => {
    selectObjectForRound()
    const state = useAppStore.getState()
    state.beginMeshModal('round', 0, 0, 'front')

    expect(useAppStore.getState().meshModal?.selection.vertices).toEqual([0, 1, 2, 3])
    state.updateMeshModalFromPointer(100, 0)
    expect(useAppStore.getState().objects[0]!.positions).not.toEqual(makeObject().positions)
  })

  it('restores the untouched mesh on cancel', () => {
    const original = selectObjectForRound()
    const state = useAppStore.getState()
    state.beginMeshModal('round', 0, 0, 'front')
    state.updateMeshModalFromPointer(100, 0)
    state.cancelMeshModal()

    expect(useAppStore.getState().objects[0]!.positions).toEqual(original.positions)
    expect(useAppStore.getState().meshModal).toBeNull()
  })

  it('commits one undoable Rounded edit', () => {
    const original = selectObjectForRound()
    const state = useAppStore.getState()
    state.beginMeshModal('round', 0, 0, 'front')
    state.updateMeshModalFromPointer(100, 0)
    state.confirmMeshModal()
    const rounded = useAppStore.getState().objects[0]!.positions

    expect(rounded).not.toEqual(original.positions)
    useAppStore.getState().undo()
    expect(useAppStore.getState().objects[0]!.positions).toEqual(original.positions)
  })
})
