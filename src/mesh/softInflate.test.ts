import { describe, expect, it } from 'vitest'
import { generateSoftInflateDome } from './softInflate'

describe('generateSoftInflateDome', () => {
  it('uses compact triangle fans behind quad transition rings', () => {
    const polygon = [
      { x: -10, y: -8 },
      { x: 8, y: -9 },
      { x: 12, y: 2 },
      { x: 5, y: 10 },
      { x: -9, y: 7 },
    ]
    const mesh = generateSoftInflateDome(polygon, { depth: 12, rings: 6, inflation: 0.65 })
    const quads = mesh.faces.filter((face) => face.length === 4)
    const triangles = mesh.faces.filter((face) => face.length === 3)

    expect(quads.length).toBeGreaterThanOrEqual(polygon.length * 2)
    expect(triangles).toHaveLength(polygon.length * 2)

    const centerVertices = mesh.positions.slice(-2)
    expect(centerVertices[0]!.x).toBeCloseTo(centerVertices[1]!.x)
    expect(centerVertices[0]!.y).toBeCloseTo(centerVertices[1]!.y)
    expect(centerVertices[0]!.z).toBeCloseTo(-6)
    expect(centerVertices[1]!.z).toBeCloseTo(6)
  })
})
