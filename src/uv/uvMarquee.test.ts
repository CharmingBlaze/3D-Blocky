import { describe, expect, it } from 'vitest'
import { polygonIntersectsMarquee } from './uvMarquee'

const square = [
  { x: 10, y: 10 },
  { x: 30, y: 10 },
  { x: 30, y: 30 },
  { x: 10, y: 30 },
]

describe('polygonIntersectsMarquee', () => {
  it('selects when the marquee contains a UV corner', () => {
    expect(polygonIntersectsMarquee(square, { x0: 5, y0: 5, x1: 15, y1: 15 })).toBe(true)
  })

  it('selects when a small marquee is entirely inside a large UV face', () => {
    expect(polygonIntersectsMarquee(square, { x0: 16, y0: 16, x1: 20, y1: 20 })).toBe(true)
  })

  it('selects when the marquee only crosses a UV edge', () => {
    expect(polygonIntersectsMarquee(square, { x0: 0, y0: 18, x1: 40, y1: 22 })).toBe(true)
  })

  it('rejects a separated marquee in either drag direction', () => {
    expect(polygonIntersectsMarquee(square, { x0: 50, y0: 50, x1: 40, y1: 40 })).toBe(false)
  })
})
