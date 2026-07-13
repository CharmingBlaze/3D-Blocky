import { describe, expect, it } from 'vitest'
import { strokeToMesh } from './strokeToMesh'
import {
  HAIR_PATH_SPINE_HARD_CAP,
  HAIR_STRIP_SPINE_HARD_CAP,
  prepareHairPathCenterline,
  prepareHairStripCenterline,
  regenerateSketchObjectFromSource,
} from './sketchSource'
import { hairHalfWidthFromBrush, resolveHairDepth } from '../mesh/hairRibbon'
import { vectorPathToMesh } from '../vector/vectorPathToMesh'
import type { VectorPath } from '../vector/types'

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

function zExtent(positions: { z: number }[]): number {
  const zs = positions.map((p) => p.z)
  return Math.max(...zs) - Math.min(...zs)
}

function xySpan(positions: { x: number; y: number }[]): number {
  const xs = positions.map((p) => p.x)
  const ys = positions.map((p) => p.y)
  return Math.max(
    Math.max(...xs) - Math.min(...xs),
    Math.max(...ys) - Math.min(...ys)
  )
}

describe('hair paths vs hair strips', () => {
  it('routes Hair Paths to a tapered ribbon doodle', () => {
    const obj = strokeToMesh({ ...base, strokeMode: 'hair-paths' })
    expect(obj?.name).toBe('Hair Paths')
    expect(obj?.sketchSource?.kind).toBe('hair-path')
    expect(obj?.uvs?.length).toBeGreaterThan(0)
    expect(obj?.faceUvIndices?.length).toBe(obj?.faces.length)
    expect(obj?.uvAutoPacked).toBe(true)
  })

  it('routes Hair Strips to a coarser tapered card', () => {
    const paths = strokeToMesh({ ...base, strokeMode: 'hair-paths' })!
    const strips = strokeToMesh({ ...base, strokeMode: 'hair-strips' })!
    expect(strips.name).toBe('Hair Strips')
    expect(strips.sketchSource?.kind).toBe('hair-strip')
    // Strips use fewer lengthwise samples → fewer verts than Paths on the same stroke.
    expect(strips.positions.length).toBeLessThan(paths.positions.length)
  })

  it('spine prep differs: paths denser, strips capped low', () => {
    const relative = wavy.map((p) => ({ x: p.x - 78, y: p.y }))
    const pathSpine = prepareHairPathCenterline(relative, 128)!
    const stripSpine = prepareHairStripCenterline(relative, 128)!
    expect(pathSpine.length).toBeGreaterThan(stripSpine.length)
    expect(pathSpine.length).toBeLessThanOrEqual(HAIR_PATH_SPINE_HARD_CAP)
    expect(stripSpine.length).toBeLessThanOrEqual(HAIR_STRIP_SPINE_HARD_CAP)
  })

  it('sketch thickness widens the hair ribbon', () => {
    const thin = strokeToMesh({ ...base, strokeMode: 'hair-paths', brushDensity: 6 })!
    const thick = strokeToMesh({ ...base, strokeMode: 'hair-paths', brushDensity: 24 })!
    expect(xySpan(thick.positions)).toBeGreaterThan(xySpan(thin.positions))
    expect(hairHalfWidthFromBrush(24, 'path')).toBeGreaterThan(hairHalfWidthFromBrush(6, 'path'))
  })

  it('poly budget densifies lengthwise hair samples', () => {
    const coarse = strokeToMesh({ ...base, strokeMode: 'hair-paths', polyBudget: 48 })!
    const dense = strokeToMesh({ ...base, strokeMode: 'hair-paths', polyBudget: 200 })!
    expect(dense.positions.length).toBeGreaterThan(coarse.positions.length)

    const stripCoarse = strokeToMesh({ ...base, strokeMode: 'hair-strips', polyBudget: 48 })!
    const stripDense = strokeToMesh({ ...base, strokeMode: 'hair-strips', polyBudget: 200 })!
    expect(stripDense.positions.length).toBeGreaterThanOrEqual(stripCoarse.positions.length)
    expect(stripDense.positions.length).toBeLessThan(dense.positions.length)
  })

  it('extrude depth sets Hair Paths thickness and stores signed depth', () => {
    const shallow = strokeToMesh({
      ...base,
      strokeMode: 'hair-paths',
      extrudeAmount: 4,
    })!
    const deep = strokeToMesh({
      ...base,
      strokeMode: 'hair-paths',
      extrudeAmount: 24,
    })!
    const flipped = strokeToMesh({
      ...base,
      strokeMode: 'hair-paths',
      extrudeAmount: -24,
    })!

    expect(zExtent(deep.positions)).toBeGreaterThan(zExtent(shallow.positions))
    expect(zExtent(deep.positions)).toBeCloseTo(24, 5)
    expect(zExtent(flipped.positions)).toBeCloseTo(24, 5)
    expect(deep.sketchSource?.extrudeDepth).toBe(24)
    expect(flipped.sketchSource?.extrudeDepth).toBe(-24)
    expect(resolveHairDepth(-15, 12, 'path')).toBe(-15)
  })

  it('Hair Strips stay flat — Extrude depth does not thicken; thickness widens', () => {
    const thin = strokeToMesh({
      ...base,
      strokeMode: 'hair-strips',
      brushDensity: 6,
      extrudeAmount: 4,
    })!
    const thickDeep = strokeToMesh({
      ...base,
      strokeMode: 'hair-strips',
      brushDensity: 24,
      extrudeAmount: 40,
    })!

    expect(zExtent(thin.positions)).toBeLessThan(1e-4)
    expect(zExtent(thickDeep.positions)).toBeLessThan(1e-4)
    expect(thin.positions.every((p) => Math.abs(p.z) < 1e-4)).toBe(true)
    expect(thickDeep.positions.every((p) => Math.abs(p.z) < 1e-4)).toBe(true)
    expect(xySpan(thickDeep.positions)).toBeGreaterThan(xySpan(thin.positions))
    expect(resolveHairDepth(40, 12, 'strip')).toBe(0)
    expect(thickDeep.sketchSource?.extrudeDepth).toBe(0)
  })

  it('regenerates hair doodles while preserving id and applying slider patches', () => {
    const original = strokeToMesh({
      ...base,
      strokeMode: 'hair-paths',
      polyBudget: 48,
      brushDensity: 8,
      extrudeAmount: 8,
    })!
    const regen = regenerateSketchObjectFromSource(original, {
      brushDensity: 22,
      polyBudget: 200,
      extrudeDepth: -20,
    })
    expect(regen?.id).toBe(original.id)
    expect(regen?.sketchSource?.kind).toBe('hair-path')
    expect(regen?.sketchSource?.brushDensity).toBe(22)
    expect(regen?.sketchSource?.polyBudget).toBe(200)
    expect(regen?.sketchSource?.extrudeDepth).toBe(-20)
    expect(zExtent(regen!.positions)).toBeCloseTo(20, 5)
    expect(xySpan(regen!.positions)).toBeGreaterThan(xySpan(original.positions))
    expect(regen!.positions.length).toBeGreaterThan(original.positions.length)
    expect(regen?.uvs?.length).toBeGreaterThan(0)
    expect(regen?.uvAutoPacked).toBe(true)
  })

  it('vector pen routes both hair modes and honors stroke sliders', () => {
    const path: VectorPath = {
      id: 'p1',
      view: 'front',
      closed: false,
      color: 0xaa6633,
      source: 'pen',
      anchors: wavy.map((p, i) => ({
        id: `a${i}`,
        position: p,
        inHandle: null,
        outHandle: null,
      })),
    }
    const hairPath = vectorPathToMesh(path, {
      view: 'front',
      polyBudget: 64,
      brushDensity: 8,
      strokeMode: 'hair-paths',
      rdpTolerance: 2,
      closeThreshold: 12,
      defaultDepth: 0,
      color: 0xaa6633,
      extrudeAmount: 10,
    })
    const hairPathDense = vectorPathToMesh(path, {
      view: 'front',
      polyBudget: 200,
      brushDensity: 20,
      strokeMode: 'hair-paths',
      rdpTolerance: 2,
      closeThreshold: 12,
      defaultDepth: 0,
      color: 0xaa6633,
      extrudeAmount: 28,
    })
    const hairStrip = vectorPathToMesh(path, {
      view: 'front',
      polyBudget: 128,
      brushDensity: 12,
      strokeMode: 'hair-strips',
      rdpTolerance: 2,
      closeThreshold: 12,
      defaultDepth: 0,
      color: 0xaa6633,
      extrudeAmount: 12,
    })
    expect(hairPath?.name).toBe('Hair Paths')
    expect(hairStrip?.name).toBe('Hair Strips')
    expect(hairPath?.sketchSource?.kind).toBe('hair-path')
    expect(hairStrip?.sketchSource?.kind).toBe('hair-strip')
    expect(hairPathDense!.positions.length).toBeGreaterThan(hairPath!.positions.length)
    expect(xySpan(hairPathDense!.positions)).toBeGreaterThan(xySpan(hairPath!.positions))
    expect(zExtent(hairPathDense!.positions)).toBeGreaterThan(zExtent(hairPath!.positions))
    expect(zExtent(hairStrip!.positions)).toBeLessThan(1e-4)
    expect(hairPath?.sketchSource?.extrudeDepth).toBe(10)
    expect(hairPathDense?.sketchSource?.polyBudget).toBe(200)
    expect(hairStrip?.sketchSource?.extrudeDepth).toBe(0)
  })
})

