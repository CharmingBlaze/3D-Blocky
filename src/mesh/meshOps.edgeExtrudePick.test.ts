import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { extrudeMeshSelection } from './meshOps'
import { prepareSceneObject } from './objectTransform'
import { makeSelectionDoubleSided } from './meshTopologyOps'
import { pickMeshComponent } from '../select/meshPick'
import { clearOverlayPickCacheForTests } from '../select/overlayPickCache'
import { primitiveBoxToSceneObject } from '../primitives/primitiveBoxCommit'
import { edgeKey } from './meshSelection'
import { getMeshAdjacency } from './meshAdjacencyCache'
import {
  buildVertexOverlayGroups,
  isVertexOverlayGroupPickable,
} from './vertexOverlay'
import { isEdgeOverlayPickable } from './edgeOverlay'

function unitBox() {
  return prepareSceneObject({
    id: 'box',
    name: 'box',
    positions: [
      { x: -1, y: -1, z: -1 },
      { x: 1, y: -1, z: -1 },
      { x: 1, y: 1, z: -1 },
      { x: -1, y: 1, z: -1 },
      { x: -1, y: -1, z: 1 },
      { x: 1, y: -1, z: 1 },
      { x: 1, y: 1, z: 1 },
      { x: -1, y: 1, z: 1 },
    ],
    faces: [
      [0, 1, 2, 3],
      [5, 4, 7, 6],
      [4, 0, 3, 7],
      [1, 5, 6, 2],
      [3, 2, 6, 7],
      [4, 5, 1, 0],
    ],
    faceColors: Array(6).fill(0xffffff),
    color: 0xffffff,
    topologyLocked: false,
    polyBudget: 32,
    polyBudgetMode: 'adaptive',
    smoothShading: false,
    facetExaggeration: 0,
  })
}

const rect = {
  left: 0,
  top: 0,
  width: 200,
  height: 200,
  right: 200,
  bottom: 200,
  x: 0,
  y: 0,
  toJSON: () => ({}),
} as DOMRect

function edgeOnCameraLookingAt(mid: { x: number; y: number; z: number }) {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100)
  camera.position.set(mid.x, mid.y + 8, mid.z + 0.01)
  camera.lookAt(mid.x, mid.y, mid.z)
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld(true)
  return camera
}

describe('edge extrude tip vertices remain pickable', () => {
  it('keeps extruded tip verts pickable even when their only wall faces away', () => {
    const box = unitBox()
    const extruded = extrudeMeshSelection(
      box,
      { objectId: 'box', vertices: [], edges: ['6-7'], faces: [] },
      'edge',
      2
    )
    clearOverlayPickCacheForTests([extruded])

    const tipEdge = extruded.resultingSelection?.edges[0]
    expect(tipEdge).toBeTruthy()
    const [a, b] = tipEdge!.split('-').map(Number)
    expect(extruded.resultingSelection?.vertices.sort((x, y) => x - y)).toEqual(
      [a!, b!].sort((x, y) => x - y)
    )

    const tipA = extruded.positions[a!]!
    const tipB = extruded.positions[b!]!
    const mid = {
      x: (tipA.x + tipB.x) / 2,
      y: (tipA.y + tipB.y) / 2,
      z: (tipA.z + tipB.z) / 2,
    }
    const camera = edgeOnCameraLookingAt(mid)

    for (const vi of [a!, b!]) {
      const p = extruded.positions[vi]!
      const projected = new THREE.Vector3(p.x, p.y, p.z).project(camera)
      const sx = (projected.x * 0.5 + 0.5) * 200
      const sy = (-projected.y * 0.5 + 0.5) * 200
      const group = buildVertexOverlayGroups(extruded).find((g) => g.indices.includes(vi))
      expect(group).toBeTruthy()
      expect(isVertexOverlayGroupPickable(extruded, group!, camera)).toBe(true)

      const hit = pickMeshComponent(
        'vertex',
        sx,
        sy,
        rect,
        camera,
        [extruded],
        'box',
        { cullBackVertices: true }
      )
      expect(hit?.vertex).toBe(vi)
    }
  })

  it('emits double-sided CAD tip walls that stay pickable edge-on', () => {
    const box = primitiveBoxToSceneObject(
      'box',
      { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } },
      'y',
      0xffffff,
      32
    )!
    const { uniqueEdges } = getMeshAdjacency(box)
    const topEdge = uniqueEdges.find(([a, b]) => {
      const pa = box.positions[a]!
      const pb = box.positions[b]!
      return Math.abs(pa.y - 1) < 1e-6 && Math.abs(pb.y - 1) < 1e-6
    })!
    const key = edgeKey(topEdge[0], topEdge[1])

    const extruded = extrudeMeshSelection(
      box,
      { objectId: box.id, vertices: [], edges: [key], faces: [] },
      'edge',
      1
    )
    const tipEdges = extruded.resultingSelection!.edges
    const tipVerts = extruded.resultingSelection!.vertices
    expect(tipVerts).toHaveLength(2)
    expect(extruded.faces).toHaveLength(box.faces.length + tipEdges.length * 2)
    expect(extruded.faces.at(-1)).toEqual([...(extruded.faces.at(-2) ?? [])].reverse())

    // Make Double Sided is a no-op — walls already have reverse twins.
    expect(
      makeSelectionDoubleSided(
        extruded,
        { objectId: box.id, vertices: [], edges: tipEdges, faces: [] },
        'edge'
      ).addedFaces
    ).toEqual([])

    clearOverlayPickCacheForTests([extruded])

    const tipA = extruded.positions[tipVerts[0]!]!
    const tipB = extruded.positions[tipVerts[1]!]!
    const mid = {
      x: (tipA.x + tipB.x) / 2,
      y: (tipA.y + tipB.y) / 2,
      z: (tipA.z + tipB.z) / 2,
    }
    const camera = edgeOnCameraLookingAt(mid)

    expect(
      isEdgeOverlayPickable(
        extruded,
        tipEdges[0]!.split('-').map(Number) as [number, number],
        camera
      )
    ).toBe(true)

    for (const vi of tipVerts) {
      const group = buildVertexOverlayGroups(extruded).find((g) => g.indices.includes(vi))
      expect(group).toBeTruthy()
      expect(isVertexOverlayGroupPickable(extruded, group!, camera)).toBe(true)

      const p = extruded.positions[vi]!
      const projected = new THREE.Vector3(p.x, p.y, p.z).project(camera)
      const sx = (projected.x * 0.5 + 0.5) * 200
      const sy = (-projected.y * 0.5 + 0.5) * 200
      const hit = pickMeshComponent(
        'vertex',
        sx,
        sy,
        rect,
        camera,
        [extruded],
        box.id,
        { cullBackVertices: true }
      )
      expect(hit?.vertex).toBe(vi)
    }
  })
})
