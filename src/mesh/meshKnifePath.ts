/**
 * Blockbench-inspired knife path apply.
 *
 * Blockbench (js/modeling/mesh/knife_tool.js) does NOT bandsaw with a view plane.
 * It places snapped points (vert / edge / face), then for each touched face:
 *   1. inserts shared edge vertices
 *   2. deletes the old face
 *   3. refills with quads preferred, then triangles
 *   4. preserves winding + UVs
 *
 * We adapt those ideas to Quadlo's index-based SceneObject (no key-string verts).
 */
import type { SceneObject } from './HalfEdgeMesh'
import { cloneSceneObject } from './meshOps'
import { edgeKey } from './meshSelection'
import {
  areAdjacentOnFace,
  removeUnreferencedVertices,
  splitFaceAtChord,
} from './meshTopologyOps'
import { splitFaceGroupsAfterCut } from './faceGroups'
import { weldSceneObjectCoincidentVertices } from './subdivisionSurface'
import type { Vec3 } from '../utils/math'

const EPS = 1e-6
const POS_EPS = 1e-5

export type KnifeAttachPoint = {
  local: Vec3
  snap?: string
  vertexIndex?: number | null
  edge?: [number, number] | null
  faceIndex?: number | null
}

type Uv2 = { u: number; v: number }

function dist2(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  const dz = a.z - b.z
  return dx * dx + dy * dy + dz * dz
}

function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  }
}

function edgeParam(pa: Vec3, pb: Vec3, p: Vec3): number {
  const abx = pb.x - pa.x
  const aby = pb.y - pa.y
  const abz = pb.z - pa.z
  const len2 = abx * abx + aby * aby + abz * abz
  if (len2 < EPS * EPS) return 0
  const t = ((p.x - pa.x) * abx + (p.y - pa.y) * aby + (p.z - pa.z) * abz) / len2
  return Math.max(0, Math.min(1, t))
}

function sameEdge(a: [number, number], b: [number, number]): boolean {
  return (a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0])
}

function faceHasVerts(face: number[], a: number, b: number): boolean {
  return face.includes(a) && face.includes(b)
}

/** Soft weld that keeps UV corner indices (unlike subdivision weld). */
export function weldCoincidentVerticesKeepUvs(obj: SceneObject, eps = POS_EPS): SceneObject {
  if (obj.positions.length < 2) return obj
  const eps2 = eps * eps
  const n = obj.positions.length
  const parent = Array.from({ length: n }, (_, i) => i)

  const find = (i: number): number => {
    let r = i
    while (parent[r] !== r) r = parent[r]!
    let x = i
    while (parent[x] !== x) {
      const next = parent[x]!
      parent[x] = r
      x = next
    }
    return r
  }
  const unite = (a: number, b: number) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[rb] = ra
  }

  for (let i = 0; i < n; i++) {
    const pi = obj.positions[i]!
    for (let j = i + 1; j < n; j++) {
      if (dist2(pi, obj.positions[j]!) <= eps2) unite(i, j)
    }
  }

  const roots = new Map<number, number>()
  const positions: Vec3[] = []
  for (let i = 0; i < n; i++) {
    const r = find(i)
    if (!roots.has(r)) {
      roots.set(r, positions.length)
      positions.push({ ...obj.positions[r]! })
    }
  }

  const remap = (vi: number) => roots.get(find(vi))!

  const faces: number[][] = []
  const faceColors: number[] = []
  const faceUvIndices: number[][] | undefined = obj.faceUvIndices ? [] : undefined
  const oldToNewFace = new Map<number, number>()

  for (let fi = 0; fi < obj.faces.length; fi++) {
    const mapped = obj.faces[fi]!.map(remap)
    const dedup: number[] = []
    for (const vi of mapped) {
      if (dedup[dedup.length - 1] !== vi) dedup.push(vi)
    }
    if (dedup.length >= 3 && dedup[0] === dedup[dedup.length - 1]) dedup.pop()
    if (dedup.length < 3 || new Set(dedup).size < 3) continue
    oldToNewFace.set(fi, faces.length)
    faces.push(dedup)
    faceColors.push(obj.faceColors[fi] ?? obj.color)
    if (faceUvIndices && obj.faceUvIndices?.[fi]) {
      // Keep UV ring aligned to surviving corners (drop slots for collapsed verts).
      const srcUv = obj.faceUvIndices[fi]!
      const srcFace = obj.faces[fi]!
      const uvRing: number[] = []
      for (let i = 0; i < srcFace.length; i++) {
        if (remap(srcFace[i]!) === dedup[uvRing.length]) {
          uvRing.push(srcUv[i]!)
        }
      }
      // Fallback: if alignment failed, reuse first N
      if (uvRing.length !== dedup.length) {
        faceUvIndices.push(dedup.map((_, i) => srcUv[Math.min(i, srcUv.length - 1)]!))
      } else {
        faceUvIndices.push(uvRing)
      }
    }
  }

  if (faces.length === 0) return obj

  const faceGroups = obj.faceGroups
    ?.map((g) =>
      g.map((fi) => oldToNewFace.get(fi)).filter((fi): fi is number => fi !== undefined)
    )
    .filter((g) => g.length > 0)

  return removeUnreferencedVertices({
    ...obj,
    positions,
    faces,
    faceColors,
    faceGroups: faceGroups?.length ? faceGroups : obj.faceGroups,
    faceUvIndices: faceUvIndices ?? obj.faceUvIndices,
  })
}

/**
 * Post-cut cleanup inspired by Blockbench auto-merge / mesh fix:
 * drop degenerate rings, weld coincident seam verts (keep UVs), and
 * flip faces that fight their neighbors across a shared edge.
 */
