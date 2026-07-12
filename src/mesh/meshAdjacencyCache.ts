import type { SceneObject } from './HalfEdgeMesh'
import { edgeKey } from './meshSelection'

const COINCIDENT_QUANT = 1e-5

export interface MeshAdjacency {
  uniqueEdges: [number, number][]
  vertexToFaces: Map<number, number[]>
  edgeToFaces: Map<string, number[]>
  /** Position key → coincident vertex indices (unwelded UV corners). */
  coincidentVertices: Map<string, number[]>
}

/**
 * Topology adjacency derived from an immutable SceneObject.
 * WeakMap keyed by object identity — store updates create new refs and miss naturally.
 */
const adjacencyByObject = new WeakMap<SceneObject, MeshAdjacency>()

function positionKey(p: { x: number; y: number; z: number }): string {
  const q = (v: number) => Math.round(v / COINCIDENT_QUANT)
  return `${q(p.x)},${q(p.y)},${q(p.z)}`
}

function buildMeshAdjacency(object: SceneObject): MeshAdjacency {
  const uniqueEdges: [number, number][] = []
  const edgeSeen = new Set<string>()
  const vertexToFaces = new Map<number, number[]>()
  const edgeToFaces = new Map<string, number[]>()
  const coincidentVertices = new Map<string, number[]>()

  for (let vi = 0; vi < object.positions.length; vi++) {
    const p = object.positions[vi]
    if (!p) continue
    const pk = positionKey(p)
    const list = coincidentVertices.get(pk)
    if (list) list.push(vi)
    else coincidentVertices.set(pk, [vi])
  }

  for (let fi = 0; fi < object.faces.length; fi++) {
    const face = object.faces[fi]
    if (!face || face.length < 2) continue
    const n = face.length

    for (const vi of face) {
      const list = vertexToFaces.get(vi)
      if (list) list.push(fi)
      else vertexToFaces.set(vi, [fi])
    }

    for (let i = 0; i < n; i++) {
      const a = face[i]!
      const b = face[(i + 1) % n]!
      const key = edgeKey(a, b)
      const faces = edgeToFaces.get(key)
      if (faces) faces.push(fi)
      else edgeToFaces.set(key, [fi])

      if (!edgeSeen.has(key)) {
        edgeSeen.add(key)
        uniqueEdges.push(a < b ? [a, b] : [b, a])
      }
    }
  }

  return { uniqueEdges, vertexToFaces, edgeToFaces, coincidentVertices }
}

export function getMeshAdjacency(object: SceneObject): MeshAdjacency {
  let entry = adjacencyByObject.get(object)
  if (!entry) {
    entry = buildMeshAdjacency(object)
    adjacencyByObject.set(object, entry)
  }
  return entry
}

/** Test helper — WeakMap entries drop with GC; this only clears known refs. */
export function clearMeshAdjacencyCacheForTests(objects: SceneObject[]): void {
  for (const obj of objects) adjacencyByObject.delete(obj)
}
