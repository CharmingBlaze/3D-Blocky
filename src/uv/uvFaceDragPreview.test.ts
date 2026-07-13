import { describe, expect, it } from 'vitest'
import {
  applyFaceScaleOverlayTransform,
  faceDragScreenToUvDelta,
  faceRotateAngleFromUv,
} from './uvFaceDragPreview'

describe('uvFaceDragPreview', () => {
  it('maps screen delta to UV with flipped V', () => {
    const state = {
      startClientX: 100,
      startClientY: 100,
      zoom: 2,
      texW: 256,
      texH: 256,
    }
    // Move 512px right, 512px down at zoom 2 → du=+1, dv=-1
    const { du, dv } = faceDragScreenToUvDelta(state, 100 + 512, 100 + 512)
    expect(du).toBeCloseTo(1, 5)
    expect(dv).toBeCloseTo(-1, 5)
  })

  it('measures rotate angle from UV pointer vs start angle', () => {
    const state = {
      pivotU: 0.5,
      pivotV: 0.5,
      startAngle: 0,
      originX: 0,
      originY: 0,
    }
    // Point straight up in UV (+V) from pivot → +π/2
    expect(faceRotateAngleFromUv(state, { u: 0.5, v: 1 })).toBeCloseTo(Math.PI / 2, 5)
    // 90° start, same pointer → 0 delta
    expect(
      faceRotateAngleFromUv({ ...state, startAngle: Math.PI / 2 }, { u: 0.5, v: 1 })
    ).toBeCloseTo(0, 5)
  })

  it('applies CSS scale at the screen-space pivot', () => {
    const el = {
      style: {
        willChange: '',
        transformOrigin: '',
        transform: '',
      },
    } as unknown as HTMLElement
    applyFaceScaleOverlayTransform(el, { originX: 120, originY: 80 }, 1.5, 0.5)
    expect(el.style.transformOrigin).toBe('120px 80px')
    expect(el.style.transform).toBe('scale(1.5, 0.5)')
  })
})
