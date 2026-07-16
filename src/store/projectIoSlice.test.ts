import { afterEach, describe, expect, it } from 'vitest'
import { primitiveBoxToSceneObject } from '../primitives/primitiveBoxCommit'
import { heightAxisForView } from '../primitives/viewAxes'
import {
  answerAppConfirm,
  getAppConfirmRequest,
} from '../ui/appConfirm'
import { useAppStore } from './appStore'

afterEach(() => {
  answerAppConfirm(false)
  useAppStore.setState({
    objects: [],
    selectedObjectId: null,
    selectionObjectIds: [],
    meshSelection: null,
  })
})

describe('project I/O actions', () => {
  it('guards newProject at the store boundary when project content exists', async () => {
    const object = primitiveBoxToSceneObject(
      'box',
      { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } },
      heightAxisForView('front'),
      0x6ecbf5,
      128
    )
    expect(object).not.toBeNull()
    useAppStore.setState({ objects: [object!] })

    const result = useAppStore.getState().newProject()
    expect(getAppConfirmRequest()?.confirmLabel).toBe('Discard')
    answerAppConfirm(false)

    await expect(result).resolves.toBe(false)
    expect(useAppStore.getState().objects).toHaveLength(1)
  })
})
