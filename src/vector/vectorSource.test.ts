import { describe, expect, it } from 'vitest'
import { vectorPathToMesh } from './vectorPathToMesh'
import {
  attachVectorSource,
  regenerateVectorObjectFromSource,
} from './vectorSource'
import type { VectorPath } from './types'
import { IDENTITY_TRANSFORM } from '../mesh/objectTransform'

function openPath(): VectorPath {
  return {
    id: 'pen-path',
    view: 'front',
    closed: false,
    color: 0x6ecbf5,
    source: 'pen',
    anchors: [
      { id: 'a0', position: { x: 0, y: 0 }, inHandle: null, outHandle: null },
      { id: 'a1', position: { x: 24, y: 0 }, inHandle: null, outHandle: null },
      { id: 'a2', position: { x: 40, y: 16 }, inHandle: null, outHandle: null },
    ],
  }
}

describe('regenerateVectorObjectFromSource', () => {
  it('preserves id/transform and applies extrudeDepth / strokeMode patches', () => {
    const path = openPath()
    const mesh = vectorPathToMesh(path, {
      view: 'front',
      polyBudget: 128,
      brushDensity: 12,
      strokeMode: 'centerline',
      rdpTolerance: 2,
      closeThreshold: 12,
      defaultDepth: 0,
      color: path.color,
      extrudeAmount: 16,
    })
    expect(mesh).not.toBeNull()

    const object = attachVectorSource(
      {
        ...mesh!,
        id: 'vec-1',
        name: 'Path',
        transform: {
          position: { x: 3, y: 4, z: 5 },
          rotation: { ...IDENTITY_TRANSFORM.rotation },
          scale: { ...IDENTITY_TRANSFORM.scale },
        },
      },
      {
        path: { ...path, objectId: 'vec-1' },
        strokeMode: 'centerline',
        extrudeMode: false,
        brushDensity: 12,
        polyBudget: 128,
        rdpTolerance: 2,
        closeThreshold: 12,
        defaultDepth: 0,
        stylize: 0,
        extrudeDepth: 16,
      }
    )

    const updated = regenerateVectorObjectFromSource(object, {
      extrudeDepth: 32,
      brushDensity: 18,
      pathRadiusScale: 1.5,
    })
    expect(updated).not.toBeNull()
    expect(updated!.id).toBe('vec-1')
    expect(updated!.name).toBe('Path')
    expect(updated!.transform?.position).toEqual({ x: 3, y: 4, z: 5 })
    expect(updated!.vectorSource?.extrudeDepth).toBe(32)
    expect(updated!.vectorSource?.brushDensity).toBe(18)
    expect(updated!.vectorSource?.pathRadiusScale).toBe(1.5)
    expect(updated!.positions.length).toBeGreaterThan(0)
  })
})
