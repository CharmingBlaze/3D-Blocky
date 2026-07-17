import { describe, expect, it } from 'vitest'
import { generateVerticalShapedCapsule } from './verticalCapsule'
import { capsuleProfileRingsForBudget, capsuleRadialSegments } from '../stroke/sketchSource'

/** Axis-aligned stadium (capsule silhouette): semicircle caps + straight sides. */
function stadiumBoundary(cx: number, cy: number, radius: number, bodyLen: number, segs = 24) {
  const pts: { x: number; y: number }[] = []
  const y0 = cy - bodyLen / 2
  const y1 = cy + bodyLen / 2
  for (let i = 0; i <= segs; i++) {
    const a = Math.PI + (i / segs) * Math.PI
    pts.push({ x: cx + Math.cos(a) * radius, y: y0 + Math.sin(a) * radius })
  }
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI
    pts.push({ x: cx + Math.cos(a) * radius, y: y1 + Math.sin(a) * radius })
  }
  return pts
}

function diamondBoundary(cx: number, cy: number, halfW: number, halfH: number) {
  return [
    { x: cx, y: cy - halfH },
    { x: cx + halfW, y: cy },
    { x: cx, y: cy + halfH },
    { x: cx - halfW, y: cy },
  ]
}

function ringYs(mesh: ReturnType<typeof generateVerticalShapedCapsule>) {
  const ys = new Set<number>()
  for (const p of mesh.positions) ys.add(Math.round(p.y * 1000) / 1000)
  return [...ys].sort((a, b) => a - b)
}

function ringRadii(mesh: ReturnType<typeof generateVerticalShapedCapsule>) {
  const byY = new Map<number, { x: number; z: number }[]>()
  for (const p of mesh.positions) {
    const key = Math.round(p.y * 1000) / 1000
    const list = byY.get(key) ?? []
    list.push({ x: p.x, z: p.z })
    byY.set(key, list)
  }
  return [...byY.entries()]
    .map(([y, pts]) => {
      if (pts.length < 3) return { y, radius: 0, isPole: true }
      const mx = pts.reduce((s, p) => s + p.x, 0) / pts.length
      const mz = pts.reduce((s, p) => s + p.z, 0) / pts.length
      const radius = pts.reduce((s, p) => s + Math.hypot(p.x - mx, p.z - mz), 0) / pts.length
      return { y, radius, isPole: false }
    })
    .sort((a, b) => a.y - b.y)
}

describe('generateVerticalShapedCapsule', () => {
  it('gently follows silhouette width while retaining a rounded capsule profile', () => {
    const boundary = [
      { x: -6, y: -30 },
      { x: 6, y: -30 },
      { x: 10, y: -12 },
      { x: 15, y: 12 },
      { x: 9, y: 30 },
      { x: -9, y: 30 },
      { x: -15, y: 12 },
      { x: -10, y: -12 },
    ]
    const ideal = generateVerticalShapedCapsule(boundary, {
      radialSegments: 12,
      profileRings: 12,
      preserveBoundary: true,
      silhouetteInfluence: 0,
    })
    const shaped = generateVerticalShapedCapsule(boundary, {
      radialSegments: 12,
      profileRings: 12,
      preserveBoundary: true,
      silhouetteInfluence: 0.3,
    })

    const idealRings = ringRadii(ideal).filter((ring) => !ring.isPole)
    const shapedRings = ringRadii(shaped).filter((ring) => !ring.isPole)
    expect(shapedRings).toHaveLength(idealRings.length)
    expect(
      shapedRings.some((ring, index) => Math.abs(ring.radius - idealRings[index]!.radius) > 0.1)
    ).toBe(true)
    for (let i = 0; i < shapedRings.length; i++) {
      const ratio = shapedRings[i]!.radius / idealRings[i]!.radius
      expect(ratio).toBeGreaterThan(0.85)
      expect(ratio).toBeLessThan(1.15)
    }
  })

  it('orders meridian rings from bottom pole to top pole without folding the top cap', () => {
    const segments = 10
    const mesh = generateVerticalShapedCapsule(
      stadiumBoundary(0, 0, 9, 38),
      {
        radialSegments: segments,
        profileRings: 10,
        preserveBoundary: true,
      }
    )

    // Vertex layout is bottom pole, complete rings, top pole.
    const orderedYs = [mesh.positions[0]!.y]
    for (let index = 1; index < mesh.positions.length - 1; index += segments) {
      orderedYs.push(mesh.positions[index]!.y)
    }
    orderedYs.push(mesh.positions[mesh.positions.length - 1]!.y)

    for (let i = 1; i < orderedYs.length; i++) {
      expect(orderedYs[i]!).toBeGreaterThan(orderedYs[i - 1]!)
    }
  })

  it('spaces rings evenly instead of packing the equator', () => {
    const boundary = stadiumBoundary(0, 0, 10, 40)
    const mesh = generateVerticalShapedCapsule(boundary, {
      radialSegments: 8,
      profileRings: 10,
      preserveBoundary: true,
    })
    const ys = ringYs(mesh)
    // poles + evenly spaced rings
    expect(ys.length).toBeGreaterThan(6)
    expect(ys.length).toBeLessThan(22)

    const gaps: number[] = []
    for (let i = 1; i < ys.length; i++) gaps.push(ys[i]! - ys[i - 1]!)
    const mean = gaps.reduce((s, g) => s + g, 0) / gaps.length
    const maxGap = Math.max(...gaps)
    const minGap = Math.min(...gaps)
    // No huge equator cluster / sparse pole gaps (allow hemi foreshortening in Y).
    expect(maxGap / mean).toBeLessThan(2.4)
    expect(minGap / mean).toBeGreaterThan(0.25)
  })

  it('keeps round tip rings on pointed diamond silhouettes', () => {
    const boundary = diamondBoundary(0, 0, 12, 40)
    const mesh = generateVerticalShapedCapsule(boundary, {
      radialSegments: 8,
      profileRings: 10,
      preserveBoundary: true,
    })
    const rings = ringRadii(mesh).filter((r) => !r.isPole)
    const maxBody = Math.max(...rings.map((r) => r.radius))
    expect(rings[0]!.radius).toBeGreaterThan(maxBody * 0.35)
    expect(rings[rings.length - 1]!.radius).toBeGreaterThan(maxBody * 0.35)
    expect(Math.max(...rings.slice(0, 3).map((r) => r.radius))).toBeGreaterThan(maxBody * 0.65)
  })

  it('stays low-poly under the default sketch budget mapping', () => {
    const boundary = stadiumBoundary(0, 0, 8, 36)
    const rings = capsuleProfileRingsForBudget(128)
    const radial = capsuleRadialSegments(8)
    expect(rings).toBeGreaterThanOrEqual(10)
    expect(radial).toBeGreaterThanOrEqual(12)
    const mesh = generateVerticalShapedCapsule(boundary, {
      radialSegments: radial,
      profileRings: rings,
      preserveBoundary: true,
    })
    expect(rings).toBeLessThanOrEqual(16)
    expect(mesh.positions.length).toBeLessThan(340)
  })
})
