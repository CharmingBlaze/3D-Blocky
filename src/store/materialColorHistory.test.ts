import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Rgba4 } from '../material/materialTypes'
import { primitiveBoxToSceneObject } from '../primitives/primitiveBoxCommit'
import { heightAxisForView } from '../primitives/viewAxes'
import { emptySceneSnapshot, resetSceneHistory, snapshotFromState } from './historySlice'
import { useAppStore } from './appStore'

function box() {
  const object = primitiveBoxToSceneObject(
    'box',
    { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } },
    heightAxisForView('front'),
    0x6ecbf5,
    128
  )
  if (!object) throw new Error('Box fixture failed')
  return object
}

afterEach(() => {
  useAppStore.getState().commitMaterialEditorColor(useAppStore.getState().materialEditorColor)
  resetSceneHistory(emptySceneSnapshot())
  useAppStore.setState({
    objects: [],
    selectedObjectId: null,
    selectionObjectIds: [],
    meshSelection: null,
    objectTextures: {},
    pixelDocuments: {},
    materialPaintHistoryPending: false,
    canUndo: false,
    canRedo: false,
  })
  vi.unstubAllGlobals()
})

describe('material color history', () => {
  it('does not apply a queued live color after undo restores the scene', () => {
    let nextFrame = 1
    const callbacks = new Map<number, FrameRequestCallback>()
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = nextFrame++
      callbacks.set(id, callback)
      return id
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      callbacks.delete(id)
    })

    const object = box()
    useAppStore.setState({
      objects: [object],
      selectedObjectId: object.id,
      selectionObjectIds: [object.id],
      selectionMode: 'object',
    })
    resetSceneHistory(snapshotFromState(useAppStore.getState()))

    useAppStore.getState().commitMaterialEditorColor([0, 1, 0, 1])
    useAppStore.getState().setMaterialEditorColorLive([0, 0, 1, 1] satisfies Rgba4)
    const queued = [...callbacks.values()][0]
    expect(queued).toBeTypeOf('function')
    expect(useAppStore.getState().materialPaintHistoryPending).toBe(true)

    useAppStore.getState().undo()
    const restored = JSON.stringify(useAppStore.getState().objects)
    queued!(performance.now())

    expect(JSON.stringify(useAppStore.getState().objects)).toBe(restored)
    expect(useAppStore.getState().materialPaintHistoryPending).toBe(false)
  })
})
