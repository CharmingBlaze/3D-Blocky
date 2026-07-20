import type { SceneObject } from '../mesh/HalfEdgeMesh'
import {
  edgeKey,
  getAffectedVertices,
  parseEdgeKey,
  type MeshComponentSelection,
} from '../mesh/meshSelection'
import { localPointFromWorld, worldDeltaToLocal, worldPointFromObject } from '../mesh/objectTransform'
import type { Vec3 } from '../utils/math'
import { mirrorWorldPoint, type SymmetryAxis } from './symmetry'

const DEFAULT_MATCH_EPS = 1e-3

export interface MeshSymmetryPlane {
  enabled: boolean
  axis: SymmetryAxis
  plane: number
}

function worldDistSq(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  const dz = a.z - b.z
  return dx * dx + dy * dy + dz * dz
}

function quantizeKey(point: Vec3, cell: number): string {
  return `${Math.round(point.x / cell)},${Math.round(point.y / cell)},${Math.round(point.z / cell)}`
}

/**
 * Map each vertex index to its world-plane mirror partner (or itself when on-plane).
 * Unmatched vertices are omitted.
 */
export function buildVertexMirrorMap(
  obj: SceneObject,
  axis: SymmetryAxis,
  plane: number,
  eps = DEFAULT_MATCH_EPS
): Map<number, number> {
  const map = new Map<number, number>()
  if (obj.positions.length === 0) return map

  const worlds = obj.positions.map((p) => worldPointFromObject(obj, p))
  const cell = Math.max(eps, 1e-5)
  const buckets = new Map<string, number[]>()
  for (let i = 0; i < worlds.length; i++) {
    const key = quantizeKey(worlds[i]!, cell)
    const list = buckets.get(key)
    if (list) list.push(i)
    else buckets.set(key, [i])
  }

  const epsSq = eps * eps
  for (let i = 0; i < worlds.length; i++) {
    if (map.has(i)) continue
    const target = mirrorWorldPoint(worlds[i]!, axis, plane)
    if (worldDistSq(worlds[i]!, target) <= epsSq) {
      map.set(i, i)
      continue
    }

    let best = -1
    let bestDist = epsSq
    const baseKey = quantizeKey(target, cell)
    const [tx, ty, tz] = baseKey.split(',').map(Number)
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        for (let oz = -1; oz <= 1; oz++) {
          const list = buckets.get(`${tx! + ox},${ty! + oy},${tz! + oz}`)
          if (!list) continue
          for (const j of list) {
            if (j === i) continue
            const d = worldDistSq(worlds[j]!, target)
            if (d <= bestDist) {
              bestDist = d
              best = j
            }
          }
        }
      }
    }
    if (best >= 0) {
      map.set(i, best)
      if (!map.has(best)) map.set(best, i)
    }
  }
  return map
}

function faceCentroidWorld(obj: SceneObject, faceIndex: number): Vec3 | null {
  const face = obj.faces[faceIndex]
  if (!face || face.length === 0) return null
  let x = 0
  let y = 0
  let z = 0
  for (const vi of face) {
    const w = worldPointFromObject(obj, obj.positions[vi]!)
    x += w.x
    y += w.y
    z += w.z
  }
  const n = face.length
  return { x: x / n, y: y / n, z: z / n }
}

function findMirroredFaceIndex(
  obj: SceneObject,
  faceIndex: number,
  vertexMap: Map<number, number>,
  axis: SymmetryAxis,
  plane: number,
  eps: number
): number | null {
  const face = obj.faces[faceIndex]
  if (!face) return null
  const mirroredVerts = new Set<number>()
  for (const vi of face) {
    const mi = vertexMap.get(vi)
    if (mi == null) return null
    mirroredVerts.add(mi)
  }

  // Exact vert-set match first.
  for (let fi = 0; fi < obj.faces.length; fi++) {
    const candidate = obj.faces[fi]!
    if (candidate.length !== face.length) continue
    if (candidate.every((vi) => mirroredVerts.has(vi))) return fi
  }

  // Centroid fallback for welded / slightly asymmetric meshes.
  const centroid = faceCentroidWorld(obj, faceIndex)
  if (!centroid) return null
  const target = mirrorWorldPoint(centroid, axis, plane)
  const epsSq = eps * eps * 4
  let best = -1
  let bestDist = epsSq
  for (let fi = 0; fi < obj.faces.length; fi++) {
    const c = faceCentroidWorld(obj, fi)
    if (!c) continue
    const d = worldDistSq(c, target)
    if (d <= bestDist) {
      bestDist = d
      best = fi
    }
  }
  return best >= 0 ? best : null
}

/** Mirrored copy of a selection (does not include the original components). */
export function mirrorMeshSelection(
  obj: SceneObject,
  selection: MeshComponentSelection,
  axis: SymmetryAxis,
  plane: number,
  eps = DEFAULT_MATCH_EPS
): MeshComponentSelection {
  const vertexMap = buildVertexMirrorMap(obj, axis, plane, eps)
  const vertices = new Set<number>()
  const edges = new Set<string>()
  const faces = new Set<number>()

  for (const vi of selection.vertices) {
    const mi = vertexMap.get(vi)
    if (mi != null && mi !== vi) vertices.add(mi)
  }

  for (const key of selection.edges) {
    const [a, b] = parseEdgeKey(key)
    const ma = vertexMap.get(a)
    const mb = vertexMap.get(b)
    if (ma == null || mb == null) continue
    const mirroredKey = edgeKey(ma, mb)
    if (mirroredKey !== key) edges.add(mirroredKey)
  }

  for (const fi of selection.faces) {
    const mi = findMirroredFaceIndex(obj, fi, vertexMap, axis, plane, eps)
    if (mi != null && mi !== fi) faces.add(mi)
  }

  return {
    objectId: selection.objectId,
    vertices: [...vertices],
    edges: [...edges],
    faces: [...faces],
  }
}