export function cleanupCutTopology(obj: SceneObject): SceneObject {
  const faces: number[][] = []
  const faceColors: number[] = []
  const faceUvIndices: number[][] | undefined = obj.faceUvIndices ? [] : undefined
  const oldToNew = new Map<number, number>()

  for (let fi = 0; fi < obj.faces.length; fi++) {
    const face = obj.faces[fi]!
    const clean: number[] = []
    for (const vi of face) {
      if (clean[clean.length - 1] !== vi) clean.push(vi)
    }
    if (clean.length >= 3 && clean[0] === clean[clean.length - 1]) clean.pop()
    if (clean.length < 3 || new Set(clean).size < 3) continue
    oldToNew.set(fi, faces.length)
    faces.push(clean)
    faceColors.push(obj.faceColors[fi] ?? obj.color)
    if (faceUvIndices) {
      const srcUv = obj.faceUvIndices?.[fi]
      if (srcUv && srcUv.length === face.length) {
        // Drop UV slots for collapsed duplicate verts.
        const uvRing: number[] = []
        for (let i = 0; i < face.length; i++) {
          if (clean[uvRing.length] === face[i]) uvRing.push(srcUv[i]!)
        }
        faceUvIndices.push(
          uvRing.length === clean.length
            ? uvRing
            : clean.map((_, i) => srcUv[Math.min(i, srcUv.length - 1)]!)
        )
      } else {
        faceUvIndices.push(srcUv ? [...srcUv] : [])
      }
    }
  }

  const faceGroups = obj.faceGroups
    ?.map((g) => g.map((fi) => oldToNew.get(fi)).filter((fi): fi is number => fi !== undefined))
    .filter((g) => g.length > 0)

  const welded = weldCoincidentVerticesKeepUvs(
    removeUnreferencedVertices({
      ...obj,
      faces,
      faceColors,
      faceGroups: faceGroups?.length ? faceGroups : undefined,
      faceUvIndices: faceUvIndices ?? obj.faceUvIndices,
    })
  )

  return repairFaceWinding(welded)
}

/** Flip faces whose winding fights a neighbor across a shared edge. */
function repairFaceWinding(obj: SceneObject): SceneObject {
  if (obj.faces.length < 2) return obj
  const faces = obj.faces.map((f) => [...f])
  const faceUvIndices = obj.faceUvIndices?.map((f) => [...f])

  // Build undirected edge → incident (face, directed a→b) list.
  type Inc = { fi: number; a: number; b: number }
  const edgeInc = new Map<string, Inc[]>()
  for (let fi = 0; fi < faces.length; fi++) {
    const face = faces[fi]!
    for (let i = 0; i < face.length; i++) {
      const a = face[i]!
      const b = face[(i + 1) % face.length]!
      const k = edgeKey(a, b)
      const list = edgeInc.get(k) ?? []
      list.push({ fi, a, b })
      edgeInc.set(k, list)
    }
  }

  // BFS: keep first face, flip others when they share an edge with the same direction.
  const visited = new Set<number>()
  const queue: number[] = []
  for (let start = 0; start < faces.length; start++) {
    if (visited.has(start)) continue
    visited.add(start)
    queue.push(start)
    while (queue.length) {
      const fi = queue.shift()!
      const face = faces[fi]!
      for (let i = 0; i < face.length; i++) {
        const a = face[i]!
        const b = face[(i + 1) % face.length]!
        const neighbors = edgeInc.get(edgeKey(a, b)) ?? []
        for (const n of neighbors) {
          if (n.fi === fi || visited.has(n.fi)) continue
          visited.add(n.fi)
          queue.push(n.fi)
          // Same directed edge on both faces ⇒ opposite winding needed.
          if (n.a === a && n.b === b) {
            faces[n.fi] = [...faces[n.fi]!].reverse()
            if (faceUvIndices?.[n.fi]) {
              faceUvIndices[n.fi] = [...faceUvIndices[n.fi]!].reverse()
            }
            // Update stored incidences for the flipped face.
            const flipped = faces[n.fi]!
            for (let j = 0; j < flipped.length; j++) {
              const fa = flipped[j]!
              const fb = flipped[(j + 1) % flipped.length]!
              const list = edgeInc.get(edgeKey(fa, fb))
              if (!list) continue
              for (const inc of list) {
                if (inc.fi === n.fi) {
                  inc.a = fa
                  inc.b = fb
                }
              }
            }
          }
        }
      }
    }
  }

  return {
    ...obj,
    faces,
    faceUvIndices: faceUvIndices ?? obj.faceUvIndices,
  }
}

function pointBelongsToFace(
  face: number[],
  point: KnifeAttachPoint,
  vkey: number
): boolean {
  if (face.includes(vkey)) return true
  if (point.faceIndex != null) {
    // faceIndex checked by caller; here we only know the face loop
  }
  if (point.edge && faceHasVerts(face, point.edge[0], point.edge[1])) return true
  if (point.vertexIndex != null && face.includes(point.vertexIndex)) return true
  return false
}

type Resolved = {
  vkey: number
  kind: 'vertex' | 'edge' | 'face'
  edge: [number, number] | null
  faceIndex: number | null
  local: Vec3
  pathIndex: number
}

function projectToFlat(normal: Vec3, origin: Vec3, p: Vec3): [number, number] {
  // Build a stable tangent basis from the face normal.
  const up =
    Math.abs(normal.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 }
  const tx = {
    x: up.y * normal.z - up.z * normal.y,
    y: up.z * normal.x - up.x * normal.z,
    z: up.x * normal.y - up.y * normal.x,
  }
  const tlen = Math.hypot(tx.x, tx.y, tx.z) || 1
  tx.x /= tlen
  tx.y /= tlen
  tx.z /= tlen
  const ty = {
    x: normal.y * tx.z - normal.z * tx.y,
    y: normal.z * tx.x - normal.x * tx.z,
    z: normal.x * tx.y - normal.y * tx.x,
  }
  const d = { x: p.x - origin.x, y: p.y - origin.y, z: p.z - origin.z }
  return [d.x * tx.x + d.y * tx.y + d.z * tx.z, d.x * ty.x + d.y * ty.y + d.z * ty.z]
}

