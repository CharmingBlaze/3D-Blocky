import { describe, expect, it } from 'vitest'
import { primitiveBoxToSceneObject } from '../primitives/primitiveBoxCommit'
import { heightAxisForView } from '../primitives/viewAxes'
import { prepareSceneObject } from './objectTransform'
import { knifeCutObject, previewKnifeCutLocalPoints } from './meshKnife'
import {
  attachKnifePoint,
  cleanupCutTopology,
  knifeCutPath,
  pathHasAttachments,
} from './meshKnifePath'
import { validateCutTopology } from './meshTopologyOps'
import { identityFaceGroups } from './faceGroups'
import { mirrorKnifePath } from './knifeUtils'

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

describe('meshKnife topology quality', () => {
  it('cuts front faces along a view-aligned segment without exploding vertex count', () => {
    const obj = makeBox()
    obj.faceGroups = identityFaceGroups(obj.faces.length)
    const beforeFaces = obj.faces.length
    const beforeVerts = obj.positions.length

    const cut = knifeCutObject(
      obj,
      { x: -2, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 0, y: 0, z: -1 }
    )

    expect(cut.faces.length).toBeGreaterThan(beforeFaces)
    expect(cut.positions.length).toBeGreaterThan(beforeVerts)
    expect(cut.positions.length).toBeLessThan(64)
    expect(cut.faces.some((f) => f.length >= 4)).toBe(true)
    expect(validateCutTopology(cut)).toEqual([])
  })

  it('does not cut through the back of the mesh', () => {
    const obj = makeBox()
    const cut = knifeCutObject(
      obj,
      { x: -0.8, y: 0, z: 1 },
      { x: 0.8, y: 0, z: 1 },
      { x: 0, y: 0, z: -1 }
    )

    const backMidEdgeVerts = cut.positions.filter(
      (p) => Math.abs(p.z + 1) < 0.02 && Math.abs(p.y) < 0.02 && Math.abs(Math.abs(p.x) - 1) > 0.05
    )
    expect(backMidEdgeVerts.length).toBe(0)
    expect(cut.faces.length).toBeGreaterThan(obj.faces.length)
  })

  it('returns unchanged mesh when cut line is too short', () => {
    const obj = makeBox()
    const same = knifeCutObject(obj, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 })
    expect(same.positions.length).toBe(obj.positions.length)
    expect(same.faces.length).toBe(obj.faces.length)
  })

  it('previews connector hit points along the cut', () => {
    const obj = makeBox()
    const hits = previewKnifeCutLocalPoints(
      obj,
      { x: -2, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 0, y: 0, z: -1 }
    )
    expect(hits.length).toBeGreaterThanOrEqual(2)
    for (const p of hits) {
      expect(Math.abs(p.y)).toBeLessThan(0.05)
    }
  })

  it('rejects degenerate view-parallel cuts without mutating', () => {
    const obj = makeBox()
    const same = knifeCutObject(
      obj,
      { x: 0, y: -1, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 1, z: 0 }
    )
    expect(same.faces.length).toBe(obj.faces.length)
    expect(same.positions.length).toBe(obj.positions.length)
  })

  it('preserves UV pools when present', () => {
    const obj = makeBox()
    obj.uvs = [
      { u: 0, v: 0 },
      { u: 1, v: 0 },
      { u: 1, v: 1 },
      { u: 0, v: 1 },
    ]
    obj.faceUvIndices = obj.faces.map((f) => f.map((_, i) => i % 4))

    const cut = knifeCutObject(
      obj,
      { x: -2, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 0, y: 0, z: -1 }
    )

    expect(cut.uvs?.length).toBeGreaterThan(0)
    expect(cut.faceUvIndices?.length).toBe(cut.faces.length)
    expect(validateCutTopology(cut)).toEqual([])
  })
})

describe('meshKnifePath Blockbench remesh', () => {
  it('cuts a face via attached edge→edge path into clean polygons', () => {
    const obj = makeBox()
    obj.faceGroups = identityFaceGroups(obj.faces.length)

    // Front face is typically at +Z. Pick midpoints of left and right edges.
    const left = attachKnifePoint(obj, { x: -1, y: 0, z: 1 })
    const right = attachKnifePoint(obj, { x: 1, y: 0, z: 1 })
    expect(left.snap === 'edge' || left.snap === 'vertex').toBe(true)
    expect(right.snap === 'edge' || right.snap === 'vertex').toBe(true)

    const path = [left, right]
    expect(pathHasAttachments(path)).toBe(true)

    const cut = knifeCutPath(obj, path)
    expect(cut.faces.length).toBeGreaterThan(obj.faces.length)
    expect(validateCutTopology(cut)).toEqual([])
    expect(cut.faces.every((f) => f.length >= 3)).toBe(true)
  })

  it('mirror path reattach + dual cut stays manifold', () => {
    const obj = makeBox()
    obj.faceGroups = identityFaceGroups(obj.faces.length)
    const a = attachKnifePoint(obj, { x: -1, y: 0.3, z: 1 })
    const b = attachKnifePoint(obj, { x: -0.2, y: -0.3, z: 1 })
    const path = [a, b]

    let cut = knifeCutPath(obj, path)
    const mirrored = mirrorKnifePath(
      path.map((p) => ({
        world: p.local,
        local: p.local,
        snap: (p.snap as 'edge' | 'face' | 'vertex') ?? 'face',
      })),
      cut,
      'x',
      0
    )
    const reattached = mirrored.map((p) => attachKnifePoint(cut, p.local))
    cut = knifeCutPath(cut, reattached)
    cut = cleanupCutTopology(cut)

    expect(validateCutTopology(cut)).toEqual([])
    expect(cut.faces.length).toBeGreaterThan(obj.faces.length)
  })

  it('edge→face→edge path remeshes into quads/tris without holes', () => {
    const obj = makeBox()
    obj.faceGroups = identityFaceGroups(obj.faces.length)
    const left = attachKnifePoint(obj, { x: -1, y: 0.4, z: 1 })
    const mid = attachKnifePoint(obj, { x: 0, y: 0, z: 1 })
    const right = attachKnifePoint(obj, { x: 1, y: -0.4, z: 1 })
    expect(mid.snap).toBe('face')

    const cut = knifeCutPath(obj, [left, mid, right])
    expect(cut.faces.length).toBeGreaterThan(obj.faces.length)
    expect(validateCutTopology(cut)).toEqual([])
    // Cut face remeshes to tris/quads; shared-edge neighbors become n-gons (Blockbench).
    expect(cut.faces.every((f) => f.length >= 3)).toBe(true)
    expect(cut.faces.some((f) => f.length === 3)).toBe(true)
  })

  it('cleanup welds coincident seam verts and keeps manifold edges', () => {
    const obj = makeBox()
    const left = attachKnifePoint(obj, { x: -1, y: 0, z: 1 })
    const right = attachKnifePoint(obj, { x: 1, y: 0, z: 1 })
    const cut = cleanupCutTopology(knifeCutPath(obj, [left, right]))
    expect(validateCutTopology(cut)).toEqual([])
    // No duplicate positions at the cut seam.
    for (let i = 0; i < cut.positions.length; i++) {
      for (let j = i + 1; j < cut.positions.length; j++) {
        const a = cut.positions[i]!
        const b = cut.positions[j]!
        const d =
          (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2
        expect(d).toBeGreaterThan(1e-10)
      }
    }
  })
})
