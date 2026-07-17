import { describe, expect, it } from 'vitest'
import { generateCapsuleSweep, generateTaperedPointedTube, tubeTaperScale } from './extrusion'
import { LOW_POLY_CAPSULE_HEMI_RINGS } from '../primitives/capsuleMesh'

const straight: { x: number; y: number }[] = [
  { x: 0, y: 0 },
  { x: 40, y: 0 },
  { x: 80, y: 0 },
]

const bend: { x: number; y: number }[] = []
for (let i = 0; i <= 16; i++) {
  const t = i / 16
  bend.push({ x: t * 60, y: Math.sin(t * Math.PI) * 20 })
}

describe('generateCapsuleSweep topology', () => {
  it('Path-style sweep stores quad rings and flat n-gon caps (no tris / needle tips)', () => {
    const mesh = generateCapsuleSweep(straight, {
      radius: 6,
      radialSegments: 8,
      minAngleDeg: 20,
      closed: false,
      hemiRings: 0,
      color: 0xff0000,
    })

    expect(mesh.faces.length).toBeGreaterThan(0)
    const quads = mesh.faces.filter((f) => f.length === 4)
    const caps = mesh.faces.filter((f) => f.length > 4)
    const tris = mesh.faces.filter((f) => f.length === 3)

    expect(tris.length).toBe(0)
    expect(caps.length).toBe(2)
    expect(caps.every((f) => f.length === 8)).toBe(true)
    // Side walls only — every non-cap face is a quad ring segment.
    expect(quads.length).toBe(mesh.faces.length - 2)
    expect(quads.length).toBeGreaterThan(0)
  })

  it('bent Path tube keeps only quads + two flat caps', () => {
    const mesh = generateCapsuleSweep(bend, {
      radius: 5,
      radialSegments: 8,
      minAngleDeg: 12,
      closed: false,
      hemiRings: 0,
    })

    expect(mesh.faces.filter((f) => f.length === 3).length).toBe(0)
    expect(mesh.faces.filter((f) => f.length > 4).length).toBe(2)
    expect(mesh.faces.every((f) => f.length === 4 || f.length > 4)).toBe(true)
  })

  it('preserveSpine keeps dense rings on a gentle curve (no 14° collapse)', () => {
    const sine: { x: number; y: number }[] = []
    for (let i = 0; i <= 48; i++) {
      const t = i / 48
      sine.push({ x: t * 100, y: Math.sin(t * Math.PI * 2) * 25 })
    }

    const crushed = generateCapsuleSweep(sine, {
      radius: 5,
      radialSegments: 8,
      minAngleDeg: 14,
      hemiRings: 0,
    })
    const faithful = generateCapsuleSweep(sine, {
      radius: 5,
      radialSegments: 8,
      hemiRings: 0,
      preserveSpine: true,
    })

    const crushedRings = crushed.faces.filter((f) => f.length === 4).length / 8 + 1
    const faithfulRings = faithful.faces.filter((f) => f.length === 4).length / 8 + 1

    // Angle sampling collapses a smooth sine to ~2 samples; preserveSpine keeps the path.
    expect(crushedRings).toBeLessThan(6)
    expect(faithfulRings).toBeGreaterThanOrEqual(40)
    expect(faithful.faces.filter((f) => f.length === 3).length).toBe(0)
    expect(faithful.faces.filter((f) => f.length > 4).length).toBe(2)
  })

  it('Capsule-style hemi caps still available when hemiRings > 0', () => {
    const mesh = generateCapsuleSweep(straight, {
      radius: 6,
      radialSegments: 8,
      minAngleDeg: 20,
      closed: false,
      hemiRings: LOW_POLY_CAPSULE_HEMI_RINGS,
    })

    // Hemisphere still uses a pole fan (tris) at each tip.
    expect(mesh.faces.some((f) => f.length === 3)).toBe(true)
    expect(mesh.faces.some((f) => f.length === 4)).toBe(true)
  })

  it('orders round-cap rings from each pole toward the body without folding', () => {
    const segments = 8
    const radius = 6
    const mesh = generateCapsuleSweep(
      [{ x: 0, y: 0 }, { x: 40, y: 0 }],
      {
        radius,
        radialSegments: segments,
        closed: false,
        startCap: 'round',
        endCap: 'round',
        preserveSpine: true,
      }
    )

    // Two body rings are emitted first, followed by the start pole and its
    // four intermediate rings (roundRings = ceil(8 * 0.6) = 5).
    const startPoleIndex = segments * 2
    const orderedCenters = [mesh.positions[startPoleIndex]!.x]
    for (let ring = 0; ring < 4; ring++) {
      const first = startPoleIndex + 1 + ring * segments
      let centerX = 0
      for (let i = 0; i < segments; i++) centerX += mesh.positions[first + i]!.x
      orderedCenters.push(centerX / segments)
    }
    orderedCenters.push(0) // start body-ring center

    for (let i = 1; i < orderedCenters.length; i++) {
      expect(orderedCenters[i]!).toBeGreaterThan(orderedCenters[i - 1]!)
    }
  })

  it('tapered pointed tube pinches to tip poles (not flat disk caps)', () => {
    expect(tubeTaperScale(0)).toBeCloseTo(0, 5)
    expect(tubeTaperScale(1)).toBeCloseTo(0, 5)
    expect(tubeTaperScale(0.5)).toBe(1)

    const mesh = generateTaperedPointedTube(straight, {
      radius: 6,
      radialSegments: 8,
      preserveSpine: true,
      color: 0xff00aa,
    })
    const tris = mesh.faces.filter((f) => f.length === 3)
    const quads = mesh.faces.filter((f) => f.length === 4)
    const flatCaps = mesh.faces.filter((f) => f.length > 4)
    expect(flatCaps.length).toBe(0)
    expect(tris.length).toBe(16) // 8 + 8 tip fans
    expect(quads.length).toBeGreaterThan(0)
    expect(mesh.uvs.length).toBeGreaterThan(0)
    expect(mesh.faceUvIndices.length).toBe(mesh.faces.length)
  })

  it('square tip tube keeps full radius with flat disk caps (no needle poles)', () => {
    const mesh = generateTaperedPointedTube(straight, {
      radius: 6,
      radialSegments: 8,
      preserveSpine: true,
      tipStyle: 'square',
      color: 0xff00aa,
    })
    const tris = mesh.faces.filter((f) => f.length === 3)
    const flatCaps = mesh.faces.filter((f) => f.length > 4)
    expect(tris.length).toBe(0)
    expect(flatCaps.length).toBe(2)
    expect(flatCaps.every((f) => f.length === 8)).toBe(true)
    expect(mesh.uvs.length).toBeGreaterThan(0)
    expect(mesh.faceUvIndices.length).toBe(mesh.faces.length)
    // No collapsed tip poles — only ring verts along the spine.
    expect(mesh.positions.length % 8).toBe(0)
  })
})
