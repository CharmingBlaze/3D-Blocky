import { curvatureSampleProfile } from '../stroke/rdp'
import { type Vec2 } from '../utils/math'
import { HalfEdgeMesh } from './HalfEdgeMesh'

export interface LatheOptions {
  radialSegments: number
  minAngleDeg?: number
  axis?: 'y' | 'x'
  depth?: number
  /** Use profile vertices exactly as rings (no curvature resampling). */
  preserveProfile?: boolean
  /** Seal the bottom end with a flat cap (profile minimum height). */
  capBottom?: boolean
  /** Seal the top end with a flat cap (profile maximum height). */
  capTop?: boolean
}

function addRingCap(
  mesh: HalfEdgeMesh,
  ring: number[],
  height: number,
  axis: 'y' | 'x',
  normalSign: 1 | -1
): void {
  if (ring.length < 3) return
  const ci = mesh.positions.length
  if (axis === 'y') {
    mesh.positions.push({ x: 0, y: height, z: 0 })
  } else {
    mesh.positions.push({ x: height, y: 0, z: 0 })
  }
  for (let i = 0; i < ring.length; i++) {
    const next = (i + 1) % ring.length
    if (normalSign < 0) {
      mesh.faces.push([ci, ring[next]!, ring[i]!])
    } else {
      mesh.faces.push([ci, ring[i]!, ring[next]!])
    }
    mesh.faceColors.push(0x6ecbf5)
  }
}

/** Generate a lathe solid from a 2D profile (radius, height) */
export function generateLathe(
  profile: Vec2[],
  options: LatheOptions
): HalfEdgeMesh {
  const {
    radialSegments,
    minAngleDeg = 15,
    axis = 'y',
    depth = 0,
    preserveProfile = false,
    capBottom = false,
    capTop = false,
  } = options
  const sampled = preserveProfile
    ? profile.filter((p, i, arr) => i === 0 || Math.hypot(p.x - arr[i - 1]!.x, p.y - arr[i - 1]!.y) > 1e-6)
    : curvatureSampleProfile(profile, minAngleDeg, radialSegments + 2)

  const mesh = new HalfEdgeMesh()
  const segments = Math.max(3, radialSegments)
  const ringVerts: number[][] = []

  for (let ri = 0; ri < sampled.length; ri++) {
    const { x: radius, y: height } = sampled[ri]
    const ring: number[] = []

    if (ri === 0 && radius < 0.01) {
      const poleIdx = mesh.positions.length
      if (axis === 'y') {
        mesh.positions.push({ x: 0, y: height + depth, z: 0 })
      } else {
        mesh.positions.push({ x: height + depth, y: 0, z: 0 })
      }
      ring.push(poleIdx)
    } else if (ri === sampled.length - 1 && radius < 0.01) {
      const poleIdx = mesh.positions.length
      if (axis === 'y') {
        mesh.positions.push({ x: 0, y: height + depth, z: 0 })
      } else {
        mesh.positions.push({ x: height + depth, y: 0, z: 0 })
      }
      ring.push(poleIdx)
    } else {
      for (let si = 0; si < segments; si++) {
        const angle = (si / segments) * Math.PI * 2
        const cos = Math.cos(angle)
        const sin = Math.sin(angle)
        const vi = mesh.positions.length

        if (axis === 'y') {
          mesh.positions.push({
            x: cos * radius,
            y: height + depth,
            z: sin * radius,
          })
        } else {
          mesh.positions.push({
            x: height + depth,
            y: cos * radius,
            z: sin * radius,
          })
        }
        ring.push(vi)
      }
    }
    ringVerts.push(ring)
  }

  for (let ri = 0; ri < ringVerts.length - 1; ri++) {
    const ringA = ringVerts[ri]
    const ringB = ringVerts[ri + 1]

    if (ringA.length === 1 && ringB.length > 1) {
      for (let si = 0; si < ringB.length; si++) {
        const next = (si + 1) % ringB.length
        mesh.faces.push([ringA[0], ringB[si], ringB[next]])
        mesh.faceColors.push(0x6ecbf5)
      }
    } else if (ringB.length === 1 && ringA.length > 1) {
      for (let si = 0; si < ringA.length; si++) {
        const next = (si + 1) % ringA.length
        mesh.faces.push([ringB[0], ringA[next], ringA[si]])
        mesh.faceColors.push(0x6ecbf5)
      }
    } else if (ringA.length > 1 && ringB.length > 1) {
      for (let si = 0; si < segments; si++) {
        const next = (si + 1) % segments
        const a = ringA[si]!
        const b = ringA[next]!
        const c = ringB[si]!
        const d = ringB[next]!
        // Quad strip like capsule — same winding as the old triangle pair (a,c,b)+(c,d,b).
        mesh.faces.push([a, c, d, b])
        mesh.faceColors.push(0x6ecbf5)
      }
    }
  }

  if (capBottom && ringVerts[0]!.length > 1) {
    addRingCap(mesh, ringVerts[0]!, sampled[0]!.y + depth, axis, -1)
  }
  if (capTop && ringVerts.length > 0) {
    const last = ringVerts.length - 1
    const lastRing = ringVerts[last]!
    if (lastRing.length > 1) {
      addRingCap(mesh, lastRing, sampled[last]!.y + depth, axis, 1)
    }
  }

  mesh.buildHalfEdges()
  return mesh
}

/** Quick bead: fit soft ellipsoid profile from ellipse silhouette */
export function generateBead(
  silhouette: Vec2[],
  radialSegments: number,
  depth = 0
): HalfEdgeMesh {
  const cx = silhouette.reduce((s, p) => s + p.x, 0) / silhouette.length
  const cy = silhouette.reduce((s, p) => s + p.y, 0) / silhouette.length

  const radii = silhouette.map((p) => Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2))
  const maxR = Math.max(...radii, 1)
  const minY = Math.min(...silhouette.map((p) => p.y))
  const maxY = Math.max(...silhouette.map((p) => p.y))
  const height = Math.max(maxY - minY, 1)

  // Soft ellipsoid profile — rounded caps, not a hard cylinder
  const profile: Vec2[] = []
  const steps = 8
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const y = -height / 2 + t * height
    const ny = (2 * y) / height
    const r = maxR * Math.sqrt(Math.max(0, 1 - ny * ny * 0.9))
    profile.push({ x: r, y })
  }

  return generateLathe(profile, { radialSegments, depth, axis: 'y', minAngleDeg: 20 })
}
