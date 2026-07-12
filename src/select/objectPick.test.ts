import { afterEach, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { prepareSceneObject } from '../mesh/objectTransform'
import { clearMeshPickGeometryCacheForTests } from './meshPickGeometryCache'
import { objectScreenBounds, objectsInScreenRect } from './objectPick'

function denseGrid(id: string, side: number) {
  const positions: Array<{ x: number; y: number; z: number }> = []
  const faces: number[][] = []
  for (let y = 0; y <= side; y++) {
    for (let x = 0; x <= side; x++) positions.push({ x, y, z: 0 })
  }
  const stride = side + 1
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const a = y * stride + x
      faces.push([a, a + 1, a + stride + 1, a + stride])
    }
  }
  return prepareSceneObject({
    id,
    name: id,
    positions,
    faces,
    faceColors: faces.map(() => 0xffffff),
    color: 0xffffff,
    topologyLocked: false,
    polyBudget: positions.length,
    polyBudgetMode: 'adaptive',
    smoothShading: false,
    facetExaggeration: 0,
  })
}

const grid = denseGrid('grid-40', 40)

afterEach(() => clearMeshPickGeometryCacheForTests([grid]))

describe('objectScreenBounds', () => {
  it('returns finite bounds from AABB corners for a large mesh', () => {
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 500)
    camera.position.set(20, 20, 60)
    camera.lookAt(20, 20, 0)
    camera.updateMatrixWorld()

    const rect = {
      left: 0,
      top: 0,
      width: 400,
      height: 400,
      right: 400,
      bottom: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect

    const b = objectScreenBounds(grid, camera, rect)
    expect(b).not.toBeNull()
    expect(Number.isFinite(b!.left)).toBe(true)
    expect(b!.right).toBeGreaterThan(b!.left)
    expect(b!.bottom).toBeGreaterThan(b!.top)

    const ids = objectsInScreenRect(
      [grid],
      { x0: b!.left + 1, y0: b!.top + 1, x1: b!.right - 1, y1: b!.bottom - 1 },
      camera,
      rect
    )
    expect(ids).toContain(grid.id)
  })

  it('excludes objects outside the marquee', () => {
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 500)
    camera.position.set(0, 0, 50)
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

    const ids = objectsInScreenRect(
      [grid],
      { x0: -1000, y0: -1000, x1: -900, y1: -900 },
      camera,
      rect
    )
    expect(ids).not.toContain(grid.id)
  })
})