function faceNormal(positions: Vec3[], face: number[]): Vec3 {
  let nx = 0
  let ny = 0
  let nz = 0
  const n = face.length
  for (let i = 0; i < n; i++) {
    const a = positions[face[i]!]!
    const b = positions[face[(i + 1) % n]!]!
    nx += (a.y - b.y) * (a.z + b.z)
    ny += (a.z - b.z) * (a.x + b.x)
    nz += (a.x - b.x) * (a.y + b.y)
  }
  const len = Math.hypot(nx, ny, nz) || 1
  return { x: nx / len, y: ny / len, z: nz / len }
}

function orientMatches(positions: Vec3[], ref: number[], candidate: number[]): boolean {
  const rn = faceNormal(positions, ref)
  const cn = faceNormal(positions, candidate)
  return rn.x * cn.x + rn.y * cn.y + rn.z * cn.z >= 0
}

function isConcaveQuad(positions: Vec3[], verts: number[]): boolean {
  if (verts.length !== 4) return false
  const n = faceNormal(positions, verts)
  for (let i = 0; i < 4; i++) {
    const a = positions[verts[(i + 3) % 4]!]!
    const b = positions[verts[i]!]!
    const c = positions[verts[(i + 1) % 4]!]!
    const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }
    const bc = { x: c.x - b.x, y: c.y - b.y, z: c.z - b.z }
    const cross = {
      x: ab.y * bc.z - ab.z * bc.y,
      y: ab.z * bc.x - ab.x * bc.z,
      z: ab.x * bc.y - ab.y * bc.x,
    }
    if (cross.x * n.x + cross.y * n.y + cross.z * n.z < -EPS) return true
  }
  return false
}

/** Blockbench rejects needle/spike corners (<~2°) and near-flat reflex (>178°). */
function cornerAngleDeg(positions: Vec3[], verts: number[], index: number): number {
  const n = verts.length
  const a = positions[verts[(index + n - 1) % n]!]!
  const b = positions[verts[index]!]!
  const c = positions[verts[(index + 1) % n]!]!
  const ab = { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
  const cb = { x: c.x - b.x, y: c.y - b.y, z: c.z - b.z }
  const lab = Math.hypot(ab.x, ab.y, ab.z)
  const lcb = Math.hypot(cb.x, cb.y, cb.z)
  if (lab < EPS || lcb < EPS) return 0
  const dot = (ab.x * cb.x + ab.y * cb.y + ab.z * cb.z) / (lab * lcb)
  return (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI
}

function cornersOk(positions: Vec3[], verts: number[], minDeg: number): boolean {
  for (let i = 0; i < verts.length; i++) {
    const ang = cornerAngleDeg(positions, verts, i)
    if (ang < minDeg || ang > 178) return false
  }
  return true
}

/**
 * Interpolate a UV for a new vertex from the old face UV ring (Blockbench localToUV idea).
 * Uses inverse-distance weighting over the original corners in the face plane.
 */
function interpolateFaceUv(
  positions: Vec3[],
  oldFace: number[],
  oldUvRing: number[] | null | undefined,
  uvs: Uv2[] | null,
  vi: number
): Uv2 {
  if (!oldUvRing || !uvs || oldUvRing.length !== oldFace.length) {
    return { u: 0, v: 0 }
  }
  const p = positions[vi]!
  let wSum = 0
  let uAcc = 0
  let vAcc = 0
  for (let i = 0; i < oldFace.length; i++) {
    const d = Math.sqrt(dist2(p, positions[oldFace[i]!]!)) + 1e-8
    const w = 1 / d
    const uv = uvs[oldUvRing[i]!] ?? { u: 0, v: 0 }
    uAcc += uv.u * w
    vAcc += uv.v * w
    wSum += w
  }
  return { u: uAcc / wSum, v: vAcc / wSum }
}

function pointInTri2(
  p: [number, number],
  a: [number, number],
  b: [number, number],
  c: [number, number]
): boolean {
  const sign = (p1: [number, number], p2: [number, number], p3: [number, number]) =>
    (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1])
  const b1 = sign(p, a, b) < 0
  const b2 = sign(p, b, c) < 0
  const b3 = sign(p, c, a) < 0
  return b1 === b2 && b2 === b3
}

function segmentsIntersect2(
  a: [number, number],
  b: [number, number],
  c: [number, number],
  d: [number, number]
): boolean {
  const cross = (o: [number, number], p: [number, number], q: [number, number]) =>
    (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0])
  const d1 = cross(a, b, c)
  const d2 = cross(a, b, d)
  const d3 = cross(c, d, a)
  const d4 = cross(c, d, b)
  if (((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) &&
      ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS))) {
    return true
  }
  return false
}

/**
 * Remesh one face after knife cuts — prefer quads, then tris (Blockbench strategy).
 * Returns null if the fill would leave uncovered perimeter (holes).
 */