/** Union of a selection with its world-plane mirror. */
export function expandMeshSelectionWithSymmetry(
  obj: SceneObject,
  selection: MeshComponentSelection,
  axis: SymmetryAxis,
  plane: number,
  eps = DEFAULT_MATCH_EPS
): MeshComponentSelection {
  const mirrored = mirrorMeshSelection(obj, selection, axis, plane, eps)
  return {
    objectId: selection.objectId,
    vertices: [...new Set([...selection.vertices, ...mirrored.vertices])],
    edges: [...new Set([...selection.edges, ...mirrored.edges])],
    faces: [...new Set([...selection.faces, ...mirrored.faces])],
  }
}

function projectWorldOntoPlane(point: Vec3, axis: SymmetryAxis, plane: number): Vec3 {
  if (axis === 'x') return { ...point, x: plane }
  if (axis === 'y') return { ...point, y: plane }
  return { ...point, z: plane }
}

function axisComponent(point: Vec3, axis: SymmetryAxis): number {
  if (axis === 'x') return point.x
  if (axis === 'y') return point.y
  return point.z
}

/** Prefer the +side vertex as the source of truth when both sides are selected. */
function canonicalMirrorVertex(
  a: number,
  b: number,
  worlds: Vec3[],
  axis: SymmetryAxis,
  plane: number
): number {
  const ca = axisComponent(worlds[a]!, axis) - plane
  const cb = axisComponent(worlds[b]!, axis) - plane
  if (Math.abs(ca - cb) < 1e-8) return Math.min(a, b)
  return ca >= cb ? a : b
}

/**
 * After transforming selected verts in world space, propagate the result to mirror
 * partners so move/scale/rotate stay bilateral.
 */
export function propagateSymmetricVertexPositions(
  obj: SceneObject,
  selectedVerts: Iterable<number>,
  nextPositions: Vec3[],
  axis: SymmetryAxis,
  plane: number,
  eps = DEFAULT_MATCH_EPS
): Vec3[] {
  const selected = new Set(selectedVerts)
  if (selected.size === 0) return nextPositions

  const vertexMap = buildVertexMirrorMap(obj, axis, plane, eps)
  const baseWorlds = obj.positions.map((p) => worldPointFromObject(obj, p))
  const live = { ...obj, positions: nextPositions }
  const positions = nextPositions.map((p) => ({ ...p }))

  for (const vi of selected) {
    const mi = vertexMap.get(vi)
    if (mi == null) continue
    if (mi === vi) {
      const world = worldPointFromObject(live, positions[vi]!)
      positions[vi] = localPointFromWorld(obj, projectWorldOntoPlane(world, axis, plane))
      continue
    }

    const source = selected.has(mi)
      ? canonicalMirrorVertex(vi, mi, baseWorlds, axis, plane)
      : vi
    if (source !== vi) continue

    const world = worldPointFromObject(live, positions[source]!)
    positions[mi] = localPointFromWorld(obj, mirrorWorldPoint(world, axis, plane))
  }

  return positions
}

/** Translate a selection and its mirror partners by a world-space delta. */
export function translateMeshSelectionWithSymmetry(
  obj: SceneObject,
  selection: MeshComponentSelection,
  basePositions: Record<number, Vec3>,
  deltaWorld: Vec3,
  symmetry: MeshSymmetryPlane
): Vec3[] {
  const snapshot: SceneObject = {
    ...obj,
    positions: obj.positions.map((p, i) => basePositions[i] ?? { ...p }),
  }
  const primaryVerts = getAffectedVertices(selection, snapshot)
  const localDelta = worldDeltaToLocal(obj, deltaWorld)
  const positions = snapshot.positions.map((p, i) => {
    if (!primaryVerts.has(i)) return { ...p }
    return {
      x: p.x + localDelta.x,
      y: p.y + localDelta.y,
      z: p.z + localDelta.z,
    }
  })

  if (!symmetry.enabled) return positions

  return propagateSymmetricVertexPositions(
    snapshot,
    primaryVerts,
    positions,
    symmetry.axis,
    symmetry.plane
  )
}

/** Expand faces-to-delete with mirrored faces when symmetry is on. */
export function expandFaceSetWithSymmetry(
  obj: SceneObject,
  faceIndices: Iterable<number>,
  axis: SymmetryAxis,
  plane: number,
  eps = DEFAULT_MATCH_EPS
): Set<number> {
  const selection: MeshComponentSelection = {
    objectId: obj.id,
    vertices: [],
    edges: [],
    faces: [...faceIndices],
  }
  const expanded = expandMeshSelectionWithSymmetry(obj, selection, axis, plane, eps)
  return new Set(expanded.faces)
}

