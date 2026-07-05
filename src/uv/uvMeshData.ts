import type { MeshData } from '../blob/types'

/** UV index for triangle corner `i` (decoupled or legacy mirrored). */
export function meshUvIndex(data: MeshData, cornerIndex: number): number {
  if (data.uvIndices) return data.uvIndices[cornerIndex]
  return data.indices[cornerIndex]
}

export function ensureMeshDataUvIndices(data: MeshData): MeshData {
  if (data.uvIndices) return data
  if (!data.uvs) return data
  const uvIndices = new Uint32Array(data.indices.length)
  for (let i = 0; i < data.indices.length; i++) {
    uvIndices[i] = data.indices[i]
  }
  return { ...data, uvIndices }
}

export function appendTriToMeshData(
  data: {
    positions: number[]
    uvs: number[]
    indices: number[]
    uvIndices: number[]
  },
  a: [number, number, number],
  b: [number, number, number],
  c: [number, number, number],
  ua: [number, number],
  ub: [number, number],
  uc: [number, number]
): void {
  const base = data.positions.length / 3
  data.positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2])
  const uvBase = data.uvs.length / 2
  data.uvs.push(ua[0], ua[1], ub[0], ub[1], uc[0], uc[1])
  data.indices.push(base, base + 1, base + 2)
  data.uvIndices.push(uvBase, uvBase + 1, uvBase + 2)
}

export function meshDataFromArrays(
  positions: number[],
  uvs: number[],
  indices: number[],
  uvIndices: number[]
): MeshData {
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(positions.length),
    uvs: new Float32Array(uvs),
    uvIndices: new Uint32Array(uvIndices),
    indices: new Uint32Array(indices),
  }
}
