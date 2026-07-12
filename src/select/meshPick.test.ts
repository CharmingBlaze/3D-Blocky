import { describe, expect, it, afterEach } from 'vitest'
import * as THREE from 'three'
import { prepareSceneObject } from '../mesh/objectTransform'
import {
  clearMeshPickGeometryCacheForTests,
  getFaceTriangulation,
  getLocalAabb,
  rayIntersectsLocalAabb,
} from './meshPickGeometryCache'
import { clearOverlayPickCacheForTests, getOverlayPickData } from './overlayPickCache'
import { pickMeshComponent, pickMeshSurfaceWorld } from './meshPick'

const box = prepareSceneObject({
  id: 'pick-box',
  name: 'Pick box',
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
  faceColors: [0xffffff, 0xffffff, 0xffffff, 0xffffff, 0xffffff, 0xffffff],
  color: 0xffffff,
  topologyLocked: false,
  polyBudget: 32,
  polyBudgetMode: 'adaptive',
  smoothShading: false,
  facetExaggeration: 0,
})

afterEach(() => {
  clearMeshPickGeometryCacheForTests([box])
  clearOverlayPickCacheForTests([box])
})

describe('meshPickGeometryCache', () => {
  it('caches local AABB and triangulation', () => {
    const a = getLocalAabb(box)
    const b = getLocalAabb(box)
    expect(a).toBe(b)
    expect(a!.minX).toBeLessThan(0)
    expect(a!.maxX).toBeGreaterThan(0)

    const t0 = getFaceTriangulation(box)
    const t1 = getFaceTriangulation(box)
    expect(t0).toBe(t1)
    expect(t0.triangleCount).toBe(12) // 6 quads → 12 tris
  })

  it('rejects rays that miss the AABB', () => {
    const aabb = getLocalAabb(box)!
    const miss = new THREE.Ray(
      new THREE.Vector3(10, 0, 0),
      new THREE.Vector3(0, 1, 0).normalize()
    )
    expect(rayIntersectsLocalAabb(miss, aabb)).toBe(false)

    const hit = new THREE.Ray(
      new THREE.Vector3(0, 0, 5),
      new THREE.Vector3(0, 0, -1)
    )
    expect(rayIntersectsLocalAabb(hit, aabb)).toBe(true)
  })

  it('surface pick hits the front of a unit box', () => {
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100)
    camera.position.set(0, 0, 5)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld()

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

    const hit = pickMeshSurfaceWorld(100, 100, rect, camera, [box], box.id)
    expect(hit).not.toBeNull()
    expect(hit!.objectId).toBe(box.id)
    expect(hit!.world.z).toBeGreaterThan(0.5)
  })
})

describe('overlayPickCache', () => {
  it('reuses overlay groups for the same object identity', () => {
    const a = getOverlayPickData(box)
    const b = getOverlayPickData(box)
    expect(a).toBe(b)
    expect(a.vertexGroups.length).toBeGreaterThan(0)
    expect(a.edgeOverlays.length).toBeGreaterThan(0)
    expect(a.faceGroups.length).toBeGreaterThan(0)
  })
})

describe('SubD face pick', () => {
  it('uses cage centroid pick when SubD preview is active (X-ray off)', () => {
    const subdBox = prepareSceneObject({
      ...box,
      id: 'subd-pick-box',
      subdEnabled: true,
      subdLevels: 2,
    })
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100)
    camera.position.set(0, 0, 5)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld()

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

    const hit = pickMeshComponent(
      'face',
      100,
      100,
      rect,
      camera,
      [subdBox],
      subdBox.id,
      { cullBackVertices: true }
    )
    expect(hit?.objectId).toBe(subdBox.id)
    expect(hit?.face).toBeTypeOf('number')
    clearOverlayPickCacheForTests([subdBox])
  })
})
