import { describe, expect, it } from 'vitest'
import { rgbaBufferHasAlpha } from './imageAlpha'

describe('rgbaBufferHasAlpha', () => {
  it('is false for fully opaque RGBA', () => {
    const pixels = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255])
    expect(rgbaBufferHasAlpha(pixels)).toBe(false)
  })

  it('is true when any texel is transparent or semi-transparent', () => {
    const clear = new Uint8ClampedArray([0, 0, 0, 0, 255, 0, 0, 255])
    expect(rgbaBufferHasAlpha(clear)).toBe(true)
    const soft = new Uint8ClampedArray([255, 255, 255, 255, 0, 255, 0, 128])
    expect(rgbaBufferHasAlpha(soft)).toBe(true)
  })

  it('handles empty buffers as opaque', () => {
    expect(rgbaBufferHasAlpha(new Uint8ClampedArray())).toBe(false)
  })
})
