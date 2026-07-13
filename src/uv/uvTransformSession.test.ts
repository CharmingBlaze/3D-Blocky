import { describe, expect, it } from 'vitest'
import {
  applyUvLive3dDelta,
  isCssUvLiveOverlayMode,
  uvScreenOriginFromPivot,
  writeUvLive3dPool,
} from './uvTransformSession'

describe('uvTransformSession', () => {
  it('maps a UV pivot to screen origin with V flipped', () => {
    // u=0.5,v=1 → pixel (0.5*texW, 0) because uvToPixel flips V
    const origin = uvScreenOriginFromPivot({ u: 0.5, v: 1 }, 10, 20, 2, 100, 100)
    expect(origin.originX).toBeCloseTo(10 + 50 * 2, 8)
    expect(origin.originY).toBeCloseTo(20 + 0 * 2, 8)
  })

  it('writes live 3D pool from snapshot values', () => {
    const live = {
      indices: [1, 3],
      starts: [
        { u: 0, v: 0 },
        { u: 1, v: 1 },
      ],
      pool: [
        { u: 0, v: 0 },
        { u: 0, v: 0 },
        { u: 0, v: 0 },
        { u: 0, v: 0 },
      ],
    }
    writeUvLive3dPool(live, [
      { u: 0.25, v: 0.5 },
      { u: 0.75, v: 0.25 },
    ])
    expect(live.pool[1]).toEqual({ u: 0.25, v: 0.5 })
    expect(live.pool[3]).toEqual({ u: 0.75, v: 0.25 })
  })

  it('applies a move delta from starts', () => {
    const live = {
      indices: [0],
      starts: [{ u: 0.2, v: 0.4 }],
      pool: [{ u: 0.2, v: 0.4 }],
    }
    applyUvLive3dDelta(live, 0.1, -0.2)
    expect(live.pool[0]!.u).toBeCloseTo(0.3, 10)
    expect(live.pool[0]!.v).toBeCloseTo(0.2, 10)
  })

  it('recognizes CSS overlay modes', () => {
    expect(isCssUvLiveOverlayMode('css-scale')).toBe(true)
    expect(isCssUvLiveOverlayMode('repaint')).toBe(false)
  })
})
