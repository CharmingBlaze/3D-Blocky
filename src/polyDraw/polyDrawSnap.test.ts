import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { prepareSceneObject } from '../mesh/objectTransform'
import { SCENE_GRID_CELL } from '../scene/units'
import {
  findPolyDrawSnapTarget,
  snapWorldToSceneGrid,
} from './polyDrawSnap'

function unitQuad() {
  return prepareSceneObject({
    id: 'quad',
    name: 'Quad',
    positions: [
      { x: 0, y: 0, z: 0 },
      { x: 8, y: 0, z: 0 },
      { x: 8, y: 8, z: 0 },
      { x: 0, y: 8, z: 0 },
    ],
    faces: [[0, 1, 2, 3]],
    faceColors: [0xffffff],
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

function frontCamera() {
  const camera = new THREE.OrthographicCamera(-20, 20, 20, -20, 0.1, 100)
  camera.position.set(0, 0, 40)
  camera.lookAt(0, 0, 0)
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld(true)
  return camera
}

function projectClient(world: { x: number; y: number; z: number }, camera: THREE.Camera) {
  const v = new THREE.Vector3(world.x, world.y, world.z).project(camera)
  return {
    x: (v.x * 0.5 + 0.5) * 200,
    y: (-v.y * 0.5 + 0.5) * 200,
  }
}

describe('poly draw snap options', () => {
  it('snaps world points to the scene grid', () => {
    expect(snapWorldToSceneGrid({ x: 3, y: -5, z: 10 })).toEqual({
      x: 0,
      y: -SCENE_GRID_CELL,
      z: SCENE_GRID_CELL,
    })
  })

  it('does not snap to mesh verts or edges when those options are off', () => {
    const camera = frontCamera()
    const obj = unitQuad()
    const at = projectClient(obj.positions[0]!, camera)
    const hit = findPolyDrawSnapTarget(at.x, at.y, rect, camera, [obj], {
      snapVertex: false,
      snapEdge: false,
      selectionObjectIds: [],
      draftPoints: [],
      allowCloseLoop: false,
    })
    expect(hit).toBeNull()
  })

  it('snaps to vertices when Snap to vertex is on', () => {
    const camera = frontCamera()
    const obj = unitQuad()
    const at = projectClient(obj.positions[2]!, camera)
    const hit = findPolyDrawSnapTarget(at.x, at.y, rect, camera, [obj], {
      snapVertex: true,
      snapEdge: false,
      selectionObjectIds: [],
      draftPoints: [],
      allowCloseLoop: false,
    })
    expect(hit?.snap).toEqual({ kind: 'mesh', objectId: 'quad', vertexIndex: 2 })
  })

  it('snaps to edges when Snap to edge is on', () => {
    const camera = frontCamera()
    const obj = unitQuad()
    const mid = { x: 4, y: 0, z: 0 }
    const at = projectClient(mid, camera)
    const hit = findPolyDrawSnapTarget(at.x, at.y, rect, camera, [obj], {
      snapVertex: false,
      snapEdge: true,
      selectionObjectIds: [],
      draftPoints: [],
      allowCloseLoop: false,
    })
    expect(hit?.snap?.kind).toBe('edge')
    expect(hit!.world.x).toBeCloseTo(4, 5)
    expect(hit!.world.y).toBeCloseTo(0, 5)
  })

  it('still snaps to draft points so Line can close with snaps off', () => {
    const camera = frontCamera()
    const draft = { world: { x: 1, y: 2, z: 0 } }
    const at = projectClient(draft.world, camera)
    const hit = findPolyDrawSnapTarget(at.x, at.y, rect, camera, [], {
      snapVertex: false,
      snapEdge: false,
      selectionObjectIds: [],
      draftPoints: [draft],
      allowCloseLoop: true,
    })
    expect(hit?.snap).toEqual({ kind: 'draft', draftIndex: 0 })
  })
})
