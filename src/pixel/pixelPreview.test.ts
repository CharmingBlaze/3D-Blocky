import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { scheduleDocPreview, flushDocPreviewGpu } from './pixelPreview'
import { createPixelDocument } from './pixelDocument'

describe('pixel preview scheduling', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })

  afterEach(() => {
    flushDocPreviewGpu()
    vi.unstubAllGlobals()
  })

  it('coalesces repeated live updates behind one scheduled frame', () => {
    const doc = createPixelDocument(8, 8, 'doc')
    const docs = { doc }
    scheduleDocPreview(docs, 'doc', { x: 0, y: 0, w: 1, h: 1 })
    scheduleDocPreview(docs, 'doc', { x: 6, y: 6, w: 1, h: 1 })
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1)
  })
})
