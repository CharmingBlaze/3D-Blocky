import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import type { SceneObject } from '../mesh/HalfEdgeMesh'
import { areSurfaceHitsUvContinuous, pickObjectSurfaceUv, type MeshSurfaceUvHit } from './uvPaint'

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
  it('does not paint a hidden Outliner object', () => {
    expect(pickObjectSurfaceUv(100, 100, rect, ortho([0, 0, 10], [0, 1, 0]), {
      ...cube,
      visible: false,
    })).toBeNull()
  })

  it.each([
    ['front', ortho([0, 0, 10], [0, 1, 0])],
    ['back', ortho([0, 0, -10], [0, 1, 0])],
    ['right', ortho([10, 0, 0], [0, 1, 0])],
    ['left', ortho([-10, 0, 0], [0, 1, 0])],
    ['top', ortho([0, 10, 0], [0, 0, -1])],
    ['bottom', ortho([0, -10, 0], [0, 0, 1])],
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

  it.each([
    ['front', [13, -7, 210] as [number, number, number], [0, 1, 0] as [number, number, number]],
    ['right', [213, -7, 10] as [number, number, number], [0, 1, 0] as [number, number, number]],
    ['top', [13, 193, 10] as [number, number, number], [0, 0, -1] as [number, number, number]],
  ])('hits a rotated, scaled, off-origin object from the %s view', (_name, position, up) => {
    const transformed: SceneObject = {
      ...cube,
      id: `transformed-${_name}`,
      pivot: { x: 0, y: 0, z: 0 },
      transform: {
        position: { x: 13, y: -7, z: 10 },
        rotation: { x: 0.17, y: -0.31, z: 0.09 },
        scale: { x: 2.3, y: 1.4, z: 0.8 },
      },
    }
    const camera = ortho(position, up)
    camera.lookAt(13, -7, 10)
    camera.updateMatrixWorld(true)
    expect(pickObjectSurfaceUv(100, 100, rect, camera, transformed)?.objectId).toBe(transformed.id)
  })
})

describe('paint-on-model UV seams', () => {
  const hit = (faceIndex: number): MeshSurfaceUvHit => ({
    objectId: 'seam-test', faceIndex, triIndex: 0,
    pointLocal: { x: 0, y: 0, z: 0 }, world: { x: 0, y: 0, z: 0 },
    uv: { u: 0.5, v: 0.5 }, barycentric: [1, 0, 0], corners: [0, 1, 2],
  })

  it('joins faces that share a continuous UV edge and restarts across an atlas seam', () => {
    const base: SceneObject = {
      id: 'seam-test', name: 'seam test', type: 'mesh',
      positions: [
        { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 }, { x: 1, y: 1, z: 0 },
      ],
      faces: [[0, 1, 2], [1, 3, 2]], faceColors: [0, 0],
      uvs: [
        { u: 0, v: 0 }, { u: 1, v: 0 }, { u: 0, v: 1 }, { u: 1, v: 1 },
      ],
      faceUvIndices: [[0, 1, 2], [1, 3, 2]],
    }
    expect(areSurfaceHitsUvContinuous(base, hit(0), hit(1))).toBe(true)

    const separated: SceneObject = {
      ...base,
      uvs: [...base.uvs!, { u: 0.2, v: 0.2 }, { u: 0.3, v: 0.3 }],
      faceUvIndices: [[0, 1, 2], [4, 3, 5]],
    }
    expect(areSurfaceHitsUvContinuous(separated, hit(0), hit(1))).toBe(false)
  })
})
