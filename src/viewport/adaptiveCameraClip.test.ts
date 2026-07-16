import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import type { SceneObject } from '../mesh/HalfEdgeMesh'
import { computeSceneWorldBounds, updateAdaptiveCameraClip } from './adaptiveCameraClip'

function box(min: number, max: number): SceneObject {
  return {
    id: `box-${min}-${max}`,
    name: 'Bounds box',
    type: 'mesh',
    positions: [
      { x: min, y: min, z: min },
      { x: max, y: max, z: max },
    ],
    faces: [],
    faceColors: [],
    pivot: { x: 0, y: 0, z: 0 },
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
  }
}

describe('adaptive viewport clipping', () => {
  it('excludes hidden Outliner objects from scene framing bounds', () => {
    expect(computeSceneWorldBounds([{ ...box(-10, 10), visible: false }])).toBeNull()
  })

  it('moves the Top camera above models that extend behind its old fixed position', () => {
    const bounds = computeSceneWorldBounds([box(250, 500)])
    const camera = new THREE.OrthographicCamera(-100, 100, 100, -100, 0.1, 4000)
    camera.position.set(0, 200, 0)
    camera.up.set(0, 0, -1)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld(true)

    expect(updateAdaptiveCameraClip(camera, bounds)).toBe(true)
    expect(camera.position.y).toBeGreaterThan(500)
    expect(camera.near).toBe(0.01)
  })

  it('expands the far plane for very large imported models', () => {
    const bounds = computeSceneWorldBounds([box(-100_000, 100_000)])
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 4000)
    camera.position.set(0, 0, 300_000)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld(true)

    updateAdaptiveCameraClip(camera, bounds)
    expect(camera.far).toBeGreaterThan(400_000)
    expect(camera.near).toBeGreaterThanOrEqual(0.01)
  })

  it('keeps lateral orthographic pan and zoom unchanged', () => {
    const bounds = computeSceneWorldBounds([box(300, 450)])
    const camera = new THREE.OrthographicCamera(-100, 100, 100, -100, 0.1, 4000)
    camera.position.set(37, 200, -24)
    camera.up.set(0, 0, -1)
    camera.zoom = 3.5
    camera.lookAt(37, 0, -24)
    camera.updateMatrixWorld(true)

    updateAdaptiveCameraClip(camera, bounds)
    expect(camera.position.x).toBeCloseTo(37)
    expect(camera.position.z).toBeCloseTo(-24)
    expect(camera.zoom).toBe(3.5)
  })
})
