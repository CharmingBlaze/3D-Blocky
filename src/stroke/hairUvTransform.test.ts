import { describe, expect, it } from 'vitest'
import { strokeToMesh } from './strokeToMesh'
import {
  applyHairUvTransformToObject,
  DEFAULT_HAIR_UV_TRANSFORM,
  isDefaultHairUvTransform,
  normalizeHairUvTransform,
  transformHairUv,
  type HairUvTransform,
} from './hairUvTransform'

const wavy = Array.from({ length: 40 }, (_, i) => ({
  x: i * 4,
  y: Math.sin(i * 0.35) * 18,
}))

const base = {
  points: wavy,
  view: 'front' as const,
  polyBudget: 128,
  brushDensity: 12,
  rdpTolerance: 2,
  closeThreshold: 12,
  defaultDepth: 0,
  color: 0xaa6633,
  extrudeAmount: 16,
}

describe('hairUvTransform', () => {
  it('identity leaves procedural UVs unchanged', () => {
    expect(transformHairUv(0, 0, DEFAULT_HAIR_UV_TRANSFORM)).toEqual({ u: 0, v: 0 })
    expect(transformHairUv(1, 1, DEFAULT_HAIR_UV_TRANSFORM)).toEqual({ u: 1, v: 1 })
    expect(transformHairUv(0.5, 0.25, DEFAULT_HAIR_UV_TRANSFORM)).toEqual({ u: 0.5, v: 0.25 })
    expect(isDefaultHairUvTransform(DEFAULT_HAIR_UV_TRANSFORM)).toBe(true)
  })

  it('offset and scale map the unit square into a sub-rect', () => {
    const t: HairUvTransform = {
      ...DEFAULT_HAIR_UV_TRANSFORM,
      offsetU: 0.2,
      offsetV: 0.1,
      scaleU: 0.5,
      scaleV: 0.4,
    }
    expect(transformHairUv(0, 0, t).u).toBeCloseTo(0.2, 5)
    expect(transformHairUv(0, 0, t).v).toBeCloseTo(0.1, 5)
    expect(transformHairUv(1, 1, t).u).toBeCloseTo(0.7, 5)
    expect(transformHairUv(1, 1, t).v).toBeCloseTo(0.5, 5)
    expect(transformHairUv(0.5, 0.5, t).u).toBeCloseTo(0.45, 5)
    expect(transformHairUv(0.5, 0.5, t).v).toBeCloseTo(0.3, 5)
  })

  it('flip U/V mirrors within the mapping rect', () => {
    const t: HairUvTransform = {
      ...DEFAULT_HAIR_UV_TRANSFORM,
      offsetU: 0.1,
      offsetV: 0.2,
      scaleU: 0.8,
      scaleV: 0.6,
      flipU: true,
      flipV: true,
    }
    // local (0,0) → flipped (1,1) → end of rect
    expect(transformHairUv(0, 0, t).u).toBeCloseTo(0.9, 5)
    expect(transformHairUv(0, 0, t).v).toBeCloseTo(0.8, 5)
    expect(transformHairUv(1, 1, t).u).toBeCloseTo(0.1, 5)
    expect(transformHairUv(1, 1, t).v).toBeCloseTo(0.2, 5)
  })

  it('rotation 90° around rect center', () => {
    const t: HairUvTransform = {
      ...DEFAULT_HAIR_UV_TRANSFORM,
      rotationDeg: 90,
    }
    // (1, 0.5) → relative (0.5, 0) → rot90 → (0, 0.5) → (0.5, 1)
    const p = transformHairUv(1, 0.5, t)
    expect(p.u).toBeCloseTo(0.5, 5)
    expect(p.v).toBeCloseTo(1, 5)
  })

  it('normalize clamps tiny scales and fills defaults', () => {
    const n = normalizeHairUvTransform({ scaleU: 0.01, flipU: true })
    expect(n.scaleU).toBeGreaterThanOrEqual(0.05)
    expect(n.flipU).toBe(true)
    expect(n.scaleV).toBe(1)
    expect(n.offsetU).toBe(0)
  })

  it('applies transform to hair stroke object UVs', () => {
    const obj = strokeToMesh({ ...base, strokeMode: 'hair-paths' })!
    expect(obj.uvs?.length).toBeGreaterThan(0)
    const beforeMinU = Math.min(...obj.uvs!.map((uv) => uv.u))
    const beforeMaxU = Math.max(...obj.uvs!.map((uv) => uv.u))
    expect(beforeMinU).toBeLessThan(0.05)
    expect(beforeMaxU).toBeGreaterThan(0.95)

    const t: HairUvTransform = {
      ...DEFAULT_HAIR_UV_TRANSFORM,
      offsetU: 0.25,
      offsetV: 0.1,
      scaleU: 0.5,
      scaleV: 0.3,
    }
    const mapped = applyHairUvTransformToObject(obj, t)
    expect(mapped).not.toBe(obj)
    const us = mapped.uvs!.map((uv) => uv.u)
    const vs = mapped.uvs!.map((uv) => uv.v)
    expect(Math.min(...us)).toBeGreaterThanOrEqual(0.24)
    expect(Math.max(...us)).toBeLessThanOrEqual(0.76)
    expect(Math.min(...vs)).toBeGreaterThanOrEqual(0.09)
    expect(Math.max(...vs)).toBeLessThanOrEqual(0.41)
  })

  it('applies to Hair Strips and Rounded Hair', () => {
    const t: HairUvTransform = {
      ...DEFAULT_HAIR_UV_TRANSFORM,
      offsetU: 0.2,
      scaleU: 0.4,
      flipV: true,
    }
    for (const mode of ['hair-strips', 'hair-round'] as const) {
      const obj = strokeToMesh({ ...base, strokeMode: mode })!
      const mapped = applyHairUvTransformToObject(obj, t)
      expect(mapped.uvs!.length).toBe(obj.uvs!.length)
      const us = mapped.uvs!.map((uv) => uv.u)
      expect(Math.min(...us)).toBeGreaterThanOrEqual(0.19)
      expect(Math.max(...us)).toBeLessThanOrEqual(0.61)
    }
  })

  it('default transform is a no-op (same object reference)', () => {
    const obj = strokeToMesh({ ...base, strokeMode: 'hair-round' })!
    expect(applyHairUvTransformToObject(obj, DEFAULT_HAIR_UV_TRANSFORM)).toBe(obj)
    expect(applyHairUvTransformToObject(obj, null)).toBe(obj)
  })
})
