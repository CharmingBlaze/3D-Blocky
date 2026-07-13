import {
  add3,
  faceNormal,
  normalize3,
  scale3,
  sub3,
  type Vec3,
} from '../utils/math'
import type { HalfEdgeMesh } from './HalfEdgeMesh'

/**
 * Angle-weighted topology vertex normals in one face pass (~O(corners + verts)).
 * Matches the previous per-vertex getVertexNormal(averaged=true) weighting.
 */
export function buildTopologyVertexNormals(mesh: {
  positions: Vec3[]
  faces: number[][]
}): Vec3[] {
  const n = mesh.positions.length
  const acc: Vec3[] = Array.from({ length: n }, () => ({ x: 0, y: 0, z: 0 }))
  const any = new Uint8Array(n)

  for (const face of mesh.faces) {
    if (!face || face.length < 3) continue
    const len = face.length
    for (let ci = 0; ci < len; ci++) {
      const vi = face[ci]!
      const a = mesh.positions[vi]
      const b = mesh.positions[face[(ci + 1) % len]!]
      const c = mesh.positions[face[(ci + len - 1) % len]!]
      if (!a || !b || !c) continue
      const nrm = faceNormal(a, b, c)
      const e1 = normalize3(sub3(b, a))
      const e2 = normalize3(sub3(c, a))
      const cos = Math.max(-1, Math.min(1, e1.x * e2.x + e1.y * e2.y + e1.z * e2.z))
      const angle = Math.acos(cos)
      const weighted = scale3(nrm, angle)
      const sum = acc[vi]!
      sum.x += weighted.x
      sum.y += weighted.y
      sum.z += weighted.z
      any[vi] = 1
    }
  }

  const out: Vec3[] = new Array(n)
  for (let vi = 0; vi < n; vi++) {
    if (!any[vi]) {
      out[vi] = { x: 0, y: 1, z: 0 }
      continue
    }
    out[vi] = normalize3(acc[vi]!)
  }
  return out
}

/** Face normal at a vertex using only faces incident via half-edges (sculpt hot path). */
export function getVertexNormalFromHalfEdges(
  mesh: HalfEdgeMesh,
  vi: number,
  averaged: boolean
): Vec3 | null {
  if (mesh.halfEdges.length === 0) return null

  let sum = { x: 0, y: 0, z: 0 }
  let any = false
  let first: Vec3 | null = null
  const seen = new Set<number>()

  for (let i = 0; i < mesh.halfEdges.length; i++) {
    const he = mesh.halfEdges[i]!
    if (he.origin !== vi) continue
    if (seen.has(he.face)) continue
    seen.add(he.face)
    const face = mesh.faces[he.face]
    if (!face || face.length < 3) continue
    const idx = face.indexOf(vi)
    if (idx < 0) continue
    const a = mesh.positions[face[idx]!]!
    const b = mesh.positions[face[(idx + 1) % face.length]!]!
    const c = mesh.positions[face[(idx + face.length - 1) % face.length]!]!
    const nrm = faceNormal(a, b, c)
    if (!averaged) return nrm
    const e1 = normalize3(sub3(b, a))
    const e2 = normalize3(sub3(c, a))
    const cos = Math.max(-1, Math.min(1, e1.x * e2.x + e1.y * e2.y + e1.z * e2.z))
    const angle = Math.acos(cos)
    sum = add3(sum, scale3(nrm, angle))
    if (!any) {
      first = nrm
      any = true
    }
  }

  if (!any) return null
  if (!averaged) return first
  return normalize3(sum)
}
