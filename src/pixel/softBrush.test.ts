import { describe, expect, it } from 'vitest'
import {
  beginSoftBrushStroke,
  continueSoftBrushStroke,
  paintSoftBrushDab,
  resetSoftBrushStroke,
  softBrushCoverage,
} from './softBrush'

describe('softBrush', () => {
  it('falls off from hard core to soft edge', () => {
    expect(softBrushCoverage(0, 0, 10, 0.5, 'round')).toBeCloseTo(1, 5)
    expect(softBrushCoverage(10, 0, 10, 0.5, 'round')).toBe(0)
    const mid = softBrushCoverage(7.5, 0, 10, 0.5, 'round')
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(1)
  })

  it('blends a soft dab without fully replacing neighbors', () => {
    const w = 16
    const h = 16
    const pixels = new Uint8ClampedArray(w * h * 4)
    paintSoftBrushDab(
      pixels,
      w,
      h,
      8,
      8,
      [255, 0, 0, 255],
      { size: 8, hardness: 0.2, opacity: 0.5, flow: 1, shape: 'round' },
      false
    )
    const center = (8 * w + 8) * 4
    expect(pixels[center + 3]!).toBeGreaterThan(0)
    expect(pixels[center]!).toBeGreaterThan(0)
    const edge = (8 * w + 11) * 4
    expect(pixels[edge + 3]!).toBeLessThan(pixels[center + 3]!)
  })

  it('spaces dabs along a stroke instead of flooding every pixel', () => {
    const w = 64
    const h = 16
    const pixels = new Uint8ClampedArray(w * h * 4)
    const params = {
      size: 10,
      hardness: 1,
      opacity: 1,
      flow: 1,
      shape: 'round' as const,
      spacing: 0.5,
    }
    resetSoftBrushStroke()
    beginSoftBrushStroke(pixels, w, h, 0, 8, [255, 255, 255, 255], params)
    continueSoftBrushStroke(pixels, w, h, 40, 8, [255, 255, 255, 255], params)
    // size 10 + spacing 0.5 → ~5px gaps; a continuous hard flood would fill ~41 cols.
    let paintedCols = 0
    for (let x = 0; x < w; x++) {
      if (pixels[(8 * w + x) * 4 + 3]! > 0) paintedCols++
    }
    expect(paintedCols).toBeGreaterThan(8)
    expect(paintedCols).toBeLessThanOrEqual(50)
  })

  it('accumulates flow on overlapping soft dabs', () => {
    const w = 16
    const h = 16
    const pixels = new Uint8ClampedArray(w * h * 4)
    const params = {
      size: 6,
      hardness: 1,
      opacity: 1,
      flow: 0.25,
      shape: 'round' as const,
    }
    paintSoftBrushDab(pixels, w, h, 8, 8, [0, 0, 255, 255], params, false)
    const i = (8 * w + 8) * 4 + 3
    const afterOne = pixels[i]!
    paintSoftBrushDab(pixels, w, h, 8, 8, [0, 0, 255, 255], params, false)
    expect(pixels[i]!).toBeGreaterThan(afterOne)
  })
})