function remeshFaceBlockbench(
  positions: Vec3[],
  oldFace: number[],
  included: Resolved[],
  midEdges: Array<[number, number]>
): number[][] | null {
  if (included.length < 2) return null

  // Fast path: single chord between two boundary verts → keep n-gons / quads clean.
  const interior = included.filter((p) => p.kind === 'face')
  if (interior.length === 0 && midEdges.length === 1) {
    const [a, b] = midEdges[0]!
    if (oldFace.includes(a) && oldFace.includes(b)) {
      const ia = oldFace.indexOf(a)
      const ib = oldFace.indexOf(b)
      const n = oldFace.length
      const segA: number[] = []
      const segB: number[] = []
      let i = ia
      do {
        segA.push(oldFace[i]!)
        i = (i + 1) % n
      } while (i !== ib)
      segA.push(oldFace[ib]!)
      i = ib
      do {
        segB.push(oldFace[i]!)
        i = (i + 1) % n
      } while (i !== ia)
      segB.push(oldFace[ia]!)
      if (segA.length >= 3 && segB.length >= 3) return [segA, segB]
    }
  }

  const normal = faceNormal(positions, oldFace)
  const origin = positions[oldFace[0]!]!
  const flat = (vi: number) => projectToFlat(normal, origin, positions[vi]!)

  // Perimeter with edge-split verts inserted (Blockbench perimeter walk).
  const perimeter: number[] = []
  for (let i = 0; i < oldFace.length; i++) {
    const va = oldFace[i]!
    const vb = oldFace[(i + 1) % oldFace.length]!
    perimeter.push(va)
    // Edge-split verts are usually already in oldFace (shared split). Also pull any
    // included edge snaps that still reference this boundary segment.
    const onEdge = included
      .filter(
        (p) =>
          p.kind === 'edge' &&
          p.edge &&
          sameEdge(p.edge, [va, vb]) &&
          p.vkey !== va &&
          p.vkey !== vb &&
          !oldFace.includes(p.vkey)
      )
      .map((p) => p.vkey)
      .filter((v, idx, arr) => arr.indexOf(v) === idx)
    const pa = positions[va]!
    // Ascending distance from va so the perimeter walks edge start → end.
    onEdge.sort((a, b) => dist2(positions[a]!, pa) - dist2(positions[b]!, pa))
    perimeter.push(...onEdge)
  }

  const perimeterEdges: Array<[number, number]> = []
  for (let i = 0; i < perimeter.length; i++) {
    perimeterEdges.push([perimeter[i]!, perimeter[(i + 1) % perimeter.length]!])
  }

  const perimeterSet = new Set(perimeter)
  const midPointVkeys = interior.map((p) => p.vkey)
  const allCutVkeys = [...new Set(included.map((p) => p.vkey))]

  // Blockbench: mid-edges are planned cuts that aren't purely on the perimeter ring.
  const liveMidEdges: Array<[number, number]> = []
  for (const e of midEdges) {
    const bothPerimeter = perimeterSet.has(e[0]) && perimeterSet.has(e[1])
    const isPerimeterEdge = perimeterEdges.some((pe) => sameEdge(pe, e))
    if (!bothPerimeter || !isPerimeterEdge) {
      if (!liveMidEdges.some((m) => sameEdge(m, e))) liveMidEdges.push([...e] as [number, number])
    }
  }
  // Ensure consecutive path cuts that touch this face are present.
  for (let i = 0; i + 1 < included.length; i++) {
    const a = included[i]!.vkey
    const b = included[i + 1]!.vkey
    if (a === b) continue
    const e: [number, number] = [a, b]
    if (perimeterEdges.some((pe) => sameEdge(pe, e))) continue
    if (!liveMidEdges.some((m) => sameEdge(m, e))) liveMidEdges.push(e)
  }

  const edgeKeyOf = (e: [number, number]) => edgeKey(e[0], e[1])
  const coveredPerimeter = new Set<string>()
  const edgeFaceCount = new Map<string, number>()
  const created: number[][] = []
  const generatedEdges: Array<[number, number]> = []

  const thingsInTri = (v0: number, v1: number, v2: number): boolean => {
    const f0 = flat(v0)
    const f1 = flat(v1)
    const f2 = flat(v2)
    for (const vi of midPointVkeys) {
      if (vi === v0 || vi === v1 || vi === v2) continue
      if (pointInTri2(flat(vi), f0, f1, f2)) return true
    }
    const edges = [...liveMidEdges, ...generatedEdges]
    for (const [ea, eb] of edges) {
      if (
        sameEdge([ea, eb], [v0, v1]) ||
        sameEdge([ea, eb], [v1, v2]) ||
        sameEdge([ea, eb], [v2, v0])
      ) {
        continue
      }
      if (segmentsIntersect2(flat(ea), flat(eb), f0, f1)) return true
      if (segmentsIntersect2(flat(ea), flat(eb), f1, f2)) return true
      if (segmentsIntersect2(flat(ea), flat(eb), f2, f0)) return true
    }
    return false
  }

  const occupied = (edge: [number, number]): boolean => {
    const k = edgeKeyOf(edge)
    if (coveredPerimeter.has(k)) return true
    return (edgeFaceCount.get(k) ?? 0) >= 2
  }

  const tryQuad = (verts: number[]): number[] | null => {
    if (verts.length !== 4 || verts.some((v) => v == null)) return null
    if (new Set(verts).size !== 4) return null
    if (isConcaveQuad(positions, verts)) return null
    if (!cornersOk(positions, verts, 1)) return null
    // Reject if a mid-edge is a diagonal of this quad
    const diag1: [number, number] = [verts[0]!, verts[2]!]
    const diag2: [number, number] = [verts[1]!, verts[3]!]
    if (liveMidEdges.some((e) => sameEdge(e, diag1) || sameEdge(e, diag2))) return null
    const edges: Array<[number, number]> = [
      [verts[0]!, verts[1]!],
      [verts[1]!, verts[2]!],
      [verts[2]!, verts[3]!],
      [verts[3]!, verts[0]!],
    ]
    if (edges.some(occupied)) return null
    if (created.some((f) => f.length === 4 && verts.every((v) => f.includes(v)))) return null
    if (thingsInTri(verts[0]!, verts[1]!, verts[2]!)) return null
    if (thingsInTri(verts[0]!, verts[2]!, verts[3]!)) return null
    if (thingsInTri(verts[0]!, verts[1]!, verts[3]!)) return null
    if (thingsInTri(verts[1]!, verts[2]!, verts[3]!)) return null
    return [...verts]
  }

  const tryTri = (verts: number[]): number[] | null => {
    if (verts.length !== 3 || new Set(verts).size !== 3) return null
    if (!cornersOk(positions, verts, 2)) return null
    if (created.some((f) => f.length === 3 && verts.every((v) => f.includes(v)))) return null
    if (thingsInTri(verts[0]!, verts[1]!, verts[2]!)) return null
    const edges: Array<[number, number]> = [
      [verts[0]!, verts[1]!],
      [verts[1]!, verts[2]!],
      [verts[2]!, verts[0]!],
    ]
    if (edges.some(occupied)) return null
    return [...verts]
  }

  const commit = (face: number[]) => {
    let out = face
    if (!orientMatches(positions, oldFace, out)) out = [...out].reverse()
    created.push(out)
    const edges: Array<[number, number]> = []
    for (let i = 0; i < out.length; i++) {
      edges.push([out[i]!, out[(i + 1) % out.length]!])
    }
    for (const e of edges) {
      const k = edgeKeyOf(e)
      edgeFaceCount.set(k, (edgeFaceCount.get(k) ?? 0) + 1)
      if (
        !liveMidEdges.some((m) => sameEdge(m, e)) &&
        !perimeterEdges.some((m) => sameEdge(m, e)) &&
        !generatedEdges.some((m) => sameEdge(m, e))
      ) {
        generatedEdges.push(e)
      }
    }
  }

  const nearestFrom = (edge: [number, number], pool: number[]): number[] => {
    const ca = positions[edge[0]!]!
    const cb = positions[edge[1]!]!
    const center = {
      x: (ca.x + cb.x) * 0.5,
      y: (ca.y + cb.y) * 0.5,
      z: (ca.z + cb.z) * 0.5,
    }
    return [...pool]
      .filter((v) => v !== edge[0] && v !== edge[1])
      .sort((a, b) => dist2(positions[a]!, center) - dist2(positions[b]!, center))
  }

  const tryQuadsFrom = (edge: [number, number], nearest: number[]): number[] | null =>
    tryQuad([edge[0], edge[1], nearest[0]!, nearest[1]!]) ||
    tryQuad([edge[0], edge[1], nearest[0]!, nearest[2]!]) ||
    tryQuad([edge[0], edge[1], nearest[1]!, nearest[2]!]) ||
    tryQuad([edge[0], edge[1], nearest[0]!, nearest[3]!]) ||
    tryQuad([edge[0], edge[1], nearest[1]!, nearest[3]!]) ||
    tryQuad([edge[0], edge[1], nearest[2]!, nearest[3]!]) ||
    null

  // Grow from perimeter inward (Blockbench).
  for (const edge of perimeterEdges) {
    const pool = [
      ...midPointVkeys,
      ...perimeter.filter((v) => v !== edge[0] && v !== edge[1]),
      ...allCutVkeys,
    ]
    const nearest = nearestFrom(edge, pool)
    let face: number[] | null = tryQuadsFrom(edge, nearest)
    if (!face) {
      for (const vi of nearest) {
        face = tryTri([edge[0], edge[1], vi])
        if (face) break
      }
    }
    if (face) {
      commit(face)
      coveredPerimeter.add(edgeKeyOf(edge))
      for (let i = 0; i < face.length; i++) {
        const e: [number, number] = [face[i]!, face[(i + 1) % face.length]!]
        if (perimeterEdges.some((pe) => sameEdge(pe, e))) {
          coveredPerimeter.add(edgeKeyOf(e))
        }
      }
    }
  }

  // Fill remaining mid-edges until each has two face connections (Blockbench limiter).
  for (const edge of [...liveMidEdges]) {
    const k = edgeKeyOf(edge)
    let limiter = 0
    while ((edgeFaceCount.get(k) ?? 0) < 2 && limiter < 8) {
      limiter++
      const pool = [
        ...midPointVkeys.filter((v) => v !== edge[0] && v !== edge[1]),
        ...perimeter,
      ]
      const nearest = nearestFrom(edge, pool)
      let face: number[] | null = tryQuadsFrom(edge, nearest)
      if (!face) {
        for (const vi of nearest) {
          face = tryTri([edge[0], edge[1], vi])
          if (face) break
        }
      }
      if (!face) break
      commit(face)
      for (let i = 0; i < face.length; i++) {
        const e: [number, number] = [face[i]!, face[(i + 1) % face.length]!]
        if (
          !sameEdge(e, edge) &&
          !liveMidEdges.some((m) => sameEdge(m, e)) &&
          !perimeterEdges.some((m) => sameEdge(m, e))
        ) {
          liveMidEdges.push(e)
        }
      }
    }
  }

  if (created.length === 0) return null

  // Reject incomplete fills — uncovered perimeter means a hole (Blockbench failure mode).
  for (const pe of perimeterEdges) {
    if ((edgeFaceCount.get(edgeKeyOf(pe)) ?? 0) < 1) return null
  }
  // Planned cut edges (not perimeter) must be shared by two new faces.
  for (const me of midEdges) {
    if (perimeterEdges.some((pe) => sameEdge(pe, me))) continue
    const uses = edgeFaceCount.get(edgeKeyOf(me)) ?? 0
    if (uses < 2) return null
  }

  return created
}

