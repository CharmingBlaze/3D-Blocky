import { describe, expect, it } from 'vitest'
import { resolveUvPreviewFaceSelection } from './uvPreviewSelection'

describe('resolveUvPreviewFaceSelection', () => {
  it('replaces the selection on a normal click', () => {
    expect(resolveUvPreviewFaceSelection([1, 2], 5, false)).toEqual([5])
  })

  it('adds and removes faces with Shift', () => {
    expect(resolveUvPreviewFaceSelection([1, 2], 5, true)).toEqual([1, 2, 5])
    expect(resolveUvPreviewFaceSelection([1, 2, 5], 2, true)).toEqual([1, 5])
  })
})
