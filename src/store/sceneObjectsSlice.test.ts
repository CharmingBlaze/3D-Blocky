import { afterEach, describe, expect, it } from 'vitest'
import { primitiveBoxToSceneObject } from '../primitives/primitiveBoxCommit'
import { heightAxisForView } from '../primitives/viewAxes'
import { emptySceneSnapshot, resetSceneHistory } from './historySlice'
import { useAppStore } from './appStore'

function box(name: string) {
  const object = primitiveBoxToSceneObject(
    'box',
    { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } },
    heightAxisForView('front'),
    0x6ecbf5,
    128
  )
  if (!object) throw new Error('Box fixture failed')
  return { ...object, name }
}

afterEach(() => {
  resetSceneHistory(emptySceneSnapshot())
  useAppStore.setState({
    objects: [],
    selectedObjectId: null,
    selectionObjectIds: [],
    meshSelection: null,
    objectTextures: {},
    pixelDocuments: {},
    canUndo: false,
    canRedo: false,
  })
})

describe('scene object removal', () => {
  it('clears stale component selection and activates the remaining selected object', () => {
    const first = box('First')
    const second = box('Second')
    useAppStore.setState({
      objects: [first, second],
      selectedObjectId: first.id,
      selectionObjectIds: [second.id, first.id],
      meshSelection: {
        objectId: first.id,
        vertices: [0],
        edges: [],
        faces: [],
      },
    })

    useAppStore.getState().removeObject(first.id)

    const state = useAppStore.getState()
    expect(state.selectionObjectIds).toEqual([second.id])
    expect(state.selectedObjectId).toBe(second.id)
    expect(state.meshSelection).toBeNull()
  })
})
