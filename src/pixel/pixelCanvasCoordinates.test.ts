import { describe, expect, it } from 'vitest'
import { pointerToDocumentPixel } from './pixelCanvasCoordinates'

describe('pointerToDocumentPixel', () => {
  const rect = { left: 100.5, top: 40.25, width: 512, height: 256 }

  it('maps the displayed canvas to exact texture texels despite fractional layout', () => {
    expect(pointerToDocumentPixel(356.5, 168.25, rect, 128, 64)).toEqual({ x: 64, y: 32 })
  })

  it('preserves sub-texel coordinates for soft brush strokes', () => {
    expect(pointerToDocumentPixel(102.5, 42.25, rect, 128, 64, true)).toEqual({
      x: 0.5,
      y: 0.5,
    })
  })

  it('rejects pointers outside the displayed texture', () => {
    expect(pointerToDocumentPixel(100, 50, rect, 128, 64)).toBeNull()
    expect(pointerToDocumentPixel(700, 50, rect, 128, 64)).toBeNull()
  })
})
