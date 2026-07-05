import { HalfEdgeMesh, type SceneObject } from '../mesh/HalfEdgeMesh'
import { generateId } from '../utils/math'
import type { MeshData } from './types'
import { meshUvIndex } from '../uv/uvMeshData'
import type { Uv2 } from '../uv/uvTypes'
import { identityFaceGroups } from '../mesh/faceGroups'

/** Convert faceted blob MeshData into the app's HalfEdgeMesh representation. */
export function meshDataToHalfEdgeMesh(data: MeshData, color: number): HalfEdgeMesh {
  const mesh = new HalfEdgeMesh()
  const uvs: Uv2[] = []
  if (data.uvs) {
    for (let i = 0; i < data.uvs.length; i += 2) {
      uvs.push({ u: data.uvs[i], v: data.uvs[i + 1] })
    }
  }

  for (let i = 0; i < data.positions.length; i += 3) {
    mesh.positions.push({
      x: data.positions[i],
      y: data.positions[i + 1],
      z: data.positions[i + 2],
    })
  }

  for (let t = 0; t < data.indices.length; t += 3) {
    mesh.faces.push([data.indices[t], data.indices[t + 1], data.indices[t + 2]])
    mesh.faceColors.push(color)
    if (data.uvs) {
      mesh.faceUvIndices.push([
        meshUvIndex(data, t),
        meshUvIndex(data, t + 1),
        meshUvIndex(data, t + 2),
      ])
    }
  }

  mesh.uvs = uvs
  mesh.faceGroups =
    data.faceGroups?.map((g) => [...g]) ??
    identityFaceGroups(mesh.faces.length)
  mesh.buildHalfEdges()
  return mesh
}

export function meshDataToSceneObject(
  data: MeshData,
  color: number,
  meta: Partial<SceneObject> = {}
): SceneObject {
  const mesh = meshDataToHalfEdgeMesh(data, color)
  return mesh.toObject(meta.id ?? generateId(), meta.name ?? 'Object', {
    ...meta,
    color,
  })
}

/** Scale + translate a welded mesh in-place (before view projection). */
export function transformMeshData(
  data: MeshData,
  scale: [number, number, number],
  offset: [number, number, number]
): MeshData {
  for (let i = 0; i < data.positions.length; i += 3) {
    data.positions[i] = data.positions[i] * scale[0] + offset[0]
    data.positions[i + 1] = data.positions[i + 1] * scale[1] + offset[1]
    data.positions[i + 2] = data.positions[i + 2] * scale[2] + offset[2]
  }
  return data
}
