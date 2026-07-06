import type { SceneObject } from '../mesh/HalfEdgeMesh'
import { edgeKey } from '../mesh/meshSelection'
import { computeFaceGroups } from '../mesh/faceGroups'
import {
  faceCorners3D,
  faceNormal3D,
  isDoodleLikeObject,
  type SceneObjectWithUVs,
} from './uvObject'
import {
  planarProjectFaceUVs,
  classifyFaceNormalBucket,
  BLOCKBENCH_SLOTS,
  type UvNormalBucket,
} from './uvEditing'
import { packCubeBucketsBlockbench, packFaceIslandsShelf, splitUvIslandsForPacking } from './uvPack'
import type { Uv2 } from './uvTypes'
import { cloneUv2 } from './uvTypes'

/** Blender-style default: edges sharper than this become automatic seams. */
export const AUTO_SEAM_ANGLE_DEG = 66

export type UvUnwrapMethod =
  | 'auto'
  | 'smart'
  | 'regions'
  | 'planar'
  | 'box'
  | 'blockbench'
  | 'lightmap'

export const UV_UNWRAP_METHODS: { id: UvUnwrapMethod; label: string; hint: string }[] = [
  {
    id: 'auto',
    label: 'Auto Unwrap',
    hint: 'No seams needed — auto-detects sharp edges (66°) and picks the best layout',
  },
  {
    id: 'smart',
    label: 'Smart UV Project',
    hint: 'Angle-limited connected islands with automatic seams (default 66°)',
  },
  {
    id: 'regions',
    label: 'Planar Regions',
    hint: 'Coplanar face groups as single islands (best for cubes/blocks)',
  },
  {
    id: 'planar',
    label: 'Planar per Face',
    hint: 'Each face projected flat, packed into a grid',
  },
  {
    id: 'box',
    label: 'Box / Cube Faces',
    hint: 'Blockbench cube face squares, packed by direction',
  },
  {
    id: 'blockbench',
    label: 'Blockbench Atlas',
    hint: 'Directional cross layout (Up/Front/Right/…)',
  },
  {
    id: 'lightmap',
    label: 'Lightmap Pack',
    hint: 'Uniform grid pack — good for baking',
  },
]

export interface UnwrapOptions {
  angleLimitDeg?: number
  margin?: number
  /** Repack every island in the atlas after projecting the selection. */
  repackAll?: boolean
  markPacked?: boolean
}

function buildEdgeAdjacency(obj: SceneObject): {
  edgeToFaces: Map<string, number[]>
  spatialEdgeToFaces: Map<string, number[]>
} {
  const edgeToFaces = new Map<string, number[]>()
  const spatialEdgeToFaces = new Map<string, number[]>()
  const SPATIAL_QUANT = 1e-5
  const posKey = (vi: number) => {
    const p = obj.positions[vi]
    if (!p) return `${vi}`
    const q = (v: number) => Math.round(v / SPATIAL_QUANT)
    return `${q(p.x)},${q(p.y)},${q(p.z)}`
  }
  const spatialEdgeKey = (a: number, b: number) => {
    const ka = posKey(a)
    const kb = posKey(b)
    return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
  }

  for (let fi = 0; fi < obj.faces.length; fi++) {
    const face = obj.faces[fi]
    for (let i = 0; i < face.length; i++) {
      const a = face[i]
      const b = face[(i + 1) % face.length]
      const key = edgeKey(a, b)
      const list = edgeToFaces.get(key)
      if (list) list.push(fi)
      else edgeToFaces.set(key, [fi])

      const skey = spatialEdgeKey(a, b)
      const slist = spatialEdgeToFaces.get(skey)
      if (slist) slist.push(fi)
      else spatialEdgeToFaces.set(skey, [fi])
    }
  }
  return { edgeToFaces, spatialEdgeToFaces }
}

function faceNeighbors(
  fi: number,
  obj: SceneObject,
  edgeToFaces: Map<string, number[]>,
  spatialEdgeToFaces: Map<string, number[]>
): number[] {
  const face = obj.faces[fi]
  const out = new Set<number>()
  const SPATIAL_QUANT = 1e-5
  const posKey = (vi: number) => {
    const p = obj.positions[vi]
    if (!p) return `${vi}`
    const q = (v: number) => Math.round(v / SPATIAL_QUANT)
    return `${q(p.x)},${q(p.y)},${q(p.z)}`
  }
  const spatialEdgeKey = (a: number, b: number) => {
    const ka = posKey(a)
    const kb = posKey(b)
    return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
  }

  for (let i = 0; i < face.length; i++) {
    const a = face[i]
    const b = face[(i + 1) % face.length]
    for (const other of edgeToFaces.get(edgeKey(a, b)) ?? []) {
      if (other !== fi) out.add(other)
    }
    for (const other of spatialEdgeToFaces.get(spatialEdgeKey(a, b)) ?? []) {
      if (other !== fi) out.add(other)
    }
  }
  return [...out]
}

