import { describe, expect, it } from 'vitest'
import {
  appendFaceFromVertexIndices,
  faceNewellNormal,
  orientFaceWindingOutward,
} from './meshEdit'
import { primitiveBoxToSceneObject } from '../primitives/primitiveBoxCommit'
import { heightAxisForView } from '../primitives/viewAxes'

function makeBox() {
  return primitiveBoxToSceneObject(
    'box',
    { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } },
    heightAxisForView('front'),
    0xffffff,
    64
  )!
}

describe('appendFaceFromVertexIndices', () => {
  it('orients a filled face outward even if selection winding faces inward', () => {
    const box = makeBox()
    // Front face at z=+1 (quad). Delete it, then recreate with inverted winding.
    const frontFi = box.faces.findIndex((f) => {
      const zs = f.map((vi) => box.positions[vi]!.z)
      return zs.every((z) => Math.abs(z - 1) < 1e-6)
    })
    expect(frontFi).toBeGreaterThanOrEqual(0)
    const removed = box.faces[frontFi]!
    const open: typeof box = {
      ...box,
      faces: box.faces.filter((_, i) => i !== frontFi),
      faceColors: box.faceColors.filter((_, i) => i !== frontFi),
      faceGroups: box.faceGroups?.filter((_, i) => i !== frontFi),
    }

    // Deliberately reverse selection order (would face inward).
    const inverted = [...removed].reverse()
    const result = appendFaceFromVertexIndices(open, inverted, 0xff00ff)
    expect(result).not.toBeNull()

    const face = result!.object.faces[result!.newFaceStartIndex]!
    const n = faceNewellNormal(result!.object.positions, face)
    // Front face normal should point +Z (outward).
    expect(n.z).toBeGreaterThan(0.5)
  })

  it('flips when selection shares the same edge direction as a neighbor', () => {
    const positions = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 1, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 0, z: 1 },
    ]
    // Existing face uses edge 0→1
    const existing = [[0, 1, 4]]
    // New face also wants 0→1→2→3 (same dir on 0-1) → should reverse
    const oriented = orientFaceWindingOutward(positions, existing, [0, 1, 2, 3])
    expect(oriented[0]).toBe(3)
    expect(oriented[oriented.length - 1]).toBe(0)
  })
})
