import { describe, expect, it } from 'vitest'
import { primitiveBoxToSceneObject } from '../primitives/primitiveBoxCommit'
import { heightAxisForView } from '../primitives/viewAxes'
import { prepareSceneObject } from './objectTransform'
import {
  findEdgeLoop,
  insertEdgeLoop,
  insertMultipleEdgeLoops,
  loopCutPreviewPositions,
  loopCutPreviewSegments,
  validateCutTopology,
  subdivideObject,
} from './meshTopologyOps'
import { edgeKey } from './meshSelection'
import { identityFaceGroups } from './faceGroups'

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

describe('meshTopologyOps - insertEdgeLoop', () => {
  it('keeps valid faceGroups and prefers quads on a box ring', () => {
    const obj = makeBox()
    obj.faceGroups = identityFaceGroups(obj.faces.length)
    const seed = edgeKey(0, 1)
    const loop = findEdgeLoop(obj, seed)
    const cut = insertEdgeLoop(obj, loop, 0.5)

    expect(validateCutTopology(cut)).toEqual([])
    expect(cut.faces.length).toBeGreaterThan(obj.faces.length)
    const quads = cut.faces.filter((f) => f.length === 4).length
    expect(quads).toBeGreaterThanOrEqual(cut.faces.length - 2)
  })

  it('keeps a planar loop at consistent t (no zig-zag opposite edges)', () => {
    const obj = makeBox()
    const seed = edgeKey(0, 1)
    const loop = findEdgeLoop(obj, seed)
    const cut = insertEdgeLoop(obj, loop, 0.25, seed)

    // New verts on the loop should all share a common axis slab (box-aligned).
    const newVerts = cut.positions.slice(obj.positions.length)
    expect(newVerts.length).toBeGreaterThanOrEqual(4)
    const xs = newVerts.map((p) => p.x)
    const ys = newVerts.map((p) => p.y)
    const zs = newVerts.map((p) => p.z)
    const span = (arr: number[]) => Math.max(...arr) - Math.min(...arr)
    // At least one axis is nearly constant (the cut plane of a box ring).
    const minSpan = Math.min(span(xs), span(ys), span(zs))
    expect(minSpan).toBeLessThan(0.05)
    expect(validateCutTopology(cut)).toEqual([])
  })

  it('preserves UV ring lengths when present', () => {
    const obj = makeBox()
    obj.uvs = [
      { u: 0, v: 0 },
      { u: 1, v: 0 },
      { u: 1, v: 1 },
      { u: 0, v: 1 },
    ]
    obj.faceUvIndices = obj.faces.map((f) => f.map((_, i) => i % 4))
    const seed = edgeKey(0, 1)
    const loop = findEdgeLoop(obj, seed)
    const cut = insertEdgeLoop(obj, loop, 0.5)
    expect(validateCutTopology(cut)).toEqual([])
    expect(cut.faceUvIndices?.length).toBe(cut.faces.length)
  })
})

describe('meshTopologyOps - Blender-style subdivide', () => {
  it('turns every box face into four quads using shared edge midpoints', () => {
    const obj = makeBox()
    const subdivided = subdivideObject(obj, null, 'object')

    expect(subdivided.positions.length).toBe(26)
    expect(subdivided.faces.length).toBe(24)
    expect(subdivided.faces.every((face) => face.length === 4)).toBe(true)
    expect(validateCutTopology(subdivided)).toEqual([])
  })

  it('subdivides only the selected face into four quads', () => {
    const obj = makeBox()
    const subdivided = subdivideObject(obj, {
      objectId: obj.id,
      vertices: [],
      edges: [],
      faces: [0],
    }, 'face')

    expect(subdivided.faces.length).toBe(9)
    expect(subdivided.faces.slice(0, 4).every((face) => face.length === 4)).toBe(true)
    expect(validateCutTopology(subdivided)).toEqual([])
  })
})

describe('meshTopologyOps - insertMultipleEdgeLoops', () => {
  it('splits a loop of edges into multiple parallel edge loops', () => {
    const obj = makeBox()

    const seed = edgeKey(0, 1)
    const loop = findEdgeLoop(obj, seed)

    const cut = insertMultipleEdgeLoops(obj, loop, seed, [0.33, 0.66])

    expect(cut.positions.length).toBe(obj.positions.length + 8)
    expect(cut.faces.length).toBe(obj.faces.length + 8)
  })

  it('keeps faceGroups covering every face exactly once', () => {
    const obj = makeBox()
    obj.faceGroups = identityFaceGroups(obj.faces.length)
    const seed = edgeKey(0, 1)
    const loop = findEdgeLoop(obj, seed)
    const cut = insertMultipleEdgeLoops(obj, loop, seed, [0.25, 0.5, 0.75])
    expect(validateCutTopology(cut)).toEqual([])
    expect(cut.faces.every((f) => f.length >= 3)).toBe(true)
  })
})

describe('meshTopologyOps - loop cut preview', () => {
  it('returns cut dots on each loop edge and chord segments across quads', () => {
    const obj = makeBox()
    const seed = edgeKey(0, 1)
    const loop = findEdgeLoop(obj, seed)
    expect(loop.length).toBeGreaterThanOrEqual(4)

    const dots = loopCutPreviewPositions(obj, loop, 0.5)
    expect(dots).toHaveLength(loop.length)
    for (const p of dots) {
      expect(Number.isFinite(p.x)).toBe(true)
      expect(Number.isFinite(p.y)).toBe(true)
      expect(Number.isFinite(p.z)).toBe(true)
    }

    const segments = loopCutPreviewSegments(obj, loop, 0.5)
    expect(segments.length).toBeGreaterThanOrEqual(2)
    for (const [a, b] of segments) {
      expect(a).not.toEqual(b)
    }
  })
})
