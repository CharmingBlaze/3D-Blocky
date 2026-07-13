import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { prepareSceneObject } from '../mesh/objectTransform'
import { ensureObjectUVs } from './uvObject'
import { patchMeshGeometryUvs } from './patchMeshGeometryUvs'

describe('patchMeshGeometryUvs', () => {
  it('updates UV attribute in place without reallocating', () => {
    const obj = ensureObjectUVs(
      prepareSceneObject({
        id: 'box',
        name: 'box',
        positions: [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
          { x: 1, y: 1, z: 0 },
          { x: 0, y: 1, z: 0 },
        ],
        faces: [[0, 1, 2, 3]],
        faceColors: [0xffffff],
        color: 0xffffff,
        topologyLocked: false,
        polyBudget: 4,
        polyBudgetMode: 'adaptive',
        smoothShading: false,
        facetExaggeration: 0,
      })
    )
    const data = {
      positions: new Float32Array(12),
      uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3))
    geo.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2))
    const uvAttr = geo.getAttribute('uv') as THREE.BufferAttribute
    const before = uvAttr.array

    const moved = obj.uvs.map((uv, i) => (i === 0 ? { u: 0.25, v: 0.5 } : { ...uv }))
    expect(patchMeshGeometryUvs(geo, obj, moved, true)).toBe(true)
    expect(uvAttr.array).toBe(before)
    expect(uvAttr.array[0]).toBeCloseTo(0.25)
    expect(uvAttr.array[1]).toBeCloseTo(0.5)

    // Second patch reuses the write plan (same topology).
    const moved2 = moved.map((uv, i) => (i === 0 ? { u: 0.7, v: 0.1 } : uv))
    expect(patchMeshGeometryUvs(geo, obj, moved2, true)).toBe(true)
    expect(uvAttr.array[0]).toBeCloseTo(0.7)
  })
})
