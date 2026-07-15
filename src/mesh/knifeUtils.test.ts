import { describe, expect, it } from 'vitest'
import { primitiveBoxToSceneObject } from '../primitives/primitiveBoxCommit'
import { heightAxisForView } from '../primitives/viewAxes'
import {
  knifePathOnMirrorPlane,
  knifeSegmentIsMirrorDuplicate,
  mirrorKnifeLocalPoint,
  mirrorKnifePath,
  mirrorKnifePoint,
} from './knifeUtils'
import { knifeCutObject } from './meshKnife'
import { localPointFromWorld, prepareSceneObject, worldPointFromObject } from './objectTransform'
import { mirrorWorldPoint } from '../symmetry/symmetry'

function makeBox() {
  return prepareSceneObject(
    primitiveBoxToSceneObject(
      'box',
      { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } },
      heightAxisForView('front'),
      0xffffff,
      64
    )!
  )
}

function axisDist(coord: number, plane: number) {
  return Math.abs(coord - plane)
}

describe('mirror knife helpers', () => {
  it('reflects known points across X=0 to the expected coordinates', () => {
    expect(mirrorKnifeLocalPoint({ x: 0.8, y: 0.25, z: 1 }, 'x', 0)).toEqual({
      x: -0.8,
      y: 0.25,
      z: 1,
    })
    expect(mirrorKnifeLocalPoint({ x: -0.35, y: -0.1, z: 0.5 }, 'x', 0)).toEqual({
      x: 0.35,
      y: -0.1,
      z: 0.5,
    })
    // Custom plane at x = 0.2
    expect(mirrorKnifeLocalPoint({ x: 0.5, y: 0, z: 0 }, 'x', 0.2).x).toBeCloseTo(-0.1)
  })

  it('keeps equal |x| distance from X=0 for a point and its mirror (screenshot regression)', () => {
    // Reproduces the hollow-square asymmetry: left farther from the dashed line than right.
    // Object translated so world ≠ local — local-axis flip is NOT equidistant from world X=0.
    const obj = prepareSceneObject({
      ...makeBox(),
      transform: {
        position: { x: 3, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      pivot: { x: 0, y: 0, z: 0 },
    })

    const local = { x: 0.4, y: 0.2, z: 1 }
    const world = worldPointFromObject(obj, local)
    const plane = 0

    // Local-only flip (previous buggy approach) is asymmetric about the world plane.
    const badLocalMirror = mirrorKnifeLocalPoint(local, 'x', plane)
    const badWorld = worldPointFromObject(obj, badLocalMirror)
    expect(axisDist(world.x, plane)).not.toBeCloseTo(axisDist(badWorld.x, plane))

    // Correct: world reflection of the drawn primary point.
    const { world: mirWorld, local: mirLocal } = mirrorKnifePoint(
      obj,
      local,
      'x',
      plane,
      world
    )
    expect(axisDist(mirWorld.x, plane)).toBeCloseTo(axisDist(world.x, plane))
    expect(mirWorld.y).toBeCloseTo(world.y)
    expect(mirWorld.z).toBeCloseTo(world.z)
    expect(mirWorld.x).toBeCloseTo(-world.x)
    // Local is whatever the transform maps the mirrored world back to.
    expect(mirLocal).toEqual(localPointFromWorld(obj, mirWorld))
  })

  it('converges primary and mirrored points as they approach the mirror plane', () => {
    const obj = makeBox()
    const plane = 0
    for (const x of [1, 0.5, 0.1, 0.01, 0]) {
      const local = { x, y: 0.4, z: 0.7 }
      const world = worldPointFromObject(obj, local)
      const mir = mirrorKnifePoint(obj, local, 'x', plane, world)
      expect(mir.world.x).toBeCloseTo(-x)
      expect(mir.world.y).toBeCloseTo(world.y)
      expect(mir.world.z).toBeCloseTo(world.z)
      expect(Math.abs(world.x - mir.world.x)).toBeCloseTo(2 * Math.abs(x - plane))
      if (x === 0) {
        expect(mir.world.x).toBeCloseTo(world.x)
        expect(mir.world.y).toBeCloseTo(world.y)
        expect(mir.world.z).toBeCloseTo(world.z)
      }
    }
  })

  it('mirrors in world space so markers stay equidistant from the dashed plane', () => {
    const obj = prepareSceneObject({
      ...makeBox(),
      transform: {
        position: { x: 5, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      pivot: { x: 0, y: 0, z: 0 },
    })

    const local = { x: 0.75, y: 0.25, z: 1 }
    const world = worldPointFromObject(obj, local)
    const path = [{ world, local }]

    const mirrored = mirrorKnifePath(path, obj, 'x', 0)
    expect(mirrored[0]!.world.x).toBeCloseTo(-world.x)
    expect(mirrored[0]!.world.y).toBeCloseTo(world.y)
    expect(mirrored[0]!.world.z).toBeCloseTo(world.z)
    expect(axisDist(mirrored[0]!.world.x, 0)).toBeCloseTo(axisDist(world.x, 0))

    // Matches the shared world-space helper used by sculpt / loop-cut / overlay.
    const expectedWorld = mirrorWorldPoint(world, 'x', 0)
    expect(mirrored[0]!.world.x).toBeCloseTo(expectedWorld.x)
    expect(mirrored[0]!.local).toEqual(localPointFromWorld(obj, expectedWorld))
  })

  it('preserves zig-zag polyline connectivity under mirror (same point count/order)', () => {
    const obj = makeBox()
    const path = [
      { world: { x: 0.8, y: 0.6, z: 1 }, local: { x: 0.8, y: 0.6, z: 1 } },
      { world: { x: 0.5, y: -0.2, z: 1 }, local: { x: 0.5, y: -0.2, z: 1 } },
      { world: { x: 0.2, y: 0.4, z: 1 }, local: { x: 0.2, y: 0.4, z: 1 } },
      { world: { x: 0.05, y: -0.1, z: 1 }, local: { x: 0.05, y: -0.1, z: 1 } },
    ]
    const mirrored = mirrorKnifePath(path, obj, 'x', 0)
    expect(mirrored).toHaveLength(path.length)
    for (let i = 0; i < path.length; i++) {
      expect(mirrored[i]!.world.x).toBeCloseTo(-path[i]!.world.x)
      expect(mirrored[i]!.world.y).toBeCloseTo(path[i]!.world.y)
      expect(mirrored[i]!.world.z).toBeCloseTo(path[i]!.world.z)
    }
    // Near-plane tip converges
    expect(Math.abs(mirrored[3]!.world.x - path[3]!.world.x)).toBeLessThan(0.11)
  })

  it('detects strokes that lie on the mirror plane', () => {
    const onPlane = [
      { world: { x: 0, y: -0.5, z: 1 }, local: { x: 0, y: -0.5, z: 1 } },
      { world: { x: 0, y: 0.5, z: 1 }, local: { x: 0, y: 0.5, z: 1 } },
    ]
    const offPlane = [
      { world: { x: -0.6, y: -0.5, z: 1 }, local: { x: -0.6, y: -0.5, z: 1 } },
      { world: { x: -0.2, y: 0.5, z: 1 }, local: { x: -0.2, y: 0.5, z: 1 } },
    ]
    expect(knifePathOnMirrorPlane(onPlane, 'x', 0)).toBe(true)
    expect(knifePathOnMirrorPlane(offPlane, 'x', 0)).toBe(false)
  })

  it('mirrors path points across the symmetry plane into world + local space', () => {
    const obj = makeBox()
    const path = [
      { world: { x: -0.75, y: 0.25, z: 1 }, local: { x: -0.75, y: 0.25, z: 1 } },
      { world: { x: -0.25, y: -0.25, z: 1 }, local: { x: -0.25, y: -0.25, z: 1 } },
    ]
    const mirrored = mirrorKnifePath(path, obj, 'x', 0)
    expect(mirrored[0]!.world.x).toBeCloseTo(0.75)
    expect(mirrored[1]!.world.x).toBeCloseTo(0.25)
    expect(mirrored[0]!.local.x).toBeCloseTo(0.75)
    expect(mirrored[1]!.local.x).toBeCloseTo(0.25)
    expect(mirrored[0]!.local.y).toBeCloseTo(0.25)
    expect(mirrored[1]!.local.z).toBeCloseTo(1)
  })

  it('flags mirrored segments that duplicate the primary stroke', () => {
    const a = { x: 0, y: -1, z: 1 }
    const b = { x: 0, y: 1, z: 1 }
    expect(knifeSegmentIsMirrorDuplicate(a, b, a, b)).toBe(true)
    expect(knifeSegmentIsMirrorDuplicate(a, b, b, a)).toBe(true)
    expect(
      knifeSegmentIsMirrorDuplicate(a, b, { x: 0.5, y: -1, z: 1 }, { x: 0.5, y: 1, z: 1 })
    ).toBe(false)
  })

  it('cuts topology on both sides of the mirror plane', () => {
    const obj = makeBox()
    const viewForward = { x: 0, y: 0, z: -1 }
    const primaryStart = { x: -0.8, y: 0.4, z: 1 }
    const primaryEnd = { x: -0.2, y: -0.4, z: 1 }
    const path = [
      { world: { ...primaryStart }, local: { ...primaryStart } },
      { world: { ...primaryEnd }, local: { ...primaryEnd } },
    ]

    let cut = knifeCutObject(obj, primaryStart, primaryEnd, viewForward)
    const afterPrimaryFaces = cut.faces.length
    expect(afterPrimaryFaces).toBeGreaterThan(obj.faces.length)

    const mirrored = mirrorKnifePath(path, cut, 'x', 0)
    expect(knifePathOnMirrorPlane(path, 'x', 0)).toBe(false)
    expect(
      knifeSegmentIsMirrorDuplicate(
        path[0]!.local,
        path[1]!.local,
        mirrored[0]!.local,
        mirrored[1]!.local
      )
    ).toBe(false)

    cut = knifeCutObject(cut, mirrored[0]!.local, mirrored[1]!.local, viewForward)
    expect(cut.faces.length).toBeGreaterThan(afterPrimaryFaces)

    const leftCutVerts = cut.positions.filter(
      (p) => p.x < -0.05 && Math.abs(p.z - 1) < 0.05 && Math.abs(Math.abs(p.x) - 1) > 0.05
    )
    const rightCutVerts = cut.positions.filter(
      (p) => p.x > 0.05 && Math.abs(p.z - 1) < 0.05 && Math.abs(Math.abs(p.x) - 1) > 0.05
    )
    expect(leftCutVerts.length).toBeGreaterThan(0)
    expect(rightCutVerts.length).toBeGreaterThan(0)
  })

  it('does not double-cut when the stroke is on the mirror plane', () => {
    const obj = makeBox()
    const viewForward = { x: 0, y: 0, z: -1 }
    const start = { x: 0, y: -0.8, z: 1 }
    const end = { x: 0, y: 0.8, z: 1 }
    const path = [
      { world: { ...start }, local: { ...start } },
      { world: { ...end }, local: { ...end } },
    ]

    expect(knifePathOnMirrorPlane(path, 'x', 0)).toBe(true)

    const once = knifeCutObject(obj, start, end, viewForward)
    const mirrored = mirrorKnifePath(path, once, 'x', 0)
    expect(
      knifeSegmentIsMirrorDuplicate(
        path[0]!.local,
        path[1]!.local,
        mirrored[0]!.local,
        mirrored[1]!.local
      )
    ).toBe(true)

    const twice = knifeCutObject(once, mirrored[0]!.local, mirrored[1]!.local, viewForward)
    expect(twice.faces.length).toBe(once.faces.length)
    expect(twice.positions.length).toBe(once.positions.length)
  })

  it('mirrorKnifePoint reflects the drawn world point through the symmetry plane', () => {
    const obj = makeBox()
    const local = { x: 0.4, y: -0.2, z: 0.9 }
    const world = worldPointFromObject(obj, local)
    const mir = mirrorKnifePoint(obj, local, 'x', 0, world)
    expect(mir.world).toEqual(mirrorWorldPoint(world, 'x', 0))
    expect(mir.local).toEqual(localPointFromWorld(obj, mir.world))
  })
})
