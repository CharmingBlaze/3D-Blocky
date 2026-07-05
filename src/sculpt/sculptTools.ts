import {
  add3,
  dist3,
  lerp3,
  scale3,
  sub3,
  type Vec3,
} from '../utils/math'
import { HalfEdgeMesh } from '../mesh/HalfEdgeMesh'

export type SculptTool = 'push' | 'pull' | 'inflate' | 'deflate' | 'relax' | 'pinch'

export interface SculptParams {
  tool: SculptTool
  center: Vec3
  radius: number
  strength: number
  topologyLocked: boolean
}

function falloffWeight(dist: number, radius: number): number {
  if (dist >= radius) return 0
  const t = 1 - dist / radius
  return t * t * (3 - 2 * t)
}

export function applySculpt(mesh: HalfEdgeMesh, params: SculptParams): void {
  if (params.topologyLocked) return

  const { tool, center, radius, strength } = params
  const positions = mesh.positions

  for (let vi = 0; vi < positions.length; vi++) {
    const pos = positions[vi]
    const dist = dist3(pos, center)
    const weight = falloffWeight(dist, radius)
    if (weight <= 0) continue

    const blend = weight * strength

    switch (tool) {
      case 'push':
      case 'pull': {
        const normal = mesh.getVertexNormal(vi, true)
        const dir = tool === 'push' ? 1 : -1
        positions[vi] = add3(pos, scale3(normal, blend * dir * 5))
        break
      }
      case 'inflate':
      case 'deflate': {
        const normal = mesh.getVertexNormal(vi, false)
        const dir = tool === 'inflate' ? 1 : -1
        positions[vi] = add3(pos, scale3(normal, blend * dir * 3))
        break
      }
      case 'relax': {
        const neighbors = mesh.getVertexNeighbors(vi)
        if (neighbors.length === 0) break
        const avg = neighbors.reduce(
          (acc: Vec3, ni: number) => add3(acc, positions[ni]),
          { x: 0, y: 0, z: 0 }
        )
        avg.x /= neighbors.length
        avg.y /= neighbors.length
        avg.z /= neighbors.length
        positions[vi] = lerp3(pos, avg, blend * 0.5)
        break
      }
      case 'pinch': {
        const toCenter = sub3(center, pos)
        positions[vi] = add3(pos, scale3(toCenter, blend * 0.3))
        break
      }
    }
  }
}

export function computeVertexDensity(mesh: HalfEdgeMesh): Float32Array {
  const densities = new Float32Array(mesh.positions.length)

  for (let vi = 0; vi < mesh.positions.length; vi++) {
    const neighbors = mesh.getVertexNeighbors(vi)
    if (neighbors.length === 0) {
      densities[vi] = 0
      continue
    }
    let avgDist = 0
    for (const ni of neighbors) {
      avgDist += dist3(mesh.positions[vi], mesh.positions[ni])
    }
    avgDist /= neighbors.length
    densities[vi] = avgDist > 0 ? 1 / avgDist : 0
  }

  const max = Math.max(...densities, 0.001)
  for (let i = 0; i < densities.length; i++) {
    densities[i] /= max
  }

  return densities
}