function normalAngleDeg(n1: { x: number; y: number; z: number }, n2: { x: number; y: number; z: number }): number {
  const dot = Math.max(-1, Math.min(1, n1.x * n2.x + n1.y * n2.y + n1.z * n2.z))
  return (Math.acos(dot) * 180) / Math.PI
}

/** Cluster faces into islands where adjacent face normals are within angleLimitDeg. */
export function clusterFacesSmartUv(
  obj: SceneObject,
  faceIndices: number[],
  angleLimitDeg: number
): number[][] {
  const allowed = new Set(faceIndices)
  const { edgeToFaces, spatialEdgeToFaces } = buildEdgeAdjacency(obj)
  const visited = new Set<number>()
  const islands: number[][] = []

  for (const seed of faceIndices) {
    if (visited.has(seed) || !allowed.has(seed)) continue
    const island: number[] = []
    const queue = [seed]
    visited.add(seed)

    while (queue.length > 0) {
      const cur = queue.shift()!
      island.push(cur)
      const nCur = faceNormal3D(obj, cur)
      for (const nb of faceNeighbors(cur, obj, edgeToFaces, spatialEdgeToFaces)) {
        if (!allowed.has(nb) || visited.has(nb)) continue
        const nNb = faceNormal3D(obj, nb)
        if (normalAngleDeg(nCur, nNb) <= angleLimitDeg) {
          visited.add(nb)
          queue.push(nb)
        }
      }
    }
    if (island.length > 0) islands.push(island)
  }

  return islands
}

/** Pick unwrap strategy from mesh shape — no manual seam marking required. */
export function resolveAutoUnwrapMethod(obj: SceneObject): UvUnwrapMethod {
  if (obj.uvMappingMode === 'box' || isDoodleLikeObject(obj)) return 'blockbench'

  const buckets = new Map<string, number>()
  for (let fi = 0; fi < obj.faces.length; fi++) {
    const b = classifyFaceNormalBucket(faceNormal3D(obj, fi))
    buckets.set(b, (buckets.get(b) ?? 0) + 1)
  }

  const bucketCount = buckets.size
  const faceCount = obj.faces.length
  const largestBucket = Math.max(...buckets.values(), 0)
  const bucketBalance = largestBucket / Math.max(faceCount, 1)

  if (bucketCount >= 4 && bucketCount <= 6 && bucketBalance < 0.55) return 'blockbench'
  if (faceCount <= 48 && bucketCount <= 8) return 'regions'
  return 'smart'
}

function repackEntireMesh(
  work: SceneObjectWithUVs,
  uvs: Uv2[],
  faceUvIndices: number[][],
  layout: UvUnwrapMethod,
  angleLimit: number,
  margin: number,
  touchedFaces: Set<number>,
  projectUntouched: boolean
): void {
  const allFaces = work.faces.map((_, i) => i)

  if (layout === 'blockbench' || layout === 'box') {
    const buckets = clusterFacesByNormalBucket(work, allFaces)
    for (const [, bucketFaces] of buckets) {
      const touch = projectUntouched || bucketFaces.some((fi) => touchedFaces.has(fi))
      if (touch) {
        projectIslandPlanar(work, uvs, bucketFaces)
        weldIslandUvTopology(faceUvIndices, uvs, work, bucketFaces)
      }
    }
    splitUvIslandsForPacking(
      uvs,
      faceUvIndices,
      [...buckets.values()].map((faces) => faces)
    )
    packBlockbenchSubset(uvs, faceUvIndices, work, allFaces, margin)
    return
  }

  const islands =
    layout === 'lightmap'
      ? clusterFacesSmartUv(work, allFaces, Math.min(angleLimit, 45))
      : layout === 'regions'
        ? clusterFacesPlanarRegions(work, allFaces)
        : clusterFacesSmartUv(work, allFaces, angleLimit)

  for (const island of islands) {
    const touch = projectUntouched || island.some((fi) => touchedFaces.has(fi))
    if (touch) {
      projectIslandPlanar(work, uvs, island)
      weldIslandUvTopology(faceUvIndices, uvs, work, island)
    }
  }
  packIslandList(uvs, faceUvIndices, islands, margin)
}

