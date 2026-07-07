import { describe, expect, it } from 'vitest'
import { roundedBoxFromWorldBox, shellToRoundedBox } from './roundedBox'
import type { WorldBox } from '../primitives/primitiveBoxMath'

const TEST_BOX: WorldBox = {
  min: { x: -5, y: 0, z: -3 },
  max: { x: 5, y: 8, z: 3 },
}

const CUBE: WorldBox = {
  min: { x: -5, y: -5, z: -5 },
  max: { x: 5, y: 5, z: 5 },
}

describe('shellToRoundedBox', () => {
  it('gives every corner the same fillet radius on a cube', () => {
    const hx = 5
    const r = 1
    const radii: number[] = []
    for (const sx of [-1, 1] as const) {
      for (const sy of [-1, 1] as const) {
        for (const sz of [-1, 1] as const) {
          const shell = { x: sx * hx, y: sy * hx, z: sz * hx }
          const surf = shellToRoundedBox(shell, hx, hx, hx, r)
          const cx = sx * (hx - r)
          const cy = sy * (hx - r)
          const cz = sz * (hx - r)
          radii.push(Math.hypot(surf.x - cx, surf.y - cy, surf.z - cz))
        }
      }
    }
    expect(radii.every((d) => Math.abs(d - r) < 1e-4)).toBe(true)
  })

  it('keeps face centers flat instead of pulling them to a hub', () => {
    const surf = shellToRoundedBox({ x: 5, y: 0, z: 0 }, 5, 5, 5, 1)
    expect(surf.x).toBeCloseTo(5, 4)
    expect(surf.y).toBeCloseTo(0, 4)
    expect(surf.z).toBeCloseTo(0, 4)
  })
})

describe('roundedBoxFromWorldBox', () => {
  it('subdivides enough for roundness so the mesh is not corner-only', () => {
    const boxOnly = roundedBoxFromWorldBox(TEST_BOX, 0xff00ff, { roundness: 0, subdivisions: 0 }, 128)
    const rounded = roundedBoxFromWorldBox(TEST_BOX, 0xff00ff, { roundness: 0.25, subdivisions: 2 }, 128)
    expect(boxOnly.positions.length).toBeLessThan(20)
    expect(rounded.positions.length).toBeGreaterThan(40)
  })

  it('keeps a box-like front silhouette instead of a spiky diamond', () => {
    const obj = roundedBoxFromWorldBox(TEST_BOX, 0xff00ff, { roundness: 0.25, subdivisions: 2 }, 128)
    const midY = 4
    const band = obj.positions.filter((p) => Math.abs(p.y - midY) < 2)
    expect(band.length).toBeGreaterThan(4)

    const minX = Math.min(...band.map((p) => p.x))
    const maxX = Math.max(...band.map((p) => p.x))
    const centerVerts = band.filter((p) => Math.abs(p.x) < 1.5)
    expect(centerVerts.length).toBeGreaterThan(0)
    expect(maxX - minX).toBeGreaterThan(6)
  })

  it('produces matching corner fillets on a cube mesh', () => {
    const obj = roundedBoxFromWorldBox(CUBE, 0xff00ff, { roundness: 0.25, subdivisions: 2 }, 128)
    const hx = 5
    const r = 0.25 * hx * 0.98
    const radii: number[] = []
    for (const sx of [-1, 1] as const) {
      for (const sy of [-1, 1] as const) {
        for (const sz of [-1, 1] as const) {
          const cx = sx * (hx - r)
          const cy = sy * (hx - r)
          const cz = sz * (hx - r)
          let best = Infinity
          let bestDist = 0
          for (const p of obj.positions) {
            const d = Math.hypot(p.x - sx * hx, p.y - sy * hx, p.z - sz * hx)
            if (d < best) {
              best = d
              bestDist = Math.hypot(p.x - cx, p.y - cy, p.z - cz)
            }
          }
          radii.push(bestDist)
        }
      }
    }
    const avg = radii.reduce((a, b) => a + b, 0) / radii.length
    expect(radii.every((d) => Math.abs(d - avg) < 0.15)).toBe(true)
  })
})