describe('hair topology: paths vs strips vs rounded', () => {
  it('Hair Paths is a prism ribbon (quads only, no tip fans)', () => {
    const obj = strokeToMesh({ ...base, strokeMode: 'hair-paths' })!
    expect(obj.sketchSource?.kind).toBe('hair-path')
    expect(obj.name).toBe('Hair Paths')
    // Prism ribbon: every face is a quad (front/back/sides/tip caps).
    expect(obj.faces.every((f) => f.length === 4)).toBe(true)
    expect(obj.faces.some((f) => f.length === 3)).toBe(false)
    // Cross-section is a thin card, not a circular ring of 6–8 verts.
    // 4 verts per lengthwise sample (LF/RF/LB/RB).
    const samples = obj.positions.length / 4
    expect(Number.isInteger(samples)).toBe(true)
    expect(samples).toBeGreaterThan(2)
  })

  it('Hair Strips stay flat double-sided cards', () => {
    const obj = strokeToMesh({ ...base, strokeMode: 'hair-strips', extrudeAmount: 40 })!
    expect(obj.sketchSource?.kind).toBe('hair-strip')
    expect(zExtent(obj.positions)).toBeLessThan(1e-4)
    expect(obj.faces.every((f) => f.length === 4)).toBe(true)
  })

  it('Rounded Hair is a tapered tube with pointed tip fans', () => {
    const obj = strokeToMesh({ ...base, strokeMode: 'hair-round' })!
    expect(obj.name).toBe('Rounded Hair')
    expect(obj.sketchSource?.kind).toBe('hair-round')
    const tris = obj.faces.filter((f) => f.length === 3)
    const quads = obj.faces.filter((f) => f.length === 4)
    // Needle tips use triangle fans; body is quad rings.
    expect(tris.length).toBeGreaterThan(0)
    expect(quads.length).toBeGreaterThan(0)
    // Not a flat ribbon — has real volume in more than one axis beyond a thin card.
    expect(zExtent(obj.positions)).toBeGreaterThan(2)
    // Tip poles collapse near the stroke ends (radius ~0).
    expect(obj.uvs?.length).toBeGreaterThan(0)
  })

  it('Hair Paths stays a ribbon even when Rounded Hair exists', () => {
    const paths = strokeToMesh({ ...base, strokeMode: 'hair-paths' })!
    const round = strokeToMesh({ ...base, strokeMode: 'hair-round' })!
    expect(paths.faces.every((f) => f.length === 4)).toBe(true)
    expect(round.faces.some((f) => f.length === 3)).toBe(true)
    expect(paths.sketchSource?.kind).toBe('hair-path')
    expect(round.sketchSource?.kind).toBe('hair-round')
  })
})

