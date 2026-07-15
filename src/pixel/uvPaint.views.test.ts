import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import type { SceneObject } from '../mesh/HalfEdgeMesh'
import { pickObjectSurfaceUv } from './uvPaint'

const cube: SceneObject = {
  id: 'paint-cube',
  name: 'Paint cube',
  positions: [
    { x: -1, y: -1, z: -1 }, { x: 1, y: -1, z: -1 },
    { x: 1, y: 1, z: -1 }, { x: -1, y: 1, z: -1 },
    { x: -1, y: -1, z: 1 }, { x: 1, y: -1, z: 1 },
    { x: 1, y: 1, z: 1 }, { x: -1, y: 1, z: 1 },
  ],
  faces: [
    [4, 5, 6, 7], [1, 0, 3, 2], [5, 1, 2, 6],
    [0, 4, 7, 3], [7, 6, 2, 3], [0, 1, 5, 4],
  ],
  faceColors: [0, 0, 0, 0, 0, 0],
  type: 'mesh',
}

const rect = {
  left: 0, top: 0, width: 200, height: 200,
  right: 200, bottom: 200, x: 0, y: 0,
  toJSON: () => ({}),
} as DOMRect

function ortho(position: [number, number, number], up: [number, number, number]) {
  const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 100)
  camera.position.set(...position)
  camera.up.set(...up)
  camera.lookAt(0, 0, 0)
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld(true)
  return camera
}

describe('paint-on-model quad views', () => {
  it.each([
    ['front', ortho([0, 0, 10], [0, 1, 0])],
    ['right', ortho([10, 0, 0], [0, 1, 0])],
    ['top', ortho([0, 10, 0], [0, 0, -1])],
  ])('hits the selected object from the %s orthographic view', (_name, camera) => {
    const hit = pickObjectSurfaceUv(100, 100, rect, camera, cube)
    expect(hit?.objectId).toBe(cube.id)
    expect(hit?.uv.u).toBeGreaterThanOrEqual(0)
    expect(hit?.uv.u).toBeLessThanOrEqual(1)
    expect(hit?.uv.v).toBeGreaterThanOrEqual(0)
    expect(hit?.uv.v).toBeLessThanOrEqual(1)
  })

  it('hits the selected object from the perspective view', () => {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100)
    camera.position.set(6, 5, 6)
    camera.lookAt(0, 0, 0)
    camera.updateProjectionMatrix()
    camera.updateMatrixWorld(true)
    expect(pickObjectSurfaceUv(100, 100, rect, camera, cube)?.objectId).toBe(cube.id)
  })
})
