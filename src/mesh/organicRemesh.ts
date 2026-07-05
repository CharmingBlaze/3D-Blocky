import { HalfEdgeMesh } from './HalfEdgeMesh'
import { add3, sub3 } from '../utils/math'

function vertexCurvature(mesh: HalfEdgeMesh, vi: number): number {
  const neighbors = mesh.getVertexNeighbors(vi)
  if (neighbors.length < 2) return 0
  const p = mesh.positions[vi]
  let total = 0
  for (let i = 0; i < neighbors.length; i++) {
    const a = mesh.positions[neighbors[i]]
    const b = mesh.positions[neighbors[(i + 1) % neighbors.length]]
    const v1 = sub3(a, p)
    const v2 = sub3(b, p)
    const l1 = Math.hypot(v1.x, v1.y, v1.z)
    const l2 = Math.hypot(v2.x, v2.y, v2.z)
    if (l1 < 1e-8 || l2 < 1e-8) continue
    const dot = (v1.x * v2.x + v1.y * v2.y + v1.z * v2.z) / (l1 * l2)
    total += Math.acos(Math.max(-1, Math.min(1, dot)))
  }
  return total / neighbors.length
}

/** Simplify while penalizing collapse in high-curvature regions */
function simplifyCurvatureAware(mesh: HalfEdgeMesh, targetVertexCount: number): HalfEdgeMesh {
  if (mesh.vertexCount() <= targetVertexCount) return mesh

  const result = HalfEdgeMesh.fromObject(mesh.toObject('temp', 'temp'))
  let curvatures = result.positions.map((_, vi) => vertexCurvature(result, vi))

  while (result.vertexCount() > targetVertexCount && result.faces.length > 0) {
    const edges: { v0: number; v1: number; cost: number; position: typeof result.positions[0] }[] = []
    const seen = new Set<string>()

    for (const face of result.faces) {
      for (let i = 0; i < face.length; i++) {
        const v0 = face[i]
        const v1 = face[(i + 1) % face.length]
        const key = v0 < v1 ? `${v0}_${v1}` : `${v1}_${v0}`
        if (seen.has(key)) continue
        seen.add(key)

        const p0 = result.positions[v0]
        const p1 = result.positions[v1]
        const position = {
          x: (p0.x + p1.x) / 2,
          y: (p0.y + p1.y) / 2,
          z: (p0.z + p1.z) / 2,
        }

        let cost = 0
        for (const face2 of result.faces) {
          if (!face2.includes(v0) && !face2.includes(v1)) continue
          const verts = face2.map((vi) => result.positions[vi])
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
          const len = Math.hypot(normal.x, normal.y, normal.z)
          if (len < 1e-10) continue
          const d = -(normal.x * a.x + normal.y * a.y + normal.z * a.z) / len
          const dist = Math.abs(
            (normal.x * position.x + normal.y * position.y + normal.z * position.z) / len + d
          )
          cost += dist * dist
        }

        const curv = (curvatures[v0] + curvatures[v1]) * 0.5
        cost /= 0.15 + curv

        edges.push({ v0, v1, cost, position })
      }
    }

    if (edges.length === 0) break
    edges.sort((a, b) => a.cost - b.cost)
    const best = edges[0]

    result.positions[best.v0] = best.position
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
    const newPositions: typeof result.positions = []
    for (const vi of [...uniqueVerts].sort((a, b) => a - b)) {
      oldToNew.set(vi, newPositions.length)
      newPositions.push({ ...result.positions[vi] })
    }

    result.positions = newPositions
    result.faces = result.faces.map((face) => face.map((vi) => oldToNew.get(vi)!))
    if (result.faceColors.length > result.faces.length) {
      result.faceColors = result.faceColors.slice(0, result.faces.length)
    }
    result.buildHalfEdges()
    curvatures = result.positions.map((_, vi) => vertexCurvature(result, vi))
  }

  result.buildHalfEdges()
  return result
}

/** In-place Laplacian relax — no subdivision */
export function relaxOrganicMesh(mesh: HalfEdgeMesh, strength = 0.18, iterations = 1): void {
  for (let iter = 0; iter < iterations; iter++) {
    const originals = mesh.positions.map((p) => ({ ...p }))
    for (let vi = 0; vi < mesh.positions.length; vi++) {
      const neighbors = mesh.getVertexNeighbors(vi)
      if (neighbors.length === 0) continue
      const avg = neighbors.reduce(
        (acc, ni) => add3(acc, originals[ni]),
        { x: 0, y: 0, z: 0 }
      )
      avg.x /= neighbors.length
      avg.y /= neighbors.length
      avg.z /= neighbors.length
      mesh.positions[vi] = {
        x: originals[vi].x + (avg.x - originals[vi].x) * strength,
        y: originals[vi].y + (avg.y - originals[vi].y) * strength,
        z: originals[vi].z + (avg.z - originals[vi].z) * strength * 0.35,
      }
    }
  }
}

/** Remesh to poly budget — curvature-aware, no subdivision */
export function remeshOrganic(
  mesh: HalfEdgeMesh,
  targetVerts: number,
  relaxStrength = 0.12
): HalfEdgeMesh {
  let result = mesh
  if (result.vertexCount() > targetVerts) {
    result = simplifyCurvatureAware(result, targetVerts)
  }
  relaxOrganicMesh(result, relaxStrength, 1)
  result.buildHalfEdges()
  return result
}

export { simplifyCurvatureAware }
