import { describe, expect, it } from 'vitest'
import { mergeTrianglePairToQuad, meshDataToHalfEdgeMesh } from './adapters'
import { MeshBuilder, finalizeIndexedMesh } from '../mesh/MeshBuilder'

describe('mergeTrianglePairToQuad', () => {
  it('merges MeshBuilder.addQuad triangle pairs into a,b,c,d', () => {
    const quad = mergeTrianglePairToQuad([0, 1, 2], [0, 2, 3])
    expect(quad).toEqual([0, 1, 2, 3])
  })

  it('returns null for non-adjacent triangles', () => {
    expect(mergeTrianglePairToQuad([0, 1, 2], [3, 4, 5])).toBeNull()
  })
})

describe('meshDataToHalfEdgeMesh quads', () => {
  it('promotes addQuad faceGroups to true 4-vert faces', () => {
    const b = new MeshBuilder()
    const a = b.addVertex(0, 0, 0)
    const c = b.addVertex(1, 0, 0)
    const d = b.addVertex(1, 1, 0)
    const e = b.addVertex(0, 1, 0)
    b.addQuad(a, c, d, e)
    const data = finalizeIndexedMesh(b.build(), {
      outwardCenter: { x: 0.5, y: 0.5, z: -1 },
      facet: false,
      validate: false,
    })
    const mesh = meshDataToHalfEdgeMesh(data, 0xff0000)
    expect(mesh.faces.length).toBe(1)
    expect(mesh.faces[0]!.length).toBe(4)
  })
})
