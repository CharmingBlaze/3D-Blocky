import { type Vec3 } from '../utils/math'
import { HalfEdgeMesh } from './HalfEdgeMesh'

function faceArea(a: Vec3, b: Vec3, c: Vec3): number {
  const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }
  const ac = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z }
  const nx = ab.y * ac.z - ab.z * ac.y
  const ny = ab.z * ac.x - ab.x * ac.z
  const nz = ab.x * ac.y - ab.y * ac.x
  return Math.hypot(nx, ny, nz) * 0.5
}

function meshCentroid(mesh: HalfEdgeMesh): Vec3 {
  if (mesh.positions.length === 0) return { x: 0, y: 0, z: 0 }
  const c = mesh.positions.reduce(
    (acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y, z: acc.z + p.z }),
    { x: 0, y: 0, z: 0 }
  )
  c.x /= mesh.positions.length
  c.y /= mesh.positions.length
  c.z /= mesh.positions.length
  return c
}

function removeDegenerateFaces(mesh: HalfEdgeMesh, minArea = 1e-10): void {
  const validFaces: number[][] = []
  const validColors: number[] = []
  for (let fi = 0; fi < mesh.faces.length; fi++) {
    const f = mesh.faces[fi]
    if (f.length < 3) continue
    const a = mesh.positions[f[0]]
    const b = mesh.positions[f[1]]
    const c = mesh.positions[f[2]]
    if (faceArea(a, b, c) < minArea) continue
    validFaces.push(f)
    validColors.push(mesh.faceColors[fi] ?? 0x7ecba1)
  }
  mesh.faces = validFaces
  mesh.faceColors = validColors
}

function removeUnreferencedVertices(mesh: HalfEdgeMesh): void {
  const used = new Set<number>()
  for (const f of mesh.faces) {
    for (const vi of f) used.add(vi)
  }
  const oldToNew = new Map<number, number>()
  const newPositions: Vec3[] = []
  for (const vi of [...used].sort((a, b) => a - b)) {
    oldToNew.set(vi, newPositions.length)
    newPositions.push({ ...mesh.positions[vi] })
  }
  mesh.positions = newPositions
  mesh.faces = mesh.faces.map((f) => f.map((vi) => oldToNew.get(vi)!))
}

function weldCoincidentVertices(mesh: HalfEdgeMesh, epsilon = 1e-4): void {
  const n = mesh.positions.length
  const parent = Array.from({ length: n }, (_, i) => i)

  const find = (i: number): number => {
    let root = i
    while (parent[root] !== root) root = parent[root]
    let curr = i
    while (parent[curr] !== curr) {
      const next = parent[curr]
      parent[curr] = root
      curr = next
    }
    return root
  }

  const unite = (a: number, b: number): void => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[rb] = ra
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const pi = mesh.positions[i]
      const pj = mesh.positions[j]
      if (Math.hypot(pi.x - pj.x, pi.y - pj.y, pi.z - pj.z) < epsilon) unite(i, j)
    }
  }

  const roots = new Set<number>()
  for (let i = 0; i < n; i++) roots.add(find(i))

  if (roots.size === n) return

  const oldToNew = new Map<number, number>()
  const newPositions: Vec3[] = []
  for (const root of [...roots].sort((a, b) => a - b)) {
    oldToNew.set(root, newPositions.length)
    newPositions.push({ ...mesh.positions[root] })
  }

  const remap = (vi: number) => oldToNew.get(find(vi))!
  mesh.positions = newPositions
  mesh.faces = mesh.faces
    .map((f) => {
      const mapped = f.map(remap)
      const unique = mapped.filter((v, idx, arr) => arr.indexOf(v) === idx)
      return unique.length >= 3 ? unique : null
    })
    .filter((f): f is number[] => f !== null)
}

/** Flip faces whose normals point toward mesh centroid (inside-out patches) */
function fixInvertedNormals(mesh: HalfEdgeMesh): void {
  const center = meshCentroid(mesh)
  for (const f of mesh.faces) {
    if (f.length < 3) continue
    const a = mesh.positions[f[0]]
    const b = mesh.positions[f[1]]
    const c = mesh.positions[f[2]]
    const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }
    const ac = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z }
    const nx = ab.y * ac.z - ab.z * ac.y
    const ny = ab.z * ac.x - ab.x * ac.z
    const nz = ab.x * ac.y - ab.y * ac.x
    const len = Math.hypot(nx, ny, nz)
    if (len < 1e-12) continue
    const fc = {
      x: (a.x + b.x + c.x) / 3,
      y: (a.y + b.y + c.y) / 3,
      z: (a.z + b.z + c.z) / 3,
    }
    const toCenter = {
      x: center.x - fc.x,
      y: center.y - fc.y,
      z: center.z - fc.z,
    }
    const dot = (nx * toCenter.x + ny * toCenter.y + nz * toCenter.z) / len
    if (dot > 0) f.reverse()
  }
}

/** Fill small boundary holes (1–2 missing triangles) by fanning boundary loops */
function fillSmallHoles(mesh: HalfEdgeMesh, maxLoopLen = 6): void {
  mesh.buildHalfEdges()
  const edgeCount = new Map<string, number>()
  for (const f of mesh.faces) {
    for (let i = 0; i < f.length; i++) {
      const v0 = f[i]
      const v1 = f[(i + 1) % f.length]
      const key = v0 < v1 ? `${v0}_${v1}` : `${v1}_${v0}`
      edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1)
    }
  }

  const boundaryEdges: [number, number][] = []
  for (const [key, count] of edgeCount) {
    if (count !== 1) continue
    const [a, b] = key.split('_').map(Number)
    boundaryEdges.push([a, b])
  }
  if (boundaryEdges.length === 0 || boundaryEdges.length > maxLoopLen * 3) return

  const adj = new Map<number, number[]>()
  for (const [a, b] of boundaryEdges) {
    if (!adj.has(a)) adj.set(a, [])
    if (!adj.has(b)) adj.set(b, [])
    adj.get(a)!.push(b)
    adj.get(b)!.push(a)
  }

  const visited = new Set<string>()
  for (const [start] of boundaryEdges) {
    const loop: number[] = []
    let curr = start
    let prev = -1
    for (let step = 0; step < maxLoopLen + 2; step++) {
      loop.push(curr)
      const neighbors = adj.get(curr) ?? []
      const next = neighbors.find((n) => n !== prev)
      if (next === undefined) break
      const eKey = curr < next ? `${curr}_${next}` : `${next}_${curr}`
      if (visited.has(eKey)) break
      visited.add(eKey)
      prev = curr
      curr = next
      if (curr === start && loop.length >= 3) {
        if (loop.length <= maxLoopLen) {
          const anchor = loop[0]
          for (let i = 1; i < loop.length - 1; i++) {
            mesh.faces.push([anchor, loop[i], loop[i + 1]])
            mesh.faceColors.push(mesh.faceColors[0] ?? 0x7ecba1)
          }
        }
        break
      }
    }
  }
}

/**
 * Post dual-contouring safety pass — watertight cleanup.
 */
export function meshSafetyPass(mesh: HalfEdgeMesh): HalfEdgeMesh {
  removeDegenerateFaces(mesh)
  removeUnreferencedVertices(mesh)
  weldCoincidentVertices(mesh)
  fixInvertedNormals(mesh)
  fillSmallHoles(mesh)
  removeDegenerateFaces(mesh)
  removeUnreferencedVertices(mesh)
  mesh.buildHalfEdges()
  return mesh
}