/** Merge UV indices at shared mesh vertices within an island (one UV point per corner). */
export function weldIslandUvTopology(
  faceUvIndices: number[][],
  uvs: Uv2[],
  obj: SceneObject,
  islandFaces: number[]
): void {
  const vertToUi = new Map<number, number>()

  for (const fi of islandFaces) {
    const face = obj.faces[fi]
    const uvIdx = faceUvIndices[fi]
    if (!face || !uvIdx) continue
    for (let i = 0; i < face.length; i++) {
      const vi = face[i]
      const ui = uvIdx[i]
      if (ui === undefined) continue
      if (!vertToUi.has(vi)) vertToUi.set(vi, ui)
    }
  }

  for (const fi of islandFaces) {
    const face = obj.faces[fi]
    const uvIdx = faceUvIndices[fi]
    if (!face || !uvIdx) continue
    for (let i = 0; i < face.length; i++) {
      const vi = face[i]
      const ui = uvIdx[i]
      if (ui === undefined) continue
      const canonical = vertToUi.get(vi)!
      uvs[canonical] = { ...uvs[ui] }
      uvIdx[i] = canonical
    }
  }
}

/** Coplanar adjacent face groups (Blockbench-style planar regions). */
export function clusterFacesPlanarRegions(obj: SceneObject, faceIndices: number[]): number[][] {
  const allowed = new Set(faceIndices)
  const map = computeFaceGroups(obj)
  const islands: number[][] = []
  const used = new Set<number>()

  for (const group of map.groups) {
    const members = group.faceIndices.filter((fi) => allowed.has(fi))
    if (members.length === 0) continue
    islands.push(members)
    for (const fi of members) used.add(fi)
  }

  for (const fi of faceIndices) {
    if (!used.has(fi)) islands.push([fi])
  }

  return islands
}

/** Planar-project an island; weld corners that share the same mesh vertex index. */
function projectIslandPlanar(
  obj: SceneObjectWithUVs,
  uvs: Uv2[],
  islandFaces: number[]
): void {
  if (islandFaces.length === 0) return

  let nx = 0
  let ny = 0
  let nz = 0
  for (const fi of islandFaces) {
    const n = faceNormal3D(obj, fi)
    nx += n.x
    ny += n.y
    nz += n.z
  }
  const len = Math.hypot(nx, ny, nz) || 1
  const avgNormal = { x: nx / len, y: ny / len, z: nz / len }

  const vertToUi = new Map<number, number[]>()
  for (const fi of islandFaces) {
    const face = obj.faces[fi]
    const uvIdx = obj.faceUvIndices[fi] ?? []
    for (let i = 0; i < face.length; i++) {
      const vi = face[i]
      const ui = uvIdx[i]
      if (ui === undefined) continue
      if (!vertToUi.has(vi)) vertToUi.set(vi, [])
      vertToUi.get(vi)!.push(ui)
    }
  }

  const vertList = [...vertToUi.keys()]
  const corners = vertList.map((vi) => obj.positions[vi]).filter(Boolean)
  const projected = planarProjectFaceUVs(avgNormal, corners)

  for (let i = 0; i < vertList.length; i++) {
    const uv = projected[i] ?? { u: 0, v: 0 }
    for (const ui of vertToUi.get(vertList[i]) ?? []) {
      uvs[ui] = { u: uv.u, v: uv.v }
    }
  }
}

function projectFacePlanar(obj: SceneObjectWithUVs, uvs: Uv2[], fi: number): void {
  const fIdx = obj.faceUvIndices[fi] ?? []
  const n = faceNormal3D(obj, fi)
  const corners = faceCorners3D(obj, fi)
  const projected = planarProjectFaceUVs(n, corners)
  for (let i = 0; i < fIdx.length; i++) {
    uvs[fIdx[i]] = projected[i] ?? uvs[fIdx[i]]
  }
}

function packIslandList(
  uvs: Uv2[],
  faceUvIndices: number[][],
  islands: number[][],
  margin = 0.02
): void {
  packFaceIslandsShelf(uvs, faceUvIndices, islands, margin)
}

function clusterFacesByNormalBucket(obj: SceneObject, faceIndices: number[]): Map<UvNormalBucket, number[]> {
  const buckets = new Map<UvNormalBucket, number[]>()
  for (const fi of faceIndices) {
    const bucket = classifyFaceNormalBucket(faceNormal3D(obj, fi))
    const list = buckets.get(bucket) ?? []
    list.push(fi)
    buckets.set(bucket, list)
  }
  return buckets
}