function splitEdgeInserting(
  positions: Vec3[],
  faces: number[][],
  faceUvIndices: number[][] | null,
  uvs: Uv2[] | null,
  a: number,
  b: number,
  t: number
): number {
  const u = Math.max(0.001, Math.min(0.999, t))
  const pa = positions[a]!
  const pb = positions[b]!
  const newVi = positions.length
  positions.push(lerp3(pa, pb, u))

  const newFaces: number[][] = []
  const newFaceUvs: number[][] | null = faceUvIndices ? [] : null

  for (let fi = 0; fi < faces.length; fi++) {
    const face = faces[fi]!
    const faceUv = faceUvIndices?.[fi]
    let replaced = false
    for (let i = 0; i < face.length; i++) {
      const va = face[i]!
      const vb = face[(i + 1) % face.length]!
      if ((va === a && vb === b) || (va === b && vb === a)) {
        newFaces.push([...face.slice(0, i + 1), newVi, ...face.slice(i + 1)])
        if (newFaceUvs && faceUv && uvs) {
          const ua = faceUv[i]!
          const ub = faceUv[(i + 1) % faceUv.length]!
          const uvA = uvs[ua] ?? { u: 0, v: 0 }
          const uvB = uvs[ub] ?? { u: 0, v: 0 }
          const tt = va === a ? u : 1 - u
          const newUv = uvs.length
          uvs.push({
            u: uvA.u + (uvB.u - uvA.u) * tt,
            v: uvA.v + (uvB.v - uvA.v) * tt,
          })
          newFaceUvs.push([...faceUv.slice(0, i + 1), newUv, ...faceUv.slice(i + 1)])
        } else if (newFaceUvs) {
          newFaceUvs.push(faceUv ? [...faceUv] : [])
        }
        replaced = true
        break
      }
    }
    if (!replaced) {
      newFaces.push([...face])
      if (newFaceUvs) newFaceUvs.push(faceUv ? [...faceUv] : [])
    }
  }

  faces.length = 0
  faces.push(...newFaces)
  if (faceUvIndices && newFaceUvs) {
    faceUvIndices.length = 0
    faceUvIndices.push(...newFaceUvs)
  }
  return newVi
}

