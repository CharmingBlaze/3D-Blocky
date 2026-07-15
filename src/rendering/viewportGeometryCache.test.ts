import { afterEach, describe, expect, it } from 'vitest'
import {
  buildViewportEdgeOutlineGeometry,
  buildViewportMeshGeometry,
  clearViewportGeometryBuildCache,
  shouldOmitViewportVertexColors,
} from '../components/MeshRenderer'
import { HalfEdgeMesh } from '../mesh/HalfEdgeMesh'
import {
  clearMeshAdjacencyCacheForTests,
  getMeshAdjacency,
} from '../mesh/meshAdjacencyCache'
import { collectUniqueEdges } from '../mesh/meshTopology'
import { buildEdgeToFacesMap, buildVertexToFacesMap } from '../mesh/overlayVisibility'
import { prepareSceneObject } from '../mesh/objectTransform'
import { computeVertexDensity } from '../sculpt/sculptTools'

const box = prepareSceneObject({
  id: 'cache-box',
  name: 'Cache box',
  positions: [
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 1, y: 1, z: 0 },
    { x: 0, y: 1, z: 0 },
    { x: 0, y: 0, z: 1 },
    { x: 1, y: 0, z: 1 },
    { x: 1, y: 1, z: 1 },
    { x: 0, y: 1, z: 1 },
  ],
  faces: [
    [0, 1, 2, 3],
    [4, 7, 6, 5],
    [0, 4, 5, 1],
    [3, 2, 6, 7],
    [0, 3, 7, 4],
    [1, 5, 6, 2],
  ],
  faceColors: [0xffffff, 0xffffff, 0xffffff, 0xffffff, 0xffffff, 0xffffff],
  color: 0xffffff,
  topologyLocked: false,
  polyBudget: 32,
  polyBudgetMode: 'adaptive',
  smoothShading: false,
  facetExaggeration: 0,
})

afterEach(() => {
  clearViewportGeometryBuildCache()
  clearMeshAdjacencyCacheForTests([box])
})

describe('viewport geometry build-wave cache', () => {
  it('keeps face colors under Pixel Editor textures', () => {
    expect(shouldOmitViewportVertexColors(true, true)).toBe(false)
    expect(shouldOmitViewportVertexColors(true, false)).toBe(true)
    expect(shouldOmitViewportVertexColors(false, false)).toBe(false)
  })

  it('returns independently owned geometry and attribute arrays', () => {
    const a = buildViewportMeshGeometry(box, true, 0, false)
    const b = buildViewportMeshGeometry(box, true, 0, false)

    expect(a).not.toBe(b)
    expect(a.getAttribute('position')).not.toBe(b.getAttribute('position'))
    expect(a.getAttribute('position').array).not.toBe(b.getAttribute('position').array)

    const original = b.getAttribute('position').getX(0)
    a.getAttribute('position').setX(0, original + 10)
    expect(b.getAttribute('position').getX(0)).toBe(original)

    a.dispose()
    expect(b.getAttribute('position').count).toBeGreaterThan(0)
    b.dispose()
  })

  it('keeps shading variants isolated', () => {
    const flat = buildViewportMeshGeometry(box, true, 0, false)
    const smooth = buildViewportMeshGeometry(box, false, 0, false)

    expect(flat).not.toBe(smooth)
    expect(flat.getAttribute('normal')).toBeDefined()
    expect(smooth.getAttribute('normal')).toBeDefined()

    flat.dispose()
    smooth.dispose()
  })

  it('shares edge outline build across clones', () => {
    const a = buildViewportEdgeOutlineGeometry(box)
    const b = buildViewportEdgeOutlineGeometry(box)

    expect(a).not.toBe(b)
    expect(a.getAttribute('position').count).toBe(b.getAttribute('position').count)
    expect(a.getAttribute('position').count).toBeGreaterThan(0)

    a.dispose()
    b.dispose()
  })
})

describe('mesh adjacency cache', () => {
  it('reuses adjacency maps for the same SceneObject identity', () => {
    const a = getMeshAdjacency(box)
    const b = getMeshAdjacency(box)
    expect(a).toBe(b)
    expect(buildVertexToFacesMap(box)).toBe(a.vertexToFaces)
    expect(buildEdgeToFacesMap(box)).toBe(a.edgeToFaces)
    expect(collectUniqueEdges(box)).toBe(a.uniqueEdges)
  })

  it('builds expected edge and vertex coverage for a box', () => {
    const adj = getMeshAdjacency(box)
    expect(adj.uniqueEdges.length).toBe(12)
    expect(adj.vertexToFaces.get(0)?.length).toBe(3)
    expect(adj.edgeToFaces.size).toBe(12)
  })
})

describe('density heatmap source vertices', () => {
  it('maps flat-shaded render corners to topology vertices', () => {
    const mesh = HalfEdgeMesh.fromObject(box)
    const data = mesh.toMeshData(true, 0)
    expect(data.sourceVertexIndices).toBeDefined()
    expect(data.sourceVertexIndices!.length).toBe(data.positions.length / 3)

    let offset = 0
    for (const face of box.faces) {
      for (const vi of face) {
        expect(data.sourceVertexIndices![offset]).toBe(vi)
        offset++
      }
    }

    const densities = computeVertexDensity(mesh)
    expect(densities.length).toBe(box.positions.length)
    expect(Math.max(...densities)).toBeLessThanOrEqual(1)
  })
})
