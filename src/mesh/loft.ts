import { curvatureSampleProfile } from '../stroke/rdp'
import {
  computeMedialAxis,
  crossSectionRadius,
} from '../stroke/strokeClassifier'
import { type Vec2 } from '../utils/math'
import { HalfEdgeMesh } from './HalfEdgeMesh'

export interface LoftOptions {
  ringSegments: number
  profileRings?: number
  roundness?: number
  minAngleDeg?: number
}

/** Loft silhouette volume — canonical XY plane, depth extruded along local Z */
export function generateLoft(
  silhouette: Vec2[],
  options: LoftOptions
): HalfEdgeMesh {
  const {
    ringSegments,
    roundness = 0.92,
    minAngleDeg = 15,
    profileRings,
  } = options

  const rawAxis = computeMedialAxis(silhouette)
  const axis = curvatureSampleProfile(
    rawAxis,
    minAngleDeg,
    profileRings ?? rawAxis.length
  )

  const mesh = new HalfEdgeMesh()
  const segments = Math.max(3, ringSegments)

  const minY = Math.min(...silhouette.map((p) => p.y))
  const maxY = Math.max(...silhouette.map((p) => p.y))
  const yRange = maxY - minY || 1
  const ringVerts: number[][] = []

  for (const axisPoint of axis) {
    const tolerance = yRange / axis.length + 2
    const radius = crossSectionRadius(silhouette, axisPoint.y, tolerance) * roundness
    const ring: number[] = []

    if (radius < 0.5) {
      const vi = mesh.positions.length
      mesh.positions.push({ x: axisPoint.x, y: axisPoint.y, z: 0 })
      ring.push(vi)
    } else {
      for (let si = 0; si < segments; si++) {
        const angle = (si / segments) * Math.PI * 2
        const vi = mesh.positions.length
        mesh.positions.push({
          x: axisPoint.x + Math.cos(angle) * radius,
          y: axisPoint.y,
          z: Math.sin(angle) * radius,
        })
        ring.push(vi)
      }
    }
    ringVerts.push(ring)
  }

  connectRings(mesh, ringVerts, segments)
  mesh.buildHalfEdges()
  return mesh
}

function connectRings(mesh: HalfEdgeMesh, ringVerts: number[][], segments: number): void {
  for (let ri = 0; ri < ringVerts.length - 1; ri++) {
    const ringA = ringVerts[ri]
    const ringB = ringVerts[ri + 1]

    if (ringA.length === 1 && ringB.length > 1) {
      for (let si = 0; si < ringB.length; si++) {
        const next = (si + 1) % ringB.length
        mesh.faces.push([ringA[0], ringB[si], ringB[next]])
        mesh.faceColors.push(0x7ecba1)
      }
    } else if (ringB.length === 1 && ringA.length > 1) {
      for (let si = 0; si < ringA.length; si++) {
        const next = (si + 1) % ringA.length
        mesh.faces.push([ringB[0], ringA[next], ringA[si]])
        mesh.faceColors.push(0x7ecba1)
      }
    } else if (ringA.length > 1 && ringB.length > 1) {
      for (let si = 0; si < segments; si++) {
        const next = (si + 1) % segments
        mesh.faces.push([ringA[si], ringA[next], ringB[next]])
        mesh.faces.push([ringA[si], ringB[next], ringB[si]])
        mesh.faceColors.push(0x7ecba1, 0x7ecba1)
      }
    }
  }
}