describe('hair tip style: pointed vs square', () => {
  it('defaults to pointed and stores tipStyle on sketch source', () => {
    const obj = strokeToMesh({ ...base, strokeMode: 'hair-paths' })!
    expect(obj.sketchSource?.tipStyle).toBe('pointed')
  })

  it('square Hair Paths keep wider tip ends than pointed', () => {
    const pointed = strokeToMesh({
      ...base,
      strokeMode: 'hair-paths',
      hairTipStyle: 'pointed',
    })!
    const square = strokeToMesh({
      ...base,
      strokeMode: 'hair-paths',
      hairTipStyle: 'square',
    })!
    expect(square.sketchSource?.tipStyle).toBe('square')
    expect(xySpan(square.positions)).toBeGreaterThan(xySpan(pointed.positions))
  })

  it('square Hair Strips stay flat with full-width tips', () => {
    const pointed = strokeToMesh({
      ...base,
      strokeMode: 'hair-strips',
      hairTipStyle: 'pointed',
    })!
    const square = strokeToMesh({
      ...base,
      strokeMode: 'hair-strips',
      hairTipStyle: 'square',
    })!
    expect(zExtent(square.positions)).toBeLessThan(1e-4)
    expect(xySpan(square.positions)).toBeGreaterThan(xySpan(pointed.positions))
    expect(square.sketchSource?.tipStyle).toBe('square')
  })

  it('square Rounded Hair uses flat disk caps instead of tip fans', () => {
    const pointed = strokeToMesh({
      ...base,
      strokeMode: 'hair-round',
      hairTipStyle: 'pointed',
    })!
    const square = strokeToMesh({
      ...base,
      strokeMode: 'hair-round',
      hairTipStyle: 'square',
    })!
    expect(pointed.faces.some((f) => f.length === 3)).toBe(true)
    expect(square.faces.some((f) => f.length === 3)).toBe(false)
    expect(square.faces.some((f) => f.length > 4)).toBe(true)
    expect(square.sketchSource?.tipStyle).toBe('square')
  })

  it('regenerate preserves tipStyle', () => {
    const original = strokeToMesh({
      ...base,
      strokeMode: 'hair-paths',
      hairTipStyle: 'square',
      brushDensity: 8,
    })!
    const regen = regenerateSketchObjectFromSource(original, { brushDensity: 20 })
    expect(regen?.sketchSource?.tipStyle).toBe('square')
    expect(xySpan(regen!.positions)).toBeGreaterThan(xySpan(original.positions))
  })

  it('vector pen honors hairTipStyle for all hair modes', () => {
    const path: VectorPath = {
      id: 'p-tip',
      view: 'front',
      closed: false,
      color: 0xaa6633,
      source: 'pen',
      anchors: wavy.map((p, i) => ({
        id: `a${i}`,
        position: p,
        inHandle: null,
        outHandle: null,
      })),
    }
    const opts = {
      view: 'front' as const,
      polyBudget: 128,
      brushDensity: 12,
      rdpTolerance: 2,
      closeThreshold: 12,
      defaultDepth: 0,
      color: 0xaa6633,
      extrudeAmount: 16,
      hairTipStyle: 'square' as const,
    }
    const paths = vectorPathToMesh(path, { ...opts, strokeMode: 'hair-paths' })!
    const strips = vectorPathToMesh(path, { ...opts, strokeMode: 'hair-strips' })!
    const round = vectorPathToMesh(path, { ...opts, strokeMode: 'hair-round' })!
    expect(paths.sketchSource?.tipStyle).toBe('square')
    expect(strips.sketchSource?.tipStyle).toBe('square')
    expect(round.sketchSource?.tipStyle).toBe('square')
    expect(round.faces.some((f) => f.length === 3)).toBe(false)
  })
})
