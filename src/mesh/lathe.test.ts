import { describe, expect, it } from 'vitest'
import { generateLathe } from '../mesh/lathe'

describe('generateLathe caps', () => {
  const cylinderProfile = [
    { x: 10, y: 0 },
    { x: 10, y: 40 },
  ]

  it('leaves ends open when caps are disabled', () => {
    const mesh = generateLathe(cylinderProfile, {
      radialSegments: 6,
      preserveProfile: true,
      capTop: false,
      capBottom: false,
    })
    expect(mesh.faces.length).toBe(12)
  })

  it('adds top and bottom caps when enabled', () => {
    const mesh = generateLathe(cylinderProfile, {
      radialSegments: 6,
      preserveProfile: true,
      capTop: true,
      capBottom: true,
    })
    expect(mesh.faces.length).toBe(24)
  })
})
