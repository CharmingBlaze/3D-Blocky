import type { SceneObject } from '../mesh/HalfEdgeMesh'
import { edgeKey } from '../mesh/meshSelection'
import { computeFaceGroups } from '../mesh/faceGroups'
import {
  faceCorners3D,
  faceNormal3D,
  isDoodleLikeObject,
  detachFacesUvTopology,
  type SceneObjectWithUVs,
} from './uvObject'
import {
  planarProjectFaceUVs,
  classifyFaceNormalBucket,
  fitUVsAspectPreserving,
  type UvNormalBucket,
} from './uvEditing'
import {
  packFaceIslandsBoxNet,
  packFaceIslandsRegionStrip,
  packFaceIslandsShelf,
  packFaceIslandsUniformGrid,
  packFacesDirectionAtlas,
  packPartialUnwrapIslands,
  splitUvIslandsForPacking,
  type BoxNetSize,
  type UvPackStyle,
} from './uvPack'
import type { Uv2 } from './uvTypes'
import { cloneUv2 } from './uvTypes'
import { worldPointFromObject } from '../mesh/objectTransform'
import type { Vec3 } from '../utils/math'
import {
  isOrthoView,
  normalizeViewType,
  type OrthoViewType,
  type ViewType,
} from '../scene/viewTypes'
import { worldToPlanePoint } from '../primitives/viewAxes'

/** Blender-style default: edges sharper than this become automatic seams. */
export const AUTO_SEAM_ANGLE_DEG = 66

/** Prefer another ortho view when the active one projects the selection nearly edge-on. */
const VIEW_PROJECTION_MIN_ASPECT = 0.08

export type UvUnwrapMethod =
  | 'auto'
  | 'smart'
  | 'regions'
  | 'planar'
  | 'box'
  | 'blockbench'
  | 'lightmap'
  | 'view'

export const UV_UNWRAP_METHODS: { id: UvUnwrapMethod; label: string; hint: string }[] = [
  {
    id: 'auto',
    label: 'Auto UV · Best Fit',
    hint: 'Picks the best Quadlo layout for the selection (cube-net, regions, or smart)',
  },
  {
    id: 'view',
    label: 'Project From View',
    hint: 'Camera projection from the active 3D viewport (aspect-correct)',
  },
  {
    id: 'smart',
    label: 'Smart UV Project',
    hint: 'Angle-limited connected islands, shelf-packed for organic / low-poly meshes',
  },
  {
    id: 'regions',
    label: 'Planar Regions',
    hint: 'Coplanar groups as islands in a paint-friendly horizontal strip',
  },
  {
    id: 'planar',
    label: 'Planar per Face',
    hint: 'Each face aspect-correct, packed into a uniform grid',
  },
  {
    id: 'box',
    label: 'Box / Cube Net',
    hint: 'AABB cube-net layout — faces land in direction cells (works on any mesh)',
  },
  {
    id: 'blockbench',
    label: 'Direction Atlas',
    hint: '4×3 direction cross; every face gets its own island in its normal slot',
  },
  {
    id: 'lightmap',
    label: 'Lightmap Pack',
    hint: 'Per-face stretch-fill grid — max texel use for paint / bake',
  },
]

export interface UnwrapOptions {
  angleLimitDeg?: number
  margin?: number
  /** Repack every island in the atlas after projecting the selection. */
  repackAll?: boolean
  markPacked?: boolean
  /** Screen right/up from the active viewport (required for perspective). */
  projectionAxes?: { right: Vec3; up: Vec3 }
  /** Active 3D viewport — ortho views use the shared view-axis table. */
  projectionView?: ViewType
}

export type ViewProjectionSpec =
  | { kind: 'ortho'; view: OrthoViewType }
  | { kind: 'axes'; right: Vec3; up: Vec3 }

const ORTHO_VIEWS: OrthoViewType[] = ['front', 'back', 'right', 'left', 'top', 'bottom']

