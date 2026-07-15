import { describe, expect, it, afterEach, beforeEach, vi } from 'vitest'
import { createPixelDocument } from './pixelDocument'
import {
  bumpPixelDocRevision,
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

  it('composites immediately for canvas feedback and uploads on flush', () => {
    const doc = createPixelDocument(4, 4, 'doc')
    const docs = detachPixelDocumentForEditing({ doc }, 'doc')
    paintAtPixelLive(docs, 'doc', 1, 1, [0, 1, 0, 1], 1, 'pencil', false, false)

    // Canvas path: composite cache is ready before RAF upload.
    const cachedBeforeFlush = getPixelCompositeCache('doc')
    expect(cachedBeforeFlush).toBeTruthy()
    const expected = compositeLayers(docs.doc!)
    expect(Array.from(cachedBeforeFlush!.pixels)).toEqual(Array.from(expected))

    flushPixelDocumentGpuSync()
    const cached = getPixelCompositeCache('doc')
    expect(cached).toBeTruthy()
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

  it('detachPixelDocumentForEditing clones only the active layer buffer', () => {
    const doc = createPixelDocument(4, 4, 'doc')
    const bottom = createPixelDocument(4, 4, 'tmp').layers[0]!
    bottom.id = 'bottom'
    bottom.name = 'Bottom'
    doc.layers = [bottom, doc.layers[0]!]
    doc.activeLayerId = doc.layers[1]!.id
    const bottomPixels = bottom.pixels
    const activePixels = doc.layers[1]!.pixels

    const docs = detachPixelDocumentForEditing({ doc }, 'doc')
    expect(docs.doc!.layers[0]!.pixels).toBe(bottomPixels)
    expect(docs.doc!.layers[1]!.pixels).not.toBe(activePixels)
    expect(docs.doc!.layers[1]!.pixels).toEqual(activePixels)
  })

  it('defers GPU upload when syncGpu is false until flush', () => {
    const doc = createPixelDocument(4, 4, 'doc')
    const docs = detachPixelDocumentForEditing({ doc }, 'doc')
    paintAtPixelLive(docs, 'doc', 1, 1, [1, 0, 0, 1], 1, 'pencil', false, false, {
      syncGpu: false,
    })
    // Composite ready immediately; GPU flush is deferred.
    expect(getPixelCompositeCache('doc')).toBeTruthy()
    flushPixelDocumentGpuSync()
    expect(getPixelCompositeCache('doc')).toBeTruthy()
  })

  it('bumpPixelDocRevision only touches the painted doc id', () => {
    const next = bumpPixelDocRevision({ a: 1 }, 'b')
    expect(next).toEqual({ a: 1, b: 1 })
    expect(bumpPixelDocRevision(next, 'b')).toEqual({ a: 1, b: 2 })
    expect(bumpPixelDocRevision(next, null)).toBe(next)
  })
})
