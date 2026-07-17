import { describe, expect, it } from 'vitest'
import { expandFaceToPlanarRegion } from './faceGroups'
import { prepareSceneObject } from './objectTransform'
import { makeSelectionDoubleSided } from './meshTopologyOps'

function planeQuad() {
  return prepareSceneObject({
    id: 'plane',
    name: 'Plane',
    positions: [
      { x: -1, y: 0, z: -1 },
      { x: 1, y: 0, z: -1 },
      { x: 1, y: 0, z: 1 },
      { x: -1, y: 0, z: 1 },
    ],
    faces: [[0, 1, 2, 3]],
    faceColors: [0xffffff],
    faceGroups: [[0]],
    uvs: [
      { u: 0, v: 0 },
      { u: 1, v: 0 },
      { u: 1, v: 1 },
      { u: 0, v: 1 },
    ],
    faceUvIndices: [[0, 1, 2, 3]],
    color: 0xffffff,
    topologyLocked: false,
    polyBudget: 32,
    polyBudgetMode: 'adaptive',
    smoothShading: false,
    facetExaggeration: 0,
  })
}

describe('makeSelectionDoubleSided', () => {
  it('duplicates selected faces with reversed winding and shared UV order reversed', () => {
    const obj = planeQuad()
    const { object: out, addedFaces } = makeSelectionDoubleSided(
      obj,
      { objectId: obj.id, vertices: [], edges: [], faces: [0] },
      'face'
    )
    expect(addedFaces).toEqual([1])
    expect(out.faces).toHaveLength(2)
    expect(out.faces[0]).toEqual([0, 1, 2, 3])
    expect(out.faces[1]).toEqual([3, 2, 1, 0])
    expect(out.faceUvIndices?.[1]).toEqual([3, 2, 1, 0])
    // Front and reverse stay in separate groups so either side can be selected alone.
    expect(out.faceGroups?.[0]).toEqual([0])
    expect(out.faceGroups?.[1]).toEqual([1])
  })

  it('keeps front and reverse faces independently selectable after doubling', () => {
    const obj = planeQuad()
    const { object: out } = makeSelectionDoubleSided(
      obj,
      { objectId: obj.id, vertices: [], edges: [], faces: [0] },
      'face'
    )
    expect(expandFaceToPlanarRegion(out, 0)).toEqual([0])
    expect(expandFaceToPlanarRegion(out, 1)).toEqual([1])
    expect(makeSelectionDoubleSided(out, { objectId: obj.id, vertices: [], edges: [], faces: [0] }, 'face').addedFaces).toEqual([])
    expect(makeSelectionDoubleSided(out, { objectId: obj.id, vertices: [], edges: [], faces: [1] }, 'face').addedFaces).toEqual([])
  })

  it('supports multi-face selection', () => {
    const obj = prepareSceneObject({
      ...planeQuad(),
      id: 'two',
      positions: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 1, y: 0, z: 1 },
        { x: 0, y: 0, z: 1 },
        { x: 0, y: 0, z: 2 },
        { x: 1, y: 0, z: 2 },
      ],
      faces: [
        [0, 1, 2, 3],
        [3, 2, 5, 4],
      ],
      faceColors: [0xff0000, 0x00ff00],
      faceGroups: [[0], [1]],
      faceUvIndices: undefined,
      uvs: undefined,
    })
    const { object: out, addedFaces } = makeSelectionDoubleSided(
      obj,
      { objectId: obj.id, vertices: [], edges: [], faces: [0, 1] },
      'face'
    )
    expect(addedFaces).toEqual([2, 3])
    expect(out.faces).toHaveLength(4)
    expect(out.faceColors).toEqual([0xff0000, 0x00ff00, 0xff0000, 0x00ff00])
  })

  it('is idempotent when a reverse face already exists', () => {
    const obj = planeQuad()
    const once = makeSelectionDoubleSided(
      obj,
      { objectId: obj.id, vertices: [], edges: [], faces: [0] },
      'face'
    )
    const twice = makeSelectionDoubleSided(
      once.object,
      { objectId: obj.id, vertices: [], edges: [], faces: [0] },
      'face'
    )
    expect(twice.addedFaces).toEqual([])
    expect(twice.object.faces).toHaveLength(2)
  })

  it('no-ops without a component selection', () => {
    const obj = planeQuad()
    const { addedFaces } = makeSelectionDoubleSided(obj, null, 'face')
    expect(addedFaces).toEqual([])
  })
})
