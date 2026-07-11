import { HalfEdgeMesh, type SceneObject } from '../mesh/HalfEdgeMesh'
import { generateId } from '../utils/math'
import type { MeshData } from './types'
import { meshUvIndex } from '../uv/uvMeshData'
import type { Uv2 } from '../uv/uvTypes'
import { identityFaceGroups } from '../mesh/faceGroups'

/**
 * Merge two triangles that share an edge into one quad, preserving winding
 * of the first triangle (MeshBuilder.addQuad → [a,b,c] + [a,c,d] → [a,b,c,d]).
 */
export function mergeTrianglePairToQuad(
  t0: [number, number, number],
  t1: [number, number, number]
): [number, number, number, number] | null {
  const inT1 = new Set(t1)
  const only0 = t0.find((v) => !inT1.has(v))
  if (only0 === undefined) return null
  const inT0 = new Set(t0)
  const only1 = t1.find((v) => !inT0.has(v))
  if (only1 === undefined) return null

  const i = t0.indexOf(only0)
  if (i < 0) return null
  const prev = t0[(i + 2) % 3]!
  const next = t0[(i + 1) % 3]!
  if (!inT1.has(prev) || !inT1.has(next)) return null
  return [prev, only0, next, only1]
}

/** Convert faceted blob MeshData into the app's HalfEdgeMesh representation. */
export function meshDataToHalfEdgeMesh(data: MeshData, color: number): HalfEdgeMesh {
  const mesh = new HalfEdgeMesh()
  const uvs: Uv2[] = []
  if (data.uvs) {
    for (let i = 0; i < data.uvs.length; i += 2) {
      uvs.push({ u: data.uvs[i]!, v: data.uvs[i + 1]! })
    }
  }

  for (let i = 0; i < data.positions.length; i += 3) {
    mesh.positions.push({
      x: data.positions[i]!,
      y: data.positions[i + 1]!,
      z: data.positions[i + 2]!,
    })
  }

  const triCount = Math.floor(data.indices.length / 3)
  const readTri = (ti: number): [number, number, number] => [
    data.indices[ti * 3]!,
    data.indices[ti * 3 + 1]!,
    data.indices[ti * 3 + 2]!,
  ]
  const readTriUv = (ti: number): [number, number, number] | null => {
    if (!data.uvs) return null
    const base = ti * 3
    return [
      meshUvIndex(data, base),
      meshUvIndex(data, base + 1),
      meshUvIndex(data, base + 2),
    ]
  }

  const covered = new Set<number>()
  const newFaceGroups: number[][] = []

  const pushTri = (ti: number) => {
    const t = readTri(ti)
    mesh.faces.push([t[0], t[1], t[2]])
    mesh.faceColors.push(color)
    const uv = readTriUv(ti)
    if (uv) mesh.faceUvIndices.push([...uv])
    return mesh.faces.length - 1
  }

  const pushQuadFromPair = (ti0: number, ti1: number): number | null => {
    const quad = mergeTrianglePairToQuad(readTri(ti0), readTri(ti1))
    if (!quad) return null
    mesh.faces.push([...quad])
    mesh.faceColors.push(color)
    const uv0 = readTriUv(ti0)
    const uv1 = readTriUv(ti1)
    if (uv0 && uv1) {
      const uvQuad = mergeTrianglePairToQuad(uv0, uv1)
      if (uvQuad) mesh.faceUvIndices.push([...uvQuad])
      else mesh.faceUvIndices.push([uv0[0], uv0[1], uv0[2], uv1.find((u) => !uv0.includes(u)) ?? uv1[0]!])
    }
    covered.add(ti0)
    covered.add(ti1)
    return mesh.faces.length - 1
  }

  if (data.faceGroups?.length) {
    for (const group of data.faceGroups) {
      // MeshBuilder.addQuad stores each quad as a length-2 triangle pair.
      if (group.length === 2) {
        const a = group[0]!
        const b = group[1]!
        if (
          a >= 0 &&
          b >= 0 &&
          a < triCount &&
          b < triCount &&
          !covered.has(a) &&
          !covered.has(b)
        ) {
          const fi = pushQuadFromPair(a, b)
          if (fi !== null) {
            newFaceGroups.push([fi])
            continue
          }
        }
      }

      const members: number[] = []
      for (const ti of group) {
        if (ti < 0 || ti >= triCount || covered.has(ti)) continue
        covered.add(ti)
        members.push(pushTri(ti))
      }
      if (members.length > 0) newFaceGroups.push(members)
    }
  }

  for (let ti = 0; ti < triCount; ti++) {
    if (covered.has(ti)) continue
    const fi = pushTri(ti)
    newFaceGroups.push([fi])
  }

  mesh.uvs = uvs
  mesh.faceGroups =
    newFaceGroups.length > 0 ? newFaceGroups : identityFaceGroups(mesh.faces.length)
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
    data.positions[i] = data.positions[i]! * scale[0] + offset[0]
    data.positions[i + 1] = data.positions[i + 1]! * scale[1] + offset[1]
    data.positions[i + 2] = data.positions[i + 2]! * scale[2] + offset[2]
  }
  return data
}
