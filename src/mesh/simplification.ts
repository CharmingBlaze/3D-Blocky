import { type Vec3 } from '../utils/math'
import { HalfEdgeMesh } from './HalfEdgeMesh'

interface EdgeCollapse {
  v0: number
  v1: number
  cost: number
  position: Vec3
}

function computeQuadricError(
  mesh: HalfEdgeMesh,
  v0: number,
  v1: number
): { cost: number; position: Vec3 } {
  const p0 = mesh.positions[v0]
  const p1 = mesh.positions[v1]
  const position = {
    x: (p0.x + p1.x) / 2,
    y: (p0.y + p1.y) / 2,
    z: (p0.z + p1.z) / 2,
  }

  let cost = 0
  for (const face of mesh.faces) {
    if (!face.includes(v0) && !face.includes(v1)) continue
    const verts = face.map((vi) => mesh.positions[vi])
    if (verts.length < 3) continue
    const a = verts[0]
    const b = verts[1]
    const c = verts[2]
    const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }
    const ac = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z }
    const normal = {
      x: ab.y * ac.z - ab.z * ac.y,
      y: ab.z * ac.x - ab.x * ac.z,
      z: ab.x * ac.y - ab.y * ac.x,
    }
    const len = Math.sqrt(normal.x ** 2 + normal.y ** 2 + normal.z ** 2)
    if (len < 1e-10) continue
    const d = -(normal.x * a.x + normal.y * a.y + normal.z * a.z) / len
    const dist = Math.abs(
      (normal.x * position.x + normal.y * position.y + normal.z * position.z) / len + d
    )
    cost += dist * dist
  }

  return { cost, position }
}

/** Garland-Heckbert quadric error simplification */
export function simplifyMesh(
  mesh: HalfEdgeMesh,
  targetVertexCount: number
): HalfEdgeMesh {
  if (mesh.topologyLocked) return mesh
  if (mesh.vertexCount() <= targetVertexCount) return mesh

  const result = HalfEdgeMesh.fromObject(mesh.toObject('temp', 'temp'))

  while (result.vertexCount() > targetVertexCount && result.faces.length > 0) {
    const edges: EdgeCollapse[] = []
    const seen = new Set<string>()

    for (const face of result.faces) {
      for (let i = 0; i < face.length; i++) {
        const v0 = face[i]
        const v1 = face[(i + 1) % face.length]
        const key = v0 < v1 ? `${v0}_${v1}` : `${v1}_${v0}`
        if (seen.has(key)) continue
        seen.add(key)
        const { cost, position } = computeQuadricError(result, v0, v1)
        edges.push({ v0, v1, cost, position })
      }
    }

    if (edges.length === 0) break
    edges.sort((a, b) => a.cost - b.cost)
    const best = edges[0]

    result.positions[best.v0] = best.position
    const remap = new Map<number, number>()
    remap.set(best.v1, best.v0)

    for (let i = 0; i < result.positions.length; i++) {
      if (remap.has(i)) continue
    }

    result.faces = result.faces
      .map((face) => {
        const newFace = face
          .map((vi) => (vi === best.v1 ? best.v0 : vi))
          .filter((vi, idx, arr) => arr.indexOf(vi) === idx)
        return newFace.length >= 3 ? newFace : null
      })
      .filter((f): f is number[] => f !== null)

    const uniqueVerts = new Set<number>()
    for (const face of result.faces) {
      for (const vi of face) uniqueVerts.add(vi)
    }

    const oldToNew = new Map<number, number>()
    const newPositions: Vec3[] = []
    for (const vi of [...uniqueVerts].sort((a, b) => a - b)) {
      oldToNew.set(vi, newPositions.length)
      newPositions.push({ ...result.positions[vi] })
    }

    result.positions = newPositions
    result.faces = result.faces.map((face) => face.map((vi) => oldToNew.get(vi)!))

    if (result.faceColors.length > result.faces.length) {
      result.faceColors = result.faceColors.slice(0, result.faces.length)
    }
  }

  result.buildHalfEdges()
  return result
}
