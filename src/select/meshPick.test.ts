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
import { pickKnifeHit, pickMeshComponent, pickMeshSurfaceWorld } from './meshPick'

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

describe('Blockbench-style knife snapping', () => {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100)
  camera.position.set(0, 0, 5)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
  const rect = {
    left: 0, top: 0, width: 200, height: 200, right: 200, bottom: 200, x: 0, y: 0,
    toJSON: () => ({}),
  } as DOMRect
  const screen = (point: THREE.Vector3) => {
    const projected = point.clone().project(camera)
    return { x: (projected.x * 0.5 + 0.5) * 200, y: (-projected.y * 0.5 + 0.5) * 200 }
  }

  it('uses Shift to snap a face hit to its center', () => {
    const p = screen(new THREE.Vector3(0.25, 0.2, 1))
    const hit = pickKnifeHit(p.x, p.y, rect, camera, [box], box.id, { shiftKey: true })
    expect(hit?.snap).toBe('face-center')
    expect(hit?.local).toEqual({ x: 0, y: 0, z: 1 })
  })

  it('uses Control to snap across the face-local grid', () => {
    const p = screen(new THREE.Vector3(0.34, 0.18, 1))
    const hit = pickKnifeHit(p.x, p.y, rect, camera, [box], box.id, { ctrlKey: true })
    expect(hit?.snap).toBe('grid')
    expect(hit?.local.x).toBeCloseTo(0.25)
    expect(hit?.local.y).toBeCloseTo(0.25)
    expect(hit?.local.z).toBeCloseTo(1)
  })

  it('uses Shift to quantize edge placement to quarter steps', () => {
    const p = screen(new THREE.Vector3(0.36, 1, 1))
    const hit = pickKnifeHit(p.x, p.y, rect, camera, [box], box.id, { shiftKey: true })
    expect(hit?.snap).toBe('edge')
    expect(hit?.local.x).toBeCloseTo(0.5)
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

describe('BVH source face mapping', () => {
  it('does not select hidden Outliner objects', () => {
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100)
    camera.position.set(0, 0, 5)
    camera.lookAt(0, 0, 0)
    camera.updateProjectionMatrix()
    const rect = {
      left: 0, top: 0, width: 200, height: 200,
      right: 200, bottom: 200, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect
    expect(pickMeshComponent('face', 100, 100, rect, camera, [{ ...box, visible: false }], box.id, {
      cullBackVertices: true,
    })).toBeNull()
  })

  it.each([
    ['front', [0, 0, 5] as const, 1],
    ['back', [0, 0, -5] as const, 0],
    ['right', [5, 0, 0] as const, 3],
    ['left', [-5, 0, 0] as const, 2],
    ['top', [0, 5, 0] as const, 4],
    ['bottom', [0, -5, 0] as const, 5],
  ])('maps a %s ray to the original SceneObject face', (_name, position, expectedFace) => {
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100)
    camera.position.set(position[0], position[1], position[2])
    camera.lookAt(0, 0, 0)
    camera.updateProjectionMatrix()
    camera.updateMatrixWorld(true)
    const rect = {
      left: 0, top: 0, width: 200, height: 200,
      right: 200, bottom: 200, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect

    const hit = pickMeshComponent('face', 100, 100, rect, camera, [box], box.id, {
      cullBackVertices: true,
    })
    expect(hit?.face).toBe(expectedFace)
  })

  it.each([
    ['front', [0, 0, 5] as const, 1],
    ['back', [0, 0, -5] as const, 0],
    ['right', [5, 0, 0] as const, 3],
    ['left', [-5, 0, 0] as const, 2],
    ['top', [0, 5, 0] as const, 4],
    ['bottom', [0, -5, 0] as const, 5],
  ])('gives Knife the original %s face ID', (_name, position, expectedFace) => {
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100)
    camera.position.set(position[0], position[1], position[2])
    camera.lookAt(0, 0, 0)
    camera.updateProjectionMatrix()
    const rect = {
      left: 0, top: 0, width: 200, height: 200,
      right: 200, bottom: 200, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect
    const hit = pickKnifeHit(100, 100, rect, camera, [box], box.id)
    expect(hit?.faceIndex).toBe(expectedFace)
    expect(hit?.snap).toBe('face')
  })

  it('gives Loop Cut a visible front edge instead of an overlapping back edge', () => {
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100)
    camera.position.set(0, 0, 5)
    camera.lookAt(0, 0, 0)
    camera.updateProjectionMatrix()
    const rect = {
      left: 0, top: 0, width: 200, height: 200,
      right: 200, bottom: 200, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect
    const edgeMid = new THREE.Vector3(0, 1, 1).project(camera)
    const hit = pickMeshComponent(
      'edge',
      (edgeMid.x * 0.5 + 0.5) * 200,
      (-edgeMid.y * 0.5 + 0.5) * 200,
      rect,
      camera,
      [box],
      box.id,
      { cullBackVertices: true }
    )
    expect(hit?.edge?.slice().sort((a, b) => a - b)).toEqual([6, 7])
  })
})