function packBlockbenchSubset(
  uvs: Uv2[],
  faceUvIndices: number[][],
  obj: SceneObject,
  faceIndices: number[],
  margin = 0.04
): void {
  const buckets = clusterFacesByNormalBucket(obj, faceIndices)
  const bucketIslands = [...buckets.entries()].map(([bucket, faces]) => {
    const slot = BLOCKBENCH_SLOTS[bucket]
    return { bucketCol: slot.col, bucketRow: slot.row, faces }
  })
  packCubeBucketsBlockbench(uvs, faceUvIndices, bucketIslands, margin)
}

/** Unwrap only the given faces; other face UVs are preserved. Returns new UV arrays. */
export function unwrapSelectedFaces(
  obj: SceneObjectWithUVs,
  faceIndices: number[],
  method: UvUnwrapMethod,
  options: UnwrapOptions = {}
): { uvs: Uv2[]; faceUvIndices: number[][]; uvAutoPacked?: boolean } {
  const margin = options.margin ?? 0.02
  const uvs = obj.uvs.map(cloneUv2)
  const faceUvIndices = obj.faceUvIndices.map((f) => [...f])
  const work: SceneObjectWithUVs = { ...obj, faceUvIndices }
  const allFaceCount = obj.faces.length
  const faces = faceIndices.filter((fi) => fi >= 0 && fi < allFaceCount)
  if (faces.length === 0) return { uvs, faceUvIndices }

  let resolved: UvUnwrapMethod = method === 'auto' ? resolveAutoUnwrapMethod(work) : method
  const fullMesh = faces.length >= allFaceCount
  const angleLimit =
    method === 'auto'
      ? AUTO_SEAM_ANGLE_DEG
      : options.angleLimitDeg ?? (resolved === 'smart' ? AUTO_SEAM_ANGLE_DEG : 89)

  if (method === 'auto' || fullMesh) {
    resolved = method === 'auto' ? resolved : resolved
    const allFaces = work.faces.map((_, i) => i)
    repackEntireMesh(
      work,
      uvs,
      faceUvIndices,
      resolved,
      angleLimit,
      margin,
      new Set(allFaces),
      true
    )
    return {
      uvs,
      faceUvIndices,
      uvAutoPacked: options.markPacked ?? (method === 'auto' || fullMesh),
    }
  }

  const touched = new Set(faces)

  switch (resolved) {
    case 'smart': {
      const islands = clusterFacesSmartUv(work, faces, angleLimit)
      for (const island of islands) {
        projectIslandPlanar(work, uvs, island)
        weldIslandUvTopology(faceUvIndices, uvs, work, island)
      }
      break
    }
    case 'regions': {
      const islands = clusterFacesPlanarRegions(work, faces)
      for (const island of islands) {
        projectIslandPlanar(work, uvs, island)
        weldIslandUvTopology(faceUvIndices, uvs, work, island)
      }
      break
    }
    case 'planar': {
      for (const fi of faces) projectFacePlanar(work, uvs, fi)
      break
    }
    case 'box':
    case 'blockbench': {
      const buckets = clusterFacesByNormalBucket(work, faces)
      for (const [, bucketFaces] of buckets) {
        projectIslandPlanar(work, uvs, bucketFaces)
        weldIslandUvTopology(faceUvIndices, uvs, work, bucketFaces)
      }
      break
    }
    case 'lightmap': {
      const islands = clusterFacesSmartUv(work, faces, Math.min(angleLimit, 45))
      for (const island of islands) {
        projectIslandPlanar(work, uvs, island)
        weldIslandUvTopology(faceUvIndices, uvs, work, island)
      }
      break
    }
  }

  if (options.repackAll !== false) {
    repackEntireMesh(
      work,
      uvs,
      faceUvIndices,
      resolved,
      angleLimit,
      margin,
      touched,
      !obj.uvAutoPacked
    )
  }

  return { uvs, faceUvIndices, uvAutoPacked: options.markPacked }
}

/** Full-mesh auto unwrap with implicit seams. */
export function autoUnwrapObject(obj: SceneObjectWithUVs, angleLimitDeg = AUTO_SEAM_ANGLE_DEG) {
  const allFaces = obj.faces.map((_, i) => i)
  return unwrapSelectedFaces(obj, allFaces, 'auto', {
    angleLimitDeg,
    margin: 0.02,
    repackAll: true,
    markPacked: true,
  })
}

/** Full-mesh blockbench pack (all faces) — uses connected regions per bucket. */
export function unwrapEntireMeshBlockbench(obj: SceneObjectWithUVs): { uvs: Uv2[]; faceUvIndices: number[][] } {
  const allFaces = obj.faces.map((_, i) => i)
  return unwrapSelectedFaces(obj, allFaces, 'blockbench', { angleLimitDeg: 89 })
}
