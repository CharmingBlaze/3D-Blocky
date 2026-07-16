import { describe, expect, it } from 'vitest'
import type { PolyDrawDraftPoint } from '../store/appStore'
import type { OrthoViewType } from '../scene/viewTypes'
import { planePointToWorld, VIEW_AXIS_TABLE } from '../primitives/viewAxes'
import { commitPolyDrawFace } from './polyDrawCommit'

function faceNormal(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
  c: { x: number; y: number; z: number }
) {
  const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }
  const ac = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z }
  return {
    x: ab.y * ac.z - ab.z * ac.y,
    y: ab.z * ac.x - ab.x * ac.z,
    z: ab.x * ac.y - ab.y * ac.x,
  }
}

describe('poly draw face winding', () => {
  it.each(['front', 'back', 'left', 'right', 'top', 'bottom'] as OrthoViewType[])(
    'orients a clockwise %s-view quad toward its drawing camera',
    (view) => {
      const points: PolyDrawDraftPoint[] = [
        [-1, 1],
        [1, 1],
        [1, -1],
        [-1, -1],
      ].map(([x, y]) => ({ world: planePointToWorld(view, x!, y!, 0) }))

      const result = commitPolyDrawFace(points, [], {
        mode: 'quad',
        color: 0xffffff,
        view,
      })
      expect(result).not.toBeNull()
      const object = result!.objects.find((candidate) => candidate.id === result!.primaryId)!
      const face = object.faces[0]!
      const normal = faceNormal(
        object.positions[face[0]!]!,
        object.positions[face[1]!]!,
        object.positions[face[2]!]!
      )
      const mapping = VIEW_AXIS_TABLE[view]
      const facing = [0, 0, 0]
      facing[mapping.d] = mapping.dSign
      expect(normal.x * facing[0]! + normal.y * facing[1]! + normal.z * facing[2]!).toBeGreaterThan(0)
    }
  )

  it.each([
    ['triangle', [[-1, 1], [1, 1], [0, -1]]],
    ['quad', [[-1, 1], [1, 1], [1, -1], [-1, -1]]],
    ['poly', [[-1, 1], [1, 1], [1.2, 0], [0, -1.2], [-1.2, 0]]],
  ] as const)('orients %s faces toward the front drawing view', (mode, planePoints) => {
    const points: PolyDrawDraftPoint[] = planePoints.map(([x, y]) => ({
      world: planePointToWorld('front', x, y, 0),
    }))
    const result = commitPolyDrawFace(points, [], { mode, color: 0xffffff, view: 'front' })
    expect(result).not.toBeNull()
    const object = result!.objects.find((candidate) => candidate.id === result!.primaryId)!
    for (const face of object.faces) {
      const normal = faceNormal(
        object.positions[face[0]!]!,
        object.positions[face[1]!]!,
        object.positions[face[2]!]!
      )
      expect(normal.z).toBeGreaterThan(0)
    }
  })
})
