import type { SceneObject } from './HalfEdgeMesh'
import { faceNormal3D } from '../uv/uvObject'
import { edgeKey } from './meshSelection'
import type { Vec3 } from '../utils/math'

const DEFAULT_ANGLE_DEG = 3
const COPLANAR_EPS = 1e-4
const SPATIAL_QUANT = 1e-5

export interface FaceGroup {
  id: number
  /** Indices into `SceneObject.faces` (triangle / polygon entries). */
  faceIndices: number[]
  normal: Vec3
  centroid: Vec3
}

export interface FaceGroupMap {
  groups: FaceGroup[]
  /** Face index → group id */
  faceToGroup: number[]
}

interface CacheEntry {
  sig: string
  map: FaceGroupMap
}

const cacheByObjectId = new Map<string, CacheEntry>()

function meshTopologySig(obj: SceneObject): string {
  let sig = `${obj.positions.length}|${obj.faces.length}`
  if (obj.faceGroups?.length) {
    sig += `|fg:${obj.faceGroups.map((g) => g.join('+')).join(';')}`
  }
  for (let fi = 0; fi < Math.min(obj.faces.length, 64); fi++) {
    const f = obj.faces[fi]
    sig += `|${f.join(',')}`
  }
  if (obj.faces.length > 64) sig += `|${obj.faces.length}`
  return sig
}

