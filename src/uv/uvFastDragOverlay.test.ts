import { describe, expect, it, vi } from 'vitest'
import {
  ensureUvDragStaticCanvas,
  isUvTransformDragKind,
} from './uvFastDragOverlay'

describe('uvFastDragOverlay', () => {
  it('recognizes face transform drag kinds', () => {
    expect(isUvTransformDragKind('faceDrag')).toBe(true)
    expect(isUvTransformDragKind('faceScale')).toBe(true)
    expect(isUvTransformDragKind('faceRotate')).toBe(true)
    expect(isUvTransformDragKind('handle')).toBe(false)
    expect(isUvTransformDragKind('pan')).toBe(false)
    expect(isUvTransformDragKind(undefined)).toBe(false)
  })

  it('reuses an offscreen canvas when size matches', () => {
    const make = (w = 0, h = 0) => {
      const c = { width: w, height: h } as HTMLCanvasElement
      return c
    }
    vi.stubGlobal('document', {
      createElement: () => make(),
    })
    try {
      const a = ensureUvDragStaticCanvas(null, 64, 48)
      expect(a.width).toBe(64)
      expect(a.height).toBe(48)
      const b = ensureUvDragStaticCanvas(a, 64, 48)
      expect(b).toBe(a)
      const c = ensureUvDragStaticCanvas(a, 80, 48)
      expect(c).not.toBe(a)
      expect(c.width).toBe(80)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
