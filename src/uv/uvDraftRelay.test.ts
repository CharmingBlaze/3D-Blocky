import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearUvDraft,
  getUvDraftForTests,
  scheduleUvDraft,
  setUvDraft,
} from './uvDraftRelay'

afterEach(() => {
  clearUvDraft()
  vi.unstubAllGlobals()
})

describe('uvDraftRelay', () => {
  it('coalesces scheduleUvDraft to one notify per frame', () => {
    const callbacks: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      callbacks.push(cb)
      return callbacks.length
    })
    vi.stubGlobal('cancelAnimationFrame', () => {})

    const pool = [{ u: 0, v: 0 }, { u: 1, v: 1 }]
    scheduleUvDraft('obj', pool)
    pool[0] = { u: 0.5, v: 0.25 }
    scheduleUvDraft('obj', pool)
    expect(getUvDraftForTests()).toBeNull()
    expect(callbacks).toHaveLength(1)
    callbacks[0]!(0)
    expect(getUvDraftForTests()?.uvs[0]).toEqual({ u: 0.5, v: 0.25 })
  })

  it('setUvDraft publishes immediately', () => {
    setUvDraft('obj', [{ u: 0.2, v: 0.3 }])
    expect(getUvDraftForTests()?.objectId).toBe('obj')
    clearUvDraft('obj')
    expect(getUvDraftForTests()).toBeNull()
  })
})
