/**
 * MeshBuilder — shared indexed-mesh construction + winding validation for all primitives.
 *
 * ## Contract for new primitive / extrude geometry
 * 1. Build vertices + CCW faces with `MeshBuilder` (or `IndexedMesh` + helpers).
 * 2. Call `finalizeIndexedMesh(mesh, { outwardCenter })` before scene/export use.
 * 3. That runs `ensureOutwardWinding` → `validateMesh` → optional `facetMesh`.
 *
 * Winding: faces are CCW when viewed from outside (right-hand rule). Normals come
 * from `computeFaceNormal` — never set a normal that disagrees with vertex order.
 */

import type { MeshData } from '../blob/types'
import { facetMesh } from '../blob/faceting'
import type { Vec3 } from '../utils/math'

/** CCW triangle (a → b → c), right-hand rule outward normal. */
export type TriangleFace = [number, number, number]

export interface IndexedMesh {
  positions: Vec3[]
  faces: TriangleFace[]
  faceGroups?: number[][]
  uvs?: { u: number; v: number }[]
  faceUvIndices?: [number, number, number][]
}

export interface MeshValidationIssue {
  code:
    | 'degenerate_triangle'
    | 'unreferenced_vertex'
    | 'non_manifold_edge'
    | 'inconsistent_edge_winding'
    | 'inward_face'
  message: string
  faceIndex?: number
  vertexIndex?: number
}

export interface MeshValidationResult {
  ok: boolean
  issues: MeshValidationIssue[]
}

export interface FinalizeMeshOptions {
  /** Reference point for outward test (mesh centroid if omitted). */
  outwardCenter?: Vec3
  /** Flat-shade for display (default true). */
  facet?: boolean
  /** Collect validation issues (default true in dev builds). */
  validate?: boolean
  /** Skip per-face centroid flip (needed for torus-like shapes). */
  skipOutwardWinding?: boolean
}

export class MeshBuilder {
  private positions: Vec3[] = []
  private faces: TriangleFace[] = []
  private faceGroups: number[][] = []
  private uvs: { u: number; v: number }[] = []
  private faceUvIndices: [number, number, number][] = []
  private uvEnabled = false

  addVertex(x: number, y: number, z: number): number {
    const i = this.positions.length
    this.positions.push({ x, y, z })
    return i
  }

  addVertexVec(v: Vec3): number {
    return this.addVertex(v.x, v.y, v.z)
  }

  addUv(u: number, v: number): number {
    this.uvEnabled = true
    const i = this.uvs.length
    this.uvs.push({ u, v })
    return i
  }

  /** CCW triangle. Returns face index. */
  addTriangle(a: number, b: number, c: number, uv?: [number, number, number]): number {
    const fi = this.faces.length
    this.faces.push([a, b, c])
    if (this.uvEnabled && uv) {
      this.faceUvIndices.push(uv)
    }
    return fi
  }

  /** CCW quad split into two triangles: a→b→c and a→c→d. */
  addQuad(a: number, b: number, c: number, d: number, uv?: [number, number, number, number]): void {
    const g0 = this.faces.length
    if (uv) {
      this.addTriangle(a, b, c, [uv[0], uv[1], uv[2]])
      this.addTriangle(a, c, d, [uv[0], uv[2], uv[3]])
    } else {
      this.addTriangle(a, b, c)
      this.addTriangle(a, c, d)
    }
    this.faceGroups.push([g0, g0 + 1])
  }

  addFaceGroup(indices: number[]): void {
    this.faceGroups.push(indices)
  }

  build(): IndexedMesh {
    const mesh: IndexedMesh = {
      positions: this.positions.map((p) => ({ ...p })),
      faces: this.faces.map((f) => [...f] as TriangleFace),
    }
    if (this.faceGroups.length > 0) {
      mesh.faceGroups = this.faceGroups.map((g) => [...g])
    }
    if (this.uvEnabled) {
      mesh.uvs = this.uvs.map((uv) => ({ ...uv }))
      mesh.faceUvIndices = this.faceUvIndices.map((f) => [...f] as [number, number, number])
    }
    return mesh
  }
}

export function computeFaceNormal(positions: readonly Vec3[], face: TriangleFace): Vec3 {
  const a = positions[face[0]!]!
  const b = positions[face[1]!]!
  const c = positions[face[2]!]!
  const ux = b.x - a.x
  const uy = b.y - a.y
  const uz = b.z - a.z
  const vx = c.x - a.x
  const vy = c.y - a.y
  const vz = c.z - a.z
  return {
    x: uy * vz - uz * vy,
    y: uz * vx - ux * vz,
    z: ux * vy - uy * vx,
  }
}

export function faceArea(positions: readonly Vec3[], face: TriangleFace): number {
  const n = computeFaceNormal(positions, face)
  return Math.hypot(n.x, n.y, n.z) * 0.5
}

