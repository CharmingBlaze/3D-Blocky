import { afterEach, describe, expect, it } from 'vitest'
import { primitiveBoxToSceneObject } from '../primitives/primitiveBoxCommit'
import { heightAxisForView } from '../primitives/viewAxes'
import { clearSculptSession } from '../sculpt/sculptSessionCache'
import {
  emptySceneSnapshot,
  resetSceneHistory,
  snapshotFromState,
} from './historySlice'
import { useAppStore } from './appStore'

afterEach(() => {
  clearSculptSession()
  resetSceneHistory(emptySceneSnapshot())
  useAppStore.setState({
    objects: [],
    selectedObjectId: null,
    selectionObjectIds: [],
    meshSelection: null,
    canUndo: false,
    canRedo: false,
  })
})

describe('sculpt stroke history', () => {
  it('replaces the first-dab history head so redo restores the complete stroke', () => {
    const object = primitiveBoxToSceneObject(
      'box',
      { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } },
      heightAxisForView('front'),
      0x6ecbf5,
      128
    )
    expect(object).not.toBeNull()

    useAppStore.setState({
      objects: [object!],
      selectedObjectId: object!.id,
      selectionObjectIds: [object!.id],
      meshSelection: null,
      brushRadius: 1.5,
      brushStrength: 0.5,
    })
    resetSceneHistory(snapshotFromState(useAppStore.getState()))
    const initialPositions = object!.positions.map((position) => ({ ...position }))

    useAppStore.getState().applySculptAt({ x: 1, y: 1, z: 1 }, 'inflate', {
      saveHistory: true,
    })
    useAppStore.getState().applySculptAt({ x: -1, y: -1, z: -1 }, 'inflate', {
      saveHistory: false,
    })
    useAppStore.getState().replaceHistoryHead('Sculpt')
    const completedPositions = useAppStore
      .getState()
      .objects[0]!.positions.map((position) => ({ ...position }))

    expect(completedPositions).not.toEqual(initialPositions)
    useAppStore.getState().undo()
    expect(useAppStore.getState().objects[0]!.positions).toEqual(initialPositions)

    useAppStore.getState().redo()
    expect(useAppStore.getState().objects[0]!.positions).toEqual(completedPositions)
  })
})
