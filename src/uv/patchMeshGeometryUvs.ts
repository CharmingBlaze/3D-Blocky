import * as THREE from 'three'
import type { SceneObject } from '../mesh/HalfEdgeMesh'
import type { Uv2 } from './uvTypes'

/**
 * Patch rendered mesh UVs in-place from a UV pool.
 * Layout must match HalfEdgeMesh.toMeshData for the given flatShading mode.
 */
export function patchMeshGeometryUvs(
  geometry: THREE.BufferGeometry,
  object: SceneObject,
  uvs: readonly Uv2[],
  flatShading: boolean
): boolean {
  const attr = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined
  if (!attr || !object.faceUvIndices?.length || object.faces.length === 0) return false

  const arr = attr.array as Float32Array

  if (flatShading) {
    let offset = 0
    for (let fi = 0; fi < object.faces.length; fi++) {
      const face = object.faces[fi]!
      for (let ci = 0; ci < face.length; ci++) {
        const uvIdx = object.faceUvIndices[fi]?.[ci] ?? 0
        const uv = uvs[uvIdx] ?? { u: 0, v: 0 }
        arr[offset] = uv.u
        arr[offset + 1] = uv.v
        offset += 2
      }
    }
  } else {
    const weldMap = new Map<string, number>()
    let offset = 0
    for (let fi = 0; fi < object.faces.length; fi++) {
      const face = object.faces[fi]!
      for (let ci = 0; ci < face.length; ci++) {
        const vi = face[ci]!
        const uvIdx = object.faceUvIndices[fi]?.[ci] ?? 0
        const key = `${vi}:${uvIdx}`
        if (weldMap.has(key)) continue
        const uv = uvs[uvIdx] ?? { u: 0, v: 0 }
        arr[offset] = uv.u
        arr[offset + 1] = uv.v
        weldMap.set(key, offset)
        offset += 2
      }
    }
  }

  attr.needsUpdate = true
  return true
}
