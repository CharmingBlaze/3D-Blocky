import { describe, expect, it, afterEach, beforeEach, vi } from 'vitest'
import { createPixelDocument } from './pixelDocument'
import {
  detachPixelDocumentForEditing,
  flushPixelDocumentGpuSync,
  paintStrokeOnDocumentLive,
  paintAtPixelLive,
  publishPixelDocumentIdentity,
} from './pixelEditorSlice'
import { getPixelCompositeCache, clearPixelCompositeCache } from './pixelCompositeCache'
import { compositeLayers } from './compositeLayers'

describe('live pixel paint', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'requestAnimationFrame',
      (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number
    )
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
  })

  afterEach(() => {
    flushPixelDocumentGpuSync()
    clearPixelCompositeCache('doc')
    vi.unstubAllGlobals()
  })

  it('mutates the active layer in place without replacing the document map entry', () => {
    const doc = createPixelDocument(8, 8, 'doc')
    const docs = { doc }
    const detached = detachPixelDocumentForEditing(docs, 'doc')
    const layer = detached.doc!.layers[0]!
    const pixelsBefore = layer.pixels

    paintStrokeOnDocumentLive(
      detached,
      'doc',
      [
        { x: 2, y: 2 },
        { x: 5, y: 2 },
      ],
      [1, 0, 0, 1],
      1,
      'pencil',
      false,
      false,
      false
    )

    expect(detached.doc!.layers[0]!.pixels).toBe(pixelsBefore)
    // Painted pixels should be non-zero red
    const i = (2 * 8 + 2) * 4
    expect(pixelsBefore[i]).toBeGreaterThan(0)
    expect(pixelsBefore[i + 3]).toBeGreaterThan(0)
  })

  it('schedules a composite that matches compositing the live document', () => {
    const doc = createPixelDocument(4, 4, 'doc')
    const docs = detachPixelDocumentForEditing({ doc }, 'doc')
    paintAtPixelLive(docs, 'doc', 1, 1, [0, 1, 0, 1], 1, 'pencil', false, false)
    flushPixelDocumentGpuSync()

    const cached = getPixelCompositeCache('doc')
    expect(cached).toBeTruthy()
    const expected = compositeLayers(docs.doc!)
    expect(Array.from(cached!.pixels)).toEqual(Array.from(expected))
  })

  it('compositeLayers reuses an output buffer on the single-layer fast path', () => {
    const doc = createPixelDocument(4, 4, 'doc')
    doc.layers[0]!.pixels[0] = 10
    const out = new Uint8ClampedArray(4 * 4 * 4)
    const result = compositeLayers(doc, out)
    expect(result).toBe(out)
    expect(out[0]).toBe(10)
  })

  it('publishPixelDocumentIdentity changes doc/layer refs but keeps pixel buffers', () => {
    const doc = createPixelDocument(4, 4, 'doc')
    const docs = detachPixelDocumentForEditing({ doc }, 'doc')
    paintAtPixelLive(docs, 'doc', 0, 0, [1, 0, 0, 1], 1, 'pencil', false, false)
    const before = docs.doc!
    const pixels = before.layers[0]!.pixels

    const published = publishPixelDocumentIdentity(docs, 'doc')
    expect(published).not.toBe(docs)
    expect(published.doc).not.toBe(before)
    expect(published.doc!.layers[0]).not.toBe(before.layers[0])
    expect(published.doc!.layers[0]!.pixels).toBe(pixels)
    expect(published.doc!.layers[0]!.pixels[0]).toBeGreaterThan(0)
  })
})
