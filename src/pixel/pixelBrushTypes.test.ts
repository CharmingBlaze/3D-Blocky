import { describe, expect, it } from 'vitest'
import {
  PIXEL_BRUSH_SHAPES,
  isPixelFreehandPaintTool,
  pixelBrushIsRound,
} from './pixelBrushTypes'

describe('pixelBrushTypes', () => {
  it('exposes round and square tips for the Paint Brush tool', () => {
    expect(PIXEL_BRUSH_SHAPES.map((b) => b.id)).toEqual(['round', 'square'])
    expect(pixelBrushIsRound('round')).toBe(true)
    expect(pixelBrushIsRound('square')).toBe(false)
  })

  it('treats pencil, paintBrush, and eraser as freehand paint tools', () => {
    expect(isPixelFreehandPaintTool('pencil')).toBe(true)
    expect(isPixelFreehandPaintTool('paintBrush')).toBe(true)
    expect(isPixelFreehandPaintTool('eraser')).toBe(true)
    expect(isPixelFreehandPaintTool('bucket')).toBe(false)
  })
})