function dot3(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

function faceCentroid(obj: SceneObject, fi: number): Vec3 {
  const face = obj.faces[fi]
  let x = 0
  let y = 0
  let z = 0
  for (const vi of face) {
    const p = obj.positions[vi]
    x += p.x
    y += p.y
    z += p.z
  }
  const n = face.length || 1
  return { x: x / n, y: y / n, z: z / n }
}

function facePlane(obj: SceneObject, fi: number): { normal: Vec3; d: number } {
  const normal = faceNormal3D(obj, fi)
  const c = faceCentroid(obj, fi)
  return { normal, d: dot3(normal, c) }
}

function isCoplanarWith(obj: SceneObject, seedFi: number, otherFi: number): boolean {
  const { normal, d } = facePlane(obj, seedFi)
  for (const vi of obj.faces[otherFi]) {
    const p = obj.positions[vi]
    if (Math.abs(dot3(normal, p) - d) > COPLANAR_EPS) return false
  }
  return true
}

function posKey(obj: SceneObject, vi: number): string {
  const p = obj.positions[vi]
  if (!p) return `${vi}`
  const q = (v: number) => Math.round(v / SPATIAL_QUANT)
  return `${q(p.x)},${q(p.y)},${q(p.z)}`
}

function spatialEdgeKey(obj: SceneObject, a: number, b: number): string {
  const ka = posKey(obj, a)
  const kb = posKey(obj, b)
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
}

function buildEdgeAdjacency(obj: SceneObject): Map<string, number[]> {
  const edgeToFaces = new Map<string, number[]>()
  for (let fi = 0; fi < obj.faces.length; fi++) {
    const face = obj.faces[fi]
    for (let i = 0; i < face.length; i++) {
      const a = face[i]
      const b = face[(i + 1) % face.length]
      const key = edgeKey(a, b)
      const list = edgeToFaces.get(key)
      if (list) list.push(fi)
      else edgeToFaces.set(key, [fi])
    }
  }
  return edgeToFaces
}

/** Edge adjacency by world-space position (handles unwelded duplicate verts). */
function buildSpatialEdgeAdjacency(obj: SceneObject): Map<string, number[]> {
  const edgeToFaces = new Map<string, number[]>()
  for (let fi = 0; fi < obj.faces.length; fi++) {
    const face = obj.faces[fi]
    for (let i = 0; i < face.length; i++) {
      const a = face[i]
      const b = face[(i + 1) % face.length]
      const key = spatialEdgeKey(obj, a, b)
      const list = edgeToFaces.get(key)
      if (list) list.push(fi)
      else edgeToFaces.set(key, [fi])
    }
  }
  return edgeToFaces
}

function neighborsOf(
  obj: SceneObject,
  fi: number,
  edgeToFaces: Map<string, number[]>,
  spatialEdgeToFaces: Map<string, number[]>
): number[] {
  const face = obj.faces[fi]
  const out = new Set<number>()
  for (let i = 0; i < face.length; i++) {
    const a = face[i]
    const b = face[(i + 1) % face.length]
    for (const other of edgeToFaces.get(edgeKey(a, b)) ?? []) {
      if (other !== fi) out.add(other)
    }
    for (const other of spatialEdgeToFaces.get(spatialEdgeKey(obj, a, b)) ?? []) {
      if (other !== fi) out.add(other)
    }
  }
  return [...out]
}

function finalizeGroupMap(
  obj: SceneObject,
  groups: number[][],
  normals: Vec3[]
): FaceGroupMap {
  const n = obj.faces.length
  const faceToGroup = new Array<number>(n).fill(-1)
  const outGroups: FaceGroup[] = []

  for (let gid = 0; gid < groups.length; gid++) {
    const members = groups[gid].filter((fi) => fi >= 0 && fi < n)
    if (members.length === 0) continue
    const id = outGroups.length
    for (const fi of members) faceToGroup[fi] = id

    let nx = 0
    let ny = 0
    let nz = 0
    let cx = 0
    let cy = 0
    let cz = 0
    for (const fi of members) {
      const nm = normals[fi] ?? faceNormal3D(obj, fi)
      nx += nm.x
      ny += nm.y
      nz += nm.z
      const c = faceCentroid(obj, fi)
      cx += c.x
      cy += c.y
      cz += c.z
    }
    const m = members.length || 1
    const len = Math.hypot(nx, ny, nz) || 1

    outGroups.push({
      id,
      faceIndices: members,
      normal: { x: nx / len, y: ny / len, z: nz / len },
      centroid: { x: cx / m, y: cy / m, z: cz / m },
    })
  }

  for (let fi = 0; fi < n; fi++) {
    if (faceToGroup[fi] < 0) {
      const id = outGroups.length
      faceToGroup[fi] = id
      const nm = normals[fi] ?? faceNormal3D(obj, fi)
      outGroups.push({
        id,
        faceIndices: [fi],
        normal: nm,
        centroid: faceCentroid(obj, fi),
      })
    }
  }

  return { groups: outGroups, faceToGroup }
}

/** One logical group per triangle face — used for sculpt blobs and as a fallback. */
export function identityFaceGroups(faceCount: number): number[][] {
  return Array.from({ length: faceCount }, (_, fi) => [fi])
}

function buildAuthoredFaceGroupMap(obj: SceneObject): FaceGroupMap | null {
  if (!obj.faceGroups?.length) return null
  const normals = obj.faces.map((_, fi) => faceNormal3D(obj, fi))
  return finalizeGroupMap(obj, obj.faceGroups, normals)
}

/** Cluster coplanar adjacent faces into Blockbench-style planar regions. */
export function computeFaceGroups(
  obj: SceneObject,
  angleDeg = DEFAULT_ANGLE_DEG
): FaceGroupMap {
  const n = obj.faces.length
  if (n === 0) return { groups: [], faceToGroup: [] }

  const cosThreshold = Math.cos((angleDeg * Math.PI) / 180)
  const normals = obj.faces.map((_, fi) => faceNormal3D(obj, fi))
  const edgeToFaces = buildEdgeAdjacency(obj)
  const spatialEdgeToFaces = buildSpatialEdgeAdjacency(obj)
  const faceToGroup = new Array<number>(n).fill(-1)
  const groups: number[][] = []

  for (let seed = 0; seed < n; seed++) {
    if (faceToGroup[seed] >= 0) continue

    const gid = groups.length
    const seedNormal = normals[seed]
    const stack = [seed]
    const members: number[] = []
    faceToGroup[seed] = gid

    while (stack.length > 0) {
      const cur = stack.pop()!
      members.push(cur)

      for (const nb of neighborsOf(obj, cur, edgeToFaces, spatialEdgeToFaces)) {
        if (faceToGroup[nb] >= 0) continue
        if (dot3(seedNormal, normals[nb]) < cosThreshold) continue
        if (!isCoplanarWith(obj, seed, nb)) continue
        faceToGroup[nb] = gid
        stack.push(nb)
      }
    }

    groups.push(members)
  }

  return finalizeGroupMap(obj, groups, normals)
}

export function getFaceGroupMap(obj: SceneObject): FaceGroupMap {
  const sig = meshTopologySig(obj)
  const cached = cacheByObjectId.get(obj.id)
  if (cached?.sig === sig) return cached.map

  const authored = buildAuthoredFaceGroupMap(obj)
  const map = authored ?? computeFaceGroups(obj)
  cacheByObjectId.set(obj.id, { sig, map })
  return map
}

export function invalidateFaceGroupCache(objectId?: string): void {
  if (objectId) cacheByObjectId.delete(objectId)
  else cacheByObjectId.clear()
}

export function getFaceGroupForFace(obj: SceneObject, faceIndex: number): FaceGroup | null {
  const map = getFaceGroupMap(obj)
  const gid = map.faceToGroup[faceIndex]
  if (gid === undefined || gid < 0) return null
  return map.groups[gid] ?? null
}

/** All face indices belonging to the same logical group as `faceIndex`. */
export function expandFaceToPlanarRegion(obj: SceneObject, faceIndex: number): number[] {
  const group = getFaceGroupForFace(obj, faceIndex)
  return group ? [...group.faceIndices] : [faceIndex]
}

export function expandFacesToPlanarRegions(obj: SceneObject, faceIndices: number[]): number[] {
  const map = getFaceGroupMap(obj)
  const out = new Set<number>()
  for (const fi of faceIndices) {
    const gid = map.faceToGroup[fi]
    if (gid === undefined || gid < 0) {
      out.add(fi)
      continue
    }
    for (const idx of map.groups[gid]?.faceIndices ?? []) out.add(idx)
  }
  return [...out]
}

/** Remap authored groups after faces are replaced (e.g. subdivide). */
export function remapFaceGroupsAfterReplace(
  faceGroups: number[][] | undefined,
  faceCount: number,
  oldToNew: Map<number, number[]>
): number[][] {
  const base = faceGroups ?? identityFaceGroups(faceCount)
  const remapped = base
    .map((group) => group.flatMap((fi) => oldToNew.get(fi) ?? []))
    .filter((g) => g.length > 0)

  // Cover replacement faces whose source was missing from authored groups
  // (empty edge-extrude groups, etc.) so Subdivide keeps every face selectable.
  const covered = new Set<number>()
  for (const group of remapped) for (const fi of group) covered.add(fi)
  let maxNew = -1
  for (const replacements of oldToNew.values()) {
    for (const fi of replacements) maxNew = Math.max(maxNew, fi)
  }
  for (let fi = 0; fi <= maxNew; fi++) {
    if (!covered.has(fi)) remapped.push([fi])
  }
  return remapped
}

/** Split groups when knife/loop-cut produces multiple pieces from one face. */
export function splitFaceGroupsAfterCut(
  faceGroups: number[][] | undefined,
  faceCount: number,
  newFaceSourceOld: number[]
): number[][] {
  const oldGroups = faceGroups ?? identityFaceGroups(faceCount)
  const oldToNew = new Map<number, number[]>()
  for (let newFi = 0; newFi < newFaceSourceOld.length; newFi++) {
    const oldFi = newFaceSourceOld[newFi]
    const list = oldToNew.get(oldFi)
    if (list) list.push(newFi)
    else oldToNew.set(oldFi, [newFi])
  }

  const out: number[][] = []
  const assigned = new Set<number>()

  for (const group of oldGroups) {
    const anySplit = group.some((oldFi) => (oldToNew.get(oldFi)?.length ?? 0) > 1)
    if (anySplit) {
      for (const oldFi of group) {
        for (const fi of oldToNew.get(oldFi) ?? []) {
          out.push([fi])
          assigned.add(fi)
        }
      }
    } else {
      const remapped = group.flatMap((oldFi) => oldToNew.get(oldFi) ?? [])
      if (remapped.length > 0) {
        out.push(remapped)
        for (const fi of remapped) assigned.add(fi)
      }
    }
  }

  for (let newFi = 0; newFi < newFaceSourceOld.length; newFi++) {
    if (!assigned.has(newFi)) out.push([newFi])
  }

  return out.length > 0 ? out : identityFaceGroups(newFaceSourceOld.length)
}

export function spatialMeshEdgeKey(obj: SceneObject, a: number, b: number): string {
  return spatialEdgeKey(obj, a, b)
}

/** Boundary edges using world-space position (handles unwelded duplicate verts). */
export function boundaryEdgesForFacesSpatial(
  obj: SceneObject,
  faceIndices: number[]
): [number, number][] {
  const counts = new Map<string, number>()
  const verts = new Map<string, [number, number]>()

  for (const fi of faceIndices) {
    const face = obj.faces[fi]
    if (!face) continue
    for (let i = 0; i < face.length; i++) {
      const a = face[i]
      const b = face[(i + 1) % face.length]
      const key = spatialMeshEdgeKey(obj, a, b)
      counts.set(key, (counts.get(key) ?? 0) + 1)
      if (!verts.has(key)) verts.set(key, a < b ? [a, b] : [b, a])
    }
  }

  const boundary: [number, number][] = []
  for (const [key, count] of counts) {
    if (count === 1) {
      const e = verts.get(key)
      if (e) boundary.push(e)
    }
  }
  return boundary
}

/** Boundary edges of a set of faces (edges used by exactly one face in the set). */
export function boundaryEdgesForFaces(
  obj: SceneObject,
  faceIndices: number[]
): [number, number][] {
  const counts = new Map<string, number>()
  const verts = new Map<string, [number, number]>()

  for (const fi of faceIndices) {
    const face = obj.faces[fi]
    if (!face) continue
    for (let i = 0; i < face.length; i++) {
      const a = face[i]
      const b = face[(i + 1) % face.length]
      const key = edgeKey(a, b)
      counts.set(key, (counts.get(key) ?? 0) + 1)
      if (!verts.has(key)) verts.set(key, a < b ? [a, b] : [b, a])
    }
  }

  const boundary: [number, number][] = []
  for (const [key, count] of counts) {
    if (count === 1) {
      const e = verts.get(key)
      if (e) boundary.push(e)
    }
  }
  return boundary
}

export function planarRegionWorldCentroid(obj: SceneObject, faceIndices: number[]): Vec3 {
  let x = 0
  let y = 0
  let z = 0
  let count = 0
  const seen = new Set<number>()
  for (const fi of faceIndices) {
    for (const vi of obj.faces[fi] ?? []) {
      if (seen.has(vi)) continue
      seen.add(vi)
      const p = obj.positions[vi]
      x += p.x
      y += p.y
      z += p.z
      count++
    }
  }
  if (count === 0) return { x: 0, y: 0, z: 0 }
  return { x: x / count, y: y / count, z: z / count }
}
