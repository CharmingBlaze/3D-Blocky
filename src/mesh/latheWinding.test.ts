import { describe, expect, it } from 'vitest'
import { generateLathe } from './lathe'
import { meshFacesPointAwayFrom, orientLatheMeshOutward } from './meshWinding'
import {
  LATHE_RADIAL_SEGMENTS,
  latheRevolutionAxis,
  strokeToLatheProfile,
} from '../stroke/latheProfile'
import { offsetMeshInPlane, projectMeshToView } from '../stroke/worldProjection'
import type { ViewType } from '../scene/viewTypes'

const VIEWS: ViewType[] = ['front', 'back', 'left', 'right', 'top', 'bottom']

function buildLatheInView(
  view: ViewType,
  stroke: { x: number; y: number }[],
  caps: boolean
) {
  const lathe = strokeToLatheProfile(stroke)!
  const mesh = generateLathe(lathe.profile, {
    radialSegments: LATHE_RADIAL_SEGMENTS,
    preserveProfile: true,
    capTop: caps,
    capBottom: caps,
    axis: 'y',
  })
  const depth = 0
  offsetMeshInPlane(mesh, lathe.axisH, 0)
  projectMeshToView(mesh, view, depth)
  orientLatheMeshOutward(mesh, view, lathe.axisH, depth)
  const { origin, direction } = latheRevolutionAxis(view, lathe.axisH, depth)
  let tMin = Infinity
  let tMax = -Infinity
  for (const p of mesh.positions) {
    const t =
      (p.x - origin.x) * direction.x +
      (p.y - origin.y) * direction.y +
      (p.z - origin.z) * direction.z
    if (t < tMin) tMin = t
    if (t > tMax) tMax = t
  }
  const tMid = (tMin + tMax) * 0.5
  const ref = {
    x: origin.x + direction.x * tMid,
    y: origin.y + direction.y * tMid,
    z: origin.z + direction.z * tMid,
  }
  return { mesh, ref }
}

describe('lathe winding', () => {
  const stroke = [
    { x: 4, y: 0 },
    { x: 14, y: 10 },
    { x: 10, y: 22 },
  ]

  for (const view of VIEWS) {
    it(`open lathe faces outward in ${view} view`, () => {
      const { mesh, ref } = buildLatheInView(view, stroke, false)
      expect(meshFacesPointAwayFrom(mesh, ref)).toBe(true)
    })

    it(`capped lathe faces outward in ${view} view`, () => {
      const { mesh, ref } = buildLatheInView(view, stroke, true)
      expect(meshFacesPointAwayFrom(mesh, ref)).toBe(true)
    })
  }
})
