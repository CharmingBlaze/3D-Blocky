import { describe, expect, it } from 'vitest'
import type { SceneObject } from '../mesh/HalfEdgeMesh'
import { buildObjectSelectionBoundsGeometry } from '../components/MeshRenderer'

describe('object selection bounds', () => {
  it('always creates a 12-edge cage independent of topology density', () => {
    const object = {
      id: 'dense', name: 'Dense', type: 'mesh', faceColors: [], faces: [],
      positions: Array.from({ length: 500 }, (_, i) => ({
        x: (i % 10) - 5,
        y: (Math.floor(i / 10) % 10) - 4,
        z: Math.floor(i / 100) - 2,
      })),
    } as SceneObject
    const geometry = buildObjectSelectionBoundsGeometry(object)
    expect(geometry.getAttribute('position').count).toBe(24)
    geometry.dispose()
  })

  it('adds a small cage margin around planar objects', () => {
    const object = {
      id: 'plane', name: 'Plane', type: 'mesh', faceColors: [], faces: [[0, 1, 2, 3]],
      positions: [
        { x: -2, y: -1, z: 0 }, { x: 2, y: -1, z: 0 },
        { x: 2, y: 1, z: 0 }, { x: -2, y: 1, z: 0 },
      ],
    } as SceneObject
    const geometry = buildObjectSelectionBoundsGeometry(object)
    geometry.computeBoundingBox()
    expect(geometry.boundingBox!.min.z).toBeLessThan(0)
    expect(geometry.boundingBox!.max.z).toBeGreaterThan(0)
    geometry.dispose()
  })
})
