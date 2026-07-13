import { describe, expect, it } from 'vitest'
import {
  generateHairRibbon,
  hairTaperFactor,
  resolveHairDepth,
  strokeToTaperedRibbon,
} from './hairRibbon'
import { countNakedEdges, meshSignedVolume } from './meshWinding'

const arc = [
  { x: 0, y: 0 },
  { x: 20, y: 10 },
  { x: 40, y: 5 },
  { x: 60, y: 18 },
  { x: 80, y: 8 },
]

describe('hairRibbon', () => {
  it('taper factor pinches both ends and peaks in the middle', () => {
    expect(hairTaperFactor(0)).toBeCloseTo(0, 5)
    expect(hairTaperFactor(1)).toBeCloseTo(0, 5)
    expect(hairTaperFactor(0.5)).toBe(1)
    expect(hairTaperFactor(0.1)).toBeGreaterThan(0)
    expect(hairTaperFactor(0.1)).toBeLessThan(1)
  })

  it('tapered ribbon tip half-widths approach zero', () => {
    const ribbon = strokeToTaperedRibbon(arc, 10, 0.35)
    expect(ribbon).not.toBeNull()
    const maxW = Math.max(...ribbon!.halfWidths)
    expect(ribbon!.halfWidths[0]!).toBeLessThan(maxW * 0.05)
    expect(ribbon!.halfWidths[ribbon!.halfWidths.length - 1]!).toBeLessThan(maxW * 0.05)
    expect(maxW).toBeCloseTo(10, 5)
  })

  it('square tip style keeps full half-width to both ends', () => {
    const ribbon = strokeToTaperedRibbon(arc, 10, 0.35, 'square')
    expect(ribbon).not.toBeNull()
    expect(ribbon!.halfWidths[0]!).toBeCloseTo(10, 5)
    expect(ribbon!.halfWidths[ribbon!.halfWidths.length - 1]!).toBeCloseTo(10, 5)
    expect(Math.min(...ribbon!.halfWidths)).toBeCloseTo(10, 5)
  })

  it('square tip ribbon mesh stays full width at tip caps', () => {
    const pointed = generateHairRibbon(arc, { halfWidth: 8, depth: 2, tipStyle: 'pointed' })
    const square = generateHairRibbon(arc, { halfWidth: 8, depth: 2, tipStyle: 'square' })
    // Tip cross-section: first 4 verts (LF/RF/LB/RB). Square tips are wider in XY.
    const tipSpan = (mesh: ReturnType<typeof generateHairRibbon>) => {
      const xs = mesh.positions.slice(0, 4).map((p) => p.x)
      const ys = mesh.positions.slice(0, 4).map((p) => p.y)
      return Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
    }
    expect(tipSpan(square)).toBeGreaterThan(tipSpan(pointed) * 4)
    expect(countNakedEdges(square)).toBe(0)
  })

  it('builds a closed quad ribbon with hair-card UVs', () => {
    const mesh = generateHairRibbon(arc, { halfWidth: 8, depth: 2, color: 0xff00aa })
    expect(mesh.positions.length).toBeGreaterThan(0)
    expect(mesh.faces.length).toBeGreaterThan(0)
    expect(mesh.faces.every((f) => f.length === 4)).toBe(true)
    expect(mesh.uvs.length).toBeGreaterThan(0)
    expect(mesh.faceUvIndices.length).toBe(mesh.faces.length)
    expect(countNakedEdges(mesh)).toBe(0)
    expect(meshSignedVolume(mesh)).toBeGreaterThan(0)

    // U spans length: some UVs near 0 and near 1
    const us = mesh.uvs.map((uv) => uv.u)
    expect(Math.min(...us)).toBeLessThan(0.05)
    expect(Math.max(...us)).toBeGreaterThan(0.95)
  })

  it('depth magnitude controls card thickness; negative depth flips Z', () => {
    const pos = generateHairRibbon(arc, { halfWidth: 6, depth: 10 })
    const neg = generateHairRibbon(arc, { halfWidth: 6, depth: -10 })
    const zsPos = pos.positions.map((p) => p.z)
    const zsNeg = neg.positions.map((p) => p.z)
    expect(Math.max(...zsPos) - Math.min(...zsPos)).toBeCloseTo(10, 5)
    expect(Math.max(...zsNeg) - Math.min(...zsNeg)).toBeCloseTo(10, 5)
    // First cross-section LF is pushed to +half / −half when depth sign flips.
    expect(pos.positions[0]!.z).toBeCloseTo(5, 5)
    expect(neg.positions[0]!.z).toBeCloseTo(-5, 5)
    expect(meshSignedVolume(pos)).toBeGreaterThan(0)
    expect(meshSignedVolume(neg)).toBeGreaterThan(0)
  })

  it('resolveHairDepth prefers Extrude depth over brush fallback for paths', () => {
    expect(resolveHairDepth(16, 12, 'path')).toBe(16)
    expect(resolveHairDepth(-15, 12, 'path')).toBe(-15)
    expect(resolveHairDepth(undefined, 12, 'path')).toBeGreaterThan(0)
  })

  it('Hair Strips are flat double-sided cards; Extrude depth is ignored', () => {
    expect(resolveHairDepth(16, 12, 'strip')).toBe(0)
    expect(resolveHairDepth(-24, 12, 'strip')).toBe(0)
    expect(resolveHairDepth(undefined, 12, 'strip')).toBe(0)

    const mesh = generateHairRibbon(arc, {
      halfWidth: 8,
      depth: 20,
      flat: true,
      color: 0xff00aa,
    })
    const zs = mesh.positions.map((p) => p.z)
    expect(Math.max(...zs) - Math.min(...zs)).toBeLessThan(1e-6)
    expect(mesh.positions.every((p) => Math.abs(p.z) < 1e-6)).toBe(true)
    expect(mesh.faces.every((f) => f.length === 4)).toBe(true)
    // One front + one back quad per segment
    expect(mesh.faces.length).toBe((arc.length - 1) * 2)
    expect(mesh.uvs.length).toBeGreaterThan(0)
    expect(mesh.faceUvIndices.length).toBe(mesh.faces.length)
    expect(countNakedEdges(mesh)).toBe(0)

    const us = mesh.uvs.map((uv) => uv.u)
    expect(Math.min(...us)).toBeLessThan(0.05)
    expect(Math.max(...us)).toBeGreaterThan(0.95)
  })
})
