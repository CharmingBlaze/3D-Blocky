import { curvatureSampleClosedLoop } from '../stroke/rdp'
import { type Vec2 } from '../utils/math'
import { ensureCCW } from './concaveTriangulate'
import { HalfEdgeMesh } from './HalfEdgeMesh'
import { LOW_POLY_CAPSULE_HEMI_RINGS } from '../primitives/capsuleMesh'

export interface CapsulePillowOptions {
  /** Total pill height along canonical +Z (becomes view depth after projection). */
  depth: number
  minAngleDeg?: number
  maxBoundaryVerts?: number
  hemiRings?: number
  /** Use polygon vertices as-is (vector pen). */
  preserveBoundary?: boolean
  color?: number
}

function boundaryCentroid(boundary: Vec2[]): Vec2 {
  let x = 0
  let y = 0
  for (const p of boundary) {
    x += p.x
    y += p.y
  }
  const n = boundary.length
  return { x: x / n, y: y / n }
}

function scaleBoundaryRing(
  mesh: HalfEdgeMesh,
  boundary: Vec2[],
  centroid: Vec2,
  scale: number,
  z: number
): number[] {
  const ring: number[] = []
  for (const p of boundary) {
    ring.push(mesh.positions.length)
    mesh.positions.push({
      x: centroid.x + (p.x - centroid.x) * scale,
      y: centroid.y + (p.y - centroid.y) * scale,
      z,
    })
  }
  return ring
}

function stitchRingPair(
  mesh: HalfEdgeMesh,
  ringA: number[],
  ringB: number[],
  color: number
): void {
  const segments = ringA.length
  for (let si = 0; si < segments; si++) {
    const next = (si + 1) % segments
    mesh.faces.push([ringA[si]!, ringA[next]!, ringB[next]!])
    mesh.faces.push([ringA[si]!, ringB[next]!, ringB[si]!])
    mesh.faceColors.push(color, color)
  }
}

function fanPole(
  mesh: HalfEdgeMesh,
  pole: number,
  ring: number[],
  color: number,
  poleIsMin: boolean
): void {
  const segments = ring.length
  for (let si = 0; si < segments; si++) {
    const next = (si + 1) % segments
    if (poleIsMin) {
      mesh.faces.push([pole, ring[next]!, ring[si]!])
    } else {
      mesh.faces.push([pole, ring[si]!, ring[next]!])
    }
    mesh.faceColors.push(color)
  }
}

/** Capsule scale at hemisphere fraction t (0 = pole, 1 = equator). */
function hemiScale(t: number): number {
  return Math.sqrt(Math.max(0, t * (2 - t)))
}

/**
 * Paint 3D-style doodle pillow: exact drawn outline at the equator,
 * low-poly capsule profile in depth (hemisphere bottom + hemisphere top).
 */
export function generateCapsulePillow(
  polygon: Vec2[],
  options: CapsulePillowOptions
): HalfEdgeMesh {
  const {
    depth: rawDepth,
    minAngleDeg = 12,
    maxBoundaryVerts = 48,
    hemiRings = LOW_POLY_CAPSULE_HEMI_RINGS,
    preserveBoundary = false,
    color = 0xf5a66e,
  } = options

  const mesh = new HalfEdgeMesh()
  const ccw = ensureCCW(polygon)
  const boundary = preserveBoundary
    ? ccw
    : curvatureSampleClosedLoop(ccw, minAngleDeg, maxBoundaryVerts)
  if (boundary.length < 3) return mesh

  const depth = Math.max(1.6, rawDepth)
  const fitR = depth / 2
  const centroid = boundaryCentroid(boundary)
  const bands = Math.max(1, hemiRings)
  const rings: number[][] = []

  const bottomPole = mesh.positions.length
  mesh.positions.push({ x: centroid.x, y: centroid.y, z: 0 })

  for (let ri = 1; ri < bands; ri++) {
    const t = ri / bands
    rings.push(scaleBoundaryRing(mesh, boundary, centroid, hemiScale(t), fitR * t))
  }

  rings.push(scaleBoundaryRing(mesh, boundary, centroid, 1, fitR))

  for (let ri = bands - 1; ri >= 1; ri--) {
    const t = ri / bands
    rings.push(
      scaleBoundaryRing(mesh, boundary, centroid, hemiScale(t), depth - fitR * t)
    )
  }

  const topPole = mesh.positions.length
  mesh.positions.push({ x: centroid.x, y: centroid.y, z: depth })

  if (rings.length > 0) {
    fanPole(mesh, bottomPole, rings[0]!, color, true)
    for (let ri = 0; ri < rings.length - 1; ri++) {
      stitchRingPair(mesh, rings[ri]!, rings[ri + 1]!, color)
    }
    fanPole(mesh, topPole, rings[rings.length - 1]!, color, false)
  }

  mesh.buildHalfEdges()
  return mesh
}
