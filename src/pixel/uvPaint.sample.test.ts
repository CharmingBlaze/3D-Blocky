import { describe, expect, it } from 'vitest'
import {
  interpolateScreenPaintSamples,
  MAX_PAINT_SCREEN_SAMPLES,
  uvToPixelCoords,
} from './uvPaint'

describe('uvPaint sampling', () => {
  it('caps screen paint samples so long moves stay cheap', () => {
    const samples = interpolateScreenPaintSamples(0, 0, 1000, 0, 1)
    // Inclusive endpoints → at most maxSamples + 1 points.
    expect(samples.length).toBeLessThanOrEqual(MAX_PAINT_SCREEN_SAMPLES + 1)
    expect(samples[0]).toEqual({ x: 0, y: 0 })
    expect(samples[samples.length - 1]).toEqual({ x: 1000, y: 0 })
  })

  it('keeps short moves dense', () => {
    const samples = interpolateScreenPaintSamples(0, 0, 4, 0, 1)
    expect(samples.length).toBe(5)
  })

  it('keeps exact UV borders on valid edge texels', () => {
    expect(uvToPixelCoords({ u: 0, v: 1 }, 128, 64)).toEqual({ x: 0, y: 0 })
    expect(uvToPixelCoords({ u: 1, v: 0 }, 128, 64)).toEqual({ x: 127, y: 63 })
  })

  it('safely clamps slightly overshooting interpolated UVs', () => {
    expect(uvToPixelCoords({ u: 1.001, v: -0.001 }, 16, 16)).toEqual({ x: 15, y: 15 })
  })
})