function dot3(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

export function projectWorldPointToViewUV(point: Vec3, spec: ViewProjectionSpec): Uv2 {
  if (spec.kind === 'ortho') {
    const p = worldToPlanePoint(spec.view, point)
    return { u: p.x, v: p.y }
  }
  return {
    u: dot3(point, spec.right),
    v: dot3(point, spec.up),
  }
}

function projectedExtents(
  points: Vec3[],
  spec: ViewProjectionSpec
): { width: number; height: number; area: number } {
  let minU = Infinity
  let minV = Infinity
  let maxU = -Infinity
  let maxV = -Infinity
  for (const p of points) {
    const uv = projectWorldPointToViewUV(p, spec)
    minU = Math.min(minU, uv.u)
    minV = Math.min(minV, uv.v)
    maxU = Math.max(maxU, uv.u)
    maxV = Math.max(maxV, uv.v)
  }
  const width = Math.max(maxU - minU, 0)
  const height = Math.max(maxV - minV, 0)
  return { width, height, area: width * height }
}

function collectWorldCorners(obj: SceneObjectWithUVs, faces: number[]): Vec3[] {
  const out: Vec3[] = []
  const seen = new Set<number>()
  for (const fi of faces) {
    const face = obj.faces[fi]
    if (!face) continue
    for (const vi of face) {
      if (seen.has(vi)) continue
      seen.add(vi)
      const local = obj.positions[vi]
      if (!local) continue
      out.push(worldPointFromObject(obj, local))
    }
  }
  return out
}

function isUsableProjection(width: number, height: number): boolean {
  const min = Math.min(width, height)
  const max = Math.max(width, height)
  if (max < 1e-10) return false
  return min / max >= VIEW_PROJECTION_MIN_ASPECT
}

/**
 * Choose a view projection: prefer the active viewport, but if that view is nearly
 * edge-on to the selection (classic "narrow strip" failure), pick the ortho view
 * with the largest projected area.
 */
export function resolveViewProjectionSpec(
  obj: SceneObjectWithUVs,
  faces: number[],
  options: Pick<UnwrapOptions, 'projectionAxes' | 'projectionView'> = {}
): ViewProjectionSpec {
  const points = collectWorldCorners(obj, faces)
  if (points.length === 0) {
    return { kind: 'ortho', view: 'front' }
  }

  let preferred: ViewProjectionSpec | null = null
  const view = options.projectionView
  if (view && isOrthoView(view)) {
    preferred = { kind: 'ortho', view: normalizeViewType(view) as OrthoViewType }
  } else if (options.projectionAxes) {
    preferred = { kind: 'axes', right: options.projectionAxes.right, up: options.projectionAxes.up }
  }

  if (preferred) {
    const { width, height } = projectedExtents(points, preferred)
    if (isUsableProjection(width, height)) return preferred
  }

  let best: ViewProjectionSpec = preferred ?? { kind: 'ortho', view: 'front' }
  let bestScore = -1
  for (const ortho of ORTHO_VIEWS) {
    const spec: ViewProjectionSpec = { kind: 'ortho', view: ortho }
    const { width, height, area } = projectedExtents(points, spec)
    if (!isUsableProjection(width, height)) continue
    const bonus = preferred?.kind === 'ortho' && preferred.view === ortho ? area * 0.05 : 0
    const score = area + bonus
    if (score > bestScore) {
      bestScore = score
      best = spec
    }
  }
  return best
}

function projectFacesFromView(
  obj: SceneObjectWithUVs,
  uvs: Uv2[],
  faceUvIndices: number[][],
  faces: number[],
  spec: ViewProjectionSpec
): void {
  const touched = new Set<number>()
  for (const fi of faces) {
    const face = obj.faces[fi]
    const uvIdx = faceUvIndices[fi]
    if (!face || !uvIdx) continue
    for (let corner = 0; corner < face.length; corner++) {
      const ui = uvIdx[corner]
      const local = obj.positions[face[corner]!]
      if (ui === undefined || !local) continue
      const point = worldPointFromObject(obj, local)
      uvs[ui] = projectWorldPointToViewUV(point, spec)
      touched.add(ui)
    }
  }
  if (touched.size > 0) fitUVsAspectPreserving(uvs, [...touched], 1, 0.02)
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
export function resolveAutoUnwrapMethod(
  obj: SceneObject,
  faceIndices?: number[]
): UvUnwrapMethod {
  const indices =
    faceIndices && faceIndices.length > 0
      ? faceIndices.filter((fi) => fi >= 0 && fi < obj.faces.length)
      : obj.faces.map((_, i) => i)

  if (indices.length === 0) return 'smart'
  if (obj.uvMappingMode === 'box' || isDoodleLikeObject(obj)) return 'box'

  const buckets = new Map<string, number>()
  for (const fi of indices) {
    const b = classifyFaceNormalBucket(faceNormal3D(obj, fi))
    buckets.set(b, (buckets.get(b) ?? 0) + 1)
  }

  const bucketCount = buckets.size
  const faceCount = indices.length
  const largestBucket = Math.max(...buckets.values(), 0)
  const bucketBalance = largestBucket / Math.max(faceCount, 1)

  if (bucketCount >= 4 && bucketCount <= 6 && bucketBalance < 0.55) return 'box'
  if (faceCount <= 48 && bucketCount <= 8) return 'regions'
  return 'smart'
}

function aabbSizeForFaces(obj: SceneObject, faces: number[]): BoxNetSize {
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  const seen = new Set<number>()
  for (const fi of faces) {
    const face = obj.faces[fi]
    if (!face) continue
    for (const vi of face) {
      if (seen.has(vi)) continue
      seen.add(vi)
      const p = obj.positions[vi]
      if (!p) continue
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y)
      minZ = Math.min(minZ, p.z)
      maxX = Math.max(maxX, p.x)
      maxY = Math.max(maxY, p.y)
      maxZ = Math.max(maxZ, p.z)
    }
  }
  if (!Number.isFinite(minX)) return { x: 1, y: 1, z: 1 }
  return {
    x: Math.max(maxX - minX, 1e-4),
    y: Math.max(maxY - minY, 1e-4),
    z: Math.max(maxZ - minZ, 1e-4),
  }
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

/** Coplanar adjacent face groups. */
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
  const workUvs: SceneObjectWithUVs = { ...work, uvs, faceUvIndices }

  if (layout === 'box') {
    const buckets = clusterFacesByNormalBucket(work, allFaces)
    for (const [, bucketFaces] of buckets) {
      const touch = projectUntouched || bucketFaces.some((fi) => touchedFaces.has(fi))
      if (touch) {
        projectIslandPlanar(workUvs, uvs, bucketFaces)
        weldIslandUvTopology(faceUvIndices, uvs, work, bucketFaces)
      }
    }
    const bucketList = [...buckets.entries()].map(([bucket, faces]) => ({ bucket, faces }))
    splitUvIslandsForPacking(
      uvs,
      faceUvIndices,
      bucketList.map((b) => b.faces)
    )
    packFaceIslandsBoxNet(uvs, faceUvIndices, bucketList, aabbSizeForFaces(work, allFaces), margin)
    return
  }

  if (layout === 'blockbench') {
    for (const fi of allFaces) {
      if (projectUntouched || touchedFaces.has(fi)) projectFacePlanar(workUvs, uvs, fi)
    }
    const directionFaces = allFaces.map((fi) => ({
      fi,
      bucket: classifyFaceNormalBucket(faceNormal3D(work, fi)),
    }))
    packFacesDirectionAtlas(uvs, faceUvIndices, directionFaces, margin)
    return
  }

  if (layout === 'planar') {
    const islands = allFaces.map((fi) => [fi])
    for (const fi of allFaces) {
      if (projectUntouched || touchedFaces.has(fi)) projectFacePlanar(workUvs, uvs, fi)
    }
    packFaceIslandsUniformGrid(uvs, faceUvIndices, islands, margin, { stretch: false })
    return
  }

  if (layout === 'lightmap') {
    const islands = allFaces.map((fi) => [fi])
    for (const fi of allFaces) {
      if (projectUntouched || touchedFaces.has(fi)) projectFacePlanar(workUvs, uvs, fi)
    }
    packFaceIslandsUniformGrid(uvs, faceUvIndices, islands, margin, {
      stretch: true,
      columns: 'row',
    })
    return
  }

  const islands =
    layout === 'regions'
      ? clusterFacesPlanarRegions(work, allFaces)
      : clusterFacesSmartUv(work, allFaces, angleLimit)

  for (const island of islands) {
    const touch = projectUntouched || island.some((fi) => touchedFaces.has(fi))
    if (touch) {
      projectIslandPlanar(workUvs, uvs, island)
      weldIslandUvTopology(faceUvIndices, uvs, work, island)
    }
  }

  if (layout === 'regions') {
    packFaceIslandsRegionStrip(uvs, faceUvIndices, islands, margin)
  } else {
    packFaceIslandsShelf(uvs, faceUvIndices, islands, margin)
  }
}

/** Unwrap only the given faces; other face UVs are preserved. Returns new UV arrays. */
export function unwrapSelectedFaces(
  obj: SceneObjectWithUVs,
  faceIndices: number[],
  method: UvUnwrapMethod,
  options: UnwrapOptions = {}
): { uvs: Uv2[]; faceUvIndices: number[][]; uvAutoPacked?: boolean } {
  const margin = options.margin ?? 0.02
  const allFaceCount = obj.faces.length
  const faces = faceIndices.filter((fi) => fi >= 0 && fi < allFaceCount)
  if (faces.length === 0) {
    return {
      uvs: obj.uvs.map(cloneUv2),
      faceUvIndices: obj.faceUvIndices.map((f) => [...f]),
    }
  }

  const fullMesh = faces.length >= allFaceCount
  if (method === 'view') {
    const spec = resolveViewProjectionSpec(obj, faces, options)
    const source = fullMesh ? obj : detachFacesUvTopology(obj, faces)
    const uvs = source.uvs.map(cloneUv2)
    const faceUvIndices = source.faceUvIndices.map((face) => [...face])
    projectFacesFromView({ ...obj, uvs, faceUvIndices }, uvs, faceUvIndices, faces, spec)
    if (!fullMesh) {
      packPartialUnwrapIslands(uvs, faceUvIndices, allFaceCount, faces, [faces], margin, {
        skipRefit: true,
      })
    }
    return { uvs, faceUvIndices, uvAutoPacked: true }
  }

  let resolved: UvUnwrapMethod =
    method === 'auto' ? resolveAutoUnwrapMethod(obj, fullMesh ? undefined : faces) : method
  const angleLimit =
    method === 'auto'
      ? AUTO_SEAM_ANGLE_DEG
      : options.angleLimitDeg ?? (resolved === 'smart' ? AUTO_SEAM_ANGLE_DEG : 89)

  if (fullMesh) {
    const uvs = obj.uvs.map(cloneUv2)
    const faceUvIndices = obj.faceUvIndices.map((f) => [...f])
    const work: SceneObjectWithUVs = { ...obj, faceUvIndices }
    repackEntireMesh(
      work,
      uvs,
      faceUvIndices,
      resolved,
      angleLimit,
      margin,
      new Set(faces),
      true
    )
    return {
      uvs,
      faceUvIndices,
      uvAutoPacked: options.markPacked ?? true,
    }
  }

  const detached = detachFacesUvTopology(obj, faces)
  const uvs = detached.uvs.map(cloneUv2)
  const faceUvIndices = detached.faceUvIndices.map((f) => [...f])
  const work: SceneObjectWithUVs = { ...obj, uvs, faceUvIndices }

  let selectionIslands: number[][] = []
  let packStyle: UvPackStyle = 'shelf'
  let boxNet: { size: BoxNetSize; buckets: { bucket: UvNormalBucket; faces: number[] }[] } | undefined
  let directionFaces: { fi: number; bucket: UvNormalBucket }[] | undefined

  switch (resolved) {
    case 'smart': {
      selectionIslands = clusterFacesSmartUv(work, faces, angleLimit)
      for (const island of selectionIslands) {
        projectIslandPlanar(work, uvs, island)
        weldIslandUvTopology(faceUvIndices, uvs, work, island)
      }
      packStyle = 'shelf'
      break
    }
    case 'regions': {
      selectionIslands = clusterFacesPlanarRegions(work, faces)
      for (const island of selectionIslands) {
        projectIslandPlanar(work, uvs, island)
        weldIslandUvTopology(faceUvIndices, uvs, work, island)
      }
      packStyle = 'regionStrip'
      break
    }
    case 'planar': {
      selectionIslands = faces.map((fi) => [fi])
      for (const fi of faces) projectFacePlanar(work, uvs, fi)
      packStyle = 'grid'
      break
    }
    case 'box': {
      const buckets = clusterFacesByNormalBucket(work, faces)
      selectionIslands = [...buckets.values()]
      for (const bucketFaces of selectionIslands) {
        projectIslandPlanar(work, uvs, bucketFaces)
        weldIslandUvTopology(faceUvIndices, uvs, work, bucketFaces)
      }
      packStyle = 'boxNet'
      boxNet = {
        size: aabbSizeForFaces(work, faces),
        buckets: [...buckets.entries()].map(([bucket, bucketFaces]) => ({
          bucket,
          faces: bucketFaces,
        })),
      }
      break
    }
    case 'blockbench': {
      selectionIslands = faces.map((fi) => [fi])
      for (const fi of faces) projectFacePlanar(work, uvs, fi)
      packStyle = 'directionAtlas'
      directionFaces = faces.map((fi) => ({
        fi,
        bucket: classifyFaceNormalBucket(faceNormal3D(work, fi)),
      }))
      break
    }
    case 'lightmap': {
      // Always per-face stretch — never collapse to smart/shelf.
      selectionIslands = faces.map((fi) => [fi])
      for (const fi of faces) projectFacePlanar(work, uvs, fi)
      packStyle = 'gridStretch'
      break
    }
    case 'view':
      break
  }

  if (options.repackAll !== false && selectionIslands.length > 0) {
    packPartialUnwrapIslands(uvs, faceUvIndices, allFaceCount, faces, selectionIslands, margin, {
      packStyle,
      boxNet,
      directionFaces,
    })
  }

  return { uvs, faceUvIndices, uvAutoPacked: options.markPacked ?? false }
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

/** Full-mesh direction-atlas pack (all faces). */
export function unwrapEntireMeshBlockbench(obj: SceneObjectWithUVs): { uvs: Uv2[]; faceUvIndices: number[][] } {
  const allFaces = obj.faces.map((_, i) => i)
  return unwrapSelectedFaces(obj, allFaces, 'blockbench', { angleLimitDeg: 89 })
}