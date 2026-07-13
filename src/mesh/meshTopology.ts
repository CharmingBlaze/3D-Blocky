import * as THREE from 'three'
import type { SceneObject } from './HalfEdgeMesh'
import { getMeshAdjacency } from './meshAdjacencyCache'
import { getObjectFaceTriangulation } from './faceTriangulation'

export const COINCIDENT_VERTEX_QUANT = 1e-5

export function vertexPositionKey(
  p: { x: number; y: number; z: number },
  quant = COINCIDENT_VERTEX_QUANT
): string {
  const q = (v: number) => Math.round(v / quant)
  return `${q(p.x)},${q(p.y)},${q(p.z)}`
}

/** Groups mesh vertex indices that share the same local position (unwelded UV corners). */
export function groupCoincidentVertexIndices(object: SceneObject): Map<string, number[]> {
  return getMeshAdjacency(object).coincidentVertices
}

export function collectCoincidentVertexGroups(
  object: SceneObject,
  indices: number[]
): number[][] {
  const allGroups = groupCoincidentVertexIndices(object)
  const seen = new Set<string>()
  const groups: number[][] = []

  for (const vi of indices) {
    const p = object.positions[vi]
    if (!p) continue
    const key = vertexPositionKey(p)
    if (seen.has(key)) continue
    seen.add(key)
    groups.push(allGroups.get(key) ?? [vi])
  }

  return groups
}

export function collectUniqueEdges(object: SceneObject): [number, number][] {
  return getMeshAdjacency(object).uniqueEdges
}

export function buildEdgeSegmentsGeometry(
  object: SceneObject,
  edges: [number, number][]
): THREE.BufferGeometry {
  const positions = new Float32Array(edges.length * 6)
  let offset = 0

  for (const [a, b] of edges) {
    const pa = object.positions[a]
    const pb = object.positions[b]
    if (!pa || !pb) continue
    positions[offset++] = pa.x
    positions[offset++] = pa.y
    positions[offset++] = pa.z
    positions[offset++] = pb.x
    positions[offset++] = pb.y
    positions[offset++] = pb.z
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  return geo
}

export function buildFaceLoopsGeometry(object: SceneObject): THREE.BufferGeometry {
  let segmentCount = 0
  for (const face of object.faces) {
    segmentCount += face.length
  }

  const positions = new Float32Array(segmentCount * 6)
  let offset = 0

  for (const face of object.faces) {
    const n = face.length
    for (let i = 0; i < n; i++) {
      const a = object.positions[face[i]]
      const b = object.positions[face[(i + 1) % n]]
      if (!a || !b) continue
      positions[offset++] = a.x
      positions[offset++] = a.y
      positions[offset++] = a.z
      positions[offset++] = b.x
      positions[offset++] = b.y
      positions[offset++] = b.z
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  return geo
}

export function buildFacesFillGeometry(
  object: SceneObject,
  faceIndices?: number[]
): THREE.BufferGeometry | null {
  const filter =
    faceIndices != null ? new Set(faceIndices) : null
  const positions: number[] = []
  const indices: number[] = []
  let offset = 0

  for (let fi = 0; fi < object.faces.length; fi++) {
    if (filter && !filter.has(fi)) continue
    const face = object.faces[fi]
    if (!face || face.length < 3) continue

    for (const vi of face) {
      const p = object.positions[vi]
      positions.push(p.x, p.y, p.z)
    }

    const tris = getObjectFaceTriangulation(object)[fi] ?? []
    for (const [a, b, c] of tris) {
      indices.push(offset + a, offset + b, offset + c)
    }
    offset += face.length
  }

  if (indices.length === 0) return null

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  return geo
}
