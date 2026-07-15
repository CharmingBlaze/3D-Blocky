import { describe, expect, it, afterEach, beforeEach, vi } from 'vitest'
import {
  clampDirtyRect,
  copyRgbaRect,
  softBrushDirtyRect,
  strokePointsDirtyRect,
  unionDirtyRects,
} from './pixelDirtyRect'
import { createPixelDocument } from './pixelDocument'
import { compositeLayers, compositeLayersRegion } from './compositeLayers'
import {
  detachPixelDocumentForEditing,
  paintAtPixelLive,
  flushPixelDocumentGpuSync,
} from './pixelEditorSlice'
import {
  clearPixelCompositeCache,
  getPixelCompositeCache,
  subscribePixelCompositeCache,
} from './pixelCompositeCache'

describe('pixelDirtyRect', () => {
  it('clamps and unions rects', () => {
    expect(clampDirtyRect({ x: -2, y: -1, w: 4, h: 3 }, 8, 8)).toEqual({
      x: 0,
      y: 0,
      w: 2,
      h: 2,
    })
    expect(
      unionDirtyRects({ x: 1, y: 1, w: 2, h: 2 }, { x: 3, y: 2, w: 2, h: 2 })
    ).toEqual({ x: 1, y: 1, w: 4, h: 3 })
  })

  it('builds stroke dirty bounds with symmetry mirrors', () => {
    const rect = strokePointsDirtyRect([{ x: 2, y: 2 }], 1, 10, 10, true, false, false)
    expect(rect).not.toBeNull()
    // Includes x=2 and mirrored x=7
    expect(rect!.x).toBeLessThanOrEqual(2)
    expect(rect!.x + rect!.w).toBeGreaterThan(7)
  })

  it('softBrushDirtyRect pads the dab radius', () => {
    const rect = softBrushDirtyRect(5, 5, 4, 16, 16)
    expect(rect).toEqual({ x: 2, y: 2, w: 7, h: 7 })
  })
})

describe('compositeLayersRegion', () => {
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

  it('matches full composite inside the dirty rect', () => {
    const doc = createPixelDocument(8, 8, 'doc')
    doc.layers[0]!.pixels[(2 * 8 + 2) * 4] = 200
    doc.layers[0]!.pixels[(2 * 8 + 2) * 4 + 3] = 255
    doc.layers[0]!.pixels[(5 * 8 + 5) * 4] = 90
    doc.layers[0]!.pixels[(5 * 8 + 5) * 4 + 3] = 255

    const full = compositeLayers(doc)
    const out = new Uint8ClampedArray(8 * 8 * 4)
    out.fill(7)
    const dirty = { x: 1, y: 1, w: 3, h: 3 }
    compositeLayersRegion(doc, out, dirty)

    for (let y = dirty.y; y < dirty.y + dirty.h; y++) {
      for (let x = dirty.x; x < dirty.x + dirty.w; x++) {
        const i = (y * 8 + x) * 4
        expect(out[i]).toBe(full[i])
        expect(out[i + 3]).toBe(full[i + 3])
      }
    }
    expect(out[0]).toBe(7)
    expect(out[(5 * 8 + 5) * 4]).toBe(7)
  })

  it('live paint notifies a dirty rect smaller than the document', () => {
    const doc = createPixelDocument(64, 64, 'doc')
    const docs = detachPixelDocumentForEditing({ doc }, 'doc')
    // Seed a full composite so dirty-rect path is eligible (version > 0).
    paintAtPixelLive(docs, 'doc', 0, 0, [0, 0, 0, 0], 1, 'pencil', false, false)

    let seen: { x: number; y: number; w: number; h: number } | null | undefined
    const unsub = subscribePixelCompositeCache('doc', (dirty) => {
      seen = dirty
    })
    paintAtPixelLive(docs, 'doc', 10, 12, [1, 0, 0, 1], 3, 'pencil', false, false)
    unsub()
    expect(seen).toBeTruthy()
    expect(seen!.w).toBeLessThan(64)
    expect(seen!.h).toBeLessThan(64)
    expect(seen!.x + seen!.w).toBeLessThanOrEqual(64)
    expect(getPixelCompositeCache('doc')).toBeTruthy()
  })

  it('first paint without a seeded cache does a full composite', () => {
    clearPixelCompositeCache('fresh')
    const doc = createPixelDocument(16, 16, 'fresh')
    doc.layers[0]!.pixels[0] = 40
    doc.layers[0]!.pixels[3] = 255
    const docs = detachPixelDocumentForEditing({ fresh: doc }, 'fresh')
    let seen: { x: number; y: number; w: number; h: number } | null | undefined = {
      x: 1,
      y: 1,
      w: 1,
      h: 1,
    }
    const unsub = subscribePixelCompositeCache('fresh', (dirty) => {
      seen = dirty
    })
    paintAtPixelLive(docs, 'fresh', 8, 8, [1, 0, 0, 1], 1, 'pencil', false, false)
    unsub()
    // No prior version → full notify (null dirty).
    expect(seen).toBeNull()
    const cached = getPixelCompositeCache('fresh')!
    expect(cached.pixels[0]).toBe(40)
    clearPixelCompositeCache('fresh')
  })
})

describe('copyRgbaRect', () => {
  it('copies only the target rectangle', () => {
    const src = new Uint8ClampedArray(4 * 4 * 4)
    const dst = new Uint8ClampedArray(4 * 4 * 4)
    src[20] = 55
    copyRgbaRect(dst, src, 4, { x: 1, y: 1, w: 1, h: 1 })
    expect(dst[20]).toBe(55)
    expect(dst[0]).toBe(0)
  })
})