/**
 * Apply a Blockbench-style knife path: snap attachments → shared edge splits →
 * per-face remesh preferring quads.
 */
export function knifeCutPath(obj: SceneObject, points: KnifeAttachPoint[]): SceneObject {
  if (points.length < 2) return obj

  const welded = weldSceneObjectCoincidentVertices(cloneSceneObject(obj))
  // Face indices from picking are invalid after weld — reattach geometrically,
  // preserving snap kind hints when still meaningful.
  const attachedPoints: KnifeAttachPoint[] = points.map((p) => {
    const attached = attachKnifePoint(welded, p.local, null)
    if (p.snap === 'face' || p.snap === 'face-center' || p.snap === 'grid') {
      return { ...attached, snap: p.snap, local: { ...p.local }, faceIndex: attached.faceIndex }
    }
    return attached
  })

  const positions = welded.positions.map((p) => ({ ...p }))
  const faces = welded.faces.map((f) => [...f])
  const faceColors = [...welded.faceColors]
  const hasUv =
    Boolean(welded.uvs?.length) &&
    Boolean(welded.faceUvIndices?.length) &&
    welded.faceUvIndices!.length === welded.faces.length
  const uvs: Uv2[] | null = hasUv ? welded.uvs!.map((u) => ({ ...u })) : null
  const faceUvIndices: number[][] | null = hasUv
    ? welded.faceUvIndices!.map((f) => [...f])
    : null

  const beforeFaces = faces.length
  const edgeSplitCache = new Map<string, number>()

  const resolvePoint = (point: KnifeAttachPoint, pathIndex: number): Resolved => {
    // Existing vertex snap
    if (
      point.vertexIndex != null &&
      point.vertexIndex >= 0 &&
      point.vertexIndex < positions.length &&
      dist2(positions[point.vertexIndex]!, point.local) < POS_EPS * POS_EPS * 100
    ) {
      return {
        vkey: point.vertexIndex,
        kind: 'vertex',
        edge: null,
        faceIndex: point.faceIndex ?? null,
        local: { ...positions[point.vertexIndex]! },
        pathIndex,
      }
    }

    // Edge snap / near-edge
    if (point.edge) {
      let [a, b] = point.edge
      // Remap if welding changed indices — match by position proximity on original edge ends.
      if (a >= positions.length || b >= positions.length) {
        // Fall through to geometric edge search
      } else {
        const pa = positions[a]!
        const pb = positions[b]!
        let t = edgeParam(pa, pb, point.local)
        if (t <= 0.001) {
          return {
            vkey: a,
            kind: 'vertex',
            edge: null,
            faceIndex: point.faceIndex ?? null,
            local: { ...pa },
            pathIndex,
          }
        }
        if (t >= 0.999) {
          return {
            vkey: b,
            kind: 'vertex',
            edge: null,
            faceIndex: point.faceIndex ?? null,
            local: { ...pb },
            pathIndex,
          }
        }
        // Ensure a < b for stable cache after orientation normalize
        const key = `${edgeKey(a, b)}@${t.toFixed(4)}`
        const cached = edgeSplitCache.get(key)
        if (cached != null) {
          return {
            vkey: cached,
            kind: 'edge',
            edge: [a, b],
            faceIndex: point.faceIndex ?? null,
            local: { ...positions[cached]! },
            pathIndex,
          }
        }
        const vi = splitEdgeInserting(positions, faces, faceUvIndices, uvs, a, b, t)
        edgeSplitCache.set(key, vi)
        return {
          vkey: vi,
          kind: 'edge',
          edge: [a, b],
          faceIndex: point.faceIndex ?? null,
          local: { ...positions[vi]! },
          pathIndex,
        }
      }
    }

    // Geometric: snap to nearest existing vertex
    let bestVi = -1
    let bestD = POS_EPS * POS_EPS * 64
    for (let vi = 0; vi < positions.length; vi++) {
      const d = dist2(positions[vi]!, point.local)
      if (d < bestD) {
        bestD = d
        bestVi = vi
      }
    }
    if (bestVi >= 0) {
      return {
        vkey: bestVi,
        kind: 'vertex',
        edge: null,
        faceIndex: point.faceIndex ?? null,
        local: { ...positions[bestVi]! },
        pathIndex,
      }
    }

    // Geometric: snap onto nearest edge if close
    let bestEdge: [number, number] | null = null
    let bestT = 0.5
    let bestEdgeD = POS_EPS * POS_EPS * 64
    const seen = new Set<string>()
    for (const face of faces) {
      for (let i = 0; i < face.length; i++) {
        const a = face[i]!
        const b = face[(i + 1) % face.length]!
        const k = edgeKey(a, b)
        if (seen.has(k)) continue
        seen.add(k)
        const pa = positions[a]!
        const pb = positions[b]!
        const t = edgeParam(pa, pb, point.local)
        const proj = lerp3(pa, pb, t)
        const d = dist2(proj, point.local)
        if (d < bestEdgeD) {
          bestEdgeD = d
          bestEdge = [a, b]
          bestT = t
        }
      }
    }
    if (bestEdge && bestEdgeD < POS_EPS * POS_EPS * 64) {
      const [a, b] = bestEdge
      if (bestT <= 0.001) {
        return {
          vkey: a,
          kind: 'vertex',
          edge: null,
          faceIndex: point.faceIndex ?? null,
          local: { ...positions[a]! },
          pathIndex,
        }
      }
      if (bestT >= 0.999) {
        return {
          vkey: b,
          kind: 'vertex',
          edge: null,
          faceIndex: point.faceIndex ?? null,
          local: { ...positions[b]! },
          pathIndex,
        }
      }
      const key = `${edgeKey(a, b)}@${bestT.toFixed(4)}`
      const cached = edgeSplitCache.get(key)
      if (cached != null) {
        return {
          vkey: cached,
          kind: 'edge',
          edge: bestEdge,
          faceIndex: point.faceIndex ?? null,
          local: { ...positions[cached]! },
          pathIndex,
        }
      }
      const vi = splitEdgeInserting(
        positions,
        faces,
        faceUvIndices,
        uvs,
        a,
        b,
        bestT
      )
      edgeSplitCache.set(key, vi)
      return {
        vkey: vi,
        kind: 'edge',
        edge: bestEdge,
        faceIndex: point.faceIndex ?? null,
        local: { ...positions[vi]! },
        pathIndex,
      }
    }

    // Face-interior vertex
    const vi = positions.length
    positions.push({ ...point.local })
    return {
      vkey: vi,
      kind: 'face',
      edge: null,
      faceIndex: point.faceIndex ?? null,
      local: { ...point.local },
      pathIndex,
    }
  }

  // Reuse coincident path points (Blockbench reuse_of).
  const resolved: Resolved[] = []
  for (let i = 0; i < attachedPoints.length; i++) {
    const p = attachedPoints[i]!
    const existing = resolved.find((r) => dist2(r.local, p.local) < POS_EPS * POS_EPS * 40)
    if (existing) {
      resolved.push({ ...existing, pathIndex: i, faceIndex: p.faceIndex ?? existing.faceIndex })
      continue
    }
    resolved.push(resolvePoint(p, i))
  }

  // Planned cut edges between consecutive path points.
  const planned: Array<[number, number]> = []
  for (let i = 1; i < resolved.length; i++) {
    const a = resolved[i - 1]!
    const b = resolved[i]!
    if (a.vkey !== b.vkey) planned.push([a.vkey, b.vkey])
  }

  const newFaceSourceOld: number[] = faces.map((_, fi) => fi)
  let anyCut = false

  // Process faces from high index to low so replacements don't scramble earlier indices.
  const faceIndices = faces.map((_, fi) => fi)
  for (const fi of faceIndices.slice().reverse()) {
    if (fi >= faces.length) continue
    const face = faces[fi]!
    const included = resolved.filter((p) => {
      if (attachedPoints[p.pathIndex]?.faceIndex === fi) return true
      return (
        pointBelongsToFace(face, attachedPoints[p.pathIndex]!, p.vkey) ||
        face.includes(p.vkey)
      )
    })
    // Dedup by vkey keeping first path order
    const seenV = new Set<number>()
    const uniqIncluded: Resolved[] = []
    for (const p of included) {
      if (seenV.has(p.vkey)) continue
      seenV.add(p.vkey)
      uniqIncluded.push(p)
    }
    if (uniqIncluded.length < 2) continue

    // Planned cut edges that touch this face (both endpoints belong to included points).
    const midEdges = planned.filter(
      ([a, b]) =>
        uniqIncluded.some((p) => p.vkey === a) && uniqIncluded.some((p) => p.vkey === b)
    )

    // Ensure edge-split verts are on the face loop (splitEdgeInserting already did).
    const faceNow = faces[fi]!
    const onFace = uniqIncluded.filter((p) => faceNow.includes(p.vkey) || p.kind === 'face')
    if (onFace.length < 2) continue

    const faceForRemesh = [...faceNow]
    const edgesForFace = midEdges.filter(([a, b]) => {
      const hasA = onFace.some((p) => p.vkey === a) || faceForRemesh.includes(a)
      const hasB = onFace.some((p) => p.vkey === b) || faceForRemesh.includes(b)
      return hasA && hasB
    })

    if (edgesForFace.length === 0 && onFace.length === 2) {
      edgesForFace.push([onFace[0]!.vkey, onFace[1]!.vkey])
    }
    if (edgesForFace.length === 0) continue

    const pieces = remeshFaceBlockbench(positions, faceForRemesh, onFace, edgesForFace)
    if (!pieces || pieces.length === 0) {
      // Fallback: single chord split if possible (preserves n-gons / quads).
      if (onFace.length >= 2) {
        const a = onFace[0]!.vkey
        const b = onFace[onFace.length - 1]!.vkey
        if (faceNow.includes(a) && faceNow.includes(b) && !areAdjacentOnFace(faceNow, a, b)) {
          const before = faces.length
          splitFaceAtChord(faces, faceColors, fi, a, b)
          if (faces.length > before) {
            anyCut = true
            while (newFaceSourceOld.length < faces.length) {
              newFaceSourceOld.push(fi < beforeFaces ? fi : newFaceSourceOld[fi] ?? 0)
            }
          }
        }
      }
      continue
    }

    // Replace face fi with pieces[0], append the rest — build UV rings per new corner.
    const color = faceColors[fi]!
    const oldUv = faceUvIndices?.[fi]
    const oldFaceVerts = faceForRemesh

    const uvRingFor = (piece: number[]): number[] => {
      if (!faceUvIndices || !uvs) return []
      return piece.map((vi) => {
        const idxInOld = oldFaceVerts.indexOf(vi)
        if (idxInOld >= 0 && oldUv && oldUv[idxInOld] != null) return oldUv[idxInOld]!
        const uv = interpolateFaceUv(positions, oldFaceVerts, oldUv, uvs, vi)
        const newIdx = uvs.length
        uvs.push(uv)
        return newIdx
      })
    }

    faces[fi] = pieces[0]!
    if (faceUvIndices) {
      faceUvIndices[fi] = uvRingFor(pieces[0]!)
    }
    for (let pi = 1; pi < pieces.length; pi++) {
      faces.push(pieces[pi]!)
      faceColors.push(color)
      if (faceUvIndices) {
        faceUvIndices.push(uvRingFor(pieces[pi]!))
      }
      newFaceSourceOld.push(fi < beforeFaces ? fi : newFaceSourceOld[fi] ?? 0)
    }
    newFaceSourceOld[fi] = fi < beforeFaces ? fi : newFaceSourceOld[fi] ?? fi
    anyCut = true
  }

  if (!anyCut) return obj

  while (newFaceSourceOld.length < faces.length) {
    newFaceSourceOld.push(Math.min(newFaceSourceOld.length, beforeFaces - 1))
  }

  const faceGroups = splitFaceGroupsAfterCut(
    welded.faceGroups,
    beforeFaces,
    newFaceSourceOld.slice(0, faces.length)
  )

  const result: SceneObject = {
    ...welded,
    positions,
    faces,
    faceColors,
    faceGroups,
    uvs: uvs ?? welded.uvs,
    faceUvIndices: faceUvIndices ?? welded.faceUvIndices,
  }

  return cleanupCutTopology(result)
}