export function faceCentroid(positions: readonly Vec3[], face: TriangleFace): Vec3 {
  const a = positions[face[0]!]!
  const b = positions[face[1]!]!
  const c = positions[face[2]!]!
  return {
    x: (a.x + b.x + c.x) / 3,
    y: (a.y + b.y + c.y) / 3,
    z: (a.z + b.z + c.z) / 3,
  }
}

export function meshCentroid(positions: readonly Vec3[]): Vec3 {
  if (positions.length === 0) return { x: 0, y: 0, z: 0 }
  let x = 0
  let y = 0
  let z = 0
  for (const p of positions) {
    x += p.x
    y += p.y
    z += p.z
  }
  const n = positions.length
  return { x: x / n, y: y / n, z: z / n }
}

export function flipFace(face: TriangleFace): TriangleFace {
  return [face[0], face[2], face[1]]
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}_${b}` : `${b}_${a}`
}

/** Flip faces whose normal does not point away from refPoint (centroid if omitted). */
export function ensureOutwardWinding(mesh: IndexedMesh, refPoint?: Vec3): IndexedMesh {
  if (mesh.faces.length === 0) return mesh
  const center = refPoint ?? meshCentroid(mesh.positions)
  const faces = mesh.faces.map((face) => {
    if (face.length !== 3) return face
    const n = computeFaceNormal(mesh.positions, face)
    const c = faceCentroid(mesh.positions, face)
    const dx = c.x - center.x
    const dy = c.y - center.y
    const dz = c.z - center.z
    const dot = n.x * dx + n.y * dy + n.z * dz
    if (dot < 0) return flipFace(face)
    return face
  })
  return { ...mesh, faces }
}

export function validateMesh(mesh: IndexedMesh, refPoint?: Vec3): MeshValidationResult {
  const issues: MeshValidationIssue[] = []
  const center = refPoint ?? meshCentroid(mesh.positions)
  const referenced = new Set<number>()

  mesh.faces.forEach((face, fi) => {
    if (face.length !== 3) return
    const area = faceArea(mesh.positions, face)
    if (area < 1e-10) {
      issues.push({
        code: 'degenerate_triangle',
        message: `Face ${fi} is degenerate (area≈0)`,
        faceIndex: fi,
      })
    }
    for (const vi of face) referenced.add(vi)

    const n = computeFaceNormal(mesh.positions, face)
    const c = faceCentroid(mesh.positions, face)
    const dot = n.x * (c.x - center.x) + n.y * (c.y - center.y) + n.z * (c.z - center.z)
    if (dot < 0) {
      issues.push({
        code: 'inward_face',
        message: `Face ${fi} normal points toward reference center`,
        faceIndex: fi,
      })
    }
  })

  for (let vi = 0; vi < mesh.positions.length; vi++) {
    if (!referenced.has(vi)) {
      issues.push({
        code: 'unreferenced_vertex',
        message: `Vertex ${vi} is not referenced by any face`,
        vertexIndex: vi,
      })
    }
  }

  type Directed = { faceIndex: number; from: number; to: number }
  const directed = new Map<string, Directed[]>()

  mesh.faces.forEach((face, fi) => {
    for (let i = 0; i < face.length; i++) {
      const from = face[i]!
      const to = face[(i + 1) % face.length]!
      const key = edgeKey(from, to)
      const list = directed.get(key) ?? []
      list.push({ faceIndex: fi, from, to })
      directed.set(key, list)
    }
  })

  for (const [, entries] of directed) {
    if (entries.length > 2) {
      issues.push({
        code: 'non_manifold_edge',
        message: `Edge shared by ${entries.length} faces`,
        faceIndex: entries[0]?.faceIndex,
      })
      continue
    }
    if (entries.length === 2) {
      const [a, b] = entries
      if (a!.from === b!.from && a!.to === b!.to) {
        issues.push({
          code: 'inconsistent_edge_winding',
          message: `Adjacent faces traverse edge ${a!.from}→${a!.to} in the same direction`,
          faceIndex: a!.faceIndex,
        })
      }
    }
  }

  return { ok: issues.length === 0, issues }
}

export function recomputeNormals(
  mesh: IndexedMesh,
  options: { perFace?: boolean } = {}
): Float32Array {
  const perFace = options.perFace ?? true
  const normals = new Float32Array(mesh.positions.length * 3)
  if (perFace) {
    for (const face of mesh.faces) {
      const n = computeFaceNormal(mesh.positions, face)
      const len = Math.hypot(n.x, n.y, n.z) || 1
      const nx = n.x / len
      const ny = n.y / len
      const nz = n.z / len
      for (const vi of face) {
        normals[vi * 3] = nx
        normals[vi * 3 + 1] = ny
        normals[vi * 3 + 2] = nz
      }
    }
  } else {
    const counts = new Float32Array(mesh.positions.length)
    for (const face of mesh.faces) {
      const n = computeFaceNormal(mesh.positions, face)
      const len = Math.hypot(n.x, n.y, n.z) || 1
      for (const vi of face) {
        normals[vi * 3] += n.x / len
        normals[vi * 3 + 1] += n.y / len
        normals[vi * 3 + 2] += n.z / len
        counts[vi] += 1
      }
    }
    for (let i = 0; i < mesh.positions.length; i++) {
      const c = counts[i] || 1
      const len = Math.hypot(normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]) || 1
      normals[i * 3] /= c * len
      normals[i * 3 + 1] /= c * len
      normals[i * 3 + 2] /= c * len
    }
  }
  return normals
}

export function indexedMeshToFlat(mesh: IndexedMesh): {
  positions: number[]
  indices: number[]
} {
  const positions: number[] = []
  for (const p of mesh.positions) {
    positions.push(p.x, p.y, p.z)
  }
  const indices: number[] = []
  for (const f of mesh.faces) {
    indices.push(f[0], f[1], f[2])
  }
  return { positions, indices }
}

export function indexedMeshFromFlat(
  positions: number[],
  indices: number[],
  faceGroups?: number[][]
): IndexedMesh {
  const verts: Vec3[] = []
  for (let i = 0; i < positions.length; i += 3) {
    verts.push({ x: positions[i]!, y: positions[i + 1]!, z: positions[i + 2]! })
  }
  const faces: TriangleFace[] = []
  for (let t = 0; t < indices.length; t += 3) {
    faces.push([indices[t]!, indices[t + 1]!, indices[t + 2]!])
  }
  return { positions: verts, faces, faceGroups }
}

export function indexedMeshFromMeshData(data: MeshData): IndexedMesh {
  const positions: Vec3[] = []
  for (let i = 0; i < data.positions.length; i += 3) {
    positions.push({
      x: data.positions[i]!,
      y: data.positions[i + 1]!,
      z: data.positions[i + 2]!,
    })
  }
  const faces: TriangleFace[] = []
  for (let t = 0; t < data.indices.length; t += 3) {
    faces.push([data.indices[t]!, data.indices[t + 1]!, data.indices[t + 2]!])
  }
  const mesh: IndexedMesh = { positions, faces }
  if (data.faceGroups?.length) mesh.faceGroups = data.faceGroups.map((g) => [...g])
  if (data.uvs) {
    mesh.uvs = []
    for (let i = 0; i < data.uvs.length; i += 2) {
      mesh.uvs.push({ u: data.uvs[i]!, v: data.uvs[i + 1]! })
    }
  }
  return mesh
}

/** Required exit path for CAD primitives: outward winding → validate → facet. */
export function finalizeIndexedMesh(
  mesh: IndexedMesh,
  options: FinalizeMeshOptions = {}
): MeshData {
  const outwardCenter = options.outwardCenter
  const shouldValidate = options.validate ?? true
  const shouldFacet = options.facet ?? true

  let next = options.skipOutwardWinding ? mesh : ensureOutwardWinding(mesh, outwardCenter)
  if (shouldValidate) {
    const result = validateMesh(next, outwardCenter)
    if (!result.ok && import.meta.env?.DEV) {
      console.warn('[MeshBuilder] validateMesh:', result.issues.slice(0, 8))
    }
  }

  const normals = recomputeNormals(next, { perFace: true })
  const flat = indexedMeshToFlat(next)

  const pos = new Float32Array(flat.positions)
  const idx = new Uint32Array(flat.indices)
  const base: MeshData = {
    positions: pos,
    normals,
    indices: idx,
    faceGroups: next.faceGroups,
  }

  if (next.uvs?.length) {
    const uvs = new Float32Array(next.uvs.length * 2)
    next.uvs.forEach((uv, i) => {
      uvs[i * 2] = uv.u
      uvs[i * 2 + 1] = uv.v
    })
    base.uvs = uvs
    if (next.faceUvIndices?.length) {
      const uvIndices = new Uint32Array(next.faceUvIndices.length * 3)
      let o = 0
      for (const tri of next.faceUvIndices) {
        uvIndices[o++] = tri[0]
        uvIndices[o++] = tri[1]
        uvIndices[o++] = tri[2]
      }
      base.uvIndices = uvIndices
    }
  }

  const out = shouldFacet ? facetMesh(base) : base
  return out
}

export function emptyMeshData(): MeshData {
  return {
    positions: new Float32Array(0),
    normals: new Float32Array(0),
    indices: new Uint32Array(0),
  }
}

/** Apply outward winding fix to a scene object (export / edit safety net). */
export function ensureSceneObjectOutward<T extends { positions: Vec3[]; faces: number[][]; id: string; name: string }>(
  obj: T,
  refPoint?: Vec3
): T {
  if (obj.faces.length === 0) return obj
  const center = refPoint ?? meshCentroid(obj.positions)
  const faces = obj.faces.map((face) => {
    if (face.length !== 3) return face
    const tri = face as TriangleFace
    const n = computeFaceNormal(obj.positions, tri)
    const c = faceCentroid(obj.positions, tri)
    const dot = n.x * (c.x - center.x) + n.y * (c.y - center.y) + n.z * (c.z - center.z)
    if (dot < 0) return [face[0], face[2], face[1]] as number[]
    return face
  })
  return { ...obj, faces }
}