/** Re-derive vert/edge/face attachment for a local point (mirror knife). */
export function attachKnifePoint(
  obj: SceneObject,
  local: Vec3,
  preferFace: number | null = null
): KnifeAttachPoint {
  const eps2 = POS_EPS * POS_EPS * 64

  let bestVi = -1
  let bestVd = eps2
  for (let vi = 0; vi < obj.positions.length; vi++) {
    const d = dist2(obj.positions[vi]!, local)
    if (d < bestVd) {
      bestVd = d
      bestVi = vi
    }
  }
  if (bestVi >= 0 && bestVd < eps2) {
    let faceIndex: number | null = preferFace
    if (faceIndex == null) {
      for (let fi = 0; fi < obj.faces.length; fi++) {
        if (obj.faces[fi]!.includes(bestVi)) {
          faceIndex = fi
          break
        }
      }
    }
    return {
      local: { ...obj.positions[bestVi]! },
      snap: 'vertex',
      vertexIndex: bestVi,
      edge: null,
      faceIndex,
    }
  }

  let bestEdge: [number, number] | null = null
  let bestT = 0.5
  let bestEd = eps2
  let bestFace: number | null = preferFace
  const seen = new Set<string>()
  for (let fi = 0; fi < obj.faces.length; fi++) {
    const face = obj.faces[fi]!
    for (let i = 0; i < face.length; i++) {
      const a = face[i]!
      const b = face[(i + 1) % face.length]!
      const k = edgeKey(a, b)
      if (seen.has(k)) continue
      seen.add(k)
      const pa = obj.positions[a]!
      const pb = obj.positions[b]!
      const t = edgeParam(pa, pb, local)
      const proj = lerp3(pa, pb, t)
      const d = dist2(proj, local)
      if (d < bestEd) {
        bestEd = d
        bestEdge = [a, b]
        bestT = t
        bestFace = fi
      }
    }
  }
  if (bestEdge && bestEd < eps2) {
    const proj = lerp3(obj.positions[bestEdge[0]]!, obj.positions[bestEdge[1]]!, bestT)
    return {
      local: proj,
      snap: 'edge',
      vertexIndex: null,
      edge: bestEdge,
      faceIndex: bestFace,
    }
  }

  // Pick closest face by point-plane + centroid distance
  let faceIndex = preferFace
  if (faceIndex == null) {
    let best = Infinity
    for (let fi = 0; fi < obj.faces.length; fi++) {
      const face = obj.faces[fi]!
      let cx = 0
      let cy = 0
      let cz = 0
      for (const vi of face) {
        const p = obj.positions[vi]!
        cx += p.x
        cy += p.y
        cz += p.z
      }
      const n = face.length || 1
      const d = dist2(local, { x: cx / n, y: cy / n, z: cz / n })
      if (d < best) {
        best = d
        faceIndex = fi
      }
    }
  }

  return {
    local: { ...local },
    snap: 'face',
    vertexIndex: null,
    edge: null,
    faceIndex,
  }
}

export function pathHasAttachments(points: KnifeAttachPoint[]): boolean {
  return points.some(
    (p) =>
      p.vertexIndex != null ||
      p.edge != null ||
      p.faceIndex != null
  )
}
